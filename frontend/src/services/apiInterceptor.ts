// Endpoints that legitimately 401 without meaning "your session just expired" —
// the boot-time identity check (called while logged out on every cold visit)
// and the login/register calls themselves (a rejected password is not an
// expired session). Keeping these exempt is what stops a logged-out visitor
// from being bounced to /login with a bogus "session expired" banner.
const SESSION_EXPIRY_EXEMPT_PATTERNS = ['/api/auth/me', '/api/login', '/api/register', '/api/logout'];

function isSessionExpiryExempt(url: string): boolean {
  return SESSION_EXPIRY_EXEMPT_PATTERNS.some((p) => url.includes(p));
}

export const setupApiInterceptor = () => {
  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    try {
      const response = await originalFetch(...args);

      // Intercept 502 Bad Gateway and 503 Service Unavailable — but only the
      // real-outage kind. A JSON body means the app itself produced this
      // response with a specific, actionable reason (e.g. orderStore.js's
      // "Checkout is not configured." when a required doctype hasn't been
      // set up yet) — that's a normal error the caller already surfaces
      // inline, not a platform outage. Only a non-JSON response (typically
      // an HTML/plain-text page from the reverse proxy when the app process
      // itself is unreachable) should trigger the full-page takeover.
      if (response.status === 502 || response.status === 503) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          window.dispatchEvent(new CustomEvent('api-gateway-error', {
            detail: { status: response.status }
          }));
        }
      }

      if (response.status === 401) {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input as Request)?.url || '';
        if (url.includes('/api/') && !isSessionExpiryExempt(url)) {
          window.dispatchEvent(new CustomEvent('session-expired'));
        }
      }

      return response;
    } catch (error) {
      // If the fetch completely fails (e.g., network error, DNS resolution fails)
      // we can also treat it as a backend down error if we want.
      // For now, we only catch explicit 502/503 responses.
      throw error;
    }
  };
};
