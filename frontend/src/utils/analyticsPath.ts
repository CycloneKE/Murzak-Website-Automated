/**
 * The emailed mail-status link carries a capability token in its path. It must
 * never reach analytics (page_path or page_location), so anything under
 * /mail/status/ is reduced to a fixed placeholder, query and hash included.
 */
const STATUS_PREFIX = "/mail/status/";

export function redactAnalyticsPath(pathOrUrl: string): string {
  const m = /^(https?:\/\/[^/]+)?(\/mail\/status\/)/i.exec(pathOrUrl);
  if (!m) return pathOrUrl;
  return `${m[1] || ""}${STATUS_PREFIX}:token`;
}
