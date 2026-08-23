# Security & SEO Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed open-redirect and CSP gaps, and complete the
site's structured-data/canonical/OG metadata — all grounded in specific
findings from `docs/superpowers/specs/2026-08-23-site-polish-visual-copy-design.md`
Parts D and E.

**Architecture:** Small, independent fixes layered onto existing
mechanisms (the `pageMetadata` map + effect already in `App.tsx`, the
`helmet` CSP config already in `backend/server.js`, the JSON-LD pattern
already proven in `Breadcrumbs.tsx`) — nothing here introduces a parallel
system where one already exists.

**Tech Stack:** React 19 + TypeScript (frontend), Express + helmet
(backend), Playwright (e2e verification).

## Global Constraints

- Domain for all URLs (canonical, OG, sitemap): `https://murzaktech.com`
  — confirmed NXDOMAIN today, kept anyway per explicit user decision (spec
  D0). This work is correct but inert until DNS is restored separately.
- No new npm dependencies unless a task says otherwise (react-helmet-async
  is deliberately not used — the existing `pageMetadata` mechanism covers
  the need).
- Every JSON-LD block must escape `<` the same way `Breadcrumbs.tsx`
  already does (`JSON.stringify(obj).replace(/</g, '\\u003c')`) — extracted
  in Task 5 into a shared util so this isn't reimplemented per-component.
- Reuse `backend/test/qaSecurity.test.js`'s live-probe pattern for any new
  security-header assertions; reuse `frontend/e2e/qa-marketing.spec.ts`'s
  `test.describe('MKT-0N — ...')` naming convention for any new e2e checks.

---

### Task 1: Pin `frontend/index.html` to LF line endings

**Why first:** Task 2 computes a CSP hash over this file's inline script.
The file is currently CRLF (confirmed by direct inspection). A hash
computed against CRLF bytes would silently break the moment the file is
checked out with different line endings (e.g. a Linux CI runner with
`core.autocrlf=input`) — the exact failure mode the repo's existing
`.gitattributes` already guards against for `deploy/vps/*`.

**Files:**
- Modify: `.gitattributes`
- Modify: `frontend/index.html` (line-ending normalization only, no
  content change)

- [ ] **Step 1: Add the LF rule**

Add to `.gitattributes` (append after the existing `deploy/vps/*` block):

```gitattributes
# CSP script-src uses a SHA-256 hash of this file's inline theme-flash
# script (backend/server.js) — a CRLF/LF mismatch on checkout would change
# the hash and silently break the CSP without any error, only a returning
# light-mode flash. Pin LF so the hash stays stable across platforms.
frontend/index.html   text eol=lf
```

- [ ] **Step 2: Renormalize the working copy**

```bash
git add --renormalize frontend/index.html
```

Expected: `git status` shows `frontend/index.html` modified (line endings
only — `git diff` should show no content changes, only whitespace/EOL if
your diff tool is configured to show them).

- [ ] **Step 3: Verify the file is now LF**

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('frontend/index.html','utf8'); console.log(s.includes('\r\n') ? 'STILL HAS CRLF' : 'LF CONFIRMED');"
```

Expected: `LF CONFIRMED`

- [ ] **Step 4: Commit**

```bash
git add .gitattributes frontend/index.html
git commit -m "chore: pin frontend/index.html to LF for CSP hash stability"
```

---

### Task 2: Tighten CSP `script-src` to a hash allowlist

**Interfaces:**
- Consumes: `frontend/index.html`'s inline theme-flash script, unchanged
  in content from Task 1 (LF-normalized only).
- Produces: `script-src` in `backend/server.js` no longer contains
  `'unsafe-inline'`.

**Files:**
- Modify: `backend/server.js:130-151` (the `helmet(...)` CSP config)
- Test: `backend/test/qaSecurity.test.js` (extend SEC-01)

- [ ] **Step 1: Recompute the hash against the now-LF-normalized file**

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const hash = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
console.log('sha256-' + hash);
"
```

