# App Checkout (Phases 1–2: backend foundation + POS buyer path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop owner buys Murzak POS from `/products/pos` in four screens: tier → `/get/pos` (shop address and account) → existing M-Pesa/PayPal checkout → live welcome page. The shop gets the address they picked (`<slug>.pos.murzaktech.tech`), and the buyer never sees RAM, plans or the hosting configurator.

**Architecture:** Each tier is its own catalog item (`biz-pos-duka`, `biz-pos-inventory` = Biashara, `biz-pos-chain`) grouped by a new `app: "pos"` field. Every existing pricing, invoicing, renewal and provisioning path therefore works unchanged, and the server prices by `serviceId`. A new `Tenant Slug` doctype reserves shop addresses. The address travels Checkout Order → Tenant Slug (linked by invoice) → Provisioning Job `site_slug` → host runner `JOB_SITE_SLUG` → `murzak-bench-provision`.

**Tech Stack:** Node/Express backend (plain `node test/*.test.js` assert-style tests), Frappe REST doctypes, React + TypeScript + Tailwind frontend, Playwright e2e, Bash host scripts on the VPS.

**Spec:** `docs/superpowers/specs/2026-10-09-app-checkout-design.md`.

**Out of this plan:**
- Phase 3, upgrades and second shops. Needs `selected_services` row identity beyond `service_id`; today rows are merged by id.
- Phase 4, ERP/CRM/Accounting/HR tiers.

## Deviations from the spec (decided while planning; reasons inline)

1. **Tiers are separate catalog items, not `tiers[]` on one item.**
   - `backend/scripts/generate-catalog-snapshot.js` treats every `id: "…"` in `serviceCatalog.ts` as a new item, so nested tier objects with `id:` would corrupt the snapshot.
   - Invoicing (`sumSelectedServicesMonthlyKes`), add-on pro-rating and renewals all price by `serviceId`.
   - Keeping `biz-pos-inventory` as Biashara means existing customers need no migration.
2. **Annual price uses the existing rule, `annualPrepayKes` (12 × monthly × 0.8, "Save 20%")**, not 10 × monthly. One rule, already tested, already used by renewals.
   - Duka: KES 24,000/yr. Biashara: KES 43,200/yr. Chain: KES 81,600/yr.
   - As today, annual is offered only on a customer's first purchase (`isEligibleForTermChoice`).
3. **No phone field on `/get/pos`.** `/api/register` has no phone field. The existing M-Pesa form on `/checkout/:orderId` asks for the number, unchanged.
4. **A signed-in customer who already has a POS shop** sees "manage it in your portal" plus a support link, not a second purchase (phase 3).

## Global Constraints

- **Prices (KES/month):** Duka 2,500 · Biashara 4,500 · Chain 8,500. Setup fee 0 on all three.
- **Limits** (shown, not enforced in v1):

  | Tier | Branches | Staff logins | Products |
  |---|---|---|---|
  | Duka | 1 | 3 | 1,000 |
  | Biashara | 3 | 10 | unlimited |
  | Chain | unlimited | unlimited | unlimited |
- **Every POS tier:** `resources: { ramMb: 2048, diskGb: 25 }`, `benchApps: ["erpnext", "techsavanna_pos", "kenya_compliance"]`, `capacityClass: "premium"`, `tier: "Medium"`.
- **Shop address:**
  - lowercase `a-z0-9-`, 3–40 characters, no leading or trailing hyphen;
  - blocklist: `api www admin pos erp mail apps murzak support billing status app portal help test demo staging`, plus anything starting `user-<digit>` (account-derived site names) or `prov-check`.
- **POS address suffix:** `pos.murzaktech.tech`. Bench site suffix: `erp.murzaktech.tech`.
- **The word "plan" never appears on `/products/pos`, `/get/pos` or `/welcome/*`** (storefront rule, two-lane storefront spec). Use "tier" in code; customer copy names the tier ("Duka").
- **Errors:** every customer-facing error goes through `frontend/src/services/errors.ts` `toUserMessage()`. Never render a raw `err.message`.
- **Server pricing:** amounts always come from the catalog snapshot by `serviceId`. Never accept an amount from the browser.
- **Schema check:** `MOCK_FRAPPE` accepts any field. New doctype fields must be confirmed on the live Frappe instance (Task 8) before anything depends on them.
- **Order of release:** `site_slug` must exist on the live Provisioning Job doctype **before** the updated `murzak-bench-runner` is installed. The runner requests explicit fields, and an unknown field fails the whole query, stalling every bench job.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 0: Start from a master that has the per-shop POS work

The per-shop POS work (2026-10-08) is a prerequisite. It covers `PosLoginPanel`, `posLogin` on the activity route, the `murzak-bench-provision` POS owner block and the tenant nginx files. It was left uncommitted on `feat/pos-per-shop-deploy` in the main checkout.

- [ ] **Step 1: Confirm it is on master**

Run: `git fetch -q && git show origin/master:frontend/src/components/portal/cloud/PosLoginPanel.tsx | head -3`
Expected: the file's first lines (`import React, { useState } from "react";`). If it says `fatal: path ... does not exist`, stop and ask the user to merge `feat/pos-per-shop-deploy` first.

- [ ] **Step 2: Branch**

```bash
git switch -c feat/app-checkout origin/master
git cherry-pick b2fe37d   # the spec commit, if not already on master
```

---

## Task 1: POS tiers in the catalog and the backend snapshot

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts`: the `ServiceOption` type (~line 120–213), the `biz-pos-inventory` entry (~line 647–660), and new helpers near `getService` (~line 1364)
- Modify: `backend/scripts/generate-catalog-snapshot.js:80-112`
- Regenerate: `backend/data/serviceCatalogSnapshot.json`
- Modify: `backend/server.js:698` (`SERVICE_ID_TO_PLAN`)
- Test: `backend/test/catalogSnapshot.test.js`

**Interfaces:**
- Produces, frontend:
  - `type AppId = "pos"`
  - `ServiceOption.app?: AppId`, `appPlan?: string`, `appTagline?: string`, `appLimits?: { branches: number | null; users: number | null; products: number | null }`, `appPopular?: boolean`
  - `servicesForApp(app: AppId): ServiceItem[]`, sorted by `pricing.monthlyKes` ascending, deprecated excluded.
- Produces, backend: snapshot items carry `app: "pos"` for the three POS ids, so `getServiceMeta(id).app === "pos"`.

- [ ] **Step 1: Write the failing snapshot test**

Append inside the async IIFE of `backend/test/catalogSnapshot.test.js`, before its final summary block:

```js
  section("Murzak POS tiers resolve from the snapshot, priced by tier");
  {
    const expected = {
      "biz-pos-duka": 2500,
      "biz-pos-inventory": 4500, // Biashara — kept id so existing customers need no migration
      "biz-pos-chain": 8500,
    };
    for (const [id, monthly] of Object.entries(expected)) {
      const meta = getServiceMeta(id);
      ok(!!meta, `${id} resolves`);
      ok(meta?.app === "pos", `${id} is grouped under app "pos"`);
      ok(meta?.monthlyKes === monthly, `${id} prices at KES ${monthly}/mo`);
      ok(meta?.setupKes === 0, `${id} has no setup fee`);
      ok(meta?.capacityClass === "premium" && meta?.ramMb === 2048, `${id} is a premium 2GB tenant`);
      ok(
        JSON.stringify(meta?.benchApps) === JSON.stringify(["erpnext", "techsavanna_pos", "kenya_compliance"]),
        `${id} installs the POS bench apps in order`
      );
    }
    ok(getServiceMeta("biz-erp-light")?.app === undefined, "non-app services carry no app key");
  }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/catalogSnapshot.test.js`
Expected: FAIL lines for `biz-pos-duka resolves`, `is grouped under app "pos"`, and so on.

- [ ] **Step 3: Add the type fields.** In `frontend/src/config/serviceCatalog.ts`, add right after the `deprecated?: boolean;` line inside `ServiceOption`:

```ts
  /**
   * Business app this item is a TIER of (Murzak POS today). App tiers are sold
   * through the app's own checkout (/get/:app), never the hosting configurator,
   * and are priced by their own id — so each tier is a separate catalog item
   * (the snapshot generator splits items on every `id:`, so tiers can't nest).
   */
  app?: AppId;
  /** Customer-facing tier name, e.g. "Duka". Never the word "plan" in copy. */
  appPlan?: string;
  /** One-line who-it's-for, e.g. "One shop". */
  appTagline?: string;
  /** Shown limits (soft in v1). null = unlimited. */
  appLimits?: { branches: number | null; users: number | null; products: number | null };
  /** The "Most popular" tier. */
  appPopular?: boolean;
