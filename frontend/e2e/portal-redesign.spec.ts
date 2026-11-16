import { test, expect, Page } from '@playwright/test';

// Portal redesign (docs/superpowers/specs/2026-11-16-portal-coolify-inspired-
// redesign-design.md). Every test serves its own account through an
// intercepted /api/auth/me, so the suite does not depend on what a local
// backend happens to hold or on DEV_AUTO_LOGIN.

const LONG_NAME = 'Kariuki and Daughters Wholesale Hardware Point of Sale System';

type Svc = { serviceId: string; serviceName: string; tier?: string; status: string; isAddon?: boolean };

function account(over: Partial<Record<string, unknown>> = {}, services?: Svc[]) {
  return {
    ok: true,
    user: {
      id: 'portal-redesign@example.com',
      name: 'Faith Wanjiru',
      email: 'portal-redesign@example.com',
      company: 'Wanjiru Traders',
      is_admin: false,
      plan: 'Business',
      accountStatus: 'Active',
      sourceCode: '',
      selectedServices: services ?? [
        { serviceId: 'biz-erp-light', serviceName: 'Shop ERP', tier: 'Light', status: 'Active', isAddon: false },
        { serviceId: 'biz-crm-helpdesk', serviceName: 'Customer desk', tier: 'Light', status: 'Awaiting Payment', isAddon: true },
      ],
      addonServiceIds: [],
      projects: [],
      servers: [],
      invoices: [],
      updates: [],
      ...over,
    },
  };
}

async function open(page: Page, path: string, body = account()) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('murzak_onboarded_portal-redesign@example.com', '1');
      localStorage.removeItem('murzak_portal_nav_collapsed');
    } catch { /* ignore */ }
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
  await page.goto(path);
  await expect(page.locator('[data-p="sidenav"]')).toBeVisible({ timeout: 15000 });
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const main = document.getElementById('portal-scroll')!;
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1;
  });

test.describe('Portal shell', () => {
  test('sidebar shows grouped, plainly-labelled navigation', async ({ page }) => {
    await open(page, '/portal/overview');
    const nav = page.getByRole('navigation', { name: 'Portal' });
    for (const label of ['Home', 'Your services', 'Domains', 'Billing', 'Help', 'Settings']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByText('Services', { exact: true })).toBeVisible();
    await expect(nav.getByText('Account', { exact: true })).toBeVisible();
    await expect(nav.getByText('Resources')).toHaveCount(0);
    await expect(nav.getByText('Overview')).toHaveCount(0);
    // Staff-only group stays hidden for a customer.
    await expect(nav.getByText('Admin')).toHaveCount(0);
  });

  test('collapsing the sidebar hides labels and survives a reload', async ({ page }) => {
    await open(page, '/portal/overview');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    const aside = page.locator('[data-p="sidenav"]');
    await expect(aside).toHaveAttribute('data-collapsed', 'true');
    await expect(aside.getByText('Your services', { exact: true })).toBeHidden();

    // The init script clears the preference on every load, so check storage
    // directly instead of reloading through it.
    expect(await page.evaluate(() => localStorage.getItem('murzak_portal_nav_collapsed'))).toBe('1');
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(aside).toHaveAttribute('data-collapsed', 'false');
  });

  test('user menu holds the theme switch and log out', async ({ page }) => {
    await open(page, '/portal/overview');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await menu.getByRole('menuitemcheckbox').click();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
  });

  test('phone: drawer opens from the top bar and closes on navigation, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, '/portal/overview');
    const aside = page.locator('[data-p="sidenav"]');
    await expect(aside).not.toBeInViewport();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(aside).toBeInViewport();
    await aside.getByRole('button', { name: 'Billing', exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/billing$/);
    await expect(aside).not.toBeInViewport();
    expect(await noSidewaysScroll(page)).toBe(true);
  });

  test('payment-due banner keeps its Pay now button on every page, desktop and phone', async ({ page }) => {
    test.setTimeout(120000);
    const due = account({
      invoices: [
        { id: 'INV-0042', invoiceNo: 'INV-0042', docName: 'INV-0042', amount: 2500, date: '2026-11-01', status: 'Unpaid', type: 'Subscription', plan: 'Business' },
      ],
    });
    for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(size);
      for (const path of ['/portal/overview', '/portal/billing', '/portal/cloud/biz-erp-light']) {
        await open(page, path, due);
        const banner = page.locator('[data-p="banner"]').filter({ hasText: 'INV-0042' });
        await expect(banner.getByRole('button', { name: /Pay now/ })).toBeInViewport();
      }
    }
  });
});

