/**
 * Lane B — Frappe bench (ERP / POS / CRM / HR; the "premium" capacity class).
 *
 * Shells out to a configured provisioning command — an Ansible playbook or an
 * SSH wrapper that runs `bench new-site`, installs the app, sets DNS
 * multitenancy and restores any seed data. The command receives the job context
 * via environment variables and must:
 *   - be idempotent (safe to re-run for the same site), and
 *   - print a final JSON line like {"site":"acme.erp.murzak…","url":"…","admin":"…"}
 *     on success, and
 *   - signal retryability through its EXIT CODE (see below).
 *
 * Exit-code contract, as declared by deploy/vps/bin/murzak-bench-provision:
 *   0  success
 *   2  bad input / missing prerequisite — do NOT retry, escalate to a human
 *   1  operational failure — retryable
 *
 * Required env:
 *   BENCH_PROVISION_CMD   absolute path to the script/playbook wrapper to run
 * Optional:
 *   BENCH_PROVISION_TIMEOUT_MS (default 600000)
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

/**
 * Exit code the script uses for "bad input / missing prerequisite — do NOT
 * retry, escalate". Its refuse() helper exits with this for every condition a
 * re-run cannot change: a product with no benchApps declared, an app that
 * isn't on the bench yet, a missing JOB_WEB_ACCOUNT, a wildcard DNS record
 * that doesn't resolve.
 */
const EXIT_DO_NOT_RETRY = 2;

/**
 * "command not found" — what the SSH wrapper returns when the script is
 * missing on the VPS rather than in this container. A retry re-runs the same
 * missing path.
 */
const EXIT_COMMAND_NOT_FOUND = 127;

/**
 * Spawn-level failures: the command could not be executed at all. err.code is
 * a STRING for these, never the numeric exit code, so they can never match
 * EXIT_DO_NOT_RETRY however it is written. Every one is a deployment mistake
 * (BENCH_PROVISION_CMD pointing at a path that does not exist, or at a file
 * without the execute bit) and is strictly LESS fixable by retry than the
 * exit-2 refusals above — yet before this they consumed the full attempt
 * budget, which is the waste this lane's exit-code handling exists to stop.
 */
const UNFIXABLE_SPAWN_CODES = new Set(["ENOENT", "EACCES", "EPERM", "ENOTDIR", "EISDIR"]);

