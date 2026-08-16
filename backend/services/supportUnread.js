/**
 * Shared unread/alert rules for the support inbox (doctype "Portal Users
 * Requests"). Extracted as a pure module — same convention as
 * services/portalRequestPayload.js — so the customer badge, the staff badge
 * and the staff email alert all agree on one definition, and so the rules are
 * unit-testable without an Express harness (this codebase has none).
 *
 * Frappe stores these timestamps as MySQL DATETIME strings
 * ("YYYY-MM-DD HH:mm:ss"). Both operands are parsed the same way, so the
 * comparison is unaffected by which zone the runtime assumes.
 */

/** Statuses that mean the ball is in staff's court. */
const ADMIN_PENDING_STATUSES = ["New", "Waiting on Admin"];

/** Status set the moment a customer posts — the one staff must be alerted on. */
const WAITING_ON_ADMIN = "Waiting on Admin";

function parseStamp(value) {
  if (!value) return null;
  const s = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * True when a thread has a message newer than the reader's last-read stamp.
 * A thread that has never been read (no stamp) counts as unread once it has
 * any message at all.
 */
function hasUnread(lastMessageAt, lastReadAt) {
  const last = parseStamp(lastMessageAt);
  if (!last) return false;
  const read = parseStamp(lastReadAt);
  if (!read) return true;
  return last.getTime() > read.getTime();
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

/**
 * A thread staff still owe a reply on, with something they haven't read.
 *
 * Reads `last_admin_seen_at`, which the doctype already carried and nothing
 * ever wrote to — the staff-read stamp was designed and then never wired up.
 * Using it rather than adding a second field avoids two columns that mean the
 * same thing.
 */
function isUnreadForAdmin(thread) {
  const pending = ADMIN_PENDING_STATUSES.some(
    (s) => normalizeStatus(s) === normalizeStatus(thread?.status)
  );
  if (!pending) return false;
  return hasUnread(thread?.last_message_at, thread?.last_admin_seen_at);
}

/** A thread awaiting the customer, with a staff reply they haven't read. */
function isUnreadForUser(thread) {
  if (normalizeStatus(thread?.status) !== normalizeStatus("Waiting on User")) return false;
  return hasUnread(thread?.last_message_at, thread?.user_last_read_at);
}

function countAdminUnread(threads) {
  return (Array.isArray(threads) ? threads : []).filter(isUnreadForAdmin).length;
}

function countUserUnread(threads) {
  return (Array.isArray(threads) ? threads : []).filter(isUnreadForUser).length;
}

/**
 * Whether a customer message should raise an email to staff.
 *
 * Only the TRANSITION into staff's court alerts. If the thread was ALREADY
 * pending on staff — "New" just as much as "Waiting on Admin" — they have been
 * told; a customer sending five consecutive messages is one alert, not five.
 * ("New" belonging here is not obvious and was missed on the first pass: a
 * freshly created thread sits at "New", so treating only "Waiting on Admin" as
 * pending double-alerted on the customer's second message.)
 *
 * A brand-new thread (no previous status) always alerts, as does a customer
 * replying after staff answered (Waiting on User) or reopening a Resolved one.
 */
function shouldAlertAdmins(previousStatus) {
  if (!previousStatus) return true;
  return !ADMIN_PENDING_STATUSES.some(
    (s) => normalizeStatus(s) === normalizeStatus(previousStatus)
  );
}

/** Parse the ADMIN_EMAILS allowlist into recipients. Same shape requireAdmin uses. */
function adminRecipients(adminEmailsEnv) {
  return String(adminEmailsEnv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  ADMIN_PENDING_STATUSES,
  WAITING_ON_ADMIN,
  adminRecipients,
  countAdminUnread,
  countUserUnread,
  hasUnread,
  isUnreadForAdmin,
  isUnreadForUser,
  shouldAlertAdmins,
};
