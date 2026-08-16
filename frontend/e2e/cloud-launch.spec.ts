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

    // 3. Auto-attach lands on Checkout (not a separate /payment/:id route —
    // there isn't one in the current flow; PaymentMethods renders directly
    // on Checkout.tsx). Pay via the same dev-only mock-pay rail
    // checkout.spec.ts already uses (PaymentMethods.tsx, gated on
    // import.meta.env.DEV). This replaces a manual /payment/:invoiceId +
    // fetch('/api/paypal/capture-order') dance that asserted a navigation
    // model the app no longer has — it never advanced past /checkout/CHK-...
    // in CI, which is exactly this drift, not a product bug.
    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });
    const mockPayBtn = page.getByRole('button', { name: 'Dev: skip to mock payment success' });
    await expect(mockPayBtn).toBeVisible({ timeout: 15000 });
    await mockPayBtn.click();

    await expect(page).toHaveURL(/.*\/portal\/overview/, { timeout: 15000 });
    const appHostingRow = page.locator('text=App Hosting (Node.js / Docker)').first();
    await expect(appHostingRow).toBeVisible({ timeout: 5000 });
  });

  test('logged-in Business-plan customer launches a second cloud resource via add-on', async ({ page }) => {
    const testEmail = `test_cloud_biz_${randomSuffix}@example.com`;
    const testPassword = 'TestPassword123!';

    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

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

    // Unlike the first test's CloudLaunchModal path (-> /checkout/CHK-...),
    // the Pricing/plan-configurator flow this bootstrap uses genuinely does
    // land on a dedicated /payment/:invoiceId page (Payment.tsx renders the
    // same PaymentMethods component Checkout.tsx embeds) — that part of the
    // original test was correct. Only the payment step itself needed fixing:
    // drive it via the same dev-mock-pay rail as everywhere else in this
    // suite, rather than a raw fetch to /api/paypal/capture-order.
    await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
    const firstOrderId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    const mockPayBtn = page.getByRole('button', { name: 'Dev: skip to mock payment success' });
    await expect(mockPayBtn).toBeVisible({ timeout: 15000 });
    await mockPayBtn.click();
    await expect(page).toHaveURL(/.*\/portal\/overview/, { timeout: 15000 });

    // Now this account has a PAID Business plan. Launch a Light-tier volume
    // resource — this must succeed via POST /api/orders (order creation is
    // capacity/tier-aware server-side; it used to go through
    // /api/addons/invoice/create, which before Task 1's fix would have
    // rejected it with a tier-mismatch error).
    await page.goto('/cloud?launch=starter-storage');
    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });

    // Assert the order-creation endpoint itself succeeded (not just that we
    // landed on /checkout/): the regression under test is that a paid
    // customer's volume-class launch goes through POST /api/orders without a
    // tier-mismatch rejection, and a status assertion won't degrade silently
    // if backend error copy is ever reworded.
    const [orderResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/orders')),
      launchBtn.click(),
    ]);
    expect(orderResp.status()).toBe(200);

    await expect(page).toHaveURL(/.*\/checkout\/.+/, { timeout: 15000 });
    const secondOrderId = page.url().match(/\/checkout\/([^/]+)/)?.[1] || '';
    expect(secondOrderId).toBeTruthy();
    expect(secondOrderId).not.toBe(firstOrderId);
  });
});
