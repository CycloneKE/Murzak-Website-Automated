import { test, expect, type Page } from '@playwright/test';

// Post-purchase "Complete your setup" cards (plan 2026-10-25-bundle-pricing-combined-checkout, Task 8).
// Every backend route is mocked; the saving and window shown come from the server's offers.

const DAY = 24 * 60 * 60 * 1000;
const USER = {
  id: 'u1',
  email: 'buyer@example.com',
  name: 'Buyer',
  company: 'Acme',
  plan: 'Business',
  accountStatus: 'Active',
  selectedServices: [],
  invoices: [],
};

const offer = (over: Record<string, unknown> = {}) => ({
  serviceId: 'starter-email',
  name: 'Business Email',
  monthlyKes: 1500,
  savingKes: 1500,
  windowEndsAtMs: Date.now() + 10 * DAY + 60 * 60 * 1000,
  ...over,
});

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockPortal(page: Page, offersRes: { status?: number; body: unknown }) {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), `murzak_onboarded_${USER.id}`);
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ ok: true, user: USER })));
  await page.route('**/api/portal/updates', (r) => r.fulfill(json({ ok: true, updates: [] })));
  await page.route('**/api/portal/requests/unread-count', (r) => r.fulfill(json({ ok: true, count: 0 })));
  await page.route('**/api/portal/services/**', (r) => r.fulfill(json({ ok: true })));
  await page.route('**/api/bundles/offers', (r) => r.fulfill(json(offersRes.body, offersRes.status ?? 200)));
}

const cards = (page: Page) => page.getByTestId('complete-setup-cards');

test('Overview shows a card with name, price, server saving and days left', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer()] } });
  await page.goto('/portal/overview');
  const card = page.getByTestId('complete-setup-card-starter-email');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Business Email');
  await expect(card).toContainText('KES 1,500');
  await expect(card).toContainText('Save KES 1,500');
  await expect(card).toContainText('10 days left');
});

test('clicking a card opens the Add-ons modal with that service preselected', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer()] } });
  await page.goto('/portal/overview');
  await page.getByTestId('complete-setup-card-starter-email').click();
  await expect(page.getByText('Purchase extra services')).toBeVisible();
  await expect(page.getByRole('button', { name: /Business Email/, pressed: true })).toBeVisible();
  await expect(page.getByText('Selected: 1').first()).toBeVisible();
});

test('enabled:false renders nothing', async ({ page }) => {
  await mockPortal(page, { body: { enabled: false, offers: [offer()] } });
  await page.goto('/portal/overview');
  await expect(page.getByText('System Health')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('empty offers renders nothing', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [] } });
  await page.goto('/portal/overview');
  await expect(page.getByText('System Health')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('a failing offers fetch renders nothing and the page still works', async ({ page }) => {
  await mockPortal(page, { status: 500, body: { error: 'boom' } });
  await page.goto('/portal/overview');
  await expect(page.getByText('System Health')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText(/unavailable right now/i)).toHaveCount(0);
});

test('an offer whose window already ended renders no card', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer({ windowEndsAtMs: Date.now() - 1000 })] } });
  await page.goto('/portal/overview');
  await expect(page.getByText('System Health')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('less than a day left is worded honestly', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer({ windowEndsAtMs: Date.now() + 5 * 60 * 60 * 1000 })] } });
  await page.goto('/portal/overview');
  await expect(page.getByTestId('complete-setup-card-starter-email')).toContainText('less than a day left');
});

// ---- countdown boundaries (clock fixed so "exactly N ms" is exact) ----
const FIXED = new Date('2026-10-25T09:00:00Z').getTime();
for (const [label, delta, expected] of [
  ['exactly 0 ms left', 0, null],
  ['-1 ms (just ended)', -1, null],
  ['+1 ms left', 1, 'less than a day left'],
  ['exactly 24 h left', DAY, '1 day left'],
] as const) {
  test(`boundary: ${label}`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED);
    await mockPortal(page, { body: { enabled: true, offers: [offer({ windowEndsAtMs: FIXED + delta })] } });
    await page.goto('/portal/overview');
    await expect(page.getByText('System Health')).toBeVisible();
    if (expected === null) await expect(cards(page)).toHaveCount(0);
    else await expect(page.getByTestId('complete-setup-card-starter-email')).toContainText(expected);
  });
}

test('a closed preselected modal does not leak its preselection into the Profile add-ons button', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer()] } });
  await page.goto('/portal/overview');
  await page.getByTestId('complete-setup-card-starter-email').click();
  await expect(page.getByRole('button', { name: /Business Email/, pressed: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Purchase extra services')).toHaveCount(0);
  // Client-side navigation (no reload) so portal state survives, as in real use.
  await page.getByText('Settings', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/portal\/profile/);
  await page.getByRole('button', { name: /Add Services/ }).click();
  await expect(page.getByText('Purchase extra services')).toBeVisible();
  await expect(page.getByText('Selected: 0').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Business Email/, pressed: true })).toHaveCount(0);
});

test('AppWelcome card lands on the portal with the modal preselected; reload does not reopen it', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [offer()] } });
  await page.route('**/api/orders/ord-w1', (r) =>
    r.fulfill(json({ order: { id: 'ord-w1', status: 'Paid', serviceId: 'biz-pos-duka', config: { app: 'pos' } } }))
  );
  await page.route('**/api/portal/services/biz-pos-duka/activity', (r) =>
    r.fulfill(json({ ok: true, jobs: [{ id: 'j1', serviceId: 'biz-pos-duka', status: 'active', statusDetail: '', attempts: 0, accessUrl: 'https://acme.pos.murzaktech.tech', posLogin: null }] }))
  );
  await page.goto('/welcome/ord-w1');
  await page.getByTestId('complete-setup-card-starter-email').click();
  await expect(page).toHaveURL(/\/portal\/overview/);
  await expect(page.getByText('Purchase extra services')).toBeVisible();
  await expect(page.getByRole('button', { name: /Business Email/, pressed: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('System Health')).toBeVisible();
  await expect(page.getByText('Purchase extra services')).toHaveCount(0);
});

