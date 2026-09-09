/**
 * Bench lane app set — the catalog declares which Frappe apps each premium
 * product's site needs (ServiceOption.benchApps), but until now that list
 * never reached the provisioning script: bench.js exported only service id /
 * name / account / invoice / RAM / disk / target, so a finished script had no
 * way to tell an ERP tenant from a POS tenant.
 *
 * Two behaviours are covered:
 *   1. the list resolves from the catalog snapshot, in install order, and is
 *      handed to the script as JOB_BENCH_APPS;
 *   2. a bench job with NO declared app set is escalated permanently rather
 *      than built — laneFor() routes on capacityClass alone, so non-Frappe
 *      "premium" products (biz-db-medium) land here too and must not get a
 *      bare ERPNext site.
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

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

(async () => {
  section("benchAppsFor: resolves from the catalog snapshot, order preserved");
  {
    const erp = bench.benchAppsFor({ service_id: "biz-erp-light" });
    ok(erp.join(",") === "erpnext,hrms,csf_ke",
      "biz-erp-light -> erpnext,hrms,csf_ke (erpnext first, dependencies before dependents)");

    const pos = bench.benchAppsFor({ service_id: "biz-pos-inventory" });
    ok(pos.join(",") === "erpnext,techsavanna_pos,kenya_compliance",
      "biz-pos-inventory -> erpnext,techsavanna_pos,kenya_compliance (kenya_compliance is techsavanna_pos's undeclared dep)");

    ok(bench.benchAppsFor({ service_id: "biz-crm-helpdesk" }).join(",") === "erpnext",
      "biz-crm-helpdesk -> erpnext");
  }

  section("benchAppsFor: empty for products with no declared app set");
  {
    ok(bench.benchAppsFor({ service_id: "biz-db-medium" }).length === 0,
      "biz-db-medium has none — it is dedicated database hosting, not a Frappe product");
    ok(bench.benchAppsFor({ service_id: "not-a-real-service" }).length === 0,
      "an unknown service id yields none rather than throwing");
    ok(bench.benchAppsFor({}).length === 0, "a job with no service_id yields none");
  }

  section("every bench-lane product either declares apps or is knowingly undeclared");
  {
    // Guards catalog drift: adding a premium product without benchApps now
    // means it escalates, so that has to be a deliberate choice, not a
    // forgotten field. biz-db-medium is the one known, documented case.
    const KNOWN_UNDECLARED = new Set(["biz-db-medium", "biz-webapps"]);
    const missing = Object.values(catalog.ITEMS)
      .filter((m) => catalog.laneFor(m) === "bench")
      .filter((m) => !(Array.isArray(m.benchApps) && m.benchApps.length))
      .map((m) => m.id)
      .filter((id) => !KNOWN_UNDECLARED.has(id));
    ok(missing.length === 0,
      `no undeclared bench product beyond the known cases${missing.length ? ` (found: ${missing.join(", ")})` : ""}`);
  }

  section("provision: a job with no declared apps is rejected permanently, never built");
  {
    // A command that would succeed if it ran at all — proving the rejection
    // happens before dispatch, not because the script failed.
    const script = path.join(os.tmpdir(), `bench-apps-test-${process.pid}.sh`);
    fs.writeFileSync(script, '#!/bin/sh\necho \'{"site":"should-not-run"}\'\n');
    fs.chmodSync(script, 0o755);

    try {
      await withEnv({ BENCH_PROVISION_CMD: script }, async () => {
        let err = null;
        try {
          await bench.provision({ service_id: "biz-db-medium", web_account: "WA", name: "PRV-1" }, {});
        } catch (e) {
          err = e;
        }
        ok(!!err, "biz-db-medium rejects instead of building a bare Frappe site");
        ok(err && err.permanent === true,
          "rejection is permanent — a retry cannot conjure an app list, so it must not burn 3 attempts of backoff");
        ok(err && /benchApps/.test(err.message) && /biz-db-medium/.test(err.message),
          "the error names the product and the missing catalog field, so a human knows what to fix");
      });
    } finally {
      fs.unlinkSync(script);
    }
  }

  section("provision: the app list reaches the script as JOB_BENCH_APPS");
  {
    // The script echoes back what it was handed, as the JSON line the lane
    // parses — so this asserts the real env plumbing, not a mock of it.
    const script = path.join(os.tmpdir(), `bench-apps-echo-${process.pid}.sh`);
    fs.writeFileSync(
      script,
      '#!/bin/sh\nprintf \'{"site":"acme.erp.test","apps":"%s","svc":"%s"}\\n\' "$JOB_BENCH_APPS" "$JOB_SERVICE_ID"\n'
    );
    fs.chmodSync(script, 0o755);

    try {
      await withEnv({ BENCH_PROVISION_CMD: script }, async () => {
        const res = await bench.provision(
          { service_id: "biz-pos-inventory", service_name: "POS & Inventory", web_account: "WA", name: "PRV-2" },
          {}
        );
        ok(res.access.apps === "erpnext,techsavanna_pos,kenya_compliance",
          "the script received the ordered, comma-separated app list");
        ok(res.access.svc === "biz-pos-inventory", "the existing job context still reaches the script too");
        ok(res.externalRef === "acme.erp.test", "the site from the script's JSON line is still the external ref");
      });
    } finally {
      fs.unlinkSync(script);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
