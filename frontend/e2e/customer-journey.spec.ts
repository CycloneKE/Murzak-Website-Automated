import { test, expect } from '@playwright/test';

test.describe('E2E Customer Journey - POS Purchase and Provisioning', () => {
  const randomSuffix = Math.floor(Math.random() * 100000);
  const testEmail = `test_pos_${randomSuffix}@example.com`;
  const testPassword = 'TestPassword123!';

  // NOTE: if this test fails locally with the final assertion never seeing
  // "POS Base Package", check backend/.env for DEV_AUTO_LOGIN=true — that
  // flag makes /api/auth/me always return a hardcoded dev user (see
  // authRoutes.js) regardless of who's actually logged in, which masks the
  // real registered test account's session. Unset it for this test to see
  // real behavior. CI has no .env file, so this doesn't affect CI runs.
  test('should complete the full purchase flow', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
    
    // 1. Visit Pricing Configurator directly for POS
    await page.goto('/pricing?configure=biz-pos-inventory');

    // 2. We should land on pricing and the modal should be open
    // The configurator modal should be visible
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });

    // Fill in domain configuration (simulate checking availability)
    const domainInput = page.locator('input[placeholder="myshop"]');
    if (await domainInput.isVisible()) {
      await domainInput.fill(`testshop${randomSuffix}`);
    }
    
    // Click checkout
    await checkoutBtn.click();

    // 3. Unauthenticated -> Should redirect to Login
    await expect(page).toHaveURL(/.*\/login.*/);

    // Click signup tab
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();

    // Fill registration
    await page.getByPlaceholder('Samuel Okoth').fill('Test User');
    await page.getByPlaceholder('My Company Ltd').fill('Test Company');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Test Purpose');
    await page.getByPlaceholder('sam@company.co.ke').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    
    // Check authorization box
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();

    // 4. Submit Registration -> Should attach cart and redirect to payment
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();
    
    // Verify it redirects to payment
    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });

    // 5. Select PayPal and Mock Checkout
    const invoiceMatch = page.url().match(/\/payment\/([^/]+)/);
    const invoiceId = invoiceMatch ? invoiceMatch[1] : '';
    expect(invoiceId).toBeTruthy();

    // Simulate PayPal success via the backend mock we added
    await page.evaluate(async (invId) => {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          invoiceDocName: invId,
          orderID: 'MOCK_PAYPAL_SUCCESS' // This triggers our backend mock
        })
      });
      if (res.ok) {
        window.location.href = '/portal/overview';
      }
    }, invoiceId);

    // 6. Verify Portal Auto-provisioning — the mock capture now runs the REAL
    // activation pipeline (invoice flips Paid, services activate, provisioning
    // jobs enqueue), so assert on the actual purchased service, not a stub.
    await expect(page).toHaveURL(/.*\/portal\/overview/);

    const authRes = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me');
      return await r.json();
    });
    console.log("AUTH ME:", JSON.stringify(authRes, null, 2));

    // The service actually bought at step 1 (biz-pos-inventory). Premium SKUs
    // land in "Setting up" until the provisioning runner completes them.
    const posService = page.locator('text=POS & Inventory').first();
    await expect(posService).toBeVisible({ timeout: 5000 });

    // The paid invoice must no longer show as due.
    const invoiceState = authRes?.user?.invoices?.[0]?.status || authRes?.invoices?.[0]?.status;
    expect(String(invoiceState).toLowerCase()).toBe('paid');
  });
});
