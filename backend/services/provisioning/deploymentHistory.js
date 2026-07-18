/**
 * deploymentHistory — self-recorded deployment history for a Provisioning Job.
 *
 * Coolify v4.1.2 has NO per-application deployment-history endpoint
 * (confirmed live: GET /api/v1/applications/{uuid}/deployments -> 404, and
 * GET /api/v1/deployments only lists CURRENTLY RUNNING deployments, not
 * history). So instead of asking Coolify to enumerate the past, we record
 * every deployment_uuid WE trigger (initial deploy + each redeploy) on the
 * job itself, then fetch live status for each recorded uuid via the endpoint
 * that DOES work: GET /api/v1/deployments/{uuid}.
 *
 * Stored as a small JSON array on the job's `deployment_history` field:
 *   [{ "uuid": "...", "at": "2026-07-18 13:10:28" }, ...]  (newest last)
 */

const MAX_ENTRIES = 20;

function parseHistory(json) {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr) ? arr.filter((e) => e && e.uuid) : [];
  } catch {
    return [];
  }
}

/**
 * Append a newly-triggered deployment uuid (idempotent — re-appending the
 * same uuid, e.g. on a resumed poll, is a no-op) and cap to MAX_ENTRIES so
 * the field never grows unbounded.
 * @returns {string} the new JSON string to write back to the job.
 */
function appendDeployment(existingJson, uuid, at) {
  if (!uuid) return existingJson || "[]";
  const list = parseHistory(existingJson);
  if (list.some((e) => e.uuid === uuid)) return JSON.stringify(list);
  list.push({ uuid: String(uuid), at: at || "" });
  return JSON.stringify(list.slice(-MAX_ENTRIES));
}

/** Newest-first uuid list, capped, for display. */
function listUuids(json, limit = MAX_ENTRIES) {
  return parseHistory(json)
    .slice(-limit)
    .reverse()
    .map((e) => e.uuid);
}

module.exports = { parseHistory, appendDeployment, listUuids, MAX_ENTRIES };
