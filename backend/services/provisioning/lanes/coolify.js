/**
 * Lane A — Coolify (web / app / static / DB; the "volume" capacity class).
 *
 * Creates a resource in a pre-configured Coolify project/server/environment and
 * applies a memory limit derived from the job's footprint. This is the single
 * integration point with Coolify's REST API.
 *
 * Safety: provision() is only ever called by the runner AFTER isConfigured()
 * returns true, so a half-configured environment never silently fakes a build —
 * the runner escalates unconfigured lanes to a human instead.
 *
 * Required env:
 *   COOLIFY_BASE_URL, COOLIFY_TOKEN, COOLIFY_PROJECT_UUID, COOLIFY_SERVER_UUID
 * Optional:
 *   COOLIFY_ENV_NAME (default "production")
 */

const axios = require("axios");
const crypto = require("crypto");
const { CAPACITY } = require("../catalog");
const appDomain = require("../appDomain");

// Server-wide budget (from the generated catalog snapshot: KVM 2 = 2 vCPU /
// 6.4GB sellable). Used to derive a proportional CPU quota per container.
// Fallbacks match the box we sell today so this never divides by zero if the
// snapshot is missing a field.
const BOX_VCPU = Number(CAPACITY?.vcpu) > 0 ? Number(CAPACITY.vcpu) : 2;

// CPU quotas are proportioned against THIS figure, deliberately NOT
// sellableRamMb.
//
// They used to be the same number, which coupled two unrelated things. When
// sellableRamMb was corrected 6400 -> 3000 on 2026-09-05 to match measured
// free RAM, that coupling would have roughly DOUBLED every container's CPU
// ceiling as a side effect: a 1536MB tenant would jump from 0.48 to 1.02 of
// the box's 2 vCPU. On a box that also runs a live map product (OSRM +
// tileserver), handing tenants twice the CPU headroom is a good way to starve
// it — and nothing about correcting a RAM figure should change CPU policy.
//
// The RAM pool shrank because non-sellable workloads consume it. Those same
// workloads consume CPU too, so the sellable RAM pool is the wrong
// denominator for a CPU share of the whole box.
//
// Pinned at 6400 to preserve the behaviour these quotas were tuned for.
// Changing it is a deliberate CPU-policy decision — make it on purpose, with
// measurements, not as a side effect of a RAM edit.
const CPU_QUOTA_DENOMINATOR_MB = 6400;

const DEFAULT_RAM_MB = 256;
const MIN_CPUS = 0.25; // never starve a container below a quarter-core
const DEFAULT_PIDS_LIMIT = 512; // bounds a fork bomb; generous enough for git/npm/composer

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Pure resource-limit derivation for a container, from the job's footprint +
 * the box budget. Kept side-effect-free so it's unit-tested directly.
 *
 * P5.0 hardening (see how-does-one-create-deep-kazoo.md): before this, provision()
 * set ONLY a memory cap — a runaway app (or, later, a shell) could fork-bomb the
 * host PID table, pin a core, or fill the shared disk and take down every
 * co-tenant. This derives all four bounds plus the cap-drop / no-new-privileges
 * hardening flags.
 *
 *   memory : job.ram_mb  (floor DEFAULT_RAM_MB)
 *   cpus   : proportional to the container's RAM share of the sellable budget,
 *            floored at MIN_CPUS, ceiled at the whole box — a container can never
 *            be *entitled* to more CPU than the box has.
 *   pids   : COOLIFY_PIDS_LIMIT env override, else DEFAULT_PIDS_LIMIT.
 *   disk   : job.disk_gb when known (0/undefined => omit; not all lanes size disk).
 */
function resourceLimits(job) {
  const ramMb = Math.max(Number(job?.ram_mb) || DEFAULT_RAM_MB, DEFAULT_RAM_MB);
  const diskGb = Number(job?.disk_gb) > 0 ? Number(job.disk_gb) : 0;

  const rawCpus = (ramMb / CPU_QUOTA_DENOMINATOR_MB) * BOX_VCPU;
  const cpus = Math.round(clamp(rawCpus, MIN_CPUS, BOX_VCPU) * 100) / 100;

  const envPids = Number(process.env.COOLIFY_PIDS_LIMIT);
  const pidsLimit = Number.isFinite(envPids) && envPids > 0 ? Math.floor(envPids) : DEFAULT_PIDS_LIMIT;

  return { ramMb, cpus, pidsLimit, diskGb };
}

/**
 * Resolve config for a target. box-1 (no target.coolify) uses the flat COOLIFY_*
 * env; additional boxes carry their own coolify block in PROVISIONING_TARGETS.
 */
function cfg(opts) {
  const t = opts?.target?.coolify || {};
  return {
    baseUrl: t.baseUrl || process.env.COOLIFY_BASE_URL,
    token: t.token || process.env.COOLIFY_TOKEN,
    project: t.projectUuid || process.env.COOLIFY_PROJECT_UUID,
    server: t.serverUuid || process.env.COOLIFY_SERVER_UUID,
    env: t.envName || process.env.COOLIFY_ENV_NAME || "production",
  };
}

function isConfigured(opts) {
  const c = cfg(opts);
  return !!(c.baseUrl && c.token && c.project && c.server);
}

function configError(opts) {
  if (isConfigured(opts)) return null;
  const c = cfg(opts);
  const missing = [
    ["baseUrl", "COOLIFY_BASE_URL"],
    ["token", "COOLIFY_TOKEN"],
    ["project", "COOLIFY_PROJECT_UUID"],
    ["server", "COOLIFY_SERVER_UUID"],
  ]
    .filter(([k]) => !c[k])
    .map(([, env]) => env);
  const where = opts?.target?.id ? ` for target ${opts.target.id}` : "";
  return `Coolify lane not configured${where} (missing: ${missing.join(", ")})`;
}

function http(opts) {
  const c = cfg(opts);
  return axios.create({
    baseURL: c.baseUrl.replace(/\/+$/, ""),
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    timeout: Number(process.env.COOLIFY_TIMEOUT_MS || 30000),
  });
}

