/**
 * /api/orders route tests — runs without Redis or Frappe.
 *   node test/ordersRoutes.test.js   (or: npm test)
 *
 * Instantiates the ordersRoutes factory directly (no HTTP server) and calls
 * handlers with stub req/res, backed by the shared in-memory mock Frappe
 * client. Covers the happy-path draft order, the fleet-capacity 409, the
 * ownership 403, both prepare-payment branches (add-on vs. first-purchase),
 * prepare-payment idempotency, and the waitlist endpoint.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const createOrdersRouter = require("../routes/ordersRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const { createOrder, getOrder, cancelOrder, linkInvoice } = require("../services/checkout/orderStore");
const { assertOrderWithinCapacity } = require("../services/orderCapacity");
const { sumSelectedServicesMonthlyKes, sumSelectedServicesSetupKes } = require("../services/provisioning/catalog");
const { annualPrepayKes } = require("../services/billingTerm");
const realCreateAddonInvoice = require("../services/addonInvoiceService").createAddonInvoice;
process.env.BUNDLES_ENABLED = "true";

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.headers = {};
  r.set = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.setHeader = r.set;
  return r;
}
function findHandler(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`No route registered for ${method.toUpperCase()} ${path}`);
  // last handler in the stack is the business handler (first is requireAuth)
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// ---- Minimal, faithful-enough stand-ins for the server.js helpers that
// aren't independently importable (server.js is a monolith). Mirrors the
// real implementations closely; pricing itself always comes from the real
// catalog snapshot via the real orderStore/orderCapacity modules above. ----

function normalizeSelectedServices(input) {
  return (Array.isArray(input) ? input : [])
    .map((s) => ({
      serviceId: String(s?.serviceId || s?.service_id || "").trim(),
      serviceName: String(s?.serviceName || s?.service_name || "").trim(),
      tier: String(s?.tier || "").trim(),
      domainChoice: String(s?.domainChoice || s?.domain_choice || "").trim(),
      status: String(s?.status || "").trim() === "Active" ? "Active" : "Awaiting Payment",
    }))
    .filter((s) => !!s.serviceId);
}

function mergeServicesById(existing = [], incoming = []) {
  const merged = new Map();
  existing.forEach((s) => {
    if (!s?.serviceId) return;
    merged.set(String(s.serviceId).trim(), {
      serviceId: String(s.serviceId).trim(),
      serviceName: s.serviceName || "",
      tier: s.tier || "",
      domainChoice: s.domainChoice || "",
      status: s.status || "Awaiting Payment",
    });
  });
  incoming.forEach((s) => {
    if (!s?.serviceId) return;
    const key = String(s.serviceId).trim();
    if (!merged.has(key)) {
      merged.set(key, {
        serviceId: key,
        serviceName: s.serviceName || "",
        tier: s.tier || "",
        domainChoice: s.domainChoice || "",
        status: "Awaiting Payment",
      });
    }
  });
  return Array.from(merged.values());
}

function buildWebAccountServiceRows(rows) {
  return rows.map((s) => ({
    doctype: "Web Account Service",
    serviceId: s.serviceId,
    serviceName: s.serviceName || "",
    tier: s.tier || "",
    domainChoice: s.domainChoice || "",
    status: s.status || "Awaiting Payment",
  }));
}

async function fetchWebAccount(client, webAccountName) {
  const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
  return res.data?.data;
}

async function updateWebAccountServices(client, webAccountName, rows) {
  return client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
    selected_services: rows,
  });
}

// Faithful-enough stand-in for server.js's applyPlanAndCreateInvoice: mirrors
// its real call-style flexibility (3rd arg can be a services array OR an
// opts object) AND — this is the part a prior version of this mock got
// wrong — its zero-amount skip: pricing comes from the real catalog
// snapshot via sumSelectedServicesMonthlyKes, and an empty/unpriced
// selection creates NO invoice, exactly like the real function
// (server.js:1471-1472). That divergence previously masked a regression
// where the real call site passed an opts object instead of a services
// array and silently stopped creating invoices — see
// "prepare-payment — first-purchase branch bills a real service" below.
async function applyPlanAndCreateInvoice(client, webAccountName, planKey, selectedServicesOrOpts = [], maybeOpts = {}) {
  const selectedServices = Array.isArray(selectedServicesOrOpts) ? selectedServicesOrOpts : [];
  const opts = Array.isArray(selectedServicesOrOpts) ? (maybeOpts || {}) : (selectedServicesOrOpts || {});
  const { force = false } = opts;

  await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
    plan: planKey,
    ...(force ? { account_status: "Active" } : {}),
  });

  const amount = sumSelectedServicesMonthlyKes(selectedServices);
  if (amount <= 0) return { ok: true, skipped: true, reason: "zero_amount" };

  const created = await client.post("/api/resource/Portal Invoice", {
    web_account: webAccountName,
    type: "Subscription",
    plan: planKey,
    status: "Unpaid",
    amount,
  });
  return { ok: true, invoice: created.data?.data };
}

function baseCtx(client, overrides = {}) {
  return {
    requireAuth: (req, res, next) => next(), // never invoked directly; findHandler skips it
    frappeClient: () => client,
    assertOrderWithinCapacity,
    getReservedRamMb: async () => 0,
    createOrder,
    getOrder,
    cancelOrder,
    linkInvoice,
    createAddonInvoice: async () => {
      throw new Error("createAddonInvoice should not be called in this test");
    },
    hasPaidSubscriptionForPlan: async () => false,
    fetchWebAccount,
    applyPlanAndCreateInvoice,
    updateWebAccountServices,
    asArray: (v) => (Array.isArray(v) ? v : []),
    normalizeSelectedServices,
    findOpenInvoice: async () => null,
    normalizeInvoiceServiceRow: (r) => r,
    buildInvoiceServiceRows: (rows) => rows,
    PORTAL_INVOICE_SERVICES_FIELD: "services",
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    mergeServicesById,
    buildWebAccountServiceRows,
    CAPACITY_REQUEST_DOCTYPE: "Capacity Request",
    sumSelectedServicesMonthlyKes,
    ...overrides,
  };
}

(async () => {
  section("POST /api/orders — happy path");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");
    const req = {
      session: { webAccount: "acct-1" },
      body: { serviceId: "starter-web-hosting", config: { domainChoice: "Use Murzak Subdomain" }, planKey: "Starter", source: "CloudLaunch" },
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.ok === true, "ok true");
    ok(res.body?.order?.monthlyKes === 1200, "monthlyKes === 1200");
    ok(res.body?.order?.status === "Draft", "status === Draft");
  }

  section("POST /api/orders — fleet capacity exceeded -> 409 CAPACITY");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client, { getReservedRamMb: async () => 999999 }));
    const handler = findHandler(router, "post", "/api/orders");
    const req = { session: { webAccount: "acct-1" }, body: { serviceId: "starter-web-hosting" } };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 409, "status 409");
    ok(res.body?.code === "CAPACITY", "code === CAPACITY");
    ok(res.body?.waitlistAvailable === true, "waitlistAvailable === true");
  }

  section("GET /api/orders/:id — another account is 403");
  {
    const client = makeMockFrappe();
    const ctx = baseCtx(client);
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const getHandler = findHandler(router, "get", "/api/orders/:id");

    const createRes = makeRes();
    await createHandler({ session: { webAccount: "acct-1" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await getHandler({ session: { webAccount: "intruder" }, params: { id: orderId } }, res);
    ok(res.statusCode === 403, "status 403");
  }

  section("GET /api/orders/:id — eligibleForTermChoice");
  {
    // No ctx override here: ordersRoutes.js imports isEligibleForTermChoice
    // directly as a plain module function (mirroring annualPrepayKes), never
    // reading it off ctx, so a ctx override wouldn't affect the real call
    // below. The real function returns true here because acct-elig
    // genuinely has no paid Subscription invoice on file — a real first
    // purchase, the actual condition this test documents.
    const client = makeMockFrappe({
      "Web Account": { "acct-elig": { name: "acct-elig", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client);
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const get = findHandler(router, "get", "/api/orders/:id");

    const createRes = makeRes();
    await create({ session: { webAccount: "acct-elig" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await get({ session: { webAccount: "acct-elig" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.order?.eligibleForTermChoice === true, "eligibleForTermChoice reflects the real eligibility check (no paid invoice history)");
  }
  {
    // Fail-safe direction: an eligibility-check error must resolve to
    // false, never true — showing an inappropriate term choice to an
    // existing customer (C5) is the risk here, the opposite direction from
    // the renewal sweep's fail-safe-to-monthly.
    //
    // ordersRoutes.js imports isEligibleForTermChoice directly as a plain
    // module function (mirroring annualPrepayKes) rather than reading it off
    // ctx, so a ctx override can't simulate the failure here — force a
    // genuine failure in its one dependency instead (the Portal Invoice list
    // query it runs internally), exactly as a real Frappe outage would.
    const client = makeMockFrappe({
      "Web Account": { "acct-elig-err": { name: "acct-elig-err", plan: "None", selected_services: [] } },
    });
    const realGet = client.get;
    client.get = async (url, ...rest) => {
      if (url === "/api/resource/Portal Invoice") throw new Error("boom");
      return realGet(url, ...rest);
    };
    const ctx = baseCtx(client);
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const get = findHandler(router, "get", "/api/orders/:id");

    const createRes = makeRes();
    await create({ session: { webAccount: "acct-elig-err" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await get({ session: { webAccount: "acct-elig-err" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200 (GET order itself still succeeds)");
    ok(res.body?.order?.eligibleForTermChoice === false, "eligibility check failure fails safe to false");
  }

  section("prepare-payment — add-on branch (has paid plan)");
  let addonOrderId;
  let addonClient;
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-1": { name: "acct-1", plan: "Starter", selected_services: [] } },
    });
    addonClient = client;
    let createAddonCalls = 0;
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => {
        createAddonCalls++;
        return { invoiceDocName: "PINV-9" };
      },
    });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler({ session: { webAccount: "acct-1" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    addonOrderId = createRes.body.order.id;

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-1" }, params: { id: addonOrderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.invoiceDocName === "PINV-9", "invoiceDocName === PINV-9");
    ok(createAddonCalls === 1, "createAddonInvoice called once");
    ok(client.store["Checkout Order"][addonOrderId].invoice_doc_name === "PINV-9", "order doc invoice_doc_name linked");
    // Regression (live 2026-08-11): createAddonInvoice only prices/invoices —
    // attaching the service to the Web Account is documented as the caller's
    // job. Without it, an existing paying customer's purchase invoiced and
    // paid clean but the service never appeared on the account, and nothing
    // ever got provisioned (activation only flips status on rows that
    // already exist, it never appends).
    ok(
      client.store["Web Account"]["acct-1"].selected_services.some((r) => r.serviceId === "starter-web-hosting"),
      "add-on service is attached to the Web Account at prepare-payment time, not left orphaned in the invoice only"
    );

    section("prepare-payment — idempotent on second call");
    const res2 = makeRes();
    await prepHandler({ session: { webAccount: "acct-1" }, params: { id: addonOrderId } }, res2);
    ok(res2.statusCode === 200, "second call status 200");
    ok(res2.body?.invoiceDocName === "PINV-9", "second call same invoiceDocName");
    ok(createAddonCalls === 1, "createAddonInvoice NOT called again");
  }

  // ------------------------------------------------------------------
  // ORDER <-> INVOICE BINDING
  //
  // The checkout page quotes the customer exactly one number: this order's
  // totalDueKes (monthly + setup, from services/checkout/orderStore.js).
  // prepare-payment used to hand the order to createAddonInvoice, which
  // adopts any existing OPEN unpaid Add-on invoice and recomputes its amount
  // across every row on it — including services from checkouts the customer
  // abandoned earlier. The buyer then saw one number and was charged another,
  // and the abandoned service silently activated alongside the one they meant
  // to buy. An order must be billed what it quoted, and nothing else.
  // ------------------------------------------------------------------
  section("prepare-payment — an abandoned open invoice does not change what this order charges");
  {
    const realCreateAddonInvoice = require("../services/addonInvoiceService").createAddonInvoice;
    const client = makeMockFrappe({
      "Web Account": {
        "acct-1": {
          name: "acct-1", plan: "Starter", account_holder_name: "Test Co",
          // an already-owned, paid service so the add-on eligibility gate passes
          selected_services: [{ serviceId: "starter-app-hosting", status: "Active" }],
        },
      },
      // The abandoned checkout: an unpaid Add-on invoice for a DIFFERENT service.
      "Portal Invoice": {
        "PINV-ABANDONED": {
          name: "PINV-ABANDONED", web_account: "acct-1", type: "Add-on", status: "Unpaid",
          amount: 1700,
          services: [{ serviceId: "starter-web-hosting", status: "Awaiting Payment" }],
        },
      },
    });
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: realCreateAddonInvoice,
      // the real service looks for an open unpaid Add-on invoice — give it one
      findOpenInvoice: async () => ({ name: "PINV-ABANDONED", status: "Unpaid" }),
    });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    // db-mysql: monthlyKes 2000 + setupKes 500 => the page quotes 2500
    await createHandler({ session: { webAccount: "acct-1" }, body: { serviceId: "db-mysql" } }, createRes);
    const orderId = createRes.body.order.id;
    const quoted = createRes.body.order.totalDueKes;
    ok(quoted === 2500, `checkout quoted 2000 monthly + 500 setup = 2500 (got ${quoted})`);

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-1" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const linked = client.store["Portal Invoice"][res.body.invoiceDocName];
    ok(
      linked.amount === quoted,
      `the invoice bound to this order bills exactly what the page quoted: ${quoted} (got ${linked?.amount})`
    );
    ok(
      res.body.invoiceDocName !== "PINV-ABANDONED",
      `the order gets its own invoice, not the abandoned one (got ${res.body.invoiceDocName})`
    );
    const abandoned = client.store["Portal Invoice"]["PINV-ABANDONED"];
    ok(
      abandoned.amount === 1700 && abandoned.services.length === 1,
      "the abandoned invoice is left untouched, not silently grown"
    );
  }

  section("prepare-payment — first-purchase branch (no paid plan)");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-2": { name: "acct-2", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-2" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-2" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(typeof res.body?.invoiceDocName === "string" && res.body.invoiceDocName.length > 0, "invoiceDocName returned");

    const acct = client.store["Web Account"]["acct-2"];
    ok(acct.plan === "Starter", "plan applied to account");
    ok(
      (acct.selected_services || []).some((r) => r.serviceId === "starter-web-hosting"),
      "order's service merged into account selected_services"
    );
    ok(
      client.store["Checkout Order"][orderId].invoice_doc_name === res.body.invoiceDocName,
      "order doc linked to the created invoice"
    );

    // Regression guard for the Critical first-purchase bug: the route MUST
    // call applyPlanAndCreateInvoice with the order's service as a non-empty
    // array (not just an opts object), or the real function bills KES 0 and
    // skips invoice creation entirely — leaving nothing for
    // fetchInvoicesForUser to find and a guaranteed 500 back at the browser.
    const createdInvoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!createdInvoice, "an actual Portal Invoice doc was created (not skipped)");
    ok(createdInvoice?.amount === 1200, "invoice amount reflects the order's service (KES 1200), not zero_amount skip");
    ok(createdInvoice?.status === "Unpaid", "created invoice is Unpaid");
  }

  // ---- prepare-payment — first-purchase annual amount correction ----
  // Regression coverage for the Critical money bug: applyPlanAndCreateInvoice
  // has no billing-term awareness and always bills the plain monthly sum, so
  // a first-time annual purchase must have its just-created invoice's amount
  // corrected in the route (see the comment above the correction code in
  // ordersRoutes.js). These prove the correction fires exactly on the
  // first-purchase branch and exactly when the effective term is annual —
  // and that the sibling add-on branch, which already bills correctly via
  // createAddonInvoice, is never touched by it.

  section("prepare-payment — first purchase, eligible, confirmed annual: bills the annual-prepay amount");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-ann-amt": { name: "acct-ann-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-ann-amt" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    // The confirmed term is carried on THIS call — the checkout page defers
    // prepare-payment until the customer has picked a term, so there is no
    // separate "at order creation" term to fall back to anymore.
    const res = makeRes();
    await prep({ session: { webAccount: "acct-ann-amt" }, params: { id: orderId }, body: { billingTerm: "annual" } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const expectedAnnual = annualPrepayKes(monthlySum);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === expectedAnnual,
      `invoice amount === annualPrepayKes(monthly) (${expectedAnnual}), got ${invoice.amount}`
    );
    ok(invoice.amount !== monthlySum, "invoice amount is NOT the plain monthly sum (the confirmed bug)");
    ok(invoice.billing_term === "annual", "the created invoice itself carries billing_term=annual");
  }

  section("prepare-payment — first purchase, eligible, omitted term bills the plain monthly sum");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-mo-amt": { name: "acct-mo-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-mo-amt" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-mo-amt" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === monthlySum,
      `invoice amount === plain monthly sum (${monthlySum}), untouched by the annual correction`
    );
    ok(!("billing_term" in invoice), "no billing_term written on a monthly invoice");
  }

  section("prepare-payment — add-on branch is NOT double-converted, even if a term is sent");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-addon-ann": { name: "acct-addon-ann", plan: "Starter", selected_services: [] } },
    });
    // createAddonInvoice already produces the correct pro-rated annual amount
    // internally (this task deliberately leaves that path untouched) —
    // simulate that by seeding a Portal Invoice with a known "already
    // correct" amount, and prove the first-purchase-only annual correction
    // in ordersRoutes.js never re-applies annualPrepayKes to it (which
    // would 12x-overcharge a real add-on).
    client.store["Portal Invoice"] = client.store["Portal Invoice"] || {};
    client.store["Portal Invoice"]["PINV-ADDON-1"] = { name: "PINV-ADDON-1", amount: 5000, status: "Unpaid" };
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => ({ invoiceDocName: "PINV-ADDON-1" }),
    });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-addon-ann" }, body: { serviceId: "starter-web-hosting", billingTerm: "annual" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-addon-ann" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.invoiceDocName === "PINV-ADDON-1", "invoiceDocName from createAddonInvoice");

    const invoice = client.store["Portal Invoice"]["PINV-ADDON-1"];
    ok(
      invoice.amount === 5000,
      "add-on invoice amount unchanged by the first-purchase-only annual correction (not 12x'd)"
    );
  }

  section("prepare-payment — an ineligible order's client-sent 'annual' is silently ignored");
  {
    // acct-not-eligible already has a paid Subscription invoice on file
    // (seeded directly, simulating a returning customer), so this account
    // is NOT eligible for a term choice on a new purchase — the server must
    // re-verify this itself and never trust the client's billingTerm.
    const client = makeMockFrappe({
      "Web Account": { "acct-not-eligible": { name: "acct-not-eligible", plan: "None", selected_services: [] } },
      "Portal Invoice": {
        "PINV-OLD-PAID": {
          name: "PINV-OLD-PAID",
          web_account: "acct-not-eligible",
          type: "Subscription",
          status: "Paid",
          invoice_date: "2026-01-01",
        },
      },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-not-eligible" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep(
      { session: { webAccount: "acct-not-eligible" }, params: { id: orderId }, body: { billingTerm: "annual" } },
      res
    );
    ok(res.statusCode === 200, "status 200");
    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(invoice.amount === monthlySum, "billed the plain monthly sum, NOT annualPrepayKes, despite the client's annual request");
    ok(!("billing_term" in invoice) || invoice.billing_term !== "annual", "invoice is not stamped annual for an ineligible purchase");
  }

  // ------------------------------------------------------------------
  // FIX ROUND 3 (defect c): prepare-payment used to round-trip the Web
  // Account's EXISTING selected_services rows through the client-input
  // normalizer (normalizeSelectedServices), which collapses any status
  // other than "Active" to "Awaiting Payment" — silently demoting a row
  // that was "Setting up" (mid-provisioning) or "Suspended" (lapsed
  // renewal) every time the customer bought anything else. Both branches
  // (add-on and first-purchase) now use the status-preserving
  // normalizeExistingAccountServiceRows instead. These fail before that fix.
  // ------------------------------------------------------------------

  section("prepare-payment — add-on branch preserves 'Setting up' on an unrelated existing row");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-3": {
          name: "acct-3",
          plan: "Business",
          selected_services: [{ service_id: "biz-pos-inventory", status: "Setting up" }],
        },
      },
    });
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => ({ invoiceDocName: "PINV-30" }),
    });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-3" }, body: { serviceId: "starter-storage" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-3" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const rows = client.store["Web Account"]["acct-3"].selected_services || [];
    const existing = rows.find((r) => r.serviceId === "biz-pos-inventory");
    ok(!!existing, "the pre-existing row survives the write");
    ok(existing?.status === "Setting up", `pre-existing row keeps status "Setting up" (got "${existing?.status}")`);

    const fresh = rows.find((r) => r.serviceId === "starter-storage");
    ok(fresh?.status === "Awaiting Payment", "the newly-purchased row is still 'Awaiting Payment' as expected");
  }

  section("prepare-payment — add-on branch preserves 'Suspended' on an unrelated existing row");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-4": {
          name: "acct-4",
          plan: "Starter",
          selected_services: [{ service_id: "starter-web-hosting", status: "Suspended" }],
        },
      },
    });
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => ({ invoiceDocName: "PINV-31" }),
    });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-4" }, body: { serviceId: "starter-storage" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-4" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const rows = client.store["Web Account"]["acct-4"].selected_services || [];
    const existing = rows.find((r) => r.serviceId === "starter-web-hosting");
    ok(existing?.status === "Suspended", `pre-existing row keeps status "Suspended" (got "${existing?.status}")`);
  }

  section("prepare-payment — add-on branch does not disturb an Active row (regression guard)");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-5": {
          name: "acct-5",
          plan: "Starter",
          selected_services: [{ service_id: "starter-web-hosting", status: "Active" }],
        },
      },
    });
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => ({ invoiceDocName: "PINV-32" }),
    });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-5" }, body: { serviceId: "starter-storage" } },
      createRes
    );
    const orderId = createRes.body.order.id;
    await prepHandler({ session: { webAccount: "acct-5" }, params: { id: orderId } }, makeRes());

    const rows = client.store["Web Account"]["acct-5"].selected_services || [];
    const existing = rows.find((r) => r.serviceId === "starter-web-hosting");
    ok(existing?.status === "Active", "an already-Active row stays Active — behavior must not change");
  }

  section("prepare-payment — first-purchase branch preserves 'Setting up' on an unrelated existing row");
  {
    // Reachable in practice via a plan-change/edge-case path where an
    // account has existing services but hasPaidSubscriptionForPlan is
    // false for the NEW planKey being applied — exercises the same
    // round-trip at line ~258 (the first-purchase branch), not just the
    // add-on branch's line ~217.
    const client = makeMockFrappe({
      "Web Account": {
        "acct-6": {
          name: "acct-6",
          plan: "Starter",
          selected_services: [{ service_id: "starter-web-hosting", status: "Setting up" }],
        },
      },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-6" }, body: { serviceId: "starter-storage", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prepHandler({ session: { webAccount: "acct-6" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const rows = client.store["Web Account"]["acct-6"].selected_services || [];
    const existing = rows.find((r) => r.serviceId === "starter-web-hosting");
    ok(!!existing, "the pre-existing row survives the first-purchase-branch write");
    ok(existing?.status === "Setting up", `pre-existing row keeps status "Setting up" (got "${existing?.status}")`);
  }

  section("prepare-payment — first-purchase branch preserves 'Suspended' on an unrelated existing row");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-7": {
          name: "acct-7",
          plan: "Starter",
          selected_services: [{ service_id: "starter-web-hosting", status: "Suspended" }],
        },
      },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const createHandler = findHandler(router, "post", "/api/orders");
    const prepHandler = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await createHandler(
      { session: { webAccount: "acct-7" }, body: { serviceId: "starter-storage", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;
    await prepHandler({ session: { webAccount: "acct-7" }, params: { id: orderId } }, makeRes());

    const rows = client.store["Web Account"]["acct-7"].selected_services || [];
    const existing = rows.find((r) => r.serviceId === "starter-web-hosting");
    ok(existing?.status === "Suspended", `pre-existing row keeps status "Suspended" (got "${existing?.status}")`);
  }

  section("applyPlanAndCreateInvoice mock — faithfully skips on empty services (no invoice)");
  {
    // Direct unit check on the shared mock itself: prove it mirrors the real
    // server.js function's zero-amount-skip behavior instead of always
    // creating an invoice regardless of input, which is what let the
    // Critical first-purchase bug slip through every prior review.
    const client = makeMockFrappe({
      "Web Account": { "acct-skip": { name: "acct-skip", plan: "None", selected_services: [] } },
    });
    const before = Object.keys(client.store["Portal Invoice"] || {}).length;
    const result = await applyPlanAndCreateInvoice(client, "acct-skip", "Starter", [], { force: true });
    ok(result?.skipped === true, "mock returns skipped:true for an empty services array, like the real function");
    const after = Object.keys(client.store["Portal Invoice"] || {}).length;
    ok(after === before, "no Portal Invoice doc was created when services array is empty");

    // Same call style as the old buggy call site (opts object as 4th arg,
    // no services array) must ALSO skip — this is exactly the regression.
    const result2 = await applyPlanAndCreateInvoice(client, "acct-skip", "Starter", { force: true, creditKes: 0 });
    ok(result2?.skipped === true, "opts-object-as-4th-arg call style also skips (matches real function, catches the exact old bug)");
  }

  section("POST /api/orders/:id/cancel — refuses to cancel a Paid order");
  {
    ok(!!addonOrderId, "precondition: addon order exists");
    // Flip the linked order to Paid the way getOrder would once its invoice pays.
    addonClient.store["Portal Invoice"] = addonClient.store["Portal Invoice"] || {};
    addonClient.store["Portal Invoice"]["PINV-9"] = { name: "PINV-9", status: "Paid" };
    const ctx = baseCtx(addonClient);
    const router = createOrdersRouter(ctx);
    const cancelHandler = findHandler(router, "post", "/api/orders/:id/cancel");
    const res = makeRes();
    await cancelHandler({ session: { webAccount: "acct-1" }, params: { id: addonOrderId } }, res);
    ok(res.statusCode === 409, "status 409");
    ok(addonClient.store["Checkout Order"][addonOrderId].status === "Paid", "order remains Paid, not Cancelled");
  }

  section("POST /api/orders/waitlist — posts a Capacity Request doc");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders/waitlist");
    const res = makeRes();
    await handler({ session: { webAccount: "acct-1" }, body: { serviceId: "starter-web-hosting" } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.ok === true, "ok true");

    const created = Object.values(client.store["Capacity Request"] || {})[0];
    ok(!!created, "a Capacity Request doc was created");
    ok(created?.reason === "checkout-waitlist", "reason === checkout-waitlist");
    ok(created?.service_id === "starter-web-hosting", "service_id set");
    ok(created?.web_account === "acct-1", "web_account set");
    ok(created?.status === "Open", "status === Open");
  }

  section("POST /api/orders — billingTerm is accepted and persisted");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-term": { name: "acct-term", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client);
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");

    const res = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting", billingTerm: "annual" } },
      res
    );
    ok(res.statusCode === 200, "annual-term order is accepted");
    ok(res.body?.order?.billingTerm === "annual", "order echoes the requested term");

    const res2 = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting" } },
      res2
    );
    ok(res2.body?.order?.billingTerm === "monthly", "omitted term defaults to monthly");

    const res3 = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting", billingTerm: "bogus" } },
      res3
    );
    ok(res3.body?.order?.billingTerm === "monthly", "unknown term falls back to monthly, never errors");
  }

  section("POST /api/orders — POS tier reserves the shop address");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");

    const res = makeRes();
    await handler({
      session: { webAccount: "acct-pos-1" },
      body: { serviceId: "biz-pos-duka", billingTerm: "monthly", planKey: "Business", source: "app-checkout",
              config: { shopName: "Mama Njeri", slug: "mamanjeri" } },
    }, res);
    ok(res.statusCode === 200, "POS order created");
    ok(res.body?.order?.monthlyKes === 2500, "priced server-side from the Duka tier");
    ok(res.body?.order?.config?.app === "pos" && res.body?.order?.config?.slug === "mamanjeri", "order carries app + slug");
    const slugDoc = client.store["Tenant Slug"]?.mamanjeri;
    ok(slugDoc?.status === "reserved" && slugDoc?.web_account === "acct-pos-1", "slug reserved for the buyer");

    const res2 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-2" },
      body: { serviceId: "biz-pos-chain", billingTerm: "monthly", planKey: "Business",
              config: { shopName: "Other", slug: "mamanjeri" } },
    }, res2);
    ok(res2.statusCode === 409 && res2.body?.code === "slug_taken", "a second account is refused the same address");
    ok(Array.isArray(res2.body?.suggestions) && res2.body.suggestions.length > 0, "with suggestions");

    const res3 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-3" },
      body: { serviceId: "biz-pos-duka", config: { shopName: "X", slug: "api" } },
    }, res3);
    ok(res3.statusCode === 400 && res3.body?.code === "slug_invalid", "reserved address refused with 400");

    const res4 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-4" },
      body: { serviceId: "biz-pos-duka", amount: 1, monthlyKes: 1, config: { shopName: "Cheap", slug: "cheap-shop" } },
    }, res4);
    ok(res4.body?.order?.monthlyKes === 2500, "client-sent amounts are ignored");
  }

  section("POST /api/orders — a buyer can re-post their own shop address");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");
    const body = (extra) => ({
      serviceId: "biz-pos-duka", planKey: "Business",
      config: { shopName: "Mama Njeri", slug: "ownretry", ...(extra || {}) },
    });

    const r1 = makeRes();
    await handler({ session: { webAccount: "acct-own" }, body: body() }, r1);
    ok(r1.statusCode === 200, "first post reserves the address");

    // Identical config inside the dedup window.
    const r2 = makeRes();
    await handler({ session: { webAccount: "acct-own" }, body: body() }, r2);
    ok(r2.statusCode === 200, `same account re-posting the same address is not told it was "just taken" (got ${r2.statusCode})`);

    // Different config so the dedup cannot short-circuit: a genuine retry.
    const r3 = makeRes();
    await handler({ session: { webAccount: "acct-own" }, body: body({ note: "retry" }) }, r3);
    ok(r3.statusCode === 200, `a retry with a fresh draft reuses the buyer's own hold (got ${r3.statusCode})`);
    ok(client.store["Tenant Slug"].ownretry.web_account === "acct-own", "the address is still held by the buyer");
    ok(client.store["Tenant Slug"].ownretry.checkout_order === r3.body?.order?.id, "hold now points at the newest order");

    const other = makeRes();
    await handler({ session: { webAccount: "acct-someone" }, body: body() }, other);
    ok(other.statusCode === 409 && other.body?.code === "slug_taken", "another account is still refused");
  }

  section("POST /api/orders — APP_EXISTS through the route");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-has-shop": {
          name: "acct-has-shop", plan: "Business",
          selected_services: [{ service_id: "biz-pos-duka", service_name: "POS Duka", tier: "Duka", status: "Active" }],
        },
      },
    });
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "acct-has-shop" },
      body: { serviceId: "biz-pos-duka", config: { shopName: "Second", slug: "second-shop" } },
    }, res);
    ok(res.statusCode === 409 && res.body?.code === "APP_EXISTS", `409 APP_EXISTS (got ${res.statusCode} ${res.body?.code})`);
    ok(!client.store["Tenant Slug"]?.["second-shop"], "no slug was reserved for the refused order");
    ok(Object.keys(client.store["Checkout Order"] || {}).length === 0, "no order was created");
  }

  section("POST /api/orders — losing the slug race cancels the order");
  {
    const client = makeMockFrappe();
    // The pre-check sees a free name (GET 404); the insert then collides, as
    // when another process wins between the read and the write.
    const realPost = client.post;
    client.post = async (url, body) => {
      if (/Tenant(%20| )Slug/.test(url)) { const e = new Error("dup"); e.response = { status: 409 }; throw e; }
      return realPost(url, body);
    };
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "acct-race" },
      body: { serviceId: "biz-pos-duka", config: { shopName: "Racer", slug: "racename" } },
    }, res);
    ok(res.statusCode === 409 && res.body?.code === "slug_taken", "409 slug_taken when the insert collides");
    ok(Array.isArray(res.body?.suggestions) && res.body.suggestions.length > 0, "suggestions offered");
    const orders = Object.values(client.store["Checkout Order"] || {});
    ok(orders.length === 1 && orders[0].status === "Cancelled", `the minted order was cancelled (${orders.map((o) => o.status).join(",")})`);
    ok(!orders.some((o) => o.status === "Draft"), "no Draft order is left holding capacity");
  }

  section("prepare-payment — app order whose slug was lost raises no invoice");
  {
    const { mysqlDatetime } = require("../services/checkout/orderStore");
    const tenantSlugs = require("../services/apps/tenantSlugStore");
    const client = makeMockFrappe({
      "Web Account": { "acct-lost": { name: "acct-lost", plan: "None", selected_services: [] } },
    });
    const router = createOrdersRouter(baseCtx(client));
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const c = makeRes();
    await create({
      session: { webAccount: "acct-lost" },
      body: { serviceId: "biz-pos-duka", planKey: "Business", config: { shopName: "Lost", slug: "lostname" } },
    }, c);
    ok(c.statusCode === 200, "order created");
    const orderId = c.body.order.id;

    // The hold lapses and another buyer takes the name.
    client.store["Tenant Slug"].lostname.expires_at = mysqlDatetime(Date.now() - 1000);
    await tenantSlugs.reserveSlug(client, { slug: "lostname", app: "pos", webAccount: "acct-thief", orderId: "CHK-X", nowMs: Date.now() });

    const res = makeRes();
    await prep({ session: { webAccount: "acct-lost" }, params: { id: orderId } }, res);
    ok(res.statusCode === 409 && res.body?.code === "slug_taken", `409 slug_taken (got ${res.statusCode} ${res.body?.code})`);
    ok(Array.isArray(res.body?.suggestions) && res.body.suggestions.length > 0, "suggestions offered");
    ok(Object.keys(client.store["Portal Invoice"] || {}).length === 0, "no Portal Invoice was created");
    ok(!client.store["Checkout Order"][orderId].invoice_doc_name, "order has no invoice linked");
    ok(client.store["Tenant Slug"].lostname.web_account === "acct-thief", "the other buyer keeps the name");
  }

  section("prepare-payment — app order links its slug to the invoice");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-link": { name: "acct-link", plan: "None", selected_services: [] } },
    });
    const router = createOrdersRouter(baseCtx(client));
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const c = makeRes();
    await create({
      session: { webAccount: "acct-link" },
      body: { serviceId: "biz-pos-duka", planKey: "Business", config: { shopName: "Linked", slug: "linkedname" } },
    }, c);
    const res = makeRes();
    await prep({ session: { webAccount: "acct-link" }, params: { id: c.body.order.id } }, res);
    ok(res.statusCode === 200 && !!res.body?.invoiceDocName, `prepare-payment succeeds (got ${res.statusCode})`);
    const doc = client.store["Tenant Slug"].linkedname;
    ok(String(doc.invoice || "").split(",").includes(res.body.invoiceDocName), "Tenant Slug.invoice contains the new invoice");
    ok(doc.status === "reserved" && doc.web_account === "acct-link", "slug still reserved for the buyer");
    ok(client.store["Checkout Order"][c.body.order.id].invoice_doc_name === res.body.invoiceDocName, "the order's invoice_doc_name is set to the same invoice");
  }

  section("POST /api/orders — client-supplied app/slug/shopName are never trusted on a non-app order");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-forge": { name: "acct-forge", plan: "None", selected_services: [] } },
    });
    const router = createOrdersRouter(baseCtx(client));
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const c = makeRes();
    await create({
      session: { webAccount: "acct-forge" },
      body: { serviceId: "starter-web-hosting", planKey: "Starter", config: { domainChoice: "Use Murzak Subdomain", app: "pos", slug: "rival-shop", shopName: "X" } },
    }, c);
    ok(c.statusCode === 200, `non-app order created (got ${c.statusCode})`);
    const cfg = c.body?.order?.config || {};
    ok(!("app" in cfg) && !("slug" in cfg) && !("shopName" in cfg), "returned order.config has none of the reserved keys");
    ok(cfg.domainChoice === "Use Murzak Subdomain", "ordinary client config keys are still kept");
    const stored = client.store["Checkout Order"]?.[c.body.order.id];
    ok(stored && !/rival-shop/.test(stored.config_json || "") && !/"app"/.test(stored.config_json || ""), "stored config_json has no app/slug");
    ok(Object.keys(client.store["Tenant Slug"] || {}).length === 0, "no Tenant Slug doc was created at order time");

    const res = makeRes();
    await prep({ session: { webAccount: "acct-forge" }, params: { id: c.body.order.id } }, res);
    ok(res.statusCode === 200 && !!res.body?.invoiceDocName, `prepare-payment succeeds (got ${res.statusCode})`);
    ok(Object.keys(client.store["Tenant Slug"] || {}).length === 0, "no Tenant Slug doc exists after prepare-payment either");
  }

  section("POST /api/orders — an app order's reserved keys come only from the validated result");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const create = findHandler(router, "post", "/api/orders");
    const c = makeRes();
    await create({
      session: { webAccount: "acct-forge2" },
      body: { serviceId: "biz-pos-duka", planKey: "Business", config: { shopName: "  Mama Njeri  ", slug: "MamaNjeri2", app: "erp" } },
    }, c);
    ok(c.statusCode === 200, `app order created (got ${c.statusCode})`);
    ok(c.body?.order?.config?.app === "pos", "config.app is the server's value, not the client's");
    ok(c.body?.order?.config?.slug === "mamanjeri2" && c.body?.order?.config?.shopName === "Mama Njeri", "slug/shopName are the normalized, validated values");
  }

  section("prepare-payment — the slug is linked to the invoice BEFORE the order is");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-m1": { name: "acct-m1", plan: "None", selected_services: [] } },
    });
    // linkInvoice dies after the invoice exists: the slug must already carry it.
    const router = createOrdersRouter(baseCtx(client, {
      linkInvoice: async () => { throw new Error("link blew up"); },
    }));
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");
    const c = makeRes();
    await create({
      session: { webAccount: "acct-m1" },
      body: { serviceId: "biz-pos-duka", planKey: "Business", config: { shopName: "M1", slug: "m1shop" } },
    }, c);
    const orig = console.error; console.error = () => {};
    const res = makeRes();
    try { await prep({ session: { webAccount: "acct-m1" }, params: { id: c.body.order.id } }, res); } finally { console.error = orig; }
    ok(res.statusCode === 500, `prepare-payment reports the failure (got ${res.statusCode})`);
    const invoiceNames = Object.keys(client.store["Portal Invoice"] || {});
    ok(invoiceNames.length === 1 && String(client.store["Tenant Slug"].m1shop.invoice || "").split(",").includes(invoiceNames[0]), "the slug already carries the invoice although the order link failed");
    ok(!client.store["Checkout Order"][c.body.order.id].invoice_doc_name, "the order is still un-invoiced (so a retry re-enters and cannot skip the slug link)");
  }

  section("GET /api/apps/:app/address");
  {
    const createAppsRouter = require("../routes/appsRoutes");
    const tenantSlugs = require("../services/apps/tenantSlugStore");
    const client = makeMockFrappe();
    await tenantSlugs.reserveSlug(client, { slug: "takenshop", app: "pos", webAccount: "acct-owner", orderId: "CHK-1", nowMs: Date.now() });
    const router = createAppsRouter({ frappeClient: () => client });
    const handler = findHandler(router, "get", "/api/apps/:app/address");
    const call = async (app, name, session) => {
      const res = makeRes();
      await handler({ params: { app }, query: { name }, session }, res);
      return res;
    };

    ok((await call("nope", "x")).statusCode === 404, "unknown app -> 404");
    ok((await call("constructor", "mamanjeri")).statusCode === 404, "prototype key 'constructor' -> 404");
    ok((await call("toString", "mamanjeri")).statusCode === 404, "prototype key 'toString' -> 404");

    const empty = await call("pos", "");
    ok(empty.body?.available === false && !!empty.body?.reason, "empty name -> unavailable with a reason");
    const bad = await call("pos", "api");
    ok(bad.body?.available === false && !!bad.body?.reason, "reserved name -> unavailable with a reason");

    const free = await call("pos", "Fresh Shop");
    ok(free.statusCode === 200 && free.body?.available === true && free.body?.slug === "fresh-shop", "free name -> available");

    const taken = await call("pos", "takenshop");
    ok(taken.body?.available === false && taken.body?.reason === "taken", "taken name -> unavailable, reason taken");
    ok(Array.isArray(taken.body?.suggestions) && taken.body.suggestions.length > 0, "taken name comes with suggestions");

    const anon = await call("pos", "takenshop", undefined);
    ok(anon.body?.available === false, "anonymous visitor (no session) still gets an answer");
    const stranger = await call("pos", "takenshop", { webAccount: "acct-other" });
    ok(stranger.body?.available === false, "a different signed-in account sees it as taken");
    const owner = await call("pos", "takenshop", { webAccount: "acct-owner" });
    ok(owner.body?.available === true, "the signed-in holder sees their own address as available");
    const ownerViaUser = await call("pos", "takenshop", { user: { id: "acct-owner" } });
    ok(ownerViaUser.body?.available === true, "session.user.id is honoured too");
  }

  // ---- Bundles: companions, one combined invoice, saving applied ----
  // Mirrors the real applyPlanAndCreateInvoice's relationship: monthly sum PLUS
  // one-time setup for new rows (the base mock above omits setup).
  async function applyWithSetup(client, webAccountName, planKey, rows = [], opts = {}) {
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, { plan: planKey, account_status: "Active" });
    const amount = sumSelectedServicesMonthlyKes(rows) + sumSelectedServicesSetupKes(rows);
    const created = await client.post("/api/resource/Portal Invoice", {
      web_account: webAccountName, type: "Subscription", plan: planKey, status: "Unpaid", amount,
      services: rows.map((r) => ({ ...r })),
    });
    return { ok: true, invoice: created.data?.data };
  }
  const BUNDLE_PRIMARY = "biz-erp-light";
  const BUNDLE_COMPANIONS = [
    { serviceId: "starter-email" },
    { serviceId: "domain-com", config: { domain: "acme.com" } },
  ];
  const bundleRows = [BUNDLE_PRIMARY, "starter-email", "domain-com"].map((serviceId) => ({ serviceId }));
  const draftCount = (client) => Object.keys(client.store["Checkout Order"] || {}).length;

  section("bundles — POST /api/orders with companions returns the combined total");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const res = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b1" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, res);
    const expected = sumSelectedServicesMonthlyKes(bundleRows) + sumSelectedServicesSetupKes(bundleRows) - 1575;
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.order?.companions?.length === 2, "order lists 2 companions");
    ok(res.body?.order?.bundleSavingKes === 1575, "saving is the domain-com pairing (1575)");
    ok(res.body?.order?.totalDueKes === expected, `totalDueKes === ${expected} (got ${res.body?.order?.totalDueKes})`);
  }

  section("bundles — crafted companion lists are 422 and leave no Draft row");
  {
    const lists = {
      "unknown id": [{ serviceId: "nope" }],
      "primary repeated": [{ serviceId: BUNDLE_PRIMARY }],
      "duplicates": [{ serviceId: "starter-email" }, { serviceId: "starter-email" }],
      "a 4th companion": [{ serviceId: "starter-email" }, { serviceId: "starter-storage" },
        { serviceId: "domain-com", config: { domain: "a.com" } }, { serviceId: "domain-org", config: { domain: "a.org" } }],
      "a database": [{ serviceId: "db-mysql" }],
      "POS as companion": [{ serviceId: "biz-pos-duka", config: { app: "pos", shopName: "X" } }],
    };
    for (const [label, companions] of Object.entries(lists)) {
      const client = makeMockFrappe();
      const router = createOrdersRouter(baseCtx(client));
      const res = makeRes();
      await findHandler(router, "post", "/api/orders")(
        { session: { webAccount: "acct-b2" }, body: { serviceId: BUNDLE_PRIMARY, companions } }, res);
      ok(res.statusCode === 422, `${label} -> 422 (got ${res.statusCode})`);
      ok(draftCount(client) === 0, `${label} -> no Draft row`);
    }
  }

  section("bundles — a capacity-breaking companion list is 409 CAPACITY with no row");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client, { getReservedRamMb: async () => 999999 }));
    const res = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b3" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, res);
    ok(res.statusCode === 409 && res.body?.code === "CAPACITY", "409 CAPACITY");
    ok(draftCount(client) === 0, "no Draft row");
  }

  section("I2 — per-order cap counts companions: Scalable Web App 2,048 + CRM 480 = 2,528 > 2,048 -> 422, no row");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const res = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-i2" }, body: { serviceId: "biz-scalable-webapp", companions: [{ serviceId: "biz-crm-helpdesk" }] } }, res);
    ok(res.statusCode === 422, `422 (got ${res.statusCode})`);
    ok(draftCount(client) === 0, "no Draft row");
    const alone = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-i2" }, body: { serviceId: "biz-scalable-webapp" } }, alone);
    ok(alone.statusCode === 200, "the primary alone (2,048) is still accepted");

    const put = makeRes();
    const before = JSON.stringify(client.store["Checkout Order"][alone.body.order.id]);
    await findHandler(router, "put", "/api/orders/:id/companions")(
      { session: { webAccount: "acct-i2" }, params: { id: alone.body.order.id }, body: { companions: [{ serviceId: "biz-crm-helpdesk" }] } }, put);
    ok(put.statusCode === 422, `PUT companions over the cap -> 422 (got ${put.statusCode})`);
    ok(JSON.stringify(client.store["Checkout Order"][alone.body.order.id]) === before, "order untouched");
    const zero = makeRes();
    await findHandler(router, "put", "/api/orders/:id/companions")(
      { session: { webAccount: "acct-i2" }, params: { id: alone.body.order.id }, body: { companions: [{ serviceId: "starter-email" }] } }, zero);
    ok(zero.statusCode === 200, "a zero-RAM companion still fits");
  }

  section("bundles — a client-sent config.bundle is dropped");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const res = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b4" }, body: { serviceId: "starter-web-hosting",
        config: { bundle: { companions: [{ serviceId: "starter-email" }], savingKes: 99999 } } } }, res);
    ok(res.statusCode === 200 && res.body.order.companions.length === 0 && res.body.order.bundleSavingKes === 0,
      "forged bundle ignored");
  }

  section("bundles — prepare-payment first purchase (monthly): one row per line, amount === totalDueKes");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-b5": { name: "acct-b5", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b5" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const order = cr.body.order;
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-b5" }, params: { id: order.id }, body: {} }, res);
    ok(res.statusCode === 200, "status 200");
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    ok(inv.services.length === 3, "invoice has one row per line (3)");
    ok(inv.amount === order.totalDueKes, `invoice amount ${inv.amount} === order.totalDueKes ${order.totalDueKes}`);
    const domRow = inv.services.find((r) => r.serviceId === "domain-com");
    ok(domRow?.domainChoice === "acme.com", "domain companion row carries domainChoice acme.com");
    const waIds = client.store["Web Account"]["acct-b5"].selected_services.map((r) => r.serviceId).sort();
    ok(JSON.stringify(waIds) === JSON.stringify([BUNDLE_PRIMARY, "domain-com", "starter-email"].sort()),
      "Web Account services include every line");
    ok(client.store["Web Account"]["acct-b5"].selected_services.find((r) => r.serviceId === "domain-com")?.domainChoice === "acme.com",
      "Web Account domain row carries domainChoice");
  }

  section("bundles — prepare-payment first purchase (annual): non-domain rows annualised, domain yearly price once, minus saving");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-b6": { name: "acct-b6", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b6" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-b6" }, params: { id: cr.body.order.id }, body: { billingTerm: "annual" } }, res);
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    // ERP Light 6,000 + Business Email 1,500 annualised: (6,000 + 1,500) x 12 x 0.8 = 72,000.
    // .com is already a yearly price (4,200), added once. Saving 1,575.
    // ERP's own 5,000 setup is not on an annual first purchase (unchanged primary rule).
    ok(inv.amount === 74625, `annual invoice amount 74,625 (got ${inv.amount})`);
    ok(inv.billing_term === "annual", "billing_term annual");
  }

  section("C1 — POS Duka + .com annual: 24,000 + 4,200 - 1,575 = 26,625 (domain never annualised)");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-c1": { name: "acct-c1", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-c1" }, body: { serviceId: "biz-pos-duka", config: { shopName: "Duka C1", slug: "duka-c1" },
        companions: [{ serviceId: "domain-com", config: { domain: "dukac1.com" } }] } }, cr);
    ok(cr.statusCode === 200 && cr.body.order.bundleSavingKes === 1575, `order created with saving 1,575 (status ${cr.statusCode})`);
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-c1" }, params: { id: cr.body.order.id }, body: { billingTerm: "annual" } }, res);
    ok(res.statusCode === 200, `prepare 200 (got ${res.statusCode})`);
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    ok(inv.amount === 26625, `annual invoice 26,625 (got ${inv?.amount})`);
    ok(inv.billing_term === "annual", "billing_term annual");
  }

  section("C1 — a companion's one-time setup fee is billed once on annual, un-annualised");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-c1s": { name: "acct-c1s", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-c1s" }, body: { serviceId: "biz-pos-duka", config: { shopName: "Duka S", slug: "duka-c1s" },
        companions: [{ serviceId: "biz-email" }] } }, cr);
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-c1s" }, params: { id: cr.body.order.id }, body: { billingTerm: "annual" } }, res);
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    // (2,500 + 2,500) x 9.6 = 48,000, plus biz-email's 500 setup once. No pairing, no saving.
    ok(inv.amount === 48500, `annual invoice 48,500 (got ${inv?.amount})`);
  }

  section("C1 — a companion-less annual order is billed exactly as before");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-c1p": { name: "acct-c1p", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-c1p" }, body: { serviceId: BUNDLE_PRIMARY } }, cr);
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-c1p" }, params: { id: cr.body.order.id }, body: { billingTerm: "annual" } }, res);
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    ok(inv.amount === annualPrepayKes(6000) && inv.amount === 57600, `ERP Light alone annual 57,600 (got ${inv?.amount})`);
  }

  section("bundles — prepare-payment add-on branch (paid plan): combined invoice, amount === totalDueKes");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-b7": { name: "acct-b7", plan: "Enterprise", account_holder_name: "T",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] } },
    });
    const router = createOrdersRouter(baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: realCreateAddonInvoice,
    }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b7" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const order = cr.body.order;
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-b7" }, params: { id: order.id }, body: {} }, res);
    ok(res.statusCode === 200, "status 200");
    const inv = client.store["Portal Invoice"][res.body.invoiceDocName];
    ok(inv.services.length === 3, "invoice has one row per line (3)");
    ok(inv.amount === order.totalDueKes, `invoice amount ${inv.amount} === order.totalDueKes ${order.totalDueKes}`);
    const domRow = inv.services.find((r) => (r.serviceId || r.service_id) === "domain-com");
    ok((domRow?.domainChoice || domRow?.domain_choice) === "acme.com", "domain companion row carries domainChoice");
    const waIds = client.store["Web Account"]["acct-b7"].selected_services.map((r) => r.serviceId);
    ok(["starter-app-hosting", BUNDLE_PRIMARY, "starter-email", "domain-com"].every((id) => waIds.includes(id)),
      "Web Account keeps the existing row and gains every line");
  }

  // ---- I3: paid-plan ANNUAL account, pro-rated lines; the saving is capped
  // at the line it belongs to and the invoice never drops below 1. ----
  function annualAccountClient(acct, daysLeft) {
    const start = new Date(Date.now() - (365 - daysLeft) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return makeMockFrappe({
      // Seeded first: the mock ignores filters, so this is the "last paid Subscription".
      "Portal Invoice": { "PINV-ANNUAL": { name: "PINV-ANNUAL", web_account: acct, type: "Subscription", status: "Paid",
        billing_term: "annual", invoice_date: start } },
      "Web Account": { [acct]: { name: acct, plan: "Enterprise", account_holder_name: "T",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] } },
    });
  }
  async function prepareOnAnnualAccount(acct, daysLeft, companions, slug) {
    const client = annualAccountClient(acct, daysLeft);
    const router = createOrdersRouter(baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: realCreateAddonInvoice,
    }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: acct }, body: { serviceId: "biz-pos-duka", config: { shopName: "Shop " + slug, slug }, companions } }, cr);
    const invoicePuts = [];
    const realPut = client.put;
    client.put = async (url, body, ...r) => { if (String(url).includes("Portal Invoice/")) invoicePuts.push(body); return realPut(url, body, ...r); };
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: acct }, params: { id: cr.body.order.id }, body: {} }, res);
    const inv = res.body?.invoiceDocName ? client.store["Portal Invoice"][res.body.invoiceDocName] : null;
    const order = client.store["Checkout Order"][cr.body.order.id];
    return { client, cr, res, inv, invoicePuts, order };
  }

  section("I3 — 8 days left: POS Duka 526 + .com 884; saving capped at the .com line (884), invoice 526");
  {
    const { res, inv, invoicePuts } = await prepareOnAnnualAccount("acct-i3a", 8,
      [{ serviceId: "domain-com", config: { domain: "i3a.com" } }], "i3a-shop");
    ok(res.statusCode === 200, `prepare 200 (got ${res.statusCode} ${JSON.stringify(res.body)})`);
    ok(inv?.amount === 526, `invoice 1,410 - 884 = 526 (got ${inv?.amount})`);
    ok(!invoicePuts.some((b) => "amount" in b && !(b.amount >= 1)), "never wrote an amount below 1");
  }

  section("I3 — 8 days left, tiny line: Duka 526 + Business Email 316; first month free capped at 316, invoice 526");
  {
    const { res, inv } = await prepareOnAnnualAccount("acct-i3b", 8, [{ serviceId: "starter-email" }], "i3b-shop");
    ok(res.statusCode === 200, `prepare 200 (got ${res.statusCode})`);
    ok(inv?.amount === 526, `invoice 842 - 316 = 526 (got ${inv?.amount})`);
  }

  section("I3 — 200 days left (mid-term): Duka 13,151 + .com 22,093; full 1,575 saving, invoice 33,669");
  {
    const { res, inv } = await prepareOnAnnualAccount("acct-i3c", 200,
      [{ serviceId: "domain-com", config: { domain: "i3c.com" } }], "i3c-shop");
    ok(res.statusCode === 200, `prepare 200 (got ${res.statusCode})`);
    ok(inv?.amount === 33669, `invoice 35,244 - 1,575 = 33,669 (got ${inv?.amount})`);
  }

  section("I3 — a saving that would leave less than 1 is not applied (no invoice PUT, never 0)");
  {
    // 1 day left: Duka round(24,000/365) = 66, Business Email round(14,400/365) = 39.
    // The route cannot reach a 0 primary line with real catalog prices, so the
    // floor rule is pinned on the planner the route uses: a 0 primary line plus a
    // fully-saved email would leave 0, so nothing is applied.
    const plan = require("../services/checkout/bundles").planCheckoutSaving({
      primaryId: "biz-pos-duka",
      companions: [{ serviceId: "starter-email" }],
      quotedSavingKes: 1500,
      lineAmounts: new Map([["biz-pos-duka", 0], ["starter-email", 39]]),
      knownKes: 39,
    });
    ok(plan.totalKes === 0 && plan.savings.length === 0, `saving that would zero the invoice is skipped (got ${plan.totalKes})`);
    const plan2 = require("../services/checkout/bundles").planCheckoutSaving({
      primaryId: "biz-pos-duka",
      companions: [{ serviceId: "starter-email" }],
      quotedSavingKes: 1500,
      lineAmounts: new Map([["biz-pos-duka", 66], ["starter-email", 39]]),
      knownKes: 105,
    });
    ok(plan2.totalKes === 39 && plan2.savings[0].pairingId === "pos-email" && plan2.savings[0].savingKes === 39, "capped at the 39 line");
  }

  // ---- I1: the checkout saving is recorded on the order (claim-first) and can
  // be neither lost by a later add-on merge nor taken a second time. ----
  const addonInvoiceService = require("../services/addonInvoiceService");
  function paidPlanClient(acct) {
    return makeMockFrappe({
      "Web Account": { [acct]: { name: acct, plan: "Enterprise", account_holder_name: "T",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] } },
    });
  }
  // What server.js's findOpenInvoice returns: the newest Unpaid Add-on invoice.
  const openAddonInvoice = async (client, acct, type) =>
    Object.values(client.store["Portal Invoice"] || {}).filter((i) => i.web_account === acct && i.type === type && i.status === "Unpaid").pop() || null;
  const addonDeps = {
    fetchWebAccount, hasPaidSubscriptionForPlan: async () => true, normalizeSelectedServices,
    findOpenInvoice: openAddonInvoice, normalizeInvoiceServiceRow: (r) => r,
    buildInvoiceServiceRows: (rows) => rows, PORTAL_INVOICE_SERVICES_FIELD: "services",
  };
  async function paidPlanCheckout(acct, companions, slug) {
    const client = paidPlanClient(acct);
    const router = createOrdersRouter(baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: realCreateAddonInvoice,
      findOpenInvoice: openAddonInvoice,
    }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: acct }, body: { serviceId: "biz-pos-duka", config: { shopName: "Shop " + slug, slug }, companions } }, cr);
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: acct }, params: { id: cr.body.order.id }, body: {} }, res);
    return { client, router, orderId: cr.body.order.id, invoiceDocName: res.body.invoiceDocName, res };
  }

  section("I1 — prepare-payment records the applied pairing on the order with its invoice and amount");
  {
    const { client, orderId, invoiceDocName, res } = await paidPlanCheckout("acct-i1a",
      [{ serviceId: "domain-com", config: { domain: "i1a.com" } }], "i1a-shop");
    ok(res.statusCode === 200, "prepare 200");
    ok(client.store["Portal Invoice"][invoiceDocName].amount === 5125, `checkout invoice 2,500 + 4,200 - 1,575 = 5,125 (got ${client.store["Portal Invoice"][invoiceDocName].amount})`);
    const applied = JSON.parse(client.store["Checkout Order"][orderId].config_json).bundle.applied;
    ok(JSON.stringify(applied) === JSON.stringify([{ pairingId: "pos-domain-com", invoiceDocName, savingKes: 1575 }]),
      `applied entry recorded: ${JSON.stringify(applied)}`);
  }

  section("I1 — claim-first: a failed invoice PUT rolls the claim back and writes no saving");
  {
    const client = paidPlanClient("acct-i1f");
    const router = createOrdersRouter(baseCtx(client, { hasPaidSubscriptionForPlan: async () => true, createAddonInvoice: realCreateAddonInvoice }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-i1f" }, body: { serviceId: "biz-pos-duka", config: { shopName: "Shop F", slug: "i1f-shop" },
        companions: [{ serviceId: "domain-com", config: { domain: "i1f.com" } }] } }, cr);
    const order = client.store["Checkout Order"][cr.body.order.id];
    let sawClaimBeforePut = false;
    const realPut = client.put;
    client.put = async (url, body, ...r) => {
      if (String(url).includes("Portal Invoice/") && "amount" in body) {
        sawClaimBeforePut = (JSON.parse(order.config_json).bundle.applied || []).length === 1;
        throw new Error("frappe down");
      }
      return realPut(url, body, ...r);
    };
    const res = makeRes();
    const origErr = console.error; console.error = () => {};
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-i1f" }, params: { id: cr.body.order.id }, body: {} }, res);
    console.error = origErr;
    ok(res.statusCode === 500, `500 (got ${res.statusCode})`);
    ok(sawClaimBeforePut, "the pairing was claimed BEFORE the invoice PUT");
    ok((JSON.parse(order.config_json).bundle.applied || []).length === 0, "claim rolled back after the failed PUT");
    ok(!order.invoice_doc_name, "order not linked");
  }

  section("I1(a) — adding storage while the checkout invoice is open: saving never lost, never doubled");
  {
    const { client, invoiceDocName } = await paidPlanCheckout("acct-i1b",
      [{ serviceId: "domain-com", config: { domain: "i1b.com" } }], "i1b-shop");
    const before = JSON.stringify(client.store["Portal Invoice"][invoiceDocName]);
    const r = await addonInvoiceService.createAddonPurchaseInvoice({
      client, webAccountName: "acct-i1b", services: [{ serviceId: "starter-storage" }], deps: addonDeps, nowMs: Date.now(),
    });
    ok(r.invoiceDocName !== invoiceDocName, "the add-on did NOT merge into the bundle checkout invoice");
    ok(JSON.stringify(client.store["Portal Invoice"][invoiceDocName]) === before, "checkout invoice untouched (still 5,125, same rows)");
    const storage = client.store["Portal Invoice"][r.invoiceDocName].amount;
    ok(storage === 1200, `storage on its own invoice at 1,200 (got ${storage})`);
    const total = client.store["Portal Invoice"][invoiceDocName].amount + storage;
    ok(total === 2500 + 4200 + 1200 - 1575 && total === 6325, `customer owes full sum - 1,575 = 6,325 (got ${total})`);

    // A plain add-on (no bundle checkout invoice open) still merges as before.
    const client2 = paidPlanClient("acct-i1c");
    const a = await addonInvoiceService.createAddonPurchaseInvoice({ client: client2, webAccountName: "acct-i1c", services: [{ serviceId: "starter-storage" }], deps: addonDeps, nowMs: Date.now() });
    const b = await addonInvoiceService.createAddonPurchaseInvoice({ client: client2, webAccountName: "acct-i1c", services: [{ serviceId: "starter-email" }], deps: addonDeps, nowMs: Date.now() });
    ok(a.invoiceDocName === b.invoiceDocName && client2.store["Portal Invoice"][a.invoiceDocName].amount === 2700, "non-bundle add-ons still merge (1,200 + 1,500)");
  }

  section("I1(b) — pay POS + email (first month free), delete the email, re-buy it in the window: full price");
  {
    const { client, router, orderId, invoiceDocName } = await paidPlanCheckout("acct-i1d", [{ serviceId: "starter-email" }], "i1d-shop");
    ok(client.store["Portal Invoice"][invoiceDocName].amount === 2500, `checkout invoice 2,500 + 1,500 - 1,500 = 2,500 (got ${client.store["Portal Invoice"][invoiceDocName].amount})`);
    client.store["Portal Invoice"][invoiceDocName].status = "Paid";
    const g = makeRes();
    await findHandler(router, "get", "/api/orders/:id")({ session: { webAccount: "acct-i1d" }, params: { id: orderId } }, g);
    ok(g.body.order.status === "Paid" && g.body.order.bundleWindowEndsAtMs > Date.now(), "order paid, window open");
    // Customer deletes the email service from their account.
    const wa = client.store["Web Account"]["acct-i1d"];
    wa.selected_services = wa.selected_services.filter((s) => (s.serviceId || s.service_id) !== "starter-email");
    const offers = makeRes();
    await findHandler(router, "get", "/api/bundles/offers")({ session: { webAccount: "acct-i1d" } }, offers);
    ok(!offers.body.offers.some((o) => o.serviceId === "starter-email"), "no 'Complete your setup' card for the already-used email pairing");
    const r = await addonInvoiceService.createAddonPurchaseInvoice({
      client, webAccountName: "acct-i1d", services: [{ serviceId: "starter-email" }], deps: addonDeps, nowMs: Date.now(),
    });
    ok(client.store["Portal Invoice"][r.invoiceDocName].amount === 1500, `re-bought email billed at full 1,500 (got ${client.store["Portal Invoice"][r.invoiceDocName].amount})`);
    const applied = JSON.parse(client.store["Checkout Order"][orderId].config_json).bundle.applied;
    ok(applied.length === 1 && applied[0].invoiceDocName === invoiceDocName, "still exactly the one checkout entry");
  }

  section("bundles — an order without companions leaves the invoice amount untouched");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-b8": { name: "acct-b8", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b8" }, body: { serviceId: "starter-web-hosting" } }, cr);
    const realPut = client.put; let invoicePuts = 0;
    client.put = async (url, ...r) => { if (String(url).includes("Portal Invoice/")) invoicePuts++; return realPut(url, ...r); };
    const res = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-b8" }, params: { id: cr.body.order.id }, body: {} }, res);
    ok(res.statusCode === 200 && invoicePuts === 0, "no Portal Invoice PUT for a companion-less monthly order");
  }

  section("bundles — PUT /api/orders/:id/companions");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-b9": { name: "acct-b9", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-b9" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const id = cr.body.order.id;
    const put = findHandler(router, "put", "/api/orders/:id/companions");

    const r1 = makeRes();
    await put({ session: { webAccount: "acct-b9" }, params: { id }, body: { companions: [{ serviceId: "starter-email" }] } }, r1);
    ok(r1.statusCode === 200 && r1.body.order.companions.length === 1, "removal works before prepare-payment");
    ok(r1.body.order.bundleSavingKes === 0, "saving recomputed (domain removed)");
    const two = [{ serviceId: BUNDLE_PRIMARY }, { serviceId: "starter-email" }];
    ok(r1.body.order.totalDueKes === sumSelectedServicesMonthlyKes(two) + sumSelectedServicesSetupKes(two),
      "totalDueKes follows the new list");

    const rBad = makeRes();
    await put({ session: { webAccount: "acct-b9" }, params: { id }, body: { companions: [{ serviceId: "db-mysql" }] } }, rBad);
    ok(rBad.statusCode === 422, "invalid list -> 422");
    const rNon = makeRes();
    await put({ session: { webAccount: "acct-b9" }, params: { id }, body: {} }, rNon);
    ok(rNon.statusCode === 422, "missing companions -> 422");

    const prep = makeRes();
    await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
      { session: { webAccount: "acct-b9" }, params: { id }, body: {} }, prep);
    ok(prep.statusCode === 200, "prepare-payment ok");
    const r2 = makeRes();
    await put({ session: { webAccount: "acct-b9" }, params: { id }, body: { companions: [] } }, r2);
    ok(r2.statusCode === 409 && r2.body.code === "ORDER_HAS_INVOICE", "409 after prepare-payment");
  }


  section("bundles fix round 1 — a missing branch amount never writes a free invoice");
  {
    for (const branch of ["first-purchase", "add-on"]) {
      const acct = branch === "add-on"
        ? { name: "acct-f1", plan: "Enterprise", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] }
        : { name: "acct-f1", plan: "None", selected_services: [] };
      const client = makeMockFrappe({ "Web Account": { "acct-f1": acct } });
      const overrides = branch === "add-on"
        ? { hasPaidSubscriptionForPlan: async () => true, createAddonInvoice: async () => ({ invoiceDocName: "PINV-NOAMT" }) }
        : { applyPlanAndCreateInvoice: async () => ({ ok: true, invoice: { name: "PINV-NOAMT" } }) };
      const router = createOrdersRouter(baseCtx(client, overrides));
      const cr = makeRes();
      await findHandler(router, "post", "/api/orders")(
        { session: { webAccount: "acct-f1" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
      const realPut = client.put; const invoicePuts = [];
      client.put = async (url, body, ...r) => { if (String(url).includes("Portal Invoice/")) invoicePuts.push(body); return realPut(url, body, ...r); };
      const res = makeRes();
      const origErr = console.error; console.error = () => {};
      await findHandler(router, "post", "/api/orders/:id/prepare-payment")(
        { session: { webAccount: "acct-f1" }, params: { id: cr.body.order.id }, body: {} }, res);
      console.error = origErr;
      ok(res.statusCode === 500, `${branch}: unknown branch amount -> 500 (got ${res.statusCode})`);
      ok(invoicePuts.length === 0, `${branch}: no Portal Invoice PUT written`);
      ok(!invoicePuts.some((b) => b.amount === 0), `${branch}: never wrote amount 0`);
      ok(!client.store["Checkout Order"][cr.body.order.id].invoice_doc_name, `${branch}: order not linked to an invoice`);
    }
  }

  section("bundles fix round 1 — repeat prepare-payment is idempotent and leaves the amount alone");
  {
    const client = makeMockFrappe({ "Web Account": { "acct-f2": { name: "acct-f2", plan: "None", selected_services: [] } } });
    const router = createOrdersRouter(baseCtx(client, { applyPlanAndCreateInvoice: applyWithSetup }));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-f2" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");
    const r1 = makeRes();
    await prep({ session: { webAccount: "acct-f2" }, params: { id: cr.body.order.id }, body: {} }, r1);
    const amount1 = client.store["Portal Invoice"][r1.body.invoiceDocName].amount;
    const realPut = client.put; let invoicePuts = 0;
    client.put = async (url, ...r) => { if (String(url).includes("Portal Invoice/")) invoicePuts++; return realPut(url, ...r); };
    const r2 = makeRes();
    await prep({ session: { webAccount: "acct-f2" }, params: { id: cr.body.order.id }, body: {} }, r2);
    ok(r2.body.invoiceDocName === r1.body.invoiceDocName, "same invoiceDocName on repeat");
    ok(invoicePuts === 0, "no second invoice PUT");
    ok(Object.keys(client.store["Portal Invoice"]).length === 1, "still exactly one invoice");
    ok(client.store["Portal Invoice"][r1.body.invoiceDocName].amount === amount1 && amount1 === cr.body.order.totalDueKes,
      `amount unchanged (${amount1} === totalDueKes ${cr.body.order.totalDueKes})`);
  }

  section("minor — PUT /api/orders/:id/companions is unavailable with BUNDLES_ENABLED off (404, no write)");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-m1" }, body: { serviceId: "starter-web-hosting" } }, cr);
    const before = JSON.stringify(client.store["Checkout Order"][cr.body.order.id]);
    process.env.BUNDLES_ENABLED = "false";
    const res = makeRes();
    await findHandler(router, "put", "/api/orders/:id/companions")(
      { session: { webAccount: "acct-m1" }, params: { id: cr.body.order.id }, body: { companions: [] } }, res);
    process.env.BUNDLES_ENABLED = "true";
    ok(res.statusCode === 404, `404 (got ${res.statusCode})`);
    ok(JSON.stringify(client.store["Checkout Order"][cr.body.order.id]) === before, "order untouched");
  }

  section("bundles fix round 1 — non-array companions and companions-route authz");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const bad = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-f3" }, body: { serviceId: BUNDLE_PRIMARY, companions: "starter-email" } }, bad);
    ok(bad.statusCode === 422, `non-array companions -> 422 (got ${bad.statusCode})`);
    ok(draftCount(client) === 0, "non-array companions -> no Draft row");

    const cr = makeRes();
    await findHandler(router, "post", "/api/orders")(
      { session: { webAccount: "acct-f3" }, body: { serviceId: BUNDLE_PRIMARY, companions: BUNDLE_COMPANIONS } }, cr);
    const put = findHandler(router, "put", "/api/orders/:id/companions");
    const other = makeRes();
    await put({ session: { webAccount: "intruder" }, params: { id: cr.body.order.id }, body: { companions: [] } }, other);
    ok(other.statusCode === 403, `another account's order -> 403 (got ${other.statusCode})`);
    const anon = makeRes();
    await put({ session: {}, params: { id: cr.body.order.id }, body: { companions: [] } }, anon);
    ok(anon.statusCode === 401, `unauthenticated -> 401 (got ${anon.statusCode})`);
    const still = client.store["Checkout Order"][cr.body.order.id];
    ok(JSON.parse(still.config_json).bundle.companions.length === 2, "the refused calls changed nothing");
  }

  section("bundles task 4 — GET /api/bundles/offers");
  {
    const END = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const paid = (name, over = {}, bundle = { windowEndsAtMs: END }) => ({
      name, web_account: "acct-o", status: "Paid", service_id: "biz-pos-duka",
      config_json: JSON.stringify({ bundle }), ...over,
    });
    const mk = (orders, services = []) => makeMockFrappe({
      "Checkout Order": orders,
      "Web Account": { "acct-o": { name: "acct-o", plan: "Enterprise", selected_services: services } },
    });
    const call = async (client, session = { webAccount: "acct-o" }) => {
      const router = createOrdersRouter(baseCtx(client));
      const res = makeRes();
      await findHandler(router, "get", "/api/bundles/offers")({ session }, res);
      return res;
    };

    let res = await call(mk({ "CHK-1": paid("CHK-1") }, [{ service_id: "domain-org", status: "Active" }]));
    ok(res.statusCode === 200 && res.body.enabled === true, "enabled with flag on");
    const ids = res.body.offers.map((o) => o.serviceId).sort();
    ok(JSON.stringify(ids) === JSON.stringify(["domain-com", "domain-io", "domain-net", "starter-email"]),
      "owned domain-org omitted, others offered: " + ids);
    const dc = res.body.offers.find((o) => o.serviceId === "domain-com");
    ok(dc.savingKes === 1575 && dc.windowEndsAtMs === END && dc.monthlyKes > 0 && typeof dc.name === "string", "offer carries saving + window end");

    res = await call(mk({ "CHK-D": paid("CHK-D", { status: "Draft" }, {}) }));
    ok(res.body.enabled === true && res.body.offers.length === 0, "unpaid order yields no offers");
    res = await call(mk({ "CHK-E": paid("CHK-E", {}, { windowEndsAtMs: Date.now() - 1 }) }));
    ok(res.body.offers.length === 0, "expired window yields no offers");
    res = await call(mk({ "CHK-1": paid("CHK-1") }), {});
    ok(res.statusCode === 401, "unauthenticated -> 401");

    process.env.BUNDLES_ENABLED = "false";
    res = await call(mk({ "CHK-1": paid("CHK-1") }));
    process.env.BUNDLES_ENABLED = "true";
    ok(res.statusCode === 200 && JSON.stringify(res.body) === '{"enabled":false,"offers":[]}', "flag off: {enabled:false, offers:[]}");
  }

  section("bundles task 4 — add-on invoice (real createAddonInvoice) is reduced by exactly the saving");
  {
    const { applyAddOnSaving } = require("../services/checkout/bundles");
    const END = Date.now() + 1000 * 60 * 60;
    const build = () => makeMockFrappe({
      "Checkout Order": { "CHK-1": { name: "CHK-1", web_account: "acct-ad", status: "Paid", service_id: "biz-pos-duka",
        config_json: JSON.stringify({ bundle: { windowEndsAtMs: END } }) } },
      "Web Account": { "acct-ad": { name: "acct-ad", plan: "Enterprise", account_holder_name: "T",
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] } },
    });
    const deps = {
      fetchWebAccount, hasPaidSubscriptionForPlan: async () => true, normalizeSelectedServices,
      findOpenInvoice: async () => null, normalizeInvoiceServiceRow: (r) => r,
      buildInvoiceServiceRows: (rows) => rows, PORTAL_INVOICE_SERVICES_FIELD: "services",
    };
    const services = [{ serviceId: "domain-com", domainChoice: "acme.com" }];
    let client = build();
    const r = await realCreateAddonInvoice({ client, webAccountName: "acct-ad", services, deps });
    const full = client.store["Portal Invoice"][r.invoiceDocName].amount;
    ok(full === r.amountKes && full > 1575, `full invoice ${full}`);
    await applyAddOnSaving({ client, webAccountName: "acct-ad", invoiceDocName: r.invoiceDocName, amountKes: r.amountKes,
      serviceIds: normalizeSelectedServices(services).map((s) => s.serviceId), nowMs: Date.now() });
    ok(client.store["Portal Invoice"][r.invoiceDocName].amount === full - 1575, `invoice ${full} -> ${full - 1575}`);

    // Without a window nothing extra is PUT (non-bundle add-ons unchanged).
    client = build();
    client.store["Checkout Order"]["CHK-1"].status = "Draft";
    const r2 = await realCreateAddonInvoice({ client, webAccountName: "acct-ad", services, deps });
    const putsBefore = client.puts.length;
    await applyAddOnSaving({ client, webAccountName: "acct-ad", invoiceDocName: r2.invoiceDocName, amountKes: r2.amountKes,
      serviceIds: ["domain-com"], nowMs: Date.now() });
    ok(client.puts.length === putsBefore && client.store["Portal Invoice"][r2.invoiceDocName].amount === r2.amountKes, "no window: no extra invoice PUT");
  }

  section("bundles task 5 — GET /api/bundles/availability");
  {
    const { getServiceMeta: meta } = require("../services/provisioning/catalog");
    const call = async (ctxOver = {}, session) => {
      const router = createOrdersRouter(baseCtx(makeMockFrappe(), ctxOver));
      const res = makeRes();
      await findHandler(router, "get", "/api/bundles/availability")({ session }, res);
      return res;
    };
    // No session at all: public endpoint.
    let res = await call({}, undefined);
    ok(res.statusCode === 200 && res.body.enabled === true, "no auth needed, enabled with flag on");
    ok(res.headers["cache-control"] === "public, max-age=30", "Cache-Control public, max-age=30: " + res.headers["cache-control"]);
    ok(Object.keys(res.body).sort().join() === "allowedCompanionIds,enabled,headroom,pairings", "exact top-level keys");
    const dom = res.body.pairings.find((p) => p.companionId === "domain-com" && p.primaryIds.includes("biz-pos-duka"));
    ok(dom && dom.savingKes === 1575 && typeof dom.label === "string" && dom.label.length > 0, "domain-com POS pairing saves 1575 with a label");
    const em = res.body.pairings.find((p) => p.companionId === "starter-email");
    ok(em && em.savingKes === meta("starter-email").monthlyKes && em.savingKes > 0, "email firstMonthFree equals catalog monthlyKes");
    ok(em.label === "First month free", "email label: " + em.label);
    ok(res.body.pairings.length === 9, "all 9 pairings present: " + res.body.pairings.length);
    ok(Object.keys(res.body.pairings[0]).sort().join() === "companionId,label,primaryIds,savingKes", "pairing shape");
    const allowed = res.body.allowedCompanionIds;
    ok(!allowed.includes("db-mysql") && !allowed.some((i) => i.startsWith("biz-pos-")), "no databases or POS tiers allowed");
    ok(["domain-com", "starter-email", "starter-storage", "biz-erp-light", "biz-crm-helpdesk"].every((i) => allowed.includes(i)), "expected companions allowed");
    ok(allowed.every((i) => meta(i)), "every allowed id exists in the catalog");
    ok(["ok", "limited", "full"].includes(res.body.headroom.level) && Number.isInteger(res.body.headroom.benchSlotsLeft), "headroom shape");

    res = await call({ getReservedRamMb: async () => { throw new Error("frappe down"); } });
    ok(res.statusCode === 200 && res.body.headroom.level === "limited" && res.body.headroom.benchSlotsLeft === 0, "fleet read failure -> 200, limited, 0 slots");
    ok(res.body.pairings.length === 9, "pairings still returned on read failure");

    const brokenFrappe = makeMockFrappe();
    brokenFrappe.get = async () => { throw new Error("boom"); };
    const router = createOrdersRouter(baseCtx(brokenFrappe));
    res = makeRes();
    await findHandler(router, "get", "/api/bundles/availability")({}, res);
    ok(res.statusCode === 200 && res.body.headroom.level === "limited", "draft read failure -> 200, limited");

    // A null fleet read (getReservedRamMb's failure value) is "unknown", never 0.
    res = await call({ getReservedRamMb: async () => null });
    ok(res.statusCode === 200 && res.body.headroom.level === "limited" && res.body.headroom.benchSlotsLeft === 0, `null fleet read -> limited, 0 slots (got ${JSON.stringify(res.body.headroom)})`);

    // 30 s in-process memo, single flight: one computation for many requests.
    {
      let reads = 0;
      const router2 = createOrdersRouter(baseCtx(makeMockFrappe(), {
        getReservedRamMb: async () => { reads++; await new Promise((r) => setTimeout(r, 20)); return 0; },
      }));
      const h = findHandler(router2, "get", "/api/bundles/availability");
      const rs = [makeRes(), makeRes(), makeRes()];
      await Promise.all(rs.map((r) => h({}, r)));
      const r4 = makeRes(); await h({}, r4);
      ok(reads === 1, `4 requests (3 concurrent) -> 1 headroom computation (got ${reads})`);
      ok([...rs, r4].every((r) => JSON.stringify(r.body.headroom) === JSON.stringify(rs[0].body.headroom)), "all got the same headroom");
    }
    {
      let reads = 0;
      const router3 = createOrdersRouter(baseCtx(makeMockFrappe(), {
        getReservedRamMb: async () => { reads++; if (reads === 1) throw new Error("down"); return 0; },
      }));
      const h = findHandler(router3, "get", "/api/bundles/availability");
      const origErr = console.error; console.error = () => {};
      const a = makeRes(); await h({}, a);
      console.error = origErr;
      const b = makeRes(); await h({}, b);
      ok(a.body.headroom.level === "limited" && a.body.headroom.benchSlotsLeft === 0, "first (failed) read -> limited, 0 slots");
      ok(reads === 2 && b.body.headroom.benchSlotsLeft > 0,
        `a failed computation is not memoized (reads ${reads}, second ${JSON.stringify(b.body.headroom)})`);
    }

    process.env.BUNDLES_ENABLED = "false";
    res = await call();
    process.env.BUNDLES_ENABLED = "true";
    ok(res.statusCode === 200 && res.body.enabled === false && res.body.pairings.length === 0 && res.body.allowedCompanionIds.length === 0, "flag off: disabled, empty");
    ok(res.body.headroom.level === "ok" && res.body.headroom.benchSlotsLeft === 0, "flag off: neutral headroom");
    ok(res.headers["cache-control"] === "public, max-age=30", "flag off response is cached too");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
