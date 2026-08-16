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
    // logged-in launch path — POST /api/orders is the endpoint under test
    // here, exercised the way a returning, already-paid customer would.
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
      if (req.url().endsWith('/api/orders') && req.method() === 'POST') {
        capturedRawText = req.postData() || '';
        try {
          capturedBody = JSON.parse(capturedRawText);
        } catch {
          /* leave null */
        }
      }
    });

    const [orderResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/orders')),
      page.getByRole('button', { name: /Launch now/i }).click(),
    ]);
    expect(orderResp.status()).toBe(200);

    expect(capturedBody, 'never observed the POST /api/orders request').not.toBeNull();
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

test.describe('LNCH-05 — free 36-hour trial request needs no card', () => {
  test('the 2-step trial form submits without ever asking for payment info', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    const suffix = Math.floor(Math.random() * 1e9);

    await page.goto('/test-request');
    await expect(page.locator('text=Get your')).toBeVisible({ timeout: 10000 });

    // No card/payment field anywhere on either step.
    await expect(page.locator('input[type="text"][placeholder*="4242"], input[placeholder*="card" i]')).toHaveCount(0);

    await page.locator('input[placeholder="Samuel Okoth"]').fill('Trial Tester');
    await page.locator('input[placeholder="samuel@company.co.ke"]').fill(`test_trial_${suffix}@example.com`);
    await page.locator('input[placeholder="Regional Enterprise Ltd"]').fill('Trial Test Co');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await expect(page.locator('text=What are you testing?')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="text"][placeholder*="4242"], input[placeholder*="card" i]')).toHaveCount(0);

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /Save My Plan/i }).click(),
    ]);
    expect(resp.status()).toBeLessThan(400);

    await expect(page.locator('text=Trial Ready.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Create account & start trial/i })).toBeVisible();
  });
});

test.describe('LNCH-07 — the capacity cap is enforced server-side, not just in the UI', () => {
  // NOTE: same DEV_AUTO_LOGIN caveat as elsewhere. This registers + pays a
  // Business plan, then fires an /api/addons/invoice/create request DIRECTLY
  // (bypassing any client-side capacity guard) with a batch of services
  // whose combined RAM (4608MB) exceeds SELF_SERVE_ORDER_RAM_CAP_MB (3200MB)
  // — the server (assertOrderWithinCapacity) must reject it.
  test('a directly-POSTed over-cap add-on order is rejected, not accepted', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 1e9);
    const email = `test_lnch07_${suffix}@example.com`;

    // Establish a paid Business plan (mirrors cloud-launch.spec.ts).
    await page.goto('/pricing?configure=biz-pos-inventory');
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    const domainInput = page.locator('input[placeholder="myshop"]');
    if (await domainInput.isVisible()) await domainInput.fill(`lnch07${suffix}`);
    await checkoutBtn.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Lnch07 Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Lnch07 Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing capacity gate at launch');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
    const invoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    await page.evaluate(async (id) => {
      await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: id, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
    }, invoiceId);

    // Over-cap batch: 6 volume services totalling 4608MB RAM (over the
    // 3200MB cap) — 1536+1024+768+768+256+256 across web-plus/app/db-light/
    // db-mongo/email/storage — all volume-class so plan-eligibility can't be
    // the thing that rejects it; the CAPACITY guard has to be what fires.
    const overCap = await page.evaluate(async () => {
      const services = [
        { serviceId: 'starter-web-hosting-plus', serviceName: 'Website Hosting (Growth)', tier: 'Medium', domainChoice: 'Use Murzak Subdomain' },
        { serviceId: 'starter-app-hosting', serviceName: 'App Hosting', tier: 'Light', domainChoice: 'Use Murzak Subdomain' },
        { serviceId: 'starter-db-light', serviceName: 'Database (Shared)', tier: 'Light', domainChoice: '' },
        { serviceId: 'starter-db-mongo', serviceName: 'Database (MongoDB)', tier: 'Light', domainChoice: '' },
        { serviceId: 'starter-email', serviceName: 'Business Email', tier: 'Light', domainChoice: '' },
        { serviceId: 'starter-storage', serviceName: 'File Storage', tier: 'Light', domainChoice: '' },
      ];
      const r = await fetch('/api/addons/invoice/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ services }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });

    // Must be a clean 4xx rejection (capacity guard), never a 200 that
    // silently over-commits the shared box, and never a 500.
    expect(overCap.status, `over-cap order returned ${overCap.status}: ${JSON.stringify(overCap.body)}`).toBeGreaterThanOrEqual(400);
    expect(overCap.status).toBeLessThan(500);
  });
});
