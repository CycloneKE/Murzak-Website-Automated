/**
 * Orphan reconciliation — admin-visible, SURFACE ONLY, never auto-deletes.
 *
 * Compares live Coolify applications/services against Provisioning Job
 * `external_ref` values so staff can spot infrastructure with no owning
 * job — exactly the class of thing a pre-fix run left behind: the generic
 * service path deploying against an empty repo_url created a real Coolify
 * SERVICE (user-26-08-12-0001-starter-app-hosting) that no job ever
 * tracked (see commit fb02940). Deletion stays a human decision made from
 * the Coolify UI or CLI after looking at what this surfaces — this module
 * never calls a delete endpoint.
 */
const { JOB_DOCTYPE } = require("./constants");
const targets = require("./targets");
const coolify = require("./lanes/coolify");

/**
 * Every external_ref currently claimed by a coolify-lane job. `null` means
 * undetermined (doctype missing, Frappe error) — the caller must NOT treat
 * that as "nothing is owned," which would flag every live resource as an
 * orphan.
 */
async function ownedExternalRefs(client) {
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["lane", "=", "coolify"]]),
        fields: JSON.stringify(["external_ref"]),
        limit_page_length: 0,
      },
    });
    return new Set(
      (res.data?.data || [])
        .map((r) => String(r.external_ref || "").trim())
        .filter(Boolean)
    );
  } catch (e) {
    return null;
  }
}

/**
 * Returns { checked, reason?, targets: [{targetId, orphanApplications, orphanServices, error}] }.
 * Never throws — best-effort, called from an admin GET.
 */
async function findOrphanedCoolifyResources(client) {
  const owned = await ownedExternalRefs(client);
  if (!owned) {
    return {
      checked: false,
      reason: "could not read Provisioning Job external_ref list — refusing to guess, would false-flag everything as orphaned",
      targets: [],
    };
  }

  const results = [];
  for (const t of targets.listTargets()) {
    const opts = { target: t };
    if (!coolify.isConfigured(opts)) continue;
    const entry = { targetId: t.id, orphanApplications: [], orphanServices: [], error: null };
    try {
      const [apps, services] = await Promise.all([
        coolify.listApplications(opts),
        coolify.listServices(opts),
      ]);
      entry.orphanApplications = apps.filter((a) => !owned.has(a.uuid));
      entry.orphanServices = services.filter((s) => !owned.has(s.uuid));
    } catch (e) {
      entry.error = e.message;
    }
    results.push(entry);
  }
  return { checked: true, targets: results };
}

module.exports = { findOrphanedCoolifyResources };