/** Node's maxBuffer overrun code, plus its pre-Node-12 spelling. */
const MAXBUFFER_CODES = new Set(["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "ENOBUFS"]);

/**
 * Hard cap on the verdict we splice into the error message.
 *
 * There must be one. runner.js truncates the job's `error` FIELD, but passes
 * the whole reason to createEscalationTicket() unbounded — which POSTs it into
 * a Frappe message and swallows any failure into a console.error, so an
 * oversized body means the customer is silently never told their build needs a
 * human. Measured before this cap: 400 bench progress frames produced a
 * 17,150-char message.
 */
const VERDICT_MAX_CHARS = 300;

/**
 * The script's VERDICT: its final non-empty stderr line, capped.
 *
 * Only the last line, deliberately. The script's refuse()/die() message is
 * always the last thing it writes, and runner.js truncates the job's error
 * field from the HEAD (`reason.slice(0, 500)`). Including preceding context
 * here pushes the verdict toward that cut — an earlier attempt kept the last
 * three lines in chronological order and still lost "REFUSED:" entirely once
 * two bench traceback lines ran 250 chars each. The surrounding build output
 * is not discarded; it rides along as logTail into job.log, which is where a
 * full log belongs. job.error answers "why", job.log answers "what happened".
 *
 * Splits on bare \r as well as \n: bench and Frappe redraw progress on one
 * line ("Updating DocTypes for erpnext: [====] 42%\r"), which /\r?\n/ does not
 * split at all, so hundreds of frames coalesce into a single enormous "line"
 * and carry raw control characters into the Frappe UI.
 */
function stderrVerdict(stderr) {
  const lines = String(stderr || "")
    .split(/\r\n|[\r\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] || "").slice(0, VERDICT_MAX_CHARS);
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
      // Which Frappe apps this product's site needs, comma-separated and in
      // install order. Resolved here rather than on the box so the catalogue
      // stays the single source of truth — shipping a second copy of the
      // snapshot to the VPS would drift the moment either side changed.
      // Empty for a product with no declared app set, which the script treats
      // as "escalate", not "install nothing" (see biz-webapps / biz-db-medium,
      // which reach this lane via capacityClass but are not Frappe products).
      JOB_BENCH_APPS: (getServiceMeta(String(job.service_id || ""))?.benchApps || []).join(","),
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
          // Deliberately NOT err.message: Node sets that to
          // "Command failed: <cmd>\n<all of stderr>", so using it both
          // duplicates stderr and pushes the script's verdict past the
          // runner's 500-char head truncation (see stderrVerdict above).
          let reason;
          let unfixable = false;
          if (err.killed) {
            reason = `process timed out (killed by runner after ${process.env.BENCH_PROVISION_TIMEOUT_MS || 600000}ms)`;
          } else if (MAXBUFFER_CODES.has(err.code)) {
            // Deterministic, not transient: the output volume is a property of
            // the script and the site, so every attempt overruns identically.
            // Node also kills the child mid-run, leaving a half-built site for
            // the next attempt to adopt. Same argument as the spawn codes.
            reason = `"${cmd}" produced more than the 4MB output buffer allows`;
            unfixable = true;
          } else if (UNFIXABLE_SPAWN_CODES.has(err.code)) {
            reason = `could not execute "${cmd}" (${err.code}) — check BENCH_PROVISION_CMD points at an executable file`;
            unfixable = true;
          } else if (err.code === EXIT_COMMAND_NOT_FOUND) {
            reason = `"${cmd}" exited 127 (command not found) — the script is likely missing on the target box, not in this container`;
            unfixable = true;
          } else {
            // Name the command and any signal. cmdFor() resolves per box
            // (opts.target.benchCmd for extra boxes), so without cmd a
            // multi-box fleet cannot tell which wrapper failed. And an
            // OOM-killed `bench new-site` — a first-class failure mode on a
            // box whose binding constraint is RAM — leaves code null with
            // killed false, which would otherwise read "exited with code
            // null" and never mention SIGKILL.
            reason =
              `"${cmd}" exited with code ${err.code}` +
              (err.signal ? ` (signal ${err.signal})` : "");
          }
          const verdict = stderrVerdict(stderr);
          const message = `bench provision failed: ${reason}${verdict ? ` — ${verdict}` : ""}`.trim();
          // The full stderr rides along as logTail, which runner.js writes
          // into the job's log field. Without it a failed bench job carried
          // no build log at all: the success path saves stdout, the failure
          // path saved nothing.
          const logTail = String(stderr || "").slice(-4000);
          // Honour the script's exit-code contract. Without this every refusal
          // is retryable, so a job the script has ALREADY said is unfixable —
          // biz-db-medium having no benchApps, an app not yet on the bench —
          // burns the full PROVISIONING_MAX_ATTEMPTS budget with exponential
          // backoff (up to 30 min a round) before a human ever sees it, and
          // lands in exactly the same needs_human state it would have reached
          // immediately. The script goes to the trouble of distinguishing
          // exit 2 from exit 1; the lane has to read it for that to mean
          // anything.
          //
          // err.killed is checked first because a timeout kill leaves code
          // null and signal set, never 2 — a timeout is genuinely retryable,
          // as is a plain exit 1 (the script's "operational failure").
          const failure = new Error(message);
          failure.logTail = logTail;
          if (!err.killed && (err.code === EXIT_DO_NOT_RETRY || unfixable)) {
            failure.permanent = true;
          }
          return reject(failure);
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
