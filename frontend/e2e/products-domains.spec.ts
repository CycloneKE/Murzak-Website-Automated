import { test, expect } from '@playwright/test';

// Task 6 — e2e coverage for the "Register a domain" section on the Products
// page (docs/superpowers/plans/2026-07-25-domains-databases-section-a-b1.md,
// Task 5). Covers: DomainSearch -> POST /api/orders -> /checkout/:orderId
// with yearly billing, plus the anonymous-visitor login redirect
// (frontend/src/pages/Products.tsx, frontend/src/components/DomainSearch.tsx).

// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts —
// see products-databases.spec.ts's copy of this same function for the
// rationale comment; keep both in sync with the source if it changes.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_proddom_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`ProdDom ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`ProdDom ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing domain products');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRODDOM-01 — domain search selects and launches checkout', () => {
  test.describe.configure({ timeout: 60_000 });

  test('selecting an available domain creates a yearly-billed order', async ({ page }) => {
    await registerNewUser(page, 'select');
    await page.goto('/products');

    // Scope to the "Register a domain" section — Header/Footer are not
    // hidden on /products, and other sections have their own inputs/buttons.
    const domainSection = page.locator('section', { hasText: 'Register a domain' });
    await domainSection.getByPlaceholder('yourbusiness').fill('murzaktestlabel123');
    await domainSection.getByRole('button', { name: 'Search' }).click();

    // Sanity check first: DomainSearch renders one <li> per TLD_OPTIONS entry
    // (frontend/src/services/domains.ts has 7 TLDs) regardless of
    // availability — confirm results actually loaded before making any claim
    // about which ones are available, so the assertions below can't pass
    // vacuously against an empty/still-loading results list.
    const resultRows = domainSection.locator('ul > li');
    await expect(resultRows.first()).toBeVisible({ timeout: 10000 });
    await expect(resultRows).toHaveCount(7);

    // POST /api/domains/check falls back to a deterministic stableHash-based
    // simulation when the backend Hostinger integration isn't configured, so
    // for a fixed label, which TLDs come back "available" isn't predictable
    // ahead of time (only stable run-to-run). Assert against whichever row IS
    // available rather than hardcoding a specific TLD.
    const selectButton = domainSection.getByRole('button', { name: /^(Select|Selected)$/ }).first();
    await expect(selectButton).toBeVisible({ timeout: 10000 });

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST'
    );
    await selectButton.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });
    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    // Domain-registration orders are yearly-billed (Task 3's isYearlyBilled(),
    // wired into Checkout.tsx by Task 4) — confirm "/yr" is shown and "/mo"
    // is not, proving the period branch actually took the yearly path.
    // Explicit timeout matches the other assertions in this file — the
    // default 5s window is tight against a real (non-mocked) backend.
    await expect(page.getByText('/yr', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('/mo', { exact: false })).not.toBeVisible();
  });

  test('logged-out visitor is redirected to login instead of failing silently', async ({ page }) => {
    // Mock /api/auth/me so the app exits boot immediately as logged-out,
    // matching auth-guards.spec.ts's / checkout.spec.ts's CHK-04 pattern.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    await page.goto('/products');

    const domainSection = page.locator('section', { hasText: 'Register a domain' });
    await domainSection.getByPlaceholder('yourbusiness').fill('anotherlabel456');
    await domainSection.getByRole('button', { name: 'Search' }).click();

    // Same sanity check as above: prove results loaded before relying on a
    // "Select" button existing.
    const resultRows = domainSection.locator('ul > li');
    await expect(resultRows.first()).toBeVisible({ timeout: 10000 });
    await expect(resultRows).toHaveCount(7);

    const selectButton = domainSection.getByRole('button', { name: /^(Select|Selected)$/ }).first();
    await expect(selectButton).toBeVisible({ timeout: 10000 });
    await selectButton.click();

    // Products.tsx's handleSelectDomain checks isLoggedIn before ever
    // calling POST /api/orders, and redirects straight to
    // /login?returnTo=%2Fproducts.
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fproducts/, { timeout: 10000 });
  });
});
