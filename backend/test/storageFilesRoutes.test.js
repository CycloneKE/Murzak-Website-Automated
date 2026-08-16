/**
 * File Storage routes — the quota-headroom check that gates every upload.
 * Pure functions, no Express harness (this codebase has none — see
 * resourceAdmin.test.js). node test/storageFilesRoutes.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { hasQuotaHeadroom } = require("../services/storage/quota");

console.log("# hasQuotaHeadroom — reject only when usage + incoming exceeds quota");
{
  ok(hasQuotaHeadroom({ usedBytes: 0, incomingBytes: 100, quotaBytes: 1000 }) === true, "well under quota");
  ok(hasQuotaHeadroom({ usedBytes: 900, incomingBytes: 100, quotaBytes: 1000 }) === true, "exactly at quota is allowed");
  ok(hasQuotaHeadroom({ usedBytes: 900, incomingBytes: 101, quotaBytes: 1000 }) === false, "one byte over quota is refused");
  ok(hasQuotaHeadroom({ usedBytes: 0, incomingBytes: 0, quotaBytes: 0 }) === false, "a zero quota (unknown product) never allows an upload");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
