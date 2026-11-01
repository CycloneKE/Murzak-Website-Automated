/**
 * Mail disk/RAM capacity gate and the POST /api/orders 422 MAIL_CAPACITY path.
 *   node test/mailCapacity.test.js   (or: npm test)
 *
 * Quotas are limits, not reservations (thin provisioning), so a mail order is
 * refused when (provisionedGb + mailboxes x quotaGb) / overcommit > diskGb.
 * With MAIL_DISK_GB unset the gate is disabled and sells everything.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const ENV_KEYS = ["MAIL_DISK_GB", "MAIL_OVERCOMMIT", "MAIL_STACK_RAM_MB", "STALWART_URL", "STALWART_MOCK"];
function setEnv(overrides) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides || {})) process.env[k] = v;
}

const {
  canSellMailPlan,
  diskAlertLevel,
  provisionedMailGb,
  checkMailCapacity,
  __resetWarningsForTests,
} = require("../services/email/mailCapacity");
const capacity = require("../services/provisioning/capacity");
const { CAPACITY } = require("../services/provisioning/catalog");
const createOrdersRouter = require("../routes/ordersRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const { createOrder, getOrder, cancelOrder, linkInvoice } = require("../services/checkout/orderStore");
const { assertOrderWithinCapacity } = require("../services/orderCapacity");
const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");
process.env.BUNDLES_ENABLED = "true";

const VENDOR_NAME = /stalwart|bulwark|hostinger|coolify|frappe|hetzner|vps|kvm/i;

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

// Frappe DATETIME is naive UTC "YYYY-MM-DD HH:MM:SS".
function mysqlUtc(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function mailOrder({ name, status, planId, expiresInMs = 60 * 60 * 1000, mailboxes = 0 }) {
  return {
    name,
    status,
    web_account: "WA-SEED",
    reservation_expires_at: mysqlUtc(Date.now() + expiresInMs),
    config_json: JSON.stringify(planId ? { mailSetup: { state: "awaiting_payment", planId, mailboxes: [] } } : {}),
  };
}

const MAIL_PRO = Object.freeze({
  planId: "mail-pro",
  domainMode: "own",
  businessName: "Acme Ltd",
  domain: "acme.com",
  contactEmail: "owner@gmail.com",
  mailboxes: ["info", "sales"],
});
const MAIL_STARTER = Object.freeze({ ...MAIL_PRO, planId: "mail-starter" });

(async () => {
  // ---- canSellMailPlan ---------------------------------------------------
  section("canSellMailPlan refuses a Pro order that would exceed the cap");
  {
    setEnv({});
    // Pro = 30 mailboxes x 15GB = 450GB; /3 overcommit = 150 > 100GB disk.
    const r = canSellMailPlan("mail-pro", { provisionedGb: 0, diskGb: 100, overcommit: 3 });
    ok(r.ok === false, "Pro on a 100GB disk at 3x overcommit is refused");
    ok(typeof r.reason === "string" && /capacity/i.test(r.reason), "the reason mentions capacity");
    ok(!VENDOR_NAME.test(r.reason || ""), "the reason names no vendor or infrastructure");
  }

  section("Starter fits when Pro does not");
  {
    setEnv({});
    // Starter = 3 x 5GB = 15GB; /3 = 5 <= 100.
    ok(canSellMailPlan("mail-starter", { provisionedGb: 0, diskGb: 100, overcommit: 3 }).ok === true, "Starter fits the same disk");
    ok(canSellMailPlan("mail-pro", { provisionedGb: 0, diskGb: 100, overcommit: 3 }).ok === false, "Pro does not fit the same disk");
  }

  section("the cap is inclusive: equal to diskGb is allowed, just over is refused");
  {
    setEnv({});
    // Starter with 0 provisioned: 15/3 = 5.
    ok(canSellMailPlan("mail-starter", { provisionedGb: 0, diskGb: 5, overcommit: 3 }).ok === true, "exactly at the cap is allowed");
    ok(canSellMailPlan("mail-starter", { provisionedGb: 0, diskGb: 4.9, overcommit: 3 }).ok === false, "just over the cap is refused");
  }

  section("provisioned storage already on the box counts against the cap");
  {
    setEnv({});
    ok(canSellMailPlan("mail-starter", { provisionedGb: 300, diskGb: 100, overcommit: 3 }).ok === false, "a full box refuses even Starter");
  }

  section("unknown plan is refused");
  {
    setEnv({});
    const r = canSellMailPlan("mail-enterprise", { provisionedGb: 0, diskGb: 100, overcommit: 3 });
    ok(r.ok === false && typeof r.reason === "string", "an unknown planId returns ok:false with a reason");
  }

  section("MAIL_OVERCOMMIT defaults to 3 and is read from env");
  {
    setEnv({ MAIL_DISK_GB: "100" });
    // Pro: 450/3 = 150 > 100 refused by default; 450/5 = 90 <= 100 allowed at 5x.
    ok(canSellMailPlan("mail-pro", { provisionedGb: 0 }).ok === false, "default overcommit 3 refuses Pro on 100GB");
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "5" });
    ok(canSellMailPlan("mail-pro", { provisionedGb: 0 }).ok === true, "MAIL_OVERCOMMIT=5 admits Pro on 100GB");
  }

  section("gate disabled when MAIL_DISK_GB is unset");
  {
    setEnv({});
    const r = canSellMailPlan("mail-pro", { provisionedGb: 999999 });
    ok(r.ok === true, "with MAIL_DISK_GB unset every plan is allowed");
    ok(typeof r.note === "string" && /disabled/i.test(r.note), "the result carries a note saying the gate is disabled");
  }

  // ---- diskAlertLevel ----------------------------------------------------
  section("diskAlertLevel thresholds are exact at 70% and 85%");
  {
    ok(diskAlertLevel(69.9, 100) === "ok", "69.9 of 100 is ok");
    ok(diskAlertLevel(70, 100) === "warn", "70 of 100 is warn");
    ok(diskAlertLevel(84.9, 100) === "warn", "84.9 of 100 is warn");
    ok(diskAlertLevel(85, 100) === "critical", "85 of 100 is critical");
    ok(diskAlertLevel(0, 100) === "ok", "an empty disk is ok");
  }

  // ---- provisionedMailGb -------------------------------------------------
  section("provisionedMailGb counts live mail orders only");
  {
    setEnv({});
    const client = makeMockFrappe({
      "Checkout Order": {
        "CHK-PAID": mailOrder({ name: "CHK-PAID", status: "Paid", planId: "mail-pro" }), // 450
        "CHK-DRAFT": mailOrder({ name: "CHK-DRAFT", status: "Draft", planId: "mail-starter" }), // 15, live reservation
        "CHK-CANCELLED": mailOrder({ name: "CHK-CANCELLED", status: "Cancelled", planId: "mail-pro" }), // excluded
        "CHK-LAPSED": mailOrder({ name: "CHK-LAPSED", status: "Draft", planId: "mail-pro", expiresInMs: -60000 }), // excluded
        "CHK-PLAIN": mailOrder({ name: "CHK-PLAIN", status: "Paid" }), // not a mail order
      },
    });
    const gb = await provisionedMailGb(client);
    ok(gb === 465, `live Pro (450) + live Starter (15) = 465GB, got ${gb}`);
  }

  // ---- checkMailCapacity (route-facing) -----------------------------------
  section("checkMailCapacity with the gate disabled sells without reading orders");
  {
    setEnv({ STALWART_URL: "https://mail.example.test" });
    const explodingClient = { get: async () => { throw new Error("should not be read"); } };
    const r = await checkMailCapacity(explodingClient, "mail-pro");
    ok(r.ok === true, "disabled gate allows the sale");
  }

  section("checkMailCapacity refuses when the box is full");
  {
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "3" });
    const client = makeMockFrappe({ "Checkout Order": {} });
    const pro = await checkMailCapacity(client, "mail-pro");
    ok(pro.ok === false && /capacity/i.test(pro.reason || ""), "Pro is refused on an empty 100GB box");
    const starter = await checkMailCapacity(client, "mail-starter");
    ok(starter.ok === true, "Starter is allowed on the same box");
  }

  // ---- ordersRoutes 422 path --------------------------------------------
  section("POST /api/orders returns 422 MAIL_CAPACITY and creates nothing when the gate refuses");
  {
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "3" });
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({ session: { webAccount: "WA-1" }, body: { serviceId: "mail-pro", config: {}, mailSetup: MAIL_PRO } }, res);
    ok(res.statusCode === 422, "a refused mail order is HTTP 422");
    ok(res.body && res.body.code === "MAIL_CAPACITY", "the body carries code MAIL_CAPACITY");
    ok(res.body && typeof res.body.error === "string" && /capacity/i.test(res.body.error), "the body error mentions capacity");
    ok(res.body && !VENDOR_NAME.test(res.body.error || ""), "the body error names no vendor");
    ok(Object.values(client.store["Checkout Order"] || {}).length === 0, "no Checkout Order is created");
    ok(client.posts.length === 0, "nothing is written to Frappe at all");
  }

  section("POST /api/orders still accepts a mail order that fits");
  {
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "3" });
    const client = makeMockFrappe();
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({ session: { webAccount: "WA-1" }, body: { serviceId: "mail-starter", config: {}, mailSetup: MAIL_STARTER } }, res);
    ok(res.statusCode === 200 && res.body.ok === true, "a Starter order that fits is 200");
  }

  // ---- MAIL_STACK_RAM_MB --------------------------------------------------
  section("MAIL_STACK_RAM_MB is not reserved when unset or 0");
  {
    const base = Number(CAPACITY.sellableRamMb) || 0;
    setEnv({});
    ok(capacity.sellableRamMb() === base, "unset leaves sellable RAM unchanged");
    setEnv({ MAIL_STACK_RAM_MB: "0" });
    ok(capacity.sellableRamMb() === base, "0 leaves sellable RAM unchanged");
    setEnv({ MAIL_STACK_RAM_MB: "not-a-number" });
    ok(capacity.sellableRamMb() === base, "a non-numeric value leaves sellable RAM unchanged");
  }

  section("MAIL_STACK_RAM_MB reduces sellable RAM and the threshold when set");
  {
    const base = Number(CAPACITY.sellableRamMb) || 0;
    setEnv({ MAIL_STACK_RAM_MB: "1000" });
    ok(capacity.sellableRamMb() === base - 1000, `sellable RAM is reduced by 1000MB (got ${capacity.sellableRamMb()})`);
    ok(capacity.thresholdMb() === Math.floor(((base - 1000) * 85) / 100), "the RAM gate threshold follows the reduced sellable figure");
    setEnv({});
  }

  // ---- invalid MAIL_DISK_GB warns once and stays disabled -----------------
  // Captures console.warn for the duration of fn and returns the messages.
  async function captureWarnings(fn) {
    const real = console.warn;
    const seen = [];
    console.warn = (...args) => { seen.push(args.join(" ")); };
    try { await fn(); } finally { console.warn = real; }
    return seen;
  }

  section("a set-but-invalid MAIL_DISK_GB warns once and keeps the gate disabled");
  for (const bad of ["100GB", "0", "-5"]) {
    __resetWarningsForTests();
    setEnv({ MAIL_DISK_GB: bad });
    let r1;
    let r2;
    const warns = await captureWarnings(async () => {
      r1 = canSellMailPlan("mail-pro", { provisionedGb: 999999 });
      r2 = canSellMailPlan("mail-pro", { provisionedGb: 999999 });
    });
    ok(r1.ok === true && r2.ok === true, `MAIL_DISK_GB='${bad}' still allows the sale (gate disabled, fail-open by design)`);
    ok(warns.length === 1 && /MAIL_DISK_GB/.test(warns[0]), `MAIL_DISK_GB='${bad}' logs exactly one warning naming MAIL_DISK_GB (got ${warns.length})`);
  }
  __resetWarningsForTests();
  setEnv({});

  // ---- fail closed when orders cannot be read ----------------------------
  section("checkMailCapacity fails CLOSED with 503 MAIL_CAPACITY_UNKNOWN when orders cannot be read");
  {
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "3" });
    const brokenClient = { get: async () => { throw new Error("frappe unreachable"); } };
    let caught = null;
    try { await checkMailCapacity(brokenClient, "mail-starter"); } catch (e) { caught = e; }
    ok(caught && caught.statusCode === 503, "an unreadable order list raises statusCode 503");
    ok(caught && caught.code === "MAIL_CAPACITY_UNKNOWN", "the error carries code MAIL_CAPACITY_UNKNOWN");
    ok(caught && !/frappe/i.test(caught.message), "the error message does not leak the underlying failure");
  }

  section("POST /api/orders refuses and creates nothing when orders cannot be read");
  {
    // listTakenMailDomains runs before the capacity gate and reads the same list,
    // so an outage there is reached first and surfaces as a generic failure. The
    // exact 503 MAIL_CAPACITY_UNKNOWN is asserted at the gate above; here the
    // contract is only that the order fails closed.
    setEnv({ MAIL_DISK_GB: "100", MAIL_OVERCOMMIT: "3" });
    const client = makeMockFrappe();
    client.get = async () => { throw new Error("frappe unreachable"); };
    const handler = findHandler(createOrdersRouter(baseCtx(client)), "post", "/api/orders");
    const res = makeRes();
    await handler({ session: { webAccount: "WA-1" }, body: { serviceId: "mail-starter", config: {}, mailSetup: MAIL_STARTER } }, res);
    ok(res.statusCode >= 500, `an unreadable order list is a server failure, not a sale (got ${res.statusCode})`);
    ok(!(res.body && res.body.error && /frappe/i.test(res.body.error)), "the failure does not leak the underlying error");
    ok(client.posts.length === 0, "nothing is written to Frappe");
  }

  // ---- MAIL_STACK_RAM_MB clamping ---------------------------------------
  section("MAIL_STACK_RAM_MB larger than sellable RAM clamps sellable RAM to 0");
  {
    setEnv({ MAIL_STACK_RAM_MB: "999999" });
    ok(capacity.sellableRamMb() === 0, `sellable RAM clamps to 0 (got ${capacity.sellableRamMb()})`);
    ok(capacity.thresholdMb() === 0, "the RAM gate threshold is 0, so nothing RAM-based is sold");
    setEnv({});
  }

  setEnv({});
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
