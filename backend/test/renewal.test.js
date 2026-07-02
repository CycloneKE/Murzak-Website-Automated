// Renewal sweep — pure date/grouping logic. (The Frappe-touching sweep itself
// is exercised in staging; these guard the decisions that pick WHO gets billed.)
const {
  daysSince,
  isDueForRenewal,
  isPastGrace,
  latestPaidByAccount,
  renewalConfig,
} = require("../services/renewalService");

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

console.log("================================================");
console.log(`RENEWAL TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
