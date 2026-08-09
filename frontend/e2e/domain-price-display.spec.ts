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

test.describe('PRICE-02 — checkout offers a billing term for monthly products (confirm-before-create)', () => {
  test.describe.configure({ timeout: 60_000 });

  // Task 6 rework: Tasks 1-5 replaced the old "auto-fire prepare-payment on
  // load, then silently correct the invoice if the customer picks annual"
  // flow (bug C1: an annual selection could charge monthly) with a
  // confirm-before-create flow — the invoice is never created until the
  // customer explicitly confirms a term via the selector + "Continue to
  // payment" button. This test exercises that flow directly by mocking
  // GET /api/orders/:id (deterministically eligibleForTermChoice: true,
  // independent of whatever the real backend eligibility rule computes —
  // that rule has its own backend tests), POST prepare-payment (with a call
  // counter — the whole point of C1 was a SECOND, correcting call) and
  // GET the resulting invoice, following this spec's existing route-mock
  // conventions (see checkout.spec.ts / qa-checkout-launch.spec.ts).
  test('an eligible order waits for the customer to confirm annual before any invoice is created', async ({ page }) => {
    await registerNewUser(page, 'term');

    const orderId = 'CHK-PRICE02-MOCK';
    const mockOrder = {
      id: orderId,
      status: 'Draft',
      serviceId: 'starter-web-hosting',
      serviceName: 'Website Hosting (Starter)',
      tier: 'Light',
      category: 'Website Hosting',
      monthlyKes: 1200,
      setupKes: 0,
      totalDueKes: 1200,
      reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      invoiceDocName: null,
      config: {},
      eligibleForTermChoice: true,
    };

    await page.route(`**/api/orders/${orderId}`, (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, order: mockOrder }),
      });
    });

    // The call counter is the crux of this test: the pre-Task-6 flow fired
    // this endpoint once on load and again (silently correcting the price)
    // when the customer picked a term — exactly the C1 bug. The new flow
    // must fire it exactly once, only once the customer confirms.
    let prepareCalls = 0;
    let capturedBody: any = null;
    await page.route(`**/api/orders/${orderId}/prepare-payment`, (route) => {
      prepareCalls += 1;
      capturedBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, invoiceDocName: 'INV-PRICE02-MOCK' }),
      });
    });

    // Price the mocked invoice off the ACTUAL captured request body, not a
    // hardcoded value — this ties "the UI shows KES 11,520" to "the server
    // really did receive billingTerm: annual", the same way the real backend
    // (routes/ordersRoutes.js) prices off the request it received.
    await page.route('**/api/billing/invoice/INV-PRICE02-MOCK', (route) => {
      const chargeKes = capturedBody?.billingTerm === 'annual' ? 11520 : 1200;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ invoice: { docName: 'INV-PRICE02-MOCK', chargeKes, paypalAmountUsd: 89 } }),
      });
    });

    await page.goto(`/checkout/${orderId}`);

    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Billed monthly')).toBeVisible();
    await expect(page.getByText(/Save 20%/i)).toBeVisible();

    // ---- Exact-value assertion (carried forward from the pre-Task-6 spec) ----
    //
    // "Save 20%" alone only proves the discount *label* is 20 — it says
    // nothing about whether annualPrepayKes() (config/serviceCatalog.ts)
    // actually computed the discounted total correctly. starter-web-hosting
    // is KES 1,200/mo, so the annual tile must read the full derivation:
    // 1,200 * 12 * 0.8 = KES 11,520/yr. A bug that dropped the *12 (e.g.
    // discounting the monthly price instead of the annualized price) would
    // still pass "Save 20%" but fail this.
    //
    // This must be checked NOW, before "Continue to payment": it's the
    // annual tile's own client-side label (computed straight from
    // order.monthlyKes, unrelated to the mocked invoice above), and the
    // Billing selector — tile and all — unmounts the instant an invoice
    // exists (Checkout.tsx: `order.eligibleForTermChoice && !invoice`).
    await expect(page.getByText('KES 11,520/yr', { exact: false })).toBeVisible();

    // ---- C1/C5 regression guard: no invoice, no payment UI, until confirmed ----
    // Proves the invoice truly hasn't been created yet — the crux of the
    // confirm-before-create rework. "Payment method" is PaymentMethods.tsx's
    // own section heading, only ever rendered once `invoice` is set.
    await expect(page.getByText('Payment method')).toHaveCount(0);
    expect(prepareCalls).toBe(0);

    // Pick Annual, then confirm.
    const annualTile = page.getByRole('button').filter({ hasText: /Save 20%/i });
    await annualTile.click();

    const continueBtn = page.getByRole('button', { name: 'Continue to payment' });
    await expect(continueBtn).toBeVisible();
    const [prepResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/prepare-payment')),
      continueBtn.click(),
    ]);
    expect(prepResp.status()).toBe(200);

    // Exactly ONE prepare-payment request for the entire test — the old
    // flow's extra "correction" call (bug C1) must never happen.
    expect(prepareCalls).toBe(1);
    expect(capturedBody).toEqual({ billingTerm: 'annual' });

    // Payment UI now renders, priced at the annual figure the mocked invoice
    // computed from that exact request body — end-to-end proof the annual
    // selection actually reached the server-bound request, not just the
    // client-side tile.
    await expect(page.getByText('Payment method')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pay KES 11,520', { exact: false })).toBeVisible();
  });
});

