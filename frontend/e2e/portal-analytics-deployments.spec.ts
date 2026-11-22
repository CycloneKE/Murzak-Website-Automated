import { test, expect, Page } from '@playwright/test';

// The two-pane deployment view and the Analytics section. The whole API is
// stubbed: what is proved here is what the portal asks for and how it renders
// each state, including the honest "not set up" and "no data" ones.

const SID = 'biz-erp-light';
const API = `**/api/portal/services/${SID}`;
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const DEPLOYMENTS = [
  { uuid: 'dep-aaaaaaaaaa', status: 'in_progress', result: 'pending', commit: '8cb9665', commitMessage: 'Merge PR 81', createdAt: iso(1), finishedAt: '' },
  { uuid: 'dep-bbbbbbbbbb', status: 'finished', result: 'success', commit: '61a5c63', commitMessage: 'Merge PR 74', createdAt: iso(60 * 24 * 7), finishedAt: iso(60 * 24 * 7 - 4) },
  { uuid: 'dep-cccccccccc', status: 'failed', result: 'failure', commit: '72f47e7', commitMessage: 'Merge PR 73', createdAt: iso(60 * 24 * 8), finishedAt: iso(60 * 24 * 8 - 3) },
];
const LOGS: Record<string, string> = {
  'dep-aaaaaaaaaa': 'Starting deployment\nPulling images',
  'dep-bbbbbbbbbb': 'Cloning repo\nBuild finished\nContainer healthy',
  'dep-cccccccccc': 'Cloning repo\nERROR: npm install failed',
};

const BREAK = (rows: [string, number, number][]) => rows.map(([name, requests, bytes]) => ({ name, requests, bytes }));
const timeline = Array.from({ length: 24 }, (_, i) => ({
  t: new Date(NOW - (23 - i) * 3600_000).toISOString(),
  requests: i === 17 ? 700 : i > 20 ? 300 : 40, visitors: 2, bytes: 1000, errorRate: 0.05, p95Ms: 800,
}));
const ANALYTICS = {
  ok: true, available: true, range: '24h', from: iso(1440), to: iso(0), partial: false,
  totals: { requests: 1460, uniqueVisitors: 2, bandwidthBytes: 6_480_000, errorRate: 0.0581, p95Ms: 814 },
  timeline,
  statusClasses: { '2xx': 1360, '3xx': 16, '4xx': 84, '5xx': 1, other: 0 },
  statusCodes: BREAK([['200', 1360, 6_450_000], ['401', 66, 2_760], ['404', 18, 16_580], ['304', 14, 0], ['302', 2, 10], ['501', 1, 0]]),
  topPaths: [
    { path: '/api/heartbeat', host: 'health.murzaktech.tech', requests: 98, clientErrors: 0, serverErrors: 0, errorRate: 0, bytes: 13_160, p95Ms: 69.3 },
    { path: '/api/performance', host: 'health.murzaktech.tech', requests: 82, clientErrors: 3, serverErrors: 0, errorRate: 0.037, bytes: 1_160_000, p95Ms: 2300 },
  ],
  devices: BREAK([['Desktop', 1200, 1], ['Mobile', 200, 1], ['Bot', 60, 1]]),
  browsers: BREAK([['Chrome', 1370, 4_890_000]]),
  referrers: BREAK([['trading.murzaktech.tech', 1360, 5_890_000]]),
  httpVersions: BREAK([['HTTP/1.1', 1460, 6_180_000]]),
  cacheStatuses: [],
  countries: [],
};

async function open(page: Page, section: string, analytics: unknown = ANALYTICS) {
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
  await page.route(`${API}/deployments`, (r) => r.fulfill(json({ ok: true, available: true, deployments: DEPLOYMENTS })));
  await page.route(`${API}/deployments/*`, (r) => {
    const uuid = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop() || '');
    const d = DEPLOYMENTS.find((x) => x.uuid === uuid);
    return r.fulfill(json({ ok: true, deployment: d, logs: LOGS[uuid] || '' }));
  });
  const seen: string[] = [];
  await page.route(`${API}/analytics?*`, (r) => {
    seen.push(new URL(r.request().url()).searchParams.get('range') || '');
    return r.fulfill(json(analytics));
  });
  await page.goto(`/portal/cloud/${SID}${section}`);
  await expect(page.locator('[data-p="sidenav"]')).toBeVisible({ timeout: 15000 });
  return seen;
}