```

and directly above the line `export type ServiceOption = {` (line ~123), add:

```ts
/** Business apps sold through their own app checkout. */
export type AppId = "pos";
```

- [ ] **Step 4: Replace the `biz-pos-inventory` entry with the three tiers.** Replace the whole object whose `id` is `"biz-pos-inventory"` in `SERVICE_CATALOG.Business` with:

```ts
    {
      id: "biz-pos-duka",
      name: "Murzak POS — Duka",
      description: "Point of sale and stock for one shop, on your own private POS.",
      category: "POS & Inventory",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "25GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 25 },
      benchApps: ["erpnext", "techsavanna_pos", "kenya_compliance"],
      pricing: { model: "addon", monthlyKes: 2500, setupKes: 0 },
      highlights: ["M-Pesa payments", "Receipts", "Stock tracking", "Sales reports"],
      app: "pos",
      appPlan: "Duka",
      appTagline: "One shop",
      appLimits: { branches: 1, users: 3, products: 1000 },
      sortOrder: 29,
    },
    {
      // Id kept from the original single POS product so customers who bought it
      // at KES 4,500 are simply on Biashara — same price, no migration.
      id: "biz-pos-inventory",
      name: "Murzak POS — Biashara",
      description: "Point of sale and stock for a growing business with a few branches.",
      category: "POS & Inventory",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "25GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 25 },
      benchApps: ["erpnext", "techsavanna_pos", "kenya_compliance"],
      pricing: { model: "addon", monthlyKes: 4500, setupKes: 0 },
      highlights: ["Everything in Duka", "Purchase orders", "Loyalty points", "Stock transfers"],
      app: "pos",
      appPlan: "Biashara",
      appTagline: "A growing business",
      appLimits: { branches: 3, users: 10, products: null },
      appPopular: true,
      sortOrder: 30,
    },
    {
      id: "biz-pos-chain",
      name: "Murzak POS — Chain",
      description: "Point of sale and stock across many branches, with multi-branch reporting.",
      category: "POS & Inventory",
      tier: "Medium",
      capacityClass: "premium",
      specs: { ram: "2GB", storage: "25GB NVMe", cpu: "2 vCPU", bandwidth: "High", backups: "Daily", sla: "99.9%" },
      resources: { ramMb: 2048, diskGb: 25 },
      benchApps: ["erpnext", "techsavanna_pos", "kenya_compliance"],
      pricing: { model: "addon", monthlyKes: 8500, setupKes: 0 },
      highlights: ["Everything in Biashara", "Multi-branch reports", "Priority support"],
      app: "pos",
      appPlan: "Chain",
      appTagline: "Many branches",
      appLimits: { branches: null, users: null, products: null },
      sortOrder: 31,
    },
```

- [ ] **Step 5: Add the app helper.** After `export function getService(...) { ... }`, add:

```ts
/** Every live tier of a business app, cheapest first. */
export function servicesForApp(app: AppId): ServiceItem[] {
  return Object.values(SERVICE_INDEX)
    .filter((s) => s.app === app && !s.deprecated)
    .sort((a, b) => (a.pricing.monthlyKes ?? 0) - (b.pricing.monthlyKes ?? 0));
}
```

- [ ] **Step 6: Teach the snapshot generator `app`.** In `backend/scripts/generate-catalog-snapshot.js`, after `const benchApps = pullArray(block, "benchApps");` add:

```js
    // Business-app grouping (Murzak POS tiers). Matched with a leading
    // delimiter so "benchApps:" / "appPlan:" can never be mistaken for it.
    const appMatch = block.match(/[\s{,]app\s*:\s*"([^"]+)"/);
    const app = appMatch ? appMatch[1] : undefined;
```

and in the `items[id] = { ... }` literal, after `...(benchApps ? { benchApps } : {}),` add:

```js
      ...(app ? { app } : {}),
```

- [ ] **Step 7: Register the new ids' plan.** In `backend/server.js` `SERVICE_ID_TO_PLAN`, after `"biz-pos-inventory": "Business",` add:

```js
  "biz-pos-duka": "Business",
  "biz-pos-chain": "Business",
```

- [ ] **Step 8: Regenerate and run**

Run: `node backend/scripts/generate-catalog-snapshot.js && cd backend && node test/catalogSnapshot.test.js`
Expected: `Wrote N services …` (N is two more than before), then every `ok:` line passes, including the new POS section.

- [ ] **Step 9: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all pass. If a test asserted the old KES 3,000 POS setup fee or the old name "POS & Inventory" for `biz-pos-inventory`, change its fixture service to `biz-erp-light` (still has a setup fee) rather than weakening the assertion. Re-run until green.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/scripts/generate-catalog-snapshot.js backend/data/serviceCatalogSnapshot.json backend/server.js backend/test
git commit -m "feat(catalog): Murzak POS tiers — Duka, Biashara, Chain

Each tier is its own catalog item grouped by app: \"pos\", so every
existing pricing/invoice/renewal/provisioning path prices by serviceId
unchanged. biz-pos-inventory becomes Biashara (same KES 4,500). No
setup fee on any tier.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: App config, and keeping app tiers out of the hosting configurator

**Files:**
- Create: `frontend/src/config/appCheckout.ts`
- Modify: `frontend/src/config/serviceCatalog.ts`, `configuratorServices` (~line 1277)
- Modify: `frontend/src/pages/Pricing.tsx`, the `configure=` deep-link effect (~line 68–92)
- Modify: `frontend/e2e/cloud-launch.spec.ts`, `customer-journey.spec.ts`, `qa-checkout-launch.spec.ts`, `qa-payments-idempotency.spec.ts`, `qa-portal.spec.ts` (they use `biz-pos-inventory` as "any premium SKU through the configurator")

**Interfaces:**
- Consumes: `AppId`, `servicesForApp`, `getService` (Task 1).
- Produces:
  - `APP_CHECKOUT: Record<AppId, AppCheckoutInfo>` where `AppCheckoutInfo = { id: AppId; productName: string; addressSuffix: string; productPath: string; afterPayment: string }`
  - `annualKes(monthlyKes: number): number`
  - `appIdFromRoute(param: string | undefined): AppId | null`

- [ ] **Step 1: Create `frontend/src/config/appCheckout.ts`**

```ts
import { AppId } from "./serviceCatalog";

// Business apps sold through their own checkout (/get/:app) instead of the
// hosting configurator. Tier data lives in serviceCatalog.ts (one catalog
// item per tier, grouped by `app`); this file holds what the checkout says
// about the app itself.

export interface AppCheckoutInfo {
  id: AppId;
  productName: string;
  /** Host suffix the shop's own address lives under. */
  addressSuffix: string;
  /** Marketing page the tiers are shown on. */
  productPath: string;
  /** One line on the welcome screen once the app is ready. */
  afterPayment: string;
}

export const APP_CHECKOUT: Record<AppId, AppCheckoutInfo> = {
  pos: {
    id: "pos",
    productName: "Murzak POS",
    addressSuffix: "pos.murzaktech.tech",
    productPath: "/products/pos",
    afterPayment: "You'll add your branches, staff and products the first time you sign in.",
  },
};

/** /get/:app route segment → known app, or null. */
export function appIdFromRoute(param: string | undefined): AppId | null {
  return param && param in APP_CHECKOUT ? (param as AppId) : null;
}

/**
 * Annual prepay price. MUST mirror backend/services/billingTerm.js
 * annualPrepayKes (12 months less ANNUAL_DISCOUNT_PCT = 20) — the server
 * bills that function, this only displays it.
 */
export const ANNUAL_DISCOUNT_PCT = 20;
export function annualKes(monthlyKes: number): number {
  return Math.round(monthlyKes * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}
```

- [ ] **Step 2: Exclude app tiers from the configurator.** In `serviceCatalog.ts`, change the last line of `configuratorServices` to:

```ts
  // App tiers (Murzak POS) have their own checkout — selling them here would
  // put RAM meters and domain choices in front of a shop owner.
  return pool.filter((s) => !s.deprecated && !s.app);
```

- [ ] **Step 3: Redirect old deep links.** In `frontend/src/pages/Pricing.tsx`, inside the effect that reads `configure`, directly after `if (!productId) return;` insert:

```ts
    // App tiers are sold on their own page, not in the configurator.
    const appTier = getService(productId);
    if (appTier?.app) {
      navigate(`${APP_CHECKOUT[appTier.app].productPath}#plans`, { replace: true });
      return;
    }
```

and add the imports at the top of the file:

```ts
import { getService } from "../config/serviceCatalog";
import { APP_CHECKOUT } from "../config/appCheckout";
```

(If `getService` is already imported from `../config/serviceCatalog`, extend that import instead of adding a second one.)

- [ ] **Step 4: Point the e2e "premium SKU through the configurator" tests at a SKU still sold there**

Run:
```bash
cd frontend && grep -rl "biz-pos-inventory" e2e | xargs sed -i "s/biz-pos-inventory/biz-crm-helpdesk/g" && grep -rn "POS & Inventory\|POS &amp; Inventory" e2e
```
Expected: the second grep prints nothing. If it prints lines (assertions on the POS product name), replace that text with `CRM + Helpdesk` (the `biz-crm-helpdesk` catalog name: same premium class, Medium tier, 2,048 MB).

- [ ] **Step 5: Type-check and build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: no type errors; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config frontend/src/pages/Pricing.tsx frontend/e2e
git commit -m "feat(app-checkout): app config; keep app tiers out of the hosting configurator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Shop address rules (pure functions)

**Files:**
- Create: `backend/services/apps/shopAddress.js`
- Test: `backend/test/shopAddress.test.js`
- Modify: `backend/package.json`, the `test` script

**Interfaces:**
- Produces:
  - `slugFromName(name: string): string`
  - `checkSlug(slug: string): { ok: true } | { ok: false, reason: "too_short" | "too_long" | "invalid" | "reserved" }`
  - `suggestSlugs(slug: string): string[]` (up to 3 valid alternatives)
  - `RESERVED_SLUGS: Set<string>`

- [ ] **Step 1: Write the failing test** `backend/test/shopAddress.test.js`

```js
/**
 * Shop address rules — node test/shopAddress.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const { slugFromName, checkSlug, suggestSlugs } = require("../services/apps/shopAddress");

section("slugFromName");
ok(slugFromName("Mama Njeri Stores") === "mama-njeri-stores", "spaces become hyphens, lowercased");
ok(slugFromName("  Café  Délice!! ") === "cafe-delice", "accents stripped, punctuation dropped, trimmed");
ok(slugFromName("A&B -- Wholesalers") === "a-b-wholesalers", "runs of separators collapse to one hyphen");
ok(slugFromName("x".repeat(60)).length === 40, "cut to 40 characters");
ok(slugFromName("abc" + "-".repeat(37) + "def") === "abc", "never ends on a hyphen after the cut");
ok(slugFromName("!!!") === "", "nothing usable -> empty");

section("checkSlug");
ok(checkSlug("mamanjeri").ok === true, "plain name is fine");
ok(checkSlug("ab").reason === "too_short", "under 3 chars");
ok(checkSlug("a".repeat(41)).reason === "too_long", "over 40 chars");
ok(checkSlug("-shop").reason === "invalid", "leading hyphen");
ok(checkSlug("shop-").reason === "invalid", "trailing hyphen");
ok(checkSlug("Shop").reason === "invalid", "uppercase rejected (caller must slugify)");
ok(checkSlug("shop_1").reason === "invalid", "underscore rejected");
for (const r of ["api", "www", "admin", "pos", "erp", "murzak", "status"]) ok(checkSlug(r).reason === "reserved", `${r} is reserved`);
ok(checkSlug("user-26-08-12-0001").reason === "reserved", "account-derived site names are reserved");
ok(checkSlug("prov-check").reason === "reserved", "provisioner probe name is reserved");
ok(checkSlug("user-friendly-shop").ok === true, "'user-' followed by a letter is fine");

section("suggestSlugs");
const s = suggestSlugs("mamanjeri");
ok(s.length === 3 && s.every((x) => checkSlug(x).ok), "three valid suggestions");
ok(!s.includes("mamanjeri"), "never suggests the taken name itself");
ok(suggestSlugs("x".repeat(40)).every((x) => x.length <= 40 && checkSlug(x).ok), "suggestions respect the length cap");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error(fails.join("\n")); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/shopAddress.test.js`
Expected: `Error: Cannot find module '../services/apps/shopAddress'`.

- [ ] **Step 3: Implement** `backend/services/apps/shopAddress.js`

```js
// services/apps/shopAddress.js
//
// Rules for the address a customer picks for their own app instance
// (<slug>.pos.murzaktech.tech, backed by <slug>.erp.murzaktech.tech). Pure
// functions — availability is tenantSlugStore.js's job.
//
// The shape must stay inside what the tenant front door accepts
// (deploy/vps/nginx/pos-tenants-wildcard: [a-z0-9][a-z0-9-]{0,39}) and what
// Frappe accepts as a site directory name.

const MAX_LEN = 40;
const MIN_LEN = 3;
const SHAPE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const RESERVED_SLUGS = new Set([
  "api", "www", "admin", "pos", "erp", "mail", "apps", "murzak", "support",
  "billing", "status", "app", "portal", "help", "test", "demo", "staging",
]);

function trimHyphens(s) {
  return s.replace(/^-+/, "").replace(/-+$/, "");
}

/** Turn a shop name into a candidate address. May return "" when nothing is usable. */
function slugFromName(name) {
  const ascii = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const hyphenated = trimHyphens(ascii.replace(/[^a-z0-9]+/g, "-"));
  return trimHyphens(hyphenated.slice(0, MAX_LEN));
}

function checkSlug(slug) {
  const s = String(slug || "");
  if (s.length < MIN_LEN) return { ok: false, reason: "too_short" };
  if (s.length > MAX_LEN) return { ok: false, reason: "too_long" };
  if (!SHAPE_RE.test(s)) return { ok: false, reason: "invalid" };
  // user-<digit>… is the shape murzak-bench-provision derives from account
  // ids; prov-check is its wildcard DNS probe. Either would collide.
  if (RESERVED_SLUGS.has(s) || /^user-\d/.test(s) || s.startsWith("prov-check")) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true };
}

/** Up to three valid alternatives to a taken address. */
function suggestSlugs(slug) {
  const base = trimHyphens(String(slug || "").slice(0, MAX_LEN - 5));
  const out = [];
  for (const suffix of ["shop", "ke", "2", "store", "3"]) {
    const candidate = `${base}-${suffix}`;
    if (candidate !== slug && checkSlug(candidate).ok && !out.includes(candidate)) out.push(candidate);
    if (out.length === 3) break;
  }
  return out;
}

module.exports = { RESERVED_SLUGS, slugFromName, checkSlug, suggestSlugs };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && node test/shopAddress.test.js`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Add to the suite.** In `backend/package.json` `scripts.test`, append ` && node test/shopAddress.test.js`.

- [ ] **Step 6: Commit**

```bash
git add backend/services/apps/shopAddress.js backend/test/shopAddress.test.js backend/package.json
git commit -m "feat(app-checkout): shop address rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `Tenant Slug` doctype and reservation store

**Files:**
- Create: `backend/data/doctype-tenant-slug.json`
- Modify: `backend/scripts/install-missing-doctypes.js` (`DOCTYPE_PATHS`)
- Modify: `backend/services/checkout/orderStore.js` (export the two datetime helpers)
- Create: `backend/services/apps/tenantSlugStore.js`
- Test: `backend/test/tenantSlugStore.test.js`
- Modify: `backend/package.json`, the `test` script

**Interfaces:**
- Consumes: `checkSlug` (Task 3); `mysqlDatetime`, `parseMysqlDatetime` from `orderStore.js`.
- Produces (all `async`, first arg `client`):
  - `isSlugAvailable(client, slug, nowMs) → boolean`
  - `reserveSlug(client, { slug, app, webAccount, orderId, nowMs }) → void`; throws `{ statusCode: 409, code: "slug_taken" }`
  - `touchSlug(client, { slug, webAccount, nowMs }) → void` (heartbeat, best-effort)
  - `linkSlugInvoice(client, { slug, webAccount, invoiceDocName, nowMs }) → void`
  - `activateSlugForInvoice(client, invoiceDocName) → string | null` (the slug, or null)
  - `TENANT_SLUG_DOCTYPE = "Tenant Slug"`, `SLUG_RESERVATION_TTL_MS` (30 min), `SLUG_PAYMENT_GRACE_MS` (24 h)

- [ ] **Step 1: Create the doctype fixture** `backend/data/doctype-tenant-slug.json`

```json
{
  "doctype": "DocType",
  "name": "Tenant Slug",
  "module": "Custom",
  "custom": 1,
  "naming_rule": "By fieldname",
  "autoname": "field:slug",
  "title_field": "slug",
  "track_changes": 1,
  "sort_field": "creation",
  "sort_order": "DESC",
  "fields": [
    { "fieldname": "slug", "fieldtype": "Data", "label": "Slug", "reqd": 1, "unique": 1, "in_list_view": 1, "description": "The customer-chosen address: <slug>.pos.murzaktech.tech / <slug>.erp.murzaktech.tech. Doc name = slug, so the database enforces uniqueness." },
    { "fieldname": "app", "fieldtype": "Data", "label": "App", "in_list_view": 1, "in_standard_filter": 1 },
    { "fieldname": "web_account", "fieldtype": "Link", "label": "Web Account", "options": "Web Account", "in_list_view": 1, "in_standard_filter": 1 },
    { "fieldname": "status", "fieldtype": "Select", "label": "Status", "options": "reserved\nactive\nreleased", "default": "reserved", "in_list_view": 1, "in_standard_filter": 1, "description": "reserved = held by an unpaid order until expires_at; active = paid, owned for good; released = free again." },
    { "fieldname": "column_break_1", "fieldtype": "Column Break" },
    { "fieldname": "checkout_order", "fieldtype": "Data", "label": "Checkout Order" },
    { "fieldname": "invoice", "fieldtype": "Data", "label": "Portal Invoice", "in_standard_filter": 1 },
    { "fieldname": "expires_at", "fieldtype": "Datetime", "label": "Reservation Expires At" }
  ],
  "permissions": [
    { "role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1 }
  ]
}
```

- [ ] **Step 2: Register it for install.** In `backend/scripts/install-missing-doctypes.js`, append to `DOCTYPE_PATHS`:

```js
  // Customer-chosen app addresses (Murzak POS shops). See
  // services/apps/tenantSlugStore.js.
  path.resolve(__dirname, "../data/doctype-tenant-slug.json"),
```

- [ ] **Step 3: Export the datetime helpers.** In `backend/services/checkout/orderStore.js`, add `mysqlDatetime,` and `parseMysqlDatetime,` to the `module.exports` object.

- [ ] **Step 4: Write the failing test** `backend/test/tenantSlugStore.test.js`

```js
/**
 * Tenant Slug reservation store — node test/tenantSlugStore.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }
async function rejects(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (expected ${code})`); }
  catch (e) { ok(e.code === code, `${msg} -> ${e.code}`); }
}

const store = require("../services/apps/tenantSlugStore");

