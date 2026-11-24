import { test, expect, Page } from '@playwright/test';

// Service-page sections backed by the platform API: Domains, Environment,
// Deployments (log viewer), Logs, Healthcheck, Backups. The whole API is
// stubbed, so the suite needs no backend and no Coolify. What it proves is the
// portal side: the right requests go out and the right states render.

const SID = 'biz-erp-light';
const API = `**/api/portal/services/${SID}`;

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Calls { bulk: string[]; removed: string[]; health: Record<string, unknown>[]; backupRequests: number }

async function open(page: Page, section = ''): Promise<Calls> {
  const calls: Calls = { bulk: [], removed: [], health: [], backupRequests: 0 };

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

  await page.route(`${API}/deployments`, (r) =>
    r.fulfill(json({ ok: true, available: true, deployments: [{ uuid: 'dep-1111111111', status: 'finished', result: 'success', commit: 'abc1234', commitMessage: 'Fix header', createdAt: '2026-11-16' }] })));
  await page.route(`${API}/deployments/dep-1111111111`, (r) =>
    r.fulfill(json({ ok: true, deployment: { uuid: 'dep-1111111111' }, logs: 'Cloning repo\n\u001b[32mBuild started\u001b[0m\nDone: Build finished\nContainer healthy' })));

  await page.route(`${API}/envs`, (r) =>
    r.fulfill(json({
      ok: true,
      envs: [
        { uuid: 'e1', key: 'API_URL', value: 'https://api.example.com', isBuildTime: false, isLiteral: false, isMultiline: false, isShownOnce: false, redacted: false },
        { uuid: 'e2', key: 'STRIPE_SECRET', value: null, isBuildTime: false, isLiteral: false, isMultiline: false, isShownOnce: true, redacted: true },
      ],
    })));
  await page.route(`${API}/envs/bulk`, (r) => {
    calls.bulk.push(JSON.parse(r.request().postData() || '{}').text);
    return r.fulfill(json({ ok: true, count: 2, message: '2 variables saved. Restart the service to apply them.' }));
  });
  await page.route(`${API}/logs?*`, (r) => r.fulfill(json({ ok: true, lines: 200, logs: 'listening on 3001\nGET /health 200\nGET /health 200' })));

  await page.route(`${API}/domains`, (r) =>
    r.fulfill(json({
      ok: true, serverIp: '203.0.113.9', forceHttps: true,
      domains: [
        { host: 'shop.murzaktech.tech', scheme: 'https', system: true },
        { host: 'shop.wanjiru.co.ke', scheme: 'https', system: false },
      ],
    })));
  await page.route(`${API}/domains/*`, (r) => {
    calls.removed.push(decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop() || ''));
    return r.fulfill(json({ ok: true, message: 'shop.wanjiru.co.ke removed.' }));
  });

  await page.route(`${API}/healthcheck`, (r) => {
    if (r.request().method() === 'PUT') {
      calls.health.push(JSON.parse(r.request().postData() || '{}'));
      return r.fulfill(json({ ok: true, message: 'Healthcheck saved. It applies on the next restart.' }));
    }
    return r.fulfill(json({
      ok: true,
      healthcheck: { enabled: true, path: '/up', method: 'GET', scheme: 'http', port: null, returnCode: 200, intervalSeconds: 30, timeoutSeconds: 5, retries: 3, startPeriodSeconds: 5 },
    }));
  });

  await page.route(`${API}/backups`, (r) => r.fulfill(json({ ok: true, supported: false, schedules: [] })));
  await page.route('**/api/portal/requests', (r) => {
    if (r.request().method() === 'POST') calls.backupRequests += 1;
    return r.fulfill(json({ ok: true }));
  });

  await page.goto(`/portal/cloud/${SID}${section}`);
  await expect(page.locator('[data-p="sidenav"]')).toBeVisible({ timeout: 15000 });
  return calls;
}

