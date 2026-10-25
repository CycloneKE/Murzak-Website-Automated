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
