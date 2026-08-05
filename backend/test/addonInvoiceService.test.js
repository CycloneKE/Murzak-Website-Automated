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
    // Realistic paid-Starter customer: already owns a real (non-domain)
    // service, e.g. from their first purchase — not the artificial
    // zero-history fixture this test used before FIX ROUND 2.
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
    });
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
    const client = makeClient({ account: { plan: "Starter", selected_services: [] } });
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
    const client = makeClient({ account: { plan: "Starter", selected_services: [] } });
    await throws(
      () => createAddonInvoice({ client, webAccountName: "acct-1", deps, services: [{ serviceId: "no-such-svc" }] }),
      400, "unpriced/unknown service refused"
    );
  }

  // ------------------------------------------------------------------
  // FIX ROUND 2 — add-on gate bypass via domain-only purchase.
  // These exercise createAddonInvoice end-to-end: the SAME function both
  // /api/addons/invoice/create (server.js) and ordersRoutes.js's
  // prepare-payment (for a repeat purchase, once hasPaidSubscriptionForPlan
  // is true) call. See addonEligibility.js's module docblock and
  // .superpowers/sdd/final-review-fix-report.md "Fix round 2".
  // ------------------------------------------------------------------

  section("FIX ROUND 2 — Requirement 1: domain-only account cannot buy a real add-on");
  {
    // Account whose ONLY paid history is a domain (mirrors a first-purchase
    // domain buyer once ordersRoutes.js's applyPlanAndCreateInvoice branch
    // has run and attached the domain to selected_services as Active).
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "domain-com", status: "Active" }],
      },
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting" }],
      }),
      400, "domain-only account is refused a real (non-domain) add-on"
    );
    ok(client.posts.length === 0, "no invoice was created for the rejected purchase");
  }

  section("FIX ROUND 2 — Requirement 2: repeat domain purchase still works");
  {
    // The exact scenario the previous (reverted) fix attempt broke: a
    // domain-only account buying a SECOND domain must still succeed.
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "domain-com", status: "Active" }],
      },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "domain-net", serviceName: "Domain — .net", tier: "Light", domainChoice: "example.net" }],
    });
    ok(res.invoiceDocName === "PINV-NEW-1", "second domain purchase creates an invoice (not rejected)");
    ok(res.amountKes === 1800, "second domain priced from snapshot (domain-net = 1800)");
  }

  section("FIX ROUND 2 — Requirement 3: real-hosting-only account keeps full add-on rights");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-web-hosting", status: "Active" }],
      },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "real-hosting account can still buy an unrelated real add-on");
  }

  section("FIX ROUND 2 — Requirement 4: hosting + domain account keeps full add-on rights");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [
          { service_id: "starter-web-hosting", status: "Active" },
          { service_id: "domain-com", status: "Active" },
        ],
      },
    });
    const resAddon = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!resAddon.invoiceDocName, "hosting+domain account can buy a real add-on");

    const client2 = makeClient({
      account: {
        plan: "Starter",
        selected_services: [
          { service_id: "starter-web-hosting", status: "Active" },
          { service_id: "domain-com", status: "Active" },
        ],
      },
    });
    const resDomain = await createAddonInvoice({
      client: client2, webAccountName: "acct-1", deps,
      services: [{ serviceId: "domain-net" }],
    });
    ok(!!resDomain.invoiceDocName, "hosting+domain account can buy another domain");
  }

  section("annual-term accounts get mid-term add-ons pro-rated");
  {
    const { annualPrepayKes } = require("../services/billingTerm");
    // Term started 182 days ago -> ~half the year left.
    const started = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: {
        plan: "Starter",
        billing_term: "annual",
        term_started_on: started,
        // Non-empty, non-domain paid history so the add-on eligibility gate
        // (addonEligibility.js's hasNonDomainPaidHistory check) doesn't
        // reject this purchase before pricing is ever computed — mirrors
        // the file's first test above, which needs the same fixture shape
        // to buy the same real (non-domain) add-on.
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    const fullAnnual = annualPrepayKes(1200); // starter-web-hosting is 1200/mo
    ok(res.amountKes < fullAnnual, "mid-term add-on costs less than a full annual term");
    ok(res.amountKes > 1200, "but more than a single month");
    ok(
      Math.abs(res.amountKes - Math.round(fullAnnual * (183 / 365))) <= 100,
      "roughly half the annual price with ~half the term left"
    );
  }

  section("annual-term accounts: merged open invoice is pro-rated too, not flat monthly");
  {
    const { proRatedAddonKes, daysRemainingInTerm } = require("../services/billingTerm");
    // Term started 182 days ago -> ~half the year left (same fixture as above).
    const started = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // An existing OPEN unpaid add-on invoice already carries one service
    // (storage). The new purchase (web-hosting) must merge into it — and the
    // MERGED total must be pro-rated, not the flat monthly sum of both rows.
    const openInvoice = {
      name: "PINV-OPEN-1",
      status: "Unpaid",
      services: [
        { serviceId: "starter-storage", serviceName: "File Storage (25GB)", tier: "Light", domainChoice: "", status: "Awaiting Payment" },
      ],
    };
    const client = makeClient({
      account: {
        plan: "Starter",
        billing_term: "annual",
        term_started_on: started,
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      openInvoice,
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps: { ...deps, findOpenInvoice: async () => openInvoice },
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.invoiceDocName === "PINV-OPEN-1", "merges into the existing open invoice, not a new one");
    ok(res.amountKes !== 1200 + 1200, "merged amount is NOT the flat monthly sum of both add-ons (2400)");
    const days = daysRemainingInTerm(started);
    const expected = proRatedAddonKes(1200, days) + proRatedAddonKes(1200, days);
    ok(res.amountKes === expected, "merged amount equals the sum of each service's pro-rated annual price");
    ok(client.puts.length === 1, "existing open invoice was updated via PUT, not re-created via POST");
    ok(client.puts[0].body.amount === expected, "the PUT body's amount field is also pro-rated");
  }

  section("monthly-term and legacy accounts are billed exactly as before");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        // Same eligibility-satisfying fixture as above (no billing_term at
        // all here -> exercises the legacy-account fail-safe path).
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1200, "legacy account (no billing_term) still bills the monthly price");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
