/**
 * requireAdmin — admin access requires a VERIFIED email, not just a matching one.
 *   node test/requireAdminVerified.test.js
 *
 * Before this, requireAdmin only compared req.session.user.email against
 * ADMIN_EMAILS. Registration sends a verification email but does NOT block
 * login on it (routes/authRoutes.js's verify-email handler says so explicitly).
 * So any address in ADMIN_EMAILS that nobody had registered yet -- a role
 * address like admin@ or support@ -- could be registered by a stranger and
 * used to pass requireAdmin immediately, with no proof they control that inbox.
 *
 * requireAdmin now additionally confirms the account's email_verified flag on
 * the Web Account doc, via a fresh Frappe read (so it can't be fooled by a
 * session that predates verification, and fails CLOSED if Frappe can't be
 * reached -- an outage must never silently grant admin).
 */
process.env.MOCK_FRAPPE = "true";
process.env.ADMIN_EMAILS = "admin@murzaktech.com,verified@murzaktech.com";

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { requireAdmin } = require("../server");

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function seedWebAccount(name, fields) {
  global.__mockFrappeStore = global.__mockFrappeStore || {};
  global.__mockFrappeStore["Web Account"] = global.__mockFrappeStore["Web Account"] || [];
  const existing = global.__mockFrappeStore["Web Account"].findIndex((d) => d.name === name);
  const doc = { name, ...fields };
  if (existing >= 0) global.__mockFrappeStore["Web Account"][existing] = doc;
  else global.__mockFrappeStore["Web Account"].push(doc);
}

(async () => {
  section("an unregistered / non-admin email is rejected (unchanged fast path)");
  {
    const req = { session: { user: { email: "nobody@example.com" }, webAccount: "nobody@example.com" } };
    const res = makeRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    ok(!nextCalled, "next() is not called for a non-admin email");
    ok(res.statusCode === 403, `403 for a non-admin email (got ${res.statusCode})`);
  }

  section("an admin email that has NOT verified its inbox is rejected");
  {
    seedWebAccount("admin@murzaktech.com", { email_verified: 0 });
    const req = { session: { user: { email: "admin@murzaktech.com" }, webAccount: "admin@murzaktech.com" } };
    const res = makeRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    ok(!nextCalled, "next() is not called for an unverified admin email");
    ok(res.statusCode === 403, `403 for an unverified admin email (got ${res.statusCode})`);
  }

  section("a fresh registration under an admin-listed email (self-service claim) is rejected");
  {
    // The exact exploit: register with an ADMIN_EMAILS address nobody owned,
    // log in immediately -- email_verified is absent/falsy on a brand-new account.
    seedWebAccount("support@murzaktech.com", {});
    process.env.ADMIN_EMAILS = "admin@murzaktech.com,verified@murzaktech.com,support@murzaktech.com";
    const req = { session: { user: { email: "support@murzaktech.com" }, webAccount: "support@murzaktech.com" } };
    const res = makeRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    ok(!nextCalled, "next() is not called for a just-registered, unverified admin-listed account");
    ok(res.statusCode === 403, `403 for the self-service admin claim (got ${res.statusCode})`);
  }

  section("a verified admin email is admitted");
  {
    seedWebAccount("verified@murzaktech.com", { email_verified: 1 });
    const req = { session: { user: { email: "verified@murzaktech.com" }, webAccount: "verified@murzaktech.com" } };
    const res = makeRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    ok(nextCalled, "next() IS called for a verified admin email");
    ok(res.body === null, "no error response was written");
  }

  section("no session email at all is rejected without touching Frappe");
  {
    const req = { session: {} };
    const res = makeRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    ok(!nextCalled, "next() is not called with no session email");
    ok(res.statusCode === 403, `403 with no session (got ${res.statusCode})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("UNCAUGHT:", e); process.exit(1); });