test.describe('Service settings sections', () => {
  test('the section menu lists every section for a deployable app', async ({ page }) => {
    await open(page);
    const nav = page.getByRole('navigation', { name: /Shop ERP sections/ });
    for (const label of ['General', 'Domains', 'Environment', 'Deployments', 'Logs', 'Healthcheck', 'Analytics', 'Terminal', 'Backups', 'Advanced', 'Danger zone']) {
      await expect(nav.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('environment: table hides secrets, Developer view round-trips as text', async ({ page }) => {
    const calls = await open(page, '/environment');
    await expect(page.getByText('API_URL', { exact: true })).toBeVisible();
    await expect(page.getByText('hidden', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Show STRIPE_SECRET')).toHaveCount(0);

    await page.getByRole('button', { name: 'Developer view' }).click();
    const editor = page.getByLabel('Environment variables as text');
    await expect(editor).toHaveValue('API_URL=https://api.example.com');
    await expect(page.getByText(/1 hidden value is not shown/)).toBeVisible();

    await editor.fill('API_URL=https://api.example.com\nNEW_FLAG=on');
    await page.getByRole('button', { name: 'Save all' }).click();
    await expect(page.getByText(/Saved, but not live yet/)).toBeVisible();
    expect(calls.bulk).toEqual(['API_URL=https://api.example.com\nNEW_FLAG=on']);
  });

  test('environment: search filters the table', async ({ page }) => {
    await open(page, '/environment');
    await page.getByLabel('Search variables').fill('stripe');
    await expect(page.getByText('API_URL', { exact: true })).toHaveCount(0);
    await expect(page.getByText('STRIPE_SECRET', { exact: true })).toBeVisible();
  });

  test('domains: built-in address is protected, a custom one is removed after confirmation', async ({ page }) => {
    const calls = await open(page, '/address');
    await expect(page.getByText('Built in')).toBeVisible();
    await expect(page.getByLabel('Remove shop.murzaktech.tech')).toHaveCount(0);
    await expect(page.getByText(/pointing the domain at 203\.0\.113\.9/)).toBeVisible();

    await page.getByLabel('Remove shop.wanjiru.co.ke').click();
    await expect(page.getByRole('dialog')).toContainText('stop answering on this name');
    await page.getByRole('button', { name: 'Remove domain' }).click();
    await expect.poll(() => calls.removed).toEqual(['shop.wanjiru.co.ke']);
  });

  test('deployment log: ANSI stripped, find highlights matches', async ({ page }) => {
    await open(page, '/updates');
    // The newest build is selected on arrival, so its log is already showing.
    const log = page.getByRole('log', { name: 'Log output' });
    await expect(log).toContainText('Build started');
    await expect(log).not.toContainText('[32m');

    await page.getByLabel('Find in logs').fill('build');
    await expect(page.getByText('2 matches')).toBeVisible();
  });

  test('runtime logs load and can be searched', async ({ page }) => {
    await open(page, '/logs');
    const log = page.getByRole('log', { name: 'Log output' });
    await expect(log).toContainText('listening on 3001');
    await page.getByLabel('Find in logs').fill('health');
    await expect(page.getByText('2 matches')).toBeVisible();
  });

  test('healthcheck loads current values and saves only what the form holds', async ({ page }) => {
    const calls = await open(page, '/health');
    await expect(page.getByLabel('Path')).toHaveValue('/up');
    await page.getByLabel('Check every (seconds)').fill('15');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/applies on the next restart/)).toBeVisible();
    expect(calls.health).toHaveLength(1);
    expect(calls.health[0]).toMatchObject({ enabled: true, path: '/up', intervalSeconds: 15 });
    expect(calls.health[0]).not.toHaveProperty('port');
  });

  test('backups: says plainly it is not self-service and sends a request', async ({ page }) => {
    const calls = await open(page, '/backups');
    await expect(page.getByText(/can't show your backup history here yet/)).toBeVisible();
    await page.getByRole('button', { name: 'Request a backup schedule' }).click();
    await expect(page.getByText('Request sent')).toBeVisible();
    expect(calls.backupRequests).toBe(1);
  });

  test('phone: sections render without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const s of ['/environment', '/address', '/health']) {
      await open(page, s);
      const ok = await page.evaluate(() => {
        const main = document.getElementById('portal-scroll')!;
        return document.documentElement.scrollWidth <= window.innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1;
      });
      expect(ok, `no sideways scroll on ${s}`).toBe(true);
      await page.unroute('**/api/**');
    }
  });
});
