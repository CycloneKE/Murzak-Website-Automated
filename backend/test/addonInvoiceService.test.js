/**
 * createAddonInvoice service tests — runs without Redis or Frappe.
 *   node test/addonInvoiceService.test.js   (or: npm test)
 *
 * Covers pricing-from-snapshot (not from the request body), the
 * PLAN_NOT_PAID gate, and the unpriced/unknown-service rejection for the
 * add-on invoice creation logic extracted from
 * /api/addons/invoice/create.
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

const { createAddonInvoice } = require("../services/addonInvoiceService");

// Minimal mock frappe client: GET returns account/invoice fixtures, POST
// captures the created invoice and returns a name.
function makeClient({ account, openInvoice = null }) {
  const posts = [];
  const puts = [];
  return {
    posts, puts,
    get: async (url, opts) => {
      if (url.includes("/Web Account/") || url.includes("/Web%20Account/"))
        return { data: { data: account } };
      if (url.includes("/api/resource/Portal Invoice") && opts?.params)
        return { data: { data: openInvoice ? [openInvoice] : [] } };
      if (openInvoice && url.includes(openInvoice.name))
        return { data: { data: openInvoice } };
      return { data: { data: {} } };
    },
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: { name: "PINV-NEW-1" } } }; },
    put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
  };
}

const deps = {
  fetchWebAccount: async (client) => (await client.get("/api/resource/Web Account/acct-1")).data.data,
  hasPaidSubscriptionForPlan: async () => true,
  normalizeSelectedServices: (s) => s,
  findOpenInvoice: async (client) => null,
  normalizeInvoiceServiceRow: (r) => r,
  buildInvoiceServiceRows: (rows) => rows,
  PORTAL_INVOICE_SERVICES_FIELD: "services",
};

(async () => {
  section("createAddonInvoice: prices from snapshot and creates a new invoice");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.invoiceDocName === "PINV-NEW-1", "returns created invoice docName");
    ok(res.amountKes === 1200, "amount priced from snapshot, not request");
    ok(client.posts.length === 1, "one invoice POST issued");
  }

  section("createAddonInvoice: PLAN_NOT_PAID is a 403 with code");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1",
        deps: { ...deps, hasPaidSubscriptionForPlan: async () => false },
        services: [{ serviceId: "starter-web-hosting" }],
      }),
      403, "unpaid plan is refused"
    );
  }

  section("createAddonInvoice: unknown service id is a 400");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    await throws(
      () => createAddonInvoice({ client, webAccountName: "acct-1", deps, services: [{ serviceId: "no-such-svc" }] }),
      400, "unpriced/unknown service refused"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
