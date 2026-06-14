/**
 * Off-site backups — Phase 2.
 *
 * Every new tenant should get a backup target that is NOT the same NVMe as its
 * data (a disk failure must not take both). At create-time the runner calls
 * registerBackup() once a service is active.
 *
 * Configured via BACKUP_PROVIDER (e.g. "b2", "spaces", "restic"). The actual
 * wiring is a single command — BACKUP_CONFIG_CMD — an idempotent script that
 * receives the tenant context as env vars and sets up the off-site job. If no
 * provider is configured, backups are recorded as "skipped" (no silent gap —
 * the job row shows it), not faked.
 *
 * Best-effort: never throws into the provisioning path.
 */

const { execFile } = require("child_process");

function provider() {
  return (process.env.BACKUP_PROVIDER || "").trim();
}

function isConfigured() {
  return !!provider() && !!process.env.BACKUP_CONFIG_CMD;
}

function runConfigCmd(ctx) {
  return new Promise((resolve) => {
    const cmd = process.env.BACKUP_CONFIG_CMD;
    const env = {
      ...process.env,
      BACKUP_PROVIDER: provider(),
      TENANT_SERVICE_ID: String(ctx.service_id || ""),
      TENANT_WEB_ACCOUNT: String(ctx.web_account || ""),
      TENANT_TARGET: String(ctx.target || ""),
      TENANT_EXTERNAL_REF: String(ctx.external_ref || ""),
    };
    execFile(
      cmd,
      [],
      { env, timeout: Number(process.env.BACKUP_CONFIG_TIMEOUT_MS || 120000), maxBuffer: 1024 * 1024 },
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
 * Register an off-site backup for a freshly-provisioned tenant.
 * @returns {Promise<{status:'configured'|'skipped'|'failed', detail?:string}>}
 */
async function registerBackup(ctx) {
  if (!isConfigured()) {
    return { status: "skipped", detail: "no BACKUP_PROVIDER/BACKUP_CONFIG_CMD configured" };
  }
  const r = await runConfigCmd(ctx);
  if (r.ok) return { status: "configured", detail: `${provider()} backup configured` };
  return { status: "failed", detail: r.error };
}

module.exports = { provider, isConfigured, registerBackup };
