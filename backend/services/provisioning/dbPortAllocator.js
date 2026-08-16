/**
 * External TCP port allocator for Database Hosting products (phase 2 — see
 * docs/superpowers/specs/2026-08-16-database-remote-access-phase2-design.md).
 *
 * Mirrors provisioningService.js's getReservedRamMb pattern: query Frappe for
 * the ports already claimed by other active/running database jobs, then hand
 * back the lowest free port in the configured range. Best-effort at enqueue
 * time — same "advisory, not a distributed lock" posture the RAM capacity
 * gate already has for this single-VPS, human-scale business (see
 * scaling.js's own comment: "Runtime re-checks... are authoritative —
 * enqueue placement is advisory"). A genuine collision surfaces as a real
 * Coolify deploy failure, which the runner's existing retry/escalate safety
 * net already covers — this module does not attempt to prevent that itself.
 */

const { JOB_DOCTYPE } = require("./constants");

function rangeStart() {
  return Number(process.env.DB_EXTERNAL_PORT_RANGE_START) || 33000;
}
function rangeEnd() {
  return Number(process.env.DB_EXTERNAL_PORT_RANGE_END) || 33999;
}

/**
 * @param {object} client Frappe REST client (same shape used throughout provisioning/*)
 * @param {{exclude?: Set<number>}} opts exclude: ports already reserved earlier in the
 *   same enqueue batch (a customer buying two database products at once).
 * @returns {Promise<number|null>} lowest free port, or null when exhausted/unreadable.
 */
async function allocatePort(client, { exclude } = {}) {
  const used = new Set(exclude || []);
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        // Deliberately only "=" / "in" filters — the mock and (per this
        // codebase's caution about unverified Frappe behavior) possibly the
        // real API too are safest assumed to support only those; the ">0"
        // exclusion happens in JS below instead of relying on a numeric
        // comparison filter operator.
        filters: JSON.stringify([
          ["category", "=", "Database Hosting"],
          ["status", "in", ["running", "active"]],
        ]),
        fields: JSON.stringify(["external_port"]),
        limit_page_length: 0,
      },
    });
    for (const row of res.data?.data || []) {
      const p = Number(row.external_port);
      if (p > 0) used.add(p);
    }
  } catch {
    return null; // can't prove a port is free -> fail closed
  }
  for (let p = rangeStart(); p <= rangeEnd(); p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

module.exports = { allocatePort, rangeStart, rangeEnd };
