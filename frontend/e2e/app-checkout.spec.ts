import { test, expect, type Page } from '@playwright/test';

// App checkout (docs/superpowers/plans/2026-10-09-app-checkout-phase1-2.md):
// /products/pos -> tier -> /get/pos -> inline account -> order -> /checkout
// -> /welcome. Runs against the local stack (MOCK_FRAPPE backend whose
// in-memory store persists between runs), so every test uses unique names.

test.describe.configure({ timeout: 90_000 });

const PASSWORD = 'TestPassword123!';

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// The CTA exists twice in the DOM (desktop aside `hidden lg:flex` and the
// phone sticky bar `lg:hidden`); only one is visible at any viewport.
const cta = (page: Page) => page.getByRole('button', { name: /Continue to payment/ }).filter({ visible: true });

/** Fill the shop name and wait for the live address check to accept it. */
async function enterShop(page: Page, name: string, slug: string) {
  await page.getByLabel('Shop name').fill(name);
  await expect(page.locator('#shop-address-status')).toContainText(`${slug}.pos.murzaktech.tech`, { timeout: 10_000 });
}

/** Sign up inline on /get/pos. */
async function signUp(page: Page, id: string) {
  await page.getByLabel('Your name').fill('E2E Shopowner');
  await page.getByLabel('Email', { exact: true }).fill(`e2e_pos_${id}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });
}

/** Full signed-out buyer path from /get/pos to /checkout/:orderId. Returns the order id. */
async function buyToCheckout(page: Page, id: string, serviceId = 'biz-pos-duka') {
  await page.goto(`/get/pos?service=${serviceId}&term=monthly`);
  await enterShop(page, `E2E Shop ${id}`, `e2e-shop-${id}`);
  await signUp(page, id);
  await expect(cta(page)).toBeEnabled({ timeout: 10_000 });
  await cta(page).click();
  await expect(page).toHaveURL(/\/checkout\/[^/?#]+$/, { timeout: 15_000 });
  return page.url().match(/\/checkout\/([^/?#]+)/)![1];
}

test('POS page shows the three tiers and the annual prices', async ({ page }) => {
  await page.goto('/products/pos');
  const plans = page.locator('#plans');
  await expect(plans.getByRole('heading', { name: 'Duka' })).toBeVisible();
  await expect(plans.getByRole('heading', { name: 'Biashara' })).toBeVisible();
  await expect(plans.getByRole('heading', { name: 'Chain' })).toBeVisible();
  await expect(plans.getByRole('button', { name: /Start with Duka/ })).toBeVisible();
  await expect(plans.getByRole('button', { name: /Start with Biashara/ })).toBeVisible();
  await expect(plans.getByRole('button', { name: /Start with Chain/ })).toBeVisible();
  await expect(plans).toContainText('KES 2,500');

  await plans.getByRole('radio', { name: /Annual/ }).click();
  await expect(plans.getByRole('radio', { name: /Annual/ })).toHaveAttribute('aria-checked', 'true');
  await expect(plans).toContainText('KES 24,000');
  await expect(plans).toContainText('KES 43,200');
  await expect(plans).toContainText('KES 81,600');
  await expect(plans).toContainText('/year');

  // Customers buy a product, not a "plan" (the site footer has its own copy, so scope to #plans).
  await expect(plans).not.toContainText(/\bplans?\b/i);
});

test('choosing a tier carries the tier and term into the shop set-up page', async ({ page }) => {
  await page.goto('/products/pos');
  const plans = page.locator('#plans');
  await plans.getByRole('radio', { name: /Annual/ }).click();
  await plans.getByRole('button', { name: /Start with Chain/ }).click();
  await expect(page).toHaveURL(/\/get\/pos\?service=biz-pos-chain&term=annual/);
  await expect(page.getByRole('heading', { name: 'Set up your shop' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Annual · save 20%/ })).toHaveAttribute('aria-checked', 'true');
  await expect(cta(page)).toContainText('KES 81,600');
});

test('signed-out buyer sets up a shop, signs up inline and reaches checkout', async ({ page }) => {
  const id = uniq();
  await page.goto('/products/pos');
  await page.locator('#plans').getByRole('button', { name: /Start with Duka/ }).click();
  await expect(page).toHaveURL(/\/get\/pos\?service=biz-pos-duka&term=monthly/);

  await enterShop(page, `E2E Duka ${id}`, `e2e-duka-${id}`);
  await expect(cta(page)).toContainText('KES 2,500');
  await expect(cta(page)).toBeDisabled(); // not signed in yet

  await signUp(page, id);

  await expect(cta(page)).toBeEnabled({ timeout: 10_000 });
  await cta(page).click();
  await expect(page).toHaveURL(/\/checkout\/[^/?#]+$/, { timeout: 15_000 });
  await expect(page.getByText('Murzak POS — Duka')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`E2E Duka ${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`e2e-duka-${id}.pos.murzaktech.tech`)).toBeVisible();
});

