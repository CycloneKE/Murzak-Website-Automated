/**
 * Minimal S3-compatible client (AWS Signature V4) — no SDK dependency,
 * matching this codebase's existing style of hand-rolled REST clients
 * (Coolify, Frappe, PayPal) rather than pulling in heavy SDKs. Works against
 * AWS S3, Backblaze B2 (S3-compatible API), or DigitalOcean Spaces — matching
 * the off-box-backup provider pattern already used elsewhere in this app.
 *
 * Unlike the Coolify integration, SigV4 is a fixed, publicly documented
 * algorithm (not a guess at an undocumented API) — so presignGetUrl() below
 * is fully computable offline and genuinely unit-tested, not just
 * "unverified live." putObject/deleteObject still make real HTTP calls that
 * have never run against a real bucket — THOSE are the unverified-live parts.
 *
 * Recordings hold customer secrets (see the Phase 5.4 plan notes) — every
 * object is written with server-side encryption requested and every
 * presigned URL is short-lived by default.
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
  // YYYYMMDD'T'HHMMSS'Z'
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function dateStamp(date) {
  return amzDateStamp(date).slice(0, 8);
}

function cfg(opts = {}) {
  const endpoint = opts.endpoint || process.env.TERMINAL_S3_ENDPOINT;
  const bucket = opts.bucket || process.env.TERMINAL_S3_BUCKET;
  const region = opts.region || process.env.TERMINAL_S3_REGION || "us-east-1";
  const accessKeyId = opts.accessKeyId || process.env.TERMINAL_S3_ACCESS_KEY_ID;
  const secretAccessKey = opts.secretAccessKey || process.env.TERMINAL_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Terminal recording storage is not configured (TERMINAL_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY)."
    );
  }
  const u = new URL(endpoint);
  return { endpoint: u, bucket, region, accessKeyId, secretAccessKey, service: "s3" };
}

function signingKey(secretAccessKey, date, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp(date));
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Path-style URL: https://endpoint-host/{bucket}/{key}. Path-style (not
 * virtual-hosted) works uniformly across AWS S3, B2, and DO Spaces without
 * per-provider DNS assumptions.
 */
function objectPath(bucket, key) {
  return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Presigned URL core — shared by presignGetUrl and presignPutUrl. PURE (no
 * network, no I/O), fully deterministic given the same `now`. Only the HTTP
 * method differs between a download link and an upload link; everything else
 * about SigV4 query-string presigning is identical.
 */
function presignUrl(method, key, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const expiresSeconds = Math.min(Math.max(Number(opts.expiresSeconds) || 300, 1), 7 * 24 * 3600);

  const host = c.endpoint.host;
  const canonicalUri = objectPath(c.bucket, key);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;
  const amzDate = amzDateStamp(now);

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  return `${c.endpoint.protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/** Generate a presigned GET URL — the recording/file download link. */
function presignGetUrl(key, opts = {}) {
  return presignUrl("GET", key, opts);
}

/** Generate a presigned PUT URL — a customer's browser uploads directly here. */
function presignPutUrl(key, opts = {}) {
  return presignUrl("PUT", key, opts);
}

/**
 * PUT the recording bytes. ⚠️ Real HTTP call, never exercised against a live
 * bucket — a wrong endpoint/region/credential surfaces as a thrown error,
 * which the caller (retention sweep / broker session-outcome report) must
 * treat as a real failure, never a silently-dropped recording.
 */
async function putObject(key, body, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const contentType = opts.contentType || "application/x-ndjson";
  const payloadHash = sha256hex(typeof body === "string" ? body : body.toString("utf8"));
  const host = c.endpoint.host;
  const canonicalUri = objectPath(c.bucket, key);
  const amzDate = amzDateStamp(now);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;

  // Server-side encryption requested on every write — recordings hold
  // customer secrets (see file header).
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-server-side-encryption": "AES256",
    "content-type": contentType,
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

/** DELETE an object — used by the retention sweep. Same unverified-live caveat as putObject. */
async function deleteObject(key, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const host = c.endpoint.host;
  const canonicalUri = objectPath(c.bucket, key);
  const amzDate = amzDateStamp(now);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;
  const payloadHash = sha256hex("");

  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${c.endpoint.protocol}//${host}${canonicalUri}`;
  await axios.delete(url, {
    headers: { ...headers, Authorization: authHeader },
    timeout: Number(process.env.TERMINAL_S3_TIMEOUT_MS || 30000),
    validateStatus: (s) => s === 204 || s === 200 || s === 404, // already-gone is a successful purge outcome
  });
}

function isConfigured(opts = {}) {
  try { cfg(opts); return true; } catch { return false; }
}

/** Strip XML entities MinIO/S3 escape in Key text nodes. */
function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Regex-parsed XML, matching this codebase's "simple extractor, not a full
 * parser" style (see scripts/generate-catalog-snapshot.js) — safe here
 * because the response is our own trusted bucket's, never arbitrary
 * attacker input.
 */
function parseListObjectsXml(xml) {
  const items = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = contentsRe.exec(xml)) !== null) {
    const block = m[1];
    const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
    const size = (block.match(/<Size>([\s\S]*?)<\/Size>/) || [])[1];
    const lastModified = (block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1];
    if (key) items.push({ key: decodeXmlEntities(key), size: Number(size) || 0, lastModified: lastModified || null });
  }
  return items;
}

/**
 * List objects under a prefix (ListObjectsV2). Real HTTP call, never
 * exercised against a live bucket — same unverified-live caveat as
 * putObject/deleteObject.
 */
async function listObjectsV2(prefix, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const host = c.endpoint.host;
  const canonicalUri = `/${c.bucket}`;
  const amzDate = amzDateStamp(now);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;
  const payloadHash = sha256hex("");

  const queryParams = { "list-type": "2", prefix };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = ["GET", canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${c.endpoint.protocol}//${host}${canonicalUri}?${canonicalQueryString}`;
  const res = await axios.get(url, {
    headers: { ...headers, Authorization: authHeader },
    timeout: Number(process.env.TERMINAL_S3_TIMEOUT_MS || 30000),
  });
  return parseListObjectsXml(String(res.data));
}

module.exports = { presignGetUrl, presignPutUrl, listObjectsV2, putObject, deleteObject, isConfigured, objectPath };
