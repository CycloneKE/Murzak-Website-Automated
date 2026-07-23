# Unified Checkout — Phase 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared `/checkout/:orderId` page fed by a draft-order API with RAM reservation, plus the CloudLaunchModal rewired to end there instead of taking payment in-modal.

**Architecture:** A new `Checkout Order` Frappe doctype holds the draft (product, server-computed price, RAM reservation with 30-min TTL). The existing invoice-keyed payment rails (M-Pesa STK + callback, PayPal capture + webhook, `activateServicesForInvoice` B1 gate) are **not touched**: when the buyer reaches checkout, `POST /api/orders/:id/prepare-payment` idempotently creates/links a `Portal Invoice` using the same internal helpers the current flows use, and the extracted `<PaymentMethods>` component drives that invoice exactly as `/payment/:invoiceDocName` does today. Order status derives from the linked invoice.

**Tech Stack:** Express route factories (`module.exports = (ctx) => router`), Frappe REST via `frappeClient()`, plain-node test scripts (`backend/test/*.test.js`, ok/section pattern), React 18 + react-router v6 + Tailwind (murzak-* tokens), Playwright e2e in `frontend/e2e/`.

## Global Constraints

- **White-label:** customer-facing copy never names Hostinger, Frappe, ERPNext, Coolify, or "KVM" (see `SERVER_CAPACITY` note in `frontend/src/config/serviceCatalog.ts:43`).
- **Prices are server-side only:** every charged amount comes from `backend/data/serviceCatalogSnapshot.json` via `getServiceMeta()` — never from the client request body.
- **B1 gate untouched:** `backend/services/billingActivationService.js` and the M-Pesa/PayPal verification paths must not be modified.
- **Reservation TTL:** 30 minutes (`RESERVATION_TTL_MS = 30 * 60 * 1000`), renewed by `GET /api/orders/:id` while unpaid.
- **The word "plan" must not appear in new checkout-facing copy** (storefront spec); buyers see products at tiers.
- **KES display:** always via `formatKes()` from `serviceCatalog.ts`.
- **Backend tests:** plain node scripts registered in the `npm test` chain (`backend/package.json:10`); mock the Frappe client like `backend/test/billing.test.js:45-63` does. Run from `backend/`: `node test/<file>.test.js`.
- **Dark mode + mobile:** new UI uses existing `murzak-*`/`glass-card` classes and `dark:` variants; price and primary CTA visible without scrolling at 375 px width.
- **Snapshot regeneration:** any `serviceCatalog.ts` field the backend needs requires re-running `node backend/scripts/generate-catalog-snapshot.js` (regex extractor — new fields must be one-per-line `key: "value"` or `key: 123`).

## File Structure

```
backend/
  services/checkout/orderStore.js        # NEW — Checkout Order CRUD + reservation ledger
  services/addonInvoiceService.js        # NEW — extracted from server.js /api/addons/invoice/create
  routes/ordersRoutes.js                 # NEW — /api/orders* endpoints (ctx factory)
  test/orderStore.test.js                # NEW
  test/ordersRoutes.test.js              # NEW
  docs/checkout-order-doctype.md         # NEW — Frappe doctype field reference
frontend/src/
  components/PaymentMethods.tsx          # NEW — extracted from pages/Payment.tsx
  pages/Checkout.tsx                     # NEW — /checkout/:orderId + /checkout/new
  pages/Payment.tsx                      # MODIFIED — slims to invoice loader + summary + <PaymentMethods>
  components/CloudLaunchModal.tsx        # MODIFIED — config-only, ends at /checkout/:id
  config/serviceCatalog.ts               # MODIFIED — checkout line/copy helpers
  App.tsx                                # MODIFIED — /checkout routes
frontend/e2e/
  checkout.spec.ts                       # NEW
```

---

### Task 1: Extract `createAddonInvoice` into a service

The `/api/addons/invoice/create` handler body (starts `backend/server.js:1147`) is the only code that knows how to price + create/merge an add-on `Portal Invoice`. `prepare-payment` (Task 3) needs the same logic, so extract it first.

**Files:**
- Create: `backend/services/addonInvoiceService.js`
- Modify: `backend/server.js:1147` (handler becomes a thin wrapper)
- Test: `backend/test/addonInvoiceService.test.js`

**Interfaces:**
- Consumes: `getServiceMeta`, `sumSelectedServicesMonthlyKes` (`services/provisioning/catalog.js`), `isAddonEligible` (`services/addonEligibility.js`), `assertOrderWithinCapacity` (`services/orderCapacity.js`).
- Produces (later tasks rely on this exact signature):
  ```js
  // services/addonInvoiceService.js
  // Creates or merges an unpaid Add-on Portal Invoice. Throws err.statusCode
  // (400/403/422) on validation failure. deps carries the server.js helpers.
  async function createAddonInvoice({ client, webAccountName, services, deps })
  // -> { invoiceDocName, amountKes }
  ```
  `deps` = `{ fetchWebAccount, hasPaidSubscriptionForPlan, normalizeSelectedServices, findOpenInvoice, normalizeInvoiceServiceRow, buildInvoiceServiceRows, PORTAL_INVOICE_SERVICES_FIELD }` — all already defined in `server.js` scope.