Expected output: `sha256-dpTy0EKZWTHrwaIaZzDQ44We5+7zjDc93mf2g9HGb1E=`
(this is the value computed against the LF-normalized script during
planning — Step 1 re-derives it live so the task doesn't silently drift if
`index.html` changes before this task runs).

- [ ] **Step 2: Update the CSP directive**

In `backend/server.js`, replace:

```js
        "script-src": ["'self'", "'unsafe-inline'", "https://esm.sh", "https://*.paypal.com", "https://*.paypalobjects.com", "https://www.googletagmanager.com", "https://apis.google.com"],
```

with:

```js
        "script-src": ["'self'", "'sha256-dpTy0EKZWTHrwaIaZzDQ44We5+7zjDc93mf2g9HGb1E='", "https://esm.sh", "https://*.paypal.com", "https://*.paypalobjects.com", "https://www.googletagmanager.com", "https://apis.google.com"],
```

Also update the comment above the `helmet(...)` call (currently says
`'unsafe-inline' is required for Tailwind's injected styles` — true for
`style-src`, but was also covering `script-src` by implication):

```js
// Security headers (HSTS, X-Frame-Options, nosniff, referrer-policy, etc.) plus a
// tailored CSP. Origins pinned: self for the bundled SPA, PayPal for checkout,
// esm.sh for the importmap, unsplash for a few marketing images, data/blob for
// inline assets. style-src keeps 'unsafe-inline' for Tailwind's injected styles.
// script-src uses a SHA-256 hash instead of 'unsafe-inline' — scoped to the one
// static inline script in index.html (theme-flash prevention). If that script's
// content ever changes, recompute the hash (see Task 2 of the security-seo plan)
// or the page will silently lose dark-mode-flash prevention with no error.
// NOTE: verify PayPal checkout + image loading after deploy; tweak origins here.
```

- [ ] **Step 3: Extend the SEC-01 live-probe test**

In `backend/test/qaSecurity.test.js`, inside the `SEC-01` section (after
the existing `ok(!!h("content-security-policy"), ...)` checks), add:

```js
    ok(!(h("content-security-policy") || "").includes("script-src 'self' 'unsafe-inline'"), "CSP script-src no longer allows blanket unsafe-inline");
    ok((h("content-security-policy") || "").includes("'sha256-"), "CSP script-src uses a hash allowlist");
```

- [ ] **Step 4: Run the live probe against a local server**

```bash
cd backend && npm start &
sleep 2
BASE_URL=http://localhost:3001 node test/qaSecurity.test.js
```

Expected: all SEC-01 checks report `ok`, 0 `FAIL`.

- [ ] **Step 5: Behavioral check — the actual thing that breaks if the hash is wrong**

With the backend still running, open the app in a browser with dark mode
preferred (OS-level or `prefers-color-scheme: dark` emulation) and hard
reload. Confirm there is **no light-mode flash** before dark styling
applies — check `document.documentElement.classList` contains `dark`
immediately on load, and check the browser console for a CSP violation
report (`Refused to execute inline script...`) — its absence is the real
proof the hash matches.

- [ ] **Step 6: Commit**

```bash
git add backend/server.js backend/test/qaSecurity.test.js
git commit -m "fix: replace CSP script-src 'unsafe-inline' with a scoped hash allowlist"
```

---

### Task 3: Patch the react-router-dom open-redirect CVE

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (via
  `npm audit fix`)

- [ ] **Step 1: Confirm the current vulnerability**

```bash
cd frontend && npm audit --omit=dev
```

Expected: reports 2 moderate vulnerabilities in `react-router`/
`react-router-dom`, including "Open redirect via backslash in `<Link>` and
`useNavigate`".

- [ ] **Step 2: Apply the fix**

```bash
cd frontend && npm audit fix
```

- [ ] **Step 3: Verify clean**

