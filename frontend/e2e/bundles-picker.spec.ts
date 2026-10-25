import { test, expect, type Page } from '@playwright/test';

// Bundle companion picker (plan 2026-10-25-bundle-pricing-combined-checkout, Task 6).
// Every backend route is mocked; prices and savings shown are server-supplied.

const USER = { id: 'u1', email: 'buyer@example.com', name: 'Buyer', company: 'Acme' };

type Level = 'ok' | 'limited' | 'full';

const availability = (level: Level = 'ok') => ({
  enabled: true,
  pairings: [
    { primaryIds: ['biz-pos-duka', 'biz-pos-inventory', 'biz-pos-chain'], companionId: 'starter-email', savingKes: 1500, label: 'First month free' },
    { primaryIds: ['biz-pos-duka', 'biz-pos-inventory', 'biz-pos-chain'], companionId: 'domain-com', savingKes: 1575, label: 'Domain at cost' },
  ],
  allowedCompanionIds: ['starter-email', 'domain-com', 'domain-org', 'biz-erp-light', 'biz-crm-helpdesk'],
  headroom: { benchSlotsLeft: level === 'full' ? 0 : level === 'limited' ? 1 : 5, level },
});

async function mockBase(page: Page, avail: any, opts: { fail?: boolean } = {}) {
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, user: USER }) })
  );
  await page.route('**/api/bundles/availability', (r) =>
    opts.fail
      ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(avail) })
  );
  await page.route('**/api/apps/pos/address**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: 'acme', available: true, suggestions: [] }) })
  );
  await page.route('**/api/domains/check', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ domain: 'acme.com', tld: '.com', available: true, priceKes: 4200 }] }),
    })
  );
}

/** Capture the first POST /api/orders body and answer with a draft order. */
async function captureOrder(page: Page, orderId: string) {
  const captured: { body: any } = { body: null };
  await page.route('**/api/orders', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    captured.body = r.request().postDataJSON();
    await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ order: { id: orderId } }) });
  });
  return captured;
}

const picker = (page: Page) => page.getByTestId('companion-picker');

test('POS set-up shows the picker with a saves label for the email pairing', async ({ page }) => {
  await mockBase(page, availability());
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole('checkbox', { name: /Business Email/ })).toBeVisible();
  await expect(picker(page)).toContainText(/saves KES 1,500/i);
});

test('email + domain companions are sent in the POST /api/orders body', async ({ page }) => {
  await mockBase(page, availability());
  const captured = await captureOrder(page, 'ord-1');
  await page.goto('/get/pos?service=biz-pos-duka');
  await page.getByLabel('Shop name').fill('Acme Shop');
  await expect(page.locator('#shop-address-status')).toContainText('acme.pos.murzaktech.tech', { timeout: 10_000 });

  await picker(page).getByRole('checkbox', { name: /Business Email/ }).check();
  await picker(page).getByPlaceholder('yourbusiness').fill('acme');
  await picker(page).getByRole('button', { name: 'Search' }).click();
  await picker(page).getByRole('button', { name: 'Select', exact: true }).click();

  const reqPromise = page.waitForRequest((q) => q.url().endsWith('/api/orders') && q.method() === 'POST');
  await page.getByRole('button', { name: /Continue to payment/ }).filter({ visible: true }).click();
  await reqPromise;
  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body.serviceId).toBe('biz-pos-duka');
  expect(captured.body.companions).toEqual([
    { serviceId: 'starter-email' },
    { serviceId: 'domain-com', config: { domain: 'acme.com' } },
  ]);
});

test('POS order without companions sends no companions key', async ({ page }) => {
  await mockBase(page, availability());
  const captured = await captureOrder(page, 'ord-0');
  await page.goto('/get/pos?service=biz-pos-duka');
  await page.getByLabel('Shop name').fill('Acme Shop');
  await expect(page.locator('#shop-address-status')).toContainText('acme.pos.murzaktech.tech', { timeout: 10_000 });
  const reqPromise = page.waitForRequest((q) => q.url().endsWith('/api/orders') && q.method() === 'POST');
  await page.getByRole('button', { name: /Continue to payment/ }).filter({ visible: true }).click();
  await reqPromise;
  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body).not.toHaveProperty('companions');
});