- [ ] **Step 1: Write the failing test**

`backend/test/addonInvoiceService.test.js`, following the harness in `test/billing.test.js:13-24` (copy the `ok`/`section`/`throws` helpers verbatim):

```js
const { createAddonInvoice } = require("../services/addonInvoiceService");

// Minimal mock frappe client: GET returns account/invoice fixtures, POST
// captures the created invoice and returns a name.
function makeClient({ account, openInvoice = null }) {
  const posts = [];
  const puts = [];
  return {
    posts, puts,
    get: async (url, opts) => {
      if (url.includes("/Web Account/") || url.includes("/Web%20Account/"))
        return { data: { data: account } };
      if (url.includes("/api/resource/Portal Invoice") && opts?.params)
        return { data: { data: openInvoice ? [openInvoice] : [] } };
      if (openInvoice && url.includes(openInvoice.name))
        return { data: { data: openInvoice } };
      return { data: { data: {} } };
    },
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: { name: "PINV-NEW-1" } } }; },
    put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
  };
}

const deps = {
  fetchWebAccount: async (client) => (await client.get("/api/resource/Web Account/acct-1")).data.data,
  hasPaidSubscriptionForPlan: async () => true,
  normalizeSelectedServices: (s) => s,
  findOpenInvoice: async (client) => null,
  normalizeInvoiceServiceRow: (r) => r,
  buildInvoiceServiceRows: (rows) => rows,
  PORTAL_INVOICE_SERVICES_FIELD: "services",
};

(async () => {
  section("createAddonInvoice: prices from snapshot and creates a new invoice");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.invoiceDocName === "PINV-NEW-1", "returns created invoice docName");
    ok(res.amountKes === 1200, "amount priced from snapshot, not request");
    ok(client.posts.length === 1, "one invoice POST issued");
  }

  section("createAddonInvoice: PLAN_NOT_PAID is a 403 with code");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1",
        deps: { ...deps, hasPaidSubscriptionForPlan: async () => false },
        services: [{ serviceId: "starter-web-hosting" }],
      }),
      403, "unpaid plan is refused"
    );
  }

  section("createAddonInvoice: unknown service id is a 400");
  {
    const client = makeClient({ account: { plan: "Starter", services: [] } });
    await throws(
      () => createAddonInvoice({ client, webAccountName: "acct-1", deps, services: [{ serviceId: "no-such-svc" }] }),
      400, "unpriced/unknown service refused"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `node test/addonInvoiceService.test.js`
Expected: FAIL — `Cannot find module '../services/addonInvoiceService'`

- [ ] **Step 3: Implement by extraction**

Create `backend/services/addonInvoiceService.js`. Move the **entire body** of the `app.post("/api/addons/invoice/create", ...)` handler (from `backend/server.js:1147` down to that handler's closing `});` — it ends after the "create a new invoice" branch that POSTs a `Portal Invoice` and returns `{ ok: true, invoiceId }`) into:

```js
// services/addonInvoiceService.js
//
// Add-on invoice creation, extracted from the /api/addons/invoice/create
// handler so order prepare-payment (ordersRoutes) can reuse it. All pricing
// comes from the catalog snapshot; PLAN_NOT_PAID / eligibility / capacity
// gates are preserved exactly.

const { getServiceMeta, sumSelectedServicesMonthlyKes } = require("./provisioning/catalog");
const { isAddonEligible } = require("./addonEligibility");
const { assertOrderWithinCapacity } = require("./orderCapacity");

async function createAddonInvoice({ client, webAccountName, services, deps }) {
  const {
    fetchWebAccount, hasPaidSubscriptionForPlan, normalizeSelectedServices,
    findOpenInvoice, normalizeInvoiceServiceRow, buildInvoiceServiceRows,
    PORTAL_INVOICE_SERVICES_FIELD,
  } = deps;
  // ...moved handler body...
  // Adaptations while moving:
  //  - `return res.status(N).json({ code, error })`  becomes
  //      `const err = new Error(error); err.statusCode = N; err.code = code; throw err;`
  //  - the final `return res.json({ ok: true, invoiceId })` becomes
  //      `return { invoiceDocName: createdInvoiceId, amountKes: amount };`
  //    (both branches: merged-open-invoice and freshly-created)
  //  - WEB_ACCOUNT_SERVICES_FIELD / CHILD_SERVICE_ID_FIELD stay module-level
  //    consts here, copied from their server.js values ("services"/"service_id").
}