// Minimal Frappe double: docs keyed by name (= slug, per autoname field:slug).
function makeClient() {
  const docs = {};
  const nameOf = (url) => decodeURIComponent(url.split("?")[0].split("/").pop());
  return {
    docs,
    get: async (url, opts) => {
      if (/\/Tenant(%20| )Slug$/.test(url)) {
        const filters = JSON.parse(opts?.params?.filters || "[]");
        const rows = Object.values(docs).filter((d) =>
          filters.every(([f, op, v]) => (op === "=" ? d[f] === v : op === "in" ? v.includes(d[f]) : true)));
        return { data: { data: rows } };
      }
      const n = nameOf(url);
      if (!docs[n]) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
      return { data: { data: docs[n] } };
    },
    post: async (url, body) => {
      if (docs[body.slug]) { const e = new Error("dup"); e.response = { status: 409 }; throw e; }
      docs[body.slug] = { name: body.slug, ...body };
      return { data: { data: docs[body.slug] } };
    },
    put: async (url, body) => { const n = nameOf(url); Object.assign(docs[n], body); return { data: { data: docs[n] } }; },
  };
}

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;

(async () => {
  section("reserve, availability, expiry");
  {
    const c = makeClient();
    ok(await store.isSlugAvailable(c, "mamanjeri", T0), "unknown slug is available");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    ok(c.docs.mamanjeri?.status === "reserved" && c.docs.mamanjeri.web_account === "A", "reserved for A");
    ok(!(await store.isSlugAvailable(c, "mamanjeri", T0 + 5 * MIN)), "held while the reservation is live");
    await rejects(
      () => store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "B", orderId: "CHK-2", nowMs: T0 + 5 * MIN }),
      "slug_taken", "another account cannot take a live reservation");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "A", orderId: "CHK-3", nowMs: T0 + 5 * MIN });
    ok(c.docs.mamanjeri.checkout_order === "CHK-3", "the holder can re-reserve for a fresh order");
    ok(await store.isSlugAvailable(c, "mamanjeri", T0 + 5 * MIN + store.SLUG_RESERVATION_TTL_MS + 1), "free again once expired");
    await store.reserveSlug(c, { slug: "mamanjeri", app: "pos", webAccount: "B", orderId: "CHK-4", nowMs: T0 + 5 * MIN + store.SLUG_RESERVATION_TTL_MS + 1 });
    ok(c.docs.mamanjeri.web_account === "B", "an expired reservation can be taken over");
  }

  section("heartbeat keeps a reservation alive");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "duka1", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.touchSlug(c, { slug: "duka1", webAccount: "A", nowMs: T0 + 25 * MIN });
    ok(!(await store.isSlugAvailable(c, "duka1", T0 + 40 * MIN)), "touched reservation outlives its first TTL");
    await store.touchSlug(c, { slug: "duka1", webAccount: "B", nowMs: T0 + 41 * MIN });
    ok(await store.isSlugAvailable(c, "duka1", T0 + 25 * MIN + store.SLUG_RESERVATION_TTL_MS + 1), "a non-holder's touch does nothing");
  }

  section("invoice link and activation");
  {
    const c = makeClient();
    await store.reserveSlug(c, { slug: "chain", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 });
    await store.linkSlugInvoice(c, { slug: "chain", webAccount: "A", invoiceDocName: "PINV-9", nowMs: T0 + MIN });
    ok(c.docs.chain.invoice === "PINV-9", "invoice linked");
    ok(!(await store.isSlugAvailable(c, "chain", T0 + 20 * 60 * MIN)), "an invoiced reservation is held through the payment grace window");
    ok((await store.activateSlugForInvoice(c, "PINV-9")) === "chain", "activation returns the slug");
    ok(c.docs.chain.status === "active", "status active after payment");
    ok(!(await store.isSlugAvailable(c, "chain", T0 + 365 * 24 * 60 * MIN)), "an active slug is never available again");
    ok((await store.activateSlugForInvoice(c, "PINV-unknown")) === null, "no slug for an unrelated invoice");
  }

  section("bad input never reaches Frappe");
  {
    const c = makeClient();
    await rejects(
      () => store.reserveSlug(c, { slug: "api", app: "pos", webAccount: "A", orderId: "CHK-1", nowMs: T0 }),
      "slug_invalid", "reserved word refused");
    ok(Object.keys(c.docs).length === 0, "nothing written");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})();
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd backend && node test/tenantSlugStore.test.js`
Expected: `Cannot find module '../services/apps/tenantSlugStore'`.

- [ ] **Step 6: Implement** `backend/services/apps/tenantSlugStore.js`

```js
// services/apps/tenantSlugStore.js
//
// Who holds which customer-chosen app address. The doctype is named by the
// slug itself (autoname field:slug), so the database — not this code — is
// what guarantees two buyers can never both own "mamanjeri".
//
// Lifecycle mirrors Checkout Order reservations (orderStore.js):
//   reserved  held by an unpaid order until expires_at (30 min, renewed by
//             the checkout page heartbeat; extended to 24h once an invoice
//             exists, so a slow M-Pesa confirmation can't lose the name)
//   active    paid — owned for good
//   released  free again (never written today: expiry alone frees a name,
//             no sweeper needed, same as RAM reservations)

const { checkSlug } = require("./shopAddress");
const { mysqlDatetime, parseMysqlDatetime } = require("../checkout/orderStore");

const TENANT_SLUG_DOCTYPE = "Tenant Slug";
const SLUG_RESERVATION_TTL_MS = 30 * 60 * 1000;
const SLUG_PAYMENT_GRACE_MS = 24 * 60 * 60 * 1000;
const BASE = `/api/resource/${encodeURIComponent(TENANT_SLUG_DOCTYPE)}`;

// Single Node process — same assumption orderStore.js's mutex makes. The
// unique doc name still protects against a second process.
let chain = Promise.resolve();
function serialize(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

function slugError(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function isLive(doc, nowMs) {
  if (!doc) return false;
  if (doc.status === "active") return true;
  return doc.status === "reserved" && parseMysqlDatetime(doc.expires_at) > nowMs;
}

async function getSlugDoc(client, slug) {
  try {
    const res = await client.get(`${BASE}/${encodeURIComponent(slug)}`);
    return res.data?.data || null;
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

async function isSlugAvailable(client, slug, nowMs) {
  return !isLive(await getSlugDoc(client, slug), nowMs);
}

async function reserveSlug(client, { slug, app, webAccount, orderId, nowMs }) {
  if (!checkSlug(slug).ok) throw slugError("slug_invalid", "That shop address isn't allowed.", 400);
  return serialize(async () => {
    const doc = await getSlugDoc(client, slug);
    const heldByOther = isLive(doc, nowMs) && !(doc.status === "reserved" && doc.web_account === webAccount);
    if (heldByOther) throw slugError("slug_taken", "That shop address was just taken.", 409);

    const fields = {
      app,
      web_account: webAccount,
      status: "reserved",
      checkout_order: orderId,
      invoice: "",
      expires_at: mysqlDatetime(nowMs + SLUG_RESERVATION_TTL_MS),
    };
    if (doc) {
      await client.put(`${BASE}/${encodeURIComponent(slug)}`, fields);
      return;
    }
    try {
      await client.post(BASE, { slug, ...fields });
    } catch (e) {
      // Another process won the insert between our read and write.
      if (e.response?.status === 409) throw slugError("slug_taken", "That shop address was just taken.", 409);
      throw e;
    }
  });
}

async function touchSlug(client, { slug, webAccount, nowMs }) {
  try {
    const doc = await getSlugDoc(client, slug);
    if (!doc || doc.status !== "reserved" || doc.web_account !== webAccount || doc.invoice) return;
    if (parseMysqlDatetime(doc.expires_at) <= nowMs) return;
    await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
      expires_at: mysqlDatetime(nowMs + SLUG_RESERVATION_TTL_MS),
    });
  } catch (e) {
    // Heartbeat is best-effort; the order's own heartbeat still runs.
  }
}

async function linkSlugInvoice(client, { slug, webAccount, invoiceDocName, nowMs }) {
  const doc = await getSlugDoc(client, slug);
  if (!doc || doc.web_account !== webAccount) {
    throw slugError("slug_taken", "That shop address is no longer reserved for you.", 409);
  }
  await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
    invoice: invoiceDocName,
    expires_at: mysqlDatetime(nowMs + SLUG_PAYMENT_GRACE_MS),
  });
}

async function activateSlugForInvoice(client, invoiceDocName) {
  const res = await client.get(BASE, {
    params: {
      filters: JSON.stringify([["invoice", "=", invoiceDocName], ["status", "in", ["reserved", "active"]]]),
      fields: JSON.stringify(["name", "slug", "status"]),
      limit_page_length: 1,
    },
  });
  const row = res.data?.data?.[0];
  if (!row) return null;
  if (row.status !== "active") {
    await client.put(`${BASE}/${encodeURIComponent(row.name)}`, { status: "active" });
  }
  return row.slug || row.name;
}

module.exports = {
  TENANT_SLUG_DOCTYPE,
  SLUG_RESERVATION_TTL_MS,
  SLUG_PAYMENT_GRACE_MS,
  isSlugAvailable,
  reserveSlug,
  touchSlug,
  linkSlugInvoice,
  activateSlugForInvoice,
};
```

- [ ] **Step 7: Run it to verify it passes**

Run: `cd backend && node test/tenantSlugStore.test.js && node test/orderStore.test.js`
Expected: both report `0 failed`. The second confirms the export change broke nothing.

- [ ] **Step 8: Add to the suite** (append ` && node test/tenantSlugStore.test.js` to `scripts.test`) **and commit**

```bash
git add backend/data/doctype-tenant-slug.json backend/scripts/install-missing-doctypes.js backend/services/checkout/orderStore.js backend/services/apps/tenantSlugStore.js backend/test/tenantSlugStore.test.js backend/package.json
git commit -m "feat(app-checkout): Tenant Slug doctype and reservation store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Address check route, and app orders in `/api/orders`

**Files:**
- Create: `backend/services/apps/appOrder.js`
- Create: `backend/routes/appsRoutes.js`
- Modify: `backend/routes/ordersRoutes.js`, in three places: `POST /api/orders` (~line 108–138), `GET /api/orders/:id` (~line 140–170), and `prepare-payment` (~line 362, after `await linkInvoice(...)`)
- Modify: `backend/server.js:3488` (mount the router)
- Test: `backend/test/appOrder.test.js`
- Modify: `backend/package.json`, the `test` script

**Interfaces:**
- Consumes: `getServiceMeta` (`services/provisioning/catalog`), `checkSlug`/`slugFromName`/`suggestSlugs` (Task 3), the slug store (Task 4).
- Produces:
  - `GET /api/apps/:app/address?name=<shop name or slug>` → `200 { ok: true, slug, available, reason?, suggestions }`, or `404` for an unknown app. Public (no auth).
  - `POST /api/orders` with an app-tier `serviceId` requires `config.shopName` and `config.slug`. Errors:
    - `400 code "slug_invalid"`
    - `409 code "slug_taken"` (+ `suggestions`)
    - `409 code "APP_EXISTS"` (account already has a live shop for this app)

    The stored order config gains `app`.
  - `appOrder.validateAppOrder({ serviceId, config, existingServiceRows }) → null | { app, slug, shopName }` (throws coded errors)
  - `appOrder.APP_ADDRESS_SUFFIX = { pos: "pos.murzaktech.tech" }`

- [ ] **Step 1: Write the failing test** `backend/test/appOrder.test.js`

```js
/**
 * App order validation — node test/appOrder.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }
function throwsCode(fn, code, msg) {
  try { fn(); ok(false, `${msg} (expected ${code})`); } catch (e) { ok(e.code === code, `${msg} -> ${e.code}`); }
}

const { validateAppOrder } = require("../services/apps/appOrder");

section("non-app services pass straight through");
ok(validateAppOrder({ serviceId: "biz-erp-light", config: {}, existingServiceRows: [] }) === null, "ERP is not an app order");

section("POS tier needs a valid address and shop name");
const good = validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Mama Njeri Stores", slug: "mamanjeri" },
  existingServiceRows: [],
});
ok(good && good.app === "pos" && good.slug === "mamanjeri" && good.shopName === "Mama Njeri Stores", "valid order normalized");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "X Shop" }, existingServiceRows: [] }), "slug_invalid", "missing slug");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "X", slug: "api" }, existingServiceRows: [] }), "slug_invalid", "reserved slug");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "  ", slug: "good-shop" }, existingServiceRows: [] }), "shop_name_required", "blank shop name");
ok(validateAppOrder({ serviceId: "biz-pos-chain", config: { shopName: "A", slug: " Good-Shop " }, existingServiceRows: [] }).slug === "good-shop", "slug trimmed and lowercased");

section("one live shop per app until upgrades ship (phase 3)");
throwsCode(() => validateAppOrder({
  serviceId: "biz-pos-chain",
  config: { shopName: "Second", slug: "second-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-inventory", status: "Active" }],
}), "APP_EXISTS", "an Active POS tier blocks a second POS purchase");
throwsCode(() => validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Second", slug: "second-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-duka", status: "Setting up" }],
}), "APP_EXISTS", "a shop still being set up also blocks");
ok(!!validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Again", slug: "again-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-duka", status: "Awaiting Payment" }],
}), "an unpaid earlier attempt does not block");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error(fails.join("\n")); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/appOrder.test.js`
Expected: `Cannot find module '../services/apps/appOrder'`.

- [ ] **Step 3: Implement** `backend/services/apps/appOrder.js`

```js
// services/apps/appOrder.js
//
// What makes an order an APP order (a Murzak POS tier, later ERP/CRM…) and
// what it must carry. Pure — the route does the I/O.

const { getServiceMeta } = require("../provisioning/catalog");
const { checkSlug } = require("./shopAddress");

const APP_ADDRESS_SUFFIX = { pos: "pos.murzaktech.tech" };
// A row in any of these states is a shop that exists (or is being built).
const LIVE_SERVICE_STATUSES = new Set(["Active", "Setting up", "Suspended"]);

function coded(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/**
 * @returns {null | { app: string, slug: string, shopName: string }}
 *   null when serviceId is not an app tier (caller proceeds as before).
 */
function validateAppOrder({ serviceId, config, existingServiceRows }) {
  const app = getServiceMeta(serviceId)?.app;
  if (!app) return null;

  const shopName = String(config?.shopName || "").trim().slice(0, 80);
  if (!shopName) throw coded("shop_name_required", "Please enter your shop's name.", 400);

  const slug = String(config?.slug || "").trim().toLowerCase();
  if (!checkSlug(slug).ok) throw coded("slug_invalid", "Please choose a different shop address.", 400);

  // Second shops need per-shop billing rows (phase 3); until then one live
  // shop per app per account, and the page sends the owner to the portal.
  const hasLiveShop = (existingServiceRows || []).some(
    (r) => getServiceMeta(r.serviceId)?.app === app && LIVE_SERVICE_STATUSES.has(r.status)
  );
  if (hasLiveShop) {
    throw coded("APP_EXISTS", "You already have a shop on this account — manage it from your portal.", 409);
  }

  return { app, slug, shopName };
}

module.exports = { APP_ADDRESS_SUFFIX, validateAppOrder };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && node test/appOrder.test.js`
Expected: `0 failed`.

