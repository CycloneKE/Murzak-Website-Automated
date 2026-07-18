/**
 * Provisioning runner — Phase 1.
 *
 * Polls for queued Provisioning Jobs and turns them into real builds:
 *   fetch queued (respecting backoff) → capacity recheck (premium) →
 *   dispatch by lane → mark active, OR retry with backoff, OR escalate to a human.
 *
 * Safety contract:
 *   - Never marks a job "active" unless a lane actually reported success.
 *   - Unknown/unconfigured/manual lanes escalate to needs_human — never faked.
 *   - A throw inside a job is contained; one bad job can't stop the queue.
 *   - Claim is verified (claimJob writes runner_id then re-reads it) so two poll
 *     runners can't both build the same job. For true atomicity across many
 *     workers use the BullMQ dispatcher (queue.js), which holds a lock per job;
 *     processJobByName() is the worker entrypoint and the doctype stays the
 *     source of truth.
 */

const { JOB_DOCTYPE } = require("./provisioningService");
const {
  WEB_ACCOUNT_DOCTYPE, WEB_ACCOUNT_SERVICES_FIELD,
  CHILD_SERVICE_ID_FIELD, CHILD_STATUS_FIELD,
  STATUS_SETTING_UP, STATUS_ACTIVE,
} = require("./constants");
const { getServiceMeta, laneFor } = require("./catalog");
const scaling = require("./scaling");
const targets = require("./targets");
const backups = require("./backups");
const edge = require("./edge");
const coolify = require("./lanes/coolify");
const bench = require("./lanes/bench");
const mock = require("./lanes/mock");

const DEFAULT_LANES = mock.isEnabled()
  ? { coolify: mock, bench: mock }
  : { coolify, bench };

const enc = encodeURIComponent;
const maxAttempts = () => Math.max(1, Number(process.env.PROVISIONING_MAX_ATTEMPTS || 3));
const batchSize = () => Math.max(1, Number(process.env.PROVISIONING_BATCH || 5));
const pollMs = () => Math.max(5000, Number(process.env.PROVISIONING_POLL_MS || 60000));
const concurrency = () => Math.max(1, Number(process.env.PROVISIONING_CONCURRENCY || 2));

function isRunnerEnabled() {
  return String(process.env.PROVISIONING_RUNNER_ENABLED || "false").toLowerCase() === "true";
}

/** Frappe Datetime string (UTC) for now + offsetSec. */
function sqlTime(offsetSec = 0) {
  const d = new Date(Date.now() + offsetSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" + p(d.getUTCMonth() + 1) +
    "-" + p(d.getUTCDate()) +
    " " + p(d.getUTCHours()) +
    ":" + p(d.getUTCMinutes()) +
    ":" + p(d.getUTCSeconds())
  );
}

/** Exponential backoff (capped at 30 min). */
function backoffSec(attempts) {
  return Math.min(1800, 60 * Math.pow(2, Math.max(0, attempts - 1)));
}

function parseSqlTime(s) {
  // Frappe returns "YYYY-MM-DD HH:MM:SS" (UTC). Treat as UTC.
  const t = Date.parse(String(s).replace(" ", "T") + "Z");
  return Number.isNaN(t) ? 0 : t;
}

async function updateJob(client, name, patch) {
  return client.put(`/api/resource/${enc(JOB_DOCTYPE)}/${enc(name)}`, patch);
}

async function fetchJobByName(client, name) {
  const res = await client.get(`/api/resource/${enc(JOB_DOCTYPE)}/${enc(name)}`);
  return res.data?.data || null;
}

/**
 * Optimistic-but-verified claim: write running + our runner_id, then read it
 * back. If another runner's id is there, we lost the race and back off. Reduces
 * double-processing when multiple poll runners share one queue (BullMQ's lock is
 * the hard guarantee; this is defence-in-depth for the poll path).
 * @returns {Promise<boolean>} true if we own the job.
 */
