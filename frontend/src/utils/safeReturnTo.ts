/**
 * Only a same-origin relative path is honored ("/portal/billing", not
 * "//evil.com", "https://evil.com", or "/\evil.com" — the last one
 * normalizes to "//evil.com" in some URL parsers, which is the exact
 * shape flagged by the react-router open-redirect advisory this guards
 * against independently of the library patch). Anything else falls back.
 *
 * TAB (\t), CR (\r), and LF (\n) are stripped BEFORE the shape checks run.
 * The WHATWG URL parsing algorithm — used by browsers, history.pushState,
 * and `new URL()` — strips these characters from a URL string wherever
 * they occur before interpreting it. Without stripping them here first,
 * an input like "/\t/evil.com" (from `?returnTo=/%09/evil.com`) passes
 * every check below unchanged (it starts with "/", does NOT start with
 * "//" because index 1 is a tab, and has no ":"), but any spec-compliant
 * consumer — including the browser itself — sees "//evil.com" once it
 * strips the tab. Stripping first closes that gap.
 *
 * A bare `includes(":")` check is intentionally NOT used to reject
 * scheme-like input (e.g. "javascript:alert(1)", "https://evil.com").
 * Those are already rejected by the `startsWith("/")` check above/below:
 * a URL scheme must appear at the very start of the string, and every
 * value that reaches the colon-adjacent branch here has already been
 * confirmed to start with a single "/" — so a colon anywhere in it
 * (e.g. a query-string time value like "/portal/billing?since=12:30")
 * is necessarily past the path segment and can never be interpreted as
 * a scheme or authority delimiter. Rejecting it outright only broke
 * legitimate in-app paths without adding any safety.
 */
export function safeReturnTo(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  const normalized = path.replace(/[\t\r\n]/g, "").replace(/\\/g, "/");
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  return normalized;
}
