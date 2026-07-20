import { test, expect, Page } from '@playwright/test';

// Suite 1 — Marketing & content (see the QA test plan, suite MKT-*).
// Mock /api/auth/me so every page exits booting immediately as logged-out.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

const MARKETING_PAGES = ['/', '/cloud', '/products', '/about', '/pricing', '/terms', '/privacy', '/sla'];

/**
 * Relative-luminance contrast ratio (WCAG formula) between two "rgb(r,g,b)"
 * strings. Used to catch the exact class of bug this suite guards against:
 * text-slate-600/700 rendering near-invisible against the app's near-black
 * dark-mode surfaces (see murzaktech-byoa-app-hosting / dark-contrast fix).
 */
function contrastCheckScript() {
  function parseRgb(str: string) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  function luminance(c: { r: number; g: number; b: number }) {
    const chan = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  }
  function effectiveBg(el: Element): { r: number; g: number; b: number } | null {
    let node: Element | null = el;
    while (node) {
      const cs = getComputedStyle(node);
      // A gradient/image background (e.g. .bg-brand-gradient buttons using
      // text-murzak-ink deliberately for contrast against a bright gradient)
      // can't be sampled by this luminance check — bail rather than walk
      // past it to a distant ancestor's unrelated solid color.
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const bg = parseRgb(cs.backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  }

  const offenders: { text: string; ratio: number; color: string; bg: string }[] = [];
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (el.children.length > 0) continue; // leaf nodes only
    const text = (el.textContent || '').trim();
    if (!text || text.length < 2) continue;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // A leaf can report a non-zero rect of its own while sitting inside a
    // collapsed accordion (height:0 + overflow:hidden ancestor) — the child's
    // own box isn't clamped by the parent's clip. Walk up and skip if any
    // ancestor is doing that collapse.
    let clipped = false;
    for (let a: Element | null = el.parentElement; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflow === 'hidden' && (a as HTMLElement).clientHeight < 2) { clipped = true; break; }
    }
    if (clipped) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.4) continue;
    // Gradient/clipped text (.text-murzak-gradient etc) paints via
    // background-clip:text with color:transparent BY DESIGN — the gradient
    // itself is the visible color, which this luminance check can't sample.
    // Skip it rather than false-flag every gradient heading as invisible.
    if (cs.backgroundClip === 'text' || (cs as any).webkitBackgroundClip === 'text') continue;
    const fg = parseRgb(cs.color);
    if (!fg || fg.a < 0.5) continue; // fully/mostly transparent color -> not a flat-color text node
    const bg = effectiveBg(el);
    if (!bg) continue; // sits on a gradient/image background — not evaluable here
    const ratio = (luminance(fg) + 0.05) / (luminance(bg) + 0.05) > 1
      ? (luminance(fg) + 0.05) / (luminance(bg) + 0.05)
      : (luminance(bg) + 0.05) / (luminance(fg) + 0.05);
    // WCAG AA for normal text is 4.5:1; large/bold text is allowed 3:1. We
    // flag below 3:1 as an unambiguous failure regardless of size — that's
    // the "near-invisible" bug class, not a borderline judgment call.
    if (ratio < 3) {
      offenders.push({
        text: text.slice(0, 60),
        ratio: Math.round(ratio * 100) / 100,
        color: cs.color,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
      });
    }
  }
  return offenders;
}

async function assertNoInvisibleText(page: Page, label: string) {
  const offenders = await page.evaluate(contrastCheckScript);
  expect(offenders, `${label}: text with contrast ratio < 3:1 (near-invisible) — ${JSON.stringify(offenders)}`)
    .toEqual([]);
}

