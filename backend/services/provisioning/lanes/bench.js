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
 *
 * The script is told WHICH Frappe apps to install via JOB_BENCH_APPS — see
 * benchAppsFor() below.
 */

const { execFile } = require("child_process");
const { getServiceMeta } = require("../catalog");

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

function permanent(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

/**
 * Which Frappe apps this tenant's site needs, in install order.
 *
 * Read from the catalog snapshot at dispatch time rather than carried on the
 * Provisioning Job doctype. Both are defensible, but the doctype route is the
 * one with a live incident behind it: every field the runner claims must exist
 * on the INSTALLED doctype or Frappe 417s the whole GET and the runner goes
 * silently dead on every tick, for every job (see CLAIMABLE_JOB_FIELDS in
 * runner.js — that is exactly how repo_url/deployment_history killed
 * provisioning for two days in August). Reading it here needs no doctype
 * migration and cannot take the runner down. It also matches what
 * processJob() already does one frame up the stack: it re-derives `lane` and
 * `capacityClass` from getServiceMeta() at run time.
 *
 * The list is ORDERED — erpnext first, dependencies before dependents — so it
 * is passed through as a comma-separated string, not a set.
 */
function benchAppsFor(job) {
  const meta = getServiceMeta(job?.service_id);
  const apps = Array.isArray(meta?.benchApps) ? meta.benchApps.filter(Boolean) : [];
  return apps;
}

/**
 * A bench job with no declared app set is escalated, never built.
 *
 * laneFor() routes on capacityClass alone, so "premium" products that are not
 * Frappe products at all still land here — biz-db-medium (dedicated database
 * hosting) today, biz-webapps (generic web-app hosting) before it was
 * deprecated. Without this check the script would be handed a site to create
 * with no app list and would either fail confusingly or install a bare ERPNext
 * site for a customer who bought a database.
 *
 * The catalog comment on ServiceOption.benchApps has always promised this
 * behaviour ("leaving this undefined makes provisioning escalate rather than
 * build a meaningless ERPNext site") — until now nothing enforced it. Routing
 * by capacityClass is still too coarse; this makes the coarseness safe rather
 * than fixing it.
 *
 * Permanent (not retryable): a re-run cannot conjure an app list, so burning
 * three attempts and 30 minutes of backoff before a human sees it is pure
 * delay.
 */
function requireBenchApps(job) {
  const apps = benchAppsFor(job);
  if (apps.length) return apps;
  throw permanent(
    `bench: ${job?.service_id || "(no service id)"} declares no benchApps in the catalog, so there is ` +
      `nothing to install — refusing to build a bare Frappe site for it. Either this product does not ` +
      `belong on the bench lane (it is routed here by capacityClass "premium", which is coarser than the ` +
      `delivery model), or its catalog entry needs a benchApps list. Provision it by hand meanwhile.`
  );
}

/**
 * @returns {Promise<{externalRef:string, access:object, log:string}>}
 * @throws when the command exits non-zero (runner converts to retry/escalate).
 */
function provision(job, opts) {
  // Resolved BEFORE the promise so a missing app set rejects synchronously
  // with the permanent flag intact, rather than after a 10-minute exec.
  let apps;
  try {
    apps = requireBenchApps(job);
  } catch (e) {
    return Promise.reject(e);
  }

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
      // Comma-separated, install order preserved. The script must install
      // these in the order given (erpnext first, dependencies before
      // dependents) — see docs/frappe-bench-apps.md for the per-app traps,
      // notably that hrms needs a user-type limit set before it will install
      // and that every install needs a worker restart to stop the site 500ing.
      JOB_BENCH_APPS: apps.join(","),
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
          let reason = err.message;
          if (err.killed) {
            reason = `process timed out (killed by runner after ${process.env.BENCH_PROVISION_TIMEOUT_MS || 600000}ms)`;
          } else if (err.code === "ENOBUFS") {
            reason = "process output exceeded 4MB buffer limit (ENOBUFS)";
          }
          return reject(
            new Error(`bench provision failed: ${reason} ${String(stderr || "").slice(-500)}`.trim())
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

module.exports = {
  lane: "bench",
  isConfigured,
  configError,
  provision,
  // Exported for the test suite and for anyone writing the provisioning
  // script: this is the exact list the script will receive in JOB_BENCH_APPS.
  benchAppsFor,
};
