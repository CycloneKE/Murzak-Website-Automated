import { test, expect } from '@playwright/test';

// Task 8 — e2e coverage for the two Task-1..7 features:
//   Part A: domains are billed yearly but *displayed* monthly-equivalent
//           (frontend/src/components/DomainSearch.tsx, config/serviceCatalog.ts
//           monthlyEquivalentKes()).
//   Part B: hosting checkout offers monthly (today's price) vs. annual-prepay
//           at a 20% discount (frontend/src/pages/Checkout.tsx,
//           config/serviceCatalog.ts annualPrepayKes()/ANNUAL_DISCOUNT_PCT).
//
// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts.
// Keep identical to the source if its selectors ever change.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_pricedisp_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`PriceDisp ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`PriceDisp ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing price display');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRICE-01 — domain results show monthly figure with annual disclosure', () => {
  test.describe.configure({ timeout: 60_000 });

  test('a domain search result shows /mo and the annual total together', async ({ page }) => {
    await registerNewUser(page, 'domain');
    await page.goto('/products');

    await page.getByPlaceholder('yourbusiness').fill('pricedisplaytest99');
    await page.getByRole('button', { name: 'Search' }).click();

    const results = page.locator('li').filter({ hasText: /\/mo/ });
    await expect(results.first()).toBeVisible({ timeout: 15000 });

    // The disclosure must accompany the monthly figure — a bare "/mo" with no
    // annual total is exactly what this feature must never ship.
    await expect(page.getByText(/billed annually at/i).first()).toBeVisible();

    // ---- Exact-value assertion (carried forward from Task 1's review) ----
    //
    // The backend test that "covers" monthlyEquivalentKes() inlines its own
    // copy of Math.ceil(yearly / 12) and asserts against that copy — it never
    // calls the real function in frontend/src/config/serviceCatalog.ts. There
    // is no frontend test runner in this repo, so nothing else anywhere
    // exercises the shipped helper. This e2e assertion is the only place a
    // regression there (e.g. Math.ceil silently changed to Math.round) would
    // be caught, because this reads the number the real function rendered,
    // not a re-derivation of it.
    //
    // ".africa" (TLD_OPTIONS in frontend/src/services/domains.ts, priceKes:
    // 2500) is the deliberate target: 2500 / 12 = 208.33..., the only
    // non-exact division in TLD_OPTIONS. Math.ceil -> 209; Math.round would
    // wrongly show 208 (silently undercharging vs. the KES 2,500/yr actually
    // billed). Every other TLD's yearly price divides evenly by 12, so a
    // ceil-vs-round swap would be invisible on them.
    //
    // Flakiness tradeoff: DomainSearch's availability comes from checkDomain()
    // (frontend/src/services/domains.ts), which POSTs to /api/domains/check
    // and, only on failure (no backend, or a non-2xx/empty response), falls
    // back to a *deterministic* local simulation keyed by hash(label + tld).
    // This suite runs against no backend (see task report), so the fallback
    // always applies, and hash("pricedisplaytest99.africa") was confirmed
    // out-of-band to land in the "available" bucket (h % 10 >= 3) — so this
    // is deterministic in *this* environment, not a coin flip. It would only
    // go flaky if a real registrar-backed backend started responding for
    // this label with a different result; there is no such backend here.
    const africaLine = page.locator('li').filter({ hasText: 'pricedisplaytest99.africa' });
    await expect(africaLine).toBeVisible({ timeout: 15000 });
    await expect(africaLine.getByText('KES 209/mo', { exact: false })).toBeVisible();
    await expect(africaLine.getByText('billed annually at KES 2,500', { exact: false })).toBeVisible();
  });
});

test.describe('PRICE-02 — checkout offers a billing term for monthly products', () => {
  test.describe.configure({ timeout: 60_000 });

  test('a hosting order shows monthly and annual options with the saving', async ({ page }) => {
    await registerNewUser(page, 'term');
    await page.goto('/checkout/new?serviceId=starter-web-hosting');

    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Billed monthly')).toBeVisible();
    await expect(page.getByText(/Save 20%/i)).toBeVisible();

    // Exact-value strengthening: "Save 20%" alone only proves the discount
    // *label* is 20 — it says nothing about whether annualPrepayKes() (config/
    // serviceCatalog.ts) actually computed the discounted total correctly.
    // starter-web-hosting is KES 1,200/mo (checkout.spec.ts), so the annual
    // tile must read the full derivation: 1,200 * 12 * 0.8 = KES 11,520/yr.
    // A bug that dropped the *12 (e.g. discounting the monthly price instead
    // of the annualized price) would still pass "Save 20%" but fail this.
    await expect(page.getByText('KES 11,520/yr', { exact: false })).toBeVisible();
  });
});