async function claimJob(client, name, runnerId, targetId) {
  // Pre-check: claimable only if still queued, OR already owned by us (idempotent
  // re-claim). A job another runner already moved to running/active is rejected.
  try {
    const pre = await fetchJobByName(client, name);
    if (!pre) return false;
    if (pre.status !== "queued" && pre.runner_id !== runnerId) return false;
  } catch {
    // read failed — proceed to the write+verify below (lane is idempotent).
  }

  await updateJob(client, name, {
    status: "running",
    runner_id: runnerId,
    started_at: sqlTime(),
    target: targetId,
  });
  try {
    const cur = await fetchJobByName(client, name);
    if (cur && cur.runner_id && cur.runner_id !== runnerId) return false;
  } catch {
    // verify read failed — proceed (best-effort); the lane is still idempotent.
  }
  return true;
}

async function createEscalationTicket(client, job, reason) {
  if (!job.web_account) return;
  try {
    let email = job.web_account;
    try {
      const res = await client.get(`/api/resource/${enc(WEB_ACCOUNT_DOCTYPE)}/${enc(job.web_account)}`);
      if (res.data?.data?.user_email) email = res.data.data.user_email;
    } catch (e) { /* best-effort */ }

    const payload = {
      portal_user: job.web_account,
      email: email,
      subject: `Provisioning Delayed: ${job.service_name || job.service_id || job.name}`,
      status: "Waiting on Admin",
      source: "Portal",
      messages: [{
        sender_type: "Admin",
        sender: "System Automation",
        message: `Provisioning for ${job.service_name || job.service_id || job.name} requires human intervention. Our engineers have been notified and are actively working on it.\n\nInternal diagnostic: ${reason}`
      }]
    };
    await client.post("/api/resource/Portal Users Requests", payload);
  } catch (err) {
    console.error(`[provisioning] Failed to create escalation ticket for ${job.name}: ${err.message}`);
  }
}

async function escalate(client, job, reason) {
  await updateJob(client, job.name, { status: "needs_human", error: String(reason).slice(0, 500) });
  await createEscalationTicket(client, job, reason);
  return { name: job.name, outcome: "needs_human", reason };
}

// On provisioning completion, flip the managed (premium) service's Web Account
// row from "Setting up" to "Active". Best-effort; never throws into the runner.
async function markAccountServiceActive(client, webAccount, serviceId) {
  if (!webAccount || !serviceId) return;
  try {
    const res = await client.get(`/api/resource/${enc(WEB_ACCOUNT_DOCTYPE)}/${enc(webAccount)}`);
    const acc = res.data?.data || {};
    const rows = Array.isArray(acc[WEB_ACCOUNT_SERVICES_FIELD]) ? acc[WEB_ACCOUNT_SERVICES_FIELD] : [];
    let changed = false;
    const updated = rows.map((r) => {
      if (r[CHILD_SERVICE_ID_FIELD] === serviceId && r[CHILD_STATUS_FIELD] === STATUS_SETTING_UP) {
        changed = true;
        return { ...r, [CHILD_STATUS_FIELD]: STATUS_ACTIVE };
      }
      return r;
    });
    if (changed) {
      await client.put(`/api/resource/${enc(WEB_ACCOUNT_DOCTYPE)}/${enc(webAccount)}`, {
        [WEB_ACCOUNT_SERVICES_FIELD]: updated,
      });
    }
  } catch (e) {
    console.warn(`[provisioning] could not flip ${serviceId} -> Active on ${webAccount}: ${e.message}`);
  }
}