test.describe('PRICE-03 — a returning customer\'s add-on skips the billing-term selector entirely (C5 guard)', () => {
  test.describe.configure({ timeout: 60_000 });

  // Direct regression guard for C5: mid-relationship term switching must be
  // STRUCTURALLY absent from the UI for an ineligible order (an add-on, a
  // domain, a returning customer's purchase) — not merely untested, and not
  // merely "present but never clicked". GET /api/orders/:id is mocked with
  // eligibleForTermChoice: false; Checkout.tsx's own gate
  // (`order.eligibleForTermChoice && !invoice`) must never render the
  // selector, and prepare-payment must fire on its own, with zero clicks.
  test('an ineligible order never renders the selector and prepares payment automatically', async ({ page }) => {
    await registerNewUser(page, 'addon');

    const orderId = 'CHK-PRICE03-MOCK';
    const mockOrder = {
      id: orderId,
      status: 'Draft',
      serviceId: 'starter-storage',
      serviceName: 'File Storage (25GB)',
      tier: 'Light',
      category: 'Storage',
      monthlyKes: 500,
      setupKes: 0,
      totalDueKes: 500,
      reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      invoiceDocName: null,
      config: {},
      eligibleForTermChoice: false,
    };

    await page.route(`**/api/orders/${orderId}`, (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, order: mockOrder }),
      });
    });

    let prepareCalls = 0;
    let capturedBody: any = null;
    await page.route(`**/api/orders/${orderId}/prepare-payment`, (route) => {
      prepareCalls += 1;
      capturedBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, invoiceDocName: 'INV-PRICE03-MOCK' }),
      });
    });

    await page.route('**/api/billing/invoice/INV-PRICE03-MOCK', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ invoice: { docName: 'INV-PRICE03-MOCK', chargeKes: 500, paypalAmountUsd: 4 } }),
      })
    );

    await page.goto(`/checkout/${orderId}`);

    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 15000 });

    // The selector must be structurally absent, not just un-clicked.
    await expect(page.getByText('Billing', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Billed monthly')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);

    // prepare-payment fires on its own — no click anywhere in this test.
    await expect(page.getByText('Payment method')).toBeVisible({ timeout: 15000 });
    expect(prepareCalls).toBe(1);
    // No term in the body: preparePaymentAndPrice() is called with no
    // argument for an ineligible order (Checkout.tsx), so the client never
    // even offers a term for the server to have to distrust.
    expect(capturedBody).toEqual({});
  });
});
