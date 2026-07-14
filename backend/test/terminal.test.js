/**
 * Terminal (Phase 5.2) unit tests — pure crypto/consumption logic, no
 * network/Redis/session store. node test/terminal.test.js (or via npm test).
 */

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function throws(fn, code, msg) {
  try { fn(); ok(false, msg + " (did not throw)"); }
  catch (e) { ok(!code || e.code === code, msg + (code ? ` (code=${e.code})` : "")); }
}

const { signBrokerToken } = require("../utils/brokerToken");
const { mintWsTicket, consumeWsTicket, _pendingSizeForTest } = require("../utils/wsTicket");

console.log("# brokerToken — sign (verify lives in broker/lib/token.js, tested there; this checks cross-compat)");
{
  // Cross-compatibility: a token signed here must verify with broker's own
  // verify() given the same key — this is the contract that matters most,
  // since backend and broker are separately deployed images.
  const brokerVerify = require("../../broker/lib/token").verify;
  const KEY = "shared-key";
  const tok = signBrokerToken({ expectedName: "acme-web", exp: Date.now() + 30000 }, KEY);
  const payload = brokerVerify(tok, KEY);
  ok(payload.expectedName === "acme-web", "token signed by backend verifies via broker's verify() (cross-package compat)");
  throws(() => brokerVerify(tok, "wrong-key"), "BAD_SIG", "wrong key still rejected cross-package");
  throws(() => signBrokerToken({}, ""), null, "signBrokerToken throws with no key");
}

console.log("# wsTicket — mint / consume / single-use");
{
  const KEY = "session-secret-for-test";
  const t1 = mintWsTicket({ webAccount: "WA1", jobName: "PRV-1" }, KEY, 30000);
  const payload = consumeWsTicket(t1, KEY);
  ok(payload.webAccount === "WA1" && payload.jobName === "PRV-1", "mint+consume round-trips payload");
  throws(() => consumeWsTicket(t1, KEY), "ALREADY_USED", "second consume of the same ticket fails (single-use)");

  const t2 = mintWsTicket({ webAccount: "WA2" }, KEY, 30000);
  throws(() => consumeWsTicket(t2, "different-key"), "BAD_SIG", "wrong key rejected");
  throws(() => consumeWsTicket(t2 + "x", KEY), "BAD_SIG", "tampered ticket rejected");
  // second call above was rejected for bad sig, not consumed — confirm the
  // real ticket is still valid for the FIRST correct attempt:
  const payload2 = consumeWsTicket(t2, KEY);
  ok(payload2.webAccount === "WA2", "ticket survives an unrelated failed verification attempt");

  const expired = mintWsTicket({ webAccount: "WA3" }, KEY, -1);
  throws(() => consumeWsTicket(expired, KEY), "EXPIRED", "expired ticket rejected");

  throws(() => consumeWsTicket("garbage", KEY), "MALFORMED", "malformed ticket rejected");

  // The still-expired ticket above is swept lazily on the NEXT mint call, so
  // after this mint only the freshly-minted entry remains — proving both
  // that mint tracks new entries AND that expired ones don't leak forever.
  mintWsTicket({ webAccount: "WA4" }, KEY, 30000);
  ok(_pendingSizeForTest() === 1, "mint tracks the new entry and sweeps the expired one");
}

console.log(`\nTERMINAL TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