- [ ] **Step 5: Create the public address route** `backend/routes/appsRoutes.js`

```js
// routes/appsRoutes.js
//
// GET /api/apps/:app/address?name=…  — live "is this shop address free?"
// for the /get/:app setup page. Public on purpose: a buyer checks names
// before they have an account. Reads only; reservation happens at order time.

const express = require("express");
const shopAddress = require("../services/apps/shopAddress");
const tenantSlugs = require("../services/apps/tenantSlugStore");
const appOrder = require("../services/apps/appOrder");

module.exports = function (ctx) {
  const { frappeClient } = ctx;
  const router = express.Router();

  router.get("/api/apps/:app/address", async (req, res) => {
    if (!appOrder.APP_ADDRESS_SUFFIX[req.params.app]) {
      return res.status(404).json({ error: "Unknown app." });
    }
    const raw = String(req.query.name || "").slice(0, 120);
    const slug = shopAddress.slugFromName(raw);
    const rule = shopAddress.checkSlug(slug);
    if (!rule.ok) {
      return res.json({ ok: true, slug, available: false, reason: rule.reason, suggestions: [] });
    }
    try {
      const client = frappeClient();
      const nowMs = Date.now();
      const available = await tenantSlugs.isSlugAvailable(client, slug, nowMs);
      let suggestions = [];
      if (!available) {
        for (const s of shopAddress.suggestSlugs(slug)) {
          if (await tenantSlugs.isSlugAvailable(client, s, nowMs)) suggestions.push(s);
        }
      }
      return res.json({ ok: true, slug, available, ...(available ? {} : { reason: "taken" }), suggestions });
    } catch (err) {
      console.error("APP ADDRESS CHECK ERROR:", err.response?.data || err.message);
      return res.status(503).json({ error: "Couldn't check that address right now. Please try again." });
    }
  });

  return router;
};
```

- [ ] **Step 6: Mount it.** In `backend/server.js`, directly after `app.use(require('./routes/ordersRoutes')(routeContext));` add:

```js
app.use(require('./routes/appsRoutes')(routeContext));
```

