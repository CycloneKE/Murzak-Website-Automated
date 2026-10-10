/**
 * In-container bench lane: app-tier (Murzak POS) handling — node test/benchLaneAppTier.test.js
 *
 * Windows-safe on purpose: nothing here spawns a process (benchLaneApps.test.js
 * execs #!/bin/sh stubs and cannot run on Windows). The decisions under test are
 * pure helpers exported by lanes/bench.js, plus provision()'s refusal path,
 * which rejects BEFORE any execFile.
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const bench = require("../services/provisioning/lanes/bench");
const { getServiceMeta } = require("../services/provisioning/catalog");
const { CLAIMABLE_JOB_FIELDS } = require("../services/provisioning/runner");

(async () => {
  const posMeta = getServiceMeta("biz-pos-duka");
  const erpMeta = getServiceMeta("biz-erp-light");

  section("test premise");
  ok(posMeta?.app === "pos", "biz-pos-duka is an app tier (meta.app === pos)");
  ok(erpMeta && !erpMeta.app, "biz-erp-light is not an app tier");

  section("claim fetch carries the chosen address");
  ok(CLAIMABLE_JOB_FIELDS.includes("site_slug"), "CLAIMABLE_JOB_FIELDS includes site_slug");

  section("appTierRefusal");
  const posJob = { service_id: "biz-pos-duka", web_account: "A", invoice: "PINV-1", site_slug: "mamanjeri" };
  const refusal = bench.appTierRefusal(posJob, posMeta);
  ok(typeof refusal === "string" && /murzak-bench-runner/.test(refusal) && /owner logins/.test(refusal), "an app-tier job is refused with the host-runner message");
  ok(bench.appTierRefusal({ service_id: "biz-erp-light" }, erpMeta) === null, "a non-app premium job is not refused");
  ok(bench.appTierRefusal({ service_id: "nope" }, null) === null, "unknown meta is not refused (other guards own that)");
  ok(bench.appTierRefusal({ service_id: "biz-pos-duka" }, posMeta) === refusal, "refused with or without a site_slug on the job");

  section("buildProvisionEnv");
  const saved = process.env.JOB_SITE_SLUG;
  process.env.JOB_SITE_SLUG = "ambient-leak";
  const posEnv = bench.buildProvisionEnv(posJob, { target: { id: "box-1" } }, posMeta);
  ok(posEnv.JOB_SITE_SLUG === "mamanjeri", "app-tier job: JOB_SITE_SLUG is the job's site_slug");
  ok(posEnv.JOB_SERVICE_ID === "biz-pos-duka" && posEnv.JOB_WEB_ACCOUNT === "A" && posEnv.JOB_INVOICE === "PINV-1", "the usual JOB_* variables are still set");
  ok(posEnv.JOB_BENCH_APPS === (posMeta.benchApps || []).join(","), "JOB_BENCH_APPS still comes from the catalogue");
  const posNoSlug = bench.buildProvisionEnv({ service_id: "biz-pos-duka", web_account: "A" }, {}, posMeta);
  ok(!("JOB_SITE_SLUG" in posNoSlug), "app-tier job with no site_slug: JOB_SITE_SLUG is absent (and an ambient value does not leak in)");
  const erpEnv = bench.buildProvisionEnv({ service_id: "biz-erp-light", web_account: "A", site_slug: "should-not-pass" }, {}, erpMeta);
  ok(!("JOB_SITE_SLUG" in erpEnv), "non-app job: JOB_SITE_SLUG is never set, even if a stray site_slug is on the row");
  ok(bench.buildProvisionEnv({ service_id: "biz-erp-light" }, { target: { id: "box-2" } }, erpMeta).JOB_TARGET === "box-2", "JOB_TARGET follows the target");
  if (saved === undefined) delete process.env.JOB_SITE_SLUG; else process.env.JOB_SITE_SLUG = saved;

  section("provision() refuses an app-tier job permanently, without spawning");
  {
    const savedCmd = process.env.BENCH_PROVISION_CMD;
    // Would fail loudly with ENOENT if provision() ever tried to execute it.
    process.env.BENCH_PROVISION_CMD = "/definitely/not/a/real/provisioner";
    let err = null;
    try { await bench.provision(posJob, {}); } catch (e) { err = e; }
    ok(err && err.permanent === true, "rejects with failure.permanent === true");
    ok(err && /bench provision refused/.test(err.message) && /murzak-bench-runner/.test(err.message), "message says who provisions POS shops");
    ok(err && !/ENOENT|could not execute/.test(err.message), "never reached the spawn");
    if (savedCmd === undefined) delete process.env.BENCH_PROVISION_CMD; else process.env.BENCH_PROVISION_CMD = savedCmd;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
