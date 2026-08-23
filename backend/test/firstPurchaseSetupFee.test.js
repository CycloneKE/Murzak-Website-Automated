/**
 * First-purchase invoice pricing — applyPlanAndCreateInvoice.
 *   node test/firstPurchaseSetupFee.test.js   (or: npm test)
 *
 * The add-on path (services/addonInvoiceService.js) and the FIRST-purchase
 * path (server.js's applyPlanAndCreateInvoice) create invoices independently.
 * Both must bill the same thing the checkout page showed the customer:
 * monthly + the one-time setup fee (services/checkout/orderStore.js's
 * totalDueKes = monthlyKes + setupKes).
 *
 * Setup is one-time. renewalService.js bills sumSelectedServicesMonthlyKes()
 * every ~30 days, so setup must stay out of that sum — asserted below.
 *
 * Requires backend/server.js with MOCK_FRAPPE=true; importing it must not
 * bind a port (see the require.main guard on app.listen).
 */

process.env.MOCK_FRAPPE = "true";

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  applyPlanAndCreateInvoice,
  sumSelectedServicesMonthlyKes,
} = require("../server");

// Minimal Frappe stand-in: serves one Web Account, no existing invoices,
// and records the invoice POST so the test can read the billed amount.
function makeClient({ account = {}, openSubscriptionInvoice = null } = {}) {
  const posts = [];
  const puts = [];
  return {
    posts, puts,
    get: async (url, opts) => {
      if (url.includes("Web%20Account") || url.includes("Web Account")) {
        return { data: { data: { name: "acct-1", account_holder_name: "Test Co", plan: "None", ...account } } };
      }
      if (url.includes("Portal%20Invoice") || url.includes("Portal Invoice")) {
        return { data: { data: openSubscriptionInvoice ? [openSubscriptionInvoice] : [] } };
      }
      return { data: { data: opts ? [] : {} } };
    },
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: { name: "PINV-FIRST-1" } } }; },
    put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
  };
}

function invoicePost(client) {
  return client.posts.find((p) => String(p.url).includes("Portal"))?.body;
}

(async () => {
  section("first purchase bills monthly + one-time setup");
  {
    const client = makeClient();
    // starter-web-hosting: monthlyKes 1200 + setupKes 500.
    await applyPlanAndCreateInvoice(client, "acct-1", "Starter", [
      { serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light" },
    ]);
    const body = invoicePost(client);
    ok(!!body, "an invoice was created");
    ok(body?.amount === 1700, `first invoice bills 1200 monthly + 500 setup = 1700 (got ${body?.amount})`);
  }

  section("a premium first purchase bills its much larger setup fee");
  {
    const client = makeClient();
    // biz-erp-light: monthlyKes 6000 + setupKes 5000 — the fee that carries
    // the margin on every managed-ERP sale, and was silently never charged.
    await applyPlanAndCreateInvoice(client, "acct-1", "Business", [
      { serviceId: "biz-erp-light", serviceName: "Murzak ERP (1-3 users)", tier: "Medium" },
    ]);
    ok(invoicePost(client)?.amount === 11000, `ERP first invoice bills 6000 + 5000 = 11000 (got ${invoicePost(client)?.amount})`);
  }

  section("multiple services sum both monthly and setup");
  {
    const client = makeClient();
    // starter-web-hosting 1200+500, db-mysql 2000+500 => 3200 + 1000 = 4200
    await applyPlanAndCreateInvoice(client, "acct-1", "Starter", [
      { serviceId: "starter-web-hosting" },
      { serviceId: "db-mysql" },
    ]);
    ok(invoicePost(client)?.amount === 4200, `two services bill 3200 monthly + 1000 setup = 4200 (got ${invoicePost(client)?.amount})`);
  }

  section("a service with no setup fee is unchanged");
  {
    const client = makeClient();
    // starter-storage: monthlyKes 1200, no setupKes.
    await applyPlanAndCreateInvoice(client, "acct-1", "Starter", [{ serviceId: "starter-storage" }]);
    ok(invoicePost(client)?.amount === 1200, `no setup fee -> 1200 (got ${invoicePost(client)?.amount})`);
  }

  section("an upgrade does not re-charge setup on services already Active");
  {
    // /api/subscription/upgrade calls applyPlanAndCreateInvoice with the FULL
    // post-upgrade row set, stamping already-owned services "Active". Setup is
    // one-time, so only the newly added row may carry a setup fee — otherwise
    // every plan change re-bills setup on everything the customer already owns.
    const client = makeClient();
    await applyPlanAndCreateInvoice(client, "acct-1", "Business", [
      { serviceId: "starter-web-hosting", status: "Active" },   // already paid for
      { serviceId: "biz-erp-light", status: "Awaiting Payment" }, // newly added
    ]);
    // monthly 1200 + 6000 = 7200; setup only for the new biz-erp-light = 5000
    ok(invoicePost(client)?.amount === 12200, `upgrade bills 7200 monthly + 5000 new-service setup = 12200 (got ${invoicePost(client)?.amount})`);
  }

  section("renewals still exclude setup");
  {
    // renewalService.js bills with this every RENEWAL_CYCLE_DAYS. Setup
    // leaking in here would re-charge every customer their setup fee monthly.
    const monthly = sumSelectedServicesMonthlyKes([
      { serviceId: "starter-web-hosting" },
      { serviceId: "biz-erp-light" },
    ]);
    ok(monthly === 7200, `monthly-only sum is 1200 + 6000 = 7200, no setup (got ${monthly})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
  process.exit(0);
})();
