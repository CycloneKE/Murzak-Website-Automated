// Central error-handling for the frontend.
//
// The problem this solves: every `catch` block used to do
// `setError(err.message)`, so whenever a request failed with a network drop,
// a non-JSON response, a JS runtime error, or an upstream stack trace, the
// user saw raw technical text ("Failed to fetch", "Unexpected token '<'",
// "Cannot read properties of undefined", a Frappe traceback, …).
//
// `toUserMessage()` is the single funnel every user-facing error string should
// pass through. It keeps short, clean, human sentences (usually the backend's
// own `{ error }` message) and replaces anything that looks like machine noise
// with a friendly fallback.

/** A failed API call. Services throw this; UI code catches it. */
export class ApiError extends Error {
  status: number;
  /** Machine-readable code from the backend body, when present (e.g. "CAPACITY"). */
  code?: string;
  /** The raw server-provided message, kept for logging — never render this directly. */
  serverMessage?: string;

  constructor(message: string, opts: { status?: number; code?: string; serverMessage?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.serverMessage = opts.serverMessage;
  }
}

const NETWORK_HINTS = [
  "failed to fetch",
  "networkerror",
  "network error",
  "load failed",
  "network request failed",
  "fetch failed",
  "err_internet_disconnected",
  "err_connection",
  "err_network",
  "err_name_not_resolved",
  "econnrefused",
  "enotfound",
  "etimedout",
  "socket hang up",
  "the operation was aborted",
  "the user aborted a request",
];

// Substrings that mean "this string is a stack trace / parser error / dump,
// not a sentence written for a human".
const RAW_NOISE_HINTS = [
  "is not valid json",
  "unexpected token",
  "unexpected end of json",
  "unexpected end of input",
  "<!doctype",
  "<html",
  "cannot read propert",
  "cannot access ",
  "is not a function",
  "is not defined",
  "is not iterable",
  "undefined is not",
  "null is not",
  "traceback (most recent call last)",
  "exc_type",
  "stack trace",
  "[object object]",
  "axioserror",
  "request failed with status code",
  "xmlhttprequest",
  "json.parse",
  "syntaxerror",
  "typeerror:",
  "referenceerror",
  "rangeerror",
  "econnreset",
];

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/** Pull the most message-like string out of whatever was thrown/returned. */
function extractRawString(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);

  if (err instanceof ApiError) return err.message || "";
  if (err instanceof Error) return err.message || "";

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const candidate =
      o.error ?? o.message ?? o.detail ?? o.description ?? o.reason ?? o.statusText;
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const inner = (candidate as Record<string, unknown>).message;
      if (typeof inner === "string") return inner;
    }
  }
  return "";
}

/** Heuristic: does this string look like machine output rather than a sentence? */
function looksRaw(s: string): boolean {
  const lower = s.toLowerCase();
  if (RAW_NOISE_HINTS.some((h) => lower.includes(h))) return true;
  if (s.length > 180) return true;
  if (s.includes("\n")) return true;
  if (/^[[{<]/.test(s.trim())) return true; // starts like JSON / HTML
  if (/\n?\s+at\s+[\w$.<>]+\s*\(/.test(s)) return true; // "    at fn (file:line:col)"
  if (/https?:\/\/(localhost|127\.0\.0\.1)|(?:^|\s):\d{4,5}\b/.test(s)) return true; // leaks internal host:port
  if (/\bE[A-Z]{3,}\b/.test(s)) return true; // ECONNREFUSED, ENOTFOUND, …
  return false;
}

/**
 * Turn anything thrown/returned into a message safe to show a user.
 *
 * @param err       the caught value (Error, ApiError, string, `{ error }` object, …)
 * @param fallback  what to show when `err` carries nothing human-readable
 */
export function toUserMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = extractRawString(err).trim();
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  if (NETWORK_HINTS.some((h) => lower.includes(h))) return NETWORK_MESSAGE;
  if (looksRaw(raw)) return fallback;

  // A clean, human sentence (very often the backend's own `{ error }` text).
  // Trim a trailing period-less fragment to at most one line.
  return raw;
}

/** True when the failure is "the request never reached a working server". */
export function isNetworkError(err: unknown): boolean {
  const lower = extractRawString(err).toLowerCase();
  return NETWORK_HINTS.some((h) => lower.includes(h));
}

/** A sensible sentence for a bare HTTP status, when that's all we have. */
export function describeStatus(status: number): string {
  switch (true) {
    case status === 400:
      return "That request wasn't valid. Please check your input and try again.";
    case status === 401:
      return "Your session has expired. Please sign in again.";
    case status === 403:
      return "You don't have access to do that.";
    case status === 404:
      return "We couldn't find what you were looking for.";
    case status === 409:
      return "That conflicts with the current state. Refresh and try again.";
    case status === 413:
      return "That upload is too large.";
    case status === 429:
      return "Too many requests. Please wait a moment and try again.";
    case status >= 500:
      return "The server ran into a problem. Please try again in a moment.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Read a fetch `Response` as JSON and throw a clean `ApiError` on failure.
 * Use this in services so raw upstream messages never reach the UI.
 */
export async function readJsonOrThrow<T = unknown>(
  res: Response,
  fallback = "Request failed. Please try again.",
): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    // Non-JSON on an OK response is itself a problem; on an error it's an
    // HTML/text page from the proxy — either way we don't surface its body.
    await res.text().catch(() => "");
  }

  if (!res.ok) {
    const o = (body || {}) as Record<string, unknown>;
    const serverMessage = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : undefined;
    const code = typeof o.code === "string" ? o.code : undefined;
    const message = toUserMessage(serverMessage, describeStatus(res.status));
    throw new ApiError(message, { status: res.status, code, serverMessage });
  }

  if (body == null && contentType.includes("application/json")) {
    throw new ApiError(fallback, { status: res.status });
  }
  return body as T;
}
