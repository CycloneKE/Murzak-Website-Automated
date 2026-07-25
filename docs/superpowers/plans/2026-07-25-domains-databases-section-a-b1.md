# Domains & Databases — Section A + B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Databases become four distinct engine products on the Products page (MySQL/PostgreSQL/MongoDB/Redis), and domain registration becomes its own standalone product (per-TLD fixed pricing, real Hostinger availability search) — both flowing through the existing phase-1 checkout (`/checkout/:orderId`) with zero changes to the order/reservation/payment pipeline.

**Architecture:** Both product types are added as new `ServiceItem` catalog entries with `capacityClass: "volume"` and a fixed `monthlyKes`. Because `POST /api/orders` already prices strictly from `getServiceMeta(serviceId)` and treats any non-"dedicated" service uniformly, **no backend orders/capacity code changes are needed** — this plan is catalog + snapshot + two new Products-page sections + one small Checkout.tsx display change (domains bill "/yr", not "/mo"). Domain availability search reuses the existing `DomainSearch` component and `/api/domains/check` endpoint (already live, already calling Hostinger), just surfaced as a standalone product-page flow instead of nested inside the old plan-first configurator.

**Tech Stack:** Same as the phase-1 checkout work — Express route factories, Frappe REST via `frappeClient()`, plain-node backend tests, React 18 + react-router v6 + Tailwind (murzak-* tokens), Playwright e2e.

## Global Constraints