module.exports = { createAddonInvoice };
```

Then replace the `server.js` handler body with:

```js
app.post("/api/addons/invoice/create", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
    const { services } = req.body || {};
    const result = await createAddonInvoice({
      client: frappeClient(), webAccountName, services,
      deps: {
        fetchWebAccount, hasPaidSubscriptionForPlan, normalizeSelectedServices,
        findOpenInvoice, normalizeInvoiceServiceRow, buildInvoiceServiceRows,
        PORTAL_INVOICE_SERVICES_FIELD,
      },
    });
    return res.json({ ok: true, invoiceId: result.invoiceDocName });
  } catch (err) {
    const status = err.statusCode || 500;
    const body = { error: err.message || "Failed to create add-on invoice." };
    if (err.code) body.code = err.code;
    if (status === 500) console.error("ADDON INVOICE ERROR:", err.response?.data || err.message);
    return res.status(status).json(body);
  }
});
```

Add `const { createAddonInvoice } = require("./services/addonInvoiceService");` next to the other service requires (`server.js:88-92`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/addonInvoiceService.test.js` — Expected: all `ok:` lines, exit 0.
Run: `npm test` — Expected: existing chain still passes (nothing else changed behavior).

- [ ] **Step 5: Register test + commit**

Add `&& node test/addonInvoiceService.test.js` to the `test` script in `backend/package.json:10`.

```bash
git add backend/services/addonInvoiceService.js backend/server.js backend/test/addonInvoiceService.test.js backend/package.json
git commit -m "refactor: extract add-on invoice creation into addonInvoiceService"
```

---

### Task 2: Checkout Order store with RAM reservation

**Files:**
- Create: `backend/services/checkout/orderStore.js`
- Create: `backend/docs/checkout-order-doctype.md`
- Test: `backend/test/orderStore.test.js`

**Interfaces:**
- Consumes: `getServiceMeta` (`services/provisioning/catalog.js`), `thresholdMb` (`services/provisioning/capacity.js`).
- Produces (Task 3 relies on these exact signatures):
  ```js
  const ORDER_DOCTYPE = "Checkout Order";
  const RESERVATION_TTL_MS = 30 * 60 * 1000;
  // All take an explicit `nowMs` so tests never need Date.now mocking.
  async function createOrder({ client, webAccountName, serviceId, config, planKey, source, fleetReservedRamMb, nowMs })
  //  -> order object; throws 400 (unknown service), 409 code "CAPACITY"
  async function getOrder({ client, webAccountName, orderId, nowMs, renew }) // -> order; throws 404/403
  async function cancelOrder({ client, webAccountName, orderId })            // -> { ok: true }
  async function linkInvoice({ client, orderId, invoiceDocName })
  async function reservedDraftRamMb(client, nowMs)                           // -> number
  function toApiOrder(doc) // frappe snake_case doc -> camelCase API shape
  ```
- Order doc fields (snake_case, documented in `checkout-order-doctype.md`): `web_account`, `status` (`Draft`/`Paid`/`Cancelled`), `service_id`, `service_name`, `tier`, `category`, `monthly_kes`, `setup_kes`, `ram_mb`, `disk_gb`, `plan_key`, `config_json`, `reservation_expires_at` (ISO), `invoice_doc_name`, `source`.
- API shape from `toApiOrder`: `{ id, status, serviceId, serviceName, tier, category, monthlyKes, setupKes, totalDueKes, reservationExpiresAt, invoiceDocName, config }` where `totalDueKes = monthly_kes + setup_kes`.

**Reservation semantics (write these as comments in the module):**
- Reserved = sum of `ram_mb` over orders with `status = "Draft"` AND `reservation_expires_at > now`. Expiry needs no sweeper — expired drafts simply stop counting.
- `createOrder` guard: `fleetReservedRamMb + reservedDraftRamMb + newRamMb > thresholdMb()` → 409 `CAPACITY`. Serialized through a module-level promise-chain mutex (single Node process — same assumption the provisioning gate makes):
  ```js
  let createChain = Promise.resolve();
  function serialize(fn) { const p = createChain.then(fn, fn); createChain = p.catch(() => {}); return p; }
  ```
- `getOrder` with `renew: true` on an unexpired unpaid Draft bumps `reservation_expires_at` to `now + RESERVATION_TTL_MS` (this is the checkout-page heartbeat). If the order has an `invoice_doc_name`, fetch that invoice; if its status is Paid, PUT `status: "Paid"` on the order (reservation stops counting) before returning.
- A Frappe 404 **on the doctype itself** (first GET of the list) must surface as `err.statusCode = 503`, message `"Checkout is not configured."` — mirror the doctypeMissing tolerance used by `services/provisioning/provisioningService.js`.

- [ ] **Step 1: Write the failing test**

`backend/test/orderStore.test.js` (same ok/section/throws harness). Mock client is an in-memory doc store:

