import { test, expect } from '@playwright/test';

// Mock /api/auth/me so the app exits booting immediately as a logged-out user.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('Authentication Guards and Form Validation', () => {
  test('should redirect unauthenticated users from /portal to login', async ({ page }) => {
    // RequireAuth (src/components/RequireAuth.tsx) redirects to
    // /login?returnTo=<original path> when user is null.
    await page.goto('/portal/overview');

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fportal%2Foverview$/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });

  test('should display validation errors on empty login submission', async ({ page }) => {
    await page.goto('/login');

    // Wait for the login form to be rendered (not Loading…)
    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // Click submit without filling anything
    await page.getByRole('button', { name: 'Open My Portal' }).click();

    // Verify error messages
    await expect(page.locator('text=Email is required')).toBeVisible();
    await expect(page.locator('text=Password is required')).toBeVisible();
  });

  test('should display validation error for invalid email format', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // Input invalid email and password
    await page.locator('input[type="email"]').fill('invalidemail');
    await page.locator('input[type="password"]').fill('123456');

    await page.getByRole('button', { name: 'Open My Portal' }).click();

    await expect(page.locator('text=Invalid email format')).toBeVisible();
    await expect(page.locator('text=Email is required')).not.toBeVisible();
  });

  test('should toggle between login and signup modes', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });

    // The toggle button sits below the form (not inside the header)
    // Text: "Need a New Account? Get Started"
    await page.getByRole('button', { name: 'Need a New Account? Get Started' }).click();

    // Verify title and signup-specific fields appear
    await expect(page.locator('h1')).toContainText(/Account Setup/);
    await expect(page.locator('text=Full Name')).toBeVisible();
    await expect(page.locator('text=Business Name')).toBeVisible();
    await expect(page.locator('text=What is the goal of this project?')).toBeVisible();
    await expect(page.locator('text=Authorization required to proceed')).toBeVisible();

    // Click "Already Have an Account? Log In" to return to login mode
    await page.getByRole('button', { name: 'Already Have an Account? Log In' }).click();
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });
});
