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

  section("concurrency: two invoices activating for the SAME account don't clobber each other");
  {
    // Simulates the actual race withAccountLock guards against: a webhook and
    // a browser capture (or two invoices settling close together) racing on
    // the same account's Web Account record. Without the lock, both calls
    // read the account before either write lands, and whichever PUT finishes
    // last wins — silently dropping the other invoice's activation.
    const invoices = {
      "INV-A": { name: "INV-A", web_account: "acct-race", status: "Unpaid", services: [{ service_id: "svc-a" }] },
      "INV-B": { name: "INV-B", web_account: "acct-race", status: "Unpaid", services: [{ service_id: "svc-b" }] },
    };
    let account = { services: [{ service_id: "svc-a", status: "Pending" }, { service_id: "svc-b", status: "Pending" }] };
    // Explicit barrier instead of a raw setTimeout race: without the lock,
    // both calls' Web Account reads arrive here close together, the barrier
    // releases both at once with the SAME pre-write snapshot (guaranteed
    // clobber below). With the lock, the second call's read can't happen
    // until the first call's entire critical section (through its own
    // write) has already finished, so it only ever proceeds via the
    // fallback timeout, by which point it reads post-write state.
    let arrivals = 0;
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const frappeClient = () => ({
      get: async (url) => {
        if (/Web(%20| )Account/.test(url)) {
          arrivals++;
          if (arrivals >= 2) releaseGate();
          await Promise.race([gate, new Promise((r) => setTimeout(r, 50))]);
          return { data: { data: account } };
        }
        const inv = Object.values(invoices).find((i) => url.includes(i.name));
        return { data: { data: inv } };
      },
      put: async (url, body) => {
        if (/Portal(%20| )Invoice/.test(url) && body.status) {
          const inv = Object.values(invoices).find((i) => url.includes(i.name));
          if (inv) inv.status = body.status;
        }
        if (/Web(%20| )Account/.test(url) && body.services) {
          account = { ...account, services: body.services };
        }
        return { data: { data: {} } };
      },
      post: async () => ({ data: { data: {} } }),
    });
    const argsFor = (invName) => ({
      req: { session: { webAccount: "acct-race", user: { id: "acct-race" } } },
      invoiceDocName: invName,
      ...FIELDS,
      ...stubs,
      frappeClient,
      paymentVerified: true,
    });

    await Promise.all([
      activateServicesForInvoice(argsFor("INV-A")),
      activateServicesForInvoice(argsFor("INV-B")),
    ]);

    const svcA = account.services.find((s) => s.service_id === "svc-a");
    const svcB = account.services.find((s) => s.service_id === "svc-b");
    ok(svcA?.status !== "Pending", `concurrent activation: svc-a (INV-A) was not lost (got ${svcA?.status})`);
    ok(svcB?.status !== "Pending", `concurrent activation: svc-b (INV-B) was not lost (got ${svcB?.status})`);
  }

  section("server-side per-order capacity guard");
  {
    // Premium items that are REAL Frappe bench tenants (declare benchApps in
    // the catalogue) are charged their measured marginal cost
    // (benchTenantRamMb, 480MB) rather than the container-sized ramMb the
    // catalogue advertises. Two of them cost 2 x 480 = 960MB, not the
    // 8192MB the declared figures would suggest.
    //
    // Deliberately NOT biz-db-medium here, even though it is also
    // capacityClass "premium": it declares no benchApps (it is dedicated
    // database hosting, not a Frappe site — murzak-bench-provision refuses
    // to build it), so isBenchLane() correctly excludes it from this
    // discount and it is charged its real declared 4096MB instead. An
    // earlier version of this test used biz-db-medium here and asserted
    // 960MB, which was itself the bug: it was passing only because
    // isBenchLane() keyed on capacityClass alone and mis-classified it as a
    // cheap bench tenant too.
    //
    // This is the fix for a real mispricing: charging the declared figure let
    // exactly ONE premium tenant onto the box and rationed the highest-margin
    // products using the Coolify lane's economics. Measured 2026-09-05, the
    // whole Frappe stack was ~1,030MB serving seven sites.
    const fp = orderFootprint([{ serviceId: "biz-erp-configured" }, { serviceId: "biz-crm-helpdesk" }]);
    ok(fp.ramMb === 960, `two real bench tenants are charged 2 x 480MB (got ${fp.ramMb})`);

    // biz-db-medium keeps its full declared cost precisely because it is not
    // a bench tenant — undercharging it would have let four of them fit
    // where its real footprint allows none (see capacity.js isBenchLane).
    const dbFp = orderFootprint([{ serviceId: "biz-db-medium" }]);
    ok(dbFp.ramMb === 4096, `biz-db-medium is charged its real 4096MB, not the bench-tenant discount (got ${dbFp.ramMb})`);

    // ...and consequently a single premium item is now BUYABLE. It was not
    // before: biz-erp-configured declares 4096MB and was rejected against the
    // 2048MB cap, which made the KES 12,000/mo flagship unsellable on a box
    // that could comfortably host it.
    let singlePremiumOk = true;
    try {
      assertOrderWithinCapacity([{ serviceId: "biz-erp-configured" }]);
    } catch { singlePremiumOk = false; }
    ok(singlePremiumOk, "a single biz-erp-configured order is accepted (charged 480MB, not 4096MB)");

    // The cap must still bite, or this change would have removed the guard
    // rather than corrected it. Five premium tenants in ONE order cost
    // 5 x 480 = 2400MB, over the 2048MB per-order cap.
    await throws(
      () => Promise.resolve().then(() =>
        assertOrderWithinCapacity([
          { serviceId: "biz-erp-configured" }, { serviceId: "biz-erp-light" },
          { serviceId: "biz-pos-inventory" }, { serviceId: "biz-crm-helpdesk" },
          { serviceId: "biz-accounting" },
        ])
      ),
      422,
      "five bench tenants in one order still exceed the per-order cap"
    );

    // And it still bites on the Coolify lane, where the declared footprint IS
    // the real cost — 3 x 768MB = 2304MB, over the cap. Proves the change is
    // lane-aware rather than a blanket discount.
    await throws(
      () => Promise.resolve().then(() =>
        assertOrderWithinCapacity([
          { serviceId: "starter-web-hosting" }, { serviceId: "db-postgres" }, { serviceId: "db-mysql" },
        ])
      ),
      422,
      "container-lane services are still charged in full and can exceed the cap"
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
