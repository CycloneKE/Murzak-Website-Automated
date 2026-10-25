/**
 * Bundle pairing + pure companion/saving logic tests — no Redis/Frappe.
 *   node test/bundles.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }
async function throws(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (expected throw ${code})`); }
  catch (e) { ok(e.statusCode === code, `${msg} -> ${code} (${e.statusCode})`); }
}

const bundles = require("../services/checkout/bundles");
const { getServiceMeta } = require("../services/provisioning/catalog");
const { effectiveFootprint } = require("../services/provisioning/capacity");

const C = (...ids) => ids.map((serviceId) => ({ serviceId }));

(async () => {
  delete process.env.BUNDLES_ENABLED;
  section("flag off");
  ok(bundles.bundlesEnabled() === false, "bundlesEnabled false when unset");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("starter-email") }), 422, "flag off rejects");

  process.env.BUNDLES_ENABLED = "true";
  section("constants");
  ok(bundles.bundlesEnabled() === true, "bundlesEnabled true");
  ok(bundles.BUNDLE_WINDOW_MS === 14 * 24 * 60 * 60 * 1000, "window 14 days");
  ok(bundles.MAX_COMPANIONS === 3, "cap 3");

  section("validateCompanions");
  const v = bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("starter-email") });
  ok(v.length === 1 && v[0].serviceId === "starter-email" && v[0].meta && v[0].config, "valid email companion");
  ok(bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("domain-com", "starter-storage", "biz-erp-light") }).length === 3, "three allowed incl one business app");
  ok(bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: [] }).length === 0, "empty ok");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("db-mysql") }), 422, "database rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("biz-pos-inventory") }), 422, "POS companion rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("domain-com", "domain-org", "domain-net", "domain-io") }), 422, "fourth companion rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("domain-com", "domain-com") }), 422, "duplicate rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("biz-pos-duka") }), 422, "primary as companion rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("biz-erp-light", "biz-crm-helpdesk") }), 422, "two business apps rejected");
  await throws(() => bundles.validateCompanions({ primaryId: "biz-pos-duka", companions: C("nope-xyz") }), 422, "unknown rejected");
  ok(bundles.validateCompanions({ primaryId: "biz-erp-light", companions: C("domain-ke") }).length === 1, "allowed companion without pairing accepted");

  section("computeBundle");
  const email = getServiceMeta("starter-email");
  let b = bundles.computeBundle({ primaryId: "biz-pos-duka", companions: C("starter-email"), nowMs: 0 });
  ok(b.savingKes === email.monthlyKes, "POS + email saves one month of email");
  ok(b.lines.length === 1 && b.lines[0].monthlyKes === email.monthlyKes && b.lines[0].setupKes === 0, "line shape");
  ok(b.savings[0].serviceId === "starter-email" && typeof b.savings[0].reason === "string", "savings entry");
  b = bundles.computeBundle({ primaryId: "biz-pos-duka", companions: C("domain-com"), nowMs: 0 });
  ok(b.savingKes === 1575, "POS + domain-com 1575");
  b = bundles.computeBundle({ primaryId: "biz-pos-duka", companions: C("domain-ke"), nowMs: 0 });
  ok(b.savingKes === 0 && b.savings.length === 0, "POS + domain-ke 0");
  b = bundles.computeBundle({ primaryId: "biz-erp-light", companions: C("domain-org"), nowMs: 0 });
  ok(b.savingKes === 1425, "ERP + domain-org 1425");
  b = bundles.computeBundle({ primaryId: "biz-erp-configured", companions: C("domain-io"), nowMs: 0 });
  ok(b.savingKes === 5812, "ERP configured + domain-io 5812");
  b = bundles.computeBundle({ primaryId: "biz-erp-light", companions: C("starter-email"), nowMs: 0 });
  ok(b.savingKes === 0, "ERP + email no saving");
  b = bundles.computeBundle({ primaryId: "biz-pos-chain", companions: C("starter-email", "domain-net"), nowMs: 0 });
  ok(b.savingKes === email.monthlyKes + 1425, "savings summed");

  section("footprintOf");
  const f = bundles.footprintOf("biz-pos-duka", C("starter-email", "starter-storage", "biz-erp-light"));
  const exp = ["biz-pos-duka", "starter-email", "starter-storage", "biz-erp-light"]
    .map((i) => effectiveFootprint(getServiceMeta(i)))
    .reduce((a, x) => ({ ramMb: a.ramMb + x.ramMb, diskGb: a.diskGb + x.diskGb }), { ramMb: 0, diskGb: 0 });
  ok(f.ramMb === exp.ramMb && f.diskGb === exp.diskGb, "footprint summed with effectiveFootprint");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
  process.exit(0);
})();
