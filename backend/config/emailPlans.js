// config/emailPlans.js
//
// Stalwart business-email plans: the one place their allowances and prices
// live on the backend. Catalog entries in frontend/src/config/serviceCatalog.ts
// must match these values (see test/emailPlans.test.js). Annual pricing is a
// flat 10x monthly by spec and is NOT derived from billingTerm.js's generic
// 20% annual-prepay discount.

const PLANS = Object.freeze({
  "mail-starter": Object.freeze({
    id: "mail-starter",
    mailboxes: 3,
    quotaGb: 5,
    monthlyKes: 450,
    annualKes: 4500,
  }),
  "mail-business": Object.freeze({
    id: "mail-business",
    mailboxes: 10,
    quotaGb: 10,
    monthlyKes: 1200,
    annualKes: 12000,
  }),
  "mail-pro": Object.freeze({
    id: "mail-pro",
    mailboxes: 30,
    // 5GB, not 15: 30 x 15GB = 450GB promised could never pass the disk gate on
    // the shared VPS (decided 2026-11-12). 30 x 5GB = 150GB.
    quotaGb: 5,
    monthlyKes: 2900,
    annualKes: 29000,
  }),
});

/** True for the new mail-* plan ids. Legacy starter-email/biz-email are not plans here. */
function isMailPlan(serviceId) {
  return typeof serviceId === "string" && Object.prototype.hasOwnProperty.call(PLANS, serviceId);
}

const DOMAIN_MARKUP = 1.25;
const DOMAIN_MIN_KES = 1200;
const DOMAIN_ROUND_KES = 50;

/**
 * Retail KES price for a new domain registration: Hostinger's wholesale USD
 * price (in cents) converted at usdToKes, plus 25%, rounded UP to the next
 * KES 50, with a KES 1200 floor. Pure; callers read the live wholesale price.
 *
 * Throws TypeError on non-finite or negative wholesaleUsdCents, and on a
 * usdToKes that is non-finite or not positive. Coercing bad input to 0 would
 * silently quote the KES 1200 floor when a Hostinger price lookup fails.
 */
function domainPriceKes(wholesaleUsdCents, usdToKes) {
  if (typeof wholesaleUsdCents !== "number" || !Number.isFinite(wholesaleUsdCents) || wholesaleUsdCents < 0) {
    throw new TypeError(`domainPriceKes: wholesaleUsdCents must be a finite number >= 0 (got ${String(wholesaleUsdCents)})`);
  }
  if (typeof usdToKes !== "number" || !Number.isFinite(usdToKes) || usdToKes <= 0) {
    throw new TypeError(`domainPriceKes: usdToKes must be a finite number > 0 (got ${String(usdToKes)})`);
  }
  const kesCents = wholesaleUsdCents * usdToKes;
  const raw = (kesCents * DOMAIN_MARKUP) / 100;
  const rounded = Math.ceil(raw / DOMAIN_ROUND_KES) * DOMAIN_ROUND_KES;
  return Math.max(DOMAIN_MIN_KES, rounded);
}

module.exports = { PLANS, isMailPlan, domainPriceKes };
