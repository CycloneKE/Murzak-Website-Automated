/**
 * Retention sweep — deletes expired recordings from off-box storage and marks
 * the Terminal Session doctype row purged. Mirrors the existing
 * expireStaleTrials/sweepRenewals pattern (server.js / renewalService.js):
 * deps injected so this is testable without a real Frappe/S3, best-effort
 * per-row so one bad row never blocks the rest of the sweep, every failure
 * logged loudly (a silently-failed purge is a retention-policy violation,
 * not a shrug).
 */

const { isExpired } = require("./retention");
const { SESSION_DOCTYPE } = require("./constants");

async function sweepExpiredRecordings({ frappeClient, s3Client, now = Date.now() } = {}) {
  const summary = { checked: 0, purged: 0, errors: 0 };
  const client = frappeClient();

  let rows;
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(SESSION_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([
          ["purged", "=", 0],
          ["retention_tier", "!=", "legal_hold"],
        ]),
        fields: JSON.stringify(["name", "retention_tier", "expires_at", "recording_key", "purged"]),
        limit_page_length: 200,
      },
    });
    rows = res.data?.data || [];
  } catch (e) {
    // The doctype not existing yet is a supported degraded state (same
    // convention as the provisioning activity endpoint) — nothing to sweep.
    if (e?.response?.status === 404 || /doctype/i.test(e?.response?.data?.exception || "")) {
      return summary;
    }
    console.error("[terminal-retention] failed to list sessions:", e.response?.data || e.message);
    summary.errors++;
    return summary;
  }

  for (const row of rows) {
    summary.checked++;
    if (!isExpired(row, now)) continue;

    try {
      if (row.recording_key && s3Client.isConfigured()) {
        await s3Client.deleteObject(row.recording_key);
      }
      await client.put(`/api/resource/${encodeURIComponent(SESSION_DOCTYPE)}/${encodeURIComponent(row.name)}`, {
        purged: 1,
        purged_at: new Date(now).toISOString(),
        recording_key: "", // clear the pointer — nothing left to point at
      });
      summary.purged++;
    } catch (e) {
      console.error(`[terminal-retention] failed to purge ${row.name}:`, e.response?.data || e.message);
      summary.errors++;
    }
  }

  return summary;
}

module.exports = { sweepExpiredRecordings };