test('ERP page: chosen companion travels with the deep-link order', async ({ page }) => {
  await mockBase(page, availability());
  const captured = await captureOrder(page, 'ord-2');
  await page.goto('/products/erp');
  await picker(page).getByRole('checkbox', { name: /Business Email/ }).check();
  const reqPromise = page.waitForRequest((q) => q.url().endsWith('/api/orders') && q.method() === 'POST');
  await page.getByRole('button', { name: 'Select Light' }).click();
  await reqPromise;
  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body.serviceId).toBe('biz-erp-light');
  expect(captured.body.companions).toEqual([{ serviceId: 'starter-email' }]);
});

test('ERP deep-link with no companion selected is unchanged', async ({ page }) => {
  await mockBase(page, availability());
  const captured = await captureOrder(page, 'ord-3');
  await page.goto('/products/erp');
  const reqPromise = page.waitForRequest((q) => q.url().endsWith('/api/orders') && q.method() === 'POST');
  await page.getByRole('button', { name: 'Select Light' }).click();
  await reqPromise;
  await expect.poll(() => captured.body).not.toBeNull();
  expect(captured.body).toEqual({ serviceId: 'biz-erp-light', source: 'deep-link' });
});

test('enabled:false hides the picker and notice', async ({ page }) => {
  await mockBase(page, { enabled: false, pairings: [], allowedCompanionIds: [], headroom: { benchSlotsLeft: 0, level: 'ok' } });
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('availability-notice')).toHaveCount(0);
});

test('limited headroom with 2 bench slots shows the notice and disables nothing', async ({ page }) => {
  const a = availability('limited');
  a.headroom.benchSlotsLeft = 2;
  await mockBase(page, a);
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(page.getByTestId('availability-notice')).toContainText(/Limited availability/);
  await expect(picker(page).getByRole('checkbox', { name: /Murzak ERP/ })).toBeEnabled();
});

test('1 bench slot left: a bench-lane primary (POS) cannot add a second business app (needs 2)', async ({ page }) => {
  await mockBase(page, availability('limited')); // benchSlotsLeft 1
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(page.getByTestId('availability-notice')).toContainText(/Limited availability/);
  await expect(picker(page).getByRole('checkbox', { name: /Murzak ERP/ })).toBeDisabled();
  await expect(picker(page).getByRole('checkbox', { name: /CRM/ })).toBeDisabled();
  await expect(picker(page)).toContainText(/room for only one more business app/i);
  await expect(picker(page).getByRole('checkbox', { name: /Business Email/ })).toBeEnabled();
});

test('1 bench slot left: a handed-off second business app is not sent with a POS order', async ({ page }) => {
  await mockBase(page, availability('limited'));
  await seedHandoff(page, 'biz-pos', ['starter-email', 'biz-erp-light']);
  const captured = await captureOrder(page, 'ord-7');
  await page.goto('/get/pos?service=biz-pos-duka');
  await submitPos(page, captured);
  expect(captured.body.companions).toEqual([{ serviceId: 'starter-email' }]);
});

test('full headroom disables the second business app with a reason', async ({ page }) => {
  await mockBase(page, availability('full'));
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(page.getByTestId('availability-notice')).toContainText(/full/i);
  await expect(page.getByTestId('availability-notice').getByRole('link', { name: /contact/i })).toBeVisible();
  await expect(picker(page).getByRole('checkbox', { name: /Murzak ERP/ })).toBeDisabled();
  await expect(picker(page)).toContainText(/another business app/i);
  await expect(picker(page).getByRole('checkbox', { name: /Business Email/ })).toBeEnabled();
});

test('availability fetch failure hides the picker', async ({ page }) => {
  await mockBase(page, null, { fail: true });
  await page.goto('/get/pos?service=biz-pos-duka');
  await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('availability-notice')).toHaveCount(0);
});

// ---- Fix round 1: hidden/stale companions are never sent ----

const seedHandoff = (page: Page, family: string, ids: string[], domain = '') =>
  page.addInitScript(
    ([f, i, d]) => sessionStorage.setItem('murzak.companions.handoff', JSON.stringify({ family: f, ids: i, domain: d, at: Date.now() })),
    [family, ids, domain] as [string, string[], string]
  );

