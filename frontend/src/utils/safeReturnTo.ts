/**
 * Only a same-origin relative path is honored ("/portal/billing", not
 * "//evil.com", "https://evil.com", or "/\evil.com" — the last one
 * normalizes to "//evil.com" in some URL parsers, which is the exact
 * shape flagged by the react-router open-redirect advisory this guards
 * against independently of the library patch). Anything else falls back.
 */
export function safeReturnTo(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes(":")) {
    return fallback;
  }
  return path;
}
