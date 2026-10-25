# Bundle Pricing and Combined Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a buyer add up to three companions to one primary product in a single order and payment, with server-computed bundle savings that stay available for 14 days after the primary is paid.

**Architecture:** Companions and the computed saving ride inside the existing `Checkout Order`'s `config_json` (no Frappe doctype change). `prepare-payment` builds one service row per line on one invoice and subtracts the saving from the invoice amount. A backend-owned pairing table is the single source of truth; the storefront reads it, plus live headroom, from a public read-only endpoint.

**Tech Stack:** Node/Express backend with plain-assert test scripts (`node test/<name>.test.js`, registered in `backend/package.json` `test`), in-memory mock Frappe (`test/helpers/mockFrappe.js`); React + TypeScript frontend, Playwright e2e with mocked `/api` routes.

**Spec:** `docs/superpowers/specs/2026-10-25-bundle-pricing-combined-checkout-design.md`

## Global Constraints

- Companion cap: at most 3 per order; companions must differ from the primary and from each other.
- Allowed companions: zero-RAM items (domains, Business Email, storage) and ONE other business app (`biz-erp-*`, `biz-crm-helpdesk`). Databases, app hosting and all other container-lane items are rejected. Shop-address apps (`isAppService`, i.e. POS) can never be companions; buy POS as the primary.
- Capacity is summed with `effectiveFootprint` (bench tenant = `benchTenantRamMb`, 480 MB), checked against the per-order cap and fleet headroom before any reservation or payment. Storefront copy keeps the honest advertised specs.
- Prices and savings are computed on the server from the catalog and pairing table. Client-sent prices are ignored.
- Saving window: exactly 14 days (`14 * 24 * 60 * 60 * 1000` ms) from the primary order's paid time, stamped server-side.
- Starting savings (owner-approved): first month of `starter-email` free with any POS tier; domain "at cost" with POS or ERP primaries = `savingKes` 1575 for `domain-com`, 1425 for `domain-org`/`domain-net`, 5812 for `domain-io` (price less price/1.6, from the 60%-margin note on `DOMAIN_TLD_PRICES` in `server.js`; re-verify against Hostinger's catalog before enabling); `.co.ke`, `.ke`, `.africa` get no saving (no wholesale reference). No database saving (databases are excluded).
- Everything ships behind `BUNDLES_ENABLED` (env, default off). Off means: `companions` rejected with 422, pairings endpoint returns `enabled: false`, UI hidden. Orders without `companions` behave exactly as today.
- Annual prepay only applies where `isEligibleForTermChoice` already allows it; companions join the annual sum for that order. Add-on invoices stay monthly with pro-rating.
- Errors shown to users go through `toUserMessage()` (`frontend/src/services/errors.ts`).

## Review Focus

1. A crafted `companions` list: an id not in the pairing table, the primary repeated, duplicates, a fourth item, a database, POS as companion. Expect 422 and nothing reserved.
2. A companion that pushes the order over the per-order cap or fleet headroom: expect 409/422 before any Draft row or reservation exists.
3. Removing a companion after the draft exists but before an invoice: total and reservation shrink; after an invoice exists: refused (409).
4. The saving window boundary: paid-time + 14 days exactly is still valid, +1 ms is not; an order that was never paid never opens a window.
5. A domain companion whose `config.domain` does not match its TLD product (same rule as `assertDomainConfigMatchesService`), and the domain string reaching the invoice row's `domainChoice`.

---

### Task 1: Pairing table, flag and pure bundle logic

**Files:**
- Create: `backend/data/bundlePairings.json`
- Create: `backend/services/checkout/bundles.js`
- Create: `backend/test/bundles.test.js`
- Modify: `backend/package.json` (append `&& node test/bundles.test.js` to `test`)

**Interfaces:**
- Produces:
  - `bundlesEnabled(): boolean` (reads `process.env.BUNDLES_ENABLED === "true"`).
  - `BUNDLE_WINDOW_MS: number` (14 days).
  - `MAX_COMPANIONS = 3`.
  - `validateCompanions({ primaryId: string, companions: Array<{ serviceId: string, config?: object }> }): Array<{ serviceId, config, meta }>`. Throws errors with `statusCode: 422` and a readable message for every rule in Global Constraints (not enabled, cap, duplicate, equals primary, not allowed class, no pairing for this primary, POS companion).
  - `computeBundle({ primaryId, companions, nowMs }): { lines: Array<{ serviceId, monthlyKes, setupKes }>, savingKes: number, savings: Array<{ serviceId, savingKes, reason }> }`. `savingKes` is the sum of matching pairing entries, never more than the sum of companion monthly + setup.
  - `footprintOf(primaryId, companions): { ramMb: number, diskGb: number }` using `effectiveFootprint`.

- [ ] **Step 1: Write the failing test** in `backend/test/bundles.test.js` (copy the `ok/section/throws` harness from `test/orderStore.test.js`). Assertions: with `BUNDLES_ENABLED=true`, `validateCompanions({primaryId:"biz-pos-duka", companions:[{serviceId:"starter-email"}]})` returns one entry; the same with `db-mysql`, with `biz-pos-inventory` as companion of `biz-pos-duka`, with a fourth companion, a duplicate, and the primary itself each throw 422; `computeBundle` for POS + `starter-email` gives `savingKes` equal to the catalog monthly price of `starter-email`; POS + `domain-com` gives 1575; POS + `domain-ke` gives 0; ERP primary + `domain-org` gives 1425; with the flag unset `validateCompanions` throws 422.
- [ ] **Step 2: Run** `node backend/test/bundles.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Create `bundlePairings.json`** as an array of `{ id, primaryIds: string[], companionId: string, saving: { type: "firstMonthFree" } | { type: "fixedKes", kes: number } }` holding the entries from Global Constraints (email x3 POS tiers; domain-com/org/net/io for POS tiers and `biz-erp-light`, `biz-erp-configured`).
- [ ] **Step 4: Implement `bundles.js`** with the signatures above. Pairings gate only the *saving*; the allowed-companion rule (zero-RAM or one `biz-erp-*`/`biz-crm-helpdesk`) gates *validity*, so an allowed companion without a pairing is accepted at full price. `firstMonthFree` resolves to the companion's catalog `monthlyKes`.
- [ ] **Step 5: Run the test.** Expected: PASS, then add it to `package.json` `test` and run `npm test --prefix backend` to confirm nothing else changed.
- [ ] **Step 6: Commit** `feat(bundles): pairing table and pure companion/saving logic`.

### Task 2: Order store carries companions and the saving window

**Files:**
- Modify: `backend/services/checkout/orderStore.js` (`createOrder` ~230, `getOrder` ~306, `reconcileDraftOrders` ~419, `toApiOrder` ~444, exports)
- Modify: `backend/services/apps/paidOrderReconciler.js:177`
- Test: `backend/test/orderStore.test.js`

**Interfaces:**
- Consumes: `validateCompanions`, `computeBundle`, `footprintOf`, `BUNDLE_WINDOW_MS` (Task 1).
- Produces:
  - `createOrder({ ..., companions })` where `companions?: Array<{serviceId, config?}>`. Stores `config.bundle = { companions: [{serviceId, config}], savingKes }` (reserved key: client-sent `bundle` in `config` is dropped, like `app`/`slug`). `ram_mb` and `disk_gb` hold the summed effective footprint. The duplicate-draft check keys on primary + config + companion ids.
  - `markOrderPaid({ client, orderId, nowMs }): Promise<doc>` PUTs `status: "Paid"` and writes `config.bundle.windowEndsAtMs = nowMs + BUNDLE_WINDOW_MS` (creates `config.bundle` when absent). The three existing `{ status: "Paid" }` writes switch to it.
  - `toApiOrder` adds `companions: Array<{serviceId, serviceName, monthlyKes, setupKes}>`, `bundleSavingKes: number`, `bundleWindowEndsAtMs: number | null`; `totalDueKes` becomes primary monthly + setup + companions monthly + setup − `bundleSavingKes`.
  - `setCompanions({ client, webAccountName, orderId, companions, nowMs, fleetReservedRamMb })`: replaces the companion list on a Draft with no invoice (409 `ORDER_HAS_INVOICE` otherwise), revalidates, recomputes saving and `ram_mb`.

- [ ] **Step 1: Write failing tests** in `orderStore.test.js`: creating POS + `starter-email` stores `ram_mb` equal to `effectiveFootprint(POS)` and `totalDueKes` equal to POS price + setup + email price − email price; capacity: a companion set whose summed footprint breaks `thresholdMb()` rejects with 409 `CAPACITY` and writes no row; `markOrderPaid` stamps `windowEndsAtMs` exactly `nowMs + 14 days`; an order never paid has `bundleWindowEndsAtMs === null`; two drafts for the same primary with different companions are not de-duplicated; a client-supplied `config.bundle` is ignored; `setCompanions` removing the email shrinks `ram_mb`/`totalDueKes`, and refuses when `invoice_doc_name` is set.
- [ ] **Step 2: Run** `node backend/test/orderStore.test.js`. Expected: new assertions FAIL.
- [ ] **Step 3: Implement** the interfaces above in `orderStore.js`; replace the three `status: "Paid"` puts (`orderStore.js` lines ~321 and ~419, `paidOrderReconciler.js:177`) with `markOrderPaid`.
- [ ] **Step 4: Run** orderStore, ordersRoutes, paidOrderReconciler tests. Expected: all PASS (no `companions` means unchanged behaviour).
- [ ] **Step 5: Commit** `feat(orders): companions, bundle saving and 14-day window on checkout orders`.

### Task 3: Order API and combined invoice

**Files:**
- Modify: `backend/routes/ordersRoutes.js` (`POST /api/orders` ~114, `prepare-payment` ~294)
- Test: `backend/test/ordersRoutes.test.js`

**Interfaces:**
- Consumes: Task 2 (`createOrder` companions, `setCompanions`, `toApiOrder`).
- Produces: `POST /api/orders` accepts `companions: [{serviceId, config?}]`; `PUT /api/orders/:id/companions` body `{ companions }` calls `setCompanions` and returns the order. `prepare-payment` builds `serviceRows = [primaryRow, ...companionRows]`; companion rows carry `domainChoice` from `config.domain` for domain products.

- [ ] **Step 1: Write failing tests** in `ordersRoutes.test.js`: POST with POS + email + `domain-com` (valid domain) returns `totalDueKes` matching Task 2 math; POST with each crafted list from Review Focus 1 returns 422 and no Draft row; POST that breaks capacity returns 409 `CAPACITY`; `prepare-payment` (first-purchase branch) yields an invoice whose `selected_services` has one row per line and `amount` equals `order.totalDueKes` (monthly) or `annualPrepayKes(sum of all rows' monthly)` minus saving (annual); the add-on branch (account with a paid plan) amount equals `totalDueKes`; a domain companion's invoice row has `domainChoice` equal to the domain; the Web Account service rows include every line; `PUT /companions` removal works before prepare-payment and returns 409 after.
- [ ] **Step 2: Run** `node backend/test/ordersRoutes.test.js`. Expected: new assertions FAIL.
- [ ] **Step 3: Implement** in `ordersRoutes.js`: read `companions` from the body and pass to `createOrder`; in `prepare-payment` build rows from `order.serviceId` + `order.companions`, pass the array to `createAddonInvoice` / `applyPlanAndCreateInvoice`, merge every row into the Web Account, and after the invoice exists, PUT `Portal Invoice` `amount` reduced by `order.bundleSavingKes` (never below 0), applied after the existing annual correction so both compose. Add the `PUT` route using `setCompanions`.
- [ ] **Step 4: Run** ordersRoutes, addonInvoiceService, firstPurchaseSetupFee, checkoutBillingTerm tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(orders): combined order, one invoice, bundle saving applied`.

### Task 4: Post-purchase pricing and offers

**Files:**
- Modify: `backend/server.js` (add-on route calling `createAddonInvoice` ~1242)
- Modify: `backend/services/checkout/bundles.js`
- Modify: `backend/routes/ordersRoutes.js` (new `GET /api/bundles/offers`)
- Test: `backend/test/bundles.test.js`, `backend/test/ordersRoutes.test.js`

**Interfaces:**
- Consumes: `markOrderPaid` window stamp (Task 2).
- Produces:
  - `activeBundleWindows({ client, webAccountName, nowMs }): Promise<Array<{ orderId, primaryId, windowEndsAtMs }>>` over this account's Paid orders with `windowEndsAtMs >= nowMs`.
  - `savingForAddOn({ windows, serviceIds, nowMs }): { savingKes: number, applied: Array<{serviceId, savingKes}> }`; a saving applies at most once per pairing id per paid order (track applied pairing ids in the order's `config.bundle.applied`, written when the add-on invoice is created).
  - `GET /api/bundles/offers` (authenticated): `{ enabled, offers: Array<{ serviceId, name, monthlyKes, savingKes, windowEndsAtMs }> }` for allowed companions the account does not already own, per active window.

- [ ] **Step 1: Write failing tests:** a window at exactly `windowEndsAtMs` still yields the saving; at `+1 ms` it yields 0; an unpaid order yields no window; the saving applies once per pairing; the add-on route reduces the invoice amount by the saving; `GET /api/bundles/offers` omits owned services and returns `enabled:false` with the flag off.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and route; in the add-on route, after `createAddonInvoice`, apply the saving with the same invoice `amount` PUT used in Task 3 and record `applied`.
- [ ] **Step 4: Run** both test files plus `addonInvoiceService.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bundles): 14-day post-purchase saving and offers endpoint`.

### Task 5: Pairings and availability endpoint

**Files:**
- Modify: `backend/routes/ordersRoutes.js` (new public `GET /api/bundles/availability`)
- Modify: `backend/services/checkout/bundles.js`
- Test: `backend/test/bundles.test.js`

**Interfaces:**
- Produces: `GET /api/bundles/availability` (no auth, cacheable 30 s) returning `{ enabled, pairings: Array<{ primaryIds, companionId, savingKes | null, label }>, allowedCompanionIds: string[], headroom: { benchSlotsLeft: number, level: "ok" | "limited" | "full" } }`. `benchSlotsLeft = floor((thresholdMb() − fleetReservedRamMb − reservedDraftRamMb) / benchTenantRamMb)`, `limited` when `benchSlotsLeft <= BUNDLES_LIMITED_SLOTS` (env, default 2), `full` at 0.
- Function: `computeHeadroom({ thresholdMb, reservedMb, benchTenantRamMb, limitedSlots }): { benchSlotsLeft, level }` (pure, exported).

- [ ] **Step 1: Write failing tests** for `computeHeadroom`: 1 slot left with limit 2 is `limited`; 3 slots is `ok`; 0 or negative is `full` with `benchSlotsLeft` clamped to 0; the route with the flag off returns `enabled:false` and empty pairings.
- [ ] **Step 2: Run** `node backend/test/bundles.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `computeHeadroom` and the route (reuse `getReservedRamMb` and `reservedDraftRamMb`; on any read failure return `level: "limited"` rather than 500).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(bundles): public pairings and headroom endpoint`.

### Task 6: Frontend service and CompanionPicker

**Files:**
- Create: `frontend/src/services/bundles.ts`
- Create: `frontend/src/components/CompanionPicker.tsx`
- Create: `frontend/src/components/AvailabilityNotice.tsx`
- Modify: `frontend/src/services/appCheckout.ts` (`createAppOrder` accepts `companions`), `frontend/src/pages/apps/AppSetup.tsx`, `frontend/src/pages/products/MurzakPOS.tsx`, `MurzakERP.tsx`, `MurzakCRM.tsx`
- Test: `frontend/e2e/bundles-picker.spec.ts`

**Interfaces:**
- Produces:
  - `fetchAvailability(): Promise<Availability>` and `fetchOffers(): Promise<Offer[]>` in `bundles.ts`, errors through `toUserMessage`.
  - `<CompanionPicker primaryId={string} value={string[]} onChange={(ids: string[]) => void} />`: renders nothing when `enabled` is false; lists allowed companions with price and "saves KES N" from the pairing; disables (with reason) any companion that would breach headroom; max 3.
  - `<AvailabilityNotice />`: shows "Limited availability" when `level === "limited"` and a full notice when `"full"`.

- [ ] **Step 1: Write the failing Playwright spec** (mock `/api/bundles/availability`, `/api/auth/me`): the POS page shows the picker with a "saves" label for the email pairing; checking email and a domain sends `companions` in the `POST /api/orders` body (intercept and assert); `enabled:false` hides the picker; `level:"limited"` shows the notice; `level:"full"` disables the second-app companion.
- [ ] **Step 2: Run** `npx playwright test e2e/bundles-picker.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, both components, and wire the picker into the three product pages and `AppSetup`/`createAppOrder`. A domain companion embeds the existing `frontend/src/components/DomainSearch.tsx` and sends `{ serviceId: <domain-* id for the chosen TLD>, config: { domain } }`; other companions send `{ serviceId }`.
- [ ] **Step 4: Run** the spec and `npx tsc --noEmit -p frontend`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(storefront): companion picker and limited-availability notice`.

### Task 7: Checkout summary

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx` (`OrderView` ~17, summary ~526-570)
- Test: `frontend/e2e/bundles-checkout.spec.ts`

**Interfaces:**
- Consumes: `companions`, `bundleSavingKes` on the order (Task 2) and `PUT /api/orders/:id/companions` (Task 3).

- [ ] **Step 1: Write the failing spec** (mocked order with POS + email + domain, saving 1575): the summary lists primary, each companion, a negative "Bundle saving" line and the total; clicking remove on a companion calls `PUT /companions` with the reduced list and re-renders the total; remove controls are absent once an invoice exists.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement**: extend `OrderView`, render lines (saving as a negative row, never folded into a unit price), call the PUT on remove, refresh the order.
- [ ] **Step 4: Run** the spec and the existing checkout specs under `frontend/e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checkout): show companions and bundle saving, allow removal`.

### Task 8: Post-purchase "Complete your setup" cards

**Files:**
- Create: `frontend/src/components/CompleteSetupCards.tsx`
- Modify: `frontend/src/pages/apps/AppWelcome.tsx`, `frontend/src/pages/ThankYou.tsx`, `frontend/src/pages/portal/tabs/OverviewTab.tsx`
- Test: `frontend/e2e/bundles-offers.spec.ts`

**Interfaces:**
- Consumes: `fetchOffers()` (Task 6), the portal add-on flow (`openAddonsModal`/`onApplySelection` in `usePortalState.tsx`).

- [ ] **Step 1: Write the failing spec** (mocked `/api/bundles/offers` with one offer, `windowEndsAtMs` 10 days out): the Overview shows a card with name, price, saving and "N days left"; clicking opens the Add-ons modal preselected; no card renders when `enabled:false` or offers is empty.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** the component and mount it in the three places; the saving shown comes from the offer, never recomputed in the browser.
- [ ] **Step 4: Run** the spec and `npx tsc --noEmit -p frontend`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): complete-your-setup cards from active bundle windows`.

### Task 9: Enablement check

**Files:**
- Modify: `backend/.env.example`, `docs/operations-manual.md` (flag and threshold notes)

- [ ] **Step 1:** Document `BUNDLES_ENABLED` and `BUNDLES_LIMITED_SLOTS` in `.env.example`, and the pre-enable checklist (re-verify domain savings against Hostinger's live catalog; confirm the `Checkout Order` doctype accepts the longer `config_json`, per the live-schema rule in memory).
- [ ] **Step 2:** Run `npm test --prefix backend` and the new Playwright specs. Expected: all PASS with the flag off and on (`BUNDLES_ENABLED=true`).
- [ ] **Step 3: Commit** `docs(bundles): flag, thresholds and enable checklist`.
