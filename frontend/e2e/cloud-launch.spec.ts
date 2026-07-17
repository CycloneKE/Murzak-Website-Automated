import { test, expect } from '@playwright/test';

test.describe('E2E Murzak Cloud instant checkout', () => {
  // Each test here chains several multi-step flows (registration, an
  // invoice purchase + mock PayPal capture, and in the second test a whole
  // bootstrap purchase before the actual cloud-launch under test even
  // starts). That routinely exceeds Playwright's 30s default test timeout
  // on firefox/webkit, which render more slowly than chromium for the same
  // sequence of steps observed via manual runs; bump it so slower engines
  // aren't spuriously flagged as broken.
  test.describe.configure({ timeout: 60_000 });

  const randomSuffix = Math.floor(Math.random() * 100000);

  test('logged-out visitor launches App Hosting, registers, and pays', async ({ page }) => {
    const testEmail = `test_cloud_${randomSuffix}@example.com`;
    const testPassword = 'TestPassword123!';
    const repoUrl = 'https://github.com/CycloneKE/WanderLust';

    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

    // 1. Deep-link straight into the App Hosting resource.
    await page.goto('/cloud?launch=starter-app-hosting');

    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('https://github.com/you/app').fill(repoUrl);
    await launchBtn.click();

    // 2. Unauthenticated -> redirected to Login.
    // /login always mounts with defaultMode="login" (see App.tsx's <Login
    // defaultMode="login" /> route), and the repo/sourceCode field only
    // renders once mode flips to "signup" (Login.tsx gates it behind
    // `mode === 'signup'`). So switch to signup mode first, then verify the
    // prefill landed in that field.
    await expect(page).toHaveURL(/.*\/login.*/);
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();

    // NOTE: a CSS attribute selector like input[value="..."] does not match a
    // React controlled input (value is a DOM property, not an HTML attribute),
    // so assert via the placeholder + toHaveValue instead.
    await expect(page.getByPlaceholder('e.g. GitHub URL or App Link')).toHaveValue(repoUrl, {
      timeout: 5000,
    });

    await page.getByPlaceholder('Samuel Okoth').fill('Cloud Test User');
    await page.getByPlaceholder('My Company Ltd').fill('Cloud Test Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing Murzak Cloud');
    await page.getByPlaceholder('sam@company.co.ke').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    // 3. Auto-attach should redirect straight to payment.
    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });

    const invoiceMatch = page.url().match(/\/payment\/([^/]+)/);
    const invoiceId = invoiceMatch ? invoiceMatch[1] : '';
    expect(invoiceId).toBeTruthy();

    await page.evaluate(async (invId) => {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
      if (res.ok) window.location.href = '/portal/overview';
    }, invoiceId);

    await expect(page).toHaveURL(/.*\/portal\/overview/);
    const appHostingRow = page.locator('text=App Hosting (Node.js / Docker)').first();
    await expect(appHostingRow).toBeVisible({ timeout: 5000 });
  });

  test('logged-in Business-plan customer launches a second cloud resource via add-on', async ({ page }) => {
    const testEmail = `test_cloud_biz_${randomSuffix}@example.com`;
    const testPassword = 'TestPassword123!';

    // Bootstrap: register + buy a Business-plan service first (mirrors
    // customer-journey.spec.ts's POS purchase), so this account already has
    // a PAID Business plan before we touch the cloud picker.
    await page.goto('/pricing?configure=biz-pos-inventory');
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    const domainInput = page.locator('input[placeholder="myshop"]');
    if (await domainInput.isVisible()) await domainInput.fill(`bizshop${randomSuffix}`);
    await checkoutBtn.click();

    await expect(page).toHaveURL(/.*\/login.*/);
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Biz Cloud Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Biz Cloud Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing add-on cloud launch');
    await page.getByPlaceholder('sam@company.co.ke').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });
    const firstInvoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    await page.evaluate(async (invId) => {
      await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
    }, firstInvoiceId);

    // Now this account has a PAID Business plan. Launch a Light-tier volume
    // resource — this must succeed via /api/addons/invoice/create, which
    // before Task 1's fix would have rejected it with a tier-mismatch error.
    await page.goto('/cloud?launch=starter-storage');
    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });
    await launchBtn.click();

    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });
    const secondInvoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    expect(secondInvoiceId).toBeTruthy();
    expect(secondInvoiceId).not.toBe(firstInvoiceId);
  });
});