```js
const {
  createOrder, getOrder, cancelOrder, linkInvoice, reservedDraftRamMb, RESERVATION_TTL_MS,
} = require("../services/checkout/orderStore");

function makeClient({ invoices = {} } = {}) {
  const docs = {}; let seq = 0;
  return {
    docs,
    get: async (url, opts) => {
      if (url.includes("/Portal Invoice/")) {
        const name = decodeURIComponent(url.split("/").pop());
        return { data: { data: invoices[name] || null } };
      }
      if (url.endsWith("/Checkout Order") || url.endsWith("/Checkout%20Order"))
        return { data: { data: Object.values(docs) } };   // list endpoint
      const name = decodeURIComponent(url.split("/").pop());
      if (!docs[name]) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
      return { data: { data: docs[name] } };
    },
    post: async (url, body) => { const name = `CHK-${++seq}`; docs[name] = { name, ...body }; return { data: { data: docs[name] } }; },
    put: async (url, body) => { const name = decodeURIComponent(url.split("/").pop()); Object.assign(docs[name], body); return { data: { data: docs[name] } }; },
  };
}

const T0 = 1_800_000_000_000; // fixed epoch for deterministic tests

(async () => {
  section("createOrder: prices + footprint from snapshot, reservation set");
  {
    const client = makeClient();
    const order = await createOrder({
      client, webAccountName: "acct-1", serviceId: "starter-web-hosting",
      config: { domainChoice: "Use Murzak Subdomain" }, planKey: "Starter",
      source: "CloudLaunch", fleetReservedRamMb: 0, nowMs: T0,
    });
    ok(order.monthlyKes === 1200 && order.setupKes === 500, "prices from snapshot");
    ok(order.totalDueKes === 1700, "totalDue = monthly + setup");
    ok(order.status === "Draft", "starts as Draft");
    ok(Date.parse(order.reservationExpiresAt) === T0 + RESERVATION_TTL_MS, "30-min reservation");
  }

  section("createOrder: unknown service -> 400");
  await throws(
    () => createOrder({ client: makeClient(), webAccountName: "a", serviceId: "nope", config: {}, fleetReservedRamMb: 0, nowMs: T0 }),
    400, "unknown service refused"
  );

  section("capacity: draft reservations count until they expire");
  {
    const client = makeClient();
    await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    ok((await reservedDraftRamMb(client, T0)) === 768, "live draft counts (starter-web-hosting = 768MB)");
    ok((await reservedDraftRamMb(client, T0 + RESERVATION_TTL_MS + 1)) === 0, "expired draft stops counting");
  }

  section("capacity: create refuses when fleet+drafts+new exceeds threshold");
  await throws(
    () => createOrder({
      client: makeClient(), webAccountName: "a", serviceId: "starter-web-hosting",
      config: {}, fleetReservedRamMb: 999999, nowMs: T0,
    }),
    409, "over-threshold create is a 409 CAPACITY"
  );

  section("getOrder: ownership, renewal heartbeat, paid derivation");
  {
    const invoices = { "PINV-1": { name: "PINV-1", status: "Paid" } };
    const client = makeClient({ invoices });
    const o = await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    await throws(() => getOrder({ client, webAccountName: "intruder", orderId: o.id, nowMs: T0 }), 403, "not-owner is 403");
    const renewed = await getOrder({ client, webAccountName: "a", orderId: o.id, nowMs: T0 + 60_000, renew: true });
    ok(Date.parse(renewed.reservationExpiresAt) === T0 + 60_000 + RESERVATION_TTL_MS, "heartbeat renews reservation");
    await linkInvoice({ client, orderId: o.id, invoiceDocName: "PINV-1" });
    const paid = await getOrder({ client, webAccountName: "a", orderId: o.id, nowMs: T0 + 120_000 });
    ok(paid.status === "Paid", "linked Paid invoice flips order to Paid");
    ok((await reservedDraftRamMb(client, T0 + 120_000)) === 0, "paid order no longer reserves");
  }

  section("cancelOrder releases the reservation");
  {
    const client = makeClient();
    const o = await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    await cancelOrder({ client, webAccountName: "a", orderId: o.id });
    ok((await reservedDraftRamMb(client, T0)) === 0, "cancelled order stops counting");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/orderStore.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `orderStore.js`**

Implement per the interface block above. Concretes:
- `createOrder` looks up `getServiceMeta(serviceId)`; refuse (400) when meta is null, `monthlyKes` is not `> 0`, or `capacityClass` is `"dedicated"` (quote-only never self-serve). Store `ram_mb`/`disk_gb` from meta, `monthly_kes`/`setup_kes` from meta (`setupKes` may be undefined → 0), `config_json: JSON.stringify(config || {})`.
- Capacity check inside `serialize()`: recompute `reservedDraftRamMb` from a fresh list read, then compare against `thresholdMb()` (from `../provisioning/capacity`), then POST.
- The list read uses `client.get("/api/resource/Checkout Order", { params: { fields: JSON.stringify(["name","web_account","status","ram_mb","reservation_expires_at"]), filters: JSON.stringify([["status","=","Draft"]]), limit_page_length: 0 } })`. In the mock this returns all docs — filter again in JS so behavior is identical with and without server-side filtering.
- `toApiOrder(doc)` parses `config_json` back to `config`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/orderStore.test.js` — Expected: all pass, exit 0.