- [ ] **Step 7: Wire app orders into `POST /api/orders`.** In `backend/routes/ordersRoutes.js`:
  1. Near the other top-level requires, add (plain assignments, per the file's own note about its static wiring check):

     ```js
     const validateAppOrder = require("../services/apps/appOrder").validateAppOrder;
     const tenantSlugs = require("../services/apps/tenantSlugStore");
     const suggestSlugs = require("../services/apps/shopAddress").suggestSlugs;
     ```
  2. Inside `router.post("/api/orders", …)`, replace the block from `const client = frappeClient();` down to the `return res.json({ ok: true, order: … });` line with:

```js
      const client = frappeClient();

      // App orders (Murzak POS tiers): validate the shop address and enforce
      // one live shop per app before reserving anything.
      let app = null;
      try {
        const acct = await fetchWebAccount(client, webAccountName);
        app = validateAppOrder({
          serviceId,
          config,
          existingServiceRows: normalizeExistingAccountServiceRows(asArray(acct?.[WEB_ACCOUNT_SERVICES_FIELD])),
        });
      } catch (e) {
        if (e.code) return res.status(e.statusCode).json({ error: e.message, code: e.code });
        throw e;
      }
      const nowMs = Date.now();
      if (app && !(await tenantSlugs.isSlugAvailable(client, app.slug, nowMs))) {
        return res.status(409).json({
          error: "That shop address was just taken.",
          code: "slug_taken",
          suggestions: suggestSlugs(app.slug),
        });
      }

      const fleetReservedRamMb = (await getReservedRamMb(client)) || 0;
      const normalizedTerm = normalizeBillingTerm(billingTerm);
      const storedConfig = {
        ...(config || {}),
        billingTerm: normalizedTerm,
        ...(app ? { app: app.app, slug: app.slug, shopName: app.shopName } : {}),
      };

      const order = await createOrder({
        client,
        webAccountName,
        serviceId,
        config: storedConfig,
        planKey,
        source,
        fleetReservedRamMb,
        nowMs,
      });

      if (app) {
        try {
          await tenantSlugs.reserveSlug(client, {
            slug: app.slug, app: app.app, webAccount: webAccountName, orderId: order.id, nowMs,
          });
        } catch (e) {
          // Lost the race for the name after the order was minted — release the
          // order's RAM reservation too, so a failed attempt holds nothing.
          await cancelOrder({ client, webAccountName, orderId: order.id }).catch(() => {});
          if (e.code === "slug_taken") {
            return res.status(409).json({ error: e.message, code: e.code, suggestions: suggestSlugs(app.slug) });
          }
          throw e;
        }
      }

      return res.json({ ok: true, order: { ...order, billingTerm: normalizedTerm } });
```

- [ ] **Step 8: Heartbeat the slug.** In `router.get("/api/orders/:id", …)`, directly after the `const order = await getOrder({...renew: true});` statement, add:

```js
      if (order.status === "Draft" && order.config?.app && order.config?.slug) {
        await tenantSlugs.touchSlug(client, { slug: order.config.slug, webAccount: webAccountName, nowMs: Date.now() });
      }
```

- [ ] **Step 9: Link the slug to the invoice.** In `prepare-payment`, directly after `await linkInvoice({ client, orderId, invoiceDocName });` add:

```js
      if (order.config?.app && order.config?.slug) {
        await tenantSlugs.linkSlugInvoice(client, {
          slug: order.config.slug, webAccount: webAccountName, invoiceDocName, nowMs,
        });
      }
```

- [ ] **Step 10: Run the route and wiring suites**

Run: `cd backend && node test/appOrder.test.js && node test/ordersRoutes.test.js && node test/routesContext.test.js`
Expected: all `0 failed`. If `routesContext.test.js` reports `appsRoutes` keys missing, it confirms `frappeClient` must exist on `routeContext`. It already does (ordersRoutes uses it); in that case re-check the destructure spelling.

- [ ] **Step 11: Let the shared mock name Tenant Slugs by slug.** In `backend/test/helpers/mockFrappe.js`, find the `post:` handler where the new doc's name is computed (it uses `prefixFor(doctype)` and `++seq`). Wrap that so a `Tenant Slug` is named by its `slug`, and a duplicate insert 409s the way Frappe's unique name does:

```js
      // Tenant Slug is autonamed by its slug (field:slug), so the name IS the
      // uniqueness guarantee — mirror Frappe's 409 on a duplicate.
      if (doctype === "Tenant Slug") {
        if (store[doctype][body.slug]) {
          const e = new Error("DuplicateEntryError");
          e.response = { status: 409 };
          throw e;
        }
        store[doctype][body.slug] = { name: body.slug, ...body };
        posts.push({ url, body });
        return { data: { data: store[doctype][body.slug] } };
      }
```

  Place it as the first statement after `if (!store[doctype]) store[doctype] = {};` inside `post:`. Run `cd backend && npm test`; every existing test must still pass, because nothing else posts that doctype.

- [ ] **Step 12: Route test for app orders.** Append inside the async IIFE of `backend/test/ordersRoutes.test.js`, before its final summary, reusing that file's `makeMockFrappe`, `createOrdersRouter`, `baseCtx`, `findHandler` and `makeRes`:

```js
  section("POST /api/orders — POS tier reserves the shop address");
  {
    const client = makeMockFrappe();
    const router = createOrdersRouter(baseCtx(client));
    const handler = findHandler(router, "post", "/api/orders");

    const res = makeRes();
    await handler({
      session: { webAccount: "acct-pos-1" },
      body: { serviceId: "biz-pos-duka", billingTerm: "monthly", planKey: "Business", source: "app-checkout",
              config: { shopName: "Mama Njeri", slug: "mamanjeri" } },
    }, res);
    ok(res.statusCode === 200, "POS order created");
    ok(res.body?.order?.monthlyKes === 2500, "priced server-side from the Duka tier");
    ok(res.body?.order?.config?.app === "pos" && res.body?.order?.config?.slug === "mamanjeri", "order carries app + slug");
    const slugDoc = client.store["Tenant Slug"]?.mamanjeri;
    ok(slugDoc?.status === "reserved" && slugDoc?.web_account === "acct-pos-1", "slug reserved for the buyer");

    const res2 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-2" },
      body: { serviceId: "biz-pos-chain", billingTerm: "monthly", planKey: "Business",
              config: { shopName: "Other", slug: "mamanjeri" } },
    }, res2);
    ok(res2.statusCode === 409 && res2.body?.code === "slug_taken", "a second account is refused the same address");
    ok(Array.isArray(res2.body?.suggestions) && res2.body.suggestions.length > 0, "with suggestions");

    const res3 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-3" },
      body: { serviceId: "biz-pos-duka", config: { shopName: "X", slug: "api" } },
    }, res3);
    ok(res3.statusCode === 400 && res3.body?.code === "slug_invalid", "reserved address refused with 400");

    const res4 = makeRes();
    await handler({
      session: { webAccount: "acct-pos-4" },
      body: { serviceId: "biz-pos-duka", amount: 1, monthlyKes: 1, config: { shopName: "Cheap", slug: "cheap-shop" } },
    }, res4);
    ok(res4.body?.order?.monthlyKes === 2500, "client-sent amounts are ignored");
  }
```

Run: `cd backend && node test/ordersRoutes.test.js`
Expected: `0 failed`. If `baseCtx` has no `fetchWebAccount` that resolves for unknown accounts, it returns `null`; `asArray(null?.[…])` gives `[]`, which is correct for a first purchase.

- [ ] **Step 13: Add to the suite** (` && node test/appOrder.test.js`), **run the whole suite, then commit**

Run: `cd backend && npm test`
Expected: all pass.

```bash
git add backend/services/apps/appOrder.js backend/routes/appsRoutes.js backend/routes/ordersRoutes.js backend/server.js backend/test/appOrder.test.js backend/test/ordersRoutes.test.js backend/test/helpers/mockFrappe.js backend/package.json
git commit -m "feat(app-checkout): shop address check and app orders

GET /api/apps/:app/address is public; POST /api/orders validates the
address, enforces one live shop per app, reserves the slug with the
order (and releases the order if the name is lost to a race). The
checkout heartbeat renews the slug; prepare-payment links it to the
invoice for a 24h payment grace.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Carry the address onto the Provisioning Job

**Files:**
- Modify: `backend/data/doctype-provisioning-job.json` (new field `site_slug`)
- Modify: `backend/services/provisioning/provisioningService.js`, `enqueueProvisioningForInvoice` (~line 192–260)
- Test: `backend/test/provisioning.test.js` (existing; extend)

**Interfaces:**
- Consumes: `activateSlugForInvoice(client, invoiceDocName)` (Task 4).
- Produces: Provisioning Job docs for app tiers carry `site_slug: "<slug>"`. Non-app jobs never carry the key.

- [ ] **Step 1: Add the field to the fixture.** In `backend/data/doctype-provisioning-job.json` `fields`, insert directly after the `app_port` field object:

```json
    { "fieldname": "site_slug", "fieldtype": "Data", "label": "Site Slug", "description": "Customer-chosen app address (Murzak POS): the bench site becomes <site_slug>.erp.murzaktech.tech and the POS <site_slug>.pos.murzaktech.tech. Empty = derive from the account (pre-app-checkout behaviour). Read by murzak-bench-runner as JOB_SITE_SLUG." },
```

- [ ] **Step 2: Write the failing test.** In `backend/test/provisioning.test.js`, find the existing section that calls `enqueueProvisioningForInvoice` with a mock client and copy its client setup. Add a new section:

```js
  section("app tiers carry the customer-chosen address onto the job");
  {
    const posted = [];
    const client = {
      get: async (url, opts) => {
        if (/Tenant(%20| )Slug$/.test(url)) {
          return { data: { data: [{ name: "mamanjeri", slug: "mamanjeri", status: "reserved" }] } };
        }
        if (/Provisioning(%20| )Job$/.test(url)) return { data: { data: [] } }; // no existing job
        return { data: { data: {} } };
      },
      post: async (url, body) => { posted.push(body); return { data: { data: { name: `JOB-${posted.length}`, ...body } } }; },
      put: async () => ({ data: { data: {} } }),
    };
    await enqueueProvisioningForInvoice({ client, webAccount: "A", invoiceDocName: "PINV-1", serviceIds: ["biz-pos-duka"] });
    const job = posted.find((b) => b.service_id === "biz-pos-duka");
    ok(job?.site_slug === "mamanjeri", "POS job carries site_slug from the Tenant Slug linked to the invoice");

    posted.length = 0;
    await enqueueProvisioningForInvoice({ client, webAccount: "A", invoiceDocName: "PINV-2", serviceIds: ["biz-erp-light"] });
    ok(posted.every((b) => !("site_slug" in b)), "non-app jobs never get a site_slug");
  }
```

If the existing suite's enqueue tests need extra stubs (capacity/scaling), reuse the exact stubs that section already sets up rather than these minimal ones.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && node test/provisioning.test.js`
Expected: `FAIL: POS job carries site_slug …`.

- [ ] **Step 4: Implement.** In `enqueueProvisioningForInvoice`:
  1. Directly before the `for (const { serviceId, domainChoice } of services) {` loop, add the block below. The require is lazy, like the existing `require("./scaling")` a few lines up: `tenantSlugStore → orderStore → provisioning/capacity` would otherwise risk a load-time require cycle.

```js
  // App tiers (Murzak POS): the address the buyer chose rides on the job.
  // Looked up once per invoice — one app order, one invoice, one slug.
  // Activating it here (payment confirmed) makes the name theirs for good.
  let appSiteSlug = null;
  if (ids.some((id) => getServiceMeta(id)?.app)) {
    try {
      const tenantSlugs = require("../apps/tenantSlugStore");
      appSiteSlug = await tenantSlugs.activateSlugForInvoice(client, invoiceDocName);
    } catch (e) {
      console.warn(`[provisioning] Tenant Slug lookup failed for ${invoiceDocName}: ${e.message}`);
    }
  }
```

  2. Directly after the `const payload = buildJobPayload({ … });` statement inside the loop, add:

```js
    if (appSiteSlug && getServiceMeta(serviceId)?.app) payload.site_slug = appSiteSlug;
```

  If the lookup fails, the job still provisions under the account-derived name, so the shop is still built. The customer sees that address in the portal.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd backend && node test/provisioning.test.js && npm test`
Expected: `0 failed` everywhere.

- [ ] **Step 6: Commit**

```bash
git add backend/data/doctype-provisioning-job.json backend/services/provisioning/provisioningService.js backend/test/provisioning.test.js
git commit -m "feat(app-checkout): carry the chosen shop address onto the Provisioning Job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Host scripts use the chosen address

**Files:**
- Modify: `deploy/vps/bin/murzak-bench-runner`: the job fetch `fields` (~line 136) and the per-job env (~line 155–200)
- Modify: `deploy/vps/bin/murzak-bench-provision`: section 2 (site name, ~line 70–80), plus an ownership marker after site creation

**Interfaces:**
- Consumes: Provisioning Job `site_slug` (Task 6).
- Produces: `murzak-bench-provision` honours `JOB_SITE_SLUG` and stamps `murzak_web_account` into the site config. It refuses (exit 2) to adopt a site whose stamp names another account.

- [ ] **Step 1: Runner reads and passes the slug.** In `murzak-bench-runner`:
  1. In the fetch, change the fields list to:
     ```bash
     --data-urlencode 'fields=["name","web_account","invoice","service_id","service_name","attempts","site_slug"]' \
     ```
  2. In the per-job loop, after `attempts="$(jq -r '.attempts // 0' <<<"$job")"` add:
     ```bash
     site_slug="$(jq -r '.site_slug // ""' <<<"$job")"
     ```
  3. In the `out="$(JOB_WEB_ACCOUNT=… /usr/local/bin/murzak-bench-provision …)"` invocation, add `JOB_SITE_SLUG="$site_slug" \` on the line after `JOB_OWNER_EMAIL=… JOB_OWNER_NAME=… \`.

- [ ] **Step 2: Provisioner uses it.** In `murzak-bench-provision`:
  1. In the header contract comment, after the `JOB_OWNER_NAME` line, add:
     ```bash
     #              JOB_SITE_SLUG     customer-chosen address (optional); site
     #                                becomes <slug>.erp…, POS <slug>.pos…
     ```
  2. Replace the `slug="$(printf '%s' "$JOB_WEB_ACCOUNT" … | cut -c1-40)"` assignment and its `[ -n "$slug" ] || refuse …` line with:

```bash
if [ -n "${JOB_SITE_SLUG:-}" ]; then
  # Chosen by the customer at checkout and already validated server-side
  # (services/apps/shopAddress.js) — re-checked here because this script
  # builds hostnames from it.
  slug="$JOB_SITE_SLUG"
  printf '%s' "$slug" | grep -Eq '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' \
    || refuse "JOB_SITE_SLUG '${slug}' is not a valid site name"
else
  slug="$(printf '%s' "$JOB_WEB_ACCOUNT" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9-]/-/g' -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//' \
    | cut -c1-40)"
fi
[ -n "$slug" ] || refuse "JOB_WEB_ACCOUNT '${JOB_WEB_ACCOUNT}' has no usable hostname characters"
```

  3. Ownership guard. In section 4, replace the line `log "site already exists — adopting it, not recreating"` with:

```bash
  owner="$(python3 -c "import json;print(json.load(open('${BENCH_DIR}/sites/${SITE}/site_config.json')).get('murzak_web_account',''))" 2>/dev/null || true)"
  if [ -n "$owner" ] && [ "$owner" != "$JOB_WEB_ACCOUNT" ]; then
    refuse "site ${SITE} belongs to account ${owner}, not ${JOB_WEB_ACCOUNT} — never adopting another customer's site"
  fi
  log "site already exists — adopting it, not recreating"
```

  4. Stamp ownership. Directly after the `fi` that closes the site-creation `if/else` in section 4, add:

```bash
benchctl "bench --site '$SITE' set-config murzak_web_account '$JOB_WEB_ACCOUNT'" >&2 \
  || die "could not record the owning account on ${SITE} (retryable)"
```

- [ ] **Step 3: Syntax check**

Run: `bash -n deploy/vps/bin/murzak-bench-provision && bash -n deploy/vps/bin/murzak-bench-runner && echo OK`
Expected: `OK`.

- [ ] **Step 4: Prove it on the VPS with a throwaway shop.** This does not touch the live scripts.

```bash
scp -i ~/.ssh/murzak_vps deploy/vps/bin/murzak-bench-provision ubuntu@187.124.217.78:/tmp/murzak-bench-provision.new
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'sudo bash -c "chmod 755 /tmp/murzak-bench-provision.new; JOB_WEB_ACCOUNT=plan-test-acct JOB_SERVICE_ID=biz-pos-duka JOB_BENCH_APPS=erpnext,techsavanna_pos,kenya_compliance JOB_OWNER_EMAIL=plan-test@murzaktech.tech JOB_OWNER_NAME=\"Plan Test\" JOB_SITE_SLUG=plantest-shop BENCH_DB_ROOT_PASSWORD=\$(cat /root/.murzak-db-root-password) /tmp/murzak-bench-provision.new 2>/tmp/pt.log | tail -1 | python3 -c \"import json,sys;d=json.load(sys.stdin);print(d[\\\"site\\\"],d[\\\"url\\\"])\""'
```
Expected: `plantest-shop.erp.murzaktech.tech https://plantest-shop.pos.murzaktech.tech`.

Then check that the ownership guard refuses a different account (expect `EXIT 2`), drop the site, and clean up:

```bash
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'sudo bash -c "JOB_WEB_ACCOUNT=someone-else JOB_SERVICE_ID=biz-pos-duka JOB_BENCH_APPS=erpnext,techsavanna_pos,kenya_compliance JOB_OWNER_EMAIL=x@murzaktech.tech JOB_SITE_SLUG=plantest-shop BENCH_DB_ROOT_PASSWORD=\$(cat /root/.murzak-db-root-password) /tmp/murzak-bench-provision.new >/dev/null 2>&1; echo EXIT \$?; export DBRP=\$(cat /root/.murzak-db-root-password); sudo -u murzakerp --preserve-env=DBRP bash -lc \"cd /home/murzakerp/frappe-bench && bench drop-site plantest-shop.erp.murzaktech.tech --db-root-password \\\"\\\$DBRP\\\" --no-backup --force\" >/dev/null 2>&1; rm -rf /home/murzakerp/frappe-bench/archived/sites/plantest-shop.erp.murzaktech.tech* /tmp/murzak-bench-provision.new /tmp/pt.log; echo CLEANED"'
```
Expected: `EXIT 2` then `CLEANED`.

- [ ] **Step 5: Commit** (do **not** install on the VPS yet; Task 8 owns ordering)

```bash
git add deploy/vps/bin/murzak-bench-provision deploy/vps/bin/murzak-bench-runner
git commit -m "feat(app-checkout): bench provisioner builds the customer-chosen address

JOB_SITE_SLUG overrides the account-derived site name; every site is
stamped with murzak_web_account and another account's site is never
adopted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Install the backend foundation on production, in a safe order

> **Rewritten after the final whole-branch review (2026-10-10).** The original order redeployed the website *before* the doctypes and host scripts were in place, and never updated the VPS copy of the catalog. Both would have shipped paid orders that are built wrongly or not at all. Follow this order exactly.

This is an ops task with no code. **Do not redeploy the website (Coolify) until Step 8.** Prerequisites: Tasks 1–7 are reviewed on the branch; the per-shop POS work (PR "feat: deploy Murzak POS per shop", `feat/pos-per-shop-deploy`) is merged to `master` first. See memory `murzaktech-live-deploy-topology` for how the website deploys (Coolify **Redeploy** of `murzak-website-automated`).

Steps 1–7 are additive and safe with the OLD website still running: the old code ignores the new doctype and field, and the new host scripts treat an empty `site_slug` as "derive the name from the account", exactly as before.

- [ ] **Step 1: Get the new doctype fixtures and installers into the running container.** The live container runs the OLD code and has no `doctype-tenant-slug.json`. From a checkout of this branch:

```bash
C=$(ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'sudo docker ps --format "{{.Names}}" | grep -m1 m97a6sejlizhpmvk5b77dhib')
scp -i ~/.ssh/murzak_vps backend/data/doctype-tenant-slug.json backend/data/doctype-provisioning-job.json backend/scripts/install-missing-doctypes.js backend/scripts/install-provisioning-doctype.js ubuntu@187.124.217.78:/tmp/
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 "for f in doctype-tenant-slug.json doctype-provisioning-job.json; do sudo docker cp /tmp/\$f $C:/app/backend/data/\$f; done; for f in install-missing-doctypes.js install-provisioning-doctype.js; do sudo docker cp /tmp/\$f $C:/app/backend/scripts/\$f; done"
```

- [ ] **Step 2: Install the doctypes on live Frappe** (from the website container, so the real env is used):

```bash
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'C=$(sudo docker ps --format "{{.Names}}" | grep -m1 m97a6sejlizhpmvk5b77dhib); sudo docker exec "$C" sh -c "cd /app/backend && node scripts/install-missing-doctypes.js && node scripts/install-provisioning-doctype.js"'
```
Expected: `Tenant Slug` created and `Provisioning Job` gained `site_slug`. Re-running reports nothing to add. (The copied files vanish on the next container rebuild, which is fine: the doctypes persist in Frappe.)

- [ ] **Step 3: Live schema check.** The dev mock accepts any field, so this is the real proof. Check the new doctype fields AND the fields the host runner's job query requests. Save this as a small script and run it inside the container:

```js
// /tmp/schema-check.js (run: docker exec <container> node /tmp/schema-check.js)
const axios = require("axios");
const h = { Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}` };
const b = process.env.FRAPPE_BASE_URL;
const q = (doctype, fields) =>
  axios.get(`${b}/api/resource/${encodeURIComponent(doctype)}`, {
    headers: h,
    params: { limit_page_length: 1, fields: JSON.stringify(fields) },
  });
Promise.all([
  q("Tenant Slug", ["name", "slug", "status", "invoice", "expires_at", "web_account", "app"]),
  q("Provisioning Job", ["name", "web_account", "invoice", "service_id", "service_name", "attempts", "site_slug"]),
]).then((r) => {
  if (!r.every((x) => Array.isArray(x.data.data))) throw new Error("no data array");
  console.log("SCHEMA OK");
}).catch((e) => {
  console.error("SCHEMA FAIL", e.response && e.response.status, (e.response && e.response.data && e.response.data.exception) || e.message);
  process.exit(1);
});
```
Expected: `SCHEMA OK`. A `417` names the missing field. Fix the install and re-run; **do not continue until this passes** (the new runner requests `site_slug`; without the field it cannot list jobs).

- [ ] **Step 4: Copy the NEW catalog snapshot to the VPS.** The host runner reads `benchApps` from its own copy. Without this, every paid Duka and Chain job is marked permanent ("no benchApps declared") and never built; Biashara only works because it reuses the old id.

```bash
node backend/scripts/generate-catalog-snapshot.js && git diff --exit-code backend/data/serviceCatalogSnapshot.json
scp -i ~/.ssh/murzak_vps backend/data/serviceCatalogSnapshot.json ubuntu@187.124.217.78:/tmp/bench-catalog-snapshot.json
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'sudo cp -a /etc/murzak/bench-catalog-snapshot.json /root/bench-catalog-snapshot.json.bak-$(date +%Y%m%d%H%M%S) && sudo install -m0644 -o root -g root /tmp/bench-catalog-snapshot.json /etc/murzak/bench-catalog-snapshot.json && for id in biz-pos-duka biz-pos-inventory biz-pos-chain; do printf "%s: " $id; sudo jq -c ".items[\"$id\"].benchApps" /etc/murzak/bench-catalog-snapshot.json; done'
```
Expected: the `git diff --exit-code` passes (the committed snapshot is in sync) and all three ids print `["erpnext","techsavanna_pos","kenya_compliance"]`.

- [ ] **Step 5: Install the host scripts** (with backups):

```bash
scp -i ~/.ssh/murzak_vps deploy/vps/bin/murzak-bench-provision deploy/vps/bin/murzak-bench-runner ubuntu@187.124.217.78:/tmp/
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'set -e; TS=$(date +%Y%m%d%H%M%S); for f in murzak-bench-provision murzak-bench-runner; do sudo cp -a /usr/local/bin/$f /root/$f.bak-$TS; sudo install -m0755 -o root -g root /tmp/$f /usr/local/bin/$f; done; echo INSTALLED $TS'
```

- [ ] **Step 6: Confirm the next scheduled runner run is healthy.** The new runner exits non-zero with `FATAL: job query failed` when the Provisioning Job query errors, so look for that explicitly, not only for "found N":

```bash
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'S=$(date "+%Y-%m-%d %H:%M:%S"); until sudo journalctl -u murzak-bench-runner.service --since "$S" --no-pager | grep -qE "run complete|found [0-9]+ bench job|FATAL"; do sleep 5; done; sudo journalctl -u murzak-bench-runner.service --since "$S" --no-pager | tail -5'
```
Expected: `found N bench job(s) eligible for this run`, no `FATAL`. On `FATAL`, restore the `.bak-$TS` copies straight away.

- [ ] **Step 7: Check the website container's environment.** The in-container bench lane must stay off, and its attempts limit must not exceed the host runner's:

```bash
ssh -i ~/.ssh/murzak_vps ubuntu@187.124.217.78 'C=$(sudo docker ps --format "{{.Names}}" | grep -m1 m97a6sejlizhpmvk5b77dhib); sudo docker exec "$C" sh -c "printenv | grep -E \"^(BENCH_PROVISION_CMD|PROVISIONING_TARGETS|PROVISIONING_MAX_ATTEMPTS)=\" | cut -c1-80"; sudo systemctl show murzak-bench-runner.service -p Environment'
```
Expected: `BENCH_PROVISION_CMD` unset and no `benchCmd` in `PROVISIONING_TARGETS` (deliberate: the container never runs bench jobs; the code now also refuses POS shops there). `PROVISIONING_MAX_ATTEMPTS`, if set on either side, must match (default 3).

- [ ] **Step 8: NOW merge to `master` and redeploy the website** (Coolify → `murzak-website-automated` → Redeploy). Then smoke test:
  - `/products/pos` shows Duka / Biashara / Chain at KES 2,500 / 4,500 / 8,500, with the annual toggle.
  - `/api/apps/pos/address?name=testshop` answers `available`; `?name=api` answers `reserved`.
  - `/pricing?configure=biz-pos-inventory` redirects to `/products/pos#plans`.
  - An existing customer's POS resource page in the portal is unchanged.

- [ ] **Step 9: The real purchase (Task 16).** This spends real money, so it needs the user's explicit go-ahead. Afterwards drop the test site (`bench drop-site`) and delete its `Tenant Slug` doc.

---

## Task 9: `AppPlans`, the tier cards on the product page

**Files:**
- Create: `frontend/src/components/apps/AppPlans.tsx`
- Modify: `frontend/src/pages/products/MurzakPOS.tsx` (hero CTA, final CTA, insert the plans section)
- Modify: `frontend/src/pages/Products.tsx:75` (`priceId` → `"biz-pos-duka"`, the "from" price)
- Modify: `frontend/src/pages/for/ForRetail.tsx:65-66` (price id and link)

**Interfaces:**
- Consumes: `servicesForApp`, `formatKes`, `AppId` (Task 1); `annualKes`, `ANNUAL_DISCOUNT_PCT`, `APP_CHECKOUT` (Task 2).
- Produces: `<AppPlans app="pos" onChoose={(serviceId, term) => void} />`, where `term` is `"monthly" | "annual"`. It renders `id="plans"` on its root `<section>` so `#plans` deep links land on it.

- [ ] **Step 1: Create** `frontend/src/components/apps/AppPlans.tsx`

```tsx
import React, { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { AppId, formatKes, servicesForApp, ServiceItem } from "../../config/serviceCatalog";
import { ANNUAL_DISCOUNT_PCT, annualKes } from "../../config/appCheckout";

export type BillingTerm = "monthly" | "annual";

interface AppPlansProps {
  app: AppId;
  onChoose: (serviceId: string, term: BillingTerm) => void;
}

function limitLine(n: number | null | undefined, one: string, many: string) {
  if (n == null) return `Unlimited ${many}`;
  return n === 1 ? `1 ${one}` : `Up to ${n.toLocaleString()} ${many}`;
}

/**
 * The app's tiers as cards, with a monthly/annual toggle. Data comes straight
 * from the catalog (one item per tier), so prices here are the prices billed.
 */
const AppPlans: React.FC<AppPlansProps> = ({ app, onChoose }) => {
  const [term, setTerm] = useState<BillingTerm>("monthly");
  const tiers = servicesForApp(app);

  const price = (s: ServiceItem) => {
    const monthly = s.pricing.monthlyKes ?? 0;
    return term === "annual"
      ? { amount: formatKes(annualKes(monthly)), per: "/year" }
      : { amount: formatKes(monthly), per: "/month" };
  };

  return (
    <section id="plans" className="py-20 scroll-mt-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex justify-center mb-10">
          <div role="radiogroup" aria-label="Billing" className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-murzak-border">
            {(["monthly", "annual"] as BillingTerm[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={term === t}
                onClick={() => setTerm(t)}
                className={`px-5 py-2.5 rounded-xl text-sm font-black transition ${
                  term === t ? "bg-white dark:bg-murzak-surface text-murzak-ink dark:text-slate-100 shadow" : "text-slate-500"
                }`}
              >
                {t === "monthly" ? "Monthly" : (
                  <>Annual <span className="ml-1 text-emerald-600 dark:text-emerald-400">Save {ANNUAL_DISCOUNT_PCT}%</span></>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {tiers.map((s) => {
            const p = price(s);
            return (
              <article
                key={s.id}
                className={`relative flex flex-col rounded-3xl border p-7 bg-white/80 dark:bg-white/5 ${
                  s.appPopular ? "border-murzak-accent shadow-xl md:-translate-y-2" : "border-slate-200 dark:border-murzak-border"
                }`}
              >
                {s.appPopular && (
                  <span className="absolute -top-3 left-7 px-3 py-1 rounded-full bg-murzak-accent text-murzak-ink text-micro font-black uppercase">
                    Most popular
                  </span>
                )}
                <h3 className="text-2xl font-black text-murzak-ink dark:text-slate-100">{s.appPlan}</h3>
                <p className="text-slate-500 font-semibold">{s.appTagline}</p>
                <p className="mt-6">
                  <span className="text-4xl font-black text-murzak-ink dark:text-slate-100">{p.amount}</span>
                  <span className="text-slate-500 font-bold">{p.per}</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm font-semibold text-slate-600 dark:text-slate-300 flex-1">
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.branches, "branch", "branches")}</li>
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.users, "staff login", "staff logins")}</li>
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.products, "product", "products")}</li>
                  {(s.highlights || []).map((h) => (
                    <li key={h} className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{h}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onChoose(s.id, term)}
                  className={`mt-8 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm ${
                    s.appPopular ? "bg-murzak-accent text-murzak-ink" : "border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100"
                  }`}
                >
                  Start with {s.appPlan} <ArrowRight size={16} />
                </button>
              </article>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm font-semibold text-slate-500">
          Your own private POS · 14-day money-back · Pay with M-Pesa · No setup fee
        </p>
      </div>
    </section>
  );
};

export default AppPlans;
```

- [ ] **Step 2: Wire the POS page.** In `frontend/src/pages/products/MurzakPOS.tsx`:
  1. Import: `import AppPlans from "../../components/apps/AppPlans";`
  2. Replace the hero `<Button onClick={() => onNavigate('/pricing?configure=biz-pos-inventory')}>Start from … </Button>` with:

```tsx
            <Button onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
              See prices <ArrowRight size={18} />
            </Button>
```

     The copy says "See prices", not "See plans": the storefront rule bans "plan".
  3. Replace the final-CTA `<Button variant="primary" onClick={() => onNavigate('/pricing?configure=biz-pos-inventory')}>Configure POS …</Button>` with the same "See prices" button.
  4. Insert, immediately before the `{/* Final CTA */}` comment:

```tsx
      <AppPlans
        app="pos"
        onChoose={(serviceId, term) => onNavigate(`/get/pos?service=${encodeURIComponent(serviceId)}&term=${term}`)}
      />
```

  5. Change the hero line under the buttons, added 2026-10-08, to: `Your own private POS at yourshop.pos.murzaktech.tech, ready minutes after payment.`
  6. If `formatKes`/`serviceMonthlyKes` imports are now unused in this file, remove them.

- [ ] **Step 3: Cheapest "from" price elsewhere**
  - In `frontend/src/pages/Products.tsx:75`, set `priceId: "biz-pos-duka"`.
  - In `frontend/src/pages/for/ForRetail.tsx`, use `serviceMonthlyKes('biz-pos-duka')` in the price line, and change its button's `onNavigate('/pricing?configure=biz-pos-inventory')` to `onNavigate('/products/pos#plans')`.

- [ ] **Step 4: Check that `#plans` is honoured on arrival.** `onNavigate('/products/pos#plans')` must scroll. If `MurzakPOS` has no hash handler, add one at the top of the component:

```tsx
  React.useEffect(() => {
    if (window.location.hash === "#plans") {
      requestAnimationFrame(() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" }));
    }
  }, []);
```

- [ ] **Step 5: Type-check, build, and look at it**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: clean.

Then start the dev preview (`preview_start` with the project's dev-server name from `.claude/launch.json`) and open `/products/pos`. Check:
- three cards: Duka KES 2,500, Biashara KES 4,500 (Most popular), Chain KES 8,500;
- the Annual toggle shows KES 24,000 / 43,200 / 81,600 per year;
- at 375 px width the cards stack;
- dark mode is readable.

Screenshot each.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/apps/AppPlans.tsx frontend/src/pages/products/MurzakPOS.tsx frontend/src/pages/Products.tsx frontend/src/pages/for/ForRetail.tsx
git commit -m "feat(app-checkout): POS tier cards with monthly/annual toggle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Frontend app-checkout service, and `ShopAddressField`

**Files:**
- Create: `frontend/src/services/appCheckout.ts`
- Create: `frontend/src/components/apps/ShopAddressField.tsx`

**Interfaces:**
- Consumes: `GET /api/apps/:app/address`, `POST /api/orders` (Task 5); `toUserMessage` (`services/errors.ts`); `APP_CHECKOUT` (Task 2).
- Produces:
  - `checkShopAddress(app: AppId, name: string): Promise<AddressCheck>` where `AddressCheck = { slug: string; available: boolean; reason?: "too_short" | "too_long" | "invalid" | "reserved" | "taken"; suggestions: string[] }`
  - `createAppOrder(args: { serviceId: string; term: "monthly" | "annual"; shopName: string; slug: string }): Promise<{ orderId: string }>`. It throws `AppOrderError` with `.code` (`"slug_taken" | "slug_invalid" | "APP_EXISTS" | "CAPACITY" | string`) and `.suggestions: string[]`.
  - `<ShopAddressField app shopName onShopNameChange onSlugChange suggestionsFromServer? />`. It calls `onSlugChange(slug | null)`, with `null` meaning "not usable yet".

- [ ] **Step 1: Create** `frontend/src/services/appCheckout.ts`

```ts
import { AppId, planForService } from "../config/serviceCatalog";
import { toUserMessage } from "./errors";

export interface AddressCheck {
  slug: string;
  available: boolean;
  reason?: "too_short" | "too_long" | "invalid" | "reserved" | "taken";
  suggestions: string[];
}

export class AppOrderError extends Error {
  code: string;
  suggestions: string[];
  constructor(message: string, code: string, suggestions: string[] = []) {
    super(message);
    this.code = code;
    this.suggestions = suggestions;
  }
}

export async function checkShopAddress(app: AppId, name: string): Promise<AddressCheck> {
  const res = await fetch(`/api/apps/${app}/address?name=${encodeURIComponent(name)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage(data?.error, "Couldn't check that address right now."));
  return { slug: data.slug, available: !!data.available, reason: data.reason, suggestions: data.suggestions || [] };
}

export async function createAppOrder(args: {
  serviceId: string;
  term: "monthly" | "annual";
  shopName: string;
  slug: string;
}): Promise<{ orderId: string }> {
  const res = await fetch("/api/orders", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: args.serviceId,
      billingTerm: args.term,
      planKey: planForService(args.serviceId) || "Business",
      source: "app-checkout",
      config: { shopName: args.shopName, slug: args.slug },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppOrderError(
      toUserMessage(data?.error, "We couldn't start your order. Please try again."),
      data?.code || String(res.status),
      data?.suggestions || []
    );
  }
  return { orderId: data.order.id };
}
```

- [ ] **Step 2: Create** `frontend/src/components/apps/ShopAddressField.tsx`

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { AppId } from "../../config/serviceCatalog";
import { APP_CHECKOUT } from "../../config/appCheckout";
import { AddressCheck, checkShopAddress } from "../../services/appCheckout";

interface ShopAddressFieldProps {
  app: AppId;
  shopName: string;
  onShopNameChange: (name: string) => void;
  /** The usable slug, or null while empty / checking / not available. */
  onSlugChange: (slug: string | null) => void;
  /** Suggestions returned by a failed order (409 slug_taken) — shown immediately. */
  suggestionsFromServer?: string[];
}

const REASON_COPY: Record<NonNullable<AddressCheck["reason"]>, string> = {
  too_short: "Use at least 3 letters or numbers.",
  too_long: "That's a bit long — 40 characters at most.",
  invalid: "Use letters, numbers and hyphens only.",
  reserved: "That address is reserved. Try another.",
  taken: "That address is taken.",
};

const ShopAddressField: React.FC<ShopAddressFieldProps> = ({
  app, shopName, onShopNameChange, onSlugChange, suggestionsFromServer,
}) => {
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const suffix = APP_CHECKOUT[app].addressSuffix;

  useEffect(() => {
    onSlugChange(null);
    setError("");
    if (!shopName.trim()) { setCheck(null); return; }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await checkShopAddress(app, shopName);
        if (mine !== seq.current) return;
        setCheck(r);
        onSlugChange(r.available ? r.slug : null);
      } catch (e: any) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopName, app]);

  const suggestions = suggestionsFromServer?.length ? suggestionsFromServer : check?.suggestions || [];

  return (
    <div>
      <label htmlFor="shop-name" className="block text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-2">
        Shop name
      </label>
      <input
        id="shop-name"
        value={shopName}
        onChange={(e) => onShopNameChange(e.target.value)}
        placeholder="e.g. Mama Njeri Stores"
        autoComplete="organization"
        className="w-full glass-input rounded-2xl px-5 py-4 text-lg font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
      />
      <div className="mt-2 min-h-[1.5rem] text-sm font-semibold" aria-live="polite">
        {checking && <span className="text-slate-500 inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Checking address…</span>}
        {!checking && check && check.slug && (
          <span className={check.available ? "text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5" : "text-red-500 inline-flex items-center gap-1.5"}>
            {check.available ? <Check size={14} /> : <AlertCircle size={14} />}
            <span className="font-mono">{check.slug}.{suffix}</span>
            {!check.available && check.reason && <span className="font-semibold"> — {REASON_COPY[check.reason]}</span>}
          </span>
        )}
        {!checking && error && <span className="text-red-500">{error}</span>}
      </div>
      {!checking && suggestions.length > 0 && (!check?.available || suggestionsFromServer?.length) && (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-sm font-semibold text-slate-500">Try:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onShopNameChange(s)}
              className="px-3 py-1 rounded-full border border-murzak-accent/40 text-sm font-bold text-murzak-ink dark:text-slate-100 hover:bg-murzak-accent/10"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShopAddressField;
```

Clicking a suggestion replaces the shop name with the slug itself. The address check then confirms it, and the buyer can keep or retype the friendlier name. The order sends `shopName` (what they typed) and `slug` (the checked address) separately.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/appCheckout.ts frontend/src/components/apps/ShopAddressField.tsx
git commit -m "feat(app-checkout): address check client and ShopAddressField

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: `InlineAccount`, sign up or sign in without leaving the page

**Files:**
- Create: `frontend/src/components/apps/InlineAccount.tsx`

**Interfaces:**
- Consumes: `POST /api/register` (body `{ name, company, email, password, purpose, plan: "None" }`, returns `{ user }`, sets the session cookie), `POST /api/login` (body `{ email, password }`, returns `{ user }`), and `toUserMessage`.
- Produces: `<InlineAccount user companyHint onSignedIn={(user) => void} />`. When `user` is set it renders "Signed in as … · not you?". "Not you?" links to `/login`. `companyHint` (the shop name) fills the `company` field `/api/register` requires.

- [ ] **Step 1: Confirm the register and login contracts** (the component depends on the exact field names)

Run: `cd backend && sed -n 46,60p routes/authRoutes.js && sed -n 255,275p routes/authRoutes.js`
Expected: `/api/register` reads `name`, `company`, `email`, `password`, `purpose` and `plan` from `req.body`, and `/api/login` reads `email` and `password`. If the names differ, use the real ones in Step 2.

- [ ] **Step 2: Create** `frontend/src/components/apps/InlineAccount.tsx`

```tsx
import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { toUserMessage } from "../../services/errors";

interface InlineAccountProps {
  user: { email?: string; name?: string } | null;
  /** Shop name — /api/register requires a company. */
  companyHint: string;
  onSignedIn: (user: any) => void;
}

type Mode = "signup" | "signin";

const InlineAccount: React.FC<InlineAccountProps> = ({ user, companyHint, onSignedIn }) => {
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user) {
    return (
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
        Signed in as <span className="font-black text-murzak-ink dark:text-slate-100">{user.email || user.name}</span> ·{" "}
        <a href="/login" className="text-murzak-accent font-black underline underline-offset-2">not you?</a>
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(mode === "signup" ? "/api/register" : "/api/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signup"
            ? { name, company: companyHint.trim() || name, email, password, purpose: "Murzak POS", plan: "None" }
            : { email, password }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && mode === "signup") {
        setMode("signin");
        setError("You already have an account with that email — sign in below.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Request failed");
      onSignedIn(data.user);
    } catch (err: any) {
      setError(toUserMessage(err, mode === "signup" ? "We couldn't create your account." : "We couldn't sign you in."));
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full glass-input rounded-2xl px-5 py-3.5 font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent";

  return (
    <form onSubmit={submit} className="space-y-3">
      {mode === "signup" && (
        <input aria-label="Your name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={input} />
      )}
      <input aria-label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className={input} />
      <input aria-label="Password" required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "signup" ? "Create a password (8+ characters)" : "Password"}
        autoComplete={mode === "signup" ? "new-password" : "current-password"} className={input} />
      {error && <p className="text-sm font-bold text-red-500" role="alert">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full px-6 py-3.5 rounded-2xl font-black text-sm border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {mode === "signup" ? "Create my account" : "Sign in"}
      </button>
      <p className="text-sm font-semibold text-slate-500">
        {mode === "signup" ? "Already have an account? " : "New to Murzak? "}
        <button type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}
          className="text-murzak-accent font-black underline underline-offset-2">
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
};

export default InlineAccount;
```

- [ ] **Step 3: Type-check and commit**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: clean.

```bash
git add frontend/src/components/apps/InlineAccount.tsx
git commit -m "feat(app-checkout): inline sign-up / sign-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: `/get/:app`, the "Set up your shop" page

**Files:**
- Create: `frontend/src/pages/apps/AppSetup.tsx`
- Modify: `frontend/src/App.tsx`: import it, add a public route `path="/get/:app"` next to `/products/pos` (~line 408), and give `pageToPath`/route-key handling an entry so the header renders normally.

**Interfaces:**
- Consumes:
  - `ShopAddressField`, `InlineAccount` (Tasks 10–11);
  - `createAppOrder`, `AppOrderError` (Task 10);
  - `APP_CHECKOUT`, `appIdFromRoute`, `annualKes` (Task 2);
  - `getService`, `servicesForApp`, `formatKes` (Task 1);
  - App props `user: User | null` and `onUserUpdate(user)` (`App.tsx` `handleUserUpdate`).
- Produces: navigates to `/checkout/<orderId>` on success. Query params read: `service` (a tier `serviceId`) and `term` (`monthly | annual`).

- [ ] **Step 1: Create** `frontend/src/pages/apps/AppSetup.tsx`

```tsx
import React, { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toUserMessage } from "../../services/errors";
import ShopAddressField from "../../components/apps/ShopAddressField";
import InlineAccount from "../../components/apps/InlineAccount";
import { formatKes, getService, servicesForApp } from "../../config/serviceCatalog";
import { APP_CHECKOUT, appIdFromRoute, annualKes } from "../../config/appCheckout";
import { AppOrderError, createAppOrder } from "../../services/appCheckout";

interface AppSetupProps {
  user: any | null;
  onUserUpdate: (user: any) => void;
}

type Term = "monthly" | "annual";

const AppSetup: React.FC<AppSetupProps> = ({ user, onUserUpdate }) => {
  const navigate = useNavigate();
  const app = appIdFromRoute(useParams<{ app: string }>().app);
  const [params] = useSearchParams();
  const tiers = useMemo(() => (app ? servicesForApp(app) : []), [app]);

  const requested = getService(params.get("service") || "");
  const [serviceId, setServiceId] = useState<string>(
    requested && requested.app === app ? requested.id : (tiers.find((t) => t.appPopular) || tiers[0])?.id || ""
  );
  const [term, setTerm] = useState<Term>(params.get("term") === "annual" ? "annual" : "monthly");
  const [shopName, setShopName] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([]);
  const [waitlisted, setWaitlisted] = useState(false);

  if (!app) return <Navigate to="/products" replace />;
  const info = APP_CHECKOUT[app];
  const tier = getService(serviceId);
  const monthly = tier?.pricing.monthlyKes ?? 0;
  const total = term === "annual" ? annualKes(monthly) : monthly;

  const canContinue = !!user && !!slug && !!shopName.trim() && !!tier && !submitting;

  const submit = async () => {
    if (!canContinue || !slug || !tier) return;
    setSubmitting(true);
    setError("");
    setErrorCode("");
    setServerSuggestions([]);
    try {
      const { orderId } = await createAppOrder({ serviceId: tier.id, term, shopName: shopName.trim(), slug });
      navigate(`/checkout/${encodeURIComponent(orderId)}`);
    } catch (e: any) {
      const err = e as AppOrderError;
      setError(err.message);
      setErrorCode(err.code || "");
      if (err.code === "slug_taken") setServerSuggestions(err.suggestions);
    } finally {
      setSubmitting(false);
    }
  };

  // CAPACITY only happens at order creation, which requires a signed-in
  // account — so the existing account-scoped waitlist route always applies.
  const joinWaitlist = async () => {
    try {
      const res = await fetch("/api/orders/waitlist", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setWaitlisted(true);
      setError("We're full right now — you're on the list and we'll message you as soon as a shop slot opens.");
    } catch (e: any) {
      setError(toUserMessage(e, "We couldn't add you to the waitlist. Please try again."));
    }
  };

  const onCta = errorCode === "CAPACITY" ? joinWaitlist : submit;
  const ctaDisabled = waitlisted || (errorCode !== "CAPACITY" && !canContinue);
  const ctaLabel = waitlisted
    ? "You're on the list"
    : errorCode === "CAPACITY"
      ? "Join the waitlist"
      : `Continue to payment · ${formatKes(total)}`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-32 lg:pb-16">
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-murzak-ink dark:text-slate-100">Set up your shop</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400 font-medium">{info.productName}, ready about two minutes after payment.</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8 order-2 lg:order-1">
          <section className="glass-card rounded-3xl p-6 sm:p-8">
            <ShopAddressField
              app={app}
              shopName={shopName}
              onShopNameChange={(n) => { setShopName(n); setServerSuggestions([]); }}
              onSlugChange={setSlug}
              suggestionsFromServer={serverSuggestions}
            />
          </section>

          <section className="glass-card rounded-3xl p-6 sm:p-8">
            <h2 className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-4">Your details</h2>
            <InlineAccount user={user} companyHint={shopName} onSignedIn={onUserUpdate} />
          </section>

          {errorCode === "APP_EXISTS" && (
            <section className="rounded-3xl border border-murzak-accent/30 bg-murzak-accent/5 p-6">
              <p className="font-black text-murzak-ink dark:text-slate-100">You already have a shop on this account.</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
                Open it, or change its tier, from your portal. Want a second, separate shop? Message support and we'll set it up.
              </p>
              <button type="button" onClick={() => navigate("/portal/overview")} className="mt-4 text-sm font-black text-murzak-accent underline underline-offset-2">
                Go to my portal →
              </button>
            </section>
          )}
        </div>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-28 self-start glass-card rounded-3xl p-6">
          <p className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400">Your order</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <label htmlFor="tier" className="sr-only">Tier</label>
            <select id="tier" value={serviceId} onChange={(e) => setServiceId(e.target.value)}
              className="glass-input rounded-xl px-3 py-2 font-black text-murzak-ink dark:text-slate-100">
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>{info.productName} · {t.appPlan}</option>
              ))}
            </select>
          </div>
          <div role="radiogroup" aria-label="Billing" className="mt-4 grid grid-cols-2 gap-2">
            {(["monthly", "annual"] as Term[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={term === t} onClick={() => setTerm(t)}
                className={`px-3 py-2 rounded-xl text-sm font-black border ${term === t ? "border-murzak-accent bg-murzak-accent/10 text-murzak-ink dark:text-slate-100" : "border-slate-200 dark:border-murzak-border text-slate-500"}`}>
                {t === "monthly" ? "Monthly" : "Annual · save 20%"}
              </button>
            ))}
          </div>
          {term === "annual" && (
            <p className="mt-2 text-xs font-semibold text-slate-500">Annual billing is available on your first purchase.</p>
          )}
          {slug && (
            <p className="mt-4 text-sm font-semibold text-slate-600 dark:text-slate-400 break-all">
              <span className="font-mono">{slug}.{info.addressSuffix}</span>
            </p>
          )}
          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-murzak-border flex items-baseline justify-between">
            <span className="font-black text-murzak-ink dark:text-slate-100">Due today</span>
            <span className="text-2xl font-black text-murzak-ink dark:text-slate-100">{formatKes(total)}</span>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-murzak-accent" /> 14-day money-back · Cancel anytime · Pay with M-Pesa
          </p>

          {error && errorCode !== "APP_EXISTS" && <p className="mt-4 text-sm font-bold text-red-500" role="alert">{error}</p>}

          <button type="button" onClick={onCta}
            disabled={ctaDisabled}
            className="hidden lg:flex mt-5 w-full items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-40">
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {ctaLabel} <ArrowRight size={16} />
          </button>
          {!user && <p className="hidden lg:block mt-2 text-xs font-semibold text-slate-500">Create your account or sign in to continue.</p>}
        </aside>
      </div>

      {/* Phone: sticky action bar */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 p-4 bg-white/95 dark:bg-murzak-bg/95 border-t border-slate-200 dark:border-murzak-border backdrop-blur">
        <button type="button" onClick={onCta}
          disabled={ctaDisabled}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-40">
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {ctaLabel}
        </button>
      </div>
    </div>
  );
};

