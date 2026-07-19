interface ClientErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  source: string;
  url?: string;
}

// Simple per-session cap — a crash loop shouldn't hammer the backend. Not
// meant to be precise, just a circuit breaker.
const MAX_REPORTS_PER_SESSION = 20;
let reportCount = 0;

export function reportClientError(payload: ClientErrorPayload): void {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount += 1;

  const body = JSON.stringify({
    ...payload,
    url: payload.url || window.location.href,
    ua: navigator.userAgent,
    ts: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/client-log", blob);
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  fetch("/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Best-effort only — never let logging itself throw.
  });
}

export function setupGlobalErrorReporting(): void {
  window.addEventListener("error", (event) => {
    reportClientError({
      message: event.message,
      stack: event.error?.stack,
      source: "window.onerror",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: "unhandledrejection",
    });
  });

  // Font regression sentinel — catches a repeat of the self-hosted-font
  // pipeline breaking silently (the original bug: Google Fonts 503 → system
  // fallback with no visible error).
  document.fonts.ready.then(() => {
    if (!document.fonts.check("700 1rem 'Manrope Variable'")) {
      reportClientError({
        message: "Manrope Variable failed to load — page is rendering with a fallback font",
        source: "font-load-check",
      });
    }
  });
}
