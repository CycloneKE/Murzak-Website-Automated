// Billing-term math. Pure functions — no Frappe, no clock dependence.
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  ANNUAL_DISCOUNT_PCT,
  ANNUAL_CYCLE_DAYS,
  accountBillingTerm,
  annualPrepayKes,
  cycleDaysForTerm,
  renewalAmountForTerm,
  proRatedAddonKes,
  daysRemainingInTerm,
} = require("../services/billingTerm");

(async () => {
  section("accountBillingTerm — missing/unknown defaults to monthly");
  // EVERY existing customer has no billing_term field. A regression here
  // silently changes live billing for the whole book.
  ok(accountBillingTerm(undefined) === "monthly", "undefined account -> monthly");
  ok(accountBillingTerm({}) === "monthly", "no billing_term -> monthly");
  ok(accountBillingTerm({ billing_term: "" }) === "monthly", "empty string -> monthly");
  ok(accountBillingTerm({ billing_term: "nonsense" }) === "monthly", "unknown value -> monthly");
  ok(accountBillingTerm({ billing_term: "monthly" }) === "monthly", "explicit monthly");
  ok(accountBillingTerm({ billing_term: "annual" }) === "annual", "explicit annual");
  ok(accountBillingTerm({ billing_term: "ANNUAL" }) === "annual", "case-insensitive annual");

  section("annualPrepayKes — 20% off the annualized sum");
  ok(ANNUAL_DISCOUNT_PCT === 20, "discount is 20%");
  ok(annualPrepayKes(2500) === 24000, "2500/mo -> 24000/yr (30000 less 20%)");
  ok(annualPrepayKes(1200) === 11520, "1200/mo -> 11520/yr");
  ok(annualPrepayKes(0) === 0, "zero stays zero");
  ok(annualPrepayKes(2000) < 2000 * 12, "annual is always cheaper than 12x monthly");

  section("cycleDaysForTerm");
  ok(ANNUAL_CYCLE_DAYS === 365, "annual cycle is 365 days");
  ok(cycleDaysForTerm("monthly", 30) === 30, "monthly uses the configured cycle");
  ok(cycleDaysForTerm("monthly", 45) === 45, "monthly respects a non-default config");
  ok(cycleDaysForTerm("annual", 30) === 365, "annual ignores the monthly cycle");

  section("renewalAmountForTerm");
  ok(renewalAmountForTerm("monthly", 2500) === 2500, "monthly bills the monthly sum");
  ok(renewalAmountForTerm("annual", 2500) === 24000, "annual bills the discounted year");

  section("proRatedAddonKes");
  // A full term remaining costs the full annual price; half a term, half.
  ok(proRatedAddonKes(2500, 365) === 24000, "full term remaining = full annual price");
  ok(proRatedAddonKes(2500, 0) === 0, "no days remaining = nothing owed");
  ok(proRatedAddonKes(2500, 182) === Math.round(24000 * (182 / 365)), "mid-term is proportional");
  ok(proRatedAddonKes(2500, 182) < 24000, "mid-term costs less than a full term");
  ok(proRatedAddonKes(2500, 1) > 0, "one day remaining still bills something");

  section("daysRemainingInTerm");
  const NOW = Date.parse("2026-07-02T12:00:00Z");
  ok(daysRemainingInTerm("2026-07-02", NOW) === 365, "term started today -> full 365 left");
  ok(daysRemainingInTerm("2026-06-02", NOW) === 335, "30 days in -> 335 left");
  ok(daysRemainingInTerm("2025-07-02", NOW) === 0, "a full year elapsed -> 0 left");
  ok(daysRemainingInTerm("2020-01-01", NOW) === 0, "long past -> clamps at 0, never negative");
  // Garbage data must bill nothing, never a wrong amount.
  ok(daysRemainingInTerm(undefined, NOW) === 0, "missing date -> 0");
  ok(daysRemainingInTerm("", NOW) === 0, "empty date -> 0");
  ok(daysRemainingInTerm("not-a-date", NOW) === 0, "unparseable date -> 0");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
