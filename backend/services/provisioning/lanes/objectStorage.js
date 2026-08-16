/**
 * Lane — Object Storage (the "Storage" category). Unlike coolify/bench/k8s,
 * there is no infrastructure to build per purchase: the bucket is one fixed
 * platform resource every File Storage customer shares, isolated by
 * key-prefix. provision() marks the job active immediately.
 *
 * Required env (via storageS3.js): STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET,
 * STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY.
 *
 * See docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
 */
const storageS3 = require("../../storage/storageS3");

function isConfigured() {
  return storageS3.isConfigured();
}

function configError() {
  if (isConfigured()) return null;
  return "Object storage lane not configured (missing: STORAGE_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY)";
}

async function provision(job) {
  const prefix = storageS3.customerPrefix(job.web_account, job.service_id);
  return {
    externalRef: prefix,
    access: { lane: "objectStorage", prefix },
    log: `[objectStorage] activated shared-bucket prefix "${prefix}" — no container created.`,
  };
}

module.exports = { lane: "objectStorage", isConfigured, configError, provision };
