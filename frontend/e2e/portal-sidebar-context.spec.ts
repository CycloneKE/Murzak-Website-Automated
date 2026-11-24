import { test, expect, Page } from '@playwright/test';

// One sidebar that changes with context: global menu everywhere, the service's
// own sections while inside a service (desktop). Phones keep the drawer and the
// tab strip. The API is stubbed.

const SID = 'biz-erp-light';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, path: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem('murzak_onboarded_portal-settings@example.com', '1'); } catch { /* ignore */ }
  });
  await page.route('**/api/**', (r) => r.fulfill(json({ ok: true })));
  await page.route('**/api/auth/me', (r) =>
    r.fulfill(json({
      ok: true,
      user: {
        id: 'portal-settings@example.com', name: 'Faith Wanjiru', email: 'portal-settings@example.com',
        company: 'Wanjiru Traders', is_admin: false, plan: 'Business', accountStatus: 'Active', sourceCode: '',
        selectedServices: [{ serviceId: SID, serviceName: 'Shop ERP', tier: 'Light', status: 'Active', isAddon: false }],
        addonServiceIds: [], projects: [], servers: [], invoices: [], updates: [],
      },
    })));
  await page.route('**/api/portal/resource-admin/eligibility', (r) =>
    r.fulfill(json({ ok: true, enabled: true, planAllowed: true, approved: true, disclosureAccepted: true })));
  await page.route(`**/api/portal/services/${SID}/deployments`, (r) => r.fulfill(json({ ok: true, available: true, deployments: [] })));
  await page.goto(path);
  await expect(page.locator('[data-p="sidenav"]')).toBeVisible({ timeout: 15000 });
}

test.describe('Switching sidebar (desktop)', () => {
  test('inside a service the sidebar shows its sections, not the global menu', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    const side = page.getByRole('navigation', { name: 'Shop ERP sections' });
    await expect(side).toBeVisible();
    for (const label of ['General', 'Domains', 'Environment', 'Deployments', 'Logs', 'Analytics', 'Terminal', 'Danger zone']) {
      await expect(side.getByRole('button', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('navigation', { name: 'Portal' })).toBeHidden();
    await expect(side.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  });

  test('there is only one menu: the page does not repeat it', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    await expect(page.getByRole('navigation', { name: 'Shop ERP sections' })).toHaveCount(1);
  });

  test('picking a section navigates and moves the highlight', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    const side = page.getByRole('navigation', { name: 'Shop ERP sections' });
    await side.getByRole('button', { name: 'Analytics' }).click();
    await expect(page).toHaveURL(new RegExp(`/portal/cloud/${SID}/analytics$`));
    await expect(side.getByRole('button', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page');
    await expect(side.getByRole('button', { name: 'General' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('the back link returns to the service list and restores the global menu', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    await page.getByRole('navigation', { name: 'Shop ERP sections' }).getByRole('button', { name: 'Your services' }).click();
    await expect(page).toHaveURL(/\/portal\/cloud$/);
    await expect(page.getByRole('navigation', { name: 'Portal' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Shop ERP sections' })).toHaveCount(0);
  });

  test('the content gets the room the second sidebar used to take', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    const side = await page.locator('[data-p="sidenav"]').boundingBox();
    const content = await page.locator('h1', { hasText: 'Shop ERP' }).boundingBox();
    // Content starts right after the one sidebar (232px), not after two (440px).
    expect(content!.x).toBeLessThan(side!.width + 80);
  });

  test('collapsed to the icon rail, sections stay reachable by name', async ({ page }) => {
    await open(page, `/portal/cloud/${SID}`);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    const side = page.getByRole('navigation', { name: 'Shop ERP sections' });
    await expect(side.getByRole('button', { name: 'Logs' })).toBeVisible();
    await side.getByRole('button', { name: 'Logs' }).click();
    await expect(page).toHaveURL(new RegExp(`/portal/cloud/${SID}/logs$`));
  });
});

test.describe('Switching sidebar (phone)', () => {
  test('the drawer keeps the global menu and the page keeps its tab strip', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, `/portal/cloud/${SID}`);
    const strip = page.getByRole('navigation', { name: 'Shop ERP sections' });
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Analytics' })).toBeVisible();
    await page.getByRole('button', { name: /open menu/i }).first().click();
    await expect(page.getByRole('navigation', { name: 'Portal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Billing' })).toBeVisible();
  });
});
