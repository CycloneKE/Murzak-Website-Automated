/**
 * authRoutes.js route tests — runs without Redis or Frappe.
 *   node test/authRoutes.test.js   (or: npm test)
 *
 * Scope: regression coverage for the two "apply pending plan selected from
 * Pricing before login" blocks — POST /api/login and POST /api/auth/google.
 * Both mirror the same pattern: an EXISTING account (found by email, not
 * created in this request) that queued a plan/services selection while
 * logged out. If that account is on an annual term,
 * applyPlanAndCreateInvoice (no billing-term awareness) must never run
 * against it — but login/sign-in must ALWAYS succeed regardless, and the
 * queued pendingPlan/pendingServices must always be cleared. Refusing the
 * request here (as an earlier revision did, via
 * assertNotAnnualBeforePlanChange) is a worse bug than the one it prevents:
 * since POST /api/plan/select is public/unauthenticated, it leaves the
 * customer both logged out AND unable to clear the stuck pendingPlan,
 * because every retry re-triggers the same refusal. An existing account
 * with NO pending plan, or with a pending plan but no annual history, must
 * be completely unaffected.
 *
 * Instantiates the authRoutes factory directly (no HTTP server) and calls
 * handlers with stub req/res, backed by the shared in-memory mock Frappe
 * client — same pattern as test/ordersRoutes.test.js / test/billingRoutes.test.js.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const bcrypt = require("bcrypt");
const createAuthRouter = require("../routes/authRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const { getCurrentBillingTerm } = require("../services/checkoutBillingTerm");
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
function makeSession(extra = {}) {
  return {
    regenerate: (cb) => cb(null),
    save: (cb) => cb(null),
    ...extra,
  };
}

// ---- Minimal, faithful-enough stand-ins for the server.js helpers that
// aren't independently importable (server.js is a monolith), mirroring the
// same approach test/ordersRoutes.test.js and test/billingRoutes.test.js use. ----

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
    authLimiter: (req, res, next) => next(), // never invoked directly; findHandler skips it
    requireAuth: (req, res, next) => next(), // never invoked directly; findHandler skips it
    frappeClient: () => client,
    bcrypt,
    getCurrentBillingTerm,
    assertWithinPlanLimit: () => {}, // permissive no-op: plan-limit enforcement is out of scope here
    assertOrderWithinCapacity: () => {},
    normalizeSelectedServices,
    buildWebAccountServiceRows,
    applyPlanAndCreateInvoice,
    fetchInvoicesForUser,
    fetchSelectedServicesForUser,
    buildUserPayload,
    setupTrialVerification: async () => {},
    isValidEmail: (e) => /.+@.+\..+/.test(String(e || "")),
    firebaseAdmin: { isConfigured: () => true, verifyIdToken: overrides.__verifyIdToken },
    loginThrottle: {
      check: async () => ({ locked: false }),
      recordFailure: async () => {},
      reset: async () => {},
    },
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    ...overrides,
  };
}

function seedAccount(webAccountName, { email, passwordHash, plan = "None" } = {}) {
  return {
    "Web Account": {
      [webAccountName]: {
        name: webAccountName,
        work_email: email,
        password_hash: passwordHash,
        plan,
        account_status: "Active",
        selected_services: [],
      },
    },
  };
}

function seedAnnualPaidInvoice(store, webAccountName) {
  store["Portal Invoice"] = store["Portal Invoice"] || {};
  store["Portal Invoice"]["PINV-ANNUAL-1"] = {
    name: "PINV-ANNUAL-1",
    web_account: webAccountName,
    type: "Subscription",
    status: "Paid",
    invoice_date: "2026-01-01",
    billing_term: "annual",
  };
  return store;
}

(async () => {
  const PASSWORD = "correct-horse-battery-staple";
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  section("POST /api/login — annual-term account with a pending plan logs in, dropping the pending plan (no 409 lockout)");
  {
    const seed = seedAccount("acct-annual-login", { email: "annual@example.com", passwordHash, plan: "Starter" });
    seedAnnualPaidInvoice(seed, "acct-annual-login");
    const client = makeMockFrappe(seed);
    const router = createAuthRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/login");
    const req = {
      body: { email: "annual@example.com", password: PASSWORD },
      session: makeSession({ pendingPlan: "Business", pendingServices: [{ serviceId: "starter-web-hosting" }] }),
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "login succeeds instead of being refused");
    ok(req.session.user && req.session.user.id === "acct-annual-login", "a real session was established (req.session.user set)");
    ok(req.session.webAccount === "acct-annual-login", "req.session.webAccount set to the logged-in account");
    ok(client.store["Web Account"]["acct-annual-login"].plan === "Starter", "Web Account plan untouched");
    ok(Object.keys(client.store["Portal Invoice"]).length === 1, "no new Portal Invoice created");
    ok(req.session.pendingPlan === null, "pendingPlan cleared instead of being left to re-trigger on the next login attempt");
    ok(req.session.pendingServices === null, "pendingServices cleared");
  }

  section("POST /api/login — annual-term account with NO pending plan logs in unaffected");
  {
    const seed = seedAccount("acct-annual-noplan", { email: "annualnoplan@example.com", passwordHash, plan: "Starter" });
    seedAnnualPaidInvoice(seed, "acct-annual-noplan");
    const client = makeMockFrappe(seed);
    const router = createAuthRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/login");
    const req = {
      body: { email: "annualnoplan@example.com", password: PASSWORD },
      session: makeSession(), // no pendingPlan at all
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "login succeeds — the guard never runs without a pending plan");
  }

  section("POST /api/login — non-annual account with a pending plan passes through unaffected");
  {
    const seed = seedAccount("acct-login-ok", { email: "ok@example.com", passwordHash, plan: "None" });
    const client = makeMockFrappe(seed);
    const router = createAuthRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/login");
    const req = {
      body: { email: "ok@example.com", password: PASSWORD },
      session: makeSession({ pendingPlan: "Starter", pendingServices: [{ serviceId: "starter-web-hosting" }] }),
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "ok true");
    ok(client.store["Web Account"]["acct-login-ok"].plan === "Starter", "pending plan applied");
  }

  section("POST /api/auth/google — annual-term account with a pending plan signs in, dropping the pending plan (no 409 lockout)");
  {
    const seed = seedAccount("acct-annual-google", { email: "annualg@example.com", plan: "Starter" });
    seedAnnualPaidInvoice(seed, "acct-annual-google");
    const client = makeMockFrappe(seed);
    const router = createAuthRouter(
      baseCtx(client, { __verifyIdToken: async () => ({ email: "annualg@example.com", email_verified: true, name: "Annual G" }) })
    );
    const handler = findHandler(router, "post", "/api/auth/google");
    const req = {
      body: { idToken: "fake" },
      session: makeSession({ pendingPlan: "Business", pendingServices: [{ serviceId: "starter-web-hosting" }] }),
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "sign-in succeeds instead of being refused");
    ok(req.session.user && req.session.user.id === "acct-annual-google", "a real session was established (req.session.user set)");
    ok(req.session.webAccount === "acct-annual-google", "req.session.webAccount set to the signed-in account");
    ok(client.store["Web Account"]["acct-annual-google"].plan === "Starter", "Web Account plan untouched");
    ok(req.session.pendingPlan === null, "pendingPlan cleared instead of being left to re-trigger on the next sign-in attempt");
    ok(req.session.pendingServices === null, "pendingServices cleared");
  }

  section("POST /api/auth/google — non-annual account with a pending plan passes through unaffected");
  {
    const seed = seedAccount("acct-google-ok", { email: "gok@example.com", plan: "None" });
    const client = makeMockFrappe(seed);
    const router = createAuthRouter(
      baseCtx(client, { __verifyIdToken: async () => ({ email: "gok@example.com", email_verified: true, name: "G Ok" }) })
    );
    const handler = findHandler(router, "post", "/api/auth/google");
    const req = {
      body: { idToken: "fake" },
      session: makeSession({ pendingPlan: "Starter", pendingServices: [{ serviceId: "starter-web-hosting" }] }),
    };
    const res = makeRes();
    await handler(req, res);
    ok(res.statusCode === 200, `status 200 (got ${res.statusCode}, body: ${JSON.stringify(res.body)})`);
    ok(res.body?.ok === true, "ok true");
    ok(client.store["Web Account"]["acct-google-ok"].plan === "Starter", "pending plan applied");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
