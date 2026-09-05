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
// `lastPaidInvoice`: fixture for checkoutBillingTerm.js's
// findLastPaidSubscriptionInvoice (billing-term derivation) — a single
// invoice, matched by a `type "=" "Subscription"` filter.
//
// `paidInvoices`: fixtures for the FIX ROUND 3 paid-invoice-line fallback
// (accountHasPaidNonDomainInvoiceLine) — each { name, services: [{service_id}, ...] },
// matched by a `type "in" [...]` filter. The list GET returns just their
// names; a per-doc GET returns the full fixture with its `services` array
// under whatever field name the caller's `invoiceServicesField` expects
// (addonInvoiceService.js passes PORTAL_INVOICE_SERVICES_FIELD =
// deps.PORTAL_INVOICE_SERVICES_FIELD, which `deps` below sets to "services"
// — matching the fixture key).
//
// Both real queries filter on status="Paid" against the same URL, so the
// mock discriminates on the `type` filter's operator ("=" vs "in") rather
// than on the URL — see the isTypeInScan check below.
//
// `listCalls`/`docGets` let tests assert exactly how many extra Frappe
// calls the fallback made — the zero-extra-query promise for Requirements
// 2 and 3 is only meaningful if something is actually counting.
function makeClient({ account, openInvoice = null, lastPaidInvoice = null, paidInvoices = [], getError = null, docGetError = null, fleetReservedMb = 0 }) {
  const posts = [];
  const puts = [];
  const listCalls = [];
  const docGets = [];
  return {
    posts, puts, listCalls, docGets,
    get: async (url, opts) => {
      // Fleet capacity gate (services/orderCapacity.js assertFleetHasHeadroom)
      // reads committed RAM from the Provisioning Job list. `fleetReservedMb`
      // lets a test simulate a full box; the default is an empty fleet so the
      // pricing/eligibility tests here are unaffected by the gate.
      if (url.includes("Provisioning%20Job") || url.includes("Provisioning Job")) {
        return { data: { data: fleetReservedMb > 0 ? [{ ram_mb: fleetReservedMb }] : [] } };
      }
      if (url.includes("/Web Account/") || url.includes("/Web%20Account/"))
        return { data: { data: account } };
      if (url === "/api/resource/Portal Invoice" && opts?.params) {
        const filters = JSON.parse(opts.params.filters || "[]");
        const isPaidScan = filters.some((f) => f[0] === "status" && f[2] === "Paid");
        if (isPaidScan) {
          const typeFilter = filters.find((f) => f[0] === "type");
          const isTypeInScan = typeFilter && typeFilter[1] === "in";
          if (isTypeInScan) {
            // The FIX ROUND 3 paid-invoice list scan.
            listCalls.push(opts.params);
            if (getError) throw new Error(getError);
            return { data: { data: paidInvoices.map((i) => ({ name: i.name })) } };
          }
          return { data: { data: lastPaidInvoice ? [lastPaidInvoice] : [] } };
        }
        // findOpenInvoice's unpaid-status list — unrelated to either fallback.
        return { data: { data: openInvoice ? [openInvoice] : [] } };
      }
      const hit = paidInvoices.find((i) => url.includes(i.name));
      if (hit) {
        docGets.push(hit.name);
        if (docGetError) throw new Error(docGetError);
        return { data: { data: { name: hit.name, services: hit.services || [] } } };
      }
      if (lastPaidInvoice && url.includes(`/api/resource/Portal Invoice/${lastPaidInvoice.name}`))
        return { data: { data: lastPaidInvoice } };
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
    // 1200 monthly + 500 one-time setup, both read from the catalog snapshot
    // rather than from anything in the request body.
    ok(res.amountKes === 1700, "amount priced from snapshot, not request");
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
    // 3800 as of 2026-08-17's wholesale-cost pricing correction — see
    // DOMAIN_TLD_PRICES in backend/server.js.
    ok(res.amountKes === 3800, "second domain priced from snapshot (domain-net = 3800)");
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
    // Last paid Subscription invoice dated 182 days ago -> ~half the year left.
    const started = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: {
        plan: "Starter",
        // Non-empty, non-domain paid history so the add-on eligibility gate
        // (addonEligibility.js's hasNonDomainPaidHistory check) doesn't
        // reject this purchase before pricing is ever computed.
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      lastPaidInvoice: { name: "PINV-PAID-1", invoice_date: started, billing_term: "annual" },
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    const fullAnnual = annualPrepayKes(1200); // starter-web-hosting is 1200/mo
    const setupFee = 500; // starter-web-hosting's one-time setup fee (catalog snapshot) — never pro-rated
    const expectedRecurring = Math.round(fullAnnual * (183 / 365));
    ok(res.amountKes < fullAnnual + setupFee, "mid-term add-on costs less than a full annual term plus setup");
    ok(res.amountKes > 1200, "but more than a single month");
    ok(
      Math.abs(res.amountKes - (expectedRecurring + setupFee)) <= 100,
      "roughly half the annual price with ~half the term left, plus the one-time setup fee"
    );
  }

  section("annual-term accounts: merged open invoice is pro-rated too, not flat monthly");
  {
    const { proRatedAddonKes, daysRemainingInTerm } = require("../services/billingTerm");
    // Last paid Subscription invoice dated 181 days ago -> 184 days
    // remaining. The two merged services here are priced DIFFERENTLY
    // (starter-storage 1200, starter-email 1500) and 184 is a day count at
    // which proRatedAddonKes(1200,184) + proRatedAddonKes(1500,184)
    // provably differs (by rounding) from the naive
    // proRatedAddonKes(1200+1500,184) — i.e. "sum the monthly prices first,
    // pro-rate once" gives a DIFFERENT number than "pro-rate each service's
    // price, then sum".
    const started = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // An existing OPEN unpaid add-on invoice already carries one service
    // (storage). The new purchase (email) must merge into it — and the
    // MERGED total must be pro-rated per-service, not the flat monthly sum
    // of both rows, and not a single pro-ration of the summed monthly price.
    const openInvoice = {
      name: "PINV-OPEN-1",
      status: "Unpaid",
      services: [
        { serviceId: "starter-storage", serviceName: "File Storage (25GB)", tier: "Light", domainChoice: "", status: "Awaiting Payment" },
      ],
    };
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-PAID-2", invoice_date: started, billing_term: "annual" },
      openInvoice,
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps: { ...deps, findOpenInvoice: async () => openInvoice },
      services: [{ serviceId: "starter-email", serviceName: "Business Email", tier: "Light", domainChoice: "" }],
    });
    ok(res.invoiceDocName === "PINV-OPEN-1", "merges into the existing open invoice, not a new one");
    ok(res.amountKes !== 1200 + 1500, "merged amount is NOT the flat monthly sum of both add-ons (2700)");
    const days = daysRemainingInTerm(started);
    const perServiceExpected = proRatedAddonKes(1200, days) + proRatedAddonKes(1500, days);
    const naiveSumThenProRateExpected = proRatedAddonKes(1200 + 1500, days);
    ok(
      perServiceExpected !== naiveSumThenProRateExpected,
      "sanity check on fixture: per-service pro-ration and sum-then-pro-rate-once actually diverge at this day count"
    );
    ok(res.amountKes === perServiceExpected, "merged amount equals the sum of each service's pro-rated annual price");
    ok(res.amountKes !== naiveSumThenProRateExpected, "merged amount is NOT the naive sum-then-pro-rate-once amount");
    ok(client.puts.length === 1, "existing open invoice was updated via PUT, not re-created via POST");
    ok(client.puts[0].body.amount === perServiceExpected, "the PUT body's amount field is also pro-rated per-service");
  }

  section("guard: corrupted annual account cannot get a free (KES 0) add-on invoice");
  {
    // Fresh-invoice branch — the last paid invoice is missing invoice_date entirely.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-1", billing_term: "annual" }, // invoice_date omitted
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
      }),
      422, "missing invoice_date on the last paid annual invoice is refused, not billed free (fresh path)"
    );
    ok(client.posts.length === 0, "no invoice was created for the rejected purchase");
  }
  {
    // Fresh-invoice branch — garbage/unparseable invoice_date.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-2", billing_term: "annual", invoice_date: "not-a-real-date" },
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
      }),
      422, "unparseable invoice_date on the last paid annual invoice is refused, not billed free (fresh path)"
    );
  }
  {
    // Merged-invoice branch — same corruption, but this time there's
    // already an open unpaid add-on invoice, so the merged branch (not the
    // fresh branch) is what would otherwise compute a free amount.
    const openInvoice = {
      name: "PINV-OPEN-CORRUPT",
      status: "Unpaid",
      services: [
        { serviceId: "starter-storage", serviceName: "File Storage (25GB)", tier: "Light", domainChoice: "", status: "Awaiting Payment" },
      ],
    };
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-3", billing_term: "annual" }, // invoice_date omitted
      openInvoice,
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1",
        deps: { ...deps, findOpenInvoice: async () => openInvoice },
        services: [{ serviceId: "starter-email", serviceName: "Business Email", tier: "Light", domainChoice: "" }],
      }),
      422, "missing invoice_date on the last paid annual invoice is refused, not billed free (merged path)"
    );
    ok(client.puts.length === 0, "no invoice was updated for the rejected merge");
  }

  section("guard does not fire on legitimate (non-corrupted) zero/near-zero amounts");
  {
    // A valid term_started_on that lands EXACTLY on the term's last day is a
    // real, legitimate KES 0 pro-rated amount, not corruption — the guard
    // must not catch it. (No genuinely zero-priced service scenario exists
    // to test here: the per-service eligibility loop above already rejects
    // any newly-selected service with monthlyKes <= 0 with its own 400,
    // before pricing ever runs, so a zero-priced add-on can never reach this
    // guard via the fresh-invoice path; a merge could only reach it if every
    // merged row — including pre-existing ones — were priced at 0, which
    // does not occur for any real catalog add-on.)
    const startedExactlyAYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-EXACT-1", billing_term: "annual", invoice_date: startedExactlyAYearAgo },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    // The recurring portion legitimately pro-rates to KES 0, but the one-time
    // setup fee (500, never pro-rated) is still charged — so the invoice
    // total is 500, not 0, and the guard (which checks the recurring amount
    // alone) must not fire on either figure.
    ok(res.amountKes === 500, "term's last day legitimately produces a KES 0 recurring amount, plus the flat setup fee");
    ok(!!res.invoiceDocName, "the guard does not block a legitimate zero — invoice is still created");
  }
  {
    const startedLateInTerm = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-LATE-1", billing_term: "annual", invoice_date: startedLateInTerm },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes > 0, "small-but-nonzero days-remaining still bills a small nonzero amount, not blocked");
  }
  {
    // A monthly-term account never touches the guard at all.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-MONTHLY-1", billing_term: "monthly", invoice_date: "2026-01-01" },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1700, "monthly account is unaffected by the annual-only guard (1200 monthly + 500 setup)");
  }

  section("monthly-term and legacy accounts are billed exactly as before");
  {
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      // Pre-existing invoice, no billing_term field at all -> monthly fail-safe.
      lastPaidInvoice: { name: "PINV-LEGACY-1", invoice_date: "2026-01-01" },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1700, "legacy account (no billing_term on its last paid invoice) still bills the monthly price (1200 + 500 setup)");
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
    // biz-accounting (demoted+paid, 1536MB) + addon-staging (new purchase,
    // 512MB) = 2048MB, exactly the self-serve cap.
    //
    // This pair used to be biz-accounting + biz-webapps = 3072MB. That is no
    // longer servable at all: sellableRamMb was corrected 6400 -> 3000 on
    // 2026-09-05 to match measured free RAM, and 3072 exceeds the entire pool.
    // Since the smallest Medium-tier items are 1536MB each and everything at
    // or below 1024MB is Light/Demo tier, NO pair of Medium-tier services fits
    // any more — a Business account can self-serve exactly one of them.
    // That is a real product constraint, not a test detail; it is called out
    // in docs and the capacity block in serviceCatalog.ts.
    const client = makeClient({
      account: {
        plan: "Business",
        selected_services: [{ service_id: "biz-accounting", status: "Awaiting Payment" }],
      },
      paidInvoices: [{ name: "PINV-SUB-1", services: [{ service_id: "biz-accounting" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "addon-staging" }],
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
    // biz-accounting (1536MB) + addon-staging (512MB) = 2048MB, exactly the
    // self-serve cap.
    //
    // This IS weakened, and deliberately so — say it rather than hide it. The
    // scenario wants two *premium* services in one order, but the smallest
    // premium pair is 3072MB and sellableRamMb is now 3000 (corrected from
    // 6400 on 2026-09-05 to match measured free RAM). Two premium services in
    // one order is no longer expressible on this box at any coherent cap.
    // What still holds, and is what this test actually asserts: a multi-service
    // order scans the paid-invoice history exactly once, not once per service.
    const client = makeClient({
      account: { plan: "Business", selected_services: [] },
      paidInvoices: [{ name: "PINV-1", services: [{ service_id: "biz-pos-inventory" }] }],
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "biz-accounting" }, { serviceId: "addon-staging" }],
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

  // ------------------------------------------------------------------
  // SETUP FEES — the catalog prices a one-time setupKes on most services
  // and the checkout page shows the customer monthlyKes + setupKes
  // (services/checkout/orderStore.js's totalDueKes). Before this, every
  // invoice amount came from sumSelectedServicesMonthlyKes() alone, so the
  // setup fee was displayed and never billed: KES 12,000 on
  // biz-erp-configured, 5,000 on biz-erp-light, 3,000 on biz-pos-inventory,
  // 500-2,000 on the rest, silently dropped on every single sale.
  //
  // Setup is ONE-TIME. It belongs on the first invoice for a service and
  // must never reach renewalService.js's monthly sweep — hence a separate
  // sumSelectedServicesSetupKes() rather than folding it into the monthly
  // total that renewals also read.
  // ------------------------------------------------------------------

  section("SETUP FEES — a new add-on invoice bills monthly + one-time setup");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
    });
    // starter-web-hosting: monthlyKes 1200 + setupKes 500.
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting" }],
    });
    const body = client.posts[0]?.body;
    ok(body?.amount === 1700, `invoice amount is 1200 monthly + 500 setup = 1700 (got ${body?.amount})`);
    ok(res.amountKes === 1700, `returned amountKes matches the invoice (got ${res.amountKes})`);
  }

  section("SETUP FEES — a service with no setup fee is unchanged");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
    });
    // starter-storage: monthlyKes 1200, no setupKes.
    await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-storage" }],
    });
    ok(client.posts[0]?.body?.amount === 1200, `no setup fee -> amount stays 1200 (got ${client.posts[0]?.body?.amount})`);
  }

  section("SETUP FEES — merging into an open invoice bills every unpaid row's setup");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      // Rows are shaped as normalizeInvoiceServiceRow returns them (deps
      // stubs it to the identity), so they must carry `serviceId` — a
      // `service_id` row is filtered out by the !!s.serviceId guard and the
      // merge would silently test nothing.
      openInvoice: {
        name: "PINV-OPEN-1", status: "Unpaid", amount: 1700,
        services: [{ serviceId: "starter-web-hosting", status: "Awaiting Payment" }],
      },
    });
    await createAddonInvoice({
      client, webAccountName: "acct-1",
      deps: { ...deps, findOpenInvoice: async () => ({ name: "PINV-OPEN-1", status: "Unpaid" }) },
      services: [{ serviceId: "db-mysql" }],
    });
    // starter-web-hosting 1200+500, db-mysql 2000+500 -> 4200
    const put = client.puts[0]?.body;
    ok(put?.amount === 4200, `merged invoice bills both setups: 1700 + 2500 = 4200 (got ${put?.amount})`);
  }

  section("FLEET CAPACITY — an add-on is refused when the box is full");
  {
    // 2000MB already committed fleet-wide; the threshold is 85% of
    // sellableRamMb = 85% of 3000 = 2550. Adding starter-db-light (768MB)
    // crosses it -> 409.
    //
    // Numbers rescaled with sellableRamMb 6400 -> 3000 (2026-09-05). The
    // shapes had to change, not just the constants: the old scenario bought
    // biz-erp-light (2048MB) on top of an active starter-app-hosting
    // (1024MB), which now sums to 3072MB and trips the 2048MB per-order cap
    // with a 422 BEFORE the fleet gate is ever consulted — testing the wrong
    // guard. The footprint is kept under the per-order cap so that this
    // exercises the fleet gate specifically, which is the point of the case.
    //
    // The original point still stands: without the fleet gate, only the
    // per-order cap would apply, so unlimited customers could each buy onto a
    // box with room for a couple.
    const client = makeClient({
      account: {
        plan: "Business",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      fleetReservedMb: 2000,
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-db-light" }],
      }),
      409, "add-on purchase on a full box is refused"
    );
    ok(client.posts.length === 0, "no invoice was created for the refused purchase");
  }

  section("FLEET CAPACITY — a zero-footprint domain is still buyable on a full box");
  {
    const client = makeClient({
      account: {
        plan: "Starter",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      fleetReservedMb: 6400,
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "domain-com", domainChoice: "example.com" }],
    });
    ok(!!res.invoiceDocName, "domain purchase succeeds even with the node completely committed");
  }

  section("SETUP FEES — renewals must never re-charge setup");
  {
    const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");
    // renewalService.js bills with this function every ~30 days. If setup
    // ever leaks into it, every customer is re-charged their setup fee
    // monthly, forever.
    const monthly = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    ok(monthly === 1200, `monthly sum excludes the 500 setup fee (got ${monthly})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
