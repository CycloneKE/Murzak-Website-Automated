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
 * @returns {Promise<{externalRef:string, access:object, log:string}>}
 * @throws on any API failure (the runner converts a throw into retry/escalate).
 */
async function provision(job, opts) {
  const c = cfg(opts);
  const client = http(opts);
  const name = resourceName(job);

  // 1. Idempotency Check: does it already exist?
  // If the runner crashed after creation but before Frappe update, we must recover.
  try {
    const listRes = await client.get("/api/v1/services");
    const existing = (listRes.data?.data || []).find((s) => s.name === name);
    if (existing) {
      const uuid = existing.uuid || existing.id || name;
      return {
        externalRef: String(uuid),
        access: {
          lane: "coolify",
          target: opts?.target?.id || "box-1",
          resource: name,
          manageUrl: c.baseUrl.replace(/\/+$/, ""),
          uuid: String(uuid),
        },
        log: `coolify: recovered existing service "${name}" (uuid=${uuid}) on ${opts?.target?.id || "box-1"}`,
      };
    }
  } catch (e) {
    // Ignore list errors and try to create; if it fails on POST we'll catch it there.
    console.warn(`[coolify] idempotency GET failed for ${name}: ${e.message}`);
  }

  const payload = {
    project_uuid: c.project,
    server_uuid: c.server,
    environment_name: c.env,
    name,
    // Hard memory limit so one tenant can't starve the shared box.
    limits_memory: `${job.ram_mb || 256}M`,
  };

  const res = await client.post("/api/v1/services", payload);
  const data = res.data?.data || res.data || {};
  const uuid = data.uuid || data.id || name;

  return {
    externalRef: String(uuid),
    access: {
      lane: "coolify",
      target: opts?.target?.id || "box-1",
      resource: name,
      manageUrl: c.baseUrl.replace(/\/+$/, ""),
      uuid: String(uuid),
    },
    log: `coolify: created service "${name}" (uuid=${uuid}) mem=${payload.limits_memory} on ${opts?.target?.id || "box-1"}`,
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
async function serviceAction(externalRef, action, opts) {
  const client = http(opts);
  const res = await client.get(`/api/v1/services/${encodeURIComponent(externalRef)}/${action}`);
  return res.data;
}

function restart(externalRef, opts) {
  return serviceAction(externalRef, "restart", opts);
}
function stop(externalRef, opts) {
  return serviceAction(externalRef, "stop", opts);
}
function start(externalRef, opts) {
  return serviceAction(externalRef, "start", opts);
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
  const res = await client.get(`/api/v1/services/${encodeURIComponent(externalRef)}`);
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
  const res = await client.patch(`/api/v1/services/${encodeURIComponent(externalRef)}`, {
    domains: domain,
  });
  return res.data;
}

module.exports = {
  lane: "coolify",
  isConfigured,
  configError,
  provision,
  restart,
  stop,
  start,
  getUsage,
  attachDomain,
  resourceName,
};
