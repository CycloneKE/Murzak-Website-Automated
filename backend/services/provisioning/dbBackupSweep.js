// services/provisioning/dbBackupSweep.js
//
// Closes the gap when a customer database was handed over without a backup.
//
// A database is provisioned first and its backup scheduled straight after
// (lanes/coolify.js -> dbBackup.js). That second step can fail for reasons
// that pass: Coolify busy, the S3 destination briefly not validated, a token
// permission fixed an hour later. It also can't run at all before the S3
// destination is configured, which is the case for every database sold before
// that setting existed. Each of those leaves a job with backup_status
// "failed" or "skipped" and a customer's data with no off-server copy.
//
// This sweep finds those jobs and schedules the backup again. It is safe to
// repeat: Coolify replaces a volume's schedule rather than adding a second, so
// a job that already has one is just confirmed.
//
// It only touches ACTIVE coolify-lane jobs for a database product. It never
// creates, restarts or deletes a resource, and it does nothing at all until
// the S3 destination is configured (otherwise it would re-mark every job
// "skipped" forever).

const { JOB_DOCTYPE } = require("./constants");
const targets = require("./targets");
const coolify = require("./lanes/coolify");
const dbBackup = require("./dbBackup");

const enc = encodeURIComponent;
const MAX_PER_PASS = 10;

/**
 * One pass. Returns { checked, configured, failed, unchanged, skippedAll?, error? }.
 * Never throws.
 *
 * opts (for tests): lane, getTarget, isConfigured
 */
async function sweepDatabaseBackups(client, opts = {}) {
  const lane = opts.lane || coolify;
  const getTarget = opts.getTarget || targets.getTarget;
  const isConfigured = opts.isConfigured || dbBackup.isConfigured;
  const out = { checked: 0, configured: 0, failed: 0, unchanged: 0 };

  if (!isConfigured()) return { ...out, skippedAll: true };

  let rows;
  try {
    const res = await client.get(`/api/resource/${enc(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([
          ["lane", "=", "coolify"],
          ["status", "=", "active"],
          ["backup_status", "in", ["pending", "skipped", "failed"]],
        ]),
        fields: JSON.stringify(["name", "service_id", "external_ref", "target", "backup_status"]),
        order_by: "modified asc",
        limit_page_length: 100,
      },
    });
    rows = res.data?.data || [];
  } catch (e) {
    return { ...out, error: e.response?.data?.message || e.message };
  }

  const jobs = rows.filter((j) => lane.isDatabaseService(j.service_id) && String(j.external_ref || "").trim());

  for (const job of jobs.slice(0, MAX_PER_PASS)) {
    out.checked++;
    const target = getTarget(job.target || targets.PRIMARY_ID) || getTarget(targets.PRIMARY_ID);
    if (!lane.isConfigured({ target })) continue;

    let result;
    try {
      result = await lane.ensureDatabaseBackup(String(job.external_ref).trim(), job.service_id, { target });
    } catch (e) {
      result = { status: "failed", detail: e.message };
    }

    if (result.status === "configured") {
      out.configured++;
      try {
        await client.put(`/api/resource/${enc(JOB_DOCTYPE)}/${enc(job.name)}`, { backup_status: "configured" });
      } catch (e) {
        console.warn(`[db-backup-sweep] ${job.name}: scheduled, but could not record it: ${e.message}`);
      }
      console.log(`[db-backup-sweep] ${job.name} (${job.service_id}): backup scheduled. ${result.detail || ""}`);
    } else if (result.status === "failed") {
      out.failed++;
      if (job.backup_status !== "failed") {
        try {
          await client.put(`/api/resource/${enc(JOB_DOCTYPE)}/${enc(job.name)}`, { backup_status: "failed" });
        } catch {
          /* the next pass tries again */
        }
      }
      console.error(`[db-backup-sweep] ${job.name} (${job.service_id}) STILL HAS NO BACKUP: ${result.detail || "unknown reason"}`);
    } else {
      out.unchanged++;
    }
  }
  return out;
}

module.exports = { sweepDatabaseBackups, MAX_PER_PASS };
