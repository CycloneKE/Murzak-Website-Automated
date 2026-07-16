import { test, expect } from '@playwright/test';

// Mock /api/auth/me so the app doesn't hang in "Loading…" state.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('Navigation and Page Loading', () => {
  test('should load the homepage and check key elements', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/Murzak Technologies | Custom Software & Cloud Hosting Nairobi/);

    // Check main navigation items are present (desktop nav is xl:flex, ensure 1280+ viewport)
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Nav items use buttons; check all expected items exist somewhere in the header
    await expect(header.getByRole('button', { name: 'Home' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Murzak Cloud' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Products' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Pricing' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'About' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Talk to Sales' })).toBeVisible();

    // Verify presence of operational status indicator
    await expect(page.locator('text=Nairobi · systems operational')).toBeVisible();
  });

  test('should navigate to Murzak Cloud', async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'Murzak Cloud' }).click();
    await expect(page).toHaveURL(/\/cloud/);
    // Actual h1: "Hosting that just stays up."
    await expect(page.locator('h1')).toContainText(/Hosting that just/);
  });

  test('should navigate to Products', async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'Products' }).click();
    await expect(page).toHaveURL(/\/products/);
    // Actual h1 (post catalog-IA overhaul): "Software built for how Kenya works."
    await expect(page.locator('h1')).toContainText(/Software built for how Kenya works/);
  });

  test('should navigate to Pricing', async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing/);
    // Actual h1: "Pay for what you use. See it first."
    await expect(page.locator('h1')).toContainText(/Pay for what you use/);
  });

  test('should navigate to About', async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about/);
    // Actual h1: "We run the tech, so you can run your business."
    await expect(page.locator('h1')).toContainText(/We run the tech/);
  });

  test('should navigate to legal pages from footer links', async ({ page }) => {
    // Footer uses <button> elements (not <a> tags) via onNavigate
    await page.goto('/');

    // SLA — the footer also has a "% uptime SLA →" button whose accessible
    // name contains "SLA" as a substring, so this must match exactly.
    const footer = page.locator('footer');
    await footer.getByRole('button', { name: 'SLA', exact: true }).click();
    await expect(page).toHaveURL(/\/sla/);
    // Actual h1: "Reliability assurance."
    await expect(page.locator('h1')).toContainText(/Reliability/);

    // Terms of Service
    await page.goto('/');
    await page.locator('footer').getByRole('button', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/terms/);
    // Actual h1: "Service terms."
    await expect(page.locator('h1')).toContainText(/Service/);

    // Privacy Policy
    await page.goto('/');
    await page.locator('footer').getByRole('button', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy/);
    // Actual h1: "Privacy protocol."
    await expect(page.locator('h1')).toContainText(/Privacy/);
  });
});
