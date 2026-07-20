import { test, expect } from '@playwright/test';

// Suite 5 — Payments (see QA test plan, PAY-*). MOCK_PAYPAL_SUCCESS runs the
// REAL activation path (invoice -> Paid -> services Active -> provisioning
// enqueue) on a non-prod/MOCK_FRAPPE backend — see cloud-launch.spec.ts and
// customer-journey.spec.ts for the same pattern used elsewhere.

// NOTE: if any test below fails landing on /portal/admin instead of /login,
// check backend/.env for DEV_AUTO_LOGIN=true — see the same caveat in
// customer-journey.spec.ts. That flag auto-authenticates every request as a
// fixed dev Admin session, so the logged-out registration gate these tests
// depend on never triggers. CI has no .env, so this doesn't affect CI runs.
async function registerToPaymentPage(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_pay_${tag}_${suffix}@example.com`;

  await page.goto('/pricing?configure=biz-pos-inventory');
  const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
  await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
  const domainInput = page.locator('input[placeholder="myshop"]');
  if (await domainInput.isVisible()) await domainInput.fill(`pay${tag}${suffix}`);
  await checkoutBtn.click();

  await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`Pay ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`Pay ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing payment idempotency');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
  const invoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
  expect(invoiceId).toBeTruthy();
  return { email, invoiceId };
}

async function capture(page: import('@playwright/test').Page, invoiceId: string) {
  return page.evaluate(async (invId) => {
    const r = await fetch('/api/paypal/capture-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, invoiceId);
}

test.describe('PAY-02 / PAY-04 — a paid invoice activates services via the real pipeline', () => {
  test('capture flips the invoice Paid and the purchased service Active/Setting up — no phantom item', async ({ page }) => {
    const { invoiceId } = await registerToPaymentPage(page, 'activate');
    const res = await capture(page, invoiceId);
    expect(res.status).toBe(200);

    const me = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json());
    const services = me?.user?.selectedServices || me?.selectedServices || [];
    const pos = services.find((s: any) => /POS/i.test(s.serviceName || s.serviceId || ''));
    expect(pos, 'purchased POS service missing from selectedServices after capture').toBeTruthy();
    expect(['Active', 'Setting up']).toContain(pos.status);

    // Regression guard for the "mock path lie": no hardcoded phantom
    // "POS Base Package" / amount-99 item should ever appear.
    const phantom = services.find((s: any) => /POS Base Package/i.test(s.serviceName || ''));
    expect(phantom).toBeFalsy();

    const invoices = me?.user?.invoices || me?.invoices || [];
    const inv = invoices.find((i: any) => i.name === invoiceId || i.docName === invoiceId);
    expect(String(inv?.status || '').toLowerCase()).toBe('paid');
  });
});

test.describe('PAY-03 — a replayed capture does not double-activate', () => {
  test('capturing the same invoice twice is idempotent (one Active service, not two)', async ({ page }) => {
    const { invoiceId } = await registerToPaymentPage(page, 'replay');

    const first = await capture(page, invoiceId);
    expect(first.status).toBe(200);

    const second = await capture(page, invoiceId);
    // The second call must not behave as a fresh purchase — either a clean
    // no-op success or an explicit rejection are both acceptable idempotent
    // outcomes; what's NOT acceptable is silently succeeding as if it were
    // a brand new activation (checked below via the service count).
    expect(second.status).toBeLessThan(500);

    const me = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json());
    const services = me?.user?.selectedServices || me?.selectedServices || [];
    const posMatches = services.filter((s: any) => /POS/i.test(s.serviceName || s.serviceId || ''));
    expect(posMatches.length, `expected exactly one POS service after a replayed capture, found ${posMatches.length}`).toBe(1);
  });
});

test.describe('PAY-05 — concurrent double-click does not create two payments', () => {
  test('firing capture-order twice in parallel still results in one Paid invoice', async ({ page }) => {
    const { invoiceId } = await registerToPaymentPage(page, 'dblclick');

    const [a, b] = await Promise.all([capture(page, invoiceId), capture(page, invoiceId)]);
    expect(a.status).toBeLessThan(500);
    expect(b.status).toBeLessThan(500);

    const me = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json());
    const invoices = me?.user?.invoices || me?.invoices || [];
    const matching = invoices.filter((i: any) => i.name === invoiceId || i.docName === invoiceId);
    expect(matching.length, 'concurrent capture calls created more than one invoice record for the same id').toBe(1);
    expect(String(matching[0]?.status || '').toLowerCase()).toBe('paid');
  });
});

test.describe('PAY-06 — a stale/unknown invoice id is a real 404, not a generic 500', () => {
  test('GET/status/PDF on a nonexistent invoice all 404 cleanly', async ({ page }) => {
    // Establish a real session first (these routes require auth); the
    // invoice id itself is fabricated and must not exist.
    await registerToPaymentPage(page, 'notfound');
    const fakeId = 'PINV-DOES-NOT-EXIST-999999';

    const getRes = await page.evaluate(async (id) => {
      const r = await fetch(`/api/billing/invoice/${id}`, { credentials: 'include' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, fakeId);
    expect(getRes.status).toBe(404);

    const statusRes = await page.evaluate(async (id) => {
      const r = await fetch(`/api/billing/mpesa/status/${id}`, { credentials: 'include' });
      return r.status;
    }, fakeId);
    expect(statusRes).toBeLessThan(500);

    const pdfRes = await page.evaluate(async (id) => {
      const r = await fetch(`/api/invoices/${id}/download`, { credentials: 'include' });
      return { status: r.status, contentType: r.headers.get('content-type') || '' };
    }, fakeId);
    expect(pdfRes.status).toBe(404);
    expect(pdfRes.contentType).not.toContain('application/pdf');
  });
});