```bash
cd frontend && npm audit --omit=dev
```

Expected: `found 0 vulnerabilities`

- [ ] **Step 4: Quick adjacent check on the backend (per spec E3 — audit only, not a remediation pass)**

```bash
cd backend && npm audit --omit=dev
```

Record the result in the commit message or a follow-up note if it's
non-zero — no fix required here, this is scoped to frontend per the spec;
a non-clean backend result becomes its own follow-up task, not silently
absorbed into this one.

- [ ] **Step 5: Confirm the app still builds and the dev server still boots**

```bash
cd frontend && node node_modules/vite/bin/vite.js build
```

Expected: build succeeds with no new TypeScript/module-resolution errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "fix: patch react-router-dom open-redirect CVE via npm audit fix"
```

---

### Task 4: Validate `returnTo` before it reaches `navigate()`

**Interfaces:**
- Produces: `safeReturnTo(path, fallback): string` in
  `frontend/src/utils/safeReturnTo.ts`, used by `App.tsx`'s `handleLogin`.

**Files:**
- Create: `frontend/src/utils/safeReturnTo.ts`
- Modify: `frontend/src/App.tsx:270-275` (`handleLogin`)
- Test: `frontend/e2e/auth-guards.spec.ts` (existing file — add a case)

**Why this is the right choke point:** `Login.tsx` reads `returnTo` from
the URL query string at 3 separate call sites (`onLogin(data.user,
returnTo)` after login, signup, and password-reset-then-login) and passes
it to `App.tsx`'s `handleLogin`, which is the single place that actually
calls `navigate()`. Fixing it there covers all 3 call sites without
touching `Login.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/e2e/auth-guards.spec.ts`:

```ts
test.describe('SEC — returnTo cannot redirect off-site after login', () => {
  test('a protocol-relative returnTo falls back to the safe default', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'u1', email: 'dev@example.com', accountStatus: 'Active' } }),
      })
    );
    await page.goto('/login?returnTo=//evil.example.com');
    await page.getByLabel(/email/i).fill('dev@example.com');
    await page.getByLabel(/password/i).fill('whatever-not-checked-by-mock');
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/portal/);
    // Must land in-app (the safe default), never carry the browser to an
    // external origin.
    expect(new URL(page.url()).hostname).toBe(new URL(page.url()).hostname === 'localhost' ? 'localhost' : page.url());
    expect(page.url()).not.toContain('evil.example.com');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx playwright test auth-guards.spec.ts -g "returnTo cannot redirect"
