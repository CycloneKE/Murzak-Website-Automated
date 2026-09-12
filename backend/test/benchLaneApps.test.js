/**
 * Bench lane — the contract between the lane and BENCH_PROVISION_CMD
 * (deploy/vps/bin/murzak-bench-provision).
 *
 * Three halves of that contract:
 *
 *   1. JOB_BENCH_APPS — the ordered Frappe app set the script installs,
 *      resolved from the catalog snapshot. The script REQUIRES it and refuses
 *      without it, so a regression here silently breaks every premium build.
 *
 *   2. Exit codes — the script deliberately distinguishes 2 ("bad input or
 *      missing prerequisite, do NOT retry") from 1 ("operational, retryable").
 *      The lane has to read that for it to mean anything: otherwise a refusal
 *      the script has already declared unfixable burns the whole attempt
 *      budget before reaching the same needs_human state. Spawn failures
 *      (a BENCH_PROVISION_CMD that does not exist or is not executable) are
 *      even less retryable and carry STRING codes, so they need their own
 *      classification.
 *
 *   3. Diagnosability — what a human actually sees on the job afterwards.
 *      Asserted against what runner.js PERSISTS, not against the raw lane
 *      error: it writes `reason.slice(0, 500)` truncated from the HEAD, so a
 *      message built from Node's err.message (which embeds all of stderr)
 *      buries the script's verdict past the cut. An assertion against
 *      e.message cannot catch that, because e.message always contains stderr.
 *
 *   node test/benchLaneApps.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const fs = require("fs");
const os = require("os");
const path = require("path");

const bench = require("../services/provisioning/lanes/bench");
const catalog = require("../services/provisioning/catalog");

const scripts = [];
/** Write a throwaway executable script and register it for cleanup. */
function scriptWith(body, { mode = 0o755 } = {}) {
  const p = path.join(os.tmpdir(), `bench-lane-test-${process.pid}-${scripts.length}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\n${body}`);
  fs.chmodSync(p, mode);
  scripts.push(p);
  return p;
}

/**
 * Run provision() against `cmd` and report how it settled, never throwing.
 * Every call goes through here: a bare `await bench.provision(...)` inside the
 * async IIFE below would escape as an unhandled rejection, killing the process
 * before the pass/fail summary prints and before the temp scripts are removed.
 */
