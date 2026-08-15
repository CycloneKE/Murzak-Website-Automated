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

const {
  createAddonInvoice,
  resolveNonDomainPaidHistory,
  accountHasPaidNonDomainInvoiceLine,
} = require("../services/addonInvoiceService");

// Minimal mock frappe client: GET returns account/invoice fixtures, POST
// captures the created invoice and returns a name.
//
// `paidInvoices`: fixtures for the FIX ROUND 3 paid-invoice-line fallback —
// each { name, services: [{service_id}, ...] }. The list GET (filtered on
// status="Paid") returns just their names; a per-doc GET returns the full
// fixture with its `services` array under whatever field name the caller's
// `invoiceServicesField` expects (addonInvoiceService.js passes
// PORTAL_INVOICE_SERVICES_FIELD = deps.PORTAL_INVOICE_SERVICES_FIELD, which
// `deps` below sets to "services" — matching the fixture key).
//
// `listCalls`/`docGets` let tests assert exactly how many extra Frappe
// calls the fallback made — the zero-extra-query promise for Requirements
// 2 and 3 is only meaningful if something is actually counting.
function makeClient({ account, openInvoice = null, paidInvoices = [], getError = null, docGetError = null }) {
  const posts = [];
  const puts = [];
  const listCalls = [];
  const docGets = [];
  return {
    posts, puts, listCalls, docGets,
    get: async (url, opts) => {
      if (url.includes("/Web Account/") || url.includes("/Web%20Account/"))
        return { data: { data: account } };
      if (url.includes("/api/resource/Portal Invoice") && opts?.params) {
        const filters = String(opts.params.filters || "");
        if (filters.includes('"Paid"')) {
          // The FIX ROUND 3 paid-invoice list scan.
          listCalls.push(opts.params);
          if (getError) throw new Error(getError);
          return { data: { data: paidInvoices.map((i) => ({ name: i.name })) } };
        }
        // findOpenInvoice's unpaid-status list — unrelated to the fallback.
        return { data: { data: openInvoice ? [openInvoice] : [] } };
      }
      const hit = paidInvoices.find((i) => url.includes(i.name));
      if (hit) {
        docGets.push(hit.name);
        if (docGetError) throw new Error(docGetError);
        return { data: { data: { name: hit.name, services: hit.services || [] } } };
      }
      if (openInvoice && url.includes(openInvoice.name)) return { data: { data: openInvoice } };
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

  // ------------------------------------------------------------------
  // FIX ROUND 3 — the round-2 signal (Web Account selected_services status)
  // silently blocked real, paying customers. These add the second, paid-
  // invoice-derived signal and prove it rescues each defect without
  // costing extra queries on the paths that don't need it.
  // ------------------------------------------------------------------

  section("FIX ROUND 3 — defect (a): plan-only account with NO service rows at all");
  {
    // The currently-missing case: a plan-only customer whose Subscription
    // invoice paid for real hosting, but who has no selected_services rows
    // yet (or none in a paid status) — S alone says nothing.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [{ name: "PINV-SUB-1", services: [{ service_id: "starter-web-hosting" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "a plan-only account with zero service rows can still buy an add-on (rescued by P)");
  }
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-web-hosting", status: "Awaiting Payment" }],
      },
      paidInvoices: [{ name: "PINV-SUB-1", services: [{ service_id: "starter-web-hosting" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "an unpaid-status row is rescued the same way (S false, P true)");
  }

  section("FIX ROUND 3 — defect (c): a row demoted by the lossy round-trip is rescued by P");
  {
    // Mirrors a row that started "Setting up" and got silently collapsed to
    // "Awaiting Payment" by the pre-fix ordersRoutes.js round-trip — the
    // account's OWN paid invoice still proves it was real.
    // biz-accounting (demoted+paid) + biz-webapps (new purchase) = 3072MB/40GB —
    // both Medium-tier (the only tier Business plan is eligible for), and the
    // smallest such pair that still fits the real KVM 2's 3200MB/40GB self-serve
    // cap. biz-pos-inventory (2048MB) used before this resize, but paired with
    // ANY other Medium-tier premium item it now exceeds the cap alone.
    const client = makeClient({
      account: {
        plan: "Business",
        selected_services: [{ service_id: "biz-accounting", status: "Awaiting Payment" }],
      },
      paidInvoices: [{ name: "PINV-SUB-1", services: [{ service_id: "biz-accounting" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "biz-webapps" }],
    });
    ok(!!res.invoiceDocName, "a demoted row is rescued by the invoice signal, not permanently blocked");
  }

  section("FIX ROUND 3 — defect (b) end-to-end: unknown-id row needs zero extra queries");
  {
    // Now that accountHasNonDomainPaidService itself fails open on unknown
    // ids (the polarity fix), this resolves via S alone — P must never run.
    const client = makeClient({
      account: {
        plan: "Business",
        selected_services: [{ service_id: "biz-erp-bring-your-own", status: "Active" }],
      },
      paidInvoices: [], // if P ran and needed this, the test would still pass by luck — assert it didn't run instead
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "biz-accounting" }],
    });
    ok(!!res.invoiceDocName, "unknown-id Active row unlocks add-ons via S alone");
    ok(client.listCalls.length === 0, "the paid-invoice scan never ran — S resolved it for free");
  }

  section("FIX ROUND 3 — Requirement 1 still holds with BOTH signals false");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "domain-com", status: "Active" }],
      },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "domain-com" }] }],
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting" }],
      }),
      400, "domain-only history in BOTH the account row and the paid invoice's own lines is still refused"
    );
    ok(client.posts.length === 0, "no invoice created for the rejected purchase");
  }
  {
    // Multiple paid domain invoices, still nothing non-domain anywhere.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [
        { name: "PINV-1", services: [{ service_id: "domain-com" }] },
        { name: "PINV-2", services: [{ service_id: "domain-net" }] },
        { name: "PINV-3", services: [{ service_id: "domain-io" }] },
      ],
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-storage" }],
      }),
      400, "three paid domain-only invoices still do not unlock real add-ons"
    );
  }

  section("FIX ROUND 3 — Requirement 2 costs ZERO extra queries (domain-only buys a domain)");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "domain-com", status: "Active" }],
      },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "domain-com" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "domain-net" }],
    });
    ok(!!res.invoiceDocName, "domain-only account buying another domain still succeeds");
    ok(client.listCalls.length === 0, "buying a domain never triggers the paid-invoice scan at all");
    ok(client.docGets.length === 0, "…and never fetches a single invoice document");
  }

  section("FIX ROUND 3 — Requirement 3 costs ZERO extra queries (real hosting account)");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-web-hosting", status: "Active" }],
      },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "domain-com" }] }], // present but irrelevant
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "real hosting account can still buy an add-on");
    ok(client.listCalls.length === 0, "S resolved it for free — the paid-invoice scan never ran");
  }

  section("FIX ROUND 3 — the fallback runs AT MOST ONCE per order, even with multiple services");
  {
    // biz-accounting + biz-webapps = 3072MB/40GB — both Medium-tier, the
    // smallest pair that fits the real KVM 2's 3200MB/40GB self-serve cap
    // (biz-crm-helpdesk in the original pairing pushed this to 3584MB, over
    // the cap after the resize — swapped, not weakened: still two premium,
    // non-volume services in one order, still needs the P-fallback for both).
    const client = makeClient({
      account: { plan: "Business", selected_services: [] },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "biz-pos-inventory" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "biz-accounting" }, { serviceId: "biz-webapps" }],
    });
    ok(!!res.invoiceDocName, "multi-service order with a rescuable history succeeds");
    ok(client.listCalls.length === 1, "the paid-invoice list scan ran exactly once for the whole order, not once per service");
  }

  section("FIX ROUND 3 — scan-budget semantics (accountHasPaidNonDomainInvoiceLine, direct)");
  {
    const manyDomainInvoices = Array.from({ length: 12 }, (_, i) => ({
      name: `PINV-DOM-${i}`,
      services: [{ service_id: "domain-com" }],
    }));
    const client = makeClient({ account: { plan: "Starter" }, paidInvoices: manyDomainInvoices });
    const result = await accountHasPaidNonDomainInvoiceLine({
      client, webAccountName: "acct-1", invoiceServicesField: "services", scanLimit: 12,
    });
    ok(result === null, "exhausting the scan budget (12 of 12, all domain) returns null — undetermined, not false");
  }
  {
    const elevenDomainInvoices = Array.from({ length: 11 }, (_, i) => ({
      name: `PINV-DOM-${i}`,
      services: [{ service_id: "domain-com" }],
    }));
    const client = makeClient({ account: { plan: "Starter" }, paidInvoices: elevenDomainInvoices });
    const result = await accountHasPaidNonDomainInvoiceLine({
      client, webAccountName: "acct-1", invoiceServicesField: "services", scanLimit: 12,
    });
    ok(result === false, "scanning all 11 (below the 12-item budget) and finding nothing is a DEFINITIVE false");
  }

  section("FIX ROUND 3 — Frappe errors fail OPEN, never silently deny");
  {
    // List query itself throws.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [],
      getError: "simulated Frappe outage",
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "a failed paid-invoice list scan fails open — purchase still succeeds");
  }
  {
    // List succeeds, but fetching a specific invoice document throws.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "starter-web-hosting" }] }],
      docGetError: "simulated Frappe outage",
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "a failed per-invoice fetch also fails open");
  }
  {
    // Direct unit check on resolveNonDomainPaidHistory's own fail-open path.
    const client = makeClient({ account: { plan: "Starter" }, getError: "boom" });
    const result = await resolveNonDomainPaidHistory({
      client, webAccountName: "acct-1", accountServiceRows: [], invoiceServicesField: "services",
    });
    ok(result === true, "resolveNonDomainPaidHistory itself returns true (fail open) when the fallback errors");
  }

  section("FIX ROUND 3 — Trial Verification invoices are excluded from the paid scan");
  {
    // Assert the query filter itself never includes Trial Verification.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "starter-web-hosting" }] }],
    });
    await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    const filters = String(client.listCalls[0]?.filters || "");
    ok(filters.includes("Subscription") && filters.includes("Add-on"), "filter includes Subscription and Add-on types");
    ok(!filters.includes("Trial Verification"), "filter does NOT include Trial Verification");
    ok(!filters.includes('"plan"'), "filter does NOT key on plan — must stay decoupled from hasPaidSubscriptionForPlan's semantics");
  }
  {
    // A domain-only account whose only OTHER paid invoice is a Trial
    // Verification for the ERP demo must NOT be treated as real history —
    // even though accountHasPaidNonDomainInvoiceLine's own predicate logic
    // doesn't see invoice type, the LIST query filters it out before any
    // line is ever inspected.
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "domain-com", status: "Active" }],
      },
      paidInvoices: [], // the Trial Verification invoice is deliberately absent —
      // simulating the list-query filter excluding it (a raw account-level
      // scan without the type filter would have found it and wrongly
      // returned true; this asserts the filtered scan does not).
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting" }],
      }),
      400, "domain-only account with a (filtered-out) trial invoice is still refused a real add-on"
    );
  }

  section("FIX ROUND 3 — an Add-on-type paid invoice counts as evidence too");
  {
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [{ name: "PINV-ADDON-1", services: [{ service_id: "db-mysql" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(!!res.invoiceDocName, "a paid Add-on invoice (not just Subscription) is valid evidence of real infrastructure");
  }

  section("FIX ROUND 3 — PLAN_NOT_PAID still short-circuits before any new query");
  {
    const client = makeClient({
      account: { plan: "Starter", selected_services: [] },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "starter-web-hosting" }] }],
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1",
        deps: { ...deps, hasPaidSubscriptionForPlan: async () => false },
        services: [{ serviceId: "starter-storage" }],
      }),
      403, "unpaid plan is refused before the eligibility loop (and its fallback) ever runs"
    );
    ok(client.listCalls.length === 0, "no paid-invoice scan happened — PLAN_NOT_PAID short-circuits first");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