// ---- I4: a domain offer is bought WITH a name, never through the Add-ons modal ----
const domainOffer = offer({ serviceId: 'domain-com', name: 'Domain: .com', monthlyKes: 4200, savingKes: 1575 });

async function mockDomainPurchase(page: Page, invoiceStatus = 200) {
  const state: { checkBodies: any[]; invoiceBodies: any[]; attachBodies: any[] } = { checkBodies: [], invoiceBodies: [], attachBodies: [] };
  await page.route('**/api/domains/check', async (r) => {
    const body = r.request().postDataJSON();
    state.checkBodies.push(body);
    await r.fulfill(json({ results: body.tlds.map((tld: string) => ({ domain: `${body.label}${tld}`, tld, available: true, priceKes: 4200 })) }));
  });
  await page.route('**/api/addons/invoice/create', async (r) => {
    state.invoiceBodies.push(r.request().postDataJSON());
    await r.fulfill(invoiceStatus === 200
      ? json({ ok: true, user: USER, invoiceId: 'PINV-9' })
      : json({ error: 'Choose the domain name to register (it must end in .com).', code: 'DOMAIN_NAME_REQUIRED' }, invoiceStatus));
  });
  await page.route('**/api/services/addons/add', async (r) => {
    state.attachBodies.push(r.request().postDataJSON());
    await r.fulfill(json({ ok: true, user: USER }));
  });
  return state;
}

async function pickDomain(page: Page) {
  const card = page.getByTestId('complete-setup-card-domain-com');
  await card.getByRole('button', { name: /Choose your name/ }).click();
  await card.getByPlaceholder('yourbusiness').fill('acme');
  await card.getByRole('button', { name: 'Search' }).click();
  await card.getByRole('button', { name: 'Select' }).click();
  return card;
}

test('domain offer: card shows the yearly price and saving, search is limited to the offered ending', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [domainOffer] } });
  const state = await mockDomainPurchase(page);
  await page.goto('/portal/overview');
  const card = page.getByTestId('complete-setup-card-domain-com');
  await expect(card).toContainText('KES 4,200/yr');
  await expect(card).toContainText('Save KES 1,575');
  await pickDomain(page);
  expect(state.checkBodies).toEqual([{ label: 'acme', tlds: ['.com'] }]);
  await expect(card.getByRole('button', { name: 'Add acme.com' })).toBeVisible();
  await expect(page.getByText('Purchase extra services')).toHaveCount(0);
});

test('domain offer: buying sends the chosen name on both calls and lands on Billing', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [domainOffer] } });
  const state = await mockDomainPurchase(page);
  await page.goto('/portal/overview');
  const card = await pickDomain(page);
  await card.getByRole('button', { name: 'Add acme.com' }).click();
  await expect(page).toHaveURL(/\/portal\/billing/);
  expect(state.invoiceBodies).toEqual([{ services: [{ serviceId: 'domain-com', serviceName: 'Domain: .com', tier: 'Light', domainChoice: 'acme.com' }] }]);
  expect(state.attachBodies.map((b) => b.services[0].domainChoice)).toEqual(['acme.com']);
});

test('domain offer: no name picked means no purchase button and nothing sent', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [domainOffer] } });
  const state = await mockDomainPurchase(page);
  await page.goto('/portal/overview');
  const card = page.getByTestId('complete-setup-card-domain-com');
  await card.getByRole('button', { name: /Choose your name/ }).click();
  await expect(card.getByRole('button', { name: 'Pick a name first' })).toBeDisabled();
  expect(state.invoiceBodies).toEqual([]);
});

test('domain offer: a refused purchase shows the server reason and stays on the page', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [domainOffer] } });
  await mockDomainPurchase(page, 422);
  await page.goto('/portal/overview');
  const card = await pickDomain(page);
  await card.getByRole('button', { name: 'Add acme.com' }).click();
  await expect(card.getByRole('alert')).toContainText('Choose the domain name to register');
  await expect(page).toHaveURL(/\/portal\/overview/);
});

test('AppWelcome domain card buys the named domain and lands on Billing', async ({ page }) => {
  await mockPortal(page, { body: { enabled: true, offers: [domainOffer] } });
  const state = await mockDomainPurchase(page);
  await page.route('**/api/orders/ord-w2', (r) =>
    r.fulfill(json({ order: { id: 'ord-w2', status: 'Paid', serviceId: 'biz-pos-duka', config: { app: 'pos' } } }))
  );
  await page.route('**/api/portal/services/biz-pos-duka/activity', (r) =>
    r.fulfill(json({ ok: true, jobs: [{ id: 'j1', serviceId: 'biz-pos-duka', status: 'active', statusDetail: '', attempts: 0, accessUrl: 'https://acme.pos.murzaktech.tech', posLogin: null }] }))
  );
  await page.goto('/welcome/ord-w2');
  const card = await pickDomain(page);
  await card.getByRole('button', { name: 'Add acme.com' }).click();
  await expect(page).toHaveURL(/\/portal\/billing/);
  expect(state.invoiceBodies[0].services[0].domainChoice).toBe('acme.com');
});
