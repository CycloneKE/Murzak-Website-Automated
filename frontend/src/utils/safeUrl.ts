/**
 * The emailed mail-status link carries a capability token in its path. It must
 * never leave the browser through analytics, client logs, contact forms or a
 * login returnTo. Every place that transmits a location runs it through here.
 *
 * Erasable TypeScript only, so frontend/scripts/safeUrl.check.mjs can run it
 * directly with `node --experimental-strip-types`.
 */

export const STATUS_PLACEHOLDER = "/mail/status/:token";

// RFC 3986: percent-escapes of unreserved characters mean the same as the
// characters themselves (so "/%6Dail/" is "/mail/"). %2F stays as it is.
function normaliseUnreserved(s: string): string {
  return s.replace(/%(3[0-9]|4[1-9A-F]|5[0-9A]|6[1-9A-F]|7[0-9AE]|2D|2E|5F)/gi, (m, h: string) => {
    const c = String.fromCharCode(parseInt(h, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : m;
  });
}

// "/mail/status/" with either slash possibly percent-encoded, then the token and
// everything after it (query, hash, further segments).
const STATUS_RE = /(?:\/|%2F)mail(?:\/|%2F)status(?:\/|%2F)[^]*$/i;

/** Replace a status path (and whatever follows it) with a fixed placeholder; keeps any origin before it. */
export function redactStatusPath(str: string): string {
  if (typeof str !== "string" || !str) return str;
  return normaliseUnreserved(str).replace(STATUS_RE, STATUS_PLACEHOLDER);
}

/** True when the string points at a status link (used to switch analytics off there). */
export function isStatusPath(str: string): boolean {
  return typeof str === "string" && STATUS_RE.test(normaliseUnreserved(str));
}

/** Same as redactStatusPath; named for call sites that send a full URL. */
export const safeHref = redactStatusPath;
