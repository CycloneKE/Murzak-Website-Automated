/**
 * Broker unit tests — the two security-critical PURE modules: exact-ownership
 * container resolution and token signing/verification. No Docker, no network.
 *   node test/resolve.test.js
 */

const assert = require("assert");
const { containerMatchesOwner, resolveOwnedContainerId, normalizeContainerNames } = require("../lib/resolve");
const { sign, verify } = require("../lib/token");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function throws(fn, code, msg) {
  try { fn(); ok(false, msg + " (did not throw)"); }
  catch (e) { ok(!code || e.code === code, msg + (code ? ` (code=${e.code})` : "")); }
}

console.log("# resolve — exact ownership match");
const EXPECT = "acme-shop-web";

ok(containerMatchesOwner({ Names: ["/acme-shop-web"] }, EXPECT) === true, "exact name match (strips leading slash)");
ok(containerMatchesOwner({ Names: ["/acme-shop-web-admin"] }, EXPECT) === false, "prefix does NOT match (acme-shop-web-admin)");
ok(containerMatchesOwner({ Names: ["/acme-shop"] }, EXPECT) === false, "shorter name does NOT match");
ok(containerMatchesOwner({ Labels: { "coolify.name": "acme-shop-web" } }, EXPECT) === true, "exact label match");
ok(containerMatchesOwner({ Labels: { "coolify.name": "acme-shop-web-2" } }, EXPECT) === false, "near-miss label does NOT match");
ok(containerMatchesOwner({ Labels: { "unrelated.key": "acme-shop-web" } }, EXPECT) === false, "match only on known ownership label keys");
ok(containerMatchesOwner(null, EXPECT) === false, "null container is not a match");
ok(containerMatchesOwner({ Names: ["/acme-shop-web"] }, "") === false, "empty expected name never matches");
ok(normalizeContainerNames(["/a", "//b", "c"]).join(",") === "a,b,c", "normalizeContainerNames strips leading slashes");

console.log("# resolve — unique-id resolution");
const list = [
  { Id: "aaa", Names: ["/other-tenant-web"] },
  { Id: "bbb", Names: ["/acme-shop-web"] },
  { Id: "ccc", Names: ["/acme-shop-web-admin"] },
];
ok(resolveOwnedContainerId(list, EXPECT).id === "bbb", "resolves to the single exact-owner id");
throws(() => resolveOwnedContainerId(list, "nope-web"), "NO_MATCH", "no match throws NO_MATCH");
throws(
  () => resolveOwnedContainerId([{ Id: "x", Names: ["/dup"] }, { Id: "y", Names: ["/dup"] }], "dup"),
  "AMBIGUOUS",
  "two exact matches throws AMBIGUOUS (never guesses)"
);

console.log("# token — sign / verify");
const KEY = "test-signing-key";
const OTHER = "different-key";
const future = Date.now() + 60000;
const tok = sign({ containerId: "bbb", expectedName: EXPECT, webAccount: "WA", jti: "j1", exp: future }, KEY);
ok(verify(tok, KEY).expectedName === EXPECT, "valid token verifies and returns payload");
throws(() => verify(tok, OTHER), "BAD_SIG", "wrong key rejected (BAD_SIG)");
throws(() => verify(tok + "x", KEY), "BAD_SIG", "tampered MAC rejected");
throws(() => verify("garbage", KEY), "MALFORMED", "malformed token rejected");
const expired = sign({ expectedName: EXPECT, exp: Date.now() - 1 }, KEY);
throws(() => verify(expired, KEY), "EXPIRED", "expired token rejected (EXPIRED)");
// exp check is evaluated against injectable now:
ok(verify(sign({ expectedName: EXPECT, exp: 1000 }, KEY), KEY, 999).expectedName === EXPECT, "not-yet-expired at injected now passes");

console.log(`\nBROKER TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
