/**
 * storageS3.js — customer key-prefixing, filename sanitization, and the
 * STORAGE_BROWSER_ENABLED kill switch. node test/storageS3.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function throws(fn, msg) {
  try { fn(); ok(false, msg + " (did not throw)"); }
  catch (e) { ok(true, msg); }
}
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

const storageS3 = require("../services/storage/storageS3");
const { isStorageBrowserEnabled } = require("../services/storageEligibility");

console.log("# kill switch defaults OFF");
{
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "" }, isStorageBrowserEnabled) === false, "unset -> disabled");
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "false" }, isStorageBrowserEnabled) === false, "'false' -> disabled");
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "true" }, isStorageBrowserEnabled) === true, "'true' -> enabled");
}

console.log("# isConfigured — requires all four STORAGE_S3_* vars");
{
  ok(withEnv({ STORAGE_S3_ENDPOINT: "", STORAGE_S3_BUCKET: "", STORAGE_S3_ACCESS_KEY_ID: "", STORAGE_S3_SECRET_ACCESS_KEY: "" }, storageS3.isConfigured) === false, "nothing set -> not configured");
  ok(withEnv({
    STORAGE_S3_ENDPOINT: "https://minio.internal",
    STORAGE_S3_BUCKET: "murzak-customer-files",
    STORAGE_S3_ACCESS_KEY_ID: "key",
    STORAGE_S3_SECRET_ACCESS_KEY: "secret",
  }, storageS3.isConfigured) === true, "all four set -> configured");
}

console.log("# customerPrefix — safe inputs only, never mangled into a possible collision");
{
  ok(storageS3.customerPrefix("WA-00001", "starter-storage") === "WA-00001/starter-storage/", "builds the expected prefix");
  throws(() => storageS3.customerPrefix("../etc", "starter-storage"), "path-traversal webAccountName is refused, not sanitized-and-allowed");
  throws(() => storageS3.customerPrefix("WA-1/../WA-2", "starter-storage"), "slash-containing webAccountName is refused");
  throws(() => storageS3.customerPrefix("", "starter-storage"), "empty webAccountName is refused");
  throws(() => storageS3.customerPrefix("WA-1", ""), "empty serviceId is refused");
}

console.log("# sanitizeFileName — flat namespace, no traversal");
{
  ok(storageS3.sanitizeFileName("report.pdf") === "report.pdf", "plain filename accepted");
  ok(storageS3.sanitizeFileName("  spaced name.txt  ") === "spaced name.txt", "trims surrounding whitespace");
  ok(storageS3.sanitizeFileName("a/b.txt") === null, "forward slash refused (no nested paths)");
  ok(storageS3.sanitizeFileName("a\\b.txt") === null, "backslash refused");
  ok(storageS3.sanitizeFileName("..") === null, "bare .. refused");
  ok(storageS3.sanitizeFileName("") === null, "empty name refused");
  ok(storageS3.sanitizeFileName("x".repeat(300)) === null, "over-long name refused");
}

console.log("# keyBelongsToPrefix — the ownership boundary");
{
  const prefix = "WA-1/starter-storage/";
  ok(storageS3.keyBelongsToPrefix(prefix + "report.pdf", prefix) === true, "own key inside prefix");
  ok(storageS3.keyBelongsToPrefix("WA-2/starter-storage/report.pdf", prefix) === false, "another tenant's key rejected");
  ok(storageS3.keyBelongsToPrefix(prefix, prefix) === false, "the bare prefix itself is not a file");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
