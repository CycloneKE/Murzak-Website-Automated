import { test, expect, type Page } from '@playwright/test';

// Checkout summary for bundle orders (plan 2026-10-25-bundle-pricing-combined-checkout, Task 7).
// All backend routes are mocked; every number shown must be the server's.

const USER = { id: 'u1', email: 'buyer@example.com', name: 'Buyer', company: 'Acme' };

const DOMAIN_CFG = { domain: 'acme.com' };

function order(over: Record<string, any> = {}) {
  return {
    id: 'ord-b1',
    status: 'Draft',
    serviceId: 'biz-pos-duka',
    serviceName: 'Murzak POS Duka',
    tier: 'Duka',
    category: 'Business',
    monthlyKes: 2000,
    setupKes: 0,
    totalDueKes: 2000 + 1500 + 4200 - 1575,
    companions: [
      { serviceId: 'starter-email', serviceName: 'Business Email Starter', monthlyKes: 1500, setupKes: 0 },
      { serviceId: 'domain-com', serviceName: 'Domain Registration (.com)', monthlyKes: 4200, setupKes: 0 },
    ],
    bundleSavingKes: 1575,
    bundleWindowEndsAtMs: null,
    reservationExpiresAt: new Date(Date.now() + 25 * 60_000).toISOString(),
    invoiceDocName: null,
    eligibleForTermChoice: false,
    config: {
      app: 'pos',
      slug: 'acme',
      shopName: 'Acme Shop',
      bundle: {
        companions: [{ serviceId: 'starter-email' }, { serviceId: 'domain-com', config: DOMAIN_CFG }],
        savingKes: 1575,
      },
    },
    ...over,
  };
}

async function mock(
  page: Page,
  o: any,
  put?: (body: any) => { status: number; body: any },
  opts: { chargeKes?: number; prepareDelayMs?: number } = {}
) {
  const state: { putBodies: any[] } = { putBodies: [] };
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user: USER }) })
  );
  await page.route('**/api/orders/ord-b1', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ order: o }) })
  );
  await page.route('**/api/orders/ord-b1/prepare-payment', async (r) => {
    if (opts.prepareDelayMs) await new Promise((res) => setTimeout(res, opts.prepareDelayMs));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoiceDocName: 'INV-1' }) });
  });
  await page.route('**/api/billing/invoice/INV-1', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invoice: { chargeKes: opts.chargeKes ?? 6125, paypalAmountUsd: 47 } }) })
  );
  await page.route('**/api/orders/ord-b1/companions', async (r) => {
    const body = r.request().postDataJSON();
    state.putBodies.push(body);
    const res = put ? put(body) : { status: 500, body: { error: 'nope' } };
    await r.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
  });
  return state;
}

const summary = (page: Page) => page.getByTestId('order-summary');

test('summary lists primary, companions, a negative saving row and the server total', async ({ page }) => {
  await mock(page, order({ eligibleForTermChoice: true }));
  await page.goto('/checkout/ord-b1');
  await expect(summary(page)).toContainText('Murzak POS Duka');
  await expect(summary(page)).toContainText('Business Email Starter');
  await expect(summary(page)).toContainText('Domain Registration (.com)');
  const saving = page.getByTestId('bundle-saving-row');
  await expect(saving).toContainText('Bundle saving');
  await expect(saving).toContainText(/[-−]\s?KES 1,575/);
  await expect(page.getByTestId('order-total-row')).toHaveText(/^Order totalKES 6,125$/);
  // Before any invoice, "Due now" is the server total (exact figure, not a substring).
  await expect(page.getByTestId('due-now-amount')).toHaveText('KES 6,125');
});

test('removing a companion PUTs the remaining list (with config) and renders the response', async ({ page }) => {
  const reduced = order({
    eligibleForTermChoice: true,
    companions: [{ serviceId: 'domain-com', serviceName: 'Domain Registration (.com)', monthlyKes: 4200, setupKes: 0 }],
    bundleSavingKes: 0,
    totalDueKes: 6200,
    config: { app: 'pos', slug: 'acme', shopName: 'Acme Shop', bundle: { companions: [{ serviceId: 'domain-com', config: DOMAIN_CFG }], savingKes: 0 } },
  });
  const state = await mock(page, order({ eligibleForTermChoice: true }), () => ({ status: 200, body: { ok: true, order: reduced } }));
  await page.goto('/checkout/ord-b1');
  await page.getByRole('button', { name: 'Remove Business Email Starter' }).click();
  await expect(page.getByText('Business Email Starter')).toHaveCount(0);
  expect(state.putBodies).toEqual([{ companions: [{ serviceId: 'domain-com', config: DOMAIN_CFG }] }]);
  await expect(page.getByTestId('bundle-saving-row')).toHaveCount(0);
  await expect(page.getByTestId('order-total-row')).toContainText('KES 6,200');
});

test('removing the domain keeps the email companion without inventing config', async ({ page }) => {
  const reduced = order({
    eligibleForTermChoice: true,
    companions: [{ serviceId: 'starter-email', serviceName: 'Business Email Starter', monthlyKes: 1500, setupKes: 0 }],
    bundleSavingKes: 0,
    totalDueKes: 3500,
  });
  const state = await mock(page, order({ eligibleForTermChoice: true }), () => ({ status: 200, body: { ok: true, order: reduced } }));
  await page.goto('/checkout/ord-b1');
  await page.getByRole('button', { name: 'Remove Domain Registration (.com)' }).click();
  await expect(page.getByTestId('order-total-row')).toContainText('KES 3,500');
  expect(state.putBodies).toEqual([{ companions: [{ serviceId: 'starter-email' }] }]);
});