export default AppSetup;
```

- [ ] **Step 2: Route it.** In `frontend/src/App.tsx`:
  1. Import: `import AppSetup from "./pages/apps/AppSetup";`
  2. After the `/products/pos` route, add:
     ```tsx
     <Route path="/get/:app" element={<AppSetup user={user} onUserUpdate={handleUserUpdate} />} />
     ```
  3. In the function that maps paths to page keys (it already special-cases `/checkout/` and `/portal`, ~line 120–134), add `if (location.pathname.startsWith("/get/")) return "products";`, and add `"/get/"` to `DYNAMIC_ROUTE_PREFIXES`. That keeps the header and nav state as on product pages.

- [ ] **Step 3: Type-check, build, and walk it in the preview**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: clean.

In the dev preview, check:
- `/products/pos` → **Start with Duka** → `/get/pos?service=biz-pos-duka&term=monthly`;
- type "Mama Njeri Stores" and see `mama-njeri-stores.pos.murzaktech.tech` with a tick;
- type "api" and see "reserved";
- signed out: the details form appears and the button is disabled until signed in;
- 375 px: the summary sits on top and the sticky bar at the bottom;
- dark mode is readable.

Screenshot each.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/apps/AppSetup.tsx frontend/src/App.tsx
git commit -m "feat(app-checkout): /get/:app set-up page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Checkout knows about app orders

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx`: the `billingTerm` initial state (~line 78), the order summary (~line 488–498), and the `PaymentMethods` `onSuccess` (~line 620)
- Modify: `frontend/src/App.tsx`, `handlePaymentSuccess` (~line 332)

