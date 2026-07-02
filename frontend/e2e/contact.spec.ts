import { test, expect } from '@playwright/test';

// Mock /api/auth/me so the app exits booting immediately as a logged-out user.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('Contact Form Validation and Submission', () => {
  test('should display validation errors for empty fields', async ({ page }) => {
    await page.goto('/contact');

    // Wait for the contact form to be visible
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Click submit empty
    await page.getByRole('button', { name: 'Send message' }).click();

    // Verify validation errors
    await expect(page.locator('text=Your name is required')).toBeVisible();
    await expect(page.locator('text=Email is required')).toBeVisible();
    await expect(page.locator('text=Company name is required')).toBeVisible();
    await expect(page.locator('text=Please tell us how we can help')).toBeVisible();
  });

  test('should display validation error for invalid email', async ({ page }) => {
    await page.goto('/contact');

    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Fill fields with invalid email
    await page.locator('input[placeholder="Full name"]').fill('Jane Doe');
    await page.locator('input[placeholder="Company"]').fill('Test Business Ltd');
    await page.locator('input[placeholder="Work email"]').fill('invalidemail');
    await page.locator('textarea[placeholder="How can we help?"]').fill('I need help setting up an ERP system.');

    await page.getByRole('button', { name: 'Send message' }).click();

    // Check email error
    await expect(page.locator('text=Enter a valid email')).toBeVisible();
    // Name error should be gone
    await expect(page.locator('text=Your name is required')).not.toBeVisible();
  });

  test('should successfully submit form and show success message when inputs are valid', async ({ page }) => {
    // Mock both auth and the contact API endpoint
    await page.route('**/api/requests', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'MSG-TEST-999' }),
      });
    });

    await page.goto('/contact');

    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Fill valid data
    await page.locator('input[placeholder="Full name"]').fill('Jane Doe');
    await page.locator('input[placeholder="Company"]').fill('Test Business Ltd');
    await page.locator('input[placeholder="Work email"]').fill('jane@testbusiness.co.ke');
    await page.locator('textarea[placeholder="How can we help?"]').fill('We are looking for managed POS hosting.');

    // Submit
    await page.getByRole('button', { name: 'Send message' }).click();

    // Verify success view — h3 heading
    await expect(page.locator('h3', { hasText: 'Message received' })).toBeVisible();
    // Success message contains the ref id
    await expect(page.locator('text=ref MSG-TEST-999')).toBeVisible();
  });
});
