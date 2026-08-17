/**
 * Mailbox policy — the decision logic behind the mailbox routes, kept pure so
 * it is testable without an Express harness (this codebase has none).
 *
 * The important one is `mailboxBelongsTo`. Hostinger's password-change and
 * delete endpoints take a bare mailbox id with NO order scoping, so a raw id
 * from a request would be a cross-tenant takeover — any customer could change
 * any other customer's mailbox password. Every write is gated on this check
 * against the caller's own order.
 */

/**
 * Local part rules, matching what we send Hostinger: lowercase alphanumerics
 * plus dot/dash/underscore, never leading or trailing with a symbol.
 */
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function isValidLocalPart(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s || s.length > 64) return false;
  return LOCAL_PART_RE.test(s);
}

/**
 * Fail weak passwords here rather than surfacing Hostinger's raw 422. Returns
 * an error string, or null when acceptable.
 */
function validatePassword(pw) {
  const s = String(pw == null ? "" : pw);
  if (s.length < 8) return "Password must be at least 8 characters.";
  if (s.length > 128) return "Password must be 128 characters or fewer.";
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) {
    return "Password needs an uppercase letter, a lowercase letter and a number.";
  }
  return null;
}

/**
 * Is `mailboxId` genuinely one of `mailboxes` (the caller's own order)?
 *
 * Compares as trimmed strings because Hostinger ids arrive as numbers in some
 * payloads and strings in others — a `===` on mixed types would silently
 * reject a legitimate owner, and a `==` would accept sloppy input.
 */
function mailboxBelongsTo(mailboxes, mailboxId) {
  const wanted = String(mailboxId == null ? "" : mailboxId).trim();
  if (!wanted) return false;
  const rows = Array.isArray(mailboxes) ? mailboxes : [];
  return rows.some((mb) => {
    const id = mb?.id ?? mb?.resource_id;
    return id !== undefined && id !== null && String(id).trim() === wanted;
  });
}

/** Does this local part already exist on the order? */
function localPartExists(mailboxes, localPart) {
  const wanted = String(localPart == null ? "" : localPart).trim().toLowerCase();
  if (!wanted) return false;
  const rows = Array.isArray(mailboxes) ? mailboxes : [];
  return rows.some((mb) => String(mb?.local_part || "").trim().toLowerCase() === wanted);
}

/**
 * Portal-safe view of a Hostinger mailbox. Deliberately allow-listed: passing
 * the provider payload through would leak internal fields and, on a white-label
 * platform, the provider's own identifiers.
 */
function publicMailbox(mb) {
  return {
    id: String(mb?.id ?? mb?.resource_id ?? ""),
    address: mb?.email || mb?.address || mb?.full_address || "",
    localPart: mb?.local_part || "",
    usedBytes: Number(mb?.used_bytes ?? mb?.quota_used ?? 0) || 0,
    quotaBytes: Number(mb?.quota_bytes ?? mb?.quota ?? 0) || 0,
  };
}

module.exports = {
  LOCAL_PART_RE,
  isValidLocalPart,
  validatePassword,
  mailboxBelongsTo,
  localPartExists,
  publicMailbox,
};
