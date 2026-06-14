/**
 * Lane B — Frappe bench (ERP / POS / CRM / HR; the "premium" capacity class).
 *
 * Shells out to a configured provisioning command — an Ansible playbook or an
 * SSH wrapper that runs `bench new-site`, installs the app, sets DNS
 * multitenancy and restores any seed data. The command receives the job context
 * via environment variables and must:
 *   - be idempotent (safe to re-run for the same site), and
 *   - print a final JSON line like {"site":"acme.erp.murzak…","url":"…","admin":"…"}
 *     on success.
 *
 * Required env:
 *   BENCH_PROVISION_CMD   absolute path to the script/playbook wrapper to run
 * Optional:
 *   BENCH_PROVISION_TIMEOUT_MS (default 600000)
 */

const { execFile } = require("child_process");

function cmdFor(opts) {
  // Additional boxes carry their own benchCmd in PROVISIONING_TARGETS; box-1
  // uses the flat BENCH_PROVISION_CMD env.
  return opts?.target?.benchCmd || process.env.BENCH_PROVISION_CMD;
}

function isConfigured(opts) {
  return !!cmdFor(opts);
}

function configError(opts) {
  if (isConfigured(opts)) return null;
  const where = opts?.target?.id ? ` for target ${opts.target.id}` : "";
  return `Bench lane not configured${where} (missing: BENCH_PROVISION_CMD)`;
}

/**
 * @returns {Promise<{externalRef:string, access:object, log:string}>}
 * @throws when the command exits non-zero (runner converts to retry/escalate).
 */
function provision(job, opts) {
  return new Promise((resolve, reject) => {
    const cmd = cmdFor(opts);
    const env = {
      ...process.env,
      JOB_SERVICE_ID: String(job.service_id || ""),
      JOB_SERVICE_NAME: String(job.service_name || ""),
      JOB_WEB_ACCOUNT: String(job.web_account || ""),
      JOB_INVOICE: String(job.invoice || ""),
      JOB_RAM_MB: String(job.ram_mb || ""),
      JOB_DISK_GB: String(job.disk_gb || ""),
      JOB_TARGET: String(opts?.target?.id || "box-1"),
    };

    execFile(
      cmd,
      [],
      {
        env,
        timeout: Number(process.env.BENCH_PROVISION_TIMEOUT_MS || 600000),
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const out = String(stdout || "");
        if (err) {
          return reject(
            new Error(`bench provision failed: ${err.message} ${String(stderr || "").slice(-500)}`.trim())
          );
        }
        // The last JSON line is the machine-readable result; tolerate its absence.
        let access = { lane: "bench" };
        const lastLine = out.trim().split(/\r?\n/).filter(Boolean).pop();
        try {
          if (lastLine && lastLine.trim().startsWith("{")) {
            access = { lane: "bench", ...JSON.parse(lastLine) };
          }
        } catch {
          /* non-JSON tail — keep default access, full output is in the log */
        }
        const externalRef =
          access.site || `${job.web_account}-${job.service_id}`.toLowerCase();
        resolve({ externalRef: String(externalRef), access, log: out.slice(-4000) });
      }
    );
  });
}

module.exports = { lane: "bench", isConfigured, configError, provision };
