/**
 * POST /api/orders for a Stalwart mail plan.
 *   node test/mailOrderRoute.test.js   (or: npm test)
 *
 * A mail plan order must carry a valid mailSetup, which is checked BEFORE any
 * capacity is reserved and saved on the created order. Non-mail orders are not
 * changed, and a client cannot inject mailSetup into a non-mail order (that
 * would block someone else's domain in the taken-domain check).
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
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`No route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function baseCtx(client) {
  return {
    requireAuth: (req, res, next) => next(),
    frappeClient: () => client,
    assertOrderWithinCapacity,
    getReservedRamMb: async () => 0,
    createOrder,
    getOrder,
    cancelOrder,
    linkInvoice,
    createAddonInvoice: async () => { throw new Error("not used"); },
    hasPaidSubscriptionForPlan: async () => false,
    fetchWebAccount: async () => ({}),
    applyPlanAndCreateInvoice: async () => ({ ok: true, skipped: true }),
    updateWebAccountServices: async () => ({}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    normalizeSelectedServices: (v) => (Array.isArray(v) ? v : []),
    findOpenInvoice: async () => null,
    normalizeInvoiceServiceRow: (r) => r,
    buildInvoiceServiceRows: (rows) => rows,
    PORTAL_INVOICE_SERVICES_FIELD: "services",
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    mergeServicesById: (a, b) => [...a, ...b],
    buildWebAccountServiceRows: (rows) => rows,
    CAPACITY_REQUEST_DOCTYPE: "Capacity Request",
    sumSelectedServicesMonthlyKes,
  };
}

const MAIL = Object.freeze({
  planId: "mail-starter",
  domainMode: "own",
  businessName: "Acme Ltd",
  domain: "acme.com",
  contactEmail: "owner@gmail.com",
  mailboxes: ["info", "sales"],
});

function orderRows(client) {
  return Object.values(client.store["Checkout Order"] || {});
}

(async () => {
  section("mail plan order without a mailSetup -> 400, nothing reserved");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({ session: { webAccount: "WA-1" }, body: { serviceId: "mail-starter", config: {} } }, res);
    ok(res.statusCode === 400, "missing mailSetup is a 400");
    ok(orderRows(client).length === 0, "no Checkout Order is created");
  }

  section("mail plan order with invalid mailSetup -> 400 with field errors");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "WA-1" },
      body: { serviceId: "mail-starter", config: {}, mailSetup: { ...MAIL, domain: "not a domain" } },
    }, res);
    ok(res.statusCode === 400, "invalid mailSetup is a 400");
    ok(res.body && res.body.errors && res.body.errors.domain, "the response names the bad field");
    ok(orderRows(client).length === 0, "no Checkout Order is created for invalid input");
  }

  section("mail plan order whose planId does not match the ordered service -> 400");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "WA-1" },
      body: { serviceId: "mail-starter", config: {}, mailSetup: { ...MAIL, planId: "mail-pro" } },
    }, res);
    ok(res.statusCode === 400 && res.body.errors && res.body.errors.planId, "a planId that differs from the service is rejected");
    ok(orderRows(client).length === 0, "no Checkout Order is created on a plan mismatch");
  }

  section("mail plan order with valid mailSetup persists it on the order");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "WA-1" },
      body: { serviceId: "mail-starter", config: {}, mailSetup: MAIL },
    }, res);
    ok(res.statusCode === 200 && res.body.ok === true, "valid mail order is 200");
    const rows = orderRows(client);
    ok(rows.length === 1, "one Checkout Order is created");
    const cfg = rows[0] ? JSON.parse(rows[0].config_json) : {};
    ok(cfg.mailSetup && cfg.mailSetup.state === "awaiting_payment", "the mailSetup is saved on the order, awaiting payment");
    ok(cfg.mailSetup && cfg.mailSetup.domain === "acme.com" && cfg.mailSetup.domainMode === "own", "the saved setup carries the domain and mode");
  }

  section("a second order cannot take a domain already used by a mail order");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    await handler({ session: { webAccount: "WA-1" }, body: { serviceId: "mail-starter", config: {}, mailSetup: MAIL } }, makeRes());
    const res = makeRes();
    await handler({ session: { webAccount: "WA-2" }, body: { serviceId: "mail-starter", config: {}, mailSetup: { ...MAIL, planId: "mail-starter" } } }, res);
    ok(res.statusCode === 400 && res.body.errors && res.body.errors.domain, "the same domain is refused for a second account");
  }

  section("non-mail orders are unchanged and cannot inject a mailSetup");
  {
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({
      session: { webAccount: "WA-1" },
      body: {
        serviceId: "starter-web-hosting",
        config: { domainChoice: "Use Murzak Subdomain", mailSetup: MAIL },
        planKey: "Starter",
        source: "CloudLaunch",
      },
    }, res);
    ok(res.statusCode === 200, "a non-mail order still succeeds without mailSetup");
    const rows = orderRows(client);
    const cfg = rows[0] ? JSON.parse(rows[0].config_json) : {};
    ok(cfg.mailSetup === undefined, "a mailSetup injected into a non-mail order is dropped");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