```

Expected: FAIL — current code passes `//evil.example.com` straight to
`navigate()`, so the assertion on `page.url()` not containing
`evil.example.com` fails (or the URL bar shows the crafted path even if
the SPA itself can't leave origin — either way the test fails against
today's code, which is what "written before the fix" means here).

- [ ] **Step 3: Write the sanitizer**

Create `frontend/src/utils/safeReturnTo.ts`:

```ts
/**
 * Only a same-origin relative path is honored ("/portal/billing", not
 * "//evil.com", "https://evil.com", or "/\evil.com" — the last one
 * normalizes to "//evil.com" in some URL parsers, which is the exact
 * shape flagged by the react-router open-redirect advisory this guards
 * against independently of the library patch). Anything else falls back.
 */
export function safeReturnTo(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes(":")) {
    return fallback;
  }
  return path;
}
```

- [ ] **Step 4: Wire it into the actual navigate() call site**

In `frontend/src/App.tsx`, add the import near the top (with the other
local imports around line 38-40):

```ts
import { safeReturnTo } from "./utils/safeReturnTo";
```

Replace (around line 270-275):

```ts
  const handleLogin = (u: User, returnTo?: string) => {
    setUser(u);
    setIsLoggedIn(true);
    sessionExpiredHandled.current = false;
    navigate(returnTo || "/portal/overview");
  };
```

with:

```ts
  const handleLogin = (u: User, returnTo?: string) => {
    setUser(u);
    setIsLoggedIn(true);
    sessionExpiredHandled.current = false;
    navigate(safeReturnTo(returnTo, "/portal/overview"));
  };
```

- [ ] **Step 5: Run the test again to verify it passes**

```bash
cd frontend && npx playwright test auth-guards.spec.ts -g "returnTo cannot redirect"
```

Expected: PASS

- [ ] **Step 6: Confirm the legitimate case still works**

```bash
cd frontend && npx playwright test auth-guards.spec.ts
```

Expected: all existing cases in this file still PASS — a real
`returnTo=/portal/billing` must still land on `/portal/billing`, not
silently get redirected to the default on every login.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/safeReturnTo.ts frontend/src/App.tsx frontend/e2e/auth-guards.spec.ts
git commit -m "fix: reject non-relative returnTo values before navigate() (open-redirect defense in depth)"
```

---

### Task 5: Shared JSON-LD escape utility (DRY the pattern already in Breadcrumbs)

**Interfaces:**
- Produces: `toSafeJsonLdString(obj: unknown): string` in
  `frontend/src/utils/jsonLd.ts` — used by Task 6, Task 7, and (in the
  marketing-pages plan) Pricing's `Product`/`Offer` schema.

**Files:**
- Create: `frontend/src/utils/jsonLd.ts`
- Modify: `frontend/src/components/Breadcrumbs.tsx:44-54` (use the shared
  util instead of its own inline escape)

- [ ] **Step 1: Extract the util**

Create `frontend/src/utils/jsonLd.ts`:

```ts
/**
 * JSON-stringifies a JSON-LD object for embedding in a
 * `<script type="application/ld+json">` tag. Escapes `<` so a value that
 * happens to contain a literal `</script>` sequence can't break out of the
 * tag early — the same defense Breadcrumbs.tsx established first.
 */
export function toSafeJsonLdString(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}
```

- [ ] **Step 2: Point Breadcrumbs.tsx at it**

In `frontend/src/components/Breadcrumbs.tsx`, add the import:

```ts
import { toSafeJsonLdString } from '../utils/jsonLd';
```

Replace:

```ts
  const jsonLdString = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
```

with:

```ts
  const jsonLdString = toSafeJsonLdString(jsonLd);
```

- [ ] **Step 3: Confirm no behavior change**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT"
```

Expected: same pass/fail results as before this change (this is a pure
refactor — if anything about breadcrumb rendering changed, something is
wrong).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/jsonLd.ts frontend/src/components/Breadcrumbs.tsx
git commit -m "refactor: extract Breadcrumbs' JSON-LD escape helper into a shared util"
```

---

### Task 6: `Organization`/`LocalBusiness` structured data (sitewide, once)

**Interfaces:**
- Consumes: `toSafeJsonLdString` from Task 5.
- Produces: `<OrganizationSchema />` component, rendered once in
  `App.tsx`'s layout (outside the `<Routes>` so it's present on every
  page, matching how `<Header>`/`<Footer>` are already mounted).

**Files:**
- Create: `frontend/src/components/OrganizationSchema.tsx`
- Modify: `frontend/src/App.tsx` (mount point)

- [ ] **Step 1: Write the component**

Create `frontend/src/components/OrganizationSchema.tsx`:

```tsx
import React from 'react';
import { toSafeJsonLdString } from '../utils/jsonLd';

const SITE_ORIGIN = 'https://murzaktech.com';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Murzak Technologies Limited',
  url: SITE_ORIGIN,
  image: `${SITE_ORIGIN}/og-image.png`,
  description:
    "Nairobi's provider of custom software development, ERPNext implementation, and managed cloud hosting for East African businesses.",
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Nairobi',
    addressCountry: 'KE',
  },
  areaServed: 'KE',
  sameAs: [
    'https://www.linkedin.com/in/murzak-technologies-1774b63a9',
    'https://twitter.com/MurzakTech',
    'https://instagram.com/Murzaktechnologies',
  ],
};