/** Queued jobs whose backoff (next_run_at) has elapsed. */
async function fetchClaimable(client, limit) {
  const res = await client.get(`/api/resource/${enc(JOB_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([["status", "=", "queued"]]),
      fields: JSON.stringify([
        "name", "web_account", "invoice", "service_id", "service_name",
        "category", "capacity_class", "lane", "status", "attempts",
        "ram_mb", "disk_gb", "next_run_at", "target",
        // BYOA: the lane dispatches on repo_url — omitting it here silently
        // downgrades an app deploy to a blank service (caught live 2026-07-16).
        // app_port + deployment_uuid are the same bug class: the lane reads
        // both (port at create, deployment_uuid to RESUME a timed-out build
        // instead of re-building), so they must ride along on the claim fetch.
        "repo_url", "app_port", "deployment_uuid",
      ]),
      order_by: "modified asc",
      limit_page_length: limit,
    },
  });
  const now = Date.now();
  return (res.data?.data || []).filter((j) => !j.next_run_at || parseSqlTime(j.next_run_at) <= now);
}

/**
 * Process one job end-to-end. Returns an outcome record; never throws.
 */
async function processJob(client, job, lanes = DEFAULT_LANES, runnerId = "runner") {
  try {
    const meta = getServiceMeta(job.service_id);
    const lane = job.lane || laneFor(meta);

    if (lane === "manual") {
      return await escalate(client, job, "Manual/dedicated lane — provision out of band");
    }

    // Placement + capacity (premium tenants only; volume slices are light and
    // always land on box-1). When no box has headroom, request scale-out and park.
    const cls = job.capacity_class || meta?.capacityClass;
    const placement = await scaling.ensureCapacityFor(client, { ramMb: job.ram_mb, capacityClass: cls });
    if (!placement.ok) {
      const scaleOut = await scaling.requestScaleOut(client, {
        reason: `No box headroom for ${job.service_name || job.service_id} (~${job.ram_mb}MB)`,
        ramMb: job.ram_mb,
      });
      await updateJob(client, job.name, { gated: 1 });
      return await escalate(
        client,
        job,
        `Capacity: no box has RAM headroom — scale-out ${scaleOut.deduped ? "already requested" : "requested"} (${scaleOut.request || "no doctype"})`
      );
    }
    const targetId = placement.target || targets.PRIMARY_ID;
    const target = targets.getTarget(targetId);

    const adapter = lanes[lane];
    if (!adapter || !adapter.isConfigured({ target })) {
      const why = adapter?.configError ? adapter.configError({ target }) : `Lane "${lane}" not available`;
      return await escalate(client, job, why);
    }

    // Verified claim (records the chosen box). If we lost the race, back off.
    const owned = await claimJob(client, job.name, runnerId, targetId);
    if (!owned) {
      return { name: job.name, outcome: "skipped", reason: "claim lost to another runner" };
    }

    try {
      const out = await adapter.provision(job, { target });
      // Off-site backup at create-time (best-effort; recorded on the job).
      let backup = { status: "skipped" };
      try {
        backup = await backups.registerBackup({
          service_id: job.service_id,
          web_account: job.web_account,
          target: targetId,
          external_ref: out.externalRef,
        });
      } catch (be) {
        backup = { status: "failed", detail: be.message };
      }
      // Per-tenant edge / WAF at create-time (best-effort; recorded on the job).
      let edgeRes = { status: "skipped" };
      try {
        edgeRes = await edge.registerEdge({
          service_id: job.service_id,
          web_account: job.web_account,
          target: targetId,
          external_ref: out.externalRef,
          hostname: out.access?.hostname || out.access?.url || "",
        });
      } catch (ee) {
        edgeRes = { status: "failed", detail: ee.message };
      }
      await updateJob(client, job.name, {
        status: "active",
        external_ref: String(out.externalRef || "").slice(0, 140),
        ...(out.deploymentUuid ? { deployment_uuid: String(out.deploymentUuid).slice(0, 140) } : {}),
        access: JSON.stringify(out.access || {}).slice(0, 1000),
        log: String(out.log || "").slice(-4000),
        backup_status: backup.status,
        edge_status: edgeRes.status,
        error: "",
      });
      // Managed SaaS goes live: flip its Web Account row "Setting up" -> "Active".
      await markAccountServiceActive(client, job.web_account, job.service_id);
      return { name: job.name, outcome: "active", externalRef: out.externalRef, target: targetId, backup: backup.status, edge: edgeRes.status };
    } catch (e) {
      const attempts = Number(job.attempts || 0) + 1;
      // A permanent failure (e.g. the customer's build FAILED — a retry would
      // just fail identically) skips the backoff loop entirely: straight to a
      // human, with the build-log tail preserved on the job for diagnosis.
      if (e.permanent === true || attempts >= maxAttempts()) {
        const reason = e.permanent === true
          ? `Permanent failure: ${e.message}`
          : `Failed after ${attempts} attempt(s): ${e.message}`;
        await updateJob(client, job.name, {
          status: "needs_human",
          attempts,
          error: reason.slice(0, 500),
          ...(e.logTail
            ? { log: `${job.log ? `${job.log}\n` : ""}--- build log tail ---\n${e.logTail}`.slice(-4000) }
            : {}),
          ...(e.deploymentUuid ? { deployment_uuid: String(e.deploymentUuid).slice(0, 140) } : {}),
        });
        await createEscalationTicket(client, job, reason);
        return { name: job.name, outcome: "needs_human", attempts, reason: e.message };
      }
      const wait = backoffSec(attempts);
      await updateJob(client, job.name, {
        status: "queued",
        attempts,
        next_run_at: sqlTime(wait),
        error: String(e.message).slice(0, 500),
        // A timed-out build hands back its deployment_uuid so the retry RESUMES
        // polling that same deployment instead of triggering a duplicate build.
        ...(e.deploymentUuid ? { deployment_uuid: String(e.deploymentUuid).slice(0, 140) } : {}),
      });
      return { name: job.name, outcome: "retry", attempts, retryInSec: wait };
    }
  } catch (e) {
    // Updating Frappe itself failed, etc. Don't let it kill the queue.
    return { name: job.name, outcome: "error", reason: e.message };
  }
}

/**
 * Worker entrypoint for the BullMQ dispatcher: load a job by name, re-check it's
 * still eligible (the doctype is the source of truth), then process it. Returns
 * an outcome record; never throws.
 */
async function processJobByName(client, name, lanes = DEFAULT_LANES, runnerId = "worker") {
  let job;
  try {
    job = await fetchJobByName(client, name);
  } catch (e) {
    return { name, outcome: "error", reason: e.message };
  }
  if (!job) return { name, outcome: "missing" };
  if (job.status !== "queued") return { name, outcome: "skipped", reason: `status=${job.status}` };
  if (job.next_run_at && parseSqlTime(job.next_run_at) > Date.now()) {
    return { name, outcome: "deferred", retryInSec: Math.ceil((parseSqlTime(job.next_run_at) - Date.now()) / 1000) };
  }
  return processJob(client, job, lanes, runnerId);
}

/**
 * Process up to `max` claimable jobs once, with bounded concurrency. Returns a
 * summary. Never throws.
 *
 * Note: distinct jobs are safe to build in parallel; the per-target capacity
 * check is a point-in-time read, so we cap concurrency (PROVISIONING_CONCURRENCY)
 * to avoid a thundering herd against one box's RAM gate.
 */
async function processQueue(
  client,
  { lanes = DEFAULT_LANES, max = batchSize(), runnerId = "runner", limit = concurrency() } = {}
) {
  let jobs = [];
  try {
    jobs = await fetchClaimable(client, max);
  } catch (e) {
    return { processed: 0, error: e.message, results: [] };
  }

  const results = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= jobs.length) break;
      results[i] = await processJob(client, jobs[i], lanes, runnerId);
    }
  });
  await Promise.all(workers);

  return { processed: jobs.length, results };
}

let timer = null;

/**
 * Start the polling loop. No-op unless PROVISIONING_RUNNER_ENABLED=true.
 * @param frappeClientFactory () => axios-like client (e.g. server.js frappeClient)
 */
function startRunner(frappeClientFactory, { intervalMs } = {}) {
  if (!isRunnerEnabled()) {
    return { started: false, reason: "PROVISIONING_RUNNER_ENABLED!=true" };
  }
  if (typeof frappeClientFactory !== "function") {
    return { started: false, reason: "no frappe client factory" };
  }
  if (timer) return { started: true, already: true };

  const ms = intervalMs || pollMs();
  const tick = async () => {
    try {
      const r = await processQueue(frappeClientFactory());
      if (r.processed) {
        console.log(
          `[provisioning] runner processed ${r.processed} job(s): ` +
            r.results.map((x) => `${x.name}=${x.outcome}`).join(", ")
        );
      }
    } catch (e) {
      console.error("[provisioning] runner tick error:", e.message);
    }
  };

  timer = setInterval(tick, ms);
  if (timer.unref) timer.unref();
  // Kick once shortly after boot so a queued job doesn't wait a full interval.
  setTimeout(tick, 3000).unref?.();
  return { started: true, intervalMs: ms };
}

function stopRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  DEFAULT_LANES,
  isRunnerEnabled,
  backoffSec,
  parseSqlTime,
  fetchClaimable,
  fetchJobByName,
  claimJob,
  processJob,
  processJobByName,
  processQueue,
  startRunner,
  stopRunner,
  markAccountServiceActive,
};
