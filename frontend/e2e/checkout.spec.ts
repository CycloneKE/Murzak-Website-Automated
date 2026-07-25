import { test, expect } from '@playwright/test';

// Task 7 — unified checkout end-to-end coverage
// (docs/superpowers/plans/2026-07-23-unified-checkout-phase1.md).
//
// Covers: CloudLaunchModal -> POST /api/orders -> /checkout/:orderId ->
// PaymentMethods (frontend/src/pages/Checkout.tsx, frontend/src/components/
// CloudLaunchModal.tsx, frontend/src/components/PaymentMethods.tsx).
//
// These chain a full registration + launch (+ in test 1, a payment) before
// the assertions under test even start, which routinely exceeds Playwright's
// 30s default on firefox/webkit (see the same rationale comment in
// cloud-launch.spec.ts) — bump per-suite timeouts accordingly.

const SERVICE_ID = 'starter-web-hosting';
const SERVICE_NAME = 'Website Hosting (Starter)'; // frontend/src/config/serviceCatalog.ts
const MONTHLY_KES_TEXT = 'KES 1,200'; // pricing.monthlyKes: 1200, formatKes() -> `KES ${n.toLocaleString()}`

/**
 * Register a brand-new account straight from /login (switch to signup mode),
 * mirroring the pattern AUTH-06 in auth-guards.spec.ts already relies on.
 * A fresh account with nothing in its cart lands directly in /portal, which
 * is all this suite needs — it's a plain logged-in session, no plan/cart
 * baggage to interact with pricing/checkout-out-of-scope machinery.
 */
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_checkout_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`Checkout ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`Checkout ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing unified checkout');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('CHK-01 — happy path: launch, checkout, pay', () => {
  test.describe.configure({ timeout: 60_000 });

  test('login, launch Website Hosting (Starter) via Cloud, and complete payment', async ({ page }) => {
    await registerNewUser(page, 'happy');

    // Open the Cloud launch modal pre-focused on starter-web-hosting (same
    // ?launch= deep-link mechanism cloud-launch.spec.ts and
    // qa-checkout-launch.spec.ts LNCH-01 already exercise).
    await page.goto(`/cloud?launch=${SERVICE_ID}`);
    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });

    const [orderResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/orders')),
      launchBtn.click(),
    ]);
    expect(orderResp.status()).toBe(200);

    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });

    // Order summary: service name + monthly price, sourced from the order
    // the server created (CheckoutProps -> OrderView in Checkout.tsx), not
    // anything the client could have supplied.
    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(SERVICE_NAME)).toBeVisible();
    await expect(page.getByText(MONTHLY_KES_TEXT, { exact: false }).first()).toBeVisible();

    // Reservation countdown (Checkout.tsx: "We're holding your spot · MM:SS").
    await expect(page.getByText(/holding your spot/i)).toBeVisible();

    // Dev-only mock-pay rail (PaymentMethods.tsx, gated on import.meta.env.DEV
    // — only visible once /prepare-payment + the invoice GET have completed).
    const mockPayBtn = page.getByRole('button', { name: 'Dev: skip to mock payment success' });
    await expect(mockPayBtn).toBeVisible({ timeout: 15000 });
    await mockPayBtn.click();

    // NOTE on what we assert here vs. the plan brief's literal wording ("success
    // screen shows the post-purchase copy"): PaymentMethods.handleMockPay does
    // `setStep("success"); onSuccess(data.user);` with no await between them,
    // and Checkout's onSuccess prop (App.tsx's handlePaymentSuccess) calls
    // navigate("/portal/overview") synchronously inside that same call. Under
    // React 18/19 automatic batching all of those state updates (PaymentMethods'
    // local step, App's user, the router's location) land in ONE commit, so the
    // router already matches /portal/overview by the time anything paints —
    // the transient "Payment received" screen is never actually visible in a
    // real click-through (this matches every other spec in this repo, which
    // all assert the post-payment URL/portal state, never that transient copy,
    // after driving a real payment). Asserting the *guaranteed* outcome instead:
    // redirect to the portal, and the purchased service now listed there.
    await expect(page).toHaveURL(/\/portal\/overview/, { timeout: 15000 });
    await expect(page.locator('text=' + SERVICE_NAME).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('CHK-02 — deep link creates an order and renders its summary', () => {
  test.describe.configure({ timeout: 60_000 });

  test('/checkout/new?serviceId=starter-web-hosting redirects to /checkout/CHK-… with a real order summary', async ({ page }) => {
    await registerNewUser(page, 'deeplink');

    await page.goto(`/checkout/new?serviceId=${SERVICE_ID}`);
    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });

    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(SERVICE_NAME)).toBeVisible();
    await expect(page.getByText(MONTHLY_KES_TEXT, { exact: false }).first()).toBeVisible();
  });
});

test.describe('CHK-03 — checkout vocabulary guard: "plan" is banned from the checkout page itself', () => {
  test.describe.configure({ timeout: 60_000 });

  test('the rendered checkout content never says "plan" (site chrome outside it is exempt)', async ({ page }) => {
    await registerNewUser(page, 'vocab');

    await page.goto(`/checkout/new?serviceId=${SERVICE_ID}`);
    await expect(page).toHaveURL(/\/checkout\/CHK-/, { timeout: 15000 });

    // Scope to <main>, not <body>: App.tsx renders <Header>/<Footer> as
    // SIBLINGS of <main> (both outside it, see App.tsx's JSX — Header before
    // <main>, Footer after </main>), and they are NOT hidden on /checkout
    // routes (hideChrome only covers /portal, /login and /payment). Footer.tsx
    // legitimately uses "plan" wording for its own unrelated CTA ("Build a
    // Plan" / "Build a plan in two minutes" / "Build my plan"), so asserting
    // over the whole body would false-fail on copy this feature never touches.
    const mainContent = page.locator('main');

    // Sanity check first: this must be scoped to real, rendered checkout
    // content, not an empty/hidden container — otherwise the negative
    // assertion below would pass vacuously no matter what.
    await expect(mainContent.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(SERVICE_NAME)).toBeVisible();

    await expect(mainContent).not.toContainText(/\bplan\b/i);
  });
});

test.describe('CHK-04 — auth guard: logged-out deep link redirects to /login', () => {
  test.beforeEach(async ({ page }) => {
    // Mock /api/auth/me so the app exits booting immediately as logged-out,
    // matching auth-guards.spec.ts's pattern exactly.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
  });

  test('/checkout/new?serviceId=starter-web-hosting redirects to /login?returnTo=%2Fcheckout%2Fnew', async ({ page }) => {
    // RequireAuth (src/components/RequireAuth.tsx) redirects to
    // /login?returnTo=<pathname> (query string dropped) when user is null;
    // the /checkout/new route is wrapped in RequireAuth in App.tsx.
    await page.goto(`/checkout/new?serviceId=${SERVICE_ID}`);

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcheckout%2Fnew$/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });

  test('/checkout/:orderId redirects to /login?returnTo=%2Fcheckout%2FCHK-does-not-matter', async ({ page }) => {
    // Same guard on the second Checkout route (/checkout/:orderId) — included
    // since both routes independently wrap <Checkout /> in <RequireAuth /> in
    // App.tsx and a regression could drop the guard from just one of them.
    await page.goto('/checkout/CHK-does-not-matter');

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcheckout%2FCHK-does-not-matter$/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });
});