/** Safe, DNS-friendly resource name from the job. */
function resourceName(job) {
  return `${job.web_account}-${job.service_id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Split a stored repo reference into url + branch. Customers submit one field;
 * "https://github.com/x/y#staging" pins a branch, otherwise Coolify's default
 * (the repo's default branch) is used via "main".
 */
function parseRepoRef(repoRef) {
  const raw = String(repoRef || "").trim();
  if (!raw) return null;
  const hash = raw.indexOf("#");
  if (hash === -1) return { url: raw, branch: "main" };
  return { url: raw.slice(0, hash), branch: raw.slice(hash + 1) || "main" };
}

// ---------------------------------------------------------------------------
// Build-wait plumbing (BYOA). A job is only "active" once Coolify reports the
// DEPLOYMENT finished — never on resource creation alone. Pure helpers are
// exported for unit tests; network calls take the axios client as a param so
// tests can script them.
// ---------------------------------------------------------------------------

const buildPollMs = () => Math.max(2000, Number(process.env.COOLIFY_BUILD_POLL_MS || 10000));
const buildTimeoutMs = () =>
  Math.max(60000, Number(process.env.COOLIFY_BUILD_TIMEOUT_MS || 600000));

/** Map Coolify's deployment status strings to success | failure | pending. */
function classifyDeploymentStatus(status) {
  const s = String(status || "").toLowerCase();
  if (/finished|success/.test(s)) return "success";
  if (/failed|error|cancelled/.test(s)) return "failure";
  return "pending";
}

/**
 * Last `max` chars of a deployment's build log. Coolify stores logs either as
 * a plain string or a JSON array of {output} lines — handle both, defensively.
 */
function extractLogTail(deployment, max = 2000) {
  let raw = deployment?.logs ?? deployment?.log ?? "";
  if (typeof raw !== "string") {
    try {
      raw = JSON.stringify(raw);
    } catch {
      raw = String(raw);
    }
  }
  if (raw.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        raw = arr
          .map((l) => (l && typeof l === "object" ? l.output ?? "" : String(l)))
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      /* not JSON after all — keep the raw string */
    }
  }
  return raw.length > max ? raw.slice(-max) : raw;
}

/** An error the runner must NOT retry (e.g. the customer's build failed). */
function permanentError(message, extra = {}) {
  const err = new Error(message);
  err.permanent = true;
  return Object.assign(err, extra);
}

async function triggerDeploy(client, appUuid) {
  const res = await client.post(`/api/v1/deploy?uuid=${encodeURIComponent(appUuid)}`);
  const d = res.data?.data || res.data || {};
  const list = Array.isArray(d.deployments) ? d.deployments : [];
  return String(list[0]?.deployment_uuid || d.deployment_uuid || "");
}

/**
 * Trigger (or resume) a deployment and poll it to a terminal state.
 *  - success  → { deploymentUuid, logTail }
 *  - build failed → throws PERMANENT (runner goes straight to needs_human)
 *  - still running at timeout → throws retryable with .deploymentUuid so the
 *    runner's backoff re-entry RESUMES this deployment instead of re-building.
 */
async function deployAndWait(
  client,
  appUuid,
  { pollMs = buildPollMs(), timeoutMs = buildTimeoutMs(), deploymentUuid = "", sleep } = {}
) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let depUuid = String(deploymentUuid || "");
  if (!depUuid) depUuid = await triggerDeploy(client, appUuid);
  if (!depUuid) {
    // Can't track the build — retryable, never assumed successful.
    throw new Error("coolify: deploy trigger returned no deployment_uuid — cannot confirm build");
  }

  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    await wait(pollMs);
    const res = await client.get(`/api/v1/deployments/${encodeURIComponent(depUuid)}`);
    last = res.data?.data || res.data || {};
    const cls = classifyDeploymentStatus(last.status || last.deployment_status);
    if (cls === "success") return { deploymentUuid: depUuid, logTail: extractLogTail(last) };
    if (cls === "failure") {
      throw permanentError(
        `coolify: build failed (deployment ${depUuid}, status=${last.status || last.deployment_status})`,
        { logTail: extractLogTail(last), deploymentUuid: depUuid }
      );
    }
  }
  const err = new Error(
    `coolify: build still running after ${Math.round(timeoutMs / 60000)}m (deployment ${depUuid}) — will re-check`
  );
  err.deploymentUuid = depUuid;
  err.logTail = extractLogTail(last);
  throw err;
}

/**
 * Normalize one Coolify deployment row to the portal's shape. Defensive: field
 * names differ across Coolify versions (⚠️ verify with scripts/coolify-smoke.js);
 * anything missing degrades to "" rather than throwing.
 */
function normalizeDeployment(d) {
  const status = String(d?.status || d?.deployment_status || "");
  return {
    uuid: String(d?.deployment_uuid || d?.uuid || ""),
    status,
    result: classifyDeploymentStatus(status),
    commit: String(d?.commit || d?.git_commit_sha || "").slice(0, 12),
    commitMessage: String(d?.commit_message || "").slice(0, 140),
    createdAt: d?.created_at || d?.createdAt || "",
    finishedAt: d?.finished_at || d?.updated_at || "",
  };
}

// NOTE: there is deliberately no listDeployments() here. Confirmed live
// against Coolify 4.1.2: GET /api/v1/applications/{uuid}/deployments -> 404
// (route doesn't exist), and GET /api/v1/deployments only lists CURRENTLY
// RUNNING deployments, not history. Deployment history is instead
// self-recorded by the runner/redeploy route (see ../deploymentHistory.js)
// and looked up one uuid at a time via getDeployment() below, which IS a
// real, confirmed-working endpoint.

/** One deployment incl. a large log tail (for the portal's log viewer). */
async function getDeployment(deploymentUuid, opts) {
  const client = http(opts);
  const res = await client.get(`/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`);
  const d = res.data?.data || res.data || {};
  return {
    ...normalizeDeployment(d),
    logs: extractLogTail(d, 20000),
    // Which app this deployment belongs to — used by the portal route's
    // ownership check. Field name uncertain across versions; empty = unknown
    // and the caller must fall back to a list-membership check (fail closed).
    applicationUuid: String(
      d?.application_uuid || d?.application?.uuid || d?.resource_uuid || ""
    ),
  };
}

/** Customer-initiated redeploy of an already-provisioned application. */
async function redeploy(externalRef, opts) {
  const client = http(opts);
  const deploymentUuid = await triggerDeploy(client, externalRef);
  return { deploymentUuid };
}

/** The app's own URL from Coolify (fqdn/domains) — used when APP_DOMAIN_BASE is unset. */
async function fetchAppUrl(client, appUuid) {
  try {
    const res = await client.get(`/api/v1/applications/${encodeURIComponent(appUuid)}`);
    const d = res.data?.data || res.data || {};
    const first = String(d.fqdn || d.domains || "").split(",")[0].trim();
    if (!first) return "";
    return /^https?:\/\//i.test(first) ? first : `https://${first}`;
  } catch {
    return "";
  }
}

/**
 * Shared by the create path AND the crash-recovery path: attach the customer
 * hostname, run the deployment to completion, and build the job result with a
 * REAL customer URL (never the Coolify admin panel).
 */
async function finalizeApp(client, c, job, appUuid, repo, opts, { recovered = false } = {}) {
  const name = resourceName(job);
  const slug = appDomain.slugWithSuffix(name, job.name);
  const fqdn = appDomain.fqdnFor(slug);

  // Attach the customer hostname BEFORE deploying so the proxy config and any
  // URL-aware build steps pick it up. Best-effort: a rejected PATCH must not
  // block the deploy — the URL then falls back to Coolify's auto-generated one.
  if (fqdn) {
    try {
      await client.patch(`/api/v1/applications/${encodeURIComponent(appUuid)}`, { domains: fqdn });
    } catch (e) {
      console.warn(`[coolify] domains PATCH failed for ${name} (${fqdn}): ${e.message}`);
    }
  }

  const { deploymentUuid, logTail } = await deployAndWait(client, appUuid, {
    deploymentUuid: String(job.deployment_uuid || ""),
  });

  const url = fqdn || (await fetchAppUrl(client, appUuid));
  return {
    externalRef: String(appUuid),
    deploymentUuid,
    access: {
      lane: "coolify",
      kind: "application",
      target: opts?.target?.id || "box-1",
      resource: name,
      repo: repo.url,
      branch: repo.branch,
      url,
      manageUrl: c.baseUrl.replace(/\/+$/, ""),
      uuid: String(appUuid),
    },
    log:
      `coolify: ${recovered ? "recovered" : "created"} application "${name}" (uuid=${appUuid}) ` +
      `from ${repo.url}#${repo.branch}; deployment ${deploymentUuid} finished; url=${url || "(pending)"}` +
      (logTail ? `\n--- build log tail ---\n${logTail}` : ""),
  };
}

/**
 * BYOA lane — deploy the customer's own app from its Git repository as a
 * Coolify APPLICATION (git-sourced build), not a blank "service".
 * Uses Coolify v4's documented public-repo application endpoint; a private
 * repo (or bad URL) makes the POST fail, the runner retries then escalates to
 * needs_human — staff follow up for access. Never fakes a build.
 *
 * ⚠️ Like the rest of this lane, smoke-test against the live instance before
 * trusting in front of real customers (same VPS-IP restriction).
 */
