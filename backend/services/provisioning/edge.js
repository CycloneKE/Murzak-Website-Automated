/**
 * Per-tenant edge / WAF registration — Phase 2 gap fix.
 *
 * The architecture puts every tenant behind an edge (Cloudflare WAF/CDN) for
 * isolation and DDoS dampening. At create-time the runner calls registerEdge()
 * to wire the new tenant's hostname into the edge via EDGE_CONFIG_CMD — an
 * idempotent script that receives the tenant context as env vars (create the
 * DNS record + WAF policy + proxy).
 *
 * If no command is configured, the result is recorded as "skipped" on the job
 * (visible, not silently missing). Best-effort: never throws into provisioning.
 */

const { execFile } = require("child_process");

function isConfigured() {
  return !!process.env.EDGE_CONFIG_CMD;
}

function provider() {
  return (process.env.EDGE_PROVIDER || (isConfigured() ? "edge" : "")).trim();
}

function runConfigCmd(ctx) {
  return new Promise((resolve) => {
    const cmd = process.env.EDGE_CONFIG_CMD;
    const env = {
      ...process.env,
      EDGE_PROVIDER: provider(),
      TENANT_SERVICE_ID: String(ctx.service_id || ""),
      TENANT_WEB_ACCOUNT: String(ctx.web_account || ""),
      TENANT_TARGET: String(ctx.target || ""),
      TENANT_EXTERNAL_REF: String(ctx.external_ref || ""),
      TENANT_HOSTNAME: String(ctx.hostname || ""),
    };
    execFile(
      cmd,
      [],
      { env, timeout: Number(process.env.EDGE_CONFIG_TIMEOUT_MS || 120000), maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: `${err.message} ${String(stderr || "").slice(-300)}`.trim() });
        } else {
          resolve({ ok: true, log: String(stdout || "").slice(-1000) });
        }
      }
    );
  });
}

/**
 * @returns {Promise<{status:'configured'|'skipped'|'failed', detail?:string}>}
 */
async function registerEdge(ctx) {
  if (!isConfigured()) {
    return { status: "skipped", detail: "no EDGE_CONFIG_CMD configured" };
  }
  const r = await runConfigCmd(ctx);
  if (r.ok) return { status: "configured", detail: `${provider()} edge/WAF configured` };
  return { status: "failed", detail: r.error };
}

module.exports = { isConfigured, provider, registerEdge };