test.describe('Two-pane deployments', () => {
  test('lists every build, opens the newest log first and switches on click', async ({ page }) => {
    await open(page, '/updates');
    const list = page.getByRole('list', { name: 'Deployments' });
    await expect(list.getByRole('button')).toHaveCount(3);
    const log = page.getByRole('log', { name: 'Log output' });
    await expect(log).toContainText('Pulling images');

    await list.getByRole('button', { name: /72f47e7/ }).click();
    await expect(log).toContainText('npm install failed');
    await expect(list.getByRole('button', { name: /72f47e7/ })).toHaveAttribute('aria-current', 'true');
  });

  test('states are labelled in words, not colour alone', async ({ page }) => {
    await open(page, '/updates');
    const list = page.getByRole('list', { name: 'Deployments' });
    await expect(list.getByText('In progress')).toBeVisible();
    await expect(list.getByText('Finished')).toBeVisible();
    await expect(list.getByText('Failed')).toBeVisible();
  });

  test('search narrows the history and says when nothing matches', async ({ page }) => {
    await open(page, '/updates');
    const list = page.getByRole('list', { name: 'Deployments' });
    await page.getByLabel('Search deployments').fill('PR 74');
    await expect(list.getByRole('button')).toHaveCount(1);
    await page.getByLabel('Search deployments').fill('zzz');
    await expect(page.getByText('No deployment matches that search.')).toBeVisible();
  });
});

test.describe('Analytics', () => {
  test('phone: analytics and deployments fit without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, '/analytics');
    await expect(page.getByText('Unique visitors')).toBeVisible();
    const fits = () => page.evaluate(() => {
      const main = document.getElementById('portal-scroll')!;
      return { doc: document.documentElement.scrollWidth, win: window.innerWidth, main: main.scrollWidth, mainClient: main.clientWidth };
    });
    const a = await fits();
    expect(a.doc, 'document').toBeLessThanOrEqual(a.win + 1);
    expect(a.main, 'scroll area').toBeLessThanOrEqual(a.mainClient + 1);
    await page.goto(`/portal/cloud/${SID}/updates`);
    await expect(page.getByRole('log', { name: 'Log output' })).toBeVisible();
    const d = await fits();
    expect(d.main, 'deployments scroll area').toBeLessThanOrEqual(d.mainClient + 1);
  });

  test('shows the headline numbers, charts and every breakdown', async ({ page }) => {
    const ranges = await open(page, '/analytics');
    await expect(page.getByText('1.46K', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('5.81%', { exact: true })).toBeVisible();
    await expect(page.getByText('814.0 ms', { exact: true })).toBeVisible();
    await expect(page.getByText('/api/heartbeat').first()).toBeVisible();
    for (const title of ['Requests', 'Status codes', 'Top paths', 'Locations', 'Requests by device type', 'Top HTTP versions', 'Top cache statuses', 'Top status codes', 'Referrers', 'Browsers']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expect(page.getByText('trading.murzaktech.tech')).toBeVisible();
    expect([...new Set(ranges)]).toEqual(['24h']);
  });

  test('empty panels say so instead of showing zeros; locations explain what is missing', async ({ page }) => {
    await open(page, '/analytics');
    await expect(page.getByText('No cache status data for the selected range.')).toBeVisible();
    await expect(page.getByText("Location data isn't enabled")).toBeVisible();
    await expect(page.getByText(/GeoLite2 data created by MaxMind/)).toHaveCount(0);
  });

  test('changing the range asks the API for that range', async ({ page }) => {
    const ranges = await open(page, '/analytics');
    await page.getByLabel('Time range').selectOption('7d');
    await expect.poll(() => ranges.at(-1)).toBe('7d');
  });

  test('MaxMind attribution appears once there is location data', async ({ page }) => {
    await open(page, '/analytics', { ...ANALYTICS, countries: BREAK([['Denmark', 2, 10]]) });
    await expect(page.getByText('Denmark')).toBeVisible();
    await expect(page.getByText(/GeoLite2 data created by MaxMind/)).toBeVisible();
  });

  test('not set up is reported as such, never as zero traffic', async ({ page }) => {
    await open(page, '/analytics', { ok: true, available: false, reason: 'not_configured', range: '24h' });
    await expect(page.getByText("Traffic analytics aren't switched on yet")).toBeVisible();
    await expect(page.getByText('Unique visitors')).toHaveCount(0);
  });

  test('a service with no domain is told to add one', async ({ page }) => {
    await open(page, '/analytics', { ok: true, available: false, reason: 'no_domains', range: '24h' });
    await expect(page.getByText('Add a domain to see traffic')).toBeVisible();
  });
});