test('no remove controls once an invoice exists', async ({ page }) => {
  await mock(page, order({ invoiceDocName: 'INV-1' }));
  await page.goto('/checkout/ord-b1');
  await expect(summary(page)).toContainText('Business Email Starter');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('after prepare, Due now is invoice-derived and Remove controls are gone', async ({ page }) => {
  await mock(page, order(), undefined, { chargeKes: 6125 });
  await page.goto('/checkout/ord-b1');
  await expect(page.getByTestId('due-now-amount')).toHaveText('KES 6,125');
  await expect(page.getByTestId('companions-locked')).toBeVisible();
  await expect(summary(page)).toContainText('Business Email Starter');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  // The monthly order total is not shown beside the invoice amount.
  await expect(page.getByTestId('order-total-row')).toHaveCount(0);
});

test('Remove is unavailable while prepare-payment is in flight (non-eligible order)', async ({ page }) => {
  await mock(page, order(), undefined, { prepareDelayMs: 1500 });
  await page.goto('/checkout/ord-b1');
  await expect(summary(page)).toContainText('Business Email Starter');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByText('Preparing payment')).toBeVisible();
  await expect(page.getByTestId('due-now-amount')).toHaveText('KES 6,125');
});

test('Remove goes away as soon as Continue to payment starts preparing (eligible order)', async ({ page }) => {
  const state = await mock(page, order({ eligibleForTermChoice: true }), undefined, { prepareDelayMs: 1500 });
  await page.goto('/checkout/ord-b1');
  await expect(page.getByRole('button', { name: 'Remove Business Email Starter' })).toBeVisible();
  await page.getByRole('button', { name: /Continue to payment/ }).click();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  expect(state.putBodies).toEqual([]);
});

test('annual choice on a bundle: term cards and Due now match what the backend bills', async ({ page }) => {
  // Real catalogue numbers: ERP Light 6000 (+5000 setup), Business Email 1500, .com 4200, saving 1575.
  // monthly invoice = totalDueKes = 15,125; annual = annualPrepay(11,700) - 1,575 = 110,745
  // (the same expression backend/test/ordersRoutes.test.js pins for this trio).
  const erp = order({
    eligibleForTermChoice: true,
    serviceId: 'biz-erp-light',
    serviceName: 'Murzak ERP (1-3 users)',
    monthlyKes: 6000,
    setupKes: 5000,
    totalDueKes: 6000 + 5000 + 1500 + 4200 - 1575,
    config: { bundle: { companions: [{ serviceId: 'starter-email' }, { serviceId: 'domain-com', config: DOMAIN_CFG }], savingKes: 1575 } },
  });
  await mock(page, erp, undefined, { chargeKes: 110745 });
  await page.goto('/checkout/ord-b1');
  await expect(page.getByRole('button', { name: /KES 15,125/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /KES 110,745\/yr/ })).toBeVisible();
  await expect(page.getByTestId('due-now-amount')).toHaveText('KES 15,125');
  await page.getByRole('button', { name: /KES 110,745\/yr/ }).click();
  await page.getByRole('button', { name: /Continue to payment/ }).click();
  await expect(page.getByTestId('due-now-amount')).toHaveText('KES 110,745');
  await expect(page.getByTestId('order-total-row')).toHaveCount(0);
  // No amortised "/mo" header for bundle orders.
  await expect(summary(page)).not.toContainText('billed annually');
});

test('no remove controls when the order is not a Draft', async ({ page }) => {
  await mock(page, order({ status: 'Cancelled' }));
  await page.goto('/checkout/ord-b1');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('a failed removal shows a user-safe message and keeps the lines', async ({ page }) => {
  // eligibleForTermChoice keeps the invoice from being prepared, so removal stays available.
  await mock(page, order({ eligibleForTermChoice: true }), () => ({
    status: 500,
    body: { error: 'TypeError: Cannot read properties of undefined (reading x) at Object.<anonymous>' },
  }));
  await page.goto('/checkout/ord-b1');
  await page.getByRole('button', { name: 'Remove Business Email Starter' }).click();
  const err = page.getByTestId('companion-error');
  await expect(err).toBeVisible();
  await expect(err).not.toContainText('TypeError');
  await expect(err).toHaveText("We couldn't update your extras. Please try again.");
  await expect(summary(page)).toContainText('Business Email Starter');
});

test('an order without companions shows no companion or saving rows', async ({ page }) => {
  await mock(page, order({ companions: [], bundleSavingKes: 0, totalDueKes: 2000, config: { app: 'pos', slug: 'acme', shopName: 'Acme Shop' } }));
  await page.goto('/checkout/ord-b1');
  await expect(summary(page)).toContainText('Murzak POS Duka');
  await expect(page.getByTestId('bundle-saving-row')).toHaveCount(0);
  await expect(page.getByTestId('order-total-row')).toHaveCount(0);
  await expect(page.getByTestId('companion-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});
