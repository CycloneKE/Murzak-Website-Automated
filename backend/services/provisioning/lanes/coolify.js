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
const { CAPACITY } = require("../catalog");
const appDomain = require("../appDomain");

// Server-wide budget (from the generated catalog snapshot: KVM 4 = 4 vCPU /
// 12.8GB sellable). Used to derive a proportional CPU quota per container.
// Fallbacks match the box we sell today so this never divides by zero if the
// snapshot is missing a field.
const BOX_VCPU = Number(CAPACITY?.vcpu) > 0 ? Number(CAPACITY.vcpu) : 4;
const BOX_SELLABLE_RAM_MB = Number(CAPACITY?.sellableRamMb) > 0 ? Number(CAPACITY.sellableRamMb) : 12800;

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

  const rawCpus = (ramMb / BOX_SELLABLE_RAM_MB) * BOX_VCPU;
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
  try {
    const listRes = await client.get("/api/v1/applications");
    const existing = (listRes.data?.data || listRes.data || []).find?.((a) => a.name === name);
    if (existing) {
      const uuid = existing.uuid || existing.id || name;
      return await finalizeApp(client, c, job, uuid, repo, opts, { recovered: true });
    }
  } catch (e) {
    console.warn(`[coolify] app idempotency GET failed for ${name}: ${e.message}`);
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
    limits_memory: `${limits.ramMb}M`,
    limits_cpus: String(limits.cpus),
    limits_pids: limits.pidsLimit,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    ...(limits.diskGb > 0 ? { storage_opt: { size: `${limits.diskGb}G` } } : {}),
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
  while (Date.now() < deadline) {
    await wait(serviceStartPollMs());
    const res = await client.get(`/api/v1/services/${encodeURIComponent(uuid)}`);
    const d = res.data?.data || res.data || {};
    lastStatus = String(d.status || "");
    const state = lastStatus.split(":")[0];
    if (state === "running") {
      consecutiveRunning += 1;
      if (consecutiveRunning >= 2) return lastStatus;
    } else {
      consecutiveRunning = 0;
      if (state === "exited") {
        throw permanentError(`coolify: service failed to start (status=${lastStatus})`, { status: lastStatus });
      }
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
 */
async function attachServiceUrl(client, uuid, job, name) {
  const slug = appDomain.slugWithSuffix(name, job.name);
  const fqdn = appDomain.fqdnFor(slug);
  if (!fqdn) return "";
  try {
    await client.patch(`/api/v1/services/${encodeURIComponent(uuid)}`, { domains: fqdn });
  } catch (e) {
    console.warn(`[coolify] domains PATCH failed for ${name} (${fqdn}): ${e.message}`);
    return "";
  }
  return fqdn;
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
  try {
    const listRes = await client.get("/api/v1/services");
    const existing = (listRes.data?.data || []).find((s) => s.name === name);
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
  } catch (e) {
    if (e.permanent) throw e;
    // Ignore list errors and try to create; if it fails on POST we'll catch it there.
    console.warn(`[coolify] idempotency GET failed for ${name}: ${e.message}`);
  }

  const limits = resourceLimits(job);

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
  const composeYaml =
    `services:\n` +
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
    // NOTE: disk is intentionally absent — Coolify's /api/v1/services has no
    // disk-quota field (storage_opt 422s), so limits.diskGb is a billing/
    // catalog figure only, not an enforced container bound on this lane.
    log: `coolify: created service "${name}" (uuid=${uuid}, status=${status}) url=${url || "(pending)"} mem=${limits.ramMb}M cpus=${limits.cpus} pids=${limits.pidsLimit} caps=drop-all on ${opts?.target?.id || "box-1"}`,
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
  getUsage,
  attachDomain,
  resourceName,
  resourceLimits,
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
};