async function provisionApp(job, opts) {
  const c = cfg(opts);
  const client = http(opts);
  const name = resourceName(job);
  const repo = parseRepoRef(job.repo_url);
  const limits = resourceLimits(job);

  // Idempotency: recover an application created on a previous crashed attempt.
  // The recovery path goes through the SAME finalizeApp as a fresh create —
  // before this, recovery returned success without ever checking a deployment.
  // ONLY the list call is wrapped — see the matching note in provision(). The
  // previous version also wrapped finalizeApp, so a recovery whose deploy
  // failed (even PERMANENTLY) was swallowed and fell through to creating a
  // second application for the same job.
  let existing;
  try {
    const listRes = await client.get("/api/v1/applications");
    existing = (listRes.data?.data || listRes.data || []).find?.((a) => a.name === name);
  } catch (e) {
    // An unreadable list is not evidence of absence — retryable, never create.
    throw new Error(
      `coolify: could not list applications to check for an existing "${name}" — refusing to create blind (${e.message})`
    );
  }

  if (existing) {
    const uuid = existing.uuid || existing.id || name;
    return await finalizeApp(client, c, job, uuid, repo, opts, { recovered: true });
  }

  const payload = {
    project_uuid: c.project,
    server_uuid: c.server,
    environment_name: c.env,
    name,
    git_repository: repo.url,
    git_branch: repo.branch,
    // nixpacks auto-detects Node/Python/PHP/etc; a repo with a Dockerfile can
    // be flipped to build_pack "dockerfile" from the Coolify UI by staff.
    build_pack: "nixpacks",
    ports_exposes: String(job.app_port || process.env.COOLIFY_DEFAULT_APP_PORT || 3000),
    // Deployment is triggered + awaited explicitly in finalizeApp — a job is
    // only ever reported active once Coolify says the build FINISHED.
    instant_deploy: false,
    // CONFIRMED live against Coolify 4.1.2 (2026-08-12): unlike the services
    // endpoint (which rejects ALL limit fields), /api/v1/applications/public
    // DOES accept limits_memory and limits_cpus — but 422s on exactly four
    // others: limits_pids, cap_drop, security_opt, storage_opt ("This field
    // is not allowed."). Sending them made every BYOA job fail before the
    // repo was ever cloned. Verified: dropping just those four returns 201.
    //
    // So pids/cap-drop/no-new-privileges/disk are NOT enforceable on this
    // lane at create time. That is a real hardening gap for git-built
    // customer apps versus the compose-based service lane — deliberately
    // left visible here rather than silently dropped; see the P5.0 note on
    // provision() for what the service lane manages to enforce.
    limits_memory: `${limits.ramMb}M`,
    limits_cpus: String(limits.cpus),
  };

  const res = await client.post("/api/v1/applications/public", payload);
  const data = res.data?.data || res.data || {};
  const uuid = data.uuid || data.id || name;

  return await finalizeApp(client, c, job, uuid, repo, opts, { recovered: false });
}

/**
 * @returns {Promise<{externalRef:string, access:object, log:string}>}
 * @throws on any API failure (the runner converts a throw into retry/escalate).
 */
const serviceStartPollMs = () => Math.max(2000, Number(process.env.COOLIFY_SERVICE_START_POLL_MS || 5000));
const serviceStartTimeoutMs = () =>
  Math.max(30000, Number(process.env.COOLIFY_SERVICE_START_TIMEOUT_MS || 120000));

/**
 * POST /api/v1/services only REGISTERS the compose stack — it does not start
 * it (confirmed live, 2026-08-12: the created container sat "Exited" with
 * "No such container" in the logs until a manual Deploy). This triggers the
 * start action and polls the service's own status field ("<state>:<health>",
 * e.g. "running:healthy") to a terminal state before the job is ever reported
 * active, mirroring the BYOA path's deployAndWait — a job must never be
 * marked active on resource creation alone.
 */
async function serviceStatus(client, uuid) {
  const res = await client.get(`/api/v1/services/${encodeURIComponent(uuid)}`);
  const d = res.data?.data || res.data || {};
  return String(d.status || "");
}

