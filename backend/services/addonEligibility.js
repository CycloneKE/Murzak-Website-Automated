/**
 * Eligibility gate for /api/addons/invoice/create.
 *
 * Volume-class services (light, self-serve, Coolify-lane — Website Hosting,
 * App Hosting, Database, Storage) are safe for ANY paying customer to add
 * regardless of their plan's own tier, because the gate exists to protect
 * provisioning/capacity risk (volume-class is always the cheapest, safest
 * footprint), not to restrict which plan can cross-sell which category.
 *
 * Premium-class services (managed Frappe apps) keep the original
 * tier-matches-plan rule, since those need to match the density the
 * customer's plan is already provisioned for.
 */

const PREMIUM_TIERS_BY_PLAN = {
  Starter: ["Light"],
  Business: ["Medium"],
  Enterprise: ["Light", "Medium", "Large", "Enterprise"],
};

function isPaidPlan(planKey) {
  return planKey === "Starter" || planKey === "Business" || planKey === "Enterprise";
}

/**
 * @param {{planKey: string, service: {tier?: string, capacityClass?: string, monthlyKes?: number}}} args
 * @returns {{ok: boolean, error?: string}}
 */
function isAddonEligible({ planKey, service }) {
  if (!isPaidPlan(planKey)) {
    return { ok: false, error: "Add-ons are not available for your current plan." };
  }

  if (service?.capacityClass === "volume") {
    return { ok: true };
  }

  const allowedTiers = PREMIUM_TIERS_BY_PLAN[planKey] || [];
  if (!service?.tier || allowedTiers.includes(String(service.tier))) {
    return { ok: true };
  }

  return { ok: false, error: `Service tier not allowed for add-ons under ${planKey}.` };
}

module.exports = { isAddonEligible };
