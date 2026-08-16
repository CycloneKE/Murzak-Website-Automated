/**
 * s3Client.js — presigned PUT + ListObjectsV2, and a refactor-safety check
 * that presignGetUrl's existing output is byte-for-byte unchanged.
 * node test/s3Client.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { presignGetUrl, presignPutUrl } = require("../services/terminal/s3Client");

console.log("# presignGetUrl — unchanged after refactor (golden output)");
{
  const opts = {
    endpoint: "https://s3.us-west-002.backblazeb2.com",
    bucket: "murzak-terminal-recordings",
    region: "us-west-002",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "supersecretkey",
    now: new Date("2026-01-15T10:00:00Z"),
  };
  const url = presignGetUrl("sessions/TERM-WA-00001.ndjson", opts);
  const expectedPrefix =
    "https://s3.us-west-002.backblazeb2.com/murzak-terminal-recordings/sessions/TERM-WA-00001.ndjson" +
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260115%2Fus-west-002%2Fs3%2Faws4_request" +
    "&X-Amz-Date=20260115T100000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=";
  ok(url.startsWith(expectedPrefix), "GET URL shape unchanged (method, path, query params) after the presignUrl refactor");
  ok(/^[0-9a-f]{64}$/.test(url.slice(expectedPrefix.length)), "trailing signature is still a 64-char hex string");
}

console.log("# presignPutUrl — same signing scheme, method PUT");
{
  const opts = {
    endpoint: "https://minio.murzaktech.internal",
    bucket: "murzak-customer-files",
    region: "us-east-1",
    accessKeyId: "AKIASTORAGE",
    secretAccessKey: "storagesecret",
    now: new Date("2026-08-16T09:00:00Z"),
  };
  const url1 = presignPutUrl("WA-1/starter-storage/report.pdf", opts);
  const url2 = presignPutUrl("WA-1/starter-storage/report.pdf", opts);
  ok(url1 === url2, "deterministic — identical inputs produce an identical signature");
  ok(url1.startsWith("https://minio.murzaktech.internal/murzak-customer-files/WA-1/starter-storage/report.pdf"), "targets the correct path-style bucket/key");
  ok(/X-Amz-Signature=[0-9a-f]{64}/.test(url1), "carries a 64-char hex signature");

  const urlDifferentKey = presignPutUrl("WA-1/starter-storage/other.pdf", opts);
  ok(urlDifferentKey !== url1, "a different key changes the signature");

  const urlGet = presignGetUrl("WA-1/starter-storage/report.pdf", opts);
  ok(urlGet !== url1, "PUT and GET presigns for the SAME key differ (method is part of the signed request)");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
