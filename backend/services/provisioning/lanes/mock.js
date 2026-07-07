/**
 * Mock provisioning lane — simulates both Coolify and Bench builds.
 *
 * Enable with MOCK_PROVISIONING=true. When active, the runner substitutes this
 * adapter for both the coolify and bench lanes so the full state machine
 * (enqueue → claim → build → active, backup/edge hooks, capacity gate,
 * retries) exercises end-to-end against the real Frappe doctype without
 * touching any infrastructure.
 *
 * The mock introduces a configurable delay (MOCK_PROVISION_DELAY_MS, default
 * 1500) so timing-sensitive paths (backoff, concurrency) are realistic.
 *
 * To simulate transient failures set MOCK_PROVISION_FAIL_RATE to a float
 * 0-1 (default 0). A failed mock build throws so the runner's retry /
 * escalation logic is exercised exactly as in production.
 */

function isEnabled() {
  return String(process.env.MOCK_PROVISIONING || "false").toLowerCase() === "true";
}

function isConfigured() {
  return isEnabled();
}

function configError() {
  if (isConfigured()) return null;
  return "Mock lane not enabled (set MOCK_PROVISIONING=true)";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail() {
  const rate = parseFloat(process.env.MOCK_PROVISION_FAIL_RATE || "0");
  return rate > 0 && Math.random() < rate;
}

/** Safe, DNS-friendly resource name (mirrors coolify.js). */
function resourceName(job) {
  return `${job.web_account}-${job.service_id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Simulates a successful build. Returns the same shape as the real lanes so
 * the runner's post-build hooks (backup, edge, Web Account flip) run normally.
 */
async function provision(job, opts) {
  const waitMs = Number(process.env.MOCK_PROVISION_DELAY_MS || 1500);
  await delay(waitMs);

  if (shouldFail()) {
    throw new Error(
      `[mock] simulated transient failure for ${job.service_id} (MOCK_PROVISION_FAIL_RATE)`
    );
  }

  const name = resourceName(job);
  const lane = job.lane || "mock";
  const targetId = opts?.target?.id || "box-1";
  const uuid = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    externalRef: uuid,
    access: {
      lane: `mock-${lane}`,
      target: targetId,
      resource: name,
      uuid,
      url: `https://${name}.mock.murzaktech.com`,
      note: "Mock build — no real infrastructure was created.",
    },
    log: `[mock] simulated ${lane} build for "${name}" on ${targetId} (delay=${waitMs}ms, uuid=${uuid})`,
  };
}

module.exports = { lane: "mock", isEnabled, isConfigured, configError, provision, resourceName };
