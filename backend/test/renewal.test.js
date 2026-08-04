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

// ---------------------------------------------------------------------------
// sweepRenewals — wired end to end against a fake Frappe client.
//
// Everything above this point only tests the pure billingTerm.js helpers in
// isolation. It never calls sweepRenewals() itself, so it would keep passing
// even if the sweep's own wiring regressed — e.g. the account fetch moved
// back below the due-check, the cycle reverted to the flat cfg.cycleDays, or
// `amount` were set to monthlySum unconditionally. These tests drive the
// real sweepRenewals() (following the mocked-Frappe-client pattern used in
// terminalSweep.test.js / billing.test.js's makeFrappe) so a regression in
// any of those guards actually fails a test, not just a helper-level check.
// ---------------------------------------------------------------------------
const { sweepRenewals } = require("../services/renewalService");

const SWEEP_SERVICE_ROWS = [
  { service_id: "db-mysql", service_name: "MySQL Database", tier: "Light", status: "Active" },
];
const SWEEP_MONTHLY_SUM = 2000; // db-mysql's catalog price, per the excludeDomainRegistrations block above
const SWEEP_ANNUAL_AMOUNT = 19200; // 2000 * 12 * 0.8 (20% annual-prepay discount)

// n days ago, as a "YYYY-MM-DD" string. daysSince() floors on whole UTC days,
// so this always yields exactly n days elapsed regardless of time-of-day.
function daysAgoStr(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function accountDoc(term) {
  const doc = {
    account_holder_name: "Test Co",
    plan: "Standard",
    account_status: "Active",
    selected_services: SWEEP_SERVICE_ROWS,
    // no work_email -> sendRenewalEmail is skipped entirely
  };
  if (term) doc.billing_term = term;
  return doc;
}

// Builds a fake Frappe client + injected deps for one account ("acct-1")
// whose single latest-paid Subscription invoice is `lastPaidInvoiceDate`
// old, optionally recorded with `lastPaidBillingTerm`. Tracks every POST
// (invoice creation) and every Web Account GET so tests can assert on both
// billing decisions (Findings 1 & 2) and fetch volume (Finding 3).
function makeSweepFrappe({ account, lastPaidInvoiceDate, lastPaidBillingTerm }) {
  const posts = [];
  let webAccountGets = 0;
  const client = {
    get: async (url, opts) => {
      const params = opts?.params || {};
      if (url === "/api/resource/Portal Invoice") {
        const filters = JSON.parse(params.filters || "[]");
        const isPaidScan = filters.some((f) => f[0] === "status" && f[2] === "Paid");
        if (isPaidScan) {
          const row = {
            name: "OLD-INV",
            web_account: "acct-1",
            plan: "Standard",
            amount: 1,
            invoice_date: lastPaidInvoiceDate,
          };
          if (lastPaidBillingTerm) row.billing_term = lastPaidBillingTerm;
          return { data: { data: [row] } };
        }
        // Open-invoice idempotency check -> nothing open.
        return { data: { data: [] } };
      }
      if (url === "/api/resource/Web Account/acct-1") {
        webAccountGets++;
        return { data: { data: account } };
      }
      return { data: { data: {} } };
    },
    post: async (url, body) => {
      posts.push({ url, body });
      return { data: { data: { name: body.invoice_no } } };
    },
  };
  const deps = {
    frappeClient: () => client,
    PORTAL_INVOICE_SERVICES_FIELD: "selected_services",
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    CHILD_SERVICE_ID_FIELD: "service_id",
    CHILD_SERVICE_NAME_FIELD: "service_name",
    CHILD_TIER_FIELD: "tier",
    CHILD_DOMAIN_CHOICE_FIELD: "domain_choice",
    CHILD_STATUS_FIELD: "status",
    buildInvoiceServiceRows: (rows) => rows,
    logPortalUpdate: async () => {},
  };
  return { deps, posts, webAccountGetCount: () => webAccountGets };
}

(async () => {
  console.log("# sweepRenewals — wired end to end (mocked Frappe)");

  {
    // Row 1: annual account, last paid invoice 30 days old -> NOT due.
    // Regresses if the cycle reverts to the flat cfg.cycleDays (30d).
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc("annual"),
      lastPaidInvoiceDate: daysAgoStr(30),
    });
    const res = await sweepRenewals(deps);
    ok(res.ok === true, "sweep returns ok");
    ok(posts.length === 0, "annual account at 30 days -> zero invoices created (double-charge guard)");
  }

  {
    // Row 2: same annual account, 366 days old -> due, at the discounted amount.
    // Regresses if `amount` is set to monthlySum unconditionally.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc("annual"),
      lastPaidInvoiceDate: daysAgoStr(366),
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "annual account at 366 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_ANNUAL_AMOUNT, `annual invoice billed the discounted amount (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "annual", "created invoice persists billing_term=annual (Finding 2)");
  }

  {
    // Row 3: monthly account, 30 days old -> due, at the undiscounted sum.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc("monthly"),
      lastPaidInvoiceDate: daysAgoStr(30),
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "monthly account at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `monthly invoice billed the undiscounted sum (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "monthly", "created invoice persists billing_term=monthly");
  }

  {
    // Row 4: legacy account with NO billing_term, 30 days old -> behaves
    // identically to an explicit monthly account. Regresses if a missing
    // billing_term is ever treated as anything other than monthly.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(null),
      lastPaidInvoiceDate: daysAgoStr(30),
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "legacy (no billing_term) account at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `legacy account billed the undiscounted monthly sum (got ${posts[0]?.body?.amount})`);
  }

  {
    // Finding 2: the account's billing_term was flipped annual -> monthly
    // AFTER the last invoice was billed (e.g. an admin edit in the Frappe
    // desk UI). The last-paid invoice still recorded billing_term=annual —
    // the due-check must honor THAT, not the account's current value, or the
    // prepaid customer gets billed again at 30 days and (with
    // RENEWAL_SUSPEND_ENABLED) suspended for not paying it. Regresses if the
    // invoice's recorded term is ignored in favor of the account's current
    // term.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc("monthly"), // current (flipped) term
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: "annual", // term the invoice was actually billed under
    });
    await sweepRenewals(deps);
    ok(posts.length === 0, "invoice-recorded annual term overrides a since-flipped-to-monthly account (Finding 2 guard)");
  }

  {
    // Finding 3: an account nowhere near due under ANY term must not even
    // trigger a Web Account fetch. Regresses if the pre-filter is removed
    // and every candidate account is fetched unconditionally.
    const { deps, posts, webAccountGetCount } = makeSweepFrappe({
      account: accountDoc("monthly"),
      lastPaidInvoiceDate: daysAgoStr(5),
    });
    await sweepRenewals(deps);
    ok(posts.length === 0, "account far from due -> zero invoices created");
    ok(webAccountGetCount() === 0, "account far from due under the shortest cycle -> zero Web Account fetches (fetch-amplification guard)");
  }

  console.log("================================================");
  console.log(`RENEWAL TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
