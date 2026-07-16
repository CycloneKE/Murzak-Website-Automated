/**
 * Phase 5.4 unit tests — retention tier logic, recording-access gate, and the
 * S3 presigned-URL signer's pure, fully-offline-computable half. No network,
 * no Frappe, no real bucket. node test/terminalRetention.test.js
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

const { computeRetentionTier, computeExpiresAtMs, isExpired, upgradeRetention, DAY_MS } = require("../services/terminal/retention");
const { isRecordingAccessAuthorized, buildAccessLogEntry, parseEmailList } = require("../services/terminal/accessControl");
const { presignGetUrl } = require("../services/terminal/s3Client");

console.log("# computeRetentionTier");
{
  const routine = computeRetentionTier({ exitReason: "client_closed" });
  ok(routine.tier === "routine", "clean client_closed -> routine tier");
  ok(routine.flaggedReason === null, "routine has no flagged reason");

  const autoFlagged = computeRetentionTier({ exitReason: "exec_failed" });
  ok(autoFlagged.tier === "flagged", "exec_failed auto-upgrades to flagged");
  ok(/exit_reason=exec_failed/.test(autoFlagged.flaggedReason), "auto-flag reason names the exit reason");

  ok(computeRetentionTier({ exitReason: "admin_killed" }).tier === "flagged", "admin_killed auto-flags");
  ok(computeRetentionTier({ exitReason: "account_suspended" }).tier === "flagged", "account_suspended auto-flags");
  ok(computeRetentionTier({ exitReason: "idle_timeout" }).tier === "routine", "idle_timeout alone is still routine");

  const manual = computeRetentionTier({ exitReason: "client_closed", manuallyFlagged: true, manualFlagReason: "customer disputed a charge" });
  ok(manual.tier === "flagged" && manual.flaggedReason === "customer disputed a charge", "manual flag overrides a clean exit reason with its own reason");

  const hold = computeRetentionTier({ exitReason: "client_closed", legalHold: true, legalHoldSetBy: "security@murzaktech.com" });
  ok(hold.tier === "legal_hold" && hold.legalHoldSetBy === "security@murzaktech.com", "legal hold wins over everything, records who set it");

  throws(() => computeRetentionTier({ legalHold: true }), "MISSING_LEGAL_HOLD_OWNER", "legal hold without a named owner is refused, not silently anonymous");
}

console.log("# computeExpiresAtMs / isExpired");
{
  const start = Date.parse("2026-01-01T00:00:00Z");
  ok(computeExpiresAtMs("routine", start) === start + 30 * DAY_MS, "routine defaults to 30 days from START (not from now)");
  ok(computeExpiresAtMs("flagged", start) === start + 90 * DAY_MS, "flagged defaults to 90 days");
  ok(computeExpiresAtMs("legal_hold", start) === null, "legal_hold has no automatic expiry");

  const session = { retention_tier: "routine", expires_at: new Date(start + 30 * DAY_MS).toISOString(), purged: 0 };
  ok(isExpired(session, start + 31 * DAY_MS) === true, "past expiry -> expired");
  ok(isExpired(session, start + 29 * DAY_MS) === false, "before expiry -> not expired");
  ok(isExpired({ ...session, purged: 1 }, start + 31 * DAY_MS) === false, "already-purged session is never re-flagged as expired");
  ok(isExpired({ ...session, retention_tier: "legal_hold" }, start + 999 * DAY_MS) === false, "legal_hold is NEVER expired automatically, no matter how old");
}

console.log("# upgradeRetention — anchors to original start, never shortens");
{
  const session = { started_at: "2026-01-01T00:00:00.000Z", exit_reason: "client_closed" };
  const up = upgradeRetention(session, { manualFlagReason: "chargeback investigation" });
  ok(up.retention_tier === "flagged", "upgrade moves routine -> flagged");
  const expectedExpiry = Date.parse("2026-01-01T00:00:00Z") + 90 * DAY_MS;
  ok(Date.parse(up.expires_at) === expectedExpiry, "upgraded expiry is anchored to the ORIGINAL start, not to when it was flagged");

  throws(() => upgradeRetention({}), "MISSING_STARTED_AT", "upgrading a session with no started_at is refused");
}

console.log("# recording access control — separate list from ADMIN_EMAILS");
{
  ok(isRecordingAccessAuthorized("sec@murzaktech.com", "sec@murzaktech.com, ops@murzaktech.com") === true, "email on the list is authorized");
  ok(isRecordingAccessAuthorized("SEC@MURZAKTECH.COM", "sec@murzaktech.com") === true, "case-insensitive match");
  ok(isRecordingAccessAuthorized("support@murzaktech.com", "sec@murzaktech.com") === false, "a general support email is NOT authorized just by asking");
  ok(isRecordingAccessAuthorized("", "sec@murzaktech.com") === false, "empty email is never authorized");
  ok(parseEmailList(" a@x.com ,b@y.com").length === 2, "parseEmailList trims and splits");

  const entry = buildAccessLogEntry({ sessionName: "TERM-WA-00001", accessedBy: "Sec@MurzakTech.com", reason: "ticket #123", granted: true });
  ok(entry.accessed_by === "sec@murzaktech.com", "log entry normalizes email casing");
  ok(entry.granted === 1, "granted:true stores as 1 (Frappe Check field)");
  ok(!!entry.accessed_at, "log entry stamps accessed_at");

  const denied = buildAccessLogEntry({ sessionName: "TERM-WA-00001", accessedBy: "random@x.com", reason: "curious", granted: false });
  ok(denied.granted === 0, "a DENIED attempt is still logged, not dropped (granted:0)");

  throws(() => buildAccessLogEntry({ sessionName: "s", accessedBy: "a@b.com", reason: "" }), "REASON_REQUIRED", "empty reason is refused — no justification-free access logging");
  throws(() => buildAccessLogEntry({ sessionName: "s", accessedBy: "a@b.com" }), "REASON_REQUIRED", "missing reason is refused");
}

console.log("# S3 presigned GET URL — pure, deterministic, offline");
{
  const opts = {
    endpoint: "https://s3.us-west-002.backblazeb2.com",
    bucket: "murzak-terminal-recordings",
    region: "us-west-002",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "supersecretkey",
    now: new Date("2026-01-15T10:00:00Z"),
  };
  const url1 = presignGetUrl("sessions/TERM-WA-00001.ndjson", opts);
  const url2 = presignGetUrl("sessions/TERM-WA-00001.ndjson", opts);
  ok(url1 === url2, "identical inputs (incl. injected `now`) produce an identical signature — deterministic");
  ok(url1.startsWith("https://s3.us-west-002.backblazeb2.com/murzak-terminal-recordings/sessions/"), "presigned URL targets the correct path-style bucket/key");
  ok(/X-Amz-Signature=[0-9a-f]{64}/.test(url1), "URL carries a 64-char hex signature");
  ok(/X-Amz-Expires=300\b/.test(url1), "defaults to a 300s (5 min) expiry");

  const urlDifferentKey = presignGetUrl("sessions/OTHER.ndjson", opts);
  ok(urlDifferentKey !== url1, "a different object key changes the signature");

  const urlDifferentExpiry = presignGetUrl("sessions/TERM-WA-00001.ndjson", { ...opts, expiresSeconds: 60 });
  ok(urlDifferentExpiry !== url1 && /X-Amz-Expires=60\b/.test(urlDifferentExpiry), "expiresSeconds is honored and changes the signature");

  const urlDifferentSecret = presignGetUrl("sessions/TERM-WA-00001.ndjson", { ...opts, secretAccessKey: "different" });
  ok(urlDifferentSecret !== url1, "a different secret key changes the signature (can't forge without it)");

  const urlLongExpiry = presignGetUrl("k", { ...opts, expiresSeconds: 999999 });
  ok(/X-Amz-Expires=604800\b/.test(urlLongExpiry), "expiry is clamped to the max (7 days / 604800s)");
}

console.log(`\nTERMINAL RETENTION TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
