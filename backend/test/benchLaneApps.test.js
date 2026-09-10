/**
 * Bench lane — the contract between the lane and BENCH_PROVISION_CMD
 * (deploy/vps/bin/murzak-bench-provision).
 *
 * Two halves of that contract:
 *
 *   1. JOB_BENCH_APPS — the ordered Frappe app set the script installs,
 *      resolved from the catalog snapshot. The script REQUIRES it and refuses
 *      without it, so a regression here silently breaks every premium build.
 *
 *   2. Exit codes — the script deliberately distinguishes 2 ("bad input or
 *      missing prerequisite, do NOT retry") from 1 ("operational, retryable").
 *      The lane has to read that for it to mean anything: otherwise a refusal
 *      the script has already declared unfixable burns the whole attempt
 *      budget with exponential backoff before reaching the same needs_human
 *      state it could have reached at once.
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
function scriptWith(body) {
  const p = path.join(os.tmpdir(), `bench-lane-test-${process.pid}-${scripts.length}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\n${body}`);
  fs.chmodSync(p, 0o755);
  scripts.push(p);
  return p;
}

async function withScript(body, fn) {
  const prev = process.env.BENCH_PROVISION_CMD;
  process.env.BENCH_PROVISION_CMD = scriptWith(body);
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.BENCH_PROVISION_CMD;
    else process.env.BENCH_PROVISION_CMD = prev;
  }
}

/** Run provision() and report how it settled, without throwing. */
async function settle(job) {
  try {
    return { ok: true, value: await bench.provision(job, {}) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

(async () => {
  section("JOB_BENCH_APPS reaches the script, ordered, from the catalog snapshot");
  {
    // The script echoes its own env back as the JSON result line, so this
    // asserts the real plumbing rather than a mock of it.
    const echo = 'printf \'{"site":"acme.erp.test","apps":"%s","svc":"%s"}\\n\' "$JOB_BENCH_APPS" "$JOB_SERVICE_ID"\n';

    await withScript(echo, async () => {
      const pos = await bench.provision(
        { service_id: "biz-pos-inventory", service_name: "POS & Inventory", web_account: "WA", name: "PRV-1" },
        {}
      );
      ok(pos.access.apps === "erpnext,techsavanna_pos,kenya_compliance",
        "biz-pos-inventory -> erpnext,techsavanna_pos,kenya_compliance (kenya_compliance is techsavanna_pos's undeclared dep)");
      ok(pos.access.svc === "biz-pos-inventory", "the rest of the job context still reaches the script");
      ok(pos.externalRef === "acme.erp.test", "the site from the script's JSON line is the external ref");

      const erp = await bench.provision({ service_id: "biz-erp-light", web_account: "WA", name: "PRV-2" }, {});
      ok(erp.access.apps === "erpnext,hrms,csf_ke",
        "biz-erp-light -> erpnext,hrms,csf_ke, in install order (erpnext first, dependencies before dependents)");

      const none = await bench.provision({ service_id: "biz-db-medium", web_account: "WA", name: "PRV-3" }, {});
      ok(none.access.apps === "",
        "biz-db-medium passes an empty list — it is dedicated database hosting, not a Frappe product");
    });
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

  section("exit 2 (the script's 'do NOT retry') is a PERMANENT failure");
  {
    // Mirrors the script's own refuse(): a message on stderr, exit 2.
    await withScript('echo "REFUSED: no benchApps declared for biz-db-medium" >&2\nexit 2\n', async () => {
      const r = await settle({ service_id: "biz-db-medium", web_account: "WA", name: "PRV-4" });
      ok(!r.ok, "a refusal rejects rather than reporting a build");
      ok(r.error?.permanent === true,
        "flagged permanent, so the runner escalates at once instead of burning PROVISIONING_MAX_ATTEMPTS on backoff");
      ok(/REFUSED/.test(r.error?.message || ""),
        "the script's stderr reaches the job's error field, so a human sees WHY it refused");
    });
  }

  section("exit 1 (operational) stays RETRYABLE");
  {
    await withScript('echo "ERROR: bench command timed out talking to MariaDB" >&2\nexit 1\n', async () => {
      const r = await settle({ service_id: "biz-erp-light", web_account: "WA", name: "PRV-5" });
      ok(!r.ok, "an operational failure rejects");
      ok(r.error && r.error.permanent !== true,
        "NOT permanent — a transient failure must keep its retries, or one MariaDB blip loses the build");
    });
  }

  section("a timeout kill stays retryable even though it is not exit 1");
  {
    const prev = process.env.BENCH_PROVISION_TIMEOUT_MS;
    process.env.BENCH_PROVISION_TIMEOUT_MS = "300";
    try {
      await withScript("sleep 5\n", async () => {
        const r = await settle({ service_id: "biz-erp-light", web_account: "WA", name: "PRV-6" });
        ok(!r.ok, "a timed-out build rejects");
        ok(r.error && r.error.permanent !== true,
          "a kill leaves exit code null, not 2 — a slow bench must not be mistaken for a refusal");
        ok(/timed out/.test(r.error?.message || ""), "the message says it timed out");
      });
    } finally {
      if (prev === undefined) delete process.env.BENCH_PROVISION_TIMEOUT_MS;
      else process.env.BENCH_PROVISION_TIMEOUT_MS = prev;
    }
  }

  for (const p of scripts) { try { fs.unlinkSync(p); } catch { /* already gone */ } }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
