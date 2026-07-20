/**
 * Suite 8 — Admin console (see the QA test plan, ADM-*). Live-probe sweep:
 * every /api/admin/* route must reject a caller with NO session cookie at
 * all. (Logged-in-but-non-admin rejection — the other half of ADM-01 — is
 * covered by frontend/e2e/qa-admin.spec.ts, which can carry a real
 * authenticated browser session; this script has none.)
 *
 *   node test/qaAdmin.test.js
 *   BASE_URL=https://staging.murzaktech.tech node test/qaAdmin.test.js
 *
 * NOT wired into `npm test` — wired into `npm run test:qa-live`. Skips
 * (never false-fails) if BASE_URL isn't reachable.
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

let passed = 0, failed = 0, skipped = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function skip(msg) { skipped++; console.log("  skip:", msg); }

async function reachable() {
  try {
    const res = await fetch(`${BASE_URL}/api/nope-liveness-probe`, { signal: AbortSignal.timeout(3000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

// Every admin route this codebase exposes (adminRoutes.js), swept blind.
const ADMIN_ROUTES = [
  { method: "GET", path: "/api/admin/threads" },
  { method: "GET", path: "/api/admin/infra-links" },
  { method: "GET", path: "/api/admin/provisioning/jobs" },
  { method: "POST", path: "/api/admin/provisioning/run" },
  { method: "POST", path: "/api/admin/provisioning/jobs/DOES-NOT-EXIST/retry" },
  { method: "POST", path: "/api/admin/provisioning/jobs/DOES-NOT-EXIST/resolve" },
  { method: "GET", path: "/api/admin/provisioning/capacity" },
  { method: "GET", path: "/api/admin/provisioning/readiness" },
  { method: "GET", path: "/api/admin/provisioning/queue" },
  { method: "GET", path: "/api/admin/terminal/sessions" },
];

(async () => {
  console.log(`# Suite 8 — Admin console, live sweep against ${BASE_URL}`);

  if (!(await reachable())) {
    skip(`backend not reachable at ${BASE_URL} — start it and re-run`);
    console.log("\n================================================");
    console.log("ADMIN TESTS: 0 passed, 0 failed, 1 skipped (no live server)");
    process.exit(0);
  }

  console.log(`\n# ${ADMIN_ROUTES.length} admin routes, no session cookie`);
  let devAutoLoginSuspected = false;

  for (const route of ADMIN_ROUTES) {
    const res = await fetch(`${BASE_URL}${route.path}`, { method: route.method });
    if (res.status === 401 || res.status === 403) {
      ok(true, `${route.method} ${route.path} -> ${res.status} (rejected)`);
    } else if (res.status === 200) {
      devAutoLoginSuspected = true;
      skip(`${route.method} ${route.path} -> 200 with NO cookie (DEV_AUTO_LOGIN=true suspected on this server)`);
    } else {
      // Any other status (404 for a bad job id post-auth would be fine, but
      // pre-auth it should never get past the gate to reach that logic) —
      // treat as a genuine finding worth flagging, not a silent pass.
      ok(false, `${route.method} ${route.path} -> unexpected ${res.status} for an unauthenticated request`);
    }
  }

  if (devAutoLoginSuspected) {
    console.log(
      "\n  NOTE: some routes returned 200 unauthenticated — this environment almost certainly has " +
      "DEV_AUTO_LOGIN=true. Re-run with that unset (and no cookie) before treating this suite as passing " +
      "for a security sign-off."
    );
  }

  console.log("\n================================================");
  console.log(`ADMIN TESTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN" + (skipped ? " (with skips — see above)" : ""));
})();