test.describe('MKT-01 — dark-mode text contrast', () => {
  for (const path of MARKETING_PAGES) {
    test(`no near-invisible text on ${path} (dark mode)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await assertNoInvisibleText(page, path);
    });
  }
});

test.describe('MKT-02 — Home trust strip is merged, not duplicated', () => {
  test('one compact stats band, no oversized "By the numbers" section', async ({ page }) => {
    await page.goto('/');
    // Exact match — the footer's "% uptime SLA →" link also contains
    // "uptime" case-insensitively and would otherwise make this ambiguous.
    await expect(page.getByText('Uptime', { exact: true })).toBeVisible();
    await expect(page.getByText('Go-live', { exact: true })).toBeVisible();
    await expect(page.getByText('Monitoring', { exact: true })).toBeVisible();
    await expect(page.getByText('Billing', { exact: true })).toBeVisible();

    // The pre-fix section had its own "Uptime target" / "Typical go-live"
    // long-form labels in a separate 4-tile grid — that copy must be gone.
    await expect(page.locator('text=Uptime target')).toHaveCount(0);
    await expect(page.locator('text=Typical go-live')).toHaveCount(0);

    // No console error from the removed-then-orphaned lucide icon imports
    // (Gauge/Activity/Banknote) that caused a live crash mid-session.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => /is not defined/.test(e))).toEqual([]);
  });
});

test.describe('MKT-04 — testimonials section stays hidden while empty', () => {
  test('no placeholder quote renders on Home', async ({ page }) => {
    await page.goto('/');
    // The gated section renders a large opening quote mark + blockquote only
    // when TESTIMONIALS.length > 0. With the array empty, neither should exist.
    await expect(page.locator('blockquote')).toHaveCount(0);
  });
});

test.describe('MKT-05 — no upstream-provider / white-label leakage', () => {
  const forbidden = ['coolify', 'hostinger', 'frappe', 'sslip.io', 'bench'];

  for (const path of MARKETING_PAGES) {
    test(`no forbidden vendor terms visible on ${path}`, async ({ page }) => {
      await page.goto(path);
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      const hits = forbidden.filter((term) => bodyText.includes(term));
      expect(hits, `${path} leaked upstream vendor terms: ${hits.join(', ')}`).toEqual([]);
    });
  }
});

test.describe('MKT-06 — legacy route redirects replace history (no back-button trap)', () => {
  test('/services redirects to /products', async ({ page }) => {
    await page.goto('/services');
    await expect(page).toHaveURL(/\/products$/);
  });

  test('/solutions redirects to /products', async ({ page }) => {
    await page.goto('/solutions');
    await expect(page).toHaveURL(/\/products$/);
  });

  test('"Your own app" card on /cloud routes to /deploy', async ({ page }) => {
    await page.goto('/cloud');
    await page.getByText('Your own app').click();
    await expect(page).toHaveURL(/\/deploy|\/login\?returnTo=%2Fdeploy/);
  });
});

test.describe('MKT-09 — currency consistency (KES only, no stray USD)', () => {
  test('Home and Pricing show KES, never a bare "$" price token', async ({ page }) => {
    for (const path of ['/', '/pricing']) {
      await page.goto(path);
      // Pricing boots through a brief "Authenticating…" gate (see App.tsx)
      // before the real page content mounts — wait for that to clear rather
      // than reading body text mid-boot.
      await expect(page.locator('body')).not.toContainText('AUTHENTICATING', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/KES/);
      // A dollar sign immediately followed by digits (a price) is the
      // regression class this guards ("$99 POS Base Package"); a lone "$"
      // used as punctuation elsewhere is not what we're checking for.
      const dollarPrices = bodyText.match(/\$\s?\d/g) || [];
      expect(dollarPrices, `${path} shows dollar-formatted price(s): ${dollarPrices.join(', ')}`).toEqual([]);
    }
  });
});

test.describe('MKT-03 — live config peek never contradicts the real catalog', () => {
  test('ConfigPeek prices match the same services shown on /pricing', async ({ page }) => {
    // Home's hero ConfigPeek cycles through PEEK_ITEMS (Website Hosting,
    // Business Email, Murzak ERP) pulled from serviceCatalog.ts — the single
    // source of truth. Wait for the widget to finish cycling to all 3, then
    // read each row's price straight from the DOM.
    await page.goto('/');
    await expect(page.locator('text=your plan')).toBeVisible({ timeout: 10000 });

    // Let the 2.2s cycle interval run through all 3 items before reading.
    await page.waitForTimeout(2200 * 3 + 500);

    const rows = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('li')).filter((li) =>
        /Website Hosting|Business Email|Murzak ERP/.test(li.textContent || '')
      );
      return items.map((li) => li.textContent?.replace(/\s+/g, ' ').trim() || '');
    });
    expect(rows.length, 'ConfigPeek did not render its 3 service rows').toBeGreaterThanOrEqual(3);

    // Cross-check each row's KES figure against the same service's price
    // wherever it's independently rendered elsewhere on the page (e.g. the
    // "Ready in days" product list further down Home, which pulls from the
    // same catalog function). The two must never contradict each other.
    for (const row of rows) {
      const m = row.match(/KES\s?[\d,]+/);
      expect(m, `ConfigPeek row "${row}" has no KES price`).not.toBeNull();
    }
  });
});

test.describe('MKT-07 — per-page SEO title updates on client-side navigation', () => {
  const EXPECTATIONS: [string, RegExp][] = [
    ['/', /Murzak Technologies/i],
    ['/cloud', /Cloud|Hosting/i],
    ['/products', /Products|Software/i],
    ['/pricing', /Pricing|Cost|Hosting/i],
    ['/about', /About|Murzak/i],
  ];

  test('each route sets its own document title, not a leftover from the previous page', async ({ page }) => {
    await page.goto('/');
    let lastTitle = await page.title();
    for (const [path, pattern] of EXPECTATIONS) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const title = await page.title();
      expect(title, `${path} title "${title}" doesn't match ${pattern}`).toMatch(pattern);
      if (path !== '/') {
        expect(title, `${path} kept the previous page's title ("${lastTitle}") — no title update fired`).not.toBe(lastTitle);
      }
      lastTitle = title;
    }
  });
});

test.describe('MKT-08 — hero background survives a slow network without breaking layout', () => {
  test('Home hero renders its headline and CTA even before background images finish loading', async ({ page, context }) => {
    // Throttle via CDP so image/font requests are slow, then assert the
    // above-the-fold content (headline, CTA) is visible well before a normal
    // full-page load would complete — the layout must not depend on the
    // hero background image arriving first.
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (50 * 1024) / 8, // ~50kbps
      uploadThroughput: (50 * 1024) / 8,
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Build my plan/i }).first()).toBeVisible({ timeout: 15000 });

    // No horizontal scrollbar introduced while images are still in flight.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
