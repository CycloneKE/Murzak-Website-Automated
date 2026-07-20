import { test, expect } from '@playwright/test';

// Suite 2 — Configurator & pricing (see QA test plan, suite CFG-*).
// CFG-01 (add/remove totals) and the base checkout flow are already covered
// by pricing.spec.ts — this file covers the cases that weren't.
// NOTE: the /api/auth/me mock is scoped per-describe, NOT file-wide — CFG-06
// registers a real account and needs its session to persist across a second
// navigation; a file-wide mock would intercept that later auth check too and
// silently log the just-registered user back out mid-test (see the same
// fix/explanation in qa-checkout-launch.spec.ts).

test.describe('CFG-02 — self-serve RAM/disk cap routes to a dedicated quote', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
  });

  test('adding services past the RAM cap shows the dedicated-capacity guard, not checkout', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('h1')).toContainText(/Pay for what you use/, { timeout: 15000 });

    const starterCard = page.locator('article').filter({ hasText: 'Infrastructure Core' }).first();
    await starterCard.getByRole('button', { name: /Configure infrastructure/i }).click();
    await expect(page.locator('text=Configure your plan')).toBeVisible({ timeout: 5000 });

    const serviceList = page.locator('.lg\\:col-span-8');
    const addButtons = serviceList.locator('.group').getByRole('button', { name: 'Add' });

    // Click "Add" repeatedly (skipping ones that flip to "Added" as we go —
    // Playwright re-resolves the locator each iteration) until the capacity
    // guard copy appears or we run out of addable services. The cap
    // (SELF_SERVE_ORDER_RAM_CAP_MB = 6144MB) is comfortably exceeded well
    // before a real catalog runs out of services.
    const overCapMsg = page.locator('text=This build needs dedicated capacity');
    let clicked = 0;
    const MAX_ATTEMPTS = 25;
    while (clicked < MAX_ATTEMPTS && !(await overCapMsg.isVisible())) {
      const count = await addButtons.count();
      if (count === 0) break;
      await addButtons.first().click();
      clicked++;
    }

    await expect(overCapMsg, `never triggered the capacity guard after adding ${clicked} services`).toBeVisible({
      timeout: 5000,
    });

    // The CTA must not read "Continue to checkout" while over-capacity — it
    // routes to a dedicated quote instead (server mirrors this: an over-cap
    // order is rejected even if this client guard were bypassed).
    await expect(page.getByRole('button', { name: /Continue to checkout/i })).toHaveCount(0);
  });
});

test.describe('CFG-05 — domain search shows honest available/taken states', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
  });

  test('mocked results render Select for available and Taken for unavailable', async ({ page }) => {
    await page.route('**/api/domains/check', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { domain: 'qa-example.co.ke', tld: '.co.ke', available: true, priceKes: 1200 },
          { domain: 'qa-example.com', tld: '.com', available: false, priceKes: 1500 },
        ]),
      })
    );

    await page.goto('/pricing');
    await expect(page.locator('h1')).toContainText(/Pay for what you use/, { timeout: 15000 });
    const starterCard = page.locator('article').filter({ hasText: 'Infrastructure Core' }).first();
    await starterCard.getByRole('button', { name: /Configure infrastructure/i }).click();
    await expect(page.locator('text=Configure your plan')).toBeVisible({ timeout: 5000 });

    const serviceList = page.locator('.lg\\:col-span-8');
    const webHostingItem = serviceList.locator('.group').filter({ hasText: 'Website Hosting (Starter)' }).first();
    await webHostingItem.getByRole('button', { name: 'Add' }).click();

    const registerBtn = page.getByRole('button', { name: /Register New Domain/i }).first();
    await expect(registerBtn, 'Register New Domain choice not offered for this service').toBeVisible({
      timeout: 5000,
    });
    await registerBtn.click();

    await expect(page.locator('text=Find your domain')).toBeVisible();
    await page.locator('input[placeholder="yourbusiness"]').fill('qa-example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.locator('text=qa-example.co.ke')).toBeVisible();
    await expect(page.locator('li', { hasText: 'qa-example.co.ke' }).getByRole('button', { name: 'Select' })).toBeVisible();
    await expect(page.locator('li', { hasText: 'qa-example.com' }).locator('text=Taken')).toBeVisible();
  });
});

test.describe('CFG-06 — plan selection survives the login gate', () => {
  // NOTE: if this fails locally landing somewhere other than /login after
  // "Continue to checkout", check backend/.env for DEV_AUTO_LOGIN=true (see
  // customer-journey.spec.ts) — it auto-authenticates every request as a
  // fixed dev session, so the logged-out gate this test depends on never
  // triggers. CI has no .env, so this doesn't affect CI runs.
  test('a plan built while logged out is applied automatically after signup', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 100000);
    const email = `test_cfg_persist_${suffix}@example.com`;

    await page.goto('/pricing');
    await expect(page.locator('h1')).toContainText(/Pay for what you use/, { timeout: 15000 });
    const starterCard = page.locator('article').filter({ hasText: 'Infrastructure Core' }).first();
    await starterCard.getByRole('button', { name: /Configure infrastructure/i }).click();
    await expect(page.locator('text=Configure your plan')).toBeVisible({ timeout: 5000 });

    const serviceList = page.locator('.lg\\:col-span-8');
    const webHostingItem = serviceList.locator('.group').filter({ hasText: 'Website Hosting (Starter)' }).first();
    await webHostingItem.getByRole('button', { name: 'Add' }).click();
    await expect(webHostingItem.getByRole('button', { name: 'Added' })).toBeVisible();

    await page.getByRole('button', { name: /Continue to checkout/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Cfg Persist Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Cfg Persist Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing plan persistence');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    // The pending plan (Website Hosting, KES 1,200) must be applied without
    // the user re-selecting anything — it lands straight on payment for it.
    await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
    await expect(page.locator('text=Website Hosting')).toBeVisible();
  });
});

test.describe('CFG-08 — plan tile price/CTA tokens are correct per plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
  });

  test('Free/Custom/from-price tokens render on the right tiers', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('h1')).toContainText(/Pay for what you use/, { timeout: 15000 });

    const enterpriseCard = page.locator('article').filter({ hasText: 'Enterprise' }).first();
    await expect(enterpriseCard.locator('text=Custom')).toBeVisible();

    const trialCard = page.locator('article').filter({ hasText: /Test Drive|Evaluating/i }).first();
    if (await trialCard.count()) {
      await expect(trialCard.locator('text=Free')).toBeVisible();
    }
  });
});
