/**
 * File Storage product — thin wrapper around the shared S3 client, scoped to
 * the STORAGE_S3_* env vars (a separate shared MinIO bucket from terminal
 * recordings' TERMINAL_S3_*). One bucket, every File Storage customer,
 * isolated by key-prefix. See
 * docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
 */
const s3 = require("../terminal/s3Client");

function cfg() {
  return {
    endpoint: process.env.STORAGE_S3_ENDPOINT,
    bucket: process.env.STORAGE_S3_BUCKET,
    region: process.env.STORAGE_S3_REGION || "us-east-1",
    accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
  };
}

function isConfigured() {
  const c = cfg();
  return !!(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
}

// Strict allowlist — an id that fails this is REFUSED, never mangled into a
// prefix that might collide with another tenant's.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function customerPrefix(webAccountName, serviceId) {
  const wa = String(webAccountName || "");
  const sid = String(serviceId || "");
  if (!SAFE_SEGMENT_RE.test(wa) || !SAFE_SEGMENT_RE.test(sid)) {
    throw new Error("Invalid account/service identifier for storage prefix.");
  }
  return `${wa}/${sid}/`;
}

// Flat namespace only (no nested "folders" — see design doc's out-of-scope
// list): a name containing any path separator is refused outright.
function sanitizeFileName(name) {
  const n = String(name || "").trim();
  if (!n || n === "." || n === ".." || /[\\/]/.test(n) || n.length > 255) return null;
  return n;
}

/** True only for a key that is genuinely inside this customer's own prefix — the ownership boundary for every file operation. */
function keyBelongsToPrefix(key, prefix) {
  return typeof key === "string" && key.startsWith(prefix) && key !== prefix;
}

async function listFiles(prefix) {
  const items = await s3.listObjectsV2(prefix, cfg());
  return items
    .filter((i) => keyBelongsToPrefix(i.key, prefix))
    .map((i) => ({ key: i.key, name: i.key.slice(prefix.length), size: i.size, lastModified: i.lastModified }));
}

async function usedBytes(prefix) {
  const files = await listFiles(prefix);
  return files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
}

function presignUpload(key, expiresSeconds = 300) {
  return s3.presignPutUrl(key, { ...cfg(), expiresSeconds });
}

function presignDownload(key, expiresSeconds = 300) {
  return s3.presignGetUrl(key, { ...cfg(), expiresSeconds });
}

async function deleteFile(key) {
  return s3.deleteObject(key, cfg());
}

module.exports = {
  isConfigured,
  customerPrefix,
  sanitizeFileName,
  keyBelongsToPrefix,
  listFiles,
  usedBytes,
  presignUpload,
  presignDownload,
  deleteFile,
};