**Interfaces:**
- Consumes: `order.config.app`, `order.config.slug`, `order.config.shopName`, `order.config.billingTerm` (Task 5); `APP_CHECKOUT` (Task 2).
- Produces: `handlePaymentSuccess(freshUser?: User, nextPath?: string)`. App orders land on `/welcome/<orderId>` after payment.

- [ ] **Step 1: Start the term selector on the buyer's choice.** In `Checkout.tsx`, where the loaded order is stored (the effect that calls `setLoading(false)` before `if (!ord.eligibleForTermChoice)`), add just before that `if`:

```ts
        if (ord.eligibleForTermChoice && ord.config?.billingTerm === "annual") setBillingTerm("annual");
```

- [ ] **Step 2: App summary.** In the order summary block, directly after the `{order.config?.domain ? (…) : null}` expression, add:

```tsx
            {order.config?.app && order.config?.slug ? (
              <p className="text-base font-black text-murzak-ink dark:text-slate-100 mt-1 break-all">
                {order.config.shopName ? `${order.config.shopName} · ` : ""}
                <span className="font-mono">{order.config.slug}.{APP_CHECKOUT[order.config.app as AppId]?.addressSuffix}</span>
              </p>
            ) : null}
```

  Add the imports: `import { APP_CHECKOUT } from '../config/appCheckout';` and `import { AppId } from '../config/serviceCatalog';`.

  Also hide the `· {order.tier}` size label for app orders. Change that span's condition to `order.tier && !order.config?.app`, so the buyer sees "Murzak POS — Duka" and not "· Medium".

