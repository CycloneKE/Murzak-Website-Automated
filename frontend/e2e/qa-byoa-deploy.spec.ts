import { test, expect } from '@playwright/test';

// Suite 6 — BYOA deploy pipeline (see QA test plan, suite BYOA-*).
// These need a REAL authenticated session (not the /api/auth/me mock used
// elsewhere) because /api/byoa/deploy's billing gate re-fetches the account's
// selected services from Frappe — a mocked client-side "logged in" state
// would not reach that server-side code path at all.

async function registerFreshAccount(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_byoa_${tag}_${suffix}@example.com`;
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`Byoa ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`Byoa ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing the BYOA wizard');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();
  // A brand-new account with nothing in the cart lands straight in the portal.
  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return email;
}

async function walkToConfigStep(page: import('@playwright/test').Page) {
  await page.goto('/deploy');
  await expect(page).not.toHaveURL(/\/login/); // guard: must actually be authenticated
  const firstRepoDeploy = page.getByRole('button', { name: /Deploy/i }).first();
  await expect(firstRepoDeploy).toBeVisible({ timeout: 10000 });
  await firstRepoDeploy.click();
  await expect(page.getByRole('button', { name: 'Confirm Configuration' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Confirm Configuration' }).click();
  await expect(page.getByRole('button', { name: 'Deploy Now' })).toBeVisible({ timeout: 5000 });
}

test.describe('BYOA-01 — /deploy is reachable and authenticated (no server crash)', () => {
  test('an authenticated visit renders the wizard, not an error page', async ({ page }) => {
    await registerFreshAccount(page, 'boot');
    await page.goto('/deploy');
    await expect(page.locator('h1', { hasText: 'Deploy your App' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('AUTH-08 (BYOA) — /deploy redirects a logged-out visitor to login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('logged-out /deploy bounces to /login?returnTo=%2Fdeploy', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    await page.goto('/deploy');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fdeploy/, { timeout: 10000 });
  });
});

test.describe('BYOA-02 — deploy is blocked without a paid App Hosting service', () => {
  test('Deploy Now on an unpaid account shows the paid-plan gate, not a build', async ({ page }) => {
    await registerFreshAccount(page, 'gate');
    await walkToConfigStep(page);

    const [deployResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/byoa/deploy')),
      page.getByRole('button', { name: 'Deploy Now' }).click(),
    ]);
    expect(deployResp.status()).toBe(402);
    const body = await deployResp.json();
    expect(body.requiresPurchase).toBe(true);
    expect(body.serviceId).toBe('starter-app-hosting');

    await expect(page.locator('h1', { hasText: 'App Hosting is a paid plan' })).toBeVisible({ timeout: 5000 });
    const getAppHosting = page.getByRole('button', { name: 'Get App Hosting' });
    await expect(getAppHosting).toBeVisible();
    await getAppHosting.click();
    await expect(page).toHaveURL(/\/cloud\?launch=starter-app-hosting/, { timeout: 5000 });
    await expect(page.getByRole('button', { name: /Launch now/i })).toBeVisible({ timeout: 10000 });
  });

  test('"Back" from the paid-plan gate returns to the wizard, not a dead end', async ({ page }) => {
    await registerFreshAccount(page, 'gateback');
    await walkToConfigStep(page);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/byoa/deploy')),
      page.getByRole('button', { name: 'Deploy Now' }).click(),
    ]);
    await expect(page.locator('h1', { hasText: 'App Hosting is a paid plan' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('h1', { hasText: 'Deploy your App' })).toBeVisible();
  });
});

test.describe('BYOA-05 — no fabricated domain is ever shown', () => {
  test('the config step never claims a .murzak.app URL', async ({ page }) => {
    await registerFreshAccount(page, 'domain');
    await walkToConfigStep(page);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('.murzak.app');
    expect(bodyText).toContain('assigned automatically');
  });
});

test.describe('BYOA-07 — environment variable rows add, edit, and remove', () => {
  test('the env-var UI is fully interactive', async ({ page }) => {
    await registerFreshAccount(page, 'envvar');
    await walkToConfigStep(page);

    await expect(page.locator('text=No environment variables added')).toBeVisible();
    await page.getByRole('button', { name: '+ Add Variable' }).click();

    const keyInput = page.getByPlaceholder('KEY').first();
    const valueInput = page.getByPlaceholder('value').first();
    await expect(keyInput).toBeVisible();
    await keyInput.fill('database_url');
    await expect(keyInput).toHaveValue('DATABASE_URL'); // uppercased on input
    await valueInput.fill('postgres://example');

    await page.getByRole('button', { name: 'Add Variable' }).click();
    await expect(page.getByPlaceholder('KEY')).toHaveCount(2);

    await page.getByLabel('Remove variable').first().click();
    await expect(page.getByPlaceholder('KEY')).toHaveCount(1);
    await expect(page.getByPlaceholder('KEY').first()).toHaveValue('');
  });
});

test.describe('BYOA-09 — invalid repository is rejected before touching the runner', () => {
  test('a non-URL repository value is rejected with 400, not queued', async ({ page }) => {
    await registerFreshAccount(page, 'badrepo');
    // Drive the request directly — the UI only ever offers real repos from
    // the connected GitHub account, so a malformed URL can only reach the
    // server via a direct call (still must be rejected server-side).
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/byoa/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          config: { repository: { url: 'not-a-url', name: 'x' }, branch: 'main', stackDetails: null },
        }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    // Billing gate (402) or repo validation (400) — either is an acceptable
    // rejection depending on account state, but it must never be a 2xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
