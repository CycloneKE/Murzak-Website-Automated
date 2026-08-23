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

// Regression, 2026-08-18: shape confirmed live against a real Coolify 4.1.2
// service (app-a5apm1mb72t9qlcopo1e9ybd). The container's own NAME is
// Coolify-generated ("app-<serviceUuid>"), never the ownership slug; only
// the coolify.resourceName label carries it. Before OWNERSHIP_LABEL_KEYS
// included it, this container matched NOTHING — every real /exec would
// have 403'd as NO_MATCH.
const REAL_SERVICE_CONTAINER = {
  Id: "real-uuid",
  Names: ["/app-a5apm1mb72t9qlcopo1e9ybd"],
  Labels: {
    "coolify.name": "app-a5apm1mb72t9qlcopo1e9ybd",
    "coolify.resourceName": "user-26-08-18-0001-biz-web-hosting",
    "coolify.serviceName": "app",
    "com.docker.compose.service": "app",
    "com.docker.compose.project": "a5apm1mb72t9qlcopo1e9ybd",
  },
};
ok(
  containerMatchesOwner(REAL_SERVICE_CONTAINER, "user-26-08-18-0001-biz-web-hosting") === true,
  "real Coolify service container shape resolves by coolify.resourceName, not by container name"
);
// "app" is the literal compose-service-key label value on every single-
// service container — it WOULD match if a token's expectedName were ever
// literally "app", but expectedName is always resourceName(job)
// ("{web_account}-{service_id}"), never that bare string, so this is not a
// real collision risk in practice.
ok(
  containerMatchesOwner(REAL_SERVICE_CONTAINER, "acme-shop-web") === false,
  "an unrelated tenant's expected name does not match this container"
);

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