- [ ] **Step 3: Land app orders on the welcome page.**
  - In `Checkout.tsx`, change the props interface to `onSuccess: (user?: any, nextPath?: string) => void;`, and on `<PaymentMethods … onSuccess={onSuccess} />` use:

    ```tsx
              onSuccess={(u?: any) => onSuccess(u, order.config?.app ? `/welcome/${encodeURIComponent(order.id)}` : undefined)}
    ```
  - In `App.tsx`, change `handlePaymentSuccess` to:

```tsx
  const handlePaymentSuccess = (freshUser?: User, nextPath?: string) => {
    if (freshUser) {
      setUser(freshUser);
    } else if (user) {
      setUser({ ...user, accountStatus: "Provisioning" as const });
    }
    // App orders go to their live set-up screen; everything else routes
    // through /thank-you (a stable URL for conversion pixels).
    navigate(nextPath || "/thank-you");
  };
```

- [ ] **Step 4: Type-check and commit**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: clean.

```bash
git add frontend/src/pages/Checkout.tsx frontend/src/App.tsx
git commit -m "feat(app-checkout): checkout shows the shop and lands on /welcome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: `/welcome/:orderId`, "Your shop is getting ready"

**Files:**
- Create: `frontend/src/pages/apps/AppWelcome.tsx`
- Modify: `frontend/src/App.tsx`, adding a route inside `RequireAuth` next to `/thank-you` (~line 455)

**Interfaces:**
- Consumes:
  - `GET /api/orders/:id` (`{ order: { serviceId, status, config } }`);
  - `fetchServiceActivity(serviceId)` (`services/serviceActivity.ts`, returns `ProvisioningActivityEntry[]` newest first, with `status`, `statusDetail`, `accessUrl`, `posLogin`);
  - `PosLoginPanel` (`components/portal/cloud/PosLoginPanel.tsx`, props `{ posUrl, login }`);
  - `APP_CHECKOUT`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Create** `frontend/src/pages/apps/AppWelcome.tsx`

```tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Loader2, ExternalLink, LifeBuoy } from "lucide-react";
import PosLoginPanel from "../../components/portal/cloud/PosLoginPanel";
import { fetchServiceActivity, ProvisioningActivityEntry } from "../../services/serviceActivity";
import { APP_CHECKOUT } from "../../config/appCheckout";
import { AppId } from "../../config/serviceCatalog";
import { toUserMessage } from "../../services/errors";

const POLL_MS = 5000;
// Typical POS setup is ~2 minutes; after this, say so honestly.
const SLOW_AFTER_MS = 6 * 60 * 1000;

type Stage = 0 | 1 | 2 | 3; // paid, creating, owner, ready

function stageOf(job: ProvisioningActivityEntry | null): Stage {
  if (!job) return 0;
  if (job.status === "active" && job.accessUrl) return 3;
  if (job.status === "running") return 2;
  return 1;
}

const AppWelcome: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<AppId | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [job, setJob] = useState<ProvisioningActivityEntry | null>(null);
  const [error, setError] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId || "")}`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Order not found");
        if (!data.order?.config?.app) { navigate("/thank-you", { replace: true }); return; }
        setApp(data.order.config.app);
        setServiceId(data.order.serviceId);
      } catch (e: any) {
        setError(toUserMessage(e, "We couldn't load your order."));
      }
    })();
  }, [orderId, navigate]);

  // Self-scheduling poll: each tick decides from its OWN fresh result whether
  // to schedule the next one, so it stops the moment the shop is ready (a
  // setInterval would read a stale `job` from its first render).
  useEffect(() => {
    if (!serviceId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let latest: ProvisioningActivityEntry | null = null;
      try {
        const jobs = await fetchServiceActivity(serviceId);
        latest = jobs[0] || null;
        if (!stop) setJob(latest);
      } catch {
        /* transient — try again next tick */
      }
      if (stop) return;
      setNow(Date.now());
      if (stageOf(latest) < 3) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [serviceId]);

  const stage = stageOf(job);
  const slow = stage < 3 && now - startedAt > SLOW_AFTER_MS;
  const stuck = job?.statusDetail === "needs_attention";
  const info = app ? APP_CHECKOUT[app] : null;
  const steps = ["Payment received", `Creating your private ${info?.productName || "app"}`, "Setting up your owner account", "Ready"];

  if (error) return <div className="max-w-xl mx-auto px-4 pt-32 text-red-500 font-bold">{error}</div>;

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 pt-28 pb-16">
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-murzak-ink dark:text-slate-100">
        {stage === 3 ? "Your shop is ready" : "Your shop is getting ready"}
      </h1>
      {stage < 3 && <p className="mt-2 font-medium text-slate-600 dark:text-slate-400">This usually takes about two minutes. You can stay here.</p>}

      <ol className="mt-8 space-y-3" aria-live="polite">
        {steps.map((label, i) => {
          const done = stage > i || stage === 3;
          const current = stage === i && stage < 3;
          return (
            <li key={label} className="flex items-center gap-3 font-bold">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center ${done ? "bg-emerald-500 text-white" : current ? "bg-murzak-accent/20 text-murzak-accent" : "bg-slate-100 dark:bg-white/5 text-slate-400"}`}>
                {done ? <Check size={16} /> : current ? <Loader2 size={16} className="animate-spin" /> : i + 1}
              </span>
              <span className={done || current ? "text-murzak-ink dark:text-slate-100" : "text-slate-400"}>{label}</span>
            </li>
          );
        })}
      </ol>

      {(slow || stuck) && (
        <div className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
          <p className="font-black text-murzak-ink dark:text-slate-100">Your payment is safe.</p>
          <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
            Setup is taking longer than usual and our team has been alerted. We'll finish it for you; your POS will also appear in your portal.
          </p>
          <button type="button" onClick={() => navigate("/portal/support")} className="mt-3 inline-flex items-center gap-1.5 text-sm font-black text-murzak-accent">
            <LifeBuoy size={14} /> Message support
          </button>
        </div>
      )}

      {stage === 3 && job?.accessUrl && (
        <>
          {job.posLogin && <PosLoginPanel posUrl={job.accessUrl} login={job.posLogin} />}
          <a href={job.accessUrl} target="_blank" rel="noopener noreferrer"
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black bg-murzak-accent text-murzak-ink">
            Open your POS <ExternalLink size={16} />
          </a>
          {info && <p className="mt-4 text-sm font-semibold text-slate-500">{info.afterPayment}</p>}
          <button type="button" onClick={() => navigate("/portal/overview")} className="mt-6 text-sm font-black text-murzak-accent underline underline-offset-2">
            Go to my portal
          </button>
        </>
      )}
    </div>
  );
};

export default AppWelcome;
```

Check that the portal support route exists before relying on `/portal/support`: `grep -n "portal/support\|\"support\"" frontend/src/App.tsx frontend/src/pages/Portal.tsx`. If the support tab lives at a different path, use that path.

- [ ] **Step 2: Route it.** In `App.tsx`, import `AppWelcome` and add next to the `/thank-you` route:

```tsx
              <Route
                path="/welcome/:orderId"
                element={
                  <RequireAuth user={user}>
                    <AppWelcome />
                  </RequireAuth>
                }
              />
```

Also add `"/welcome/"` to `DYNAMIC_ROUTE_PREFIXES`.

- [ ] **Step 3: Type-check, build, commit**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: clean.

```bash
git add frontend/src/pages/apps/AppWelcome.tsx frontend/src/App.tsx
git commit -m "feat(app-checkout): live welcome screen with POS login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: End-to-end test of the buyer path

**Files:**
- Create: `frontend/e2e/app-checkout.spec.ts`

**Interfaces:**
- Consumes: the running local stack (`frontend` on :5175 and `backend` on :3001 with `MOCK_FRAPPE`; see memory `murzaktech-local-dev-run`), and the UI from Tasks 9–13.

- [ ] **Step 1: Write the spec** `frontend/e2e/app-checkout.spec.ts`

```ts
import { test, expect } from '@playwright/test';

// App checkout (docs/superpowers/plans/2026-10-09-app-checkout-phase1-2.md):
// /products/pos -> tier -> /get/pos -> inline account -> order -> /checkout.

test.describe.configure({ timeout: 90_000 });

test('POS page shows the three tiers and the annual price', async ({ page }) => {
  await page.goto('/products/pos');
  const plans = page.locator('#plans');
  await expect(plans.getByRole('heading', { name: 'Duka' })).toBeVisible();
  await expect(plans.getByRole('heading', { name: 'Biashara' })).toBeVisible();
  await expect(plans.getByRole('heading', { name: 'Chain' })).toBeVisible();
  await expect(plans).toContainText('KES 2,500');
  await plans.getByRole('radio', { name: /Annual/ }).click();
  await expect(plans).toContainText('KES 24,000');
  await expect(page.locator('body')).not.toContainText(/\bplan\b/i);
});

test('signed-out buyer sets up a shop and reaches checkout', async ({ page }) => {
  const suffix = Math.floor(Math.random() * 1e6);
  await page.goto('/products/pos');
  await page.locator('#plans').getByRole('button', { name: 'Start with Duka' }).click();
  await expect(page).toHaveURL(/\/get\/pos\?service=biz-pos-duka&term=monthly/);

  await page.getByLabel('Shop name').fill(`E2E Duka ${suffix}`);
  await expect(page.getByText(`e2e-duka-${suffix}.pos.murzaktech.tech`)).toBeVisible({ timeout: 10_000 });

  const cta = page.getByRole('button', { name: /Continue to payment · KES 2,500/ }).last();
  await expect(cta).toBeDisabled();

  await page.getByLabel('Your name').fill('E2E Shopowner');
  await page.getByLabel('Email').fill(`e2e_pos_${suffix}@example.com`);
  await page.getByLabel('Password').fill('TestPassword123!');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible({ timeout: 15_000 });

  await expect(cta).toBeEnabled({ timeout: 10_000 });
  await cta.click();
  await expect(page).toHaveURL(/\/checkout\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByText('Murzak POS — Duka')).toBeVisible();
  await expect(page.getByText(`e2e-duka-${suffix}.pos.murzaktech.tech`)).toBeVisible();
});

test('reserved address is refused before any order', async ({ page }) => {
  await page.goto('/get/pos?service=biz-pos-chain&term=monthly');
  await page.getByLabel('Shop name').fill('api');
  await expect(page.getByText(/reserved/i)).toBeVisible({ timeout: 10_000 });
});

test('phone width: summary on top, sticky action bar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/get/pos?service=biz-pos-inventory&term=monthly');
  await expect(page.getByText('Your order')).toBeVisible();
  const bar = page.getByRole('button', { name: /Continue to payment/ }).last();
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box && box.y + box.height).toBeGreaterThan(700);
});
```

- [ ] **Step 2: Run it**

Run: `cd frontend && npx playwright test e2e/app-checkout.spec.ts --project=chromium`
Expected: 4 passed.

With `MOCK_FRAPPE`, the double must support `Tenant Slug` GET/POST. If `/api/apps/pos/address` returns 503 under the mock, add `Tenant Slug` handling to `backend/test/helpers/mockFrappe.js`, mirroring how it serves `Checkout Order`: a list with filters, get by name, a POST that 409s on a duplicate name, and PUT. Then re-run.

- [ ] **Step 3: Run the e2e specs that Task 2 touched** to confirm the configurator path still works with `biz-crm-helpdesk`

Run: `cd frontend && npx playwright test e2e/cloud-launch.spec.ts e2e/customer-journey.spec.ts e2e/qa-checkout-launch.spec.ts --project=chromium`
Expected: same pass count as before this branch. Run `git stash` and re-run on master to get the baseline if it isn't known.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/app-checkout.spec.ts backend/test/helpers/mockFrappe.js
git commit -m "test(app-checkout): e2e for the POS buyer path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Ship and prove it through the real path

- [ ] **Step 1: Full suites**

Run: `cd backend && npm test && cd ../frontend && npx tsc --noEmit -p . && npm run build && npx playwright test --project=chromium`
Expected: all green, apart from any failures that already existed on master. List those explicitly in the PR rather than hiding them.

- [ ] **Step 2: Push and open the PR** (title: `feat: app checkout — POS sold by tier, with its own set-up and welcome flow`). The body links the spec and this plan and lists the four "Deviations from the spec".

- [ ] **Step 3: After merge and Coolify redeploy, run Task 8 Steps 1–4** (doctypes → schema check → host scripts → runner health), in that order.

- [ ] **Step 4: One real purchase.** With the user's go-ahead, since this spends real money:
  1. From `https://murzaktech.tech/products/pos` (not a dev host), buy **Duka** monthly with a real M-Pesa number, using a fresh account and a throwaway shop name.
  2. Confirm `/welcome/<orderId>` reaches "Your shop is ready" and **Open your POS** loads the shop's sign-in page at the chosen address. The login can be verified over the API with `curl` as on 2026-10-08; don't type the password into a production page.
  3. Confirm the portal resource page shows the same login.
  4. Refund through support, then remove the site with `bench drop-site` and delete its `Tenant Slug` doc.

- [ ] **Step 5: Update memory** (`murzaktech-app-checkout-design.md`): phase 1–2 shipped, the real-path result, and what phase 3 needs (`selected_services` row identity beyond `service_id`).
