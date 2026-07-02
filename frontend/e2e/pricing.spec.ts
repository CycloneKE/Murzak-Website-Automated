import { test, expect } from '@playwright/test';

// Mock /api/auth/me so the app exits booting immediately as a logged-out user.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('Pricing Page & Configurator Calculator', () => {
  test('should open configurator and calculate totals correctly', async ({ page }) => {
    await page.goto('/pricing');

    // Wait for the pricing page hero to render (past skeleton loading)
    await expect(page.locator('h1')).toContainText(/Pay for what you use/, { timeout: 15000 });

    // Click the Starter-tier plan card's CTA. Plan cards are <article>
    // elements; the Starter plan's label is "Infrastructure Core" and its CTA
    // is "Configure infrastructure" (see PLAN_META.Starter in
    // frontend/src/config/serviceCatalog.ts) — the plan code "Starter" itself
    // never appears in the rendered card.
    const starterCard = page.locator('article').filter({ hasText: 'Infrastructure Core' }).first();
    await expect(starterCard).toBeVisible();
    await starterCard.getByRole('button', { name: /Configure infrastructure/i }).click();

    // Verify the configurator modal has opened
    await expect(page.locator('text=Configure your plan')).toBeVisible({ timeout: 5000 });

    // Service items are divs with the `group` class inside the modal's
    // service-list column. Scoped to that column (not just `.group`) because
    // the underlying Pricing page's plan <article> cards also carry Tailwind's
    // `group` class and stay mounted (covered, not removed) behind the modal
    // overlay — and `hasText` matches case-insensitively, so a plan card's
    // "Business email" feature bullet would otherwise collide with the
    // modal's "Business Email" service item.
    const serviceList = page.locator('.lg\\:col-span-8');

    // Locate the Website Hosting (Starter) service item
    const webHostingItem = serviceList.locator('.group').filter({ hasText: 'Website Hosting (Starter)' }).first();
    await expect(webHostingItem).toBeVisible();

    // Click the "Add" button for Website Hosting (Starter)
    await webHostingItem.getByRole('button', { name: 'Add' }).click();

    // Check that it now says "Added"
    await expect(webHostingItem.getByRole('button', { name: 'Added' })).toBeVisible();

    // Check that the summary sidebar shows the added service. The service
    // name now appears twice (main list + summary sidebar), so this must be
    // scoped to the sidebar to avoid a strict-mode multi-match error.
    await expect(page.locator('.lg\\:col-span-4').getByText('Website Hosting (Starter)').first()).toBeVisible();

    // Verify the monthly total shows KES 1,200. The brand wordmark and a few
    // other decorative spans also carry the text-murzak-gradient utility
    // class, so this must be scoped to the specific totals span (see
    // PlanServicesModal.tsx's "Monthly" row: text-2xl font-black
    // text-murzak-gradient).
    const totalMonthly = page.locator('span.text-2xl.font-black.text-murzak-gradient');
    await expect(totalMonthly).toHaveText('KES 1,200');

    // Add the "Business Email" service (KES 1,500/mo)
    const emailItem = serviceList.locator('.group').filter({ hasText: 'Business Email' }).first();
    await expect(emailItem).toBeVisible();
    await emailItem.getByRole('button', { name: 'Add' }).click();

    // Verify the updated monthly total: KES 1,200 + KES 1,500 = KES 2,700
    await expect(totalMonthly).toHaveText('KES 2,700');

    // Click "Continue to checkout" button
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible();
    await checkoutBtn.click();

    // Should redirect to login page (since user is unauthenticated)
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page.locator('h1')).toContainText(/Client Dashboard/);
  });
});
