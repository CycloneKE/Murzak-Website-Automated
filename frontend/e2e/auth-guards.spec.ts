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
