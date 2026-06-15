/**
 * Billing activation + charge-amount tests — runs without Redis or Frappe.
 *   node test/billing.test.js   (or: npm test, which runs this after provisioning)
 *
 * Covers the B1 security gate (only verified rails may mark an invoice Paid /
 * activate services) and the free-trial verification charge helper.
 */

// Disable provisioning so activateServicesForInvoice's best-effort provisioning
// step is a clean no-op with the mock Frappe client.
process.env.PROVISIONING_ENABLED = "false";

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

const { effectiveChargeKes, isVerificationOnly } = require("../utils/billingAmount");
const { activateServicesForInvoice } = require("../services/billingActivationService");
const { orderFootprint, assertOrderWithinCapacity } = require("../services/orderCapacity");
process.env.KES_TO_USD_RATE = process.env.KES_TO_USD_RATE || "0.0078";
const { capturedAmountMatches } = require("../services/paypalService");

const FIELDS = {
  PORTAL_INVOICE_SERVICES_FIELD: "services",
  CHILD_SERVICE_ID_FIELD: "service_id",
  WEB_ACCOUNT_SERVICES_FIELD: "services",
  CHILD_STATUS_FIELD: "status",
};
const stubs = {
  fetchInvoicesForUser: async () => [],
  fetchSelectedServicesForUser: async () => [],
  buildUserPayload: () => ({ id: "acct-1" }),
};

// Mock Frappe client capturing writes; status PUTs mutate the in-memory invoice.
function makeFrappe({ invoice, account }) {
  const puts = [];
  const obj = {
    get: async (url) => {
      if (url.includes("/Portal%20Invoice/") || url.includes("/Portal Invoice/"))
        return { data: { data: invoice } };
      if (url.includes("/Web%20Account/") || url.includes("/Web Account/"))
        return { data: { data: account } };
      return { data: { data: {} } };
    },
    put: async (url, body) => {
      puts.push({ url, body });
      if ((url.includes("Portal")) && body.status) invoice.status = body.status;
      return { data: { data: {} } };
    },
    post: async () => ({ data: { data: {} } }),
  };
  return { frappeClient: () => obj, puts };
}

function baseArgs(extra) {
  return {
    req: { session: { webAccount: "acct-1", user: { id: "acct-1" } } },
    invoiceDocName: "INV-1",
    ...FIELDS,
    ...stubs,
    ...extra,
  };
}

