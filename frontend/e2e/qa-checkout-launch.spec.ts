import { test, expect } from '@playwright/test';

// Suite 4 — Checkout & resource launch (see QA test plan, suite LNCH-*).
// NOTE: the /api/auth/me mock below is scoped PER TEST (inside each test
// body), not a file-level beforeEach — LNCH-03/LNCH-06 need a real,
// persisting authenticated session across a second navigation, and a
// file-wide mock would intercept that later /api/auth/me boot-check too,
// silently logging the just-registered test user back out mid-test.

test.describe('LNCH-01 — deep link opens CloudLaunchModal pre-focused', () => {
  test('/cloud?launch=starter-app-hosting opens the modal on App Hosting', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    await page.goto('/cloud?launch=starter-app-hosting');
    await expect(page.getByRole('button', { name: /Launch now/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('https://github.com/you/app')).toBeVisible();
  });

  test('an unknown service id degrades to a generic modal, not a crash', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/cloud?launch=this-service-does-not-exist');
    // Modal chrome (close control) must still render even if no service matched.
    // Scoped role+name — the page's mobile-nav "Close menu" button also
    // carries an aria-label containing "Close" and makes a bare getByLabel
    // ambiguous.
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible({ timeout: 10000 });
    expect(errors).toEqual([]);
  });
});

test.describe('LNCH-03 — the client never sends a price the server could trust', () => {
  // NOTE: if this fails locally landing on /portal/admin instead of /login,
  // check backend/.env for DEV_AUTO_LOGIN=true — see the same caveat in
  // customer-journey.spec.ts. That flag auto-authenticates every request as
  // a fixed dev Admin session, so "Continue to checkout" while logged out
  // never reaches the real login gate this test depends on. CI has no .env,
  // so this doesn't affect CI runs.
  test('the launch request body carries only serviceId/tier/domainChoice, no monetary field', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 100000);
    const email = `test_lnch03_${suffix}@example.com`;

    // Register + pay a Business plan first, mirroring cloud-launch.spec.ts's
    // logged-in add-on path — /api/addons/invoice/create is the endpoint
    // under test here and only exists for an already-paid account.
    await page.goto('/pricing?configure=biz-pos-inventory');
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    const domainInput = page.locator('input[placeholder="myshop"]');
    if (await domainInput.isVisible()) await domainInput.fill(`lnch03${suffix}`);
    await checkoutBtn.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Lnch03 Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Lnch03 Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing price tamper resistance');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
    const firstInvoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    await page.evaluate(async (invId) => {
      await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
    }, firstInvoiceId);

    // Now launch a second resource and capture the ACTUAL request body sent.
    await page.goto('/cloud?launch=starter-storage');
    await expect(page.getByRole('button', { name: /Launch now/i })).toBeVisible({ timeout: 10000 });

    let capturedBody: Record<string, unknown> | null = null;
    let capturedRawText = '';
    page.on('request', (req) => {
      if (req.url().includes('/api/addons/invoice/create') && req.method() === 'POST') {
        capturedRawText = req.postData() || '';
        try {
          capturedBody = JSON.parse(capturedRawText);
        } catch {
          /* leave null */
        }
      }
    });

    const [addonResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/addons/invoice/create')),
      page.getByRole('button', { name: /Launch now/i }).click(),
    ]);
    expect(addonResp.status()).toBe(200);

    expect(capturedBody, 'never observed the /api/addons/invoice/create request').not.toBeNull();
    // The critical assertion: no price/amount field anywhere in the payload —
    // the server derives it entirely from serviceId+tier via the catalog
    // snapshot, so there is nothing for a tampered client to lie about.
    const priceFieldPattern = /price|amount|kes|cost/i;
    expect(priceFieldPattern.test(capturedRawText)).toBe(false);
  });
});

test.describe('LNCH-06 — closing the modal before confirm creates nothing', () => {
  test('dismissing the launch modal makes no invoice-create request', async ({ page }) => {
    let addonCallSeen = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/addons/invoice/create') || req.url().includes('/api/plan/attach-selection')) {
        addonCallSeen = true;
      }
    });

    await page.goto('/cloud?launch=starter-app-hosting');
    const closeBtn = page.getByRole('button', { name: 'Close', exact: true });
    await expect(closeBtn).toBeVisible({ timeout: 10000 });
    await closeBtn.click();

    // Give any accidental async fetch a moment to fire before asserting.
    await page.waitForTimeout(500);
    expect(addonCallSeen).toBe(false);
  });
});