const jsonLdString = toSafeJsonLdString(jsonLd);

/** Sitewide LocalBusiness structured data — mounted once in App.tsx, outside <Routes>. */
const OrganizationSchema: React.FC = () => (
  // eslint-disable-next-line react/no-danger
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString }} />
);

export default OrganizationSchema;
```

- [ ] **Step 2: Mount it once**

In `frontend/src/App.tsx`, add the import near the other component imports
(after `import Footer from "./components/Footer";`):

```ts
import OrganizationSchema from "./components/OrganizationSchema";
```

Find where `<Header ... />` is rendered in the JSX tree (top-level layout,
alongside `<Footer />`) and add `<OrganizationSchema />` as a sibling — it
renders nothing visible, so exact position doesn't affect layout, but keep
it near `<Header />` for discoverability.

- [ ] **Step 3: Verify it renders on every route**

```bash
cd frontend && npm run dev &
```

Then in a browser, navigate to `/`, `/cloud`, and `/pricing`; for each,
run in devtools console:

```js
document.querySelector('script[type="application/ld+json"]')?.textContent.includes('LocalBusiness')
```

Expected: `true` on all three routes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OrganizationSchema.tsx frontend/src/App.tsx
git commit -m "feat: add sitewide LocalBusiness JSON-LD structured data"
```

---

### Task 7: `FAQPage` structured data from the existing `Faq` component

**Interfaces:**
- Consumes: `toSafeJsonLdString` (Task 5), the existing `FaqItem[]` type
  already exported from `frontend/src/components/Faq.tsx`.
- Produces: `Faq` now also emits `FAQPage` JSON-LD whenever it renders —
  no new prop needed, since it already receives the full `items` array.

**Files:**
- Modify: `frontend/src/components/Faq.tsx`

**Confirmed current file** (`frontend/src/components/Faq.tsx`, 62 lines):
`FaqItem = { q: string; a: string }`, and the component returns a single
`<section>...</section>` as its root — it must become a Fragment to add a
sibling `<script>` alongside it.

- [ ] **Step 1: Add the import**

At the top of `frontend/src/components/Faq.tsx`, add:

```ts
import { toSafeJsonLdString } from "../utils/jsonLd";
```

- [ ] **Step 2: Compute the schema before the return**

Inside the component body, immediately before `return (`, add:

```ts
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
  const faqJsonLdString = toSafeJsonLdString(faqJsonLd);
```

- [ ] **Step 3: Wrap the return in a Fragment and add the script**

Replace:

```tsx
  return (
    <section className="max-w-4xl mx-auto px-6 sm:px-10">
```

with:

```tsx
  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLdString }} />
      <section className="max-w-4xl mx-auto px-6 sm:px-10">
```

And replace the closing of the component's return (currently):

```tsx
    </section>
  );
}
```

with:

```tsx
    </section>
    </>
  );
}
```

- [ ] **Step 3: Verify on Pricing (the page with the most FAQ items)**

```js
JSON.parse(document.querySelectorAll('script[type="application/ld+json"]')[1].textContent).mainEntity.length
```

Expected: matches `faqItems.length` in `Pricing.tsx` (7, as read during
grounding — confirm against current source).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Faq.tsx
git commit -m "feat: emit FAQPage JSON-LD from the existing Faq component"
```

---

### Task 8: Extend the per-route meta effect to cover canonical + OG + Twitter

**Interfaces:**
- Consumes: the existing `pageMetadata` map and the effect at
  `App.tsx:224-239` — extended, not replaced.

**Files:**
- Modify: `frontend/src/App.tsx:224-239`
- Test: `frontend/e2e/qa-marketing.spec.ts` (extend `MKT-07`, or add a new
  `MKT-10` block — this file already establishes the `test.describe('MKT-0N — ...')`
  convention)

- [ ] **Step 1: Write the failing test**

Add to `frontend/e2e/qa-marketing.spec.ts` (after the existing `MKT-07`
block):

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT-10"
```