async function settle(cmd, job = {}, env = {}) {
  const prev = { ...process.env };
  process.env.BENCH_PROVISION_CMD = cmd;
  Object.assign(process.env, env);
  try {
    const value = await bench.provision(
      { service_id: "biz-erp-light", web_account: "WA", name: "PRV-T", ...job },
      {}
    );
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  } finally {
    for (const k of ["BENCH_PROVISION_CMD", ...Object.keys(env)]) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** Exactly what runner.js:397-403 writes into the job's error field. */
function persistedError(e) {
  const reason = e.permanent === true
    ? `Permanent failure: ${e.message}`
    : `Failed after 3 attempt(s): ${e.message}`;
  return reason.slice(0, 500);
}

(async () => {
  try {
    section("JOB_BENCH_APPS reaches the script, ordered, from the catalog snapshot");
    {
      // The script echoes its own env back as the JSON result line, so this
      // asserts the real plumbing rather than a mock of it.
      const echo = 'printf \'{"site":"acme.erp.test","apps":"%s","svc":"%s"}\\n\' "$JOB_BENCH_APPS" "$JOB_SERVICE_ID"\n';
      const cmd = scriptWith(echo);

      const pos = await settle(cmd, { service_id: "biz-pos-inventory", service_name: "POS & Inventory" });
      ok(pos.ok && pos.value.access.apps === "erpnext,techsavanna_pos,kenya_compliance",
        "biz-pos-inventory -> erpnext,techsavanna_pos,kenya_compliance (kenya_compliance is techsavanna_pos's undeclared dep)");
      ok(pos.ok && pos.value.access.svc === "biz-pos-inventory", "the rest of the job context still reaches the script");
      ok(pos.ok && pos.value.externalRef === "acme.erp.test", "the site from the script's JSON line is the external ref");

      const erp = await settle(cmd, { service_id: "biz-erp-light" });
      ok(erp.ok && erp.value.access.apps === "erpnext,hrms,csf_ke",
        "biz-erp-light -> erpnext,hrms,csf_ke, in install order (erpnext first, dependencies before dependents)");

      const none = await settle(cmd, { service_id: "biz-db-medium" });
      ok(none.ok && none.value.access.apps === "",
        "biz-db-medium passes an empty list — it is dedicated database hosting, not a Frappe product");
    }

    section("every bench-lane product either declares apps or is knowingly undeclared");
    {
      // Guards catalog drift: a premium product added without benchApps will be
      // refused by the script, so its absence has to be a deliberate choice
      // rather than a forgotten field. biz-db-medium is the known case.
      const KNOWN_UNDECLARED = new Set(["biz-db-medium", "biz-webapps"]);
      const missing = Object.values(catalog.ITEMS)
        .filter((m) => catalog.laneFor(m) === "bench")
        .filter((m) => !(Array.isArray(m.benchApps) && m.benchApps.length))
        .map((m) => m.id)
        .filter((id) => !KNOWN_UNDECLARED.has(id));
      ok(missing.length === 0,
        `no undeclared bench product beyond the known cases${missing.length ? ` (found: ${missing.join(", ")})` : ""}`);
    }

    section("exit 2 (the script's 'do NOT retry') is PERMANENT, and stays diagnosable");
    {
      // 40 timestamped progress lines then the verdict, mirroring the real
      // script: it log()s per step and pipes bench's own output to stderr.
      // The verdict is therefore LAST, which is exactly what the runner's
      // head-truncation used to cut off.
      const noisy = scriptWith(
        'i=0\nwhile [ $i -lt 40 ]; do\n' +
        '  echo "[08:0$i:00] bench: step $i — bench --site acme.erp.murzaktech.tech install-app erpnext" >&2\n' +
        '  i=$((i+1))\ndone\n' +
        'echo "REFUSED: app \'hrms\' is not installed on this bench — schedule it, then re-run" >&2\n' +
        'exit 2\n'
      );
      const r = await settle(noisy);
      ok(!r.ok, "a refusal rejects rather than reporting a build");
      ok(r.error?.permanent === true,
        "flagged permanent, so the runner escalates at once instead of burning PROVISIONING_MAX_ATTEMPTS on backoff");

      const stored = persistedError(r.error);
      ok(/REFUSED/.test(stored),
        "the script's verdict survives runner.js's 500-char HEAD truncation into job.error");
      ok(/hrms/.test(stored),
        "and names the specific app, so a human knows what to schedule");
      ok(!/Command failed:/.test(stored),
        "job.error is not Node's err.message, which would spend the budget on 'Command failed' plus build noise");
      ok(typeof r.error?.logTail === "string" && r.error.logTail.includes("step 0"),
        "the full stderr rides along as logTail, so job.log carries the build log on failure");
    }

    section("a command that cannot be executed is PERMANENT (string codes, never 2)");
    {
      const gone = await settle(path.join(os.tmpdir(), `definitely-not-here-${process.pid}`));
      ok(!gone.ok && gone.error?.permanent === true,
        "ENOENT is permanent — a wrong BENCH_PROVISION_CMD path cannot be fixed by retrying it");
      ok(/ENOENT/.test(gone.error?.message || "") && /BENCH_PROVISION_CMD/.test(gone.error?.message || ""),
        "and the message names both the code and the env var to check");

      const noexec = scriptWith("exit 0\n", { mode: 0o644 });
      const denied = await settle(noexec);
      ok(!denied.ok && denied.error?.permanent === true,
        "EACCES is permanent — a script without the execute bit will never run");

      const notFound = scriptWith("exit 127\n");
      const nf = await settle(notFound);
      ok(!nf.ok && nf.error?.permanent === true,
        "exit 127 is permanent — the SSH wrapper's 'command not found' means the script is missing on the box");
    }

    section("operational failures stay RETRYABLE");
    {
      const op = scriptWith('echo "ERROR: MariaDB connection refused" >&2\nexit 1\n');
      const r = await settle(op);
      ok(!r.ok, "an operational failure rejects");
      ok(r.error && r.error.permanent !== true,
        "NOT permanent — a transient failure must keep its retries, or one MariaDB blip loses the build");
      ok(/MariaDB/.test(persistedError(r.error)),
        "its cause is still visible in job.error");

      const slow = scriptWith("sleep 5\n");
      const t = await settle(slow, {}, { BENCH_PROVISION_TIMEOUT_MS: "300" });
      ok(!t.ok && t.error && t.error.permanent !== true,
        "a timeout kill stays retryable — it leaves exit code null, not 2, and a slow bench is not a refusal");
      ok(/timed out/.test(t.error?.message || ""), "and says it timed out");
    }
  } finally {
    // Runs even if an assertion block throws, so the summary below is always
    // reached and no fixtures are left behind in os.tmpdir().
    for (const p of scripts) { try { fs.unlinkSync(p); } catch { /* already gone */ } }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
