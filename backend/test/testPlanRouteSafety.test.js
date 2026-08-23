/**
 * GET /api/test-plan/:id — path-injection and PII-leak hardening.
 *   node test/testPlanRouteSafety.test.js
 *
 * This route is legitimately unauthenticated (it prefills the signup form
 * from a Test Plan Invoice created moments earlier by the same anonymous
 * visitor via POST /api/test-plan). Before this it had two real problems:
 *
 *  1. `req.params.id` was interpolated into the Frappe REST URL with no
 *     encoding. Express URI-decodes path params, so a path segment like
 *     `..%2F..%2FWeb%20Account%2Fdev-user@example.com` arrives in req.params.id
 *     already containing literal "/" characters, which then got concatenated
 *     straight into the URL handed to the PRIVILEGED admin-token Frappe
 *     client — a downstream URL parser (axios, or Frappe's own router) could
 *     resolve that into a request against a completely different resource.
 *
 *  2. It was reachable with NO rate limit, so it doubled as an unthrottled
 *     PII-enumeration endpoint (contactName/company/email/testingGoal) for
 *     anyone willing to guess or brute-force ids.
 *
 * Fixed with (a) a docname validator that rejects anything not shaped like a
 * real Frappe docname BEFORE any Frappe call is made, (b) encodeURIComponent
 * on the id as defense in depth, and (c) the same publicFormLimiter already
 * used on the sibling POST endpoint.
 *
 * Runs a real HTTP server (MOCK_FRAPPE=true, no listener bound by importing
 * server.js — see the require.main guard) so this proves the fix at the wire
 * level, not just the validator in isolation.
 */

process.env.MOCK_FRAPPE = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { app, isSafeFrappeDocname } = require("../server");

(async () => {
  section("isSafeFrappeDocname — pure validator");
  {
    ok(isSafeFrappeDocname("TPI-00001") === true, "a normal Frappe-style docname is accepted");
    ok(isSafeFrappeDocname("TRIAL-1755800000000") === true, "a timestamp-suffixed docname is accepted");
    ok(isSafeFrappeDocname("../../Web Account/acct-1") === false, "a path-traversal payload is rejected");
    ok(isSafeFrappeDocname("Web Account/dev-user@example.com") === false, "an embedded '/' is rejected");
    ok(isSafeFrappeDocname("foo?bar=1") === false, "an embedded '?' is rejected");
    ok(isSafeFrappeDocname("foo%2Fbar") === false, "an embedded '%' is rejected");
    ok(isSafeFrappeDocname("") === false, "empty string is rejected");
    ok(isSafeFrappeDocname(null) === false, "null is rejected");
    ok(isSafeFrappeDocname("a".repeat(200)) === false, "an unreasonably long id is rejected");
  }

  section("HTTP: the route rejects a path-injection payload before touching Frappe");
  {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      // %2F decodes to "/" in req.params.id — this is the exact payload shape
      // that used to reach the Frappe client with a raw "/" inside it.
      const res = await fetch(`http://127.0.0.1:${port}/api/test-plan/..%2F..%2FWeb%20Account%2Fdev-user%40example.com`);
      ok(res.status === 400, `malicious id is rejected with 400 (got ${res.status})`);
      const body = await res.json().catch(() => ({}));
      ok(typeof body.error === "string", "a plain error message is returned, not a Frappe stack trace");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  section("HTTP: a well-formed but unknown id fails the same way it always did (regression guard)");
  {
    // NOT part of this fix: the route's catch-all turns ANY thrown Frappe error
    // (including a 404 for a missing doc) into a generic 500 -- this was already
    // true before the injection fix and is unrelated to it. The assertion here
    // exists only to prove the validator/encoding change did not change this
    // pre-existing behavior.
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/test-plan/TPI-DOES-NOT-EXIST`);
      ok(res.status === 500, `unknown-but-safe id fails the same pre-existing way (got ${res.status})`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  section("HTTP: a real trial is still fetchable by its own id (regression guard)");
  {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      // Seed a Test Plan Invoice directly into the shared mock store.
      global.__mockFrappeStore = global.__mockFrappeStore || {};
      global.__mockFrappeStore["Test Plan Invoice"] = global.__mockFrappeStore["Test Plan Invoice"] || [];
      global.__mockFrappeStore["Test Plan Invoice"].push({
        name: "TPI-SAFETY-TEST-1",
        contact_name: "Jane Doe",
        web_account_email: "jane@example.com",
        client_name: "Acme Ltd",
        testing_goal: "Evaluate ERP",
        usage_level: "small-team",
      });
      const res = await fetch(`http://127.0.0.1:${port}/api/test-plan/TPI-SAFETY-TEST-1`);
      ok(res.status === 200, `a real docname still resolves (got ${res.status})`);
      const body = await res.json();
      ok(body?.trial?.contactName === "Jane Doe", "the prefill payload is still returned unchanged");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("UNCAUGHT:", e); process.exit(1); });