Expected: FAIL — canonical/og:url currently stay at
`https://murzaktech.com/` on every route.

- [ ] **Step 3: Extend the effect**

In `frontend/src/App.tsx`, replace the existing effect:

```ts
  useEffect(() => {
    const meta = isNotFoundRoute ? notFoundMeta : pageMetadata[activePage] || pageMetadata.home;
    document.title = meta.title;
    // pageMetadata already carries a per-page description (written when the
    // title map was authored) — it was just never applied to the actual tag,
    // so every route showed index.html's static, homepage-only description
    // in search results. Update the same tag in place rather than adding a
    // new one, since index.html's is the one crawlers see before hydration.
    const descTag = document.querySelector('meta[name="description"]');
    if (descTag) descTag.setAttribute("content", meta.description);
    window.scrollTo({ top: 0, behavior: "auto" });

    setIsPageLoading(true);
    const timer = setTimeout(() => setIsPageLoading(false), 700);
    return () => clearTimeout(timer);
  }, [activePage, isNotFoundRoute]);
```

with:

```ts
  useEffect(() => {
    const meta = isNotFoundRoute ? notFoundMeta : pageMetadata[activePage] || pageMetadata.home;
    document.title = meta.title;
    // pageMetadata already carries a per-page description (written when the
    // title map was authored) — it was just never applied to the actual tag,
    // so every route showed index.html's static, homepage-only description
    // in search results. Update the same tag in place rather than adding a
    // new one, since index.html's is the one crawlers see before hydration.
    const descTag = document.querySelector('meta[name="description"]');
    if (descTag) descTag.setAttribute("content", meta.description);

    // Canonical + Open Graph + Twitter previously stayed hardcoded to
    // index.html's homepage values on every route — a duplicate-content
    // signal and a broken share preview for every non-home page. Same
    // pattern as the description tag above: update in place.
    const canonicalUrl = `${SITE_ORIGIN}${location.pathname}`;
    const setAttr = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };
    setAttr('link[rel="canonical"]', "href", canonicalUrl);
    setAttr('meta[property="og:title"]', "content", meta.title);
    setAttr('meta[property="og:description"]', "content", meta.description);
    setAttr('meta[property="og:url"]', "content", canonicalUrl);
    setAttr('meta[name="twitter:title"]', "content", meta.title);
    setAttr('meta[name="twitter:description"]', "content", meta.description);

    window.scrollTo({ top: 0, behavior: "auto" });

    setIsPageLoading(true);
    const timer = setTimeout(() => setIsPageLoading(false), 700);
    return () => clearTimeout(timer);
  }, [activePage, isNotFoundRoute, location.pathname]);
```

Add the `SITE_ORIGIN` constant near the top of `App.tsx`, alongside
`pageMetadata` (around line 70):

```ts
const SITE_ORIGIN = "https://murzaktech.com";
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT-10"
```

Expected: PASS

- [ ] **Step 5: Confirm MKT-07 (title) still passes — regression check**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT-07"
```

Expected: PASS (unchanged behavior, just confirming the effect's title
logic wasn't disturbed by the additions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/e2e/qa-marketing.spec.ts
git commit -m "fix: update canonical/OG/Twitter tags per route, not just title/description"
```

---

### Task 9: Create and wire up `og-image.png`

**Files:**
- Create: `frontend/public/og-image.png` (1200×630)

**Why this needs a browser, not a code snippet:** there's no existing
brand asset at this size in the repo (`public/` was checked during spec
grounding — no `og-image.png`, no larger source to downscale). This is a
visual-design deliverable, not a mechanical step.

- [ ] **Step 1: Build a simple branded HTML card at the exact OG size**

Create a scratch file (not committed) `frontend/scripts/og-card.html`:

