/**
 * Resource-admin access gates — Web Account fields that must be true before a
 * customer can act directly on their own provisioned infrastructure (edit
 * environment variables, read runtime logs).
 *
 * Deliberately the same three-part shape as terminalEligibility.js: plan tier
 * is NECESSARY BUT NOT SUFFICIENT — staff must also approve, and the customer
 * must accept the one-time disclosure. All three are re-read from the live
 * Frappe record on every acting request, never trusted from the session or the
 * client. See docs plan: "Customer Resource Admin".
 *
 * Plan floor is Business (not Enterprise, as the terminal is): editing an env
 * var is ordinary hosting functionality, and the customers who need it most
 * are starter-app-hosting BYOA users who sit below Enterprise. Tightening this
 * is a one-line change to isResourceAdminPlan.
 */

const ALLOWED_PLANS = ["business", "enterprise"];

function isResourceAdminPlan(plan) {
  const p = String(plan || "None").toLowerCase();
  return ALLOWED_PLANS.some((allowed) => p.includes(allowed));
}

/** Master kill switch, mirroring TERMINAL_ENABLED. Defaults to OFF. */
function isResourceAdminEnabled() {
  return String(process.env.RESOURCE_ADMIN_ENABLED || "false").toLowerCase() === "true";
}

/** @returns {Promise<{approved: boolean, disclosureAccepted: boolean}>} never throws. */
async function fetchResourceAdminGates(client, webAccountName) {
  try {
    const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const rec = res.data?.data || {};
    return {
      approved: !!rec.resource_admin_approved_at,
      disclosureAccepted: !!rec.resource_admin_disclosure_accepted_at,
    };
  } catch (e) {
    return { approved: false, disclosureAccepted: false };
  }
}

module.exports = { isResourceAdminPlan, isResourceAdminEnabled, fetchResourceAdminGates };
