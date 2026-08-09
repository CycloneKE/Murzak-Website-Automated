// services/billingTerm.js
//
// All billing-term arithmetic, as pure functions with no Frappe or clock
// dependency so they can be tested exhaustively. The term itself is never
// stored here or on any Web Account field — see checkoutBillingTerm.js for
// how an account's current term is derived from its last paid Subscription
// invoice.

const ANNUAL_DISCOUNT_PCT = 20;
const ANNUAL_CYCLE_DAYS = 365;

/** Annualized monthly sum, less the annual-prepay discount. */
function annualPrepayKes(monthlySumKes) {
  const gross = Number(monthlySumKes) || 0;
  return Math.round(gross * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}

/** How many days between renewals for this term. */
function cycleDaysForTerm(term, monthlyCycleDays) {
  return term === "annual" ? ANNUAL_CYCLE_DAYS : monthlyCycleDays;
}

/** What the renewal sweep bills for this term. */
function renewalAmountForTerm(term, monthlySumKes) {
  return term === "annual"
    ? annualPrepayKes(monthlySumKes)
    : Number(monthlySumKes) || 0;
}

/**
 * An add-on bought mid-term is charged only for the remainder of the term, so
 * the whole account keeps renewing on a single anniversary.
 */
function proRatedAddonKes(addonMonthlyKes, daysRemainingInTerm) {
  const days = Math.max(0, Math.min(ANNUAL_CYCLE_DAYS, Number(daysRemainingInTerm) || 0));
  return Math.round(annualPrepayKes(addonMonthlyKes) * (days / ANNUAL_CYCLE_DAYS));
}

/**
 * Days left in an annual term that began on `termStartedOn` ("YYYY-MM-DD").
 *
 * FAILS SAFE TO 0 on missing/unparseable input: a pro-rated charge computed
 * from garbage would be a wrong amount on a real invoice, whereas 0 simply
 * bills nothing and is visible as an anomaly. Clamped to [0, 365] so an
 * expired or future-dated term can never produce a negative or inflated
 * charge.
 */
function daysRemainingInTerm(termStartedOn, nowMs = Date.now()) {
  if (!termStartedOn) return 0;
  const iso = String(termStartedOn).slice(0, 10);
  const startMs = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(startMs)) return 0;
  const elapsedDays = Math.floor((nowMs - startMs) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(ANNUAL_CYCLE_DAYS, ANNUAL_CYCLE_DAYS - elapsedDays));
}

module.exports = {
  ANNUAL_DISCOUNT_PCT,
  ANNUAL_CYCLE_DAYS,
  annualPrepayKes,
  cycleDaysForTerm,
  renewalAmountForTerm,
  proRatedAddonKes,
  daysRemainingInTerm,
};