```html
<!DOCTYPE html>
<html><head><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:630px; display:flex; flex-direction:column; justify-content:center;
    background: linear-gradient(135deg, #0B3C5D 0%, #08283f 100%);
    font-family: -apple-system, sans-serif; padding: 80px; }
  h1 { color: #fff; font-size: 64px; font-weight: 900; line-height: 1.05; letter-spacing: -0.02em; }
  p { color: #19C2FF; font-size: 28px; font-weight: 700; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.05em; }
</style></head>
<body>
  <h1>Murzak Technologies</h1>
  <p>Custom Software &amp; Managed Cloud &middot; Nairobi, Kenya</p>
</body></html>
```

- [ ] **Step 2: Screenshot it at exact size**

Use the Browser preview tool: open `frontend/scripts/og-card.html` directly
(`file://` URL or via a static serve), `resize_window` to `{width: 1200,
height: 630}`, then `computer {action: "screenshot"}`. Save the result as
`frontend/public/og-image.png`.

- [ ] **Step 3: Delete the scratch HTML file**

```bash
rm frontend/scripts/og-card.html
```

- [ ] **Step 4: Verify the file**

```bash
node -e "console.log(require('fs').statSync('frontend/public/og-image.png').size)"
```

Expected: a non-zero byte size (a few hundred KB is typical for a PNG this
size).

- [ ] **Step 5: Commit**

```bash
git add frontend/public/og-image.png
git commit -m "feat: add missing og-image.png referenced by every page's share metadata"
```

---

### Task 10: Sitemap completeness audit

**Files:**
- Modify: `frontend/public/sitemap.xml`

- [ ] **Step 1: Diff sitemap routes against the real route map**

```bash
node -e "
const fs = require('fs');
const sitemap = fs.readFileSync('frontend/public/sitemap.xml', 'utf8');
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/murzaktech\.com(\/[^<]*)<\/loc>/g)].map(m => m[1] || '/');
console.log('In sitemap:', sitemapPaths.sort());
"
```

Compare the output against every key in `pathToPage` (`App.tsx`, ~line
43-68) that resolves to a real, publicly indexable page — exclude
anything `robots.txt` already disallows (`/portal`, `/payment`,
`/checkout`, `/thank-you`, `/deploy`, `/api`) and exclude `/login` (no SEO
value, and it's a low-priority auth page, not content).

- [ ] **Step 2: Add any missing `<url>` entries**

For each real, indexable route missing from the sitemap, add an entry
following the file's existing format:

```xml
  <url>
    <loc>https://murzaktech.com/for/retail</loc>
    <lastmod>2026-08-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
```

(Confirm the actual `/for/*` URL paths against `pageToPath`/`App.tsx`
routing before writing entries — don't guess the path shape.)

- [ ] **Step 3: Validate the XML**

```bash
node -e "
const fs = require('fs');
const { DOMParser } = require('@xmldom/xmldom');
" 2>/dev/null || node -e "
// No XML parser dependency in this repo — a quick well-formedness check
// via a regex-balanced-tags approach instead of adding one.
const fs = require('fs');
const xml = fs.readFileSync('frontend/public/sitemap.xml', 'utf8');
const opens = (xml.match(/<url>/g) || []).length;
const closes = (xml.match(/<\/url>/g) || []).length;
console.log(opens === closes ? \`OK: \${opens} <url> entries, balanced\` : 'MISMATCHED url tags');
"
```

Expected: `OK: N <url> entries, balanced`

- [ ] **Step 4: Commit**

```bash
git add frontend/public/sitemap.xml
git commit -m "fix: add missing routes to sitemap.xml"
```

---

## Post-plan note for the user

D0 from the spec still applies: none of Tasks 6-10 make the site
crawlable by real search engines while `murzaktech.com` has no DNS
delegation. This plan makes the metadata correct and ready — the domain
fix is a separate, non-code action.
