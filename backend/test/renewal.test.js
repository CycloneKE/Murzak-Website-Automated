// Renewal sweep — pure date/grouping logic. (The Frappe-touching sweep itself
// is exercised in staging; these guard the decisions that pick WHO gets billed.)
const {
  daysSince,
  isDueForRenewal,
  isPastGrace,
  latestPaidByAccount,
  renewalConfig,
  excludeDomainRegistrations,
} = require("../services/renewalService");
const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");

let failed = 0;
let passed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ok: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

const NOW = Date.parse("2026-07-02T12:00:00Z");

console.log("# daysSince");
ok(daysSince("2026-06-02", NOW) === 30, "30 days elapsed");
ok(daysSince("2026-07-02", NOW) === 0, "same day = 0");
ok(daysSince("2026-06-02 10:15:00", NOW) === 30, "datetime string handled");
ok(daysSince("", NOW) === null, "empty date -> null");
ok(daysSince("garbage", NOW) === null, "unparseable date -> null");

console.log("# isDueForRenewal");
ok(isDueForRenewal("2026-06-01", 30, NOW) === true, "31 days old, 30d cycle -> due");
ok(isDueForRenewal("2026-06-02", 30, NOW) === true, "exactly 30 days -> due");
ok(isDueForRenewal("2026-06-10", 30, NOW) === false, "22 days -> not due");
ok(isDueForRenewal(null, 30, NOW) === false, "missing date -> NEVER due (no billing off bad data)");

console.log("# isPastGrace");
ok(isPastGrace("2026-06-24", 7, NOW) === true, "8 days unpaid, 7d grace -> past");
ok(isPastGrace("2026-06-25", 7, NOW) === false, "exactly 7 days -> still in grace");
ok(isPastGrace(undefined, 7, NOW) === false, "missing date -> never suspend");

console.log("# latestPaidByAccount");
const grouped = latestPaidByAccount([
  { web_account: "A", invoice_date: "2026-05-01", name: "old-A" },
  { web_account: "A", invoice_date: "2026-06-15", name: "new-A" },
  { web_account: "B", invoice_date: "2026-04-01", name: "only-B" },
  { web_account: "", invoice_date: "2026-06-01", name: "orphan" },
]);
ok(grouped.get("A")?.name === "new-A", "keeps newest invoice per account");
ok(grouped.get("B")?.name === "only-B", "single-invoice account kept");
ok(grouped.size === 2, "rows without web_account dropped");
ok(latestPaidByAccount(null).size === 0, "null input -> empty map");

console.log("# renewalConfig defaults");
const cfg = renewalConfig();
ok(cfg.cycleDays === 30, "default cycle 30d");
ok(cfg.graceDays === 7, "default grace 7d");
ok(cfg.suspendEnabled === false, "suspension OFF by default");
ok(cfg.enabled === true, "sweep ON by default");

console.log("# excludeDomainRegistrations (Critical 1: a yearly domain must never be swept into monthly renewal billing)");
{
  const rows = [
    { serviceId: "domain-com", serviceName: "Domain — .com", tier: "Light", domainChoice: "" },
    { serviceId: "db-mysql", serviceName: "MySQL Database", tier: "Light", domainChoice: "" },
  ];
  const filtered = excludeDomainRegistrations(rows);
  ok(filtered.length === 1 && filtered[0].serviceId === "db-mysql", "domain-registration service excluded, other services kept");
  ok(sumSelectedServicesMonthlyKes(rows) === 1500 + 2000, "sanity: unfiltered sum WOULD include the domain's yearly price (1500)");
  ok(sumSelectedServicesMonthlyKes(filtered) === 2000, "renewal sum with domains excluded bills only the real monthly service (2000), not 1500 extra");
  ok(excludeDomainRegistrations([]).length === 0, "empty input -> empty output");
  ok(excludeDomainRegistrations(null).length === 0, "non-array input tolerated, never throws");
  ok(excludeDomainRegistrations([{ serviceId: "does-not-exist" }]).length === 1, "unknown service id is not treated as a domain (kept, priced 0 elsewhere)");
}

console.log("# billing term — sweep cycle and amount");
{
  const {
    accountBillingTerm,
    cycleDaysForTerm,
    renewalAmountForTerm,
  } = require("../services/billingTerm");

  const monthlyCycle = 30;

  // The four rows of the safety matrix from the spec.
  const monthlyAcct = { billing_term: "monthly" };
  const annualAcct = { billing_term: "annual" };
  const legacyAcct = {}; // every existing customer

  const mTerm = accountBillingTerm(monthlyAcct);
  const aTerm = accountBillingTerm(annualAcct);
  const lTerm = accountBillingTerm(legacyAcct);

  // Row 1: annual account is NOT due at 30 days. THE double-charge guard.
  ok(
    !isDueForRenewal("2026-06-02", cycleDaysForTerm(aTerm, monthlyCycle), NOW),
    "annual account is NOT due after 30 days (double-charge guard)"
  );
  // Row 2: annual account IS due past 365 days, at the discounted amount.
  const longAgo = "2025-06-02"; // > 365d before NOW (2026-07-02)
  ok(
    isDueForRenewal(longAgo, cycleDaysForTerm(aTerm, monthlyCycle), NOW),
    "annual account IS due after 365 days"
  );
  ok(
    renewalAmountForTerm(aTerm, 2500) === 24000,
    "annual account bills the 20%-discounted year"
  );
  // Row 3: monthly account unchanged.
  ok(
    isDueForRenewal("2026-06-02", cycleDaysForTerm(mTerm, monthlyCycle), NOW),
    "monthly account still due at 30 days (no regression)"
  );
  ok(
    renewalAmountForTerm(mTerm, 2500) === 2500,
    "monthly account still bills the monthly sum"
  );
  // Row 4: legacy account (no billing_term) behaves exactly as monthly.
  ok(lTerm === "monthly", "account with no billing_term is treated as monthly");
  ok(
    isDueForRenewal("2026-06-02", cycleDaysForTerm(lTerm, monthlyCycle), NOW) === true &&
      renewalAmountForTerm(lTerm, 2500) === 2500,
    "legacy account bills identically to an explicit monthly account"
  );
}

console.log("================================================");
console.log(`RENEWAL TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