async function ensureServiceRunning(client, uuid, { sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  // NEVER call /start unconditionally — hit live, 2026-08-12: the
  // idempotency-recovery path called it on job PRV-USER-26-02-14-0002-00015's
  // resource, which was ALREADY running fine. Coolify restarted it, a poll
  // caught the transient "exited" mid-restart, and that got reported as a
  // PERMANENT failure — needlessly bounced a healthy container and killed a
  // job that had nothing wrong with it (confirmed still "Running (unknown)"
  // seconds later). Only trigger start when the resource isn't already up.
  const initial = await serviceStatus(client, uuid);
  if (initial.split(":")[0] === "running") return initial;

  await client.get(`/api/v1/services/${encodeURIComponent(uuid)}/start`);

  // Require TWO consecutive "running" reads, not one. A single sample isn't
  // enough — a crash-looping container (restart: unless-stopped) can be
  // caught mid-cycle between "restarting" and a fresh "running" the instant
  // it respawns; one lucky poll otherwise reports the job active while the
  // container keeps dying (hit live, 2026-08-12: cap_drop:ALL crash-looped
  // nginx and a single-read version of this check still marked the job
  // "active" during one of its brief up-flickers).
  const deadline = Date.now() + serviceStartTimeoutMs();
  let lastStatus = "";
  let consecutiveRunning = 0;
  let consecutiveExited = 0;
  while (Date.now() < deadline) {
    await wait(serviceStartPollMs());
    const res = await client.get(`/api/v1/services/${encodeURIComponent(uuid)}`);
    const d = res.data?.data || res.data || {};
    lastStatus = String(d.status || "");
    const state = lastStatus.split(":")[0];
    if (state === "running") {
      consecutiveRunning += 1;
      consecutiveExited = 0;
      if (consecutiveRunning >= 2) return lastStatus;
    } else if (state === "exited") {
      consecutiveRunning = 0;
      // Require TWO consecutive "exited" reads too, not one — the same
      // asymmetry that made "running" single-sample-unsafe applies here in
      // reverse. Live 2026-08-18: a job legitimately mid-restart (a healthy
      // container that briefly reports "exited" between the old process
      // dying and the new one starting) was caught on exactly one read and
      // permanently failed — the job went to needs_human and its
      // (perfectly fine, still-running-seconds-later) container was
      // abandoned. One exited sample proves nothing; two consecutive ones,
      // serviceStartPollMs apart, means it's actually not coming back.
      consecutiveExited += 1;
      if (consecutiveExited >= 2) {
        throw permanentError(`coolify: service failed to start (status=${lastStatus})`, { status: lastStatus });
      }
    } else {
      consecutiveRunning = 0;
      consecutiveExited = 0;
    }
  }
  throw new Error(
    `coolify: service still not running after ${Math.round(serviceStartTimeoutMs() / 1000)}s (status=${lastStatus})`
  );
}

/**
 * Attach the customer-facing hostname to a generic (non-BYOA) service —
 * the exact gap that left every Website Hosting order stuck on "URL
 * pending" forever: this lane created and started the container fine, but
 * never called attachDomain, so access.url was never set and the portal's
 * url_pending branch had nothing to ever resolve into. Best-effort by
 * design (mirrors finalizeApp's BYOA domains PATCH) — a rejected PATCH must
 * not fail the whole job; degrade to no link, same as an unconfigured
 * APP_DOMAIN_BASE, never a fabricated URL.
 *
 * CONFIRMED live against Coolify 4.1.2 (2026-08-17): `PATCH /api/v1/services/
 * {uuid}` with a top-level `domains` field 422s — "This field is not
 * allowed." (verified via ServicesController@update_by_uuid's own source at
 * the v4.1.2 tag: its $allowedFields list has no `domains`/`fqdn` key at
 * all). This means EVERY curated-app purchase before this fix — DocuSeal,
 * Invoice Ninja — silently got access.url="" forever; the 422 was caught
 * and logged, never surfaced. The real mechanism, confirmed live and
 * matching the same controller's `urls` handling (`applyServiceUrls()`,
 * which sets fqdn directly on the named sub-application and saves it): pass
 * `urls: [{ name: <compose service key>, url: fqdn }]`. `name` must be the
 * exact key from the compose YAML — the exposed/primary service
 * (`appConfig.primaryService` for multi-service apps; every single-service
 * curated app and the generic fallback both always name their one service
 * "app", so that's the default when no multi-service config applies).
 *
 * The PATCH alone only writes Coolify's database record — confirmed live
 * 2026-08-18 (recovering PRV-USER-26-08-18-0001-00029/00030, both stuck with
 * a running container and access.url set from an EARLIER successful PATCH):
 * the container's own labels and its on-disk docker-compose.yml had no
 * `traefik.*`/FQDN entries at all, and the URL 503'd. Coolify only bakes the
 * new fqdn into the container's Traefik labels when the service is next
 * restarted — the PATCH does not trigger that itself. Since every "existing"
 * and freshly-created service reaches this function already running (from
 * ensureServiceRunning, called before this), that restart is never implicit;
 * without it the URL this function returns — and that the job then reports
 * "active" with — has never actually routed. Confirmed the fix live: a
 * `/restart` call after the PATCH is what makes Traefik pick up the label
 * (verified both recovered URLs went 503 -> 200 only after this).
 */
async function attachServiceUrl(client, uuid, job, name) {
  const slug = appDomain.slugWithSuffix(name, job.name);
  const fqdn = appDomain.fqdnFor(slug);
  if (!fqdn) return "";
  const appConfig = CURATED_APP_CONFIG[job.service_id];
  const containerName = appConfig?.primaryService || "app";
  try {
    await client.patch(`/api/v1/services/${encodeURIComponent(uuid)}`, {
      urls: [{ name: containerName, url: fqdn }],
    });
  } catch (e) {
    console.warn(`[coolify] domains PATCH failed for ${name} (${fqdn}): ${e.message}`);
    return "";
  }
  // Best-effort, mirroring the PATCH above: the domain record is already
  // saved even if the restart itself fails or times out, so a customer never
  // loses the fqdn — worst case Traefik just doesn't route it until the next
  // restart from any other cause (e.g. a future redeploy).
  try {
    await client.get(`/api/v1/services/${encodeURIComponent(uuid)}/restart`);
    await waitForRunningAgain(client, uuid);
  } catch (e) {
    console.warn(`[coolify] restart-after-domain-attach failed for ${name} (${fqdn}): ${e.message}`);
  }
  return fqdn;
}

/**
 * After triggering a restart, wait for the service to come back to
 * "running" (same two-consecutive-reads tolerance as ensureServiceRunning)
 * before returning — so attachServiceUrl doesn't hand back a URL for a
 * container that's still mid-restart. Purely best-effort: never throws,
 * since the caller already degrades gracefully on any failure here.
 */
async function waitForRunningAgain(client, uuid, { sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + serviceStartTimeoutMs();
  let consecutiveRunning = 0;
  while (Date.now() < deadline) {
    await wait(serviceStartPollMs());
    const status = await serviceStatus(client, uuid);
    if (status.split(":")[0] === "running") {
      consecutiveRunning += 1;
      if (consecutiveRunning >= 2) return;
    } else {
      consecutiveRunning = 0;
    }
  }
}

/**
 * Per-engine deploy config for the four database catalog products. Deliberately
 * a small, purpose-built table here — NOT a generic catalog-wide "curated
 * app" schema. That generalization is real future work (the E-Signature/
 * ecosystem roadmap will need it) but building it now, under this bug fix,
 * would solve a bigger problem than the one in front of us.
 *
 * envVars/command are functions of the generated password so nothing here
 * ever hardcodes a shared secret.
 */
const DB_ENGINE_CONFIG = {
  "db-mysql": {
    engine: "mysql",
    image: "mysql:8",
    port: 3306,
    volumePath: "/var/lib/mysql",
    username: "root",
    database: "app",
    envVars: (password) => ({ MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: "app" }),
  },
  "db-postgres": {
    engine: "postgres",
    image: "postgres:16",
    port: 5432,
    volumePath: "/var/lib/postgresql/data",
    username: "postgres",
    database: "app",
    envVars: (password) => ({ POSTGRES_PASSWORD: password, POSTGRES_DB: "app" }),
  },
  "db-mongo": {
    engine: "mongo",
    image: "mongo:7",
    port: 27017,
    volumePath: "/data/db",
    username: "root",
    database: null,
    envVars: (password) => ({ MONGO_INITDB_ROOT_USERNAME: "root", MONGO_INITDB_ROOT_PASSWORD: password }),
  },
  "db-redis": {
    engine: "redis",
    image: "redis:7",
    port: 6379,
    volumePath: "/data",
    username: null,
    database: null,
    // The official redis image has no auth env var — --requirepass is the
    // only way to seed a password at startup.
    command: (password) => ["redis-server", "--requirepass", password],
  },
};

/** URL-safe (no YAML/shell quoting edge cases) — matches this codebase's existing crypto usage (s3Client.js). */
function generateRandomSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

/** Laravel's exact APP_KEY format (base64: + 32 raw random bytes) — no `artisan key:generate` needed. */
function generateLaravelAppKey() {
  return `base64:${crypto.randomBytes(32).toString("base64")}`;
}

/**
 * Pure — kept side-effect-free so it's unit-tested directly, same reasoning
 * as resourceLimits() above. Same hardening (cap_drop ALL + CHOWN/SETUID/
 * SETGID + no-new-privileges) as the generic app path: every official DB
 * image's entrypoint does the same "chown data dir as root, then drop to its
 * own user" dance nginx:alpine's does, verified live for.
 */
function buildDbComposeYaml(name, limits, dbConfig, password, externalPort) {
  const volumeName = `${name}-data`;
  const envLines = dbConfig.envVars
    ? Object.entries(dbConfig.envVars(password))
        .map(([k, v]) => `      ${k}: "${v}"\n`)
        .join("")
    : "";
  const commandLines = dbConfig.command
    ? `    command: ${JSON.stringify(dbConfig.command(password))}\n`
    : "";
  // Phase 2 only — phase 1 deliberately never published a host port (see the
  // long comment on the generic app path about port 80 colliding with
  // Coolify's own proxy). A unique per-customer port here doesn't collide
  // with anything, as long as the allocator guarantees uniqueness.
  const portsLines = externalPort
    ? `    ports:\n      - target: ${dbConfig.port}\n        published: ${externalPort}\n`
    : "";

  return (
    `services:\n` +
    `  app:\n` +
    `    image: ${dbConfig.image}\n` +
    `    restart: unless-stopped\n` +
    `    mem_limit: ${limits.ramMb}m\n` +
    `    cpus: ${limits.cpus}\n` +
    `    pids_limit: ${limits.pidsLimit}\n` +
    `    cap_drop:\n` +
    `      - ALL\n` +
    `    cap_add:\n` +
    `      - CHOWN\n` +
    `      - SETUID\n` +
    `      - SETGID\n` +
    `    security_opt:\n` +
    `      - no-new-privileges:true\n` +
    `    expose:\n` +
    `      - "${dbConfig.port}"\n` +
    portsLines +
    commandLines +
    (envLines ? `    environment:\n${envLines}` : "") +
    `    volumes:\n` +
    `      - ${volumeName}:${dbConfig.volumePath}\n` +
    `volumes:\n` +
    `  ${volumeName}:\n`
  );
}

/**
 * Invoice Ninja's own reference nginx config, verbatim from
 * invoiceninja/dockerfiles (debian/nginx/invoiceninja.conf +
 * debian/nginx/laravel.conf) — not simplified or guessed at. Embedded here
 * (rather than relied on as a bind-mounted file) because Coolify's
 * docker_compose_raw deploy has no mechanism for shipping extra files
 * alongside the compose YAML.
 *
 * NOTE: every `\.` below is written as `\\.` in this JS source — an
 * unescaped `\.` inside a template literal has its backslash silently
 * dropped by JS (producing an unrecognized-escape passthrough of just `.`),
 * which would corrupt the PHP-routing regex.
 */
const INVOICE_NINJA_NGINX_TUNING_CONF =
  "client_max_body_size 10M;\n" +
  "client_body_buffer_size 10M;\n" +
  "server_tokens off;\n" +
  "fastcgi_buffers 32 16K;\n" +
  "gzip on;\n" +
  "gzip_comp_level 2;\n" +
  "gzip_min_length 1M;\n" +
  "gzip_proxied any;\n" +
  "gzip_types *;\n";

const INVOICE_NINJA_NGINX_LARAVEL_CONF =
  "server {\n" +
  "    listen 80 default_server;\n" +
  "    server_name _;\n" +
  "    root /var/www/html/public;\n" +
  "\n" +
  "    add_header X-Frame-Options \"SAMEORIGIN\";\n" +
  "    add_header X-Content-Type-Options \"nosniff\";\n" +
  "\n" +
  "    index index.php;\n" +
  "\n" +
  "    charset utf-8;\n" +
  "\n" +
  "    location / {\n" +
  "        try_files $uri $uri/ /index.php?$query_string;\n" +
  "    }\n" +
  "\n" +
  "    location = /favicon.ico { access_log off; log_not_found off; }\n" +
  "    location = /robots.txt  { access_log off; log_not_found off; }\n" +
  "\n" +
  "    error_page 404 /index.php;\n" +
  "\n" +
  "    location ~ \\.php$ {\n" +
  "        fastcgi_pass app:9000;\n" +
  "        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;\n" +
  "        include fastcgi_params;\n" +
  "    }\n" +
  "\n" +
  "    location ~ /\\.(?!well-known).* {\n" +
  "        deny all;\n" +
  "    }\n" +
  "}\n";

/**
 * Curated third-party HTTP apps deployed through this lane — pre-built,
 * published images, not something built from a customer's repo (that's
 * provisionApp/BYOA) and not a raw database engine (that's DB_ENGINE_CONFIG,
 * which has no HTTP surface and deliberately skips domain attachment).
 *
 * Deliberately a SEPARATE table from DB_ENGINE_CONFIG, not merged — two data
 * points don't yet justify one shared abstraction. When a third curated app
 * is added, that's the point to unify both into one generic mechanism.
 */
const CURATED_APP_CONFIG = {
  "starter-esign": {
    image: "docuseal/docuseal:latest",
    port: 3000,
    volumePath: "/data",
    // Every customer's instance reuses Murzak's own platform SMTP relay —
    // same identity already used for password-reset/support-alert email.
    // DocuSeal cannot deliver signature invites without SOME SMTP config;
    // if SMTP_HOST is unset these come through blank and the app deploys
    // but can't send mail — surfaces via the runtime-logs panel, not
    // specially handled here (this lane deploys what's configured, same
    // posture as everywhere else in it).
    envVars: (fqdn, secretKeyBase) => ({
      HOST: fqdn,
      SECRET_KEY_BASE: secretKeyBase,
      SMTP_ADDRESS: process.env.SMTP_HOST || "",
      SMTP_PORT: process.env.SMTP_PORT || "587",
      SMTP_USERNAME: process.env.SMTP_USER || "",
      SMTP_PASSWORD: process.env.SMTP_PASS || "",
      SMTP_AUTHENTICATION: "plain",
      SMTP_FROM: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
    }),
  },
  "starter-invoicing": {
    primaryService: "nginx",
    primaryPort: 80,
    secrets: { dbPassword: "random", dbRootPassword: "random", appKey: "laravelAppKey" },
    services: {
      mysql: {
        image: "mysql:8",
        volumeName: "mysql-data",
        volumePath: "/var/lib/mysql",
        environment: (ctx) => ({
          MYSQL_DATABASE: "ninja",
          MYSQL_USER: "ninja",
          MYSQL_PASSWORD: ctx.dbPassword,
          MYSQL_ROOT_PASSWORD: ctx.dbRootPassword,
        }),
        healthcheck: (ctx) =>
          `      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uninja", "-p${ctx.dbPassword}"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 20\n`,
      },
      redis: {
        image: "redis:alpine",
        volumeName: "redis-data",
        volumePath: "/data",
        healthcheck: () =>
          `      test: ["CMD", "redis-cli", "ping"]\n` +
          `      interval: 5s\n` +
          `      timeout: 3s\n` +
          `      retries: 10\n`,
      },
      app: {
        image: "invoiceninja/invoiceninja-debian:latest",
        volumeName: "app-public",
        volumePath: "/var/www/html/public",
        extraVolumes: [{ name: "app-storage", path: "/var/www/html/storage" }],
        environment: (ctx) => ({
          APP_KEY: ctx.appKey,
          APP_URL: ctx.fqdn,
          DB_CONNECTION: "mysql",
          DB_HOST: "mysql",
          DB_DATABASE: "ninja",
          DB_USERNAME: "ninja",
          DB_PASSWORD: ctx.dbPassword,
          DB_PORT: "3306",
          REDIS_HOST: "redis",
          REQUIRE_HTTPS: "true",
          NINJA_ENVIRONMENT: "selfhost",
          MAIL_MAILER: "smtp",
          MAIL_HOST: process.env.SMTP_HOST || "",
          MAIL_PORT: process.env.SMTP_PORT || "587",
          MAIL_USERNAME: process.env.SMTP_USER || "",
          MAIL_PASSWORD: process.env.SMTP_PASS || "",
          MAIL_FROM_ADDRESS: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
        }),
        dependsOn: { mysql: "service_healthy", redis: "service_healthy" },
      },
      nginx: {
        image: "nginx:alpine",
        sharedVolumesFrom: "app", // mounts app's app-public/app-storage, read-only
        dependsOn: { app: "service_started" },
      },
    },
  },
  "starter-scheduling": {
    primaryService: "app",
    primaryPort: 3000,
    secrets: {
      dbPassword: "random",
      nextAuthSecret: "random",
      encryptionKey: "random",
      cronApiKey: "random",
    },
    services: {
      postgres: {
        image: "postgres:16",
        volumeName: "pg-data",
        volumePath: "/var/lib/postgresql/data",
        environment: (ctx) => ({
          POSTGRES_USER: "calcom",
          POSTGRES_PASSWORD: ctx.dbPassword,
          POSTGRES_DB: "calcom",
        }),
        healthcheck: () =>
          `      test: ["CMD-SHELL", "pg_isready -U calcom -d calcom"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 20\n`,
      },
      app: {
        image: "calcom/cal.com:latest",
        // Cal.com is stateless — all state lives in postgres, so no
        // volumeName is declared here (the compose builder only emits a
        // volumes: block for a service when volumeName is present).
        environment: (ctx) => {
          const host = ctx.fqdn.replace(/^https?:\/\//, "");
          return {
            DATABASE_URL: `postgresql://calcom:${ctx.dbPassword}@postgres:5432/calcom`,
            DATABASE_DIRECT_URL: `postgresql://calcom:${ctx.dbPassword}@postgres:5432/calcom`,
            DATABASE_HOST: "postgres:5432",
            NEXT_PUBLIC_WEBAPP_URL: ctx.fqdn,
            NEXT_PUBLIC_WEBSITE_URL: ctx.fqdn,
            NEXT_PUBLIC_EMBED_LIB_URL: `${ctx.fqdn}/embed/embed.js`,
            // Cal.com's middleware does JSON.parse(`[${ALLOWED_HOSTNAMES}]`) —
            // confirmed live (2026-08-17): a bare hostname here produced
            // `[diag-cal-test...]`, invalid JSON (unquoted token), and
            // crash-looped the app on every request. The value itself must
            // carry embedded double quotes so, once buildMultiServiceComposeYaml's
            // generic env-line template wraps it in YAML's own outer quotes,
            // the container actually receives `"host"` (literal quote chars).
            ALLOWED_HOSTNAMES: `\\"${host}\\"`,
            NEXTAUTH_URL: ctx.fqdn,
            NEXTAUTH_SECRET: ctx.nextAuthSecret,
            CALENDSO_ENCRYPTION_KEY: ctx.encryptionKey,
            CRON_API_KEY: ctx.cronApiKey,
            EMAIL_FROM: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
            EMAIL_FROM_NAME: "Murzak Scheduling",
            EMAIL_SERVER_HOST: process.env.SMTP_HOST || "",
            EMAIL_SERVER_PORT: process.env.SMTP_PORT || "587",
            EMAIL_SERVER_USER: process.env.SMTP_USER || "",
            EMAIL_SERVER_PASSWORD: process.env.SMTP_PASS || "",
          };
        },
        dependsOn: { postgres: "service_healthy" },
      },
    },
  },
};

/** Pure — same reasoning as buildDbComposeYaml: side-effect-free, unit-tested directly. */
function buildCuratedAppComposeYaml(name, limits, appConfig, fqdn, secretKeyBase) {
  if (appConfig.services) return buildMultiServiceComposeYaml(name, limits, appConfig, fqdn);
  const volumeName = `${name}-data`;
  const envLines = Object.entries(appConfig.envVars(fqdn, secretKeyBase))
    .map(([k, v]) => `      ${k}: "${v}"\n`)
    .join("");

  return (
    `services:\n` +
    `  app:\n` +
    `    image: ${appConfig.image}\n` +
    `    restart: unless-stopped\n` +
    `    mem_limit: ${limits.ramMb}m\n` +
    `    cpus: ${limits.cpus}\n` +
    `    pids_limit: ${limits.pidsLimit}\n` +
    `    cap_drop:\n` +
    `      - ALL\n` +
    `    cap_add:\n` +
    `      - CHOWN\n` +
    `      - SETUID\n` +
    `      - SETGID\n` +
    `    security_opt:\n` +
    `      - no-new-privileges:true\n` +
    `    expose:\n` +
    `      - "${appConfig.port}"\n` +
    `    environment:\n${envLines}` +
    `    volumes:\n` +
    `      - ${volumeName}:${appConfig.volumePath}\n` +
    `volumes:\n` +
    `  ${volumeName}:\n`
  );
}

/**
 * Shared hardening block, identical to every other service this lane builds
 * (see buildDbComposeYaml/buildCuratedAppComposeYaml) — every container gets
 * cap_drop ALL + CHOWN/SETUID/SETGID + no-new-privileges, not just the
 * primary/public-facing one. A database container run as root during its own
 * init is exactly the same category of risk this hardening exists for.
 */
function hardeningBlock(limits) {
  return (
    `    restart: unless-stopped\n` +
    `    mem_limit: ${limits.ramMb}m\n` +
    `    cpus: ${limits.cpus}\n` +
    `    pids_limit: ${limits.pidsLimit}\n` +
    `    cap_drop:\n` +
    `      - ALL\n` +
    `    cap_add:\n` +
    `      - CHOWN\n` +
    `      - SETUID\n` +
    `      - SETGID\n` +
    `    security_opt:\n` +
    `      - no-new-privileges:true\n`
  );
}

/**
 * Maps a declared secret "kind" (from an app config's `secrets` field) to the
 * generator that produces it. `laravelAppKey` exists only because Invoice
 * Ninja needs that exact format; every other curated app just needs a plain
 * random secret.
 */
const SECRET_GENERATORS = {
  random: generateRandomSecret,
  laravelAppKey: generateLaravelAppKey,
};

/**
 * Builds the per-provision secret ctx from an app config's declared `secrets`
 * map (e.g. `{ dbPassword: "random", appKey: "laravelAppKey" }`), instead of
 * hardcoding one app's specific secret set into buildMultiServiceComposeYaml.
 * A second real multi-service app with a different secret shape (Cal.com:
 * plain random secrets, no Laravel key at all) is what triggered this
 * generalization — see the design doc.
 */
function buildSecretCtx(appConfig, fqdn) {
  const ctx = { fqdn };
  for (const [key, kind] of Object.entries(appConfig.secrets || {})) {
    ctx[key] = SECRET_GENERATORS[kind]();
  }
  return ctx;
}

/**
 * Multi-service curated apps (app + a real backing database, unlike
 * DocuSeal's SQLite default). First consumer: starter-invoicing (Invoice
 * Ninja). RAM/CPU limits apply per-container, not summed across the stack —
 * a known, accepted looseness (see the design doc), not silently ignored.
 */
function buildMultiServiceComposeYaml(name, limits, appConfig, fqdn) {
  const ctx = buildSecretCtx(appConfig, fqdn);

  const volumeDecls = [];
  let serviceBlocks = "";

  for (const [serviceName, svc] of Object.entries(appConfig.services)) {
    const envEntries = svc.environment ? svc.environment(ctx) : null;
    const envLines = envEntries
      ? `    environment:\n` +
        Object.entries(envEntries).map(([k, v]) => `      ${k}: "${v}"\n`).join("")
      : "";

    let volumeLines = "";
    if (svc.sharedVolumesFrom) {
      // nginx: mounts the app service's volumes read-only, no volume of its own.
      const shared = appConfig.services[svc.sharedVolumesFrom];
      const allShared = [
        { name: shared.volumeName, path: shared.volumePath },
        ...(shared.extraVolumes || []),
      ];
      volumeLines =
        `    volumes:\n` +
        allShared.map((v) => `      - ${name}-${v.name}:${v.path}:ro\n`).join("");
    } else if (svc.volumeName) {
      const allVolumes = [{ name: svc.volumeName, path: svc.volumePath }, ...(svc.extraVolumes || [])];
      volumeLines =
        `    volumes:\n` +
        allVolumes.map((v) => `      - ${name}-${v.name}:${v.path}\n`).join("");
      for (const v of allVolumes) volumeDecls.push(`${name}-${v.name}`);
    }

    const exposeLines =
      serviceName === appConfig.primaryService
        ? `    expose:\n      - "${appConfig.primaryPort}"\n`
        : "";

    const dependsLines = svc.dependsOn
      ? `    depends_on:\n` +
        Object.entries(svc.dependsOn)
          .map(([dep, cond]) => `      ${dep}:\n        condition: ${cond}\n`)
          .join("")
      : "";

    const healthLines = svc.healthcheck
      ? `    healthcheck:\n${svc.healthcheck(ctx)}`
      : "";

    let commandLines = "";
    if (serviceName === "nginx") {
      commandLines =
        `    command:\n` +
        `      - sh\n` +
        `      - -c\n` +
        `      - |\n` +
        `        cat > /etc/nginx/conf.d/laravel.conf << 'NGINXEOF'\n` +
        INVOICE_NINJA_NGINX_LARAVEL_CONF.split("\n").map((l) => `        ${l}`).join("\n") +
        `        NGINXEOF\n` +
        `        cat > /etc/nginx/conf.d/invoiceninja.conf << 'NGINXEOF2'\n` +
        INVOICE_NINJA_NGINX_TUNING_CONF.split("\n").map((l) => `        ${l}`).join("\n") +
        `        NGINXEOF2\n` +
        `        exec nginx -g 'daemon off;'\n`;
    }

    serviceBlocks +=
      `  ${serviceName}:\n` +
      `    image: ${svc.image}\n` +
      hardeningBlock(limits) +
      commandLines +
      envLines +
      volumeLines +
      exposeLines +
      dependsLines +
      healthLines;
  }

  return (
    `services:\n` +
    serviceBlocks +
    `volumes:\n` +
    volumeDecls.map((v) => `  ${v}:\n`).join("")
  );
}

async function provision(job, opts) {
  // BYOA jobs (repo_url attached at enqueue) build from the customer's git
  // repo as an application; everything else stays the generic service path.
  if (job?.repo_url) return provisionApp(job, opts);

  const c = cfg(opts);
  const client = http(opts);
  const name = resourceName(job);

  // 1. Idempotency Check: does it already exist?
  // If the runner crashed after creation but before Frappe update, we must recover.
  // Recovery goes through the SAME ensureServiceRunning as a fresh create — a
  // job found "existing" but never started must not be reported active either.
  // ONLY the list call is wrapped. Everything after "existing found" must
  // propagate: the previous version wrapped the recovery block too, so a
  // retryable timeout inside ensureServiceRunning (a slow-starting container)
  // was swallowed and execution fell straight through to the create below —
  // manufacturing yet another duplicate on every retry.
  let existing;
  try {
    const listRes = await client.get("/api/v1/services");
    // Accept BOTH envelope shapes. Coolify answers some list endpoints with a
    // bare array rather than {data:[...]}; without the `|| listRes.data`
    // fallback this expression silently became [], .find() returned undefined,
    // and the check concluded "doesn't exist" — so every runner retry POSTed
    // another container. That is exactly what produced 12 redundant running
    // services on the live box (audited 2026-08-15: four copies each of two
    // web-hosting tenants, three each of three more). provisionApp's matching
    // check has always carried this fallback, which is why APPLICATIONS had
    // zero duplicates while services multiplied. Never narrow this again.
    existing = (listRes.data?.data || listRes.data || []).find?.((s) => s.name === name);
  } catch (e) {
    // A list we cannot read is NOT evidence of absence. Creating here is how a
    // transient Coolify blip turns into a permanent orphan; throw retryable so
    // the runner backs off and re-checks instead.
    throw new Error(
      `coolify: could not list services to check for an existing "${name}" — refusing to create blind (${e.message})`
    );
  }

  if (existing) {
    const uuid = existing.uuid || existing.id || name;
    const status = await ensureServiceRunning(client, uuid);
    const url = await attachServiceUrl(client, uuid, job, name);
    return {
      externalRef: String(uuid),
      access: {
        lane: "coolify",
        target: opts?.target?.id || "box-1",
        resource: name,
        url,
        manageUrl: c.baseUrl.replace(/\/+$/, ""),
        uuid: String(uuid),
      },
      log: `coolify: recovered existing service "${name}" (uuid=${uuid}, status=${status}) url=${url || "(pending)"} on ${opts?.target?.id || "box-1"}`,
    };
  }

  const limits = resourceLimits(job);
  const dbConfig = DB_ENGINE_CONFIG[job.service_id];
  const curatedAppConfig = CURATED_APP_CONFIG[job.service_id];

  // Refuse to silently ship an empty nginx:alpine container as a stand-in for
  // a product that has no real delivery mechanism. Before this, ANY volume-
  // class service with no db/curated-app config reached the generic fallback
  // below and built successfully -- so starter-db-light/starter-db-mongo (no
  // engine wired), addon-waf/addon-malware (no firewall or scanner behind
  // them at all), addon-cdn/addon-ssl-premium/addon-dedicated-ip/
  // addon-backup-plus/addon-staging (edge-proxy or provider-level features,
  // not containers) all billed the customer for infrastructure that was never
  // provisioned. "Website Hosting" and "App Hosting" are the one legitimate
  // case -- nginx (or the customer's own image, handled earlier via BYOA's
  // repo_url branch) is a real product there.
  if (!dbConfig && !curatedAppConfig) {
    const DELIVERABLE_VIA_GENERIC_CONTAINER = new Set(["Website Hosting", "App Hosting"]);
    if (!DELIVERABLE_VIA_GENERIC_CONTAINER.has(job.category)) {
      throw permanentError(
        `coolify: ${job.service_id} has no database engine, curated app, or generic-container ` +
        `delivery path configured -- refusing to bill for an empty placeholder container. ` +
        `A human must provision this manually or the catalog entry must be removed.`,
        { code: "NO_DELIVERY_MECHANISM" }
      );
    }
  }

  // P5.0 container hardening. Every tenant on the shared box gets bounded on
  // ALL four axes (memory/cpu/pids/disk), not just memory, plus capability
  // drop + no-new-privileges. This protects co-tenants from a runaway app
  // today, and is a hard prerequisite for the Phase 5 shell (a jailed shell
  // is only as safe as the container it execs into).
  //
  // CONFIRMED live against Coolify 4.1.2 (2026-08-12): POST /api/v1/services
  // does NOT accept limits_memory/limits_cpus/limits_pids/cap_drop/
  // security_opt/storage_opt as top-level fields at all ("This field is not
  // allowed.") — it 422s on every one of them. The endpoint only accepts a
  // predefined one-click `type`, or a custom `docker_compose_raw` (base64-
  // encoded compose YAML; plain-text 422s with "should be base64 encoded").
  // All resource bounds must instead live INSIDE the compose service
  // definition, which plain (non-swarm) `docker compose` — what Coolify runs
  // here — honors directly via mem_limit/cpus/pids_limit/cap_drop/
  // security_opt. Verified end-to-end: this exact shape returns 201 and the
  // service is created (smoke-tested then deleted: diag-test-delete-me-3).
  //
  // NO host port publish. A first live start attempt (job PRV-USER-26-02-14-
  // 0002-00015, 2026-08-12) with `ports: [{target:80, published:80}]` failed
  // with "failed to bind host port 0.0.0.0:80/tcp: address already in use" —
  // Coolify's own proxy already owns 80/443 on the shared box. Every tenant
  // publishing the same host port was never going to work on a multi-tenant
  // instance; Coolify's proxy discovers containers over the internal Docker
  // network and routes by attached domain (see finalizeApp's domains PATCH
  // for the BYOA path), so the container just needs to expose the port, not
  // bind it on the host.
  //
  // cap_add CHOWN/SETUID/SETGID: a second live attempt (same job, still
  // 2026-08-12) with bare `cap_drop: ALL` crash-looped —
  // nginx:alpine's entrypoint runs as root to `chown` its cache dirs then
  // drops to the "nginx" user via setuid()/setgid(), and with every
  // capability dropped that chown() itself failed ("Operation not
  // permitted"), so the container never got past startup. Adding back just
  // these three keeps everything else (NET_ADMIN, SYS_ADMIN, etc.) dropped —
  // still far tighter than the container's default capability set.
  const dbPassword = dbConfig ? generateRandomSecret() : null;
  // Computed BEFORE creation — slugWithSuffix/fqdnFor are pure functions of
  // name/job.name, not of the Coolify-assigned uuid, so the same fqdn this
  // seeds into HOST is what attachServiceUrl (below, after creation) PATCHes
  // onto the service. No chicken-and-egg: both derive the identical value.
  const curatedAppFqdn = curatedAppConfig
    ? appDomain.fqdnFor(appDomain.slugWithSuffix(name, job.name))
    : null;
  const curatedAppSecret = curatedAppConfig ? generateRandomSecret() : null;
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword, Number(job.external_port) > 0 ? Number(job.external_port) : null)
    : curatedAppConfig
    ? buildCuratedAppComposeYaml(name, limits, curatedAppConfig, curatedAppFqdn, curatedAppSecret)
    : `services:\n` +
      `  app:\n` +
      `    image: ${job.docker_image || "nginx:alpine"}\n` +
      `    restart: unless-stopped\n` +
      `    mem_limit: ${limits.ramMb}m\n` +
      `    cpus: ${limits.cpus}\n` +
      `    pids_limit: ${limits.pidsLimit}\n` +
      `    cap_drop:\n` +
      `      - ALL\n` +
      `    cap_add:\n` +
      `      - CHOWN\n` +
      `      - SETUID\n` +
      `      - SETGID\n` +
      `    security_opt:\n` +
      `      - no-new-privileges:true\n` +
      `    expose:\n` +
      `      - "80"\n`;

  const payload = {
    project_uuid: c.project,
    server_uuid: c.server,
    environment_name: c.env,
    name,
    docker_compose_raw: Buffer.from(composeYaml).toString("base64"),
  };

  const res = await client.post("/api/v1/services", payload);
  const data = res.data?.data || res.data || {};
  const uuid = data.uuid || data.id || name;

  // Creation only registers the compose stack (see ensureServiceRunning) — it
  // must actually be running before this job is ever reported active.
  const status = await ensureServiceRunning(client, uuid);
  // A database is not an HTTP app — attaching a domain would try to route SQL
  // traffic through Coolify's HTTP reverse proxy, which makes no sense. Real
  // external ("remote") access is phase 2 (see the design doc); skip entirely
  // for now.
  const url = dbConfig ? "" : await attachServiceUrl(client, uuid, job, name);

  return {
    externalRef: String(uuid),
    access: {
      lane: "coolify",
      target: opts?.target?.id || "box-1",
      resource: name,
      url,
      manageUrl: c.baseUrl.replace(/\/+$/, ""),
      uuid: String(uuid),
      ...(dbConfig
        ? {
            engine: dbConfig.engine,
            // Phase 2: when both a public host is configured AND this job has
            // an allocated external port, report the REAL externally-reachable
            // coordinates. Otherwise fall back to phase 1's honest best-effort
            // guess (the internal Docker resource name / container port) —
            // never silently blank, and never a fabricated public endpoint for
            // a job that was never actually given one.
            host: (process.env.DB_PUBLIC_HOST && Number(job.external_port) > 0) ? process.env.DB_PUBLIC_HOST : name,
            port: Number(job.external_port) > 0 ? Number(job.external_port) : dbConfig.port,
            database: dbConfig.database,
            username: dbConfig.username,
            password: dbPassword,
          }
        : {}),
    },
    // NOTE: disk is intentionally absent — Coolify's /api/v1/services has no
    // disk-quota field (storage_opt 422s), so limits.diskGb is a billing/
    // catalog figure only, not an enforced container bound on this lane.
    // NOTE: dbPassword is intentionally never interpolated into this log
    // string — it lives only in `access`, which the connection-details route
    // (not the build log) is the sole path back to the customer.
    log: `coolify: created service "${name}" (uuid=${uuid}, status=${status})${dbConfig ? ` engine=${dbConfig.engine}` : ` url=${url || "(pending)"}`} mem=${limits.ramMb}M cpus=${limits.cpus} pids=${limits.pidsLimit} caps=drop-all on ${opts?.target?.id || "box-1"}`,
  };
}

/**
 * Customer-initiated lifecycle actions against an already-provisioned service.
 *
 * ⚠️ UNVERIFIED AGAINST A LIVE INSTANCE. Coolify's create endpoint
 * (POST /api/v1/services) is the only call this lane has ever actually
 * exercised. These three paths are Coolify v4's documented per-resource
 * action routes (GET, not POST — a known quirk of Coolify's API), but must
 * be smoke-tested against the real instance (routes/portalRoutes.js action
 * endpoints, from the deployed app — this can't be verified from a dev
 * machine, same VPS-IP restriction as everything else in this lane) before
 * trusting them in front of real customer buttons. If the path is wrong,
 * this throws (axios 404/network error) and the caller must treat that as
 * a real failure — never swallow it into a fake success.
 */
// Coolify v4 splits per-resource routes: git-sourced APPLICATIONS live under
// /api/v1/applications/{uuid}/..., composed SERVICES under /api/v1/services/.
// Callers pass opts.kind ("application" | anything else = service), read from
// the job's access JSON (access.kind is written by provision/provisionApp).
function pathRoot(opts) {
  return opts?.kind === "application" ? "applications" : "services";
}

async function resourceAction(externalRef, action, opts) {
  const client = http(opts);
  const res = await client.get(
    `/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}/${action}`
  );
  return res.data;
}

/**
 * Raw list of live resources — admin orphan-reconciliation only (never used
 * by provision()/provisionApp(), which do their own idempotency list-and-match
 * inline). Same envelope shape as that idempotency check: `res.data.data`,
 * items carry `uuid` (fallback `id`) and `name`.
 */
async function listApplications(opts) {
  const client = http(opts);
  const res = await client.get("/api/v1/applications");
  return (res.data?.data || res.data || [])
    .map((a) => ({ uuid: String(a.uuid || a.id || "").trim(), name: a.name || "" }))
    .filter((a) => a.uuid);
}

async function listServices(opts) {
  const client = http(opts);
  const res = await client.get("/api/v1/services");
  return (res.data?.data || res.data || [])
    .map((s) => ({ uuid: String(s.uuid || s.id || "").trim(), name: s.name || "" }))
    .filter((s) => s.uuid);
}

function restart(externalRef, opts) {
  return resourceAction(externalRef, "restart", opts);
}
function stop(externalRef, opts) {
  return resourceAction(externalRef, "stop", opts);
}
function start(externalRef, opts) {
  return resourceAction(externalRef, "start", opts);
}

/**
 * Real resource usage for an already-provisioned service.
 *
 * ⚠️ UNVERIFIED FIELD NAMES. `GET /api/v1/services/{uuid}` is a real,
 * previously-exercised endpoint (provision()'s idempotency check uses the
 * list form of it), but whether — and under what field names — it returns
 * CPU/RAM/disk usage is unconfirmed; Coolify may not expose runtime resource
 * stats via this endpoint at all. Every field below is read defensively
 * (`?? null`) and the caller must treat `null` as "not available," never
 * substitute a fabricated number. This is the one Phase 3 asked to keep
 * honest rather than guess — see ResourceUtilizationCard's Phase 1 fallback.
 */
async function getUsage(externalRef, opts) {
  const client = http(opts);
  const res = await client.get(`/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}`);
  const d = res.data?.data || res.data || {};
  return {
    cpuPercent: d.cpu_usage_percent ?? d.cpu_percent ?? null,
    ramUsedMb: d.memory_usage_mb ?? d.ram_used_mb ?? null,
    ramLimitMb: d.memory_limit_mb ?? d.ram_limit_mb ?? null,
    diskUsedGb: d.disk_usage_gb ?? null,
    diskLimitGb: d.disk_limit_gb ?? null,
  };
}

/**
 * Attach a customer-owned domain to an already-provisioned service. Coolify
 * auto-issues Let's Encrypt SSL for any domain that resolves to the box —
 * this lane never touches DNS itself (the caller is responsible for
 * confirming the domain already points here before calling this).
 *
 * ⚠️ UNVERIFIED FIELD NAME/METHOD. Coolify v4 services carry an `fqdn`/
 * `domains` field; PATCHing it is the documented way to attach a domain, but
 * the exact field name and whether it accepts a bare domain vs. a full URL
 * is unconfirmed against this live instance. Smoke-test before trusting.
 */
async function attachDomain(externalRef, domain, opts) {
  const client = http(opts);
  const res = await client.patch(
    `/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}`,
    { domains: domain }
  );
  return res.data;
}

/* ------------------------------------------------------------------------ *
 * RESOURCE ADMIN — environment variables, runtime logs, teardown.
 *
 * These back the customer-facing resource-admin panel (approved accounts only,
 * see services/resourceAdminEligibility.js). Unlike the action routes above,
 * these paths ARE documented for Coolify v4 in both the applications and the
 * services namespace — except getLogs, which exists ONLY for applications.
 *
 * ⚠️ Still unexercised against this instance: the Coolify API is IP-allowlisted
 * to the VPS, so none of this can be verified from a dev machine (a probe from
 * anywhere else returns 403 "You are not allowed to access the API"). Run
 * scripts/coolify-smoke.js ON THE BOX before putting these behind a customer
 * button — every recent lane bug came from skipping exactly that step.
 * ------------------------------------------------------------------------ */

/**
 * Environment variables for an already-provisioned resource.
 *
 * NOTE: `value` is a customer SECRET. Nothing in this lane logs it, and
 * callers must not either — audit trails record the key name and the action,
 * never the value. Coolify echoes `is_shown_once` for write-only secrets; the
 * route layer is responsible for honouring it before sending anything to a
 * browser.
 */
async function listEnvs(externalRef, opts) {
  const client = http(opts);
  const res = await client.get(`/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}/envs`);
  const rows = res.data?.data || res.data || [];
  return (Array.isArray(rows) ? rows : []).map((e) => ({
    uuid: String(e.uuid || e.id || "").trim(),
    key: e.key || "",
    value: e.value ?? null,
    isBuildTime: !!(e.is_buildtime ?? e.is_build_time),
    isLiteral: !!e.is_literal,
    isMultiline: !!e.is_multiline,
    isShownOnce: !!e.is_shown_once,
  }));
}

async function createEnv(externalRef, { key, value, isBuildTime = false, isLiteral = false }, opts) {
  const client = http(opts);
  const res = await client.post(
    `/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}/envs`,
    { key, value, is_buildtime: !!isBuildTime, is_literal: !!isLiteral }
  );
  return res.data;
}

// Coolify v4 updates an env by PATCHing the collection with the key, not by
// addressing the env uuid in the path (the uuid form is DELETE-only).
async function updateEnv(externalRef, { key, value, isBuildTime = false, isLiteral = false }, opts) {
  const client = http(opts);
  const res = await client.patch(
    `/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}/envs`,
    { key, value, is_buildtime: !!isBuildTime, is_literal: !!isLiteral }
  );
  return res.data;
}

async function deleteEnv(externalRef, envUuid, opts) {
  const client = http(opts);
  const res = await client.delete(
    `/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}/envs/${encodeURIComponent(envUuid)}`
  );
  return res.data;
}

/**
 * Runtime container logs. APPLICATIONS ONLY — Coolify v4 exposes no equivalent
 * for composed services, so this throws permanently rather than returning an
 * empty string a caller might render as "your service logged nothing."
 */
async function getLogs(externalRef, { lines = 200 } = {}, opts) {
  if (opts?.kind !== "application") {
    throw permanentError("coolify: runtime logs are only available for application-kind resources");
  }
  const n = clamp(Number(lines) || 200, 1, 1000);
  const client = http(opts);
  const res = await client.get(
    `/api/v1/applications/${encodeURIComponent(externalRef)}/logs?lines=${n}`
  );
  const d = res.data?.data || res.data || {};
  return { logs: typeof d.logs === "string" ? d.logs : "" };
}

/**
 * Destroy the resource. Irreversible, and the ONLY thing in this codebase that
 * deletes live infrastructure — orphans.js deliberately only *reports*. The
 * caller must treat a throw as a hard abort and leave its own records intact:
 * dropping the owning record after a failed teardown is precisely how an
 * unreconcilable orphan is created.
 */
async function destroy(externalRef, opts) {
  const client = http(opts);
  const res = await client.delete(`/api/v1/${pathRoot(opts)}/${encodeURIComponent(externalRef)}`);
  return res.data;
}

module.exports = {
  lane: "coolify",
  isConfigured,
  configError,
  provision,
  provisionApp,
  parseRepoRef,
  restart,
  stop,
  start,
  listApplications,
  listServices,
  getUsage,
  attachDomain,
  resourceName,
  resourceLimits,
  generateRandomSecret,
  generateLaravelAppKey,
  buildCuratedAppComposeYaml,
  buildMultiServiceComposeYaml,
  __test_invoiceNinjaConfig: CURATED_APP_CONFIG["starter-invoicing"],
  __test_calcomConfig: CURATED_APP_CONFIG["starter-scheduling"],
  buildDbComposeYaml,
  // Build-wait plumbing (exported for unit tests + the smoke probe).
  classifyDeploymentStatus,
  extractLogTail,
  deployAndWait,
  finalizeApp,
  fetchAppUrl,
  // Deployment history / redeploy (Milestone 2 dashboard).
  normalizeDeployment,
  getDeployment,
  redeploy,
  // Resource admin (env vars / runtime logs / teardown).
  listEnvs,
  createEnv,
  updateEnv,
  deleteEnv,
  getLogs,
  destroy,
};
