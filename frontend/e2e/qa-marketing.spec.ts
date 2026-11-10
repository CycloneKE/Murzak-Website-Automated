import { test, expect, Page } from '@playwright/test';

// Suite 1 — Marketing & content (see the QA test plan, suite MKT-*).
// Mock /api/auth/me so every page exits booting immediately as logged-out.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
  );
});

const MARKETING_PAGES = [
  '/', '/cloud', '/products', '/about', '/pricing', '/terms', '/privacy', '/sla',
  '/contact', '/login', '/test-request',
  '/products/pos', '/products/erp', '/products/crm', '/products/custom',
  '/for/retail', '/for/clinics', '/for/logistics', '/for/services',
];

/**
 * Relative-luminance contrast ratio (WCAG formula) between two "rgb(r,g,b)"
 * strings. Used to catch the exact class of bug this suite guards against:
 * text-slate-600/700 rendering near-invisible against the app's near-black
 * dark-mode surfaces (see murzaktech-byoa-app-hosting / dark-contrast fix).
 */
function contrastCheckScript() {
  // Tailwind 4 writes its palette as oklch() and its opacity utilities as
  // color-mix(), and getComputedStyle() returns those verbatim. rgb()/rgba()
  // strings are parsed directly (unchanged behaviour); anything else is handed
  // to the browser, via a 1x1 canvas, to be converted to sRGB.
  let colorCtx: CanvasRenderingContext2D | null = null;
  function parseRgb(str: string) {
    if (!str) return null;
    const m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
    if (!colorCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      colorCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!colorCtx) return null;
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = '#010203';
    colorCtx.fillStyle = str; // an unparseable value leaves the sentinel in place
    if (colorCtx.fillStyle === '#010203' && str.trim().toLowerCase() !== '#010203') return null;
    colorCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
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
      // Some hero / "GLOBAL BACKGROUND WRAPPER" sections paint their
      // background via SIBLING layers (a photo <img>, a gradient wash) that
      // sit absolutely-positioned beside the text rather than as an
      // ancestor's own background-color — a plain ancestor walk can't see
      // those at all and falls through to the page's <body> color instead,
      // which is wrong for a section that's genuinely (and deliberately)
      // dark regardless of site theme. Pages mark exactly those wrappers
      // with `data-bg-surface="dark"` (see Home/Products/About/
      // CustomSoftware) so this check can short-circuit to the real
      // rendered tone instead of misreading the unrelated body color.
      const marker = (node as HTMLElement).dataset?.bgSurface;
      if (marker === 'dark') return { r: 9, g: 12, b: 16 }; // matches html.dark body / bg-murzak-ink
      if (marker === 'light') return { r: 248, g: 250, b: 251 }; // matches body / bg-murzak-base
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

test.describe('MKT-01b — light-mode text contrast', () => {
  for (const path of MARKETING_PAGES) {
    test(`no near-invisible text on ${path} (light mode)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await assertNoInvisibleText(page, path);
    });
  }
});

test.describe('MKT-02 — Home makes no unbacked numeric claims', () => {
  test('no uptime/go-live stat band, and the page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    // The old stat band ("99.9% Uptime", "24/7 Monitoring") and the
    // "systems operational" pill were decoration, not measurements.
    await expect(page.locator('main').getByText('Uptime', { exact: true })).toHaveCount(0);
    await expect(page.locator('main').getByText('Monitoring', { exact: true })).toHaveCount(0);
    await expect(page.locator('text=systems operational')).toHaveCount(0);
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

  test('App hosting on /cloud opens the launch flow on that product', async ({ page }) => {
    await page.goto('/cloud');
    await page.getByTestId('cloud-offer-app').getByRole('button', { name: 'Launch' }).click();
    await expect(page.getByText('What do you want to launch?')).toBeVisible();
    await expect(page.getByText('App Hosting (Node.js / Docker)').first()).toBeVisible();
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

test.describe('MKT-03 — Home prices never contradict the Pricing page', () => {
  test('each product row on Home shows the same price as its row on /pricing', async ({ page }) => {
    // Both pages render from config/storefront.ts; this guards against either
    // one growing its own hand-typed price again.
    await page.goto('/');
    const homeRows = page.getByTestId('home-prices').locator('li');
    await expect(homeRows.first()).toBeVisible({ timeout: 10000 });
    const home = await homeRows.evaluateAll((els) => els.map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim()));
    expect(home.length).toBeGreaterThanOrEqual(8);
    for (const row of home) expect(row, `Home row "${row}" has no KES price`).toMatch(/KES\s?[\d,]+/);

    await page.goto('/pricing');
    await expect(page.getByTestId('price-row-pos')).toBeVisible({ timeout: 15000 });
    const pricingText = (await page.locator('#pricing-plans').innerText()).replace(/\s+/g, ' ');
    for (const row of home) {
      const price = row.match(/(from )?KES\s?[\d,]+\/(mo|yr)/)![0];
      expect(pricingText, `"${row}" is priced differently on /pricing`).toContain(price);
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

test.describe('MKT-10 — canonical + Open Graph URL match the actual route', () => {
  test('canonical link and og:url update on client-side navigation, not left on the homepage', async ({ page }) => {
    await page.goto('/');
    await page.goto('/cloud');
    await page.waitForLoadState('networkidle');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    const ogUrl = await page.evaluate(() => document.querySelector('meta[property="og:url"]')?.getAttribute('content'));
    expect(canonical).toBe('https://murzaktech.com/cloud');
    expect(ogUrl).toBe('https://murzaktech.com/cloud');
  });
});

test.describe('MKT-08 — hero background survives a slow network without breaking layout', () => {
  test('Home hero renders its headline and CTA even before background images finish loading', async ({ page }) => {
    // Delay only image/font requests so the hero background is slow, then
    // assert the above-the-fold content (headline, CTA) is visible well
    // before those requests resolve — the layout must not depend on the
    // hero background image arriving first. A CDP-wide throttle (delaying
    // *every* request, including the dev server's unbundled JS modules)
    // would also stall the page's own bootstrap and made this test time out
    // regardless of the hero layout's actual behavior.
    await page.route('**/*', async (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font') {
        await new Promise((r) => setTimeout(r, 5000));
      }
      await route.continue();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /See products and prices/i }).first()).toBeVisible({ timeout: 15000 });

    // No horizontal scrollbar introduced while images are still in flight.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
