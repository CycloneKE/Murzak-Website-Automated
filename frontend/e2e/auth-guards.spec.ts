import { test, expect } from '@playwright/test';

// Mock /api/auth/me so the app exits booting immediately as a logged-out user.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('Authentication Guards and Form Validation', () => {
  test('should redirect unauthenticated users from /portal to login', async ({ page }) => {
    // RequireAuth (src/components/RequireAuth.tsx) redirects to
    // /login?returnTo=<original path> when user is null.
    await page.goto('/portal/overview');

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fportal%2Foverview$/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });

  test('should display validation errors on empty login submission', async ({ page }) => {
    await page.goto('/login');

    // Wait for the login form to be rendered (not Loading…)
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // Click submit without filling anything
    await page.getByRole('button', { name: 'Open My Portal' }).click();

    // Verify error messages
    await expect(page.locator('text=Email is required')).toBeVisible();
    await expect(page.locator('text=Password is required')).toBeVisible();
  });

  test('should display validation error for invalid email format', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // Input invalid email and password
    await page.locator('input[type="email"]').fill('invalidemail');
    await page.locator('input[type="password"]').fill('123456');

    await page.getByRole('button', { name: 'Open My Portal' }).click();

    await expect(page.locator('text=Invalid email format')).toBeVisible();
    await expect(page.locator('text=Email is required')).not.toBeVisible();
  });

  test('should toggle between login and signup modes', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // The toggle button sits below the form (not inside the header)
    // Text: "Need a New Account? Get Started"
    await page.getByRole('button', { name: 'Need a New Account? Get Started' }).click();

    // Verify title and signup-specific fields appear
    await expect(page.locator('h1')).toContainText(/Account Setup/);
    await expect(page.locator('text=Full Name')).toBeVisible();
    await expect(page.locator('text=Business Name')).toBeVisible();
    await expect(page.locator('text=What is the goal of this project?')).toBeVisible();
    await expect(page.locator('text=Authorization required to proceed')).toBeVisible();

    // Click "Already Have an Account? Log In" to return to login mode
    await page.getByRole('button', { name: 'Already Have an Account? Log In' }).click();
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });
});

// QA-08: every protected route redirects to /login?returnTo=<path> when logged
// out, and the intended page loads after auth (RequireAuth, App.tsx). /deploy
// was NOT wrapped in RequireAuth until this cycle — it's included specifically
// to guard against that regressing.
test.describe('AUTH-08 — protected route redirects', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
  });

  for (const path of ['/portal', '/portal/overview', '/deploy']) {
    test(`${path} redirects to /login with a matching returnTo`, async ({ page }) => {
      await page.goto(path);
      const expected = `/login?returnTo=${encodeURIComponent(path)}`;
      await expect(page).toHaveURL(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
        timeout: 10000,
      });
      await expect(page.locator('h1')).toContainText(/Client Dashboard/);
    });
  }
});

// QA-06: logout tears down the server session so a subsequent direct visit to
// a protected route is NOT served from stale client state (App.tsx's
// handleLogout POSTs /api/logout before clearing local user state).
test.describe('AUTH-06 — logout clears the session', () => {
  test('logging out then revisiting /portal redirects to login, not cached content', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 100000);
    const email = `test_logout_${suffix}@example.com`;

    await page.goto('/pricing');
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Logout Test User');
    await page.getByPlaceholder('My Company Ltd').fill('Logout Test Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing logout');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    // New accounts with nothing in the cart land straight in the portal.
    await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });

    // A brand-new account gets the full-screen "Getting Started" onboarding
    // tour, which covers the sidebar (including Log out) until dismissed.
    const skipOnboarding = page.getByRole('button', { name: /Skip for now/i });
    if (await skipOnboarding.isVisible().catch(() => false)) {
      await skipOnboarding.click();
    }

    const [logoutResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/logout')),
      page.getByRole('button', { name: /Log out/i }).click(),
    ]);
    expect(logoutResp.status()).toBeLessThan(500);

    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/, { timeout: 5000 });

    // The critical assertion: a fresh navigation to a protected route must not
    // serve cached authenticated UI — it must bounce to login.
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/login\?returnTo=/, { timeout: 10000 });
  });
});

// AUTH-02: per-account brute-force lockout. Driven via direct API calls
// (POST /api/login) rather than the UI — MAX_FAILURES=8 (see
// backend/utils/loginThrottle.js) would mean 8+ slow form submissions;
// hitting the endpoint directly is both faster and a more precise test of
// the actual guarded boundary. Uses a fresh, never-registered email so the
// per-account counter starts clean.
test.describe('AUTH-02 — per-account login lockout', () => {
  test('the 9th failed attempt in a row locks the account (429), a fresh account is unaffected', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 1e9);
    const email = `test_lockout_${suffix}@example.com`;

    // Relative fetch() URLs only resolve once the page has a real origin —
    // without this the evaluate() calls below throw "Failed to parse URL
    // from /api/login" because a fresh page starts at about:blank.
    await page.goto('/');

    let lastStatus = 0;
    let lastBody: any = {};
    for (let i = 0; i < 8; i++) {
      const res = await page.evaluate(async (em) => {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: em, password: 'definitely-wrong-password' }),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      }, email);
      lastStatus = res.status;
      lastBody = res.body;
    }
    // The 8th failure should itself report the account as locked (or the
    // very next attempt does, depending on off-by-one) — assert on the 9th
    // call specifically to remove any ambiguity.
    const ninth = await page.evaluate(async (em) => {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: 'still-wrong' }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, email);
    expect(ninth.status, `expected 429 after 8 prior failures, got ${ninth.status}: ${JSON.stringify(ninth.body)}`).toBe(429);
    expect(ninth.body?.error || '').toMatch(/too many failed attempts/i);

    // A DIFFERENT, never-attempted account is not affected by the first
    // account's lockout — the throttle is per-account, not global/per-IP.
    const otherEmail = `test_lockout_unaffected_${suffix}@example.com`;
    const otherRes = await page.evaluate(async (em) => {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: 'wrong-but-first-try' }),
      });
      return { status: r.status };
    }, otherEmail);
    expect(otherRes.status, 'a fresh account got locked out by another account\'s failures — throttle is not per-account').toBe(401);
  });
});