- [ ] **Step 5: Write the doctype reference doc**

`backend/docs/checkout-order-doctype.md`: list every field from the Interfaces block with Frappe field types (`web_account`: Link → Web Account; `status`: Select Draft/Paid/Cancelled, default Draft; `config_json`: Long Text; `reservation_expires_at`: Datetime; money/RAM fields: Int; the rest: Data) and one line: *"Create this doctype in the Frappe admin before enabling checkout in an environment; the API returns 503 'Checkout is not configured.' until it exists."*

- [ ] **Step 6: Register test + commit**

Append `&& node test/orderStore.test.js` to the npm test chain.

```bash
git add backend/services/checkout/orderStore.js backend/test/orderStore.test.js backend/docs/checkout-order-doctype.md backend/package.json
git commit -m "feat: Checkout Order store with 30-min RAM reservations"
```

---

### Task 3: `/api/orders` routes

**Files:**
- Create: `backend/routes/ordersRoutes.js`
- Modify: `backend/server.js:3663-3668` (mount), plus extend `routeContext` with the keys listed below
- Modify: `backend/services/provisioning/provisioningService.js` (export `getReservedRamMb` if not already exported — it is defined near line 55)
- Test: `backend/test/ordersRoutes.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–2, plus from `routeContext`: `requireAuth`, `frappeClient`, `fetchWebAccount`, `applyPlanAndCreateInvoice`, `updateWebAccountServices`, `fetchInvoicesForUser`, `asArray`, `normalizeChildRow`, and the Task 1 `deps` helpers. Add any of these missing from `routeContext` where it is assembled in `server.js` (search `routeContext = {` / `const routeContext`), and update `backend/test/routesContext.test.js` if it asserts the ctx key set.
- Produces (frontend Tasks 5–7 rely on these exact contracts):
  - `POST /api/orders` body `{ serviceId, config?, planKey?, source? }` → `200 { ok, order }` (order = `toApiOrder` shape) · `400` unknown service · `409 { code: "CAPACITY", error, waitlistAvailable: true }` · `422` per-order cap · `503` doctype missing.
  - `GET /api/orders/:id` → `{ ok, order }` (renews the reservation as heartbeat) · 403/404.
  - `POST /api/orders/:id/cancel` → `{ ok }`.
  - `POST /api/orders/:id/prepare-payment` → `{ ok, invoiceDocName }` (idempotent).
  - `POST /api/orders/waitlist` body `{ serviceId }` → `{ ok }` — creates a `Capacity Request` doc (POST to `/api/resource/Capacity Request` with `{ reason: "checkout-waitlist", service_id, web_account, status: "Open" }`; the doctype constant lives in `services/provisioning/scaling.js:16`).

**Handler logic:**
- `POST /api/orders`: `assertOrderWithinCapacity([{ serviceId }])` (per-order 422 cap), compute `fleetReservedRamMb = await getReservedRamMb(client)` (`|| 0` on null), then `createOrder(...)` with `nowMs: Date.now()`.
- `prepare-payment`: load order (must be owner, status Draft, unexpired reservation — expired → 409 `RESERVATION_EXPIRED`, client re-GETs to re-reserve). If `invoice_doc_name` already set and that invoice is not Paid → return it. Otherwise branch:
  - **Has paid plan** (`hasPaidSubscriptionForPlan(client, webAccountName, record.plan)`): `createAddonInvoice` (Task 1) with the order's single service row `{ serviceId, serviceName, tier, domainChoice: config.domainChoice || "" }`.
  - **No paid plan** (first purchase): `applyPlanAndCreateInvoice(client, webAccountName, order.planKey || "Starter", { force: true, creditKes: 0 })`, then merge the order's service row into the account services via `updateWebAccountServices` (mirror the row shape used at `server.js:1115-1145` `mergeServicesById`), then `fetchInvoicesForUser` and pick the newest `status === "Unpaid"` invoice.
  - Then `linkInvoice({ client, orderId, invoiceDocName })` and respond.

- [ ] **Step 1: Write the failing test**

`backend/test/ordersRoutes.test.js`: instantiate the factory directly (no HTTP server), calling handlers with stub `req`/`res` — follow the style of `backend/test/routesContext.test.js` if it exercises route factories, otherwise:

```js
const createOrdersRouter = require("../routes/ordersRoutes");

function makeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function findHandler(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  // last handler in the stack is the business handler (first is requireAuth)
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
```

Cases (reuse the Task 2 in-memory mock client via a small local copy or a shared `test/helpers/mockFrappe.js` you create now):
1. `POST /api/orders` happy path → 200, `body.order.monthlyKes === 1200`, `body.order.status === "Draft"`.
2. `POST /api/orders` with fleet reserved forced huge (stub `getReservedRamMb: async () => 999999` via ctx) → 409, `body.code === "CAPACITY"`, `body.waitlistAvailable === true`.
3. `GET /api/orders/:id` as another account → 403.
4. `prepare-payment` add-on branch: ctx `hasPaidSubscriptionForPlan: async () => true`, stub `createAddonInvoice` injected via ctx returning `{ invoiceDocName: "PINV-9" }` → 200 `{ invoiceDocName: "PINV-9" }`, and the order doc's `invoice_doc_name` is `"PINV-9"`.
5. `prepare-payment` is idempotent: second call returns the same `invoiceDocName` without calling `createAddonInvoice` again (count invocations).
6. `POST /api/orders/waitlist` → posts a `Capacity Request` doc.

For injectability, the factory should read `createAddonInvoice` and `getReservedRamMb` **from ctx** (server.js passes the real ones into `routeContext`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/ordersRoutes.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `ordersRoutes.js`**

Factory shape copied from `routes/billingRoutes.js:1-42` (destructure ctx, build `express.Router()`, every endpoint behind `requireAuth` except none — all five are authed). Error mapping identical to Task 1's wrapper (statusCode/code passthrough, 500 logged).

- [ ] **Step 4: Wire into server.js**

Add to `routeContext`: `createAddonInvoice`, `getReservedRamMb`, and any missing helpers from the Interfaces list. Export `getReservedRamMb` from `provisioningService.js` if needed. Mount after billing: `app.use(require('./routes/ordersRoutes')(routeContext));` at `server.js:3668`.

- [ ] **Step 5: Run tests**

Run: `node test/ordersRoutes.test.js` — Expected: PASS.
Run: `npm test` (after appending `&& node test/ordersRoutes.test.js`) — Expected: full chain PASS (including `routesContext.test.js` — update its expected-keys list if it fails on the new ctx keys).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/ordersRoutes.js backend/test/ordersRoutes.test.js backend/test/helpers/mockFrappe.js backend/server.js backend/services/provisioning/provisioningService.js backend/package.json
git commit -m "feat: /api/orders draft-order endpoints with reservation + prepare-payment"
```

---

### Task 4: Extract `<PaymentMethods>` from Payment.tsx

**Files:**
- Create: `frontend/src/components/PaymentMethods.tsx`
- Modify: `frontend/src/pages/Payment.tsx`

**Interfaces:**
- Produces (Task 5 relies on this exact prop contract):
  ```tsx
  export interface PaymentMethodsProps {
    invoiceDocName: string;
    chargeKes: number;
    amountUsd: number;          // invoice.paypalAmountUsd
    disabled?: boolean;         // e.g. while invoice still loading
    onSuccess: (user?: any) => void;
    successContent?: React.ReactNode; // line-specific "what happens next" copy on the success screen
  }
  export default function PaymentMethods(props: PaymentMethodsProps): JSX.Element
  ```
- The component **owns** all payment state and screens: `method/step/phoneNumber/errors/isProcessing/pollTimedOut/checkingStatus/mpesaReceipt`, the M-Pesa handlers (`Payment.tsx:82-196`), the dev mock-pay button (`Payment.tsx:198-226`), the method selector + form + PayPal sections (`Payment.tsx:290-383` minus the `orderSummary` block), and the processing/timeout/success screens (`Payment.tsx:385-444`). The success screen renders `successContent` when provided, else the current copy at `Payment.tsx:433-437`.

- [ ] **Step 1: Create the component by moving code**

Move the listed ranges into `PaymentMethods.tsx` unchanged except: `invoiceDocName` comes from props (not `useParams`), `chargeKes`/`amountUsd` from props (delete the invoice-derived versions), `isVerification` is dropped from the success copy (that nuance stays in Payment.tsx via `successContent`), and the top-level wrapper is the `glass-card` div currently at `Payment.tsx:289`.

- [ ] **Step 2: Slim Payment.tsx**

Payment.tsx keeps: invoice fetch (`:48-75`), header (`:270-288`), `orderSummary` (`:236-268`), then renders:

```tsx
<PaymentMethods
  invoiceDocName={invoiceDocName || ""}
  chargeKes={chargeKes}
  amountUsd={Number(invoice?.paypalAmountUsd || 0)}
  disabled={loadingInvoice}
  onSuccess={onSuccess}
  successContent={
    <p className="text-sm font-bold text-slate-500 leading-relaxed">
      {isVerification
        ? "Your trial is starting now — head to your portal to begin exploring."
        : "We're setting up your services. Instant services go live right away; managed setups are configured by our team within 24 hours — you can watch progress in your portal."}
    </p>
  }
/>
```

Delete every moved state/handler from Payment.tsx; `orderSummary` renders above the component inside the same page container.

- [ ] **Step 3: Verify no behavior change**

Run: `cd frontend && npx tsc --noEmit` — Expected: clean.
Run: `npx playwright test e2e/qa-payments-idempotency.spec.ts` — Expected: PASS (same pass/fail set as on master before this change; run it on master first if unsure).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PaymentMethods.tsx frontend/src/pages/Payment.tsx
git commit -m "refactor: extract PaymentMethods from Payment page"
```

---

### Task 5: Checkout page + routes + catalog copy helpers

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts` (append helpers)
- Create: `frontend/src/pages/Checkout.tsx`
- Modify: `frontend/src/App.tsx` (routes; see `:394-401` for the RequireAuth pattern)

**Interfaces:**
- Consumes: `GET /api/orders/:id`, `POST /api/orders/:id/prepare-payment`, `GET /api/billing/invoice/:docName` (existing, for `chargeKes`/`paypalAmountUsd`), `POST /api/orders` (deep-link), `<PaymentMethods>` (Task 4).
- Produces in `serviceCatalog.ts`:
  ```ts
  export type CheckoutLine = "cloud" | "app-hosting" | "business-system" | "hosting-service";
  export function checkoutLineFor(svc: ServiceItem): CheckoutLine
  // premium -> "business-system"; category "App Hosting" -> "app-hosting";
  // CLOUD_LAUNCH_CATEGORIES member -> "cloud"; otherwise "hosting-service".
  export function postPurchaseCopy(svc: ServiceItem): string
  // isManagedSetup(svc) -> "Our team configures your system and hands it over within 24 hours — watch progress in your portal."
  // requiresRepo        -> "We deploy straight from your repository — your app is typically live in about 10 minutes."
  // otherwise           -> "Your resource is provisioned automatically and is typically live in about 10 minutes."
  export const CHECKOUT_RESERVATION_MINUTES = 30;
  ```

- [ ] **Step 1: Add the catalog helpers** (code above, appended after `isManagedSetup`, `serviceCatalog.ts:817`).

- [ ] **Step 2: Build `Checkout.tsx`**

One default export handling **both** routes:
- `/checkout/new?serviceId=<id>` (no orderId param): on mount `POST /api/orders { serviceId, source: "deep-link" }` → `navigate(\`/checkout/${order.id}\`, { replace: true })`. On 409 CAPACITY render the waitlist block (below); on 400 redirect `/cloud`.
- `/checkout/:orderId`: on mount `GET /api/orders/:orderId` (this renews the reservation), then `POST prepare-payment` → `invoiceDocName`, then `GET /api/billing/invoice/:docName` for `chargeKes`/`paypalAmountUsd`. Re-GET the order every 5 minutes while unpaid (keeps the reservation alive — matches `RESERVATION_TTL_MS` with wide margin).

Layout (mobile-first, single column; reuse page chrome classes from `Payment.tsx:271-289`):
1. **Order summary card** (`glass-card`): `order.serviceName` + tier, `formatKes(order.monthlyKes)}/mo` (+ `formatKes(order.setupKes)` one-time setup when > 0), first-payment total `formatKes(order.totalDueKes)`. No plan wording anywhere.
2. **What happens after payment**: `postPurchaseCopy(getService(order.serviceId)!)` (fallback to the generic string when the id is not in the catalog).
3. **Reservation timer**: countdown to `order.reservationExpiresAt` — "We're holding your spot · {mm}:{ss}". At zero, replace pay UI with a "Resume checkout" button that re-GETs the order (re-reserves) and, on 409 CAPACITY, shows the waitlist block.
4. `<PaymentMethods invoiceDocName={...} chargeKes={...} amountUsd={...} onSuccess={...} successContent={<p ...>{postPurchaseCopy(...)}</p>} />`
5. **Waitlist block** (shared with step 1's 409): "We're at capacity right now." + button "Join the waitlist" → `POST /api/orders/waitlist { serviceId }` → confirmation text "You're on the list — we'll email you the moment a slot opens."

`onSuccess` navigates to `/portal` (same `handlePaymentSuccess` prop App.tsx passes to Payment — reuse it).

- [ ] **Step 3: Register routes in App.tsx**

Next to the `/payment` routes (`App.tsx:394-406`):

```tsx
<Route
  path="/checkout/new"
  element={<RequireAuth user={user}><Checkout onSuccess={handlePaymentSuccess} /></RequireAuth>}
/>
<Route
  path="/checkout/:orderId"
  element={<RequireAuth user={user}><Checkout onSuccess={handlePaymentSuccess} /></RequireAuth>}
/>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean. Then dev-boot (backend `MOCK_FRAPPE=true` per the project's dev recipe) and manually drive `/checkout/new?serviceId=starter-web-hosting` → order summary renders, timer counts down, dev mock-pay button completes to success. Console free of errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts frontend/src/pages/Checkout.tsx frontend/src/App.tsx
git commit -m "feat: shared /checkout page with reservation timer and deep-link entry"
```

---

### Task 6: Rewire CloudLaunchModal

**Files:**
- Modify: `frontend/src/components/CloudLaunchModal.tsx`

**Interfaces:**
- Consumes: `POST /api/orders` (Task 3 contract).
- Scope note: **logged-in flow only.** The logged-out path (`launchLoggedOut`, `:174-202`, localStorage pending-selection → login) is explicitly unchanged in this plan; converting it to order-resume is listed in Follow-ups.

- [ ] **Step 1: Replace `launchLoggedIn`**

Replace the body of `launchLoggedIn` (`CloudLaunchModal.tsx:106-172`) with:

```tsx
const launchLoggedIn = async () => {
  if (!selected) return;
  // Save the repo URL BEFORE creating the order (unchanged rationale: a
  // repo-save failure aborts cleanly with nothing created).
  await attachRepoIfNeeded();

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      serviceId: selected.id,
      planKey: planForService(selected.id) || "Starter",
      source: "CloudLaunch",
      config: {
        domainChoice: selected.requiresDomainChoice ? domainChoice : "",
        ...(selected.requiresRepo ? { repoUrl } : {}),
        ...(appPort.trim() ? { appPort: Number(appPort.trim()) } : {}),
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.code === "CAPACITY") {
    setCapacityFull(true);
    return;
  }
  if (!res.ok) throw new Error(data?.error || "Failed to start checkout.");
  onClose();
  onNavigate(`/checkout/${data.order.id}`);
};
```

Add state `const [capacityFull, setCapacityFull] = useState(false);` (reset in the existing `isOpen` effect at `:70-74`). When `capacityFull`, render in place of the error block: "We're at capacity right now." + a "Join the waitlist" button that POSTs `/api/orders/waitlist { serviceId: selected.id }` and swaps to "You're on the list — we'll email you the moment a slot opens."

The invoice-flow imports (`PLAN_META` usage stays for `launchLoggedOut`) and the `/api/addons/invoice/create` + `/api/plan/attach-selection` calls in this file are deleted.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — clean. Dev-boot; from `/cloud` launch a resource while logged in (mock env) → lands on `/checkout/:orderId` with the right product and price; mock-pay completes.

- [ ] **Step 3: Update the existing e2e expectations**

`frontend/e2e/cloud-launch.spec.ts` and `frontend/e2e/qa-checkout-launch.spec.ts` assert the old `/payment/...` destination — update those assertions to expect `/checkout/` URLs for the logged-in launch path. Run both specs.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CloudLaunchModal.tsx frontend/e2e/cloud-launch.spec.ts frontend/e2e/qa-checkout-launch.spec.ts
git commit -m "feat: CloudLaunchModal ends at /checkout — payment leaves the modal"
```

---

### Task 7: End-to-end spec + full verification

**Files:**
- Create: `frontend/e2e/checkout.spec.ts`

- [ ] **Step 1: Write the spec**

Mirror the login/bootstrapping helpers used by `frontend/e2e/cloud-launch.spec.ts` (read it first; reuse its login helper and mock-env assumptions). Cases:

1. **Happy path:** login → open Cloud launch modal → pick `starter-web-hosting` → Launch → URL matches `/checkout/CHK-` → order summary shows "Website Hosting (Starter)" and "KES 1,200" → reservation timer visible (text matches `/holding your spot/i`) → click the dev mock-pay button → success screen shows the post-purchase copy.
2. **Deep link:** navigate to `/checkout/new?serviceId=starter-web-hosting` while logged in → redirected to `/checkout/CHK-…` → summary renders.
3. **Vocabulary guard:** on the rendered checkout page, `expect(page.locator("body")).not.toContainText(/\bplan\b/i)` — the storefront spec's "plan is banned from checkout" rule as an executable check.
4. **Auth guard:** logged out, `/checkout/new?serviceId=starter-web-hosting` redirects to `/login` (match the assertion style in `e2e/auth-guards.spec.ts`).

- [ ] **Step 2: Run everything**

Run: `cd backend && npm test` — Expected: full chain PASS.
Run: `cd frontend && npx tsc --noEmit && npx playwright test e2e/checkout.spec.ts e2e/cloud-launch.spec.ts e2e/qa-checkout-launch.spec.ts e2e/qa-payments-idempotency.spec.ts e2e/auth-guards.spec.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/checkout.spec.ts
git commit -m "test: end-to-end checkout flow coverage"
```

---

## Follow-ups (explicitly out of this plan's scope)

- **Full `PRODUCT_CATALOG` restructure** (product-first tiers for CRM/ERP/POS): deferred to the business-systems phase — this plan adds only the checkout-line/copy helpers the checkout page needs, since existing cloud products already ARE catalog entries with server-side prices.
- **Expired-draft cleanup job** (spec's 24 h draft TTL): expired reservations already stop counting toward capacity with no sweeper, so lingering Draft docs are cosmetic; add a cleanup sweep when order volume warrants it.
- Logged-out CloudLaunch → login → order resume (today: unchanged legacy pending-selection flow).
- DeployWizard rewire (checkout spec phase 3).
- Business-systems tier cards, domains/databases product pages (phases 4–5); two-lane storefront restructure.
- Invoice-per-order receipts numbering; migrating portal add-ons/renewals onto orders (phase 6).
- Frappe `Checkout Order` doctype must be created manually in each environment per `backend/docs/checkout-order-doctype.md` before go-live.