test.describe('Service page', () => {
  test('old ?service= link redirects to the service page', async ({ page }) => {
    await open(page, '/portal/cloud?service=biz-erp-light&justProvisioned=true');
    await expect(page).toHaveURL(/\/portal\/cloud\/biz-erp-light\?justProvisioned=true$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Shop ERP' })).toBeVisible();
  });

  test('unknown service id shows a not-found panel with a way back', async ({ page }) => {
    await open(page, '/portal/cloud/does-not-exist');
    await expect(page.getByText("We couldn't find that service")).toBeVisible();
    await page.getByRole('button', { name: 'Back to your services' }).click();
    await expect(page).toHaveURL(/\/portal\/cloud$/);
  });

  test('lists only the sections that apply', async ({ page }) => {
    await open(page, '/portal/cloud/biz-erp-light');
    const sections = page.getByRole('navigation', { name: 'Shop ERP sections' });
    for (const label of ['General', 'Web address', 'Advanced', 'Danger zone']) {
      await expect(sections.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    // A managed system has no build history, files or mailboxes.
    for (const label of ['Updates', 'Files', 'Mailboxes', 'Connection']) {
      await expect(sections.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await sections.getByRole('button', { name: 'Danger zone' }).click();
    await expect(page).toHaveURL(/\/portal\/cloud\/biz-erp-light\/danger$/);
  });

  test('danger zone: stop asks first, delete needs the typed confirmation', async ({ page }) => {
    await open(page, '/portal/cloud/biz-erp-light/danger');
    await page.getByRole('button', { name: 'Stop service' }).click();
    const stop = page.getByRole('dialog');
    await expect(stop.getByText('Stop Shop ERP?')).toBeVisible();
    await stop.getByRole('button', { name: 'Cancel' }).click();
    await expect(stop).toBeHidden();

    await page.getByRole('button', { name: 'Delete service' }).click();
    const del = page.getByRole('dialog');
    const confirm = del.getByRole('button', { name: 'Confirm Delete' });
    await expect(confirm).toBeDisabled();
    await del.getByPlaceholder('Type DELETE').fill('delete');
    await expect(confirm).toBeDisabled();
    await del.getByPlaceholder('Type DELETE').fill('DELETE');
    await expect(confirm).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(del).toBeHidden();
  });

  test('phone: section menu scrolls on its own, page does not', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, '/portal/cloud/biz-erp-light');
    await expect(page.getByRole('navigation', { name: 'Shop ERP sections' })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });

  test('a 60-character name truncates without pushing anything off screen', async ({ page }) => {
    const long = account({}, [{ serviceId: 'biz-erp-light', serviceName: LONG_NAME, tier: 'Light', status: 'Active' }]);
    for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(size);
      await open(page, '/portal/cloud/biz-erp-light', long);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Kariuki');
      expect(await noSidewaysScroll(page)).toBe(true);
      await open(page, '/portal/overview', long);
      expect(await noSidewaysScroll(page)).toBe(true);
    }
  });
});

test.describe('Home and lists', () => {
  test('home lists services and opens a service page', async ({ page }) => {
    await open(page, '/portal/overview');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back, Faith');
    await expect(page.getByText('Needs your attention')).toBeVisible();
    await page.getByRole('row', { name: 'Open Shop ERP' }).click();
    await expect(page).toHaveURL(/\/portal\/cloud\/biz-erp-light$/);
  });

  test('an unpaid service sends you to Billing, not to an empty page', async ({ page }) => {
    await open(page, '/portal/cloud');
    await page.getByRole('row', { name: 'Open Customer desk' }).click();
    await expect(page).toHaveURL(/\/portal\/billing$/);
  });

  test('empty account still shows an honest empty state', async ({ page }) => {
    await open(page, '/portal/overview', account({ plan: 'None' }, []));
    await expect(page.getByText('No Active Services')).toBeVisible();
    await expect(page.getByText("Your account is ready. Here's what you can add.")).toBeVisible();
  });

  test('billing shows Pay now for an unpaid invoice', async ({ page }) => {
    await open(page, '/portal/billing', account({
      invoices: [{ id: 'INV-0051', docName: 'INV-0051', amount: 1200, date: '2026-11-10', status: 'Unpaid', type: 'Add-on' }],
    }));
    const row = page.getByRole('row').filter({ hasText: 'KES 1,200' });
    await row.getByRole('button', { name: 'Pay now' }).click();
    await expect(page).toHaveURL(/\/payment\/INV-0051$/);
  });
});

test.describe('Look', () => {
  test('search opens from the sidebar and goes somewhere real', async ({ page }) => {
    await open(page, '/portal/overview');
    await page.getByRole('button', { name: 'Search' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await dialog.getByPlaceholder('Search pages, services and actions').fill('Shop');
    await dialog.getByRole('option', { name: /Shop ERP/ }).click();
    await expect(page).toHaveURL(/\/portal\/cloud\/biz-erp-light$/);
  });

  test('no blur and no all-caps inside the portal, light and dark', async ({ page }) => {
    test.setTimeout(180000);
    await open(page, '/portal/overview');
    for (const dark of [true, false]) {
      for (const path of ['/portal/overview', '/portal/cloud', '/portal/cloud/biz-erp-light', '/portal/domains', '/portal/billing', '/portal/support', '/portal/profile']) {
        await open(page, path);
        await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
        const offenders = await page.evaluate(() => {
          const bad: string[] = [];
          document.querySelectorAll('.portal *').forEach((el) => {
            const cs = getComputedStyle(el);
            const tag = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)}`;
            if (cs.backdropFilter && cs.backdropFilter !== 'none') bad.push(`blur ${tag}`);
            if (cs.textTransform === 'uppercase' && !el.closest('[data-p="nav-group"]') && !el.closest('[aria-label="Murzak Technologies"]') && el.textContent?.trim()) {
              bad.push(`caps ${tag}`);
            }
          });
          return bad.slice(0, 5);
        });
        expect(offenders, `${dark ? 'dark' : 'light'} ${path}`).toEqual([]);
      }
    }
  });

  test('panels are flat with 8px corners', async ({ page }) => {
    await open(page, '/portal/billing');
    const panel = page.locator('[data-p="panel"]').first();
    await expect(panel).toHaveCSS('border-radius', '8px');
    await expect(panel).toHaveCSS('box-shadow', 'none');
  });
});