(async () => {
  section("effectiveChargeKes / verification amount");
  ok(effectiveChargeKes(6000) === 6000, "paid amount passes through unchanged");
  ok(effectiveChargeKes(0) === 1, "zero amount -> default verify charge (1)");
  ok(effectiveChargeKes(undefined) === 1, "missing amount -> default verify charge (1)");
  process.env.TRIAL_VERIFY_AMOUNT_KES = "70";
  ok(effectiveChargeKes(0) === 70, "env override sets verify charge");
  delete process.env.TRIAL_VERIFY_AMOUNT_KES;
  ok(isVerificationOnly(0) === true && isVerificationOnly(6000) === false, "isVerificationOnly flags free invoices");

  section("B1 gate: untrusted caller cannot activate an unpaid invoice");
  {
    const inv = { name: "INV-1", web_account: "acct-1", status: "Unpaid", services: [] };
    const { frappeClient, puts } = makeFrappe({ invoice: inv, account: { services: [] } });
    await throws(
      () => activateServicesForInvoice(baseArgs({ frappeClient, paymentVerified: false })),
      402,
      "unpaid + paymentVerified:false is refused"
    );
    ok(inv.status === "Unpaid", "invoice was NOT flipped to Paid");
    ok(puts.length === 0, "no write happened on refusal");
  }

  section("B1 gate: verified rail activates and marks Paid");
  {
    const inv = { name: "INV-1", web_account: "acct-1", status: "Unpaid", services: [{ service_id: "svc-a" }] };
    const acct = { services: [{ service_id: "svc-a", status: "Pending" }] };
    const { frappeClient, puts } = makeFrappe({ invoice: inv, account: acct });
    const res = await activateServicesForInvoice(baseArgs({ frappeClient, paymentVerified: true }));
    ok(res.ok === true, "returns ok");
    ok(inv.status === "Paid", "verified rail flips invoice to Paid");
    ok(puts.some((p) => p.body.status === "Paid"), "Paid write was issued");
  }

  section("B1 gate: untrusted resync of an already-Paid invoice is allowed (idempotent)");
  {
    const inv = { name: "INV-1", web_account: "acct-1", status: "Paid", services: [{ service_id: "svc-a" }] };
    const acct = { services: [{ service_id: "svc-a", status: "Pending" }] };
    const { frappeClient, puts } = makeFrappe({ invoice: inv, account: acct });
    const res = await activateServicesForInvoice(baseArgs({ frappeClient, paymentVerified: false }));
    ok(res.ok === true, "already-paid resync succeeds without verified flag");
    ok(!puts.some((p) => p.url.includes("Portal") && p.body.status === "Paid"), "no redundant Paid write on resync");
    ok(puts.some((p) => p.url.includes("Web") || p.url.includes("Account")), "account services were updated");
  }

  section("SaaS managed-setup: premium -> 'Setting up', volume -> 'Active'");
  {
    const inv = { name: "INV-1", web_account: "acct-1", status: "Unpaid", services: [{ service_id: "biz-pos-inventory" }, { service_id: "starter-web-hosting" }] };
    const acct = { services: [{ service_id: "biz-pos-inventory", status: "Pending" }, { service_id: "starter-web-hosting", status: "Pending" }] };
    const { frappeClient, puts } = makeFrappe({ invoice: inv, account: acct });
    await activateServicesForInvoice(baseArgs({ frappeClient, paymentVerified: true }));
    const accPut = [...puts].reverse().find((p) => /Web|Account/.test(p.url) && p.body.services);
    const rows = accPut?.body?.services || [];
    const pos = rows.find((r) => r.service_id === "biz-pos-inventory");
    const web = rows.find((r) => r.service_id === "starter-web-hosting");
    ok(pos?.status === "Setting up", `premium POS activates as 'Setting up' (got ${pos?.status})`);
    ok(web?.status === "Active", `volume hosting activates as 'Active' (got ${web?.status})`);
  }

  section("B1 gate: ownership is enforced");
  {
    const inv = { name: "INV-1", web_account: "someone-else", status: "Paid", services: [] };
    const { frappeClient } = makeFrappe({ invoice: inv, account: { services: [] } });
    await throws(
      () => activateServicesForInvoice(baseArgs({ frappeClient, paymentVerified: true })),
      403,
      "invoice owned by another account is refused"
    );
  }

  section("server-side per-order capacity guard");
  {
    // biz-erp-configured (4096MB) + biz-db-medium (4096MB) = 8192MB > 6144 cap.
    const fp = orderFootprint([{ serviceId: "biz-erp-configured" }, { serviceId: "biz-db-medium" }]);
    ok(fp.ramMb === 8192, `two 4GB premium apps sum to 8192MB (got ${fp.ramMb})`);
    await throws(
      () => Promise.resolve().then(() =>
        assertOrderWithinCapacity([{ serviceId: "biz-erp-configured" }, { serviceId: "biz-db-medium" }])
      ),
      422,
      "over-cap order is rejected"
    );
    // A single light bundle is well within the cap.
    let okUnder = true;
    try {
      assertOrderWithinCapacity([{ serviceId: "starter-web-hosting" }, { serviceId: "starter-email" }]);
    } catch { okUnder = false; }
    ok(okUnder, "under-cap order passes");
    // Unknown ids contribute 0 footprint (don't falsely block).
    ok(orderFootprint([{ serviceId: "does-not-exist" }]).ramMb === 0, "unknown id => 0 footprint");
  }

  section("shared PayPal captured-amount check (capture + webhook use this)");
  {
    const rate = 0.0078;
    // 6000 KES * 0.0078 = 46.80 USD
    ok(capturedAmountMatches({ invoiceAmountKes: 6000, capturedValue: 46.8, capturedCurrency: "USD" }), "correct amount + USD matches");
    ok(!capturedAmountMatches({ invoiceAmountKes: 6000, capturedValue: 50, capturedCurrency: "USD" }), "wrong amount rejected");
    ok(!capturedAmountMatches({ invoiceAmountKes: 6000, capturedValue: 46.8, capturedCurrency: "EUR" }), "wrong currency rejected");
    ok(!capturedAmountMatches({ invoiceAmountKes: 6000, capturedValue: NaN, capturedCurrency: "USD" }), "non-finite captured rejected");
    // Free/zero invoice is checked against the verification charge (KES 1 -> ~0.01)
    ok(capturedAmountMatches({ invoiceAmountKes: 0, capturedValue: Number((1 * rate).toFixed(2)), capturedCurrency: "USD" }), "free invoice matches the verification charge");
  }

  console.log("\n================================================");
  if (failed) {
    console.error(`BILLING TESTS: ${passed} passed, ${failed} failed`);
    fails.forEach((f) => console.error("  -", f));
    process.exit(1);
  }
  console.log(`BILLING TESTS: ${passed} passed, 0 failed`);
  console.log("ALL GREEN");
})();
