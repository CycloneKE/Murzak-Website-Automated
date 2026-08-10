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
const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");
const { annualPrepayKes } = require("../services/billingTerm");

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
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

    section("prepare-payment — idempotent on second call");
    const res2 = makeRes();
    await prepHandler({ session: { webAccount: "acct-1" }, params: { id: addonOrderId } }, res2);
    ok(res2.statusCode === 200, "second call status 200");
    ok(res2.body?.invoiceDocName === "PINV-9", "second call same invoiceDocName");
    ok(createAddonCalls === 1, "createAddonInvoice NOT called again");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