// AUTH-07: Google sign-in is entirely env-guarded on the client
// (services/firebase.ts's `firebaseEnabled`, computed from VITE_FIREBASE_*).
// This dev server was built with those unset (see murzaktech-local-dev-run
// memory) — the assertion below reflects that default, not a hardcoded
// assumption; if Firebase env is ever configured, this test's premise
// changes and it should be updated to assert the button IS visible instead.
test.describe('AUTH-07 — Google sign-in absent when Firebase env is unset', () => {
  test('no "Continue with Google" button and no console crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// AUTH-09: password reset always returns the same neutral message —
// Login.tsx's handleForgot() has this text baked in as the client-side
// fallback regardless of what the server returns, so a real vs. fake email
// must be indistinguishable to the user (no account-enumeration signal).
test.describe('AUTH-09 — password reset never confirms or denies an account exists', () => {
  test('a real-looking email and an obviously-fake one get the identical message', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await page.getByRole('button', { name: /Forgot password\?/i }).click();

    const emailInput = page.locator('input[type="email"]');
    const submit = page.getByRole('button', { name: /Send reset link|Reset/i });

    await emailInput.fill('definitely-not-a-real-account@example.com');
    await submit.click();
    const fakeMsg = await page.locator('text=/reset link has been sent/i').textContent({ timeout: 10000 });

    // A second, differently-shaped but still-fake address — the point is
    // only that the message text can't be used to distinguish "exists" from
    // "doesn't", so this deliberately never targets a real inbox.
    const suffix = Math.floor(Math.random() * 1e9);
    await page.goto('/login');
    await page.getByRole('button', { name: /Forgot password\?/i }).click();
    await page.locator('input[type="email"]').fill(`test_reset_${suffix}@example.com`);
    await page.getByRole('button', { name: /Send reset link|Reset/i }).click();
    const secondMsg = await page.locator('text=/reset link has been sent/i').textContent({ timeout: 10000 });

    expect(fakeMsg?.trim()).toBe(secondMsg?.trim());
  });
});

// SEC-04 (2026-08-23 security-seo-foundations plan, Task 4): `returnTo` is
// attacker-controlled query-string input — Login.tsx reads it straight off
// the URL (params.get("returnTo")) and hands it to App.tsx's handleLogin,
// which is the single place that calls navigate(). A crafted protocol-
// relative value like `//evil.example.com` (or a backslash variant that
// normalizes to the same shape) is a classic open-redirect vector once it
// reaches navigate() unsanitized. This is now the ONLY active defense
// against that vector: Task 3 (patching the react-router-dom open-redirect
// advisory itself) was deferred because the fix requires a v6->v7 major
// bump touching every route in the app — see the plan doc's Task 3 section
// and commit 4be88f4.
test.describe('SEC-04 — returnTo cannot redirect off-site after login', () => {
  test.beforeEach(async ({ page }) => {
    // The mocked /api/login below never sets a real session cookie (it's a
    // route interception, not a real backend session), so once the SPA
    // lands in /portal/*, any other /api/* call the freshly-mounted Portal
    // fires would 401 against the real dev backend and trip
    // apiInterceptor.ts's session-expired handler, bouncing the page BACK to
    // /login — which would masquerade as a failure of the returnTo fix
    // itself. Stub every other /api/* call to a harmless 200 so only the
    // returnTo sanitization is actually under test.
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      }
      if (url.includes('/api/login')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              id: 'u1',
              name: 'Dev User',
              email: 'dev@example.com',
              company: 'Dev Co',
              plan: 'Business',
              accountStatus: 'Active',
              projects: [],
              servers: [],
              invoices: [],
              updates: [],
            },
          }),
        });
      }
      // Anything else Portal fetches on mount (billing, updates, unread
      // counts, etc.) — a generic empty 200 is enough to keep it from 401ing.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
  });

  const submitLogin = async (page: import('@playwright/test').Page, returnTo: string) => {
    await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await page.locator('input[type="email"]').fill('dev@example.com');
    await page.locator('input[type="password"]').fill('whatever-not-checked-by-mock');
    await page.getByRole('button', { name: 'Open My Portal' }).click();
  };

  test('a protocol-relative returnTo falls back to the safe default', async ({ page }) => {
    await submitLogin(page, '//evil.example.com');
    await page.waitForURL(/\/portal/, { timeout: 10000 });

    // Must land on the safe in-app default, never carry the URL to an
    // external origin.
    expect(page.url()).not.toContain('evil.example.com');
    expect(new URL(page.url()).pathname).toBe('/portal/overview');
  });

  test('a real internal returnTo still lands on the intended page', async ({ page }) => {
    await submitLogin(page, '/portal/billing');
    await page.waitForURL(/\/portal\/billing/, { timeout: 10000 });

    expect(new URL(page.url()).pathname).toBe('/portal/billing');
  });
});
