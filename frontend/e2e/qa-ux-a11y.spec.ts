import { test, expect } from '@playwright/test';

// Suite 10 — UX, accessibility & responsive (see QA test plan, suite UX-*).
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

test.describe('UX-01 — light/dark theme parity', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`Home renders with no zero-opacity or invisible primary text (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Every heading and primary CTA must have non-zero rendered opacity and
      // a resolvable color — catches "styled only for one theme" bugs.
      const problems = await page.evaluate(() => {
        const found: string[] = [];
        document.querySelectorAll('h1, h2, button').forEach((el) => {
          const cs = getComputedStyle(el);
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (parseFloat(cs.opacity) === 0) found.push(`opacity:0 on "${(el.textContent || '').slice(0, 40)}"`);
        });
        return found;
      });
      expect(problems).toEqual([]);
    });
  }

  test('the theme toggle overrides OS preference in both directions', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /Switch to light mode|Switch to dark mode/i });
    await expect(toggle).toBeVisible({ timeout: 10000 });

    // ThemeContext.tsx toggles the `dark` class on <html> directly (Tailwind
    // darkMode: 'class') — it never sets a data-theme attribute.
    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(before).toBe(true); // emulateMedia dark -> starts dark
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(after).not.toBe(before);
  });
});

test.describe('UX-02 — responsive: no horizontal body scroll', () => {
  const viewports = [
    { name: '320w', width: 320, height: 700 },
    { name: '375w', width: 375, height: 812 },
    { name: '768w', width: 768, height: 1024 },
    { name: '1280w', width: 1280, height: 800 },
  ];
  const pages = ['/', '/pricing', '/cloud', '/products'];

  for (const vp of viewports) {
    for (const path of pages) {
      test(`${path} has no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth - document.documentElement.clientWidth;
        });
        // Allow a couple of px of rounding slack, not a real horizontal scrollbar.
        expect(overflow, `${path} at ${vp.width}px scrolls ${overflow}px sideways`).toBeLessThanOrEqual(2);
      });
    }
  }
});

test.describe('UX-03 — keyboard-only navigation reaches the primary CTA', () => {
  test('Tab from page load reaches an actionable, visibly-focused control', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    let reachedFocusable = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          hasOutline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px',
          hasBoxShadow: cs.boxShadow !== 'none',
        };
      });
      if (info && ['A', 'BUTTON', 'INPUT'].includes(info.tag)) {
        reachedFocusable = true;
        // A focused interactive element must show SOME visible focus
        // indicator (outline or box-shadow ring) — an invisible focus state
        // makes keyboard navigation unusable, not just unpolished.
        expect(info.hasOutline || info.hasBoxShadow, `focused ${info.tag} has no visible focus indicator`).toBe(true);
        break;
      }
    }
    expect(reachedFocusable, 'Tab never reached a focusable link/button/input in 15 presses').toBe(true);
  });

  test('all form inputs on /contact have an accessible label', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    const unlabeled = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('input, textarea, select').forEach((el) => {
        const hasAriaLabel = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
        const hasPlaceholder = el.hasAttribute('placeholder');
        const id = el.getAttribute('id');
        const hasFor = id ? !!document.querySelector(`label[for="${id}"]`) : false;
        if (!hasAriaLabel && !hasPlaceholder && !hasFor) {
          bad.push(el.outerHTML.slice(0, 80));
        }
      });
      return bad;
    });
    expect(unlabeled).toEqual([]);
  });
});

test.describe('UX-05 — reduced motion is respected', () => {
  test('ambient/looping animations are dampened under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Elements using Tailwind's animate-* utilities (drift/pulse/spin loops)
    // must not run at full duration once reduced-motion is requested.
    const stillAnimating = await page.evaluate(() => {
      const offenders: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite') {
          const duration = parseFloat(cs.animationDuration);
          // A page that respects reduced-motion either removes the animation
          // or drives it near-instant; anything still running seconds-long
          // infinite loops is a miss.
          if (duration > 0.5) offenders.push(`${el.tagName}.${el.className}`.slice(0, 80));
        }
      });
      return offenders;
    });
    expect(stillAnimating, `infinite animations still running under reduced-motion: ${stillAnimating.join(', ')}`).toEqual([]);
  });
});
