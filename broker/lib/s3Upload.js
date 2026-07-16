/**
 * Minimal S3-compatible PUT client for session recordings — broker-local
 * duplicate of backend/services/terminal/s3Client.js's putObject/isConfigured.
 * Intentionally duplicated, not imported: the broker and backend are separate
 * deploy images with separate dependency trees (same convention already used
 * for utils/brokerToken.js / broker/lib/token.js). The broker holds S3 write
 * creds for its OWN output (recordings) — this is not a Frappe/PayPal
 * credential, so it doesn't violate the broker's "no payment creds" rule.
 *
 * ⚠️ Real HTTP call, never exercised against a live bucket yet.
 */

const crypto = require("crypto");
const axios = require("axios");

function hmac(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}
function sha256hex(msg) {
  return crypto.createHash("sha256").update(msg, "utf8").digest("hex");
}
function amzDateStamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function dateStamp(date) {
  return amzDateStamp(date).slice(0, 8);
}

function cfg() {
  const endpoint = process.env.TERMINAL_S3_ENDPOINT;
  const bucket = process.env.TERMINAL_S3_BUCKET;
  const region = process.env.TERMINAL_S3_REGION || "us-east-1";
  const accessKeyId = process.env.TERMINAL_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TERMINAL_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: new URL(endpoint), bucket, region, accessKeyId, secretAccessKey, service: "s3" };
}

function signingKey(secretAccessKey, date, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp(date));
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function objectPath(bucket, key) {
  return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isConfigured() {
  return cfg() !== null;
}

async function putObject(key, body) {
  const c = cfg();
  if (!c) throw new Error("Recording storage is not configured.");
  const now = new Date();
  const payloadHash = sha256hex(typeof body === "string" ? body : body.toString("utf8"));
  const host = c.endpoint.host;
  const canonicalUri = objectPath(c.bucket, key);
  const amzDate = amzDateStamp(now);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-server-side-encryption": "AES256",
    "content-type": "application/x-ndjson",
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${c.endpoint.protocol}//${host}${canonicalUri}`;
  await axios.put(url, body, {
    headers: { ...headers, Authorization: authHeader },
    timeout: Number(process.env.TERMINAL_S3_TIMEOUT_MS || 30000),
  });
}

module.exports = { putObject, isConfigured, objectPath };