test('reserved address is refused and the order button stays disabled', async ({ page }) => {
  await page.goto('/get/pos?service=biz-pos-chain&term=monthly');
  await page.getByLabel('Shop name').fill('api');
  await expect(page.locator('#shop-address-status')).toContainText(/reserved/i, { timeout: 10_000 });
  await expect(cta(page)).toBeDisabled();
});

test('a taken address is reported with suggestions', async ({ page, browser }) => {
  const id = uniq();
  const slug = `e2e-shop-${id}`;

  // Buyer A reserves the address by creating an order.
  await buyToCheckout(page, id);

  // Buyer B: fresh context (no cookies), different account, same shop name.
  const ctx = await browser.newContext();
  try {
    const other = await ctx.newPage();
    await other.goto('/get/pos?service=biz-pos-duka&term=monthly');
    await other.getByLabel('Shop name').fill(`E2E Shop ${id}`);
    const status = other.locator('#shop-address-status');
    await expect(status).toContainText(`${slug}.pos.murzaktech.tech`, { timeout: 10_000 });
    await expect(status).toContainText(/taken/i);
    await expect(other.getByText('Try:')).toBeVisible();
    // At least one suggestion pill; picking it makes an available address.
    const suggestions = other.locator('span:has-text("Try:") ~ button');
    await expect(suggestions.first()).toBeVisible();
    await suggestions.first().click();
    await expect(status).not.toContainText(/taken/i, { timeout: 10_000 });
    await expect(status).toContainText('.pos.murzaktech.tech');
  } finally {
    await ctx.close();
  }
});

test('phone width: summary above the form, sticky action bar, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/get/pos?service=biz-pos-inventory&term=monthly');

  const order = page.getByText('Your order', { exact: true });
  const shopLabel = page.getByText('Shop name', { exact: true });
  await expect(order).toBeVisible();
  await expect(shopLabel).toBeVisible();
  const orderBox = (await order.boundingBox())!;
  const shopBox = (await shopLabel.boundingBox())!;
  expect(orderBox.y).toBeLessThan(shopBox.y);

  const bar = cta(page);
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(700);
  expect(box.y + box.height).toBeLessThanOrEqual(812);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the selected billing option on the tier cards is not white-on-white', async ({ page }) => {
    await page.goto('/products/pos');
    const selected = page.locator('#plans').getByRole('radio', { name: /Monthly/ });
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    const { bg, fg } = await selected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color };
    });
    expect(bg).not.toBe('rgb(255, 255, 255)');
    expect(bg).not.toBe(fg);
  });
});

test('after payment the buyer lands on the live shop-ready screen', async ({ page }) => {
  const id = uniq();
  const orderId = await buyToCheckout(page, id);

  // First purchase of a monthly service: the billing-term step comes first.
  // Wait for the order to load (the page is a spinner until then), then
  // confirm the term if the page asks for it.
  await expect(page.getByText('Murzak POS — Duka')).toBeVisible({ timeout: 15_000 });
  const confirmTerm = page.getByRole('button', { name: 'Continue to payment', exact: true });
  const mockPay = page.getByRole('button', { name: /Dev: skip to mock payment success/i });
  await expect(confirmTerm.or(mockPay)).toBeVisible({ timeout: 15_000 });
  if (await confirmTerm.isVisible()) await confirmTerm.click();

  // Dev-only rail (PaymentMethods.tsx, import.meta.env.DEV).
  await expect(mockPay).toBeVisible({ timeout: 15_000 });
  await mockPay.evaluate((el: HTMLElement) => el.click());

  await expect(page).toHaveURL(new RegExp(`/welcome/${orderId}$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Your shop is getting ready' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Creating your private Murzak POS')).toBeVisible();
});
