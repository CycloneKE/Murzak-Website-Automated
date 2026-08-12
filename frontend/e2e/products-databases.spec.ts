import { test, expect } from '@playwright/test';

// Task 6 — e2e coverage for the "Managed databases" section on the Products
// page (docs/superpowers/plans/2026-07-25-domains-databases-section-a-b1.md,
// Task 2). Covers: clicking a database engine card -> POST /api/orders ->
// /checkout/:orderId with the right catalog entry and monthly price
// (frontend/src/pages/Products.tsx, frontend/src/config/serviceCatalog.ts).

// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts
// (which itself mirrors AUTH-06 in auth-guards.spec.ts) — same field
// selectors, same button names, same "fresh account lands in /portal"
// assumption. Keep this identical to the source if that file's selectors
// ever change.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_proddb_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`ProdDB ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`ProdDB ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing database products');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRODDB-01 — database engine card launches checkout', () => {
  test.describe.configure({ timeout: 60_000 });

  test('MySQL card creates an order and lands on its checkout page', async ({ page }) => {
    await registerNewUser(page, 'mysql');
    await page.goto('/products');

    // Scope to the "Managed databases" section (Products.tsx) rather than
    // the whole page — Header/Footer are not hidden on /products, and other
    // sections (Ready-Made Systems, Industries) render their own cards too.
    const dbSection = page.locator('section', { hasText: 'Managed databases' });
    await expect(dbSection.getByRole('heading', { name: 'Managed databases' })).toBeVisible();

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST'
    );
    // Card title is the short engine name ("MySQL"), not the catalog display
    // name ("MySQL Database") — see Products.tsx's `databases` array. The
    // click handler lives on the ancestor card <div>, so a click on the <h3>
    // text bubbles up to it.
    await dbSection.getByText('MySQL', { exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });
    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    // Checkout renders the catalog's full display name, not the card's short
    // name (frontend/src/config/serviceCatalog.ts: db-mysql -> "MySQL Database").
    await expect(page.getByText('MySQL Database')).toBeVisible();
    // db-mysql pricing.monthlyKes is 2000 -> formatKes() -> "KES 2,000".
    await expect(page.getByText('KES 2,000', { exact: false }).first()).toBeVisible();
    // Database engines are monthly-billed (not a domain-registration order),
    // so Checkout.tsx's isYearlyBilled() branch must show "/mo", not "/yr".
    await expect(page.getByText('KES 2,000/mo', { exact: false })).toBeVisible();
  });

  test('PostgreSQL, MongoDB, and Redis cards each deep-link to their own catalog id', async ({ page }) => {
    const cases: Array<{ card: string; catalogName: string }> = [
      { card: 'PostgreSQL', catalogName: 'PostgreSQL Database' },
      { card: 'MongoDB', catalogName: 'MongoDB Database' },
      { card: 'Redis', catalogName: 'Redis Database' },
    ];

    // A fresh account per iteration sidesteps any per-account state a reused
    // account/page could carry between iterations. That alone is not
    // enough, though: createOrder's shared-fleet RAM reservation guard
    // (orderStore.js's reservedDraftRamMb) sums Draft orders across EVERY
    // account, not just this test's own, so three fresh-but-uncancelled
    // Draft orders in a row still starve capacity for whatever else is
    // running in the same CI suite. Cancel each order before the next
    // iteration too.
    for (const { card, catalogName } of cases) {
      await registerNewUser(page, `others_${card.toLowerCase()}`);
      await page.goto('/products');
      const dbSection = page.locator('section', { hasText: 'Managed databases' });
      await expect(dbSection.getByText(card, { exact: true })).toBeVisible();

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/orders') && r.request().method() === 'POST'
      );
      await dbSection.getByText(card, { exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);

      await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });
      await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(catalogName)).toBeVisible();

      const orderId = page.url().match(/\/checkout\/(CHK-[^/?#]+)/)?.[1];
      if (orderId) {
        await page.request.post(`/api/orders/${orderId}/cancel`);
      }
    }
  });
});
