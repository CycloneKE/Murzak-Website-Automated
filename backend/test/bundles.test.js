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

  // ---- Task 4: post-purchase window, saving, once-per-pairing ----
  const { makeMockFrappe } = require("./helpers/mockFrappe");
  const END = 1_000_000_000_000;
  const orderDoc = (name, over = {}, bundle = { windowEndsAtMs: END }) => ({
    name, web_account: "acct-p", status: "Paid", service_id: "biz-pos-duka",
    config_json: JSON.stringify({ bundle }), ...over,
  });
  const P = { orderId: "CHK-1", primaryId: "biz-pos-duka", windowEndsAtMs: END, applied: [] };

  section("activeBundleWindows");
  {
    const client = makeMockFrappe({ "Checkout Order": {
      "CHK-1": orderDoc("CHK-1"),
      "CHK-D": orderDoc("CHK-D", { status: "Draft" }, { companions: [] }),
      "CHK-X": orderDoc("CHK-X", { web_account: "other" }),
      "CHK-N": orderDoc("CHK-N", {}, {}),
      "CHK-A": orderDoc("CHK-A", { service_id: "biz-erp-light" }, { windowEndsAtMs: END, applied: ["erp-domain-com"] }),
    } });
    let w = await bundles.activeBundleWindows({ client, webAccountName: "acct-p", nowMs: END });
    ok(w.length === 2, "exactly windowEndsAtMs is still active (2 paid windows)");
    const w1 = w.find((x) => x.orderId === "CHK-1");
    ok(w1.primaryId === "biz-pos-duka" && w1.windowEndsAtMs === END, "window shape");
    ok(JSON.stringify(w.find((x) => x.orderId === "CHK-A").applied) === '["erp-domain-com"]', "applied carried");
    w = await bundles.activeBundleWindows({ client, webAccountName: "acct-p", nowMs: END + 1 });
    ok(w.length === 0, "+1 ms past windowEndsAtMs: no windows");
    ok(!(await bundles.activeBundleWindows({ client, webAccountName: "acct-p", nowMs: 0 })).some((x) => x.orderId === "CHK-D"),
      "unpaid (Draft) order yields no window");
    process.env.BUNDLES_ENABLED = "false";
    ok((await bundles.activeBundleWindows({ client, webAccountName: "acct-p", nowMs: 0 })).length === 0, "flag off: none");
    process.env.BUNDLES_ENABLED = "true";
  }

  section("savingForAddOn");
  {
    let s = bundles.savingForAddOn({ windows: [P], serviceIds: ["domain-com"], nowMs: END });
    ok(s.savingKes === 1575 && s.applied.length === 1 && s.applied[0].pairingId === "pos-domain-com", "domain-com at exactly window end: 1575");
    s = bundles.savingForAddOn({ windows: [P], serviceIds: ["domain-com"], nowMs: END + 1 });
    ok(s.savingKes === 0 && s.applied.length === 0, "+1 ms: 0");
    s = bundles.savingForAddOn({ windows: [P], serviceIds: ["starter-email"], nowMs: 0 });
    ok(s.savingKes === email.monthlyKes, "firstMonthFree equals email monthlyKes");
    s = bundles.savingForAddOn({ windows: [P], serviceIds: ["domain-ke", "db-mysql"], nowMs: 0 });
    ok(s.savingKes === 0, "unpaired companions: 0");
    s = bundles.savingForAddOn({ windows: [{ ...P, primaryId: "biz-erp-light" }], serviceIds: ["starter-email"], nowMs: 0 });
    ok(s.savingKes === 0, "pairing requires the paid order's primary (ERP + email: 0)");
    s = bundles.savingForAddOn({ windows: [{ ...P, applied: ["pos-domain-com"] }], serviceIds: ["domain-com"], nowMs: 0 });
    ok(s.savingKes === 0, "already-applied pairing gives 0 (once per pairing)");
    s = bundles.savingForAddOn({ windows: [P, { ...P, orderId: "CHK-2" }], serviceIds: ["domain-com", "domain-com"], nowMs: 0 });
    ok(s.savingKes === 1575 && s.applied.length === 1, "one saving per add-on line even with two windows");
    s = bundles.savingForAddOn({ windows: [{ ...P, applied: ["pos-domain-com"] }, { ...P, orderId: "CHK-2" }], serviceIds: ["domain-com"], nowMs: 0 });
    ok(s.savingKes === 1575 && s.applied[0].orderId === "CHK-2", "second paid order still has its own once");
    s = bundles.savingForAddOn({ windows: [P], serviceIds: ["domain-com", "domain-org", "starter-email"], nowMs: 0 });
    ok(s.savingKes === 1575 + 1425 + email.monthlyKes, "savings sum across add-on lines");
    process.env.BUNDLES_ENABLED = "false";
    ok(bundles.savingForAddOn({ windows: [P], serviceIds: ["domain-com"], nowMs: 0 }).savingKes === 0, "flag off: 0");
    process.env.BUNDLES_ENABLED = "true";
  }

  section("offersForWindows");
  {
    const offers = bundles.offersForWindows({ windows: [P], ownedServiceIds: ["domain-org"], nowMs: END });
    const ids = offers.map((o) => o.serviceId).sort();
    ok(JSON.stringify(ids) === JSON.stringify(["domain-com", "domain-io", "domain-net", "starter-email"]), "owned domain-org omitted: " + ids);
    const dc = offers.find((o) => o.serviceId === "domain-com");
    ok(dc.savingKes === 1575 && dc.windowEndsAtMs === END && dc.monthlyKes === getServiceMeta("domain-com").monthlyKes && dc.name, "offer shape");
    ok(bundles.offersForWindows({ windows: [P], ownedServiceIds: [], nowMs: END + 1 }).length === 0, "expired window: no offers");
    ok(!bundles.offersForWindows({ windows: [{ ...P, applied: ["pos-domain-com"] }], ownedServiceIds: [], nowMs: 0 }).some((o) => o.serviceId === "domain-com"),
      "applied pairing no longer offered");
    ok(bundles.isAllowedCompanion("biz-pos-duka", "domain-com") && !bundles.isAllowedCompanion("biz-pos-duka", "db-mysql")
      && !bundles.isAllowedCompanion("biz-pos-duka", "biz-pos-duka"), "isAllowedCompanion follows the Task 1 rule");
  }

  section("applyAddOnSaving");
  {
    const mk = () => makeMockFrappe({
      "Checkout Order": { "CHK-1": orderDoc("CHK-1", {}, { windowEndsAtMs: END, savingKes: 5, other: "keep" }) },
      "Portal Invoice": { "PINV-1": { name: "PINV-1", amount: 3000 } },
    });
    let client = mk();
    const args = (over = {}) => ({ client, webAccountName: "acct-p", invoiceDocName: "PINV-1", amountKes: 3000, serviceIds: ["domain-com"], nowMs: END, ...over });
    let r = await bundles.applyAddOnSaving(args());
    ok(r.savingKes === 1575, "returns saving");
    ok(client.store["Portal Invoice"]["PINV-1"].amount === 3000 - 1575, "invoice amount reduced by exactly the saving (1425)");
    let cfg = JSON.parse(client.store["Checkout Order"]["CHK-1"].config_json);
    ok(JSON.stringify(cfg.bundle.applied) === '["pos-domain-com"]', "applied recorded on the order");
    ok(cfg.bundle.windowEndsAtMs === END && cfg.bundle.savingKes === 5 && cfg.bundle.other === "keep", "other bundle keys preserved");
    client.store["Portal Invoice"]["PINV-1"].amount = 3000;
    r = await bundles.applyAddOnSaving(args());
    ok(r.savingKes === 0 && client.store["Portal Invoice"]["PINV-1"].amount === 3000, "second purchase of same pairing: no saving, no change");

    client = mk();
    r = await bundles.applyAddOnSaving(args({ nowMs: END + 1 }));
    ok(r.savingKes === 0 && client.puts.length === 0, "expired window: no writes");
    client = mk();
    r = await bundles.applyAddOnSaving(args({ serviceIds: ["domain-ke"] }));
    ok(r.savingKes === 0 && client.puts.length === 0, "no applicable pairing: no PUT at all");
    client = mk();
    r = await bundles.applyAddOnSaving(args({ amountKes: 1000 }));
    ok(client.store["Portal Invoice"]["PINV-1"].amount === 0, "saving larger than amount floors at 0, never negative");

    for (const bad of [undefined, null, 0, NaN, "x"]) {
      client = mk();
      let code = null;
      try { await bundles.applyAddOnSaving(args({ amountKes: bad })); } catch (e) { code = e.statusCode; }
      ok(code === 500 && client.puts.length === 0 && client.store["Portal Invoice"]["PINV-1"].amount === 3000,
        `amountKes ${String(bad)} with a saving: 500, nothing written`);
    }
    client = mk();
    process.env.BUNDLES_ENABLED = "false";
    r = await bundles.applyAddOnSaving(args());
    process.env.BUNDLES_ENABLED = "true";
    ok(r.savingKes === 0 && client.puts.length === 0, "flag off: untouched");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
  process.exit(0);
})();
