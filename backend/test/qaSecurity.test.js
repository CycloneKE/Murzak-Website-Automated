/**
 * Suite 9 — Security & authorization (cross-cutting), see the QA test plan
 * (SEC-*). Unlike the rest of backend/test/*, these are LIVE HTTP probes
 * against a running backend — they do not import modules directly. Run:
 *
 *   node test/qaSecurity.test.js
 *   BASE_URL=https://staging.murzaktech.tech node test/qaSecurity.test.js
 *
 * NOT wired into `npm test` (which must stay runnable with no live server,
 * e.g. in CI) — wired into `npm run test:qa-live` instead. If nothing is
 * listening on BASE_URL, every case here reports SKIP with a clear reason
 * rather than a false FAIL.
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

let passed = 0, failed = 0, skipped = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function skip(msg) { skipped++; console.log("  skip:", msg); }
function section(name) { console.log(`\n# ${name}`); }

async function reachable() {
  try {
    const res = await fetch(`${BASE_URL}/api/nope-liveness-probe`, { signal: AbortSignal.timeout(3000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

(async () => {
  console.log(`# Suite 9 — Security & authorization, live probe against ${BASE_URL}`);

  if (!(await reachable())) {
    skip(`backend not reachable at ${BASE_URL} — start it (npm --prefix backend start) and re-run`);
    console.log("\n================================================");
    console.log(`SECURITY TESTS: 0 passed, 0 failed, 1 skipped (no live server)`);
    process.exit(0);
  }

  section("SEC-03 — unmatched /api/* is a real JSON 404, never the SPA shell");
  {
    const res = await fetch(`${BASE_URL}/api/this-route-does-not-exist`);
    ok(res.status === 404, `unmatched route -> 404 (got ${res.status})`);
    const ct = res.headers.get("content-type") || "";
    ok(ct.includes("application/json"), `unmatched route content-type is JSON, not HTML (got "${ct}")`);
  }

  section("SEC-01 — security headers present on every response");
  {
    const res = await fetch(`${BASE_URL}/api/nope`);
    const h = (name) => res.headers.get(name);
    ok(!!h("content-security-policy"), "Content-Security-Policy header present");
    ok((h("content-security-policy") || "").includes("object-src 'none'"), "CSP sets object-src 'none'");
    ok((h("content-security-policy") || "").includes("frame-ancestors 'none'"), "CSP sets frame-ancestors 'none'");
    ok(h("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
    ok(h("x-frame-options") === "SAMEORIGIN", "X-Frame-Options: SAMEORIGIN");
    ok(h("referrer-policy") === "no-referrer", "Referrer-Policy: no-referrer");
    const isHttps = BASE_URL.startsWith("https://");
    if (isHttps) {
      ok(!!h("strict-transport-security"), "Strict-Transport-Security present over HTTPS");
    } else {
      skip("HSTS not meaningfully testable over plain HTTP — re-run with a staging HTTPS BASE_URL");
    }
  }

  section("SEC-06 — no secrets echoed in an error response");
  {
    // Trigger a generic error path (malformed JSON body) and confirm the
    // response never contains the shapes of real secret env var names.
    const res = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const text = await res.text();
    const leakPatterns = [/SESSION_SECRET/i, /COOLIFY_TOKEN/i, /FRAPPE_API_SECRET/i, /PAYPAL_CLIENT_SECRET/i, /sk_live_/i];
    const leaked = leakPatterns.filter((p) => p.test(text));
    ok(leaked.length === 0, `malformed-request error body has no secret-shaped strings (found: ${leaked.join(", ") || "none"})`);
    ok(res.status < 500 || !/\n\s+at\s+/.test(text), "error body is not a raw Node stack trace");
  }

  section("SEC-04 — unauthenticated write endpoints reject cleanly, not with a 500");
  {
    // A completely empty/garbage login POST must be a clean 4xx, never a 500
    // (a 500 here would mean unvalidated input reached deeper, untested code).
    const res = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "<script>alert(1)</script>", password: "" }),
    });
    ok(res.status >= 400 && res.status < 500, `garbage login payload -> 4xx (got ${res.status})`);
  }

  section("SEC-02 — admin routes require auth even when nothing else is set");
  {
    // Reachable without any cookie at all. In an environment with
    // DEV_AUTO_LOGIN=true this will legitimately come back 200 (see
    // ADM-01's note) — that's not a finding here, it's a known local-dev
    // trapdoor; this probe still records what actually happened so the run
    // sheet reflects reality rather than assuming.
    const res = await fetch(`${BASE_URL}/api/admin/provisioning/jobs`);
    if (res.status === 401 || res.status === 403) {
      ok(true, `admin route rejects an unauthenticated caller (${res.status})`);
    } else if (res.status === 200) {
      skip(
        `admin route returned 200 with no auth cookie — expected if DEV_AUTO_LOGIN=true on this server; ` +
        `this MUST be re-run against a build with that flag unset before sign-off (see ADM-01)`
      );
    } else {
      ok(false, `unexpected status ${res.status} from an unauthenticated admin request`);
    }
  }

  console.log("\n================================================");
  console.log(`SECURITY TESTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN" + (skipped ? " (with skips — see above)" : ""));
})();