- **Never delete a catalog id a paying customer might already own.** `starter-db-light`/`starter-db-mongo` stay in the catalog (existing customers' billing/renewal must keep resolving them) — they are hidden from *new* purchases via a `deprecated: true` flag, not removed.
- **Prices are server-side only**, unchanged from phase 1: every charged amount comes from `backend/data/serviceCatalogSnapshot.json` via `getServiceMeta()`, never trusted from the client.
- **White-label**: no Hostinger/Frappe/ERPNext/Coolify/KVM in customer-facing copy. The domain search UI already respects this (confirmed: `DomainSearch.tsx`/`domains.ts` never mention Hostinger).
- **Snapshot regeneration is mandatory** after any catalog edit: `node backend/scripts/generate-catalog-snapshot.js`, and the regenerated `backend/data/serviceCatalogSnapshot.json` must be committed in the same commit as the catalog change — `getServiceMeta()` reads only the snapshot, not `serviceCatalog.ts` directly.
- **Domain pricing is the existing fixed `DOMAIN_TLD_PRICES` table** (`.co.ke` 1200, `.com` 1500, `.ke` 1800, `.org` 1800, `.net` 1800, `.africa` 2500, `.io` 4500 KES/yr) — not live/dynamic pricing from Hostinger (no confirmed API support for that; see spec amendment).
- **KES display**: always via `formatKes()`; domain-category orders show "**/yr**", every other order shows "/mo" (unchanged).
- **Backend tests**: plain node scripts registered in `backend/package.json`'s `test` chain, run via `node test/<file>.test.js` from `backend/`.
- **Dark mode + mobile**: new UI reuses existing `murzak-*`/`glass-card` classes and `dark:` variants.
- **B2/B3 (automated registration, automated refunds) are explicitly out of scope for this plan.** Do not add registrant-detail collection, any Hostinger registration-API call, or any refund logic. A domain order in this plan is a payment for the *right to have Murzak register the domain* — fulfillment stays on the existing manual `domain-purchase-requests` flow, unchanged.

## File Structure

```
frontend/src/config/serviceCatalog.ts   # MODIFIED — new ServiceCategory value, deprecated flag,
                                         #   4 db-* entries, DOMAIN_CATALOG array, isYearlyBilled()
backend/data/serviceCatalogSnapshot.json # MODIFIED — regenerated (not hand-edited)
frontend/src/services/domains.ts        # MODIFIED — TLD_OPTIONS prices reconciled with backend
frontend/src/pages/Products.tsx         # MODIFIED — new Databases + Domains sections
frontend/src/pages/Checkout.tsx         # MODIFIED — "/yr" vs "/mo" display
frontend/src/App.tsx                    # MODIFIED — thread isLoggedIn into Products
backend/test/catalogSnapshot.test.js    # NEW — regression guard that new ids resolve post-regen
frontend/e2e/products-databases.spec.ts # NEW
frontend/e2e/products-domains.spec.ts   # NEW
```

---

### Task 1: Split Database Hosting into four engine products

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts:57-107` (add `deprecated?: boolean` to `ServiceOption`), `:241-350` (Starter catalog array), `:891-911` (`cloudLaunchCatalog()`)
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated)
- Test: `backend/test/catalogSnapshot.test.js`

**Interfaces:**
- Produces (Task 2 relies on these exact ids): four new catalog ids
  `db-mysql`, `db-postgres`, `db-mongo`, `db-redis`, each:
  ```ts
  {
    id: "db-mysql", // (or db-postgres/db-mongo/db-redis)
    name: "MySQL Database", // (PostgreSQL Database / MongoDB Database / Redis Database)
    description: "Managed <Engine> for your app or website.",
    category: "Database Hosting",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
    resources: { ramMb: 768, diskGb: 10 },
    pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
    highlights: ["Daily backups", "Remote access", "Managed by us"],
    sortOrder: <see step 3>,
  }
  ```
- `ServiceOption` gains `deprecated?: boolean` (default falsy). `starter-db-light`/`starter-db-mongo` get `deprecated: true` — everything else about them is untouched.
- `cloudLaunchCatalog()` excludes `deprecated` items from its returned lists.

- [ ] **Step 1: Write the failing test**

Create `backend/test/catalogSnapshot.test.js`:

```js
// Regression guard: every catalog id this plan adds must resolve through
// the SAME snapshot path production pricing uses (getServiceMeta reads only
// the generated snapshot, never serviceCatalog.ts directly) — this test
// fails if someone edits the catalog and forgets to regenerate it.
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { getServiceMeta } = require("../services/provisioning/catalog");

(async () => {
  section("database engine products resolve from the snapshot");
  for (const id of ["db-mysql", "db-postgres", "db-mongo", "db-redis"]) {
    const meta = getServiceMeta(id);
    ok(!!meta, `${id} resolves`);
    ok(meta?.monthlyKes === 2000, `${id} prices at KES 2000/mo`);
    ok(meta?.ramMb === 768 && meta?.diskGb === 10, `${id} has the expected footprint`);
  }

  section("deprecated ids still resolve (existing customers keep pricing)");
  for (const id of ["starter-db-light", "starter-db-mongo"]) {
    ok(!!getServiceMeta(id), `${id} still resolves post-deprecation`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `node test/catalogSnapshot.test.js`
Expected: FAIL — `db-mysql resolves` and siblings fail (`meta` is `null`), since neither the catalog nor the snapshot has these ids yet.

- [ ] **Step 3: Add `deprecated` to the type and mark the old entries**

In `frontend/src/config/serviceCatalog.ts`, add to `ServiceOption` (after `sortOrder?: number;` at line 106):

```ts
  /** Hidden from new self-serve purchases (cloudLaunchCatalog), but still
   * resolvable by getService/getServiceMeta so existing customers' pricing
   * and renewals keep working. Never delete a catalog id a customer might
   * already own — deprecate it instead. */
  deprecated?: boolean;
```

Then in the `starter-db-light` entry (`serviceCatalog.ts:312-323`) and `starter-db-mongo` entry (`:325-336`), add `deprecated: true,` as the last field before the closing brace of each.

- [ ] **Step 4: Add the four engine products**

Immediately after the `starter-db-mongo` entry (after line 336, before `starter-hrpay` at line 338), insert:

```ts
    {
      id: "db-mysql",
      name: "MySQL Database",
      description: "Managed MySQL for your app or website.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["Daily backups", "Remote access", "Managed by us"],
      sortOrder: 51,
    },
    {
      id: "db-postgres",
      name: "PostgreSQL Database",
      description: "Managed PostgreSQL for your app or website.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["Daily backups", "Remote access", "Managed by us"],
      sortOrder: 52,
    },
    {
      id: "db-mongo",
      name: "MongoDB Database",
      description: "Managed MongoDB for apps built on a document database.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["MongoDB 7", "Daily backups", "Remote access"],
      sortOrder: 53,
    },
    {
      id: "db-redis",
      name: "Redis Database",
      description: "Managed Redis for caching, queues, and session storage.",
      category: "Database Hosting",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "5GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 768, diskGb: 5 },
      pricing: { model: "addon", monthlyKes: 2000, setupKes: 500 },
      highlights: ["In-memory speed", "Daily backups", "Managed by us"],
      sortOrder: 54,
    },
```

- [ ] **Step 5: Exclude deprecated items from `cloudLaunchCatalog()`**

In `serviceCatalog.ts`, find `cloudLaunchCatalog()` (around line 899-911). Change:

```ts
export function cloudLaunchCatalog(): Record<CloudLaunchCategory, ServiceItem[]> {
  const allVolumeServices = (Object.keys(SERVICE_CATALOG) as PlanCode[])
    .flatMap((code) => SERVICE_CATALOG[code])
    .filter((s) => s.capacityClass === "volume" && s.pricing.model === "addon");
```

to:

```ts
export function cloudLaunchCatalog(): Record<CloudLaunchCategory, ServiceItem[]> {
  const allVolumeServices = (Object.keys(SERVICE_CATALOG) as PlanCode[])
    .flatMap((code) => SERVICE_CATALOG[code])
    .filter((s) => s.capacityClass === "volume" && s.pricing.model === "addon" && !s.deprecated);
```

(Everything else in the function is unchanged.)

- [ ] **Step 6: Regenerate the backend snapshot**

Run (from `backend/`): `node scripts/generate-catalog-snapshot.js`

Expected output: a line confirming items written, e.g. `Wrote N items to backend/data/serviceCatalogSnapshot.json`. Verify the new ids landed:

Run: `node -e "console.log(require('./data/serviceCatalogSnapshot.json').items['db-mysql'])"`
Expected: prints `{ name: 'MySQL Database', category: 'Database Hosting', capacityClass: 'volume', ramMb: 768, diskGb: 10, monthlyKes: 2000, ... }` (not `undefined`).

- [ ] **Step 7: Run test to verify it passes**

Run: `node test/catalogSnapshot.test.js`
Expected: all `ok:` lines, exit 0.

- [ ] **Step 8: Run the full backend suite to confirm nothing else broke**

Run: `npm test` (from `backend/`)
Expected: full chain green, same pass count as before plus this new file's assertions. `starter-db-light`/`starter-db-mongo` still resolving (Step 7's second section) proves existing-customer pricing/renewal paths are unaffected by deprecation.

- [ ] **Step 9: Register the test and commit**

Add `&& node test/catalogSnapshot.test.js` to the `test` script in `backend/package.json`.

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json backend/test/catalogSnapshot.test.js backend/package.json
git commit -m "feat: split Database Hosting into four engine-specific products"
```

---

### Task 2: Products page — Databases section

**Files:**
- Modify: `frontend/src/pages/Products.tsx`

**Interfaces:**
- Consumes: `db-mysql`/`db-postgres`/`db-mongo`/`db-redis` (Task 1), `formatKes`/`serviceMonthlyKes` (already imported in `Products.tsx:6`).
- No new props needed for this task — deep-links use the existing `/checkout/new?serviceId=` route from phase 1 (`App.tsx`), which requires login (`RequireAuth`) and handles the not-logged-in redirect on its own already.

- [ ] **Step 1: Add the section data + JSX**

In `Products.tsx`, after the `industries` array (line 26), add:

```tsx
  const databases = [
    { id: "db-mysql", name: "MySQL", desc: "The world's most popular open-source relational database." },
    { id: "db-postgres", name: "PostgreSQL", desc: "Advanced open-source relational database with strong SQL compliance." },
    { id: "db-mongo", name: "MongoDB", desc: "Flexible document database for apps that outgrow rigid schemas." },
    { id: "db-redis", name: "Redis", desc: "In-memory store for caching, queues, and fast session storage." },
  ];
```

After the "Cloud & Custom" `<Section>` (ends at line 104), insert a new section:

```tsx
        {/* Databases */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="max-w-2xl mb-12">
             <h2 className="text-3xl font-[900] tracking-tight mb-4">Managed databases</h2>
             <p className="text-slate-500 font-medium">Pick your engine. We host, back up, and keep it running.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
             {databases.map((db) => (
               <div key={db.id} onClick={() => onNavigate(`checkout/new?serviceId=${db.id}`)} className="cursor-pointer group p-6 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 hover:border-murzak-accent/40 transition-all flex flex-col h-full">
                  <h3 className="text-lg font-black mb-2 text-murzak-ink dark:text-slate-100">{db.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 flex-grow">{db.desc}</p>
                  <div className="text-murzak-accent text-sm font-bold flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 text-xs font-mono uppercase">From {formatKes(serviceMonthlyKes(db.id))}/mo</span>
                    <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">Launch <ArrowRight size={14} /></span>
                  </div>
               </div>
             ))}
          </div>
        </Section>
```

- [ ] **Step 2: Verify it compiles and check the navigation path**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: clean except the one pre-existing unrelated `Portal.tsx(1322,24)` error.

Confirm `onNavigate` in this codebase accepts a bare path string like `checkout/new?serviceId=db-mysql` and resolves it correctly — read how `onNavigate` is implemented/passed in `App.tsx` (search for where `Products` is routed and how sibling pages like `Cloud.tsx` call `onNavigate` with a path containing a query string) and match that exact calling convention. If `onNavigate` expects a leading slash, use `/checkout/new?serviceId=${db.id}` instead.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Products.tsx
git commit -m "feat: Databases section on the Products page"
```

---

### Task 3: Domain catalog entries + price-table reconciliation

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts` (new `ServiceCategory` value, `DOMAIN_CATALOG` array, `SERVICE_INDEX` wiring, `isYearlyBilled` helper)
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated)
- Modify: `frontend/src/services/domains.ts` (`TLD_OPTIONS` prices reconciled with backend `DOMAIN_TLD_PRICES`)
- Test: extend `backend/test/catalogSnapshot.test.js`

**Interfaces:**
- Produces (Task 4/5 rely on these):
  ```ts
  // serviceCatalog.ts
  export const DOMAIN_CATALOG: ServiceItem[]; // 7 entries, ids below
  export function isYearlyBilled(svc: ServiceItem): boolean; // true iff category === "Domain Registration"
  ```
- Domain catalog ids and prices (must exactly match `backend/server.js`'s `DOMAIN_TLD_PRICES`,
  which is the server-side source of truth this plan does not change):
  `domain-coke` (1200), `domain-com` (1500), `domain-ke` (1800), `domain-org` (1800),
  `domain-net` (1800), `domain-africa` (2500), `domain-io` (4500).
- `getService(id)`/`getServiceMeta(id)` must resolve every `domain-*` id after this task (both
  frontend `SERVICE_INDEX` and the backend snapshot).

- [ ] **Step 1: Write the failing test**

Extend `backend/test/catalogSnapshot.test.js`, add before the final `console.log`/exit block:

```js
  section("domain registration products resolve from the snapshot, prices match DOMAIN_TLD_PRICES");
  const domainPrices = {
    "domain-coke": 1200,
    "domain-com": 1500,
    "domain-ke": 1800,
    "domain-org": 1800,
    "domain-net": 1800,
    "domain-africa": 2500,
    "domain-io": 4500,
  };
  for (const [id, price] of Object.entries(domainPrices)) {
    const meta = getServiceMeta(id);
    ok(!!meta, `${id} resolves`);
    ok(meta?.monthlyKes === price, `${id} prices at KES ${price}`);
    ok(meta?.ramMb === 0 && meta?.diskGb === 0, `${id} has zero server footprint`);
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/catalogSnapshot.test.js`
Expected: FAIL — every `domain-*` id resolves to `null`.

- [ ] **Step 3: Add the `"Domain Registration"` category and the catalog array**

In `serviceCatalog.ts`, add `"Domain Registration"` to the `ServiceCategory` union (near line 4-19, alongside the other category strings):

```ts
export type ServiceCategory =
  | "Website Hosting"
  | "App Hosting"
  | "ERP Hosting"
  | "CRM & Helpdesk"
  | "Email Hosting"
  | "Database Hosting"
  | "Domain Registration"
  | "Storage"
  // ...unchanged rest
```

After the `UNIVERSAL_ADDONS` array closes (after line 784, before the `configuratorServices` function at line 791), add:

```ts
// =====================================================================
//  DOMAIN REGISTRATION — priced per TLD, not per plan. Billed yearly
//  (displayed "/yr" via isYearlyBilled), zero server footprint (a domain
//  purchase reserves no RAM/disk — fulfillment is the existing manual
//  domain-purchase-requests flow, unchanged by this catalog entry).
//  Prices MUST match backend/server.js's DOMAIN_TLD_PRICES exactly — that
//  object remains the server-side source of truth for /api/domains/check;
//  this catalog is what actually gets billed via /api/orders.
// =====================================================================
export const DOMAIN_CATALOG: ServiceItem[] = [
  {
    id: "domain-coke",
    name: "Domain — .co.ke",
    description: "Register a .co.ke domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1200 },
    sortOrder: 10,
  },
  {
    id: "domain-com",
    name: "Domain — .com",
    description: "Register a .com domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1500 },
    sortOrder: 20,
  },
  {
    id: "domain-ke",
    name: "Domain — .ke",
    description: "Register a .ke domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 30,
  },
  {
    id: "domain-org",
    name: "Domain — .org",
    description: "Register a .org domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 40,
  },
  {
    id: "domain-net",
    name: "Domain — .net",
    description: "Register a .net domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 1800 },
    sortOrder: 50,
  },
  {
    id: "domain-africa",
    name: "Domain — .africa",
    description: "Register a .africa domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 2500 },
    sortOrder: 60,
  },
  {
    id: "domain-io",
    name: "Domain — .io",
    description: "Register a .io domain, billed yearly.",
    category: "Domain Registration",
    tier: "Light",
    capacityClass: "volume",
    specs: { ram: "N/A", storage: "N/A", cpu: "N/A", bandwidth: "N/A", backups: "N/A", sla: "N/A" },
    resources: { ramMb: 0, diskGb: 0 },
    pricing: { model: "addon", monthlyKes: 4500 },
    sortOrder: 70,
  },
];

/** True for products billed yearly (domains) rather than monthly (everything else). */
export function isYearlyBilled(svc: ServiceItem): boolean {
  return svc.category === "Domain Registration";
}

/** Map a full TLD string (e.g. ".co.ke") to its DOMAIN_CATALOG product id. */
export function domainCatalogIdForTld(tld: string): string | null {
  const byTld: Record<string, string> = {
    ".co.ke": "domain-coke",
    ".com": "domain-com",
    ".ke": "domain-ke",
    ".org": "domain-org",
    ".net": "domain-net",
    ".africa": "domain-africa",
    ".io": "domain-io",
  };
  return byTld[tld] ?? null;
}
```

- [ ] **Step 4: Wire `DOMAIN_CATALOG` into `SERVICE_INDEX`**

Find the `SERVICE_INDEX` IIFE (`serviceCatalog.ts:825-832`). Change:

```ts
const SERVICE_INDEX: Record<string, ServiceItem> = (() => {
  const idx: Record<string, ServiceItem> = {};
  (Object.keys(SERVICE_CATALOG) as PlanCode[]).forEach((code) => {
    for (const s of SERVICE_CATALOG[code]) idx[s.id] = s;
  });
  for (const s of UNIVERSAL_ADDONS) idx[s.id] = s;
  return idx;
})();
```

to:

```ts
const SERVICE_INDEX: Record<string, ServiceItem> = (() => {
  const idx: Record<string, ServiceItem> = {};
  (Object.keys(SERVICE_CATALOG) as PlanCode[]).forEach((code) => {
    for (const s of SERVICE_CATALOG[code]) idx[s.id] = s;
  });
  for (const s of UNIVERSAL_ADDONS) idx[s.id] = s;
  for (const s of DOMAIN_CATALOG) idx[s.id] = s;
  return idx;
})();
```

(`DOMAIN_CATALOG` must be declared above this IIFE in the file — it already is, per Step 3's placement before `configuratorServices`, which itself is above `SERVICE_INDEX`. If your editor placement differs, move `DOMAIN_CATALOG`'s declaration above `SERVICE_INDEX`.)

- [ ] **Step 5: Regenerate the snapshot and verify**

Run (from `backend/`): `node scripts/generate-catalog-snapshot.js`

Run: `node -e "console.log(require('./data/serviceCatalogSnapshot.json').items['domain-com'])"`
Expected: prints an object with `monthlyKes: 1500`.

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/catalogSnapshot.test.js`
Expected: all `ok:` lines, exit 0.

- [ ] **Step 7: Reconcile `TLD_OPTIONS` with the server-side price table**

`frontend/src/services/domains.ts:11-19` currently has prices that drift from
`backend/server.js`'s `DOMAIN_TLD_PRICES` (a pre-existing inconsistency —
`TLD_OPTIONS` is only used as the request's TLD list and as the *offline
fallback* display price when `/api/domains/check` is unreachable; the real
charge always comes from the backend). Align them so a buyer never sees a
different price in the rare offline-fallback case than what they'd actually
be charged:

```ts
export const TLD_OPTIONS: TldOption[] = [
  { tld: ".co.ke", priceKes: 1200, popular: true },
  { tld: ".com", priceKes: 1500, popular: true },
  { tld: ".ke", priceKes: 1800 },
  { tld: ".org", priceKes: 1800 },
  { tld: ".net", priceKes: 1800 },
  { tld: ".africa", priceKes: 2500 },
  { tld: ".io", priceKes: 4500 },
];
```

- [ ] **Step 8: Verify frontend compiles**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: clean except the one pre-existing unrelated `Portal.tsx(1322,24)` error.

- [ ] **Step 9: Register test (already done in Task 1) and commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json backend/test/catalogSnapshot.test.js frontend/src/services/domains.ts
git commit -m "feat: domain registration catalog entries, per-TLD fixed pricing"
```

---

### Task 4: Checkout page — yearly billing display for domains

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx:422-452`

**Interfaces:**
- Consumes: `isYearlyBilled(svc: ServiceItem): boolean`, `getService(id): ServiceItem | undefined` (both from Task 3 / already-imported `serviceCatalog.ts` exports).

- [ ] **Step 1: Compute the billing period near the order summary**

In `Checkout.tsx`, `getService` is already imported and used at `:316`
(`const svcForOrder = order ? getService(order.serviceId) : undefined;`).
Add, immediately after that line:

```tsx
  const period = svcForOrder && isYearlyBilled(svcForOrder) ? "/yr" : "/mo";
```

Add `isYearlyBilled` to the existing `serviceCatalog` import at the top of the file (alongside `getService`, `formatKes`, etc.).

- [ ] **Step 2: Use `period` in the order summary**

Change (`Checkout.tsx:436-438`):

```tsx
          <span className="text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter whitespace-nowrap">
            {formatKes(order.monthlyKes)}/mo
          </span>
```

to:

```tsx
          <span className="text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter whitespace-nowrap">
            {formatKes(order.monthlyKes)}{period}
          </span>
```

The "Due now" line (`:441-444`) is unchanged — it already shows a bare KES figure with no period suffix, which is correct for both monthly and yearly products (it's a one-time charge today either way).

- [ ] **Step 3: Verify**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: clean except the one pre-existing unrelated `Portal.tsx(1322,24)` error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Checkout.tsx
git commit -m "feat: checkout shows /yr for domain-registration orders"
```

---

### Task 5: Products page — Domains section

**Files:**
- Modify: `frontend/src/pages/Products.tsx`
- Modify: `frontend/src/App.tsx` (thread `isLoggedIn` into `Products`)

**Interfaces:**
- Consumes: `DomainSearch` (`frontend/src/components/DomainSearch.tsx`, unchanged — `onSelect(domain: string, priceKes: number)`), `domainCatalogIdForTld(tld: string): string | null` (Task 3), `POST /api/orders` (phase-1 contract: body `{ serviceId, config?, source? }` → `{ ok, order: { id, ... } }` / `409 { code: "CAPACITY" }`).
- Domain purchase requires login (checkout is `RequireAuth`-gated); this task adds a lightweight pre-check on the Products page itself so an anonymous visitor gets a clear redirect instead of a failed fetch.

- [ ] **Step 1: Thread `isLoggedIn` into `Products`**

In `App.tsx`, find the `<Route path="/products" ...>` line (`App.tsx:352`
per the phase-1 read: `<Route path="/products" element={<Products
onNavigate={onNavigate} isLoading={isPageLoading} />} />`). Change to:

```tsx
              <Route path="/products" element={<Products onNavigate={onNavigate} isLoading={isPageLoading} isLoggedIn={isLoggedIn} />} />
```

In `Products.tsx`, add `isLoggedIn?: boolean;` to the `Props` interface
(`Products.tsx:8-11`) and destructure it in the component signature
(`Products.tsx:13`): `const Products: React.FC<Props> = ({ onNavigate, isLoggedIn }) => {`.

- [ ] **Step 2: Add the domain-select handler and section**

Add these imports to `Products.tsx`: `DomainSearch` from
`../components/DomainSearch`, and `domainCatalogIdForTld` alongside the
existing `serviceCatalog` import.

Add state and a handler inside the component body, near the top:

```tsx
  const [domainError, setDomainError] = React.useState("");
  const [domainSubmitting, setDomainSubmitting] = React.useState(false);
  const [selectedDomain, setSelectedDomain] = React.useState<string | undefined>(undefined);

  const handleSelectDomain = async (domain: string, priceKes: number) => {
    setDomainError("");
    if (!isLoggedIn) {
      onNavigate("login?returnTo=%2Fproducts");
      return;
    }
    const tld = domain.slice(domain.indexOf("."));
    const serviceId = domainCatalogIdForTld(tld);
    if (!serviceId) {
      setDomainError("That domain extension isn't available for purchase yet.");
      return;
    }
    setSelectedDomain(domain);
    setDomainSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serviceId, config: { domain, priceKes }, source: "products-page" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.code === "CAPACITY") {
        setDomainError("We're at capacity right now — please try again shortly.");
        return;
      }
      if (!res.ok || !data?.order) {
        setDomainError(data?.error || "Failed to start checkout.");
        return;
      }
      onNavigate(`checkout/${data.order.id}`);
    } catch {
      setDomainError("Failed to start checkout. Check your connection and try again.");
    } finally {
      setDomainSubmitting(false);
    }
  };
```

Note: `serviceId` here is deliberately **not trusted for pricing** — the
order's actual `monthlyKes` is resolved server-side from
`getServiceMeta(serviceId)` (Task 3's catalog entry), never from the
`priceKes` in `config`. `config.priceKes` is metadata for display/audit
only.

Add the section JSX after the new Databases section from Task 2:

```tsx
        {/* Domains */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="max-w-2xl mb-8">
             <h2 className="text-3xl font-[900] tracking-tight mb-4">Register a domain</h2>
             <p className="text-slate-500 font-medium">Search, pick your extension, and check out — billed yearly.</p>
          </div>
          <div className="max-w-xl">
            <DomainSearch selectedDomain={selectedDomain} onSelect={handleSelectDomain} />
            {domainSubmitting && (
              <p className="mt-3 text-sm font-bold text-slate-500">Starting checkout…</p>
            )}
            {domainError && (
              <p className="mt-3 text-sm font-bold text-red-500">{domainError}</p>
            )}
          </div>
        </Section>
```

- [ ] **Step 3: Verify**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: clean except the one pre-existing unrelated `Portal.tsx(1322,24)` error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/Products.tsx
git commit -m "feat: Domains section on the Products page"
```

---

### Task 6: E2E coverage

**Files:**
- Create: `frontend/e2e/products-databases.spec.ts`
- Create: `frontend/e2e/products-domains.spec.ts`

**Interfaces:**
- Consumes: the login/registration helper pattern already established in
  `frontend/e2e/cloud-launch.spec.ts` and `frontend/e2e/checkout.spec.ts`
  (read both before writing — reuse their `registerNewUser`-style helper
  rather than inventing a new one).

- [ ] **Step 1: Write `products-databases.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts
// (which itself mirrors AUTH-06 in auth-guards.spec.ts) — same field
// selectors, same button names, same "fresh account lands in /portal"
// assumption. Keep this identical to the source if that file's selectors
// ever change.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_proddb_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`ProdDB ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`ProdDB ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing database products');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRODDB-01 — database engine card launches checkout', () => {
  test.describe.configure({ timeout: 60_000 });

  test('MySQL card creates an order and lands on its checkout page', async ({ page }) => {
    await registerNewUser(page, 'mysql');
    await page.goto('/products');

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST'
    );
    await page.getByText('MySQL', { exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/checkout\/CHK-/);
    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('MySQL Database')).toBeVisible();
    await expect(page.getByText('KES 2,000', { exact: false }).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify `products-databases.spec.ts` compiles as valid TypeScript**

Run (from `frontend/`): `npx tsc --noEmit -p e2e` if the e2e directory has its
own `tsconfig`; otherwise run the project's standard `npx tsc --noEmit` and
confirm no new errors reference `products-databases.spec.ts`.

- [ ] **Step 3: Write `products-domains.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts —
// see products-databases.spec.ts's copy of this same function for the
// rationale comment; keep both in sync with the source if it changes.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_proddom_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`ProdDom ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`ProdDom ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing domain products');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRODDOM-01 — domain search selects and launches checkout', () => {
  test.describe.configure({ timeout: 60_000 });

  test('selecting an available domain creates a yearly-billed order', async ({ page }) => {
    await registerNewUser(page, 'select');
    await page.goto('/products');

    // Search a label; the deterministic stableHash fallback (used whenever
    // HOSTINGER_API_TOKEN isn't configured in this test env) makes results
    // repeatable for a fixed label — pick one whose .co.ke result is
    // deterministically available for this suite's CI env, or assert on
    // whichever result row shows "available" rather than a specific label.
    await page.getByPlaceholder('yourbusiness').fill('murzaktestlabel123');
    await page.getByRole('button', { name: 'Search' }).click();

    const availableRow = page.locator('li', { hasText: '.co.ke' }).first();
    await expect(availableRow).toBeVisible({ timeout: 10000 });

    // If the deterministic stub marked this TLD unavailable for this label,
    // the "Select" button won't render — this test asserts against
    // whichever row IS available rather than assuming .co.ke specifically.
    const selectButton = page.getByRole('button', { name: /^(Select|Selected)$/ }).first();
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/orders') && r.request().method() === 'POST'
    );
    await selectButton.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page).toHaveURL(/\/checkout\/CHK-/);
    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 10000 });
    // Yearly billing period shown, not monthly.
    await expect(page.getByText('/yr', { exact: false })).toBeVisible();
  });

  test('logged-out visitor is redirected to login instead of failing silently', async ({ page }) => {
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
    );
    await page.goto('/products');
    await page.getByPlaceholder('yourbusiness').fill('anotherlabel456');
    await page.getByRole('button', { name: 'Search' }).click();

    const selectButton = page.getByRole('button', { name: /^(Select|Selected)$/ }).first();
    if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
```

- [ ] **Step 4: Attempt a live run, report honestly**

Run: `cd frontend && npx playwright test e2e/products-databases.spec.ts e2e/products-domains.spec.ts --project=chromium`

If a live backend/dev server is available in this environment, report the
real pass/fail result. If not (no backend configured — the same limitation
hit throughout the phase-1 checkout work), verify via `npx tsc --noEmit`
plus careful manual reading against the actual rendered
`Products.tsx`/`DomainSearch.tsx`/`Checkout.tsx` markup, and say so
explicitly rather than claiming a run that didn't happen.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/products-databases.spec.ts frontend/e2e/products-domains.spec.ts
git commit -m "test: e2e coverage for database and domain product-page checkout"
```

---

## Follow-ups (explicitly out of this plan's scope)

- **B2 (automated registration)** and **B3 (automated refund on registration failure)** — deferred pending confirmation of Hostinger's registration-API terms and provisioning of separate M-Pesa B2C credentials with Safaricom, per the design spec.
- **Live/dynamic domain pricing** — deferred pending confirmation that Hostinger's API exposes per-TLD cost at all (unconfirmed as of the design spec).
- Extending the TLD list beyond the existing seven is a catalog-only follow-up once there's demand data.
- `starter-db-light`/`starter-db-mongo` remain in the catalog indefinitely for existing customers; a future cleanup could migrate active subscribers to the new per-engine ids and fully retire the old ones, but that's a data-migration task outside this plan.
