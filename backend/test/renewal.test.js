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

// Same-day tie-break: two paid Subscription invoices dated identically for
// the same account must resolve to a single, deterministic winner (name
// desc) — the same rule checkoutBillingTerm.js's
// findLastPaidSubscriptionInvoice applies via its own order_by, so the two
// call sites can never disagree about which invoice is "the" last paid one.
const tieBroken = latestPaidByAccount([
  { web_account: "C", invoice_date: "2026-06-15", name: "PINV-100" },
  { web_account: "C", invoice_date: "2026-06-15", name: "PINV-101" },
]);
ok(tieBroken.get("C")?.name === "PINV-101", "same-date tie broken by name desc, regardless of input order");
const tieBrokenReversed = latestPaidByAccount([
  { web_account: "C", invoice_date: "2026-06-15", name: "PINV-101" },
  { web_account: "C", invoice_date: "2026-06-15", name: "PINV-100" },
]);
ok(tieBrokenReversed.get("C")?.name === "PINV-101", "tie-break result is order-independent");

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
  // 4200 as of 2026-08-17's wholesale-cost pricing correction — see
  // DOMAIN_TLD_PRICES in backend/server.js.
  ok(sumSelectedServicesMonthlyKes(rows) === 4200 + 2000, "sanity: unfiltered sum WOULD include the domain's yearly price (4200)");
  ok(sumSelectedServicesMonthlyKes(filtered) === 2000, "renewal sum with domains excluded bills only the real monthly service (2000), not 4200 extra");
  ok(excludeDomainRegistrations([]).length === 0, "empty input -> empty output");
  ok(excludeDomainRegistrations(null).length === 0, "non-array input tolerated, never throws");
  ok(excludeDomainRegistrations([{ serviceId: "does-not-exist" }]).length === 1, "unknown service id is not treated as a domain (kept, priced 0 elsewhere)");
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

function accountDoc() {
  return {
    account_holder_name: "Test Co",
    plan: "Standard",
    account_status: "Active",
    selected_services: SWEEP_SERVICE_ROWS,
    // no work_email -> sendRenewalEmail is skipped entirely
  };
}

// Builds a fake Frappe client + injected deps for one account ("acct-1")
// whose single latest-paid Subscription invoice is `lastPaidInvoiceDate`
// old, optionally recorded with `lastPaidBillingTerm`. Tracks every POST
// (invoice creation) and every Web Account GET so tests can assert on both
// billing decisions (Findings 1 & 2) and fetch volume (Finding 3).
function makeSweepFrappe({ account, lastPaidInvoiceDate, lastPaidBillingTerm }) {
  const posts = [];
  let webAccountGets = 0;
  let invoiceGets = 0;
  const client = {
    get: async (url, opts) => {
      const params = opts?.params || {};
      if (url === "/api/resource/Portal Invoice") {
        const filters = JSON.parse(params.filters || "[]");
        const isPaidScan = filters.some((f) => f[0] === "status" && f[2] === "Paid");
        if (isPaidScan) {
          // Deliberately NO billing_term on this bulk-query row — the real
          // query's `fields` never include it (see C4). The sweep must read
          // the term via the single-document GET below instead.
          return {
            data: {
              data: [
                { name: "OLD-INV", web_account: "acct-1", plan: "Standard", amount: 1, invoice_date: lastPaidInvoiceDate },
              ],
            },
          };
        }
        // Open-invoice idempotency check -> nothing open.
        return { data: { data: [] } };
      }
      if (url === "/api/resource/Portal Invoice/OLD-INV") {
        invoiceGets++;
        return {
          data: {
            data: {
              name: "OLD-INV",
              invoice_date: lastPaidInvoiceDate,
              ...(lastPaidBillingTerm ? { billing_term: lastPaidBillingTerm } : {}),
            },
          },
        };
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
  return { deps, posts, webAccountGetCount: () => webAccountGets, invoiceGetCount: () => invoiceGets };
}

(async () => {
  console.log("# sweepRenewals — wired end to end (mocked Frappe)");

  {
    // Row 1: last paid invoice recorded annual, 30 days old -> NOT due.
    // Regresses if the cycle reverts to the flat cfg.cycleDays (30d).
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: "annual",
    });
    const res = await sweepRenewals(deps);
    ok(res.ok === true, "sweep returns ok");
    ok(posts.length === 0, "annual invoice at 30 days -> zero invoices created (double-charge guard)");
  }

  {
    // Row 2: same annual term, 366 days old -> due, at the discounted amount.
    // Regresses if `amount` is set to monthlySum unconditionally.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(366),
      lastPaidBillingTerm: "annual",
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "annual invoice at 366 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_ANNUAL_AMOUNT, `annual invoice billed the discounted amount (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "annual", "created invoice persists billing_term=annual (becomes next year's anchor)");
  }

  {
    // Row 3: last paid invoice recorded monthly, 30 days old -> due, at the
    // undiscounted sum.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: "monthly",
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "monthly invoice at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `monthly invoice billed the undiscounted sum (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "monthly", "created invoice persists billing_term=monthly");
  }

  {
    // Row 4: last paid invoice has NO billing_term field at all (a
    // pre-existing, never-migrated invoice) -> treated as monthly. This is
    // the safety-by-construction case every invoice created before this
    // feature falls into.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: null,
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "invoice with no billing_term at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `pre-existing invoice billed the undiscounted monthly sum (got ${posts[0]?.body?.amount})`);
  }

  {
    // Finding 3: an account nowhere near due under ANY term must not even
    // trigger a Web Account fetch or an invoice-term GET. Regresses if the
    // pre-filter is removed and every candidate account is fetched
    // unconditionally.
    const { deps, posts, webAccountGetCount, invoiceGetCount } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(5),
      lastPaidBillingTerm: "monthly",
    });
    await sweepRenewals(deps);
    ok(posts.length === 0, "account far from due -> zero invoices created");
    ok(webAccountGetCount() === 0, "account far from due under the shortest cycle -> zero Web Account fetches (fetch-amplification guard)");
    ok(invoiceGetCount() === 0, "account far from due under the shortest cycle -> zero invoice-term fetches");
  }

  console.log("================================================");
  console.log(`RENEWAL TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
