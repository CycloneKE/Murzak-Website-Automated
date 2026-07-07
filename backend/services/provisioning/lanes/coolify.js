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

module.exports = { lane: "coolify", isConfigured, configError, provision, resourceName };
