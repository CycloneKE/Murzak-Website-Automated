/**
 * E2E_TEST must never fire when NODE_ENV=production.
 *   node test/e2eTestProductionGuard.test.js
 *
 * E2E_TEST=true is a legitimate CI-only escape hatch (see .github/workflows/
 * sast.yml): it disables every auth/credential rate limiter (server.js's
 * skipInE2E) AND the RAM capacity oversell gate (capacity.js's skipInE2E,
 * which makes thresholdMb() return Infinity) so a shared CI backend process
 * isn't tripped by test-suite bookkeeping that has nothing to do with a real
 * box being oversold.
 *
 * It was undocumented, absent from .env.example, and had NO production
 * guard -- if it were ever set (or leaked into) a production environment, it
 * would silently disable brute-force protection on every auth endpoint AND
 * make the storefront believe the node has infinite capacity. This proves
 * NODE_ENV=production wins over E2E_TEST=true in both places.
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const { skipInE2E } = require("../server");
const capacity = require("../services/provisioning/capacity");

(async () => {
  section("server.js skipInE2E (rate limiters)");
  {
    withEnv({ E2E_TEST: "true", NODE_ENV: "test" }, () => {
      ok(skipInE2E() === true, "E2E_TEST=true skips rate limiting outside production (unchanged CI behavior)");
    });
    withEnv({ E2E_TEST: "true", NODE_ENV: "production" }, () => {
      ok(skipInE2E() === false, "E2E_TEST=true is IGNORED when NODE_ENV=production -- rate limiting stays on");
    });
    withEnv({ E2E_TEST: undefined, NODE_ENV: "production" }, () => {
      ok(skipInE2E() === false, "no E2E_TEST at all in production -> rate limiting stays on");
    });
  }

  section("capacity.js skipInE2E (RAM oversell gate)");
  {
    withEnv({ E2E_TEST: "true", NODE_ENV: "test" }, () => {
      ok(capacity.thresholdMb() === Infinity, "E2E_TEST=true still disables the gate outside production (unchanged CI behavior)");
    });
    withEnv({ E2E_TEST: "true", NODE_ENV: "production" }, () => {
      const t = capacity.thresholdMb();
      ok(t !== Infinity && Number.isFinite(t), `E2E_TEST=true is IGNORED when NODE_ENV=production -- real threshold applies (got ${t})`);
      ok(capacity.gateExceeded({ reserved: 999999, ramMb: 999999 }) === true, "the oversell gate still trips in production even with E2E_TEST=true");
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("UNCAUGHT:", e); process.exit(1); });
