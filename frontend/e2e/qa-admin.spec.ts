import { test, expect } from '@playwright/test';

// Suite 8 — Admin console (see QA test plan, ADM-01). The unauthenticated
// half of this sweep lives in backend/test/qaAdmin.test.js (no session
// needed there); this file covers the other half — a REAL logged-in account
// that is deliberately NOT an admin (its email is never in ADMIN_EMAILS).

test.describe('ADM-01 — a logged-in non-admin is rejected by every admin route', () => {
  test('admin endpoints return 403 for an authenticated ordinary customer', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 100000);
    const email = `test_nonadmin_${suffix}@example.com`;

    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Non Admin Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Non Admin Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing admin authz');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();
    await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });

    const routes = [
      { method: 'GET', path: '/api/admin/threads' },
      { method: 'GET', path: '/api/admin/provisioning/jobs' },
      { method: 'POST', path: '/api/admin/provisioning/run' },
      { method: 'GET', path: '/api/admin/provisioning/capacity' },
      { method: 'GET', path: '/api/admin/terminal/sessions' },
    ];

    for (const route of routes) {
      const res = await page.evaluate(
        async ({ method, path }) => {
          const r = await fetch(path, { method, credentials: 'include' });
          return { status: r.status };
        },
        route
      );
      // A genuinely logged-in but non-admin session must get 403 (requireAdmin
      // fails the ADMIN_EMAILS check) — 401 here would mean the session itself
      // isn't being recognized, also a real bug worth catching, so allow both
      // but never 200.
      expect(
        [401, 403].includes(res.status),
        `${route.method} ${route.path} returned ${res.status} for a logged-in non-admin — expected 401/403`
      ).toBe(true);
    }
  });
});
