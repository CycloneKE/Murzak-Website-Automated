/**
 * Unit tests for the support inbox unread/alert rules — runs without Frappe
 * or SMTP.
 *   node test/adminSupport.test.js   (or: npm test)
 *
 * These rules are why staff never learned a customer was waiting: there was no
 * admin-side unread notion at all, and no alert. Pinning them here so the
 * "one alert per transition, not per message" guarantee can't silently regress
 * into mailbombing every address in ADMIN_EMAILS.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  adminRecipients,
  countAdminUnread,
  countUserUnread,
  hasUnread,
  isUnreadForAdmin,
  isUnreadForUser,
  shouldAlertAdmins,
} = require("../services/supportUnread");

(async () => {
  section("hasUnread — message vs read stamp");
  ok(hasUnread("2026-08-15 10:00:00", null) === true, "never read + has a message -> unread");
  ok(hasUnread("2026-08-15 10:00:00", "") === true, "empty read stamp counts as never read");
  ok(
    hasUnread("2026-08-15 10:00:00", "2026-08-15 09:00:00") === true,
    "message newer than read stamp -> unread"
  );
  ok(
    hasUnread("2026-08-15 09:00:00", "2026-08-15 10:00:00") === false,
    "message older than read stamp -> read"
  );
  ok(
    hasUnread("2026-08-15 10:00:00", "2026-08-15 10:00:00") === false,
    "identical stamps -> read (strictly-newer wins, no perpetual badge)"
  );
  ok(hasUnread(null, null) === false, "no message at all -> not unread");
  ok(
    hasUnread("2026-08-15T10:00:00", "2026-08-15 09:00:00") === true,
    "ISO and MySQL stamps compare correctly against each other"
  );
  ok(hasUnread("not-a-date", null) === false, "an unparseable stamp -> not unread (no crash)");

  section("isUnreadForAdmin — only threads the ball is with staff on");
  ok(
    isUnreadForAdmin({ status: "New", last_message_at: "2026-08-15 10:00:00" }) === true,
    "a brand-new unread thread counts");
  ok(
    isUnreadForAdmin({ status: "Waiting on Admin", last_message_at: "2026-08-15 10:00:00" }) === true,
    "Waiting on Admin + unread counts"
  );
  ok(
    isUnreadForAdmin({ status: "waiting on admin", last_message_at: "2026-08-15 10:00:00" }) === true,
    "status match is case-insensitive"
  );
  ok(
    isUnreadForAdmin({
      status: "Waiting on Admin",
      last_message_at: "2026-08-15 10:00:00",
      last_admin_seen_at: "2026-08-15 11:00:00",
    }) === false,
    "already read by staff -> not counted"
  );
  ok(
    isUnreadForAdmin({ status: "Waiting on User", last_message_at: "2026-08-15 10:00:00" }) === false,
    "Waiting on User is the CUSTOMER's turn -> never a staff badge"
  );
  ok(
    isUnreadForAdmin({ status: "Resolved", last_message_at: "2026-08-15 10:00:00" }) === false,
    "Resolved -> not counted"
  );
  ok(isUnreadForAdmin({}) === false, "an empty thread doc -> not counted");

  section("isUnreadForUser — the customer's side is unchanged in meaning");
  ok(
    isUnreadForUser({ status: "Waiting on User", last_message_at: "2026-08-15 10:00:00" }) === true,
    "Waiting on User + unread counts for the customer"
  );
  ok(
    isUnreadForUser({ status: "Waiting on Admin", last_message_at: "2026-08-15 10:00:00" }) === false,
    "Waiting on Admin is not the customer's badge"
  );
  ok(
    isUnreadForUser({
      status: "Waiting on User",
      last_message_at: "2026-08-15 10:00:00",
      user_last_read_at: "2026-08-15 10:30:00",
    }) === false,
    "customer already read it -> not counted"
  );

  section("counts");
  const rows = [
    { status: "New", last_message_at: "2026-08-15 10:00:00" },
    { status: "Waiting on Admin", last_message_at: "2026-08-15 10:00:00", last_admin_seen_at: "2026-08-15 12:00:00" },
    { status: "Waiting on Admin", last_message_at: "2026-08-15 13:00:00", last_admin_seen_at: "2026-08-15 12:00:00" },
    { status: "Waiting on User", last_message_at: "2026-08-15 13:00:00" },
    { status: "Resolved", last_message_at: "2026-08-15 13:00:00" },
  ];
  ok(countAdminUnread(rows) === 2, "counts exactly the two threads staff owe an unread reply on");
  ok(countUserUnread(rows) === 1, "counts the one thread waiting on the customer");
  ok(countAdminUnread([]) === 0, "empty list -> 0");
  ok(countAdminUnread(undefined) === 0, "undefined list -> 0 (never throws on a bad Frappe response)");
  ok(countAdminUnread(null) === 0, "null list -> 0");

  section("shouldAlertAdmins — one alert per transition, not per message");
  ok(shouldAlertAdmins(null) === true, "a brand-new thread always alerts");
  ok(shouldAlertAdmins(undefined) === true, "a missing previous status alerts");
  ok(shouldAlertAdmins("Waiting on User") === true, "customer replying to staff alerts");
  ok(shouldAlertAdmins("Resolved") === true, "reopening a resolved thread alerts");
  ok(
    shouldAlertAdmins("Waiting on Admin") === false,
    "a SECOND message on an already-pending thread does NOT alert (no mailbomb)"
  );
  ok(
    shouldAlertAdmins("New") === false,
    "a second message while still New does NOT alert — a new thread sits at New, " +
      "so treating only 'Waiting on Admin' as pending double-alerted (caught in e2e)"
  );
  ok(
    shouldAlertAdmins("  waiting on admin  ") === false,
    "the no-mailbomb guard survives whitespace and casing from Frappe"
  );
  ok(shouldAlertAdmins("  NEW  ") === false, "…and for New too");

  section("adminRecipients — same parsing requireAdmin uses");
  ok(
    JSON.stringify(adminRecipients("a@x.com, b@y.com")) === JSON.stringify(["a@x.com", "b@y.com"]),
    "splits and trims a comma list"
  );
  ok(adminRecipients("").length === 0, "empty env -> no recipients (caller warns instead of sending)");
  ok(adminRecipients(undefined).length === 0, "unset env -> no recipients");
  ok(
    JSON.stringify(adminRecipients("a@x.com,,  ,b@y.com")) === JSON.stringify(["a@x.com", "b@y.com"]),
    "blank entries are dropped"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
