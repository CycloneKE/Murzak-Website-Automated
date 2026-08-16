/**
 * Platform Health Check sweeps — Job 1 (orphan reconciliation) and Job 2
 * (capacity snapshot) from
 * docs/superpowers/specs/2026-08-15-platform-maintenance-automation-design.md.
 *
 * Both wrap an existing, already-tested read: findOrphanedCoolifyResources
 * and provisioningService.getReservedRamMb + capacity.summary. No new
 * capacity/orphan logic lives here — this module only turns their output
 * into one "Platform Health Check" row and, on "attention", one admin email
 * (same ADMIN_EMAILS + utils/mailer pattern as
 * provisioningService.js::notifyStaffOfJobs). Job 3 (backup) is a host
 * crontab + a status-report route, not a sweep, and isn't in this module.
 */
const { PLATFORM_HEALTH_DOCTYPE } = require("./constants");
const { findOrphanedCoolifyResources } = require("./orphans");
const capacity = require("./capacity");

function adminRecipients() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Never throws — a persistence failure must not take down the sweep. */
async function writeHealthCheck(client, { jobType, status, summary, detail, alertSent }) {
  try {
    await client.post(`/api/resource/${encodeURIComponent(PLATFORM_HEALTH_DOCTYPE)}`, {
      job_type: jobType,
      status,
      summary,
      detail_json: JSON.stringify(detail || {}),
      alert_sent: alertSent ? 1 : 0,
    });
  } catch (e) {
    console.warn(`[platform-health] failed to write ${jobType} row:`, e.response?.data?.exception || e.message);
  }
}

/** Never throws — email delivery must not take down the sweep. Returns whether it sent. */
async function alertAdmins({ subject, text }) {
  const to = adminRecipients();
  if (!to.length) return false;
  let sendMail;
  try {
    ({ sendMail } = require("../../utils/mailer"));
  } catch (e) {
    console.warn("[platform-health] mailer unavailable:", e.message);
    return false;
  }
  try {
    await Promise.all(to.map((addr) => sendMail({ to: addr, subject, text })));
    return true;
  } catch (e) {
    console.warn("[platform-health] failed to send admin alert:", e.message);
    return false;
  }
}

/**
 * Job 1: wraps findOrphanedCoolifyResources. status "attention" when any
 * orphan exists across any target, "error" when ownership couldn't be
 * determined at all or every target errored, "ok" otherwise. Alerts admins
 * only on "attention" — a clean run never emails.
 */
async function sweepOrphanReconciliation(client) {
  const result = await findOrphanedCoolifyResources(client);

  if (!result.checked) {
    const summary = result.reason || "could not determine Coolify resource ownership";
    await writeHealthCheck(client, { jobType: "orphan_check", status: "error", summary, detail: result });
    return { ...result, status: "error", summary, alerted: false };
  }

  const totalOrphans = result.targets.reduce(
    (s, t) => s + t.orphanApplications.length + t.orphanServices.length,
    0
  );
  const hasErrors = result.targets.some((t) => t.error);
  const status = totalOrphans > 0 ? "attention" : hasErrors ? "error" : "ok";

  let summary;
  if (totalOrphans > 0) {
    const perTarget = result.targets
      .filter((t) => t.orphanApplications.length || t.orphanServices.length)
      .map((t) => `${t.targetId}: ${t.orphanApplications.length + t.orphanServices.length}`)
      .join(", ");
    summary = `${totalOrphans} orphaned resource${totalOrphans === 1 ? "" : "s"} found (${perTarget})`;
  } else if (hasErrors) {
    summary = "orphan check completed with per-target errors";
  } else {
    summary = "no orphaned resources found";
  }

  let alerted = false;
  if (status === "attention") {
    alerted = await alertAdmins({
      subject: `[Murzak] Orphaned Coolify resources found (${totalOrphans})`,
      text:
        `Orphan reconciliation found ${totalOrphans} resource(s) with no owning Provisioning Job:\n\n` +
        `${JSON.stringify(result.targets, null, 2)}\n\n` +
        `SURFACE ONLY — nothing was deleted. Review from the Coolify UI/CLI or the admin dashboard.`,
    });
  }

  await writeHealthCheck(client, { jobType: "orphan_check", status, summary, detail: result, alertSent: alerted });
  return { ...result, status, summary, alerted };
}

/**
 * Job 2: wraps provisioningService.getReservedRamMb + capacity.summary.
 * "attention" is exactly capacity.gateExceeded({reserved, ramMb: 0}) — the
 * same PROVISIONING_RAM_THRESHOLD_PCT gate real orders are checked against,
 * evaluated with no hypothetical incoming job. One threshold, no second
 * number to keep in sync. Writes a row every run (for the dashboard trend);
 * alerts admins only on "attention".
 */
async function sweepCapacitySnapshot(client, deps = {}) {
  const getReservedRamMb = deps.getReservedRamMb || require("./provisioningService").getReservedRamMb;
  const reserved = await getReservedRamMb(client);

  if (reserved == null) {
    const summary = "could not read reserved RAM from Frappe";
    await writeHealthCheck(client, { jobType: "capacity_snapshot", status: "error", summary, detail: {} });
    return { status: "error", summary, alerted: false };
  }

  const snap = capacity.summary({ reserved, ramMb: 0 });
  const pct = snap.sellableMb ? Math.round((snap.reservedMb / snap.sellableMb) * 100) : 0;
  const status = snap.exceeded ? "attention" : "ok";
  const summary = `Reserved ${snap.reservedMb}MB / ${snap.sellableMb}MB sellable (${pct}%)`;

  let alerted = false;
  if (status === "attention") {
    alerted = await alertAdmins({
      subject: `[Murzak] Capacity threshold exceeded (${pct}%)`,
      text:
        `Reserved RAM has crossed the ${capacity.thresholdPct()}% gate: ${snap.reservedMb}MB reserved of ` +
        `${snap.sellableMb}MB sellable (threshold ${snap.thresholdMb}MB). New provisioning jobs will be ` +
        `escalated to a human instead of auto-built. Consider provisioning additional capacity.`,
    });
  }

  await writeHealthCheck(client, { jobType: "capacity_snapshot", status, summary, detail: snap, alertSent: alerted });
  return { ...snap, status, summary, alerted };
}

/** Latest row per job_type, for the admin dashboard. Never throws. */
async function latestHealthChecks(client) {
  const jobTypes = ["orphan_check", "capacity_snapshot", "backup"];
  const out = {};
  await Promise.all(
    jobTypes.map(async (jobType) => {
      try {
        const res = await client.get(`/api/resource/${encodeURIComponent(PLATFORM_HEALTH_DOCTYPE)}`, {
          params: {
            filters: JSON.stringify([["job_type", "=", jobType]]),
            fields: JSON.stringify(["name", "job_type", "status", "summary", "detail_json", "alert_sent", "creation"]),
            order_by: "creation desc",
            limit_page_length: 1,
          },
        });
        out[jobType] = (res.data?.data || [])[0] || null;
      } catch (e) {
        out[jobType] = null;
      }
    })
  );
  return out;
}

module.exports = {
  adminRecipients,
  sweepOrphanReconciliation,
  sweepCapacitySnapshot,
  latestHealthChecks,
};
