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
 *
 * FIX ROUND 2 — add-on gate bypass via domain-only purchase (see
 * .superpowers/sdd/final-review-fix-report.md "Fix round 2"): a domain
 * registration (KES 1,200-4,500/yr) is billed as a `type: "Subscription"`
 * invoice on a brand-new account's FIRST purchase (ordersRoutes.js first-
 * purchase branch), which sets the Web Account's plan to "Starter" and,
 * once paid, makes `hasPaidSubscriptionForPlan(..., "Starter")` return true
 * — with no distinction from a customer who paid for real hosting. Without
 * `hasNonDomainPaidHistory`, that alone was enough to unlock this gate for
 * ANY volume/premium add-on (real infrastructure), not just more domains.
 * `hasNonDomainPaidHistory` (computed by the caller via
 * `accountHasNonDomainPaidService`, below, from the Web Account's OWN
 * existing service history — not from the Subscription-invoice-existence
 * check, which stays untouched for order-routing) closes that hole while
 * deliberately exempting the add-on BEING PURCHASED when it is itself a
 * domain registration: buying a second/third domain is not the hole (no
 * capacity/infrastructure risk, manually fulfilled either way like the
 * first one) and must keep working exactly as before.
 */

const { getServiceMeta } = require("./provisioning/catalog");

const PREMIUM_TIERS_BY_PLAN = {
  Starter: ["Light"],
  Business: ["Medium"],
  Enterprise: ["Light", "Medium", "Large", "Enterprise"],
};

// Web Account selected_services statuses that mean "this service was
// actually paid for at some point" — as opposed to merely selected/pending
// (`Awaiting Payment`, `Selected`, `New`). Suspended is included because a
// service can only be suspended (renewalService.js) after having been Active,
// i.e. it WAS a real paid service; it should not lose its "real customer"
// standing just because a later renewal lapsed.
const PAID_SERVICE_STATUSES = new Set(["Active", "Setting up", "Suspended"]);

function isPaidPlan(planKey) {
  return planKey === "Starter" || planKey === "Business" || planKey === "Enterprise";
}

/**
 * Does this account's OWN existing service history include at least one
 * PAID service that is NOT a Domain Registration? This is the "owns real
 * hosting infrastructure" check the add-on gate needs, distinct from (and
 * computed independently of) `hasPaidSubscriptionForPlan`'s "has a paid
 * Subscription invoice" check that order-routing relies on — see the
 * module docblock above for why the two must not be conflated.
 *
 * @param {Array<{serviceId?: string, status?: string}>} existingServiceRows
 *   Normalized rows read from the Web Account's selected_services child
 *   table (NOT raw Frappe rows — caller maps service_id/status first).
 * @returns {boolean}
 */
function accountHasNonDomainPaidService(existingServiceRows) {
  return (Array.isArray(existingServiceRows) ? existingServiceRows : []).some((r) => {
    const status = String(r?.status || "").trim();
    if (!PAID_SERVICE_STATUSES.has(status)) return false;
    const meta = r?.serviceId ? getServiceMeta(String(r.serviceId)) : null;
    return !!meta && meta.category !== "Domain Registration";
  });
}

/**
 * @param {{
 *   planKey: string,
 *   service: {category?: string, tier?: string, capacityClass?: string, monthlyKes?: number},
 *   hasNonDomainPaidHistory?: boolean,
 * }} args
 *   `hasNonDomainPaidHistory` defaults to `true` (fail-open) so every
 *   existing caller/test that doesn't model account history keeps its prior
 *   behavior; the one real caller (addonInvoiceService.js) always computes
 *   and passes a real value via `accountHasNonDomainPaidService`.
 * @returns {{ok: boolean, error?: string}}
 */
function isAddonEligible({ planKey, service, hasNonDomainPaidHistory = true }) {
  if (!isPaidPlan(planKey)) {
    return { ok: false, error: "Add-ons are not available for your current plan." };
  }

  const isDomainRegistrationAddon = service?.category === "Domain Registration";

  // A domain-only account (no genuinely paid non-domain service) may only
  // buy MORE domains through this gate — everything else (real hosting,
  // database, storage, premium add-ons) requires actual paid infrastructure
  // history first. See the module docblock's "Fix round 2" note.
  if (!isDomainRegistrationAddon && !hasNonDomainPaidHistory) {
    return {
      ok: false,
      error: "Add-ons require an active hosting plan. A domain registration alone does not unlock add-on purchases.",
    };
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

module.exports = { isAddonEligible, accountHasNonDomainPaidService };