async function submitPos(page: Page, captured: { body: any }) {
  await page.getByLabel('Shop name').fill('Acme Shop');
  await expect(page.locator('#shop-address-status')).toContainText('acme.pos.murzaktech.tech', { timeout: 10_000 });
  const reqPromise = page.waitForRequest((q) => q.url().endsWith('/api/orders') && q.method() === 'POST');
  await page.getByRole('button', { name: /Continue to payment/ }).filter({ visible: true }).click();
  await reqPromise;
  await expect.poll(() => captured.body).not.toBeNull();
}

test('stale handoff ids not in allowedCompanionIds are not sent', async ({ page }) => {
  await mockBase(page, availability());
  await seedHandoff(page, 'biz-pos', ['starter-email', 'domain-net', 'biz-pos-chain']);
  const captured = await captureOrder(page, 'ord-4');
  await page.goto('/get/pos?service=biz-pos-duka');
  await submitPos(page, captured);
  // domain-net is not allowed, biz-pos-chain is an app tier, so only the email remains
  expect(captured.body.companions).toEqual([{ serviceId: 'starter-email' }]);
});

test('availability disabled with a stored handoff sends no companions', async ({ page }) => {
  await mockBase(page, { enabled: false, pairings: [], allowedCompanionIds: [], headroom: { benchSlotsLeft: 0, level: 'ok' } });
  await seedHandoff(page, 'biz-pos', ['starter-email']);
  const captured = await captureOrder(page, 'ord-5');
  await page.goto('/get/pos?service=biz-pos-duka');
  await submitPos(page, captured);
  expect(captured.body).not.toHaveProperty('companions');
});

test('availability fetch failure with a stored handoff sends no companions', async ({ page }) => {
  await mockBase(page, null, { fail: true });
  await seedHandoff(page, 'biz-pos', ['starter-email']);
  const captured = await captureOrder(page, 'ord-6');
  await page.goto('/get/pos?service=biz-pos-duka');
  await submitPos(page, captured);
  expect(captured.body).not.toHaveProperty('companions');
});

test('deep-link 400 with a handoff retries once without companions, clears it and shows the notice', async ({ page }) => {
  await mockBase(page, availability());
  await seedHandoff(page, 'biz-erp', ['starter-email']);
  const bodies: any[] = [];
  await page.route('**/api/orders', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    const b = r.request().postDataJSON();
    bodies.push(b);
    if (b.companions) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Starter Email cannot be bundled.' }) });
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ order: { id: 'ord-9' } }) });
  });
  await page.goto('/checkout/new?serviceId=biz-erp-light');
  await expect(page).toHaveURL(/\/checkout\/ord-9/, { timeout: 10_000 });
  await expect(page.getByRole('status').filter({ hasText: /cannot be bundled|couldn't add/i })).toBeVisible();
  // React StrictMode (dev) runs the effect twice, so allow duplicate first attempts;
  // the retry without companions must happen exactly once and be the last request.
  const plain = bodies.filter((x) => !x.companions);
  expect(plain).toEqual([{ serviceId: 'biz-erp-light', source: 'deep-link' }]);
  expect(bodies[bodies.length - 1]).toEqual({ serviceId: 'biz-erp-light', source: 'deep-link' });
  for (const x of bodies.filter((y) => y.companions)) expect(x.companions).toEqual([{ serviceId: 'starter-email' }]);
  expect(await page.evaluate(() => sessionStorage.getItem('murzak.companions.handoff'))).toBeNull();
});

test('ERP picker does not offer another ERP tier', async ({ page }) => {
  const a = availability();
  a.allowedCompanionIds = ['starter-email', 'biz-erp-light', 'biz-erp-configured', 'biz-crm-helpdesk'];
  await mockBase(page, a);
  await page.goto('/products/erp');
  await expect(picker(page).getByRole('checkbox', { name: /Business Email/ })).toBeVisible();
  await expect(picker(page).getByRole('checkbox', { name: /Murzak ERP/ })).toHaveCount(0);
  await expect(picker(page).getByRole('checkbox', { name: /CRM/ })).toHaveCount(1);
});
