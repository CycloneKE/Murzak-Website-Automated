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
 * FIX ROUND 2 — add-on gate bypass via domain-only purchase. A domain
 * registration (KES 1,200-4,500/yr) is billed as a `type: "Subscription"`
 * invoice on a brand-new account's FIRST purchase (ordersRoutes.js first-
 * purchase branch), which sets the Web Account's plan to "Starter" and,
 * once paid, makes `hasPaidSubscriptionForPlan(..., "Starter")` return true
 * — with no distinction from a customer who paid for real hosting. Without
 * `hasNonDomainPaidHistory`, that alone was enough to unlock this gate for
 * ANY volume/premium add-on (real infrastructure), not just more domains.
 * `hasNonDomainPaidHistory` (computed by the caller — see
 * addonInvoiceService.js's `resolveNonDomainPaidHistory` — from the Web
 * Account's OWN existing service history and its PAID invoice line items,
 * never from the Subscription-invoice-existence check, which stays
 * untouched for order-routing) closes that hole while deliberately
 * exempting the add-on BEING PURCHASED when it is itself a domain
 * registration: buying a second/third domain is not the hole (no
 * capacity/infrastructure risk, manually fulfilled either way like the
 * first one) and must keep working exactly as before. See ordersRoutes.js's
 * comment above the `hasPaidPlan` branch and commit 6bb2a86 for why
 * `hasPaidSubscriptionForPlan` itself must never be repurposed to mean
 * "owns real infrastructure" — a prior attempt at that broke repeat domain
 * purchases.
 *
 * FIX ROUND 3 — the round-2 signal (`accountHasNonDomainPaidService` below,
 * fed from Web Account `selected_services` rows) turned out to silently
 * block real, paying customers in three ways: (a) a plan-only account with
 * no service rows yet (or rows not yet in a paid status) has nothing to
 * check against; (b) `getServiceMeta(id)` returns null for any id that
 * later drifted out of the catalog snapshot — an Active row for one of
 * those was treated as "no paid history" instead of "unknown, presume
 * paid" (see `isDomainRegistrationServiceId` below for the polarity fix);
 * (c) `ordersRoutes.js` used to round-trip stored rows through the
 * CLIENT-INPUT normalizer `normalizeSelectedServices`, which collapses any
 * status other than "Active" to "Awaiting Payment" — silently demoting
 * "Setting up"/"Suspended" rows and permanently revoking their paid
 * standing (fixed in ordersRoutes.js via `normalizeExistingAccountServiceRows`).
 * The fix: OR in a second, independent signal — do any of the account's
 * PAID invoices carry a non-domain line item? — computed lazily (only when
 * the cheap account-row check comes up empty AND a non-domain add-on is
 * actually being purchased) so the common paths cost zero extra queries.
 * See addonInvoiceService.js's `resolveNonDomainPaidHistory`.
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
 * Is this a KNOWN Domain Registration catalog item?
 *
 * POLARITY (read before changing): this asks the POSITIVE question — "can I
 * prove this IS a domain" — not "can I prove this is NOT a domain". An id
 * missing from the catalog snapshot (stale/renamed/drifted — see
 * catalogSnapshot.test.js) is therefore treated as NOT a domain, i.e. as
 * real (unidentified) infrastructure. That is the safe direction for a gate
 * whose only job is spotting a domain-only account: every real Domain
 * Registration SKU is present in the snapshot (7 of them, all `domain-*`),
 * so an unknown id can never actually BE the bypass this gate defends
 * against — it can only ever be a mis-cataloged real product. Same
 * direction as renewalService.js's `excludeDomainRegistrations`; keep the
 * two in sync (see the polarity-parity test in addonEligibility.test.js).
 */
function isDomainRegistrationServiceId(serviceId) {
  const id = String(serviceId || "").trim();
  if (!id) return false;
  return getServiceMeta(id)?.category === "Domain Registration";
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
    const id = String(r?.serviceId || "").trim();
    if (!id) return false; // a row with no id is no evidence either way
    if (!PAID_SERVICE_STATUSES.has(String(r?.status || "").trim())) return false;
    return !isDomainRegistrationServiceId(id);
  });
}

/**
 * Do any of these Portal Invoice child-table rows (raw Frappe shape) carry a
 * non-domain service? Pure predicate — the caller (addonInvoiceService.js)
 * owns the Frappe query and the paid/unpaid filtering; this just answers the
 * category question so it stays unit-testable without a mock client.
 *
 * @param {Array<object>} invoiceRows
 * @param {string} [childServiceIdField="service_id"]
 * @returns {boolean}
 */
function invoiceRowsIncludeNonDomainService(invoiceRows, childServiceIdField = "service_id") {
  return (Array.isArray(invoiceRows) ? invoiceRows : []).some((r) => {
    const id = String(r?.[childServiceIdField] || r?.serviceId || "").trim();
    return !!id && !isDomainRegistrationServiceId(id);
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

module.exports = {
  isAddonEligible,
  accountHasNonDomainPaidService,
  isDomainRegistrationServiceId,
  invoiceRowsIncludeNonDomainService,
  PAID_SERVICE_STATUSES,
};
