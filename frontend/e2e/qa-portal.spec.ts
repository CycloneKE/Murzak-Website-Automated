import { test, expect, Browser } from '@playwright/test';

// Suite 7 — Customer portal (see QA test plan, suite PORT-*).
// NOTE: if any test below fails landing on /portal/admin instead of /login,
// check backend/.env for DEV_AUTO_LOGIN=true — see the same caveat in
// customer-journey.spec.ts. That flag auto-authenticates every request as a
// fixed dev Admin session, so the logged-out registration gate these tests
// depend on never triggers. CI has no .env, so this doesn't affect CI runs.

async function registerAndPay(browser: Browser, tag: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_portal_${tag}_${suffix}@example.com`;

  await page.goto('/pricing?configure=biz-pos-inventory');
  const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
  await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
  const domainInput = page.locator('input[placeholder="myshop"]');
  if (await domainInput.isVisible()) await domainInput.fill(`portal${tag}${suffix}`);
  await checkoutBtn.click();

  await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`Portal ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`Portal ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing portal scoping');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/payment\/.+/, { timeout: 15000 });
  const invoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
  await page.evaluate(async (invId) => {
    await fetch('/api/paypal/capture-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
    });
  }, invoiceId);

  return { context, page, email, invoiceId };
}

test.describe('PORT-01 / SEC-02 — invoice download is scoped to the owner only (IDOR)', () => {
  test('account B cannot download account A\'s invoice PDF by guessing its docName', async ({ browser }) => {
    const a = await registerAndPay(browser, 'a');
    const b = await registerAndPay(browser, 'b');

    expect(a.invoiceId).toBeTruthy();

    // Account A can download its own invoice.
    const ownRes = await a.page.evaluate(async (id) => {
      const r = await fetch(`/api/invoices/${id}/download`, { credentials: 'include' });
      return { status: r.status, contentType: r.headers.get('content-type') || '' };
    }, a.invoiceId);
    expect(ownRes.status).toBe(200);

    // Account B requesting A's invoice docName must NOT get the PDF.
    const crossRes = await b.page.evaluate(async (id) => {
      const r = await fetch(`/api/invoices/${id}/download`, { credentials: 'include' });
      return { status: r.status, contentType: r.headers.get('content-type') || '' };
    }, a.invoiceId);
    expect(crossRes.status).toBe(404); // masked as "not found", not a 403 that confirms existence
    expect(crossRes.contentType).not.toContain('application/pdf');

    await a.context.close();
    await b.context.close();
  });

  test('account B cannot read account A\'s invoice via GET /api/billing/invoice/:docName', async ({ browser }) => {
    const a = await registerAndPay(browser, 'c');
    const b = await registerAndPay(browser, 'd');

    const crossRes = await b.page.evaluate(async (id) => {
      const r = await fetch(`/api/billing/invoice/${id}`, { credentials: 'include' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, a.invoiceId);
    expect(crossRes.status).toBe(403);
    expect(crossRes.body?.error).toMatch(/not yours/i);

    await a.context.close();
    await b.context.close();
  });
});

test.describe('PORT-05 — project repository field validates before saving', () => {
  test('rejects a non-URL value and an over-length value, accepts a valid one', async ({ browser }) => {
    const { page, context } = await registerAndPay(browser, 'repo');

    const bad = await page.evaluate(async () => {
      const r = await fetch('/api/portal/account/repo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoUrl: 'not-a-url' }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    expect(bad.status).toBe(400);

    const tooLong = await page.evaluate(async () => {
      const r = await fetch('/api/portal/account/repo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoUrl: 'https://github.com/x/' + 'a'.repeat(500) }),
      });
      return { status: r.status };
    });
    expect(tooLong.status).toBe(400);

    const good = await page.evaluate(async () => {
      const r = await fetch('/api/portal/account/repo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoUrl: 'https://github.com/qa/example#staging' }),
      });
      return { status: r.status };
    });
    expect(good.status).toBe(200);

    await context.close();
  });

  test('rejects an out-of-range app port', async ({ browser }) => {
    const { page, context } = await registerAndPay(browser, 'port');
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/portal/account/repo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ repoUrl: 'https://github.com/qa/example', appPort: 99999 }),
      });
      return { status: r.status };
    });
    expect(res.status).toBe(400);
    await context.close();
  });
});

test.describe('PORT-06 — empty-state dashboard for a brand-new account', () => {
  test('a fresh account sees an honest, legible empty state (no phantom services)', async ({ page }) => {
    const suffix = Math.floor(Math.random() * 100000);
    const email = `test_portal_empty_${suffix}@example.com`;

    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Empty State Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Empty State Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing empty portal state');
    await page.getByPlaceholder('sam@company.co.ke').fill(email);
    await page.getByPlaceholder('••••••••').fill('TestPassword123!');
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
    await expect(page.locator('text=No Active Services')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=You don't have any infrastructure running yet.")).toBeVisible();

    // The dark-mode contrast fix applies here too — this label used to render
    // as text-slate-600 with no dark: override.
    const color = await page.locator('text=No Active Services').evaluate((el) => getComputedStyle(el).color);
    const m = color.match(/rgba?\(([^)]+)\)/);
    const [r, g, b] = (m ? m[1] : '0,0,0').split(',').map((v) => parseFloat(v));
    // slate-600 (#475569 ~ rgb(71,85,105)) is what the bug looked like; the
    // fixed dark: override is slate-400 (~rgb(148,163,184)) or lighter.
    expect(r + g + b, `label color ${color} looks like the pre-fix too-dark slate-600`).toBeGreaterThan(200);
  });
});
