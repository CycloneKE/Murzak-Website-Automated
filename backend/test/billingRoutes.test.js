/**
 * billingRoutes.js route tests — runs without Redis or Frappe.
 *   node test/billingRoutes.test.js   (or: npm test)
 *
 * Scope: regression coverage for the Critical #1 guard
 * (assertNotAnnualBeforePlanChange) on the two applyPlanAndCreateInvoice call
 * sites in this file — POST /api/subscription/upgrade and
 * POST /api/account/services/update. applyPlanAndCreateInvoice has no
 * billing-term awareness at all, so an existing annual-term customer hitting
 * either route must be refused (409 ANNUAL_TERM_LOCKED) before any Web
 * Account/invoice write happens, while a non-annual account must pass
 * through unaffected (no regression to existing behavior).
 *
 * Instantiates the billingRoutes factory directly (no HTTP server) and calls
 * handlers with stub req/res, backed by the shared in-memory mock Frappe
 * client — same pattern as test/ordersRoutes.test.js.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const createBillingRouter = require("../routes/billingRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const { assertNotAnnualBeforePlanChange } = require("../services/checkoutBillingTerm");
const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");

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
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// ---- Minimal, faithful-enough stand-ins for the server.js helpers that
// aren't independently importable (server.js is a monolith), mirroring the
// same approach test/ordersRoutes.test.js already uses. ----

async function fetchWebAccount(client, webAccountName) {
  const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
  return res.data?.data;
}

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

async function updateWebAccountServices(client, webAccountName, rows) {
  return client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
    selected_services: rows,
  });
}

async function fetchInvoicesForUser(client, webAccountName) {
  const res = await client.get("/api/resource/Portal Invoice");
  const rows = (res.data?.data || []).filter((i) => i.web_account === webAccountName);
  return rows.map((i) => ({ docName: i.name, status: i.status, type: i.type, plan: i.plan, amount: i.amount }));
}

async function fetchSelectedServicesForUser() {
  return [];
}

function buildUserPayload({ record }) {
  return { id: record?.name, plan: record?.plan };
}

function baseCtx(client, overrides = {}) {
  return {
    requireAuth: (req, res, next) => next(), // never invoked directly; findHandler skips it
    frappeClient: () => client,
    assertNotAnnualBeforePlanChange,
    assertWithinPlanLimit: () => {}, // permissive no-op: plan-limit enforcement is out of scope here
    fetchWebAccount,
    applyPlanAndCreateInvoice,
    updateWebAccountServices,
    fetchInvoicesForUser,
    fetchSelectedServicesForUser,
    buildUserPayload,
    asArray: (v) => (Array.isArray(v) ? v : []),
    normalizeChildRow: (r) => r,
    computeProratedCreditKes: () => 0,
    findLatestPaidSubscriptionInvoice: async () => null,
    logPortalUpdate: async () => {},
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE: "Web Account Service",
    CHILD_SERVICE_ID_FIELD: "serviceId",
    CHILD_SERVICE_NAME_FIELD: "serviceName",
    CHILD_TIER_FIELD: "tier",
    CHILD_DOMAIN_CHOICE_FIELD: "domainChoice",
    CHILD_STATUS_FIELD: "status",
    SERVICE_STATUS_AWAITING: "Awaiting Payment",
    ...overrides,
  };
}

function seedAnnualPaidInvoice(webAccountName) {
  return {
    "Web Account": { [webAccountName]: { name: webAccountName, plan: "Starter", selected_services: [] } },
    "Portal Invoice": {
      "PINV-ANNUAL-1": {
        name: "PINV-ANNUAL-1",
        web_account: webAccountName,
        type: "Subscription",
        status: "Paid",
        invoice_date: "2026-01-01",
        billing_term: "annual",
      },
    },
  };
}

(async () => {
  section("POST /api/subscription/upgrade — annual-term account is refused (409 ANNUAL_TERM_LOCKED)");
  {
    const client = makeMockFrappe(seedAnnualPaidInvoice("acct-annual-up"));
    const router = createBillingRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/subscription/upgrade");
    const req = { session: { webAccount: "acct-annual-up" }, body: { newPlan: "Business" } };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 409, `status 409 (got ${res.statusCode})`);
    ok(res.body?.code === "ANNUAL_TERM_LOCKED", "code === ANNUAL_TERM_LOCKED");
    ok(
      client.store["Web Account"]["acct-annual-up"].plan === "Starter",
      "Web Account plan untouched by the refused upgrade"
    );
    ok(
      Object.keys(client.store["Portal Invoice"]).length === 1,
      "no new Portal Invoice created"
    );
  }

  section("POST /api/subscription/upgrade — non-annual account (no plan yet) passes through unaffected");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-none": { name: "acct-none", plan: "None", selected_services: [] } },
    });
    const router = createBillingRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/subscription/upgrade");
    const req = { session: { webAccount: "acct-none" }, body: { newPlan: "Starter" } };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "ok true");
    ok(client.store["Web Account"]["acct-none"].plan === "Starter", "plan applied");
  }

  section("POST /api/account/services/update — annual-term account is refused (409 ANNUAL_TERM_LOCKED)");
  {
    const client = makeMockFrappe(seedAnnualPaidInvoice("acct-annual-svc"));
    const router = createBillingRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/account/services/update");
    const req = {
      session: { webAccount: "acct-annual-svc" },
      body: { plan: "Starter", selectedServices: [{ serviceId: "starter-web-hosting" }] },
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 409, `status 409 (got ${res.statusCode})`);
    ok(res.body?.code === "ANNUAL_TERM_LOCKED", "code === ANNUAL_TERM_LOCKED");
    ok(
      (client.store["Web Account"]["acct-annual-svc"].selected_services || []).length === 0,
      "Web Account services untouched by the refused update"
    );
    ok(
      Object.keys(client.store["Portal Invoice"]).length === 1,
      "no new Portal Invoice created"
    );
  }

  section("POST /api/account/services/update — non-annual (no paid history) account passes through unaffected");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-svc-ok": { name: "acct-svc-ok", plan: "None", selected_services: [] } },
    });
    const router = createBillingRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/account/services/update");
    const req = {
      session: { webAccount: "acct-svc-ok" },
      body: { plan: "Starter", selectedServices: [{ serviceId: "starter-web-hosting" }] },
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "ok true");
    ok(
      (client.store["Web Account"]["acct-svc-ok"].selected_services || []).some((r) => r.serviceId === "starter-web-hosting"),
      "services updated"
    );
  }

  // ---- M-Pesa STK push -------------------------------------------------
  // Regression: the handler used DARAJA_TIMEOUT_MS / appendCheckoutRequestId
  // without importing them, so every push threw a ReferenceError that the
  // catch reported as a generic 500 "Failed to initiate M-Pesa payment." —
  // before Safaricom was ever contacted. These tests run the real handler
  // against a fake Safaricom (no network).
  const { effectiveChargeKes, isVerificationOnly } = require("../utils/billingAmount");

  // server.js is a monolith that cannot be required here; mirror its helper.
  function normalizeMpesaPhone(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    if (d.startsWith("254") && d.length === 12) return d;
    if (d.startsWith("0") && d.length === 10) return "254" + d.slice(1);
    if (d.length === 9 && (d.startsWith("7") || d.startsWith("1"))) return "254" + d;
    return null;
  }

  const MPESA_ENV_KEYS = [
    "MPESA_ENV", "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET",
    "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL",
  ];
  const savedEnv = Object.fromEntries(MPESA_ENV_KEYS.map((k) => [k, process.env[k]]));
  function setMpesaEnv() {
    process.env.MPESA_ENV = "sandbox";
    process.env.MPESA_CONSUMER_KEY = "test-key";
    process.env.MPESA_CONSUMER_SECRET = "test-secret";
    process.env.MPESA_SHORTCODE = "174379";
    process.env.MPESA_PASSKEY = "test-passkey";
    process.env.MPESA_CALLBACK_URL = "https://example.test/api/billing/mpesa/callback?token=t";
  }

  function stkCtx(client, fakeAxios) {
    return baseCtx(client, {
      axios: fakeAxios,
      effectiveChargeKes,
      isVerificationOnly,
      normalizeMpesaPhone,
      getMpesaAccessToken: async () => "fake-token",
    });
  }
  function unpaidInvoiceStore(webAccount) {
    return {
      "Portal Invoice": {
        "PINV-STK-1": {
          name: "PINV-STK-1",
          web_account: webAccount,
          invoice_no: "INV-26-10-11-0001",
          status: "Unpaid",
          amount: 43200,
        },
      },
    };
  }

  section("POST /api/billing/mpesa/stk-push — sends the prompt and records the checkout id");
  {
    setMpesaEnv();
    const client = makeMockFrappe(unpaidInvoiceStore("acct-stk"));
    const calls = [];
    const fakeAxios = {
      post: async (url, body, opts) => {
        calls.push({ url, body, opts });
        return { data: { ResponseCode: "0", CheckoutRequestID: "ws_CO_123", MerchantRequestID: "mr_1" } };
      },
    };
    const router = createBillingRouter(stkCtx(client, fakeAxios));
    const handler = findHandler(router, "post", "/api/billing/mpesa/stk-push");
    const req = {
      session: { webAccount: "acct-stk" },
      body: { phoneNumber: "0708374149", invoiceDocName: "PINV-STK-1" },
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true && res.body?.checkoutRequestID === "ws_CO_123", "returns the CheckoutRequestID");
    ok(calls.length === 1, "exactly one request sent to Safaricom");
    ok(calls[0]?.body?.PhoneNumber === "254708374149", "phone normalised to 254708374149");
    ok(calls[0]?.body?.Amount === 43200, "charges the full invoice amount (KES 43,200)");
    ok(
      typeof calls[0]?.opts?.timeout === "number" && calls[0].opts.timeout >= 1000,
      "Safaricom request carries a bounded timeout"
    );
    const stored = client.store["Portal Invoice"]["PINV-STK-1"];
    ok(stored.mpesa_checkout_request_id === "ws_CO_123", "checkout id saved on the invoice");
    ok(stored.mpesa_checkout_request_ids === "ws_CO_123", "checkout id added to the history");
  }

  section("POST /api/billing/mpesa/stk-push — a second push keeps the earlier checkout id in the history");
  {
    setMpesaEnv();
    const seed = unpaidInvoiceStore("acct-stk2");
    seed["Portal Invoice"]["PINV-STK-1"].mpesa_checkout_request_ids = "ws_CO_OLD";
    const client = makeMockFrappe(seed);
    const fakeAxios = {
      post: async () => ({ data: { ResponseCode: "0", CheckoutRequestID: "ws_CO_NEW", MerchantRequestID: "mr_2" } }),
    };
    const router = createBillingRouter(stkCtx(client, fakeAxios));
    const handler = findHandler(router, "post", "/api/billing/mpesa/stk-push");
    const res = makeRes();
    await handler(
      { session: { webAccount: "acct-stk2" }, body: { phoneNumber: "0708374149", invoiceDocName: "PINV-STK-1" } },
      res
    );
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode})`);
    ok(
      client.store["Portal Invoice"]["PINV-STK-1"].mpesa_checkout_request_ids === "ws_CO_OLD,ws_CO_NEW",
      "history is 'ws_CO_OLD,ws_CO_NEW'"
    );
  }

  section("POST /api/billing/mpesa/stk-push — missing M-Pesa settings is a clear 503, not a crash");
  {
    setMpesaEnv();
    delete process.env.MPESA_PASSKEY;
    const client = makeMockFrappe(unpaidInvoiceStore("acct-stk3"));
    const router = createBillingRouter(stkCtx(client, { post: async () => { throw new Error("must not be called"); } }));
    const handler = findHandler(router, "post", "/api/billing/mpesa/stk-push");
    const res = makeRes();
    await handler(
      { session: { webAccount: "acct-stk3" }, body: { phoneNumber: "0708374149", invoiceDocName: "PINV-STK-1" } },
      res
    );
    ok(res.statusCode === 503, `status 503 (got ${res.statusCode})`);
  }

  MPESA_ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
