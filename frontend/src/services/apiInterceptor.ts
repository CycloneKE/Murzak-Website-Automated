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

      // Intercept 502 Bad Gateway and 503 Service Unavailable
      if (response.status === 502 || response.status === 503) {
        window.dispatchEvent(new CustomEvent('api-gateway-error', {
          detail: { status: response.status }
        }));
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
