# Billing Term Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mutable `billing_term`/`term_started_on` Web Account fields (root cause of Criticals C1–C5 in the prior whole-branch review) with a single derivation path — the account's current billing term is always read from its last paid Subscription invoice — and defer invoice creation at checkout until a first-time customer has confirmed a term choice.

**Architecture:** One new module, `backend/services/checkoutBillingTerm.js`, is the sole place anything in the codebase answers "what term is this account on, and since when." It exposes three functions used by the renewal sweep, add-on pro-rata, and checkout eligibility respectively — all backed by the same underlying query. `Portal Invoice` gains one new field (`billing_term`); `Web Account` gains none. The checkout flow moves from "auto-fire prepare-payment, correct afterward" to "resolve the term, then create the invoice once, already correct."

**Tech Stack:** Node/Express backend (CommonJS), Frappe REST client, hand-rolled `ok()`/`section()` test scripts (no Jest), React/TypeScript frontend (Vite), Playwright e2e.

## Global Constraints

- Never put `billing_term` in a list-query's `fields` parameter. Frappe throws on an unrecognized column in a bulk query, which would fail renewal billing for the entire customer base (this is C4). Always read it via a single-document GET (`GET /api/resource/Portal Invoice/<name>`), which returns the field as `undefined` when not yet imported rather than erroring.
- `Web Account` gains zero new fields. All term state lives on `Portal Invoice.billing_term`.
- `applyPlanAndCreateInvoice` (`backend/server.js:1443-1524`) is not modified — it is shared by upgrade/configurator/add-on flows with no coverage in this plan. A prior fix attempt broke a repeat-purchase flow by touching a similarly shared primitive; do not repeat that mistake.
- `test/helpers/mockFrappe.js` does not honor `params.filters` on list GETs — it returns every doc of that doctype. Tests that need distinct fixtures per query must use a purpose-built mock client (as `renewal.test.js` and `addonInvoiceService.test.js` already do), not the shared `mockFrappe.js`.
- Any new `require()` added above the `ctx` destructure in `backend/routes/ordersRoutes.js` must be a plain assignment (`const x = require(...).y;`), never a destructured `const { a, b } = require(...);` — `test/routesContext.test.js`'s regex-based wiring check greps the file's *first* curly-brace destructuring assignment to find the ctx keys, and an earlier destructure would make it swallow the wrong block.
- Every pre-existing invoice is safe by construction: an absent `billing_term` field always resolves to `"monthly"`.
- Run `npm test` from `backend/` after every task — it runs all suites in one command, so a regression in an untouched file is caught immediately.

---

### Task 1: `checkoutBillingTerm.js` — the single term-derivation module

**Files:**
- Create: `backend/services/checkoutBillingTerm.js`
- Create: `backend/test/checkoutBillingTerm.test.js`
- Modify: `backend/services/billingTerm.js` (remove `accountBillingTerm`)
- Modify: `backend/test/billingTerm.test.js` (remove its tests)
- Modify: `backend/data/custom-fields-portal-invoice.json` (add `billing_term` field)
- Modify: `docs/provisioning-go-live.md` (document the manual import step)
- Modify: `backend/package.json` (register the new test file)

**Interfaces:**
- Produces: `findLastPaidSubscriptionInvoice(client, webAccountName): Promise<{name, invoice_date} | null>` — any plan, `status="Paid"`, `type="Subscription"`, newest `invoice_date` first. Deliberately excludes `billing_term` from its `fields` (Global Constraint above).
- Produces: `readInvoiceBillingTerm(client, invoiceName): Promise<"monthly"|"annual">` — single-document GET, fail-safe to `"monthly"`.
- Produces: `getCurrentBillingTerm(client, webAccountName): Promise<{term: "monthly"|"annual", anchorDate: string|null, lastPaidInvoiceName: string|null}>` — composes the two above.
- Produces: `isEligibleForTermChoice(client, webAccountName, category): Promise<boolean>` — `false` when `category === "Domain Registration"`; otherwise `true` only when `findLastPaidSubscriptionInvoice` returns `null`.
- Consumes: nothing from other tasks (foundational, no behavior change yet — nothing calls it until Tasks 2–4).

- [ ] **Step 1: Write the failing test file**

```js
// backend/test/checkoutBillingTerm.test.js
//
// checkoutBillingTerm.js — the single source of truth for "what term is
// this account on, and since when." Every consumer (renewal sweep, add-on
// pro-rata, checkout eligibility) goes through one of these four functions,
// so they cannot disagree about the term — that disagreement was the root
// cause of Critical C2 in the prior whole-branch review.

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  findLastPaidSubscriptionInvoice,
  readInvoiceBillingTerm,
  getCurrentBillingTerm,
  isEligibleForTermChoice,
} = require("../services/checkoutBillingTerm");

// Minimal mock: a single "web_account" can have at most one paid Subscription
// invoice fixture, and single-document GETs by name resolve against a small
// name -> doc map. Mirrors the shape of a real Frappe client closely enough
// for these pure query-composition functions.
function makeClient({ paidInvoice = null, docsByName = {} } = {}) {
  return {
    get: async (url, opts) => {
      if (url === "/api/resource/Portal Invoice" && opts?.params) {
        return { data: { data: paidInvoice ? [paidInvoice] : [] } };
      }
      const m = /\/api\/resource\/Portal Invoice\/(.+)$/.exec(url);
      if (m) {
        const name = decodeURIComponent(m[1]);
        const doc = docsByName[name];
        if (!doc) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
        return { data: { data: doc } };
      }
      return { data: { data: {} } };
    },
  };
}

(async () => {
  section("findLastPaidSubscriptionInvoice");
  {
    const client = makeClient({ paidInvoice: { name: "PINV-1", invoice_date: "2026-01-05" } });
    const res = await findLastPaidSubscriptionInvoice(client, "acct-1");
    ok(res?.name === "PINV-1", "returns the paid invoice's name");
    ok(res?.invoice_date === "2026-01-05", "returns the paid invoice's invoice_date");
  }
  {
    const client = makeClient({ paidInvoice: null });
    const res = await findLastPaidSubscriptionInvoice(client, "acct-1");
    ok(res === null, "no paid Subscription invoice -> null");
  }

  section("readInvoiceBillingTerm — fail-safe to monthly");
  {
    const client = makeClient({ docsByName: { "PINV-A": { name: "PINV-A", billing_term: "annual" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-A") === "annual", "explicit annual");
  }
  {
    const client = makeClient({ docsByName: { "PINV-M": { name: "PINV-M", billing_term: "monthly" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-M") === "monthly", "explicit monthly");
  }
  {
    // Pre-existing invoice, never migrated — the field is simply absent,
    // not an error. This is what makes every invoice ever created before
    // this feature safe by construction.
    const client = makeClient({ docsByName: { "PINV-OLD": { name: "PINV-OLD" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-OLD") === "monthly", "missing field -> monthly");
  }
  {
    const client = makeClient({ docsByName: { "PINV-X": { name: "PINV-X", billing_term: "yearly" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-X") === "monthly", "unknown value -> monthly, never trusted raw");
  }

  section("getCurrentBillingTerm");
  {
    const client = makeClient({
      paidInvoice: { name: "PINV-2", invoice_date: "2026-02-10" },
      docsByName: { "PINV-2": { name: "PINV-2", billing_term: "annual" } },
    });
    const res = await getCurrentBillingTerm(client, "acct-1");
    ok(res.term === "annual", "term read from the last paid invoice");
    ok(res.anchorDate === "2026-02-10", "anchorDate is the last paid invoice's own invoice_date");
    ok(res.lastPaidInvoiceName === "PINV-2", "lastPaidInvoiceName is exposed");
  }
  {
    const client = makeClient({ paidInvoice: null });
    const res = await getCurrentBillingTerm(client, "acct-1");
    ok(res.term === "monthly", "no paid invoice -> monthly (first-purchase/no-history case)");
    ok(res.anchorDate === null, "no paid invoice -> anchorDate null");
    ok(res.lastPaidInvoiceName === null, "no paid invoice -> lastPaidInvoiceName null");
  }

  section("isEligibleForTermChoice");
  {
    const client = makeClient({ paidInvoice: null });
    ok(await isEligibleForTermChoice(client, "acct-1", "Web Hosting") === true, "no paid history + monthly-billed product -> eligible");
  }
  {
    const client = makeClient({ paidInvoice: { name: "PINV-3", invoice_date: "2026-01-01" } });
    ok(await isEligibleForTermChoice(client, "acct-1", "Web Hosting") === false, "paid history already exists -> not eligible");
  }
  {
    const client = makeClient({ paidInvoice: null });
    ok(await isEligibleForTermChoice(client, "acct-1", "Domain Registration") === false, "domain product -> never eligible, regardless of history");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/checkoutBillingTerm.test.js`
Expected: `Cannot find module '../services/checkoutBillingTerm'`

- [ ] **Step 3: Write the module**

```js
// backend/services/checkoutBillingTerm.js
//
// The single source of truth for "what term is this account on, and since
// when." Every consumer — the renewal sweep, add-on pro-rata, and checkout
// eligibility — goes through one of the functions here, backed by the same
// underlying query: the account's last PAID Subscription invoice. There is
// no term field on Web Account at all; an account's term is whatever its
// most recently paid Subscription invoice says it is, which is also why a
// renewal invoice automatically becomes next year's anchor with no separate
// "advance the anchor" step required.
//
// SAFETY: `billing_term` must never appear in a list query's `fields` — an
// unrecognized column fails the entire query in Frappe, which for the
// renewal sweep's bulk scan means zero renewals for every customer, not
// just annual ones. findLastPaidSubscriptionInvoice deliberately omits it;
// readInvoiceBillingTerm reads it via a single-document GET instead, which
// simply returns the field as undefined when not yet imported.

async function findLastPaidSubscriptionInvoice(client, webAccountName) {
  const res = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["type", "=", "Subscription"],
        ["status", "=", "Paid"],
      ]),
      fields: JSON.stringify(["name", "invoice_date"]),
      limit_page_length: 1,
      order_by: "invoice_date desc",
    },
  });
  return res.data?.data?.[0] || null;
}

async function readInvoiceBillingTerm(client, invoiceName) {
  const res = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`);
  const doc = res.data?.data;
  return doc?.billing_term === "annual" ? "annual" : "monthly";
}

async function getCurrentBillingTerm(client, webAccountName) {
  const lastPaid = await findLastPaidSubscriptionInvoice(client, webAccountName);
  if (!lastPaid) return { term: "monthly", anchorDate: null, lastPaidInvoiceName: null };
  const term = await readInvoiceBillingTerm(client, lastPaid.name);
  return { term, anchorDate: lastPaid.invoice_date, lastPaidInvoiceName: lastPaid.name };
}

// Domain-registration products bill yearly at a fixed price, never offer a
// term choice, and are excluded regardless of purchase history. Otherwise,
// eligible only for a genuinely new customer's first monthly-billed
// purchase — this is what makes mid-relationship term switching (C5)
// structurally unreachable: nothing on the add-on/returning-customer path
// ever returns true here.
async function isEligibleForTermChoice(client, webAccountName, category) {
  if (category === "Domain Registration") return false;
  const lastPaid = await findLastPaidSubscriptionInvoice(client, webAccountName);
  return !lastPaid;
}

module.exports = {
  findLastPaidSubscriptionInvoice,
  readInvoiceBillingTerm,
  getCurrentBillingTerm,
  isEligibleForTermChoice,
};
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd backend && node test/checkoutBillingTerm.test.js`
Expected: `... passed, 0 failed`

- [ ] **Step 5: Remove `accountBillingTerm` from `billingTerm.js`**

In `backend/services/billingTerm.js`, delete the `accountBillingTerm` function (the block starting `/**\n * The account's billing term...` through its closing `}`) and remove `accountBillingTerm` from the `module.exports` object. Also delete the two now-stale lines from the file's header docblock: `// Term lives on the Web Account (`billing_term`), NOT on catalog products.\n// That is deliberate: ...` — replace that paragraph with:

```js
// services/billingTerm.js
//
// All billing-term arithmetic, as pure functions with no Frappe or clock
// dependency so they can be tested exhaustively. The term itself is never
// stored here or on any Web Account field — see checkoutBillingTerm.js for
// how an account's current term is derived from its last paid Subscription
// invoice.

const ANNUAL_DISCOUNT_PCT = 20;
const ANNUAL_CYCLE_DAYS = 365;
```

Leave every other function in the file (`annualPrepayKes`, `cycleDaysForTerm`, `renewalAmountForTerm`, `proRatedAddonKes`, `daysRemainingInTerm`) and their exports unchanged — they are pure arithmetic, still fully valid.

- [ ] **Step 6: Update `billingTerm.test.js`**

In `backend/test/billingTerm.test.js`, remove `accountBillingTerm` from the `require` destructure, and delete the entire `section("accountBillingTerm — missing/unknown defaults to monthly")` block (the 7 `ok(accountBillingTerm(...))` lines immediately following it). Leave every other section unchanged.

- [ ] **Step 7: Run it to verify the removal is clean**

Run: `cd backend && node test/billingTerm.test.js`
Expected: `... passed, 0 failed` (same pass count minus the 7 removed assertions)

- [ ] **Step 8: Add the `Portal Invoice.billing_term` fixture**

In `backend/data/custom-fields-portal-invoice.json`, append a new entry to the array (after the existing 3):

```json
  {
    "doctype": "Custom Field",
    "dt": "Portal Invoice",
    "fieldname": "billing_term",
    "label": "Billing Term",
    "fieldtype": "Select",
    "options": "\nmonthly\nannual",
    "insert_after": "amount",
    "description": "Set once, at invoice creation, from the customer's confirmed checkout choice or the renewal sweep. Absent means monthly — every pre-existing invoice is safe by construction. This is the SOLE source of an account's billing term; see backend/services/checkoutBillingTerm.js."
  }
```

- [ ] **Step 9: Document the manual import step**

In `docs/provisioning-go-live.md`, find the section documenting the `terminal_access_approved_at`-style manual custom-field import (the "what still needs hands-on" section) and add one line following the same pattern:

```markdown
- **`Portal Invoice.billing_term`** — import `backend/data/custom-fields-portal-invoice.json` via Desk "Import Document" or `bench --site <site> import-doc backend/data/custom-fields-portal-invoice.json`. If skipped, every account is billed monthly (the field reads as absent, which is the documented safe default) — annual prepay simply won't be offered until it's imported. This does NOT risk the renewal sweep itself: the field is never read via a bulk list query (see checkoutBillingTerm.js), so an unimported field cannot fail renewal billing for other customers.
```

- [ ] **Step 10: Register the new test file**

In `backend/package.json`, add `&& node test/checkoutBillingTerm.test.js` to the `"test"` script, immediately after `node test/billingTerm.test.js`:

```json
    "test": "node test/provisioning.test.js && node test/billing.test.js && node test/routesContext.test.js && node test/renewal.test.js && node test/terminal.test.js && node test/terminalRetention.test.js && node test/terminalSweep.test.js && node test/addonEligibility.test.js && node test/terminalAccessGates.test.js && node test/addonInvoiceService.test.js && node test/orderStore.test.js && node test/ordersRoutes.test.js && node test/catalogSnapshot.test.js && node test/billingTerm.test.js && node test/checkoutBillingTerm.test.js",
```

- [ ] **Step 11: Run the full suite**

Run: `cd backend && npm test`
Expected: every suite prints `ALL GREEN` or `... passed, 0 failed`; overall exit code 0.

- [ ] **Step 12: Commit**

```bash
git add backend/services/checkoutBillingTerm.js backend/test/checkoutBillingTerm.test.js backend/services/billingTerm.js backend/test/billingTerm.test.js backend/data/custom-fields-portal-invoice.json docs/provisioning-go-live.md backend/package.json
git commit -m "feat: derive billing term from the last paid invoice, not a Web Account field"
```

---

### Task 2: Renewal sweep — single-term due-check and amount (fixes C2)

**Files:**
- Modify: `backend/services/renewalService.js`
- Modify: `backend/test/renewal.test.js`

**Interfaces:**
- Consumes: `readInvoiceBillingTerm(client, invoiceName)` from Task 1.
- Produces: no change to `sweepRenewals`'s external contract (same `deps` shape, same return `{ok, created, suspended, errors}`).

- [ ] **Step 1: Update the test fixture and delete the now-impossible scenario**

In `backend/test/renewal.test.js`:

1. Delete the entire `console.log("# billing term — sweep cycle and amount")` block (the pure `accountBillingTerm`-based section, roughly 35 lines starting at the inline `require("../services/billingTerm")` for `accountBillingTerm`/`cycleDaysForTerm`/`renewalAmountForTerm` down through its closing `}`). `cycleDaysForTerm`/`renewalAmountForTerm` remain covered by `billingTerm.test.js`; `accountBillingTerm` no longer exists.

2. Replace `accountDoc(term)` with a version that takes no term (the account itself never carries a term now):

```js
function accountDoc() {
  return {
    account_holder_name: "Test Co",
    plan: "Standard",
    account_status: "Active",
    selected_services: SWEEP_SERVICE_ROWS,
    // no work_email -> sendRenewalEmail is skipped entirely
  };
}
```

3. Replace `makeSweepFrappe` with a version that serves the term via a single-document GET on the last-paid invoice, not a field on the bulk-query row or the account:

```js
function makeSweepFrappe({ account, lastPaidInvoiceDate, lastPaidBillingTerm }) {
  const posts = [];
  let webAccountGets = 0;
  let invoiceGets = 0;
  const client = {
    get: async (url, opts) => {
      const params = opts?.params || {};
      if (url === "/api/resource/Portal Invoice") {
        const filters = JSON.parse(params.filters || "[]");
        const isPaidScan = filters.some((f) => f[0] === "status" && f[2] === "Paid");
        if (isPaidScan) {
          // Deliberately NO billing_term on this bulk-query row — the real
          // query's `fields` never include it (see C4). The sweep must read
          // the term via the single-document GET below instead.
          return {
            data: {
              data: [
                { name: "OLD-INV", web_account: "acct-1", plan: "Standard", amount: 1, invoice_date: lastPaidInvoiceDate },
              ],
            },
          };
        }
        // Open-invoice idempotency check -> nothing open.
        return { data: { data: [] } };
      }
      if (url === "/api/resource/Portal Invoice/OLD-INV") {
        invoiceGets++;
        return {
          data: {
            data: {
              name: "OLD-INV",
              invoice_date: lastPaidInvoiceDate,
              ...(lastPaidBillingTerm ? { billing_term: lastPaidBillingTerm } : {}),
            },
          },
        };
      }
      if (url === "/api/resource/Web Account/acct-1") {
        webAccountGets++;
        return { data: { data: account } };
      }
      return { data: { data: {} } };
    },
    post: async (url, body) => {
      posts.push({ url, body });
      return { data: { data: { name: body.invoice_no } } };
    },
  };
  const deps = {
    frappeClient: () => client,
    PORTAL_INVOICE_SERVICES_FIELD: "selected_services",
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    CHILD_SERVICE_ID_FIELD: "service_id",
    CHILD_SERVICE_NAME_FIELD: "service_name",
    CHILD_TIER_FIELD: "tier",
    CHILD_DOMAIN_CHOICE_FIELD: "domain_choice",
    CHILD_STATUS_FIELD: "status",
    buildInvoiceServiceRows: (rows) => rows,
    logPortalUpdate: async () => {},
  };
  return { deps, posts, webAccountGetCount: () => webAccountGets, invoiceGetCount: () => invoiceGets };
}
```

4. Replace the five `sweepRenewals` test cases (Rows 1–4 plus "Finding 2" plus "Finding 3") with:

```js
(async () => {
  console.log("# sweepRenewals — wired end to end (mocked Frappe)");

  {
    // Row 1: last paid invoice recorded annual, 30 days old -> NOT due.
    // Regresses if the cycle reverts to the flat cfg.cycleDays (30d).
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: "annual",
    });
    const res = await sweepRenewals(deps);
    ok(res.ok === true, "sweep returns ok");
    ok(posts.length === 0, "annual invoice at 30 days -> zero invoices created (double-charge guard)");
  }

  {
    // Row 2: same annual term, 366 days old -> due, at the discounted amount.
    // Regresses if `amount` is set to monthlySum unconditionally.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(366),
      lastPaidBillingTerm: "annual",
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "annual invoice at 366 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_ANNUAL_AMOUNT, `annual invoice billed the discounted amount (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "annual", "created invoice persists billing_term=annual (becomes next year's anchor)");
  }

  {
    // Row 3: last paid invoice recorded monthly, 30 days old -> due, at the
    // undiscounted sum.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: "monthly",
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "monthly invoice at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `monthly invoice billed the undiscounted sum (got ${posts[0]?.body?.amount})`);
    ok(posts[0]?.body?.billing_term === "monthly", "created invoice persists billing_term=monthly");
  }

  {
    // Row 4: last paid invoice has NO billing_term field at all (a
    // pre-existing, never-migrated invoice) -> treated as monthly. This is
    // the safety-by-construction case every invoice created before this
    // feature falls into.
    const { deps, posts } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(30),
      lastPaidBillingTerm: null,
    });
    await sweepRenewals(deps);
    ok(posts.length === 1, "invoice with no billing_term at 30 days -> exactly one invoice created");
    ok(posts[0]?.body?.amount === SWEEP_MONTHLY_SUM, `pre-existing invoice billed the undiscounted monthly sum (got ${posts[0]?.body?.amount})`);
  }

  {
    // Finding 3: an account nowhere near due under ANY term must not even
    // trigger a Web Account fetch or an invoice-term GET. Regresses if the
    // pre-filter is removed and every candidate account is fetched
    // unconditionally.
    const { deps, posts, webAccountGetCount, invoiceGetCount } = makeSweepFrappe({
      account: accountDoc(),
      lastPaidInvoiceDate: daysAgoStr(5),
      lastPaidBillingTerm: "monthly",
    });
    await sweepRenewals(deps);
    ok(posts.length === 0, "account far from due -> zero invoices created");
    ok(webAccountGetCount() === 0, "account far from due under the shortest cycle -> zero Web Account fetches (fetch-amplification guard)");
    ok(invoiceGetCount() === 0, "account far from due under the shortest cycle -> zero invoice-term fetches");
  }

  console.log("================================================");
  console.log(`RENEWAL TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
```

Note: the prior "Finding 2" test (an account's term "flipped" after invoicing, invoice-recorded term overriding it) is deleted, not rewritten — there is no longer an account-level term field to flip, so that exact divergence is now structurally impossible, matching the design doc's claim that C2 "cannot recur because there is only one variable."

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/renewal.test.js`
Expected: FAIL — `posts.length === 0` assertions fail because the current implementation still reads `lastPaid.billing_term` off the bulk row (which this new mock no longer provides) and `accountBillingTerm(account)` off the account (which no longer carries a term), so every row falls through to the monthly default incorrectly for the annual cases, or the `require("../services/billingTerm").accountBillingTerm` call still exists but is being deleted in the same task — confirm the exact failure by running it before Step 3's implementation edit.

- [ ] **Step 3: Update the imports**

In `backend/services/renewalService.js`, replace:

```js
const {
  accountBillingTerm,
  cycleDaysForTerm,
  renewalAmountForTerm,
  ANNUAL_CYCLE_DAYS,
} = require("./billingTerm");
```

with:

```js
const {
  cycleDaysForTerm,
  renewalAmountForTerm,
  ANNUAL_CYCLE_DAYS,
} = require("./billingTerm");
const { readInvoiceBillingTerm } = require("./checkoutBillingTerm");
```

- [ ] **Step 4: Revert the bulk query's `fields` (undo C4's dangerous addition)**

In the same file, change:

```js
        fields: JSON.stringify(["name", "web_account", "plan", "amount", "invoice_date", "billing_term"]),
```

to:

```js
        fields: JSON.stringify(["name", "web_account", "plan", "amount", "invoice_date"]),
```

- [ ] **Step 5: Replace the two-variable term derivation with one**

Replace:

```js
        const term = accountBillingTerm(account);
        // Prefer the term the invoice was actually BILLED under (not the
        // account's current term): if an account's billing_term is ever
        // edited after invoicing (e.g. an admin flips annual -> monthly in
        // the Frappe desk UI — no code path does this today), the due-check
        // must still honor the term the customer prepaid at, or a
        // prepaid-annual customer becomes due at 30 days and gets suspended
        // for not paying an invoice it never should have received. Every
        // invoice that predates this fix has no billing_term recorded at
        // all, so this falls back to the account's current term for every
        // one of them — unchanged behavior for every existing invoice.
        const invoiceTerm =
          lastPaid.billing_term === "annual" || lastPaid.billing_term === "monthly"
            ? lastPaid.billing_term
            : null;
        const cycleTerm = invoiceTerm || term;
        if (!isDueForRenewal(lastPaid.invoice_date, cycleDaysForTerm(cycleTerm, cfg.cycleDays))) continue;
```

with:

```js
        // The ONE safe read of this account's billing term: a
        // single-document GET on the last paid Subscription invoice itself,
        // never the bulk list query above (an unrecognized `billing_term`
        // column there would fail the query for every account in the sweep
        // — see C4). Used for BOTH the due-check cycle and the billed
        // amount below — there is no second, independently-read term to
        // disagree with it, which is what makes C2 structurally impossible
        // here now.
        const term = await readInvoiceBillingTerm(client, lastPaid.name);
        if (!isDueForRenewal(lastPaid.invoice_date, cycleDaysForTerm(term, cfg.cycleDays))) continue;
```

The `const amount = renewalAmountForTerm(term, monthlySum);` line further down is unchanged — it already refers to `term`, which now is the single, correctly-derived value.

- [ ] **Step 6: Run it to verify it passes**

Run: `cd backend && node test/renewal.test.js`
Expected: `RENEWAL TESTS: ... passed, 0 failed` / `ALL GREEN`

- [ ] **Step 7: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/services/renewalService.js backend/test/renewal.test.js
git commit -m "fix: renewal sweep derives billing term from the invoice, not the account (fixes C2)"
```

---

### Task 3: Add-on pro-rata — derive from the invoice anchor (fixes C3's consumer side)

**Files:**
- Modify: `backend/services/addonInvoiceService.js`
- Modify: `backend/test/addonInvoiceService.test.js`

**Interfaces:**
- Consumes: `getCurrentBillingTerm(client, webAccountName)` from Task 1.
- Produces: no change to `createAddonInvoice`'s external contract (same params, same `{invoiceDocName, amountKes}` return).

- [ ] **Step 1: Update the test fixtures**

In `backend/test/addonInvoiceService.test.js`:

1. Extend `makeClient` to serve a distinct "last paid Subscription invoice" fixture, separate from the open add-on invoice (both currently collide on the same generic `"/api/resource/Portal Invoice"` list branch):

```js
function makeClient({ account, openInvoice = null, lastPaidInvoice = null }) {
  const posts = [];
  const puts = [];
  return {
    posts, puts,
    get: async (url, opts) => {
      if (url.includes("/Web Account/") || url.includes("/Web%20Account/"))
        return { data: { data: account } };
      if (url === "/api/resource/Portal Invoice" && opts?.params) {
        const filters = JSON.parse(opts.params.filters || "[]");
        const isPaidScan = filters.some((f) => f[0] === "status" && f[2] === "Paid");
        if (isPaidScan) return { data: { data: lastPaidInvoice ? [lastPaidInvoice] : [] } };
        return { data: { data: openInvoice ? [openInvoice] : [] } };
      }
      if (lastPaidInvoice && url.includes(`/api/resource/Portal Invoice/${lastPaidInvoice.name}`))
        return { data: { data: lastPaidInvoice } };
      if (openInvoice && url.includes(openInvoice.name))
        return { data: { data: openInvoice } };
      return { data: { data: {} } };
    },
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: { name: "PINV-NEW-1" } } }; },
    put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
  };
}
```

2. In `section("annual-term accounts get mid-term add-ons pro-rated")`, replace the account fixture (which currently seeds `billing_term`/`term_started_on` on the account doc) with a `lastPaidInvoice` fixture instead:

```js
  section("annual-term accounts get mid-term add-ons pro-rated");
  {
    const { annualPrepayKes } = require("../services/billingTerm");
    // Last paid Subscription invoice dated 182 days ago -> ~half the year left.
    const started = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: {
        plan: "Starter",
        // Non-empty, non-domain paid history so the add-on eligibility gate
        // (addonEligibility.js's hasNonDomainPaidHistory check) doesn't
        // reject this purchase before pricing is ever computed.
        selected_services: [{ service_id: "starter-app-hosting", status: "Active" }],
      },
      lastPaidInvoice: { name: "PINV-PAID-1", invoice_date: started, billing_term: "annual" },
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    const fullAnnual = annualPrepayKes(1200); // starter-web-hosting is 1200/mo
    ok(res.amountKes < fullAnnual, "mid-term add-on costs less than a full annual term");
    ok(res.amountKes > 1200, "but more than a single month");
    ok(
      Math.abs(res.amountKes - Math.round(fullAnnual * (183 / 365))) <= 100,
      "roughly half the annual price with ~half the term left"
    );
  }
```

3. Replace `section("annual-term accounts: merged open invoice is pro-rated too, not flat monthly")` in full:

```js
  section("annual-term accounts: merged open invoice is pro-rated too, not flat monthly");
  {
    const { proRatedAddonKes, daysRemainingInTerm } = require("../services/billingTerm");
    // Last paid Subscription invoice dated 181 days ago -> 184 days
    // remaining. The two merged services here are priced DIFFERENTLY
    // (starter-storage 1200, starter-email 1500) and 184 is a day count at
    // which proRatedAddonKes(1200,184) + proRatedAddonKes(1500,184)
    // provably differs (by rounding) from the naive
    // proRatedAddonKes(1200+1500,184) — i.e. "sum the monthly prices first,
    // pro-rate once" gives a DIFFERENT number than "pro-rate each service's
    // price, then sum".
    const started = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // An existing OPEN unpaid add-on invoice already carries one service
    // (storage). The new purchase (email) must merge into it — and the
    // MERGED total must be pro-rated per-service, not the flat monthly sum
    // of both rows, and not a single pro-ration of the summed monthly price.
    const openInvoice = {
      name: "PINV-OPEN-1",
      status: "Unpaid",
      services: [
        { serviceId: "starter-storage", serviceName: "File Storage (25GB)", tier: "Light", domainChoice: "", status: "Awaiting Payment" },
      ],
    };
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-PAID-2", invoice_date: started, billing_term: "annual" },
      openInvoice,
    });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps: { ...deps, findOpenInvoice: async () => openInvoice },
      services: [{ serviceId: "starter-email", serviceName: "Business Email", tier: "Light", domainChoice: "" }],
    });
    ok(res.invoiceDocName === "PINV-OPEN-1", "merges into the existing open invoice, not a new one");
    ok(res.amountKes !== 1200 + 1500, "merged amount is NOT the flat monthly sum of both add-ons (2700)");
    const days = daysRemainingInTerm(started);
    const perServiceExpected = proRatedAddonKes(1200, days) + proRatedAddonKes(1500, days);
    const naiveSumThenProRateExpected = proRatedAddonKes(1200 + 1500, days);
    ok(
      perServiceExpected !== naiveSumThenProRateExpected,
      "sanity check on fixture: per-service pro-ration and sum-then-pro-rate-once actually diverge at this day count"
    );
    ok(res.amountKes === perServiceExpected, "merged amount equals the sum of each service's pro-rated annual price");
    ok(res.amountKes !== naiveSumThenProRateExpected, "merged amount is NOT the naive sum-then-pro-rate-once amount");
    ok(client.puts.length === 1, "existing open invoice was updated via PUT, not re-created via POST");
    ok(client.puts[0].body.amount === perServiceExpected, "the PUT body's amount field is also pro-rated per-service");
  }
```

4. In the three `section("guard: corrupted annual account cannot get a free (KES 0) add-on invoice")` blocks, replace the account-level corruption (`billing_term: "annual"` with `term_started_on` omitted/garbage) with an invoice-level one — the `lastPaidInvoice`'s own `invoice_date` is now what can be missing/garbage:

```js
  section("guard: corrupted annual account cannot get a free (KES 0) add-on invoice");
  {
    // Fresh-invoice branch — the last paid invoice is missing invoice_date entirely.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-1", billing_term: "annual" }, // invoice_date omitted
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
      }),
      422, "missing invoice_date on the last paid annual invoice is refused, not billed free (fresh path)"
    );
    ok(client.posts.length === 0, "no invoice was created for the rejected purchase");
  }
  {
    // Fresh-invoice branch — garbage/unparseable invoice_date.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-2", billing_term: "annual", invoice_date: "not-a-real-date" },
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1", deps,
        services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
      }),
      422, "unparseable invoice_date on the last paid annual invoice is refused, not billed free (fresh path)"
    );
  }
  {
    // Merged-invoice branch — same corruption, but this time there's
    // already an open unpaid add-on invoice, so the merged branch (not the
    // fresh branch) is what would otherwise compute a free amount.
    const openInvoice = {
      name: "PINV-OPEN-CORRUPT",
      status: "Unpaid",
      services: [
        { serviceId: "starter-storage", serviceName: "File Storage (25GB)", tier: "Light", domainChoice: "", status: "Awaiting Payment" },
      ],
    };
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-CORRUPT-3", billing_term: "annual" }, // invoice_date omitted
      openInvoice,
    });
    await throws(
      () => createAddonInvoice({
        client, webAccountName: "acct-1",
        deps: { ...deps, findOpenInvoice: async () => openInvoice },
        services: [{ serviceId: "starter-email", serviceName: "Business Email", tier: "Light", domainChoice: "" }],
      }),
      422, "missing invoice_date on the last paid annual invoice is refused, not billed free (merged path)"
    );
    ok(client.puts.length === 0, "no invoice was updated for the rejected merge");
  }
```

5. In `section("guard does not fire on legitimate (non-corrupted) zero/near-zero amounts")`, replace the account-level `term_started_on` with a `lastPaidInvoice.invoice_date`:

```js
  section("guard does not fire on legitimate (non-corrupted) zero/near-zero amounts");
  {
    const startedExactlyAYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-EXACT-1", billing_term: "annual", invoice_date: startedExactlyAYearAgo },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 0, "term's last day legitimately produces a KES 0 pro-rated amount");
    ok(!!res.invoiceDocName, "the guard does not block a legitimate zero — invoice is still created");
  }
  {
    const startedLateInTerm = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-LATE-1", billing_term: "annual", invoice_date: startedLateInTerm },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes > 0, "small-but-nonzero days-remaining still bills a small nonzero amount, not blocked");
  }
  {
    // A monthly-term account never touches the guard at all.
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      lastPaidInvoice: { name: "PINV-MONTHLY-1", billing_term: "monthly", invoice_date: "2026-01-01" },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1200, "monthly account is unaffected by the annual-only guard");
  }
```

6. In `section("monthly-term and legacy accounts are billed exactly as before")`, replace the account fixture with one whose `lastPaidInvoice` has no `billing_term` field at all (the pre-existing-invoice safety case):

```js
  section("monthly-term and legacy accounts are billed exactly as before");
  {
    const client = makeClient({
      account: { plan: "Starter", selected_services: [{ service_id: "starter-app-hosting", status: "Active" }] },
      // Pre-existing invoice, no billing_term field at all -> monthly fail-safe.
      lastPaidInvoice: { name: "PINV-LEGACY-1", invoice_date: "2026-01-01" },
    });
    const res = await createAddonInvoice({
      client, webAccountName: "acct-1", deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1200, "legacy account (no billing_term on its last paid invoice) still bills the monthly price");
  }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node test/addonInvoiceService.test.js`
Expected: FAIL — the annual pro-rata assertions fail because `accountBillingTerm(record)` still reads the (now term-less) account fixture and defaults to `"monthly"`, so `res.amountKes` comes back as the flat `1200` instead of a pro-rated annual amount.

- [ ] **Step 3: Update the imports**

In `backend/services/addonInvoiceService.js`, replace:

```js
const {
  accountBillingTerm,
  daysRemainingInTerm,
  proRatedAddonKes,
} = require("./billingTerm");
```

with:

```js
const { daysRemainingInTerm, proRatedAddonKes } = require("./billingTerm");
const { getCurrentBillingTerm } = require("./checkoutBillingTerm");
```

- [ ] **Step 4: Derive term and anchor from the invoice, not the account**

Replace:

```js
  const monthlySum = sumSelectedServicesMonthlyKes(norm);
  const term = accountBillingTerm(record);
  const amount =
    term === "annual"
      ? norm.reduce((total, s) => {
          const meta = getServiceMeta(s.serviceId);
          return (
            total +
            proRatedAddonKes(
              Number(meta?.monthlyKes) || 0,
              daysRemainingInTerm(record?.term_started_on)
            )
          );
        }, 0)
      : monthlySum;
```

with:

```js
  const monthlySum = sumSelectedServicesMonthlyKes(norm);
  const { term, anchorDate } = await getCurrentBillingTerm(client, webAccountName);
  const amount =
    term === "annual"
      ? norm.reduce((total, s) => {
          const meta = getServiceMeta(s.serviceId);
          return (
            total +
            proRatedAddonKes(Number(meta?.monthlyKes) || 0, daysRemainingInTerm(anchorDate))
          );
        }, 0)
      : monthlySum;
```

- [ ] **Step 5: Update the merged-invoice branch's pro-ration**

Replace:

```js
    const mergedAmount =
      term === "annual"
        ? mergedServices.reduce((total, s) => {
            const meta = getServiceMeta(s.serviceId);
            return (
              total +
              proRatedAddonKes(
                Number(meta?.monthlyKes) || 0,
                daysRemainingInTerm(record?.term_started_on)
              )
            );
          }, 0)
        : sumSelectedServicesMonthlyKes(mergedServices);

    assertNotFreeAnnualAddonInvoice({ term, amount: mergedAmount, record, serviceRows: mergedServices });
```

with:

```js
    const mergedAmount =
      term === "annual"
        ? mergedServices.reduce((total, s) => {
            const meta = getServiceMeta(s.serviceId);
            return (
              total +
              proRatedAddonKes(Number(meta?.monthlyKes) || 0, daysRemainingInTerm(anchorDate))
            );
          }, 0)
        : sumSelectedServicesMonthlyKes(mergedServices);

    assertNotFreeAnnualAddonInvoice({ term, amount: mergedAmount, anchorDate, serviceRows: mergedServices });
```

- [ ] **Step 6: Update the fresh-invoice branch's guard call**

Replace:

```js
    assertNotFreeAnnualAddonInvoice({ term, amount, record, serviceRows: norm });
```

with:

```js
    assertNotFreeAnnualAddonInvoice({ term, amount, anchorDate, serviceRows: norm });
```

- [ ] **Step 7: Update the guard function's signature**

Replace:

```js
function assertNotFreeAnnualAddonInvoice({ term, amount, record, serviceRows }) {
  if (term !== "annual" || amount !== 0) return;
  if (hasParsableTermStart(record?.term_started_on)) return;
```

with:

```js
function assertNotFreeAnnualAddonInvoice({ term, amount, anchorDate, serviceRows }) {
  if (term !== "annual" || amount !== 0) return;
  if (hasParsableTermStart(anchorDate)) return;
```

Leave `hasParsableTermStart` itself, and the rest of the guard's body (the `allRowsArePriced` check and the thrown `422 CORRUPTED_ANNUAL_TERM` error), unchanged — it still takes a date-string-shaped value, just sourced from the invoice's own `invoice_date` now instead of a separately-maintained account field. Also update the function's docblock comment two paragraphs above it: replace every mention of "term_started_on" with "the last paid invoice's invoice_date (anchorDate)" and "a routine write-ordering gap" with "genuinely anomalous invoice data" (the anchor can no longer go stale from a missed write, since it's read fresh from Frappe on every call).

- [ ] **Step 8: Run it to verify it passes**

Run: `cd backend && node test/addonInvoiceService.test.js`
Expected: `... passed, 0 failed`

- [ ] **Step 9: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add backend/services/addonInvoiceService.js backend/test/addonInvoiceService.test.js
git commit -m "fix: add-on pro-rata derives its anchor from the last paid invoice (fixes C3)"
```

---

### Task 4: Checkout routes — resolve-before-create, eligibility gate (fixes C1 and C5)

**Files:**
- Modify: `backend/routes/ordersRoutes.js`
- Modify: `backend/test/ordersRoutes.test.js`

**Interfaces:**
- Consumes: `isEligibleForTermChoice(client, webAccountName, category)` from Task 1.
- Produces: `GET /api/orders/:id` response gains `order.eligibleForTermChoice: boolean`. `POST /api/orders/:id/prepare-payment` no longer accepts a term change after the invoice exists (idempotent short-circuit no longer writes anything) and no longer writes any Web Account field.

- [ ] **Step 1: Delete the obsolete "billing_term / term_started_on account writes" test section**

In `backend/test/ordersRoutes.test.js`, delete the entire block from `// ---- prepare-payment — billing_term / term_started_on account writes ----` through the end of `section("prepare-payment — already-annual account: body 'annual' never rewrites term_started_on")` (roughly lines 528–865 on the `worktree-billing-term` branch — everything that asserts on `acct.billing_term` / `acct.term_started_on`). These fields no longer exist anywhere in this design; the scenarios they tested (Web Account term writes, no-reset-on-repeat-annual, body-override-of-stored-config) are either now meaningless (no field to write) or superseded by the new eligibility-gated, single-call flow covered by the new tests in Step 4 below.

- [ ] **Step 2: Rewrite the two annual-amount-correction tests to use the confirm-before-create call shape**

The prior tests sent `billingTerm` at *order creation* and relied on `prepare-payment`'s now-removed "fall back to `order.config?.billingTerm`" behavior. Under this redesign, `prepare-payment` only ever trusts its own request body. Replace:

```js
  section("prepare-payment — first purchase + annual term bills the annual-prepay amount, not monthly");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-ann-amt": { name: "acct-ann-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      {
        session: { webAccount: "acct-ann-amt" },
        body: { serviceId: "starter-web-hosting", planKey: "Starter", billingTerm: "annual" },
      },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-ann-amt" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const expectedAnnual = annualPrepayKes(monthlySum);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === expectedAnnual,
      `invoice amount === annualPrepayKes(monthly) (${expectedAnnual}), got ${invoice.amount}`
    );
    ok(invoice.amount !== monthlySum, "invoice amount is NOT the plain monthly sum (the confirmed bug)");
  }
```

with:

```js
  section("prepare-payment — first purchase, eligible, confirmed annual: bills the annual-prepay amount");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-ann-amt": { name: "acct-ann-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-ann-amt" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    // The confirmed term is carried on THIS call — the checkout page defers
    // prepare-payment until the customer has picked a term, so there is no
    // separate "at order creation" term to fall back to anymore.
    const res = makeRes();
    await prep({ session: { webAccount: "acct-ann-amt" }, params: { id: orderId }, body: { billingTerm: "annual" } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const expectedAnnual = annualPrepayKes(monthlySum);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === expectedAnnual,
      `invoice amount === annualPrepayKes(monthly) (${expectedAnnual}), got ${invoice.amount}`
    );
    ok(invoice.amount !== monthlySum, "invoice amount is NOT the plain monthly sum (the confirmed bug)");
    ok(invoice.billing_term === "annual", "the created invoice itself carries billing_term=annual");
  }
```

And replace:

```js
  section("prepare-payment — first purchase + monthly/omitted term bills the plain monthly sum, unchanged");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-mo-amt": { name: "acct-mo-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-mo-amt" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-mo-amt" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === monthlySum,
      `invoice amount === plain monthly sum (${monthlySum}), untouched by the annual correction`
    );
  }
```

with:

```js
  section("prepare-payment — first purchase, eligible, omitted term bills the plain monthly sum");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-mo-amt": { name: "acct-mo-amt", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-mo-amt" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-mo-amt" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");

    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(
      invoice.amount === monthlySum,
      `invoice amount === plain monthly sum (${monthlySum}), untouched by the annual correction`
    );
    ok(!("billing_term" in invoice), "no billing_term written on a monthly invoice");
  }
```

- [ ] **Step 3: Rewrite the add-on/annual-account test to send the term on prepare-payment, and add a server-side-trust test**

Replace:

```js
  section("prepare-payment — add-on branch on an annual account is NOT double-converted");
  {
    const client = makeMockFrappe({
      "Web Account": {
        "acct-addon-ann": {
          name: "acct-addon-ann",
          plan: "Starter",
          selected_services: [],
          billing_term: "annual",
          term_started_on: new Date().toISOString().slice(0, 10),
        },
      },
    });
```

with:

```js
  section("prepare-payment — add-on branch is NOT double-converted, even if a term is sent");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-addon-ann": { name: "acct-addon-ann", plan: "Starter", selected_services: [] } },
    });
```

The rest of that test block, unchanged, still follows immediately after (only the account fixture above changed):

```js
    // createAddonInvoice already produces the correct pro-rated annual amount
    // internally (this task deliberately leaves that path untouched) —
    // simulate that by seeding a Portal Invoice with a known "already
    // correct" amount, and prove the first-purchase-only annual correction
    // in ordersRoutes.js never re-applies annualPrepayKes to it (which
    // would 12x-overcharge a real add-on).
    client.store["Portal Invoice"] = client.store["Portal Invoice"] || {};
    client.store["Portal Invoice"]["PINV-ADDON-1"] = { name: "PINV-ADDON-1", amount: 5000, status: "Unpaid" };
    const ctx = baseCtx(client, {
      hasPaidSubscriptionForPlan: async () => true,
      createAddonInvoice: async () => ({ invoiceDocName: "PINV-ADDON-1" }),
    });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-addon-ann" }, body: { serviceId: "starter-web-hosting", billingTerm: "annual" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep({ session: { webAccount: "acct-addon-ann" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.invoiceDocName === "PINV-ADDON-1", "invoiceDocName from createAddonInvoice");

    const invoice = client.store["Portal Invoice"]["PINV-ADDON-1"];
    ok(
      invoice.amount === 5000,
      "add-on invoice amount unchanged by the first-purchase-only annual correction (not 12x'd)"
    );
  }
```

Then add a new test immediately after it, proving the server never trusts an ineligible client's term claim:

```js
  section("prepare-payment — an ineligible order's client-sent 'annual' is silently ignored");
  {
    // acct-not-eligible already has a paid Subscription invoice on file
    // (seeded directly, simulating a returning customer), so this account
    // is NOT eligible for a term choice on a new purchase — the server must
    // re-verify this itself and never trust the client's billingTerm.
    const client = makeMockFrappe({
      "Web Account": { "acct-not-eligible": { name: "acct-not-eligible", plan: "None", selected_services: [] } },
      "Portal Invoice": {
        "PINV-OLD-PAID": {
          name: "PINV-OLD-PAID",
          web_account: "acct-not-eligible",
          type: "Subscription",
          status: "Paid",
          invoice_date: "2026-01-01",
        },
      },
    });
    const ctx = baseCtx(client, { hasPaidSubscriptionForPlan: async () => false });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const prep = findHandler(router, "post", "/api/orders/:id/prepare-payment");

    const createRes = makeRes();
    await create(
      { session: { webAccount: "acct-not-eligible" }, body: { serviceId: "starter-web-hosting", planKey: "Starter" } },
      createRes
    );
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await prep(
      { session: { webAccount: "acct-not-eligible" }, params: { id: orderId }, body: { billingTerm: "annual" } },
      res
    );
    ok(res.statusCode === 200, "status 200");
    const monthlySum = sumSelectedServicesMonthlyKes([{ serviceId: "starter-web-hosting" }]);
    const invoice = client.store["Portal Invoice"]?.[res.body.invoiceDocName];
    ok(!!invoice, "invoice created");
    ok(invoice.amount === monthlySum, "billed the plain monthly sum, NOT annualPrepayKes, despite the client's annual request");
    ok(!("billing_term" in invoice) || invoice.billing_term !== "annual", "invoice is not stamped annual for an ineligible purchase");
  }
```

- [ ] **Step 4: Add GET /api/orders/:id eligibility tests**

Add a new section, after the existing `section("GET /api/orders/:id — another account is 403")` block:

```js
  section("GET /api/orders/:id — eligibleForTermChoice");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-elig": { name: "acct-elig", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, {
      isEligibleForTermChoice: async () => true,
    });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const get = findHandler(router, "get", "/api/orders/:id");

    const createRes = makeRes();
    await create({ session: { webAccount: "acct-elig" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await get({ session: { webAccount: "acct-elig" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200");
    ok(res.body?.order?.eligibleForTermChoice === true, "eligibleForTermChoice reflects the eligibility check");
  }
  {
    // Fail-safe direction: an eligibility-check error must resolve to
    // false, never true — showing an inappropriate term choice to an
    // existing customer (C5) is the risk here, the opposite direction from
    // the renewal sweep's fail-safe-to-monthly.
    const client = makeMockFrappe({
      "Web Account": { "acct-elig-err": { name: "acct-elig-err", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client, {
      isEligibleForTermChoice: async () => { throw new Error("boom"); },
    });
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");
    const get = findHandler(router, "get", "/api/orders/:id");

    const createRes = makeRes();
    await create({ session: { webAccount: "acct-elig-err" }, body: { serviceId: "starter-web-hosting" } }, createRes);
    const orderId = createRes.body.order.id;

    const res = makeRes();
    await get({ session: { webAccount: "acct-elig-err" }, params: { id: orderId } }, res);
    ok(res.statusCode === 200, "status 200 (GET order itself still succeeds)");
    ok(res.body?.order?.eligibleForTermChoice === false, "eligibility check failure fails safe to false");
  }
```

Also add `isEligibleForTermChoice: async () => false,` to `baseCtx`'s default overrides object (so every pre-existing test that doesn't care about eligibility keeps working unchanged):

```js
    hasPaidSubscriptionForPlan: async () => false,
    isEligibleForTermChoice: async () => false,
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd backend && node test/ordersRoutes.test.js`
Expected: FAIL — `isEligibleForTermChoice` is not destructured/used yet, `eligibleForTermChoice` is `undefined` on the GET response, and the annual-amount tests fail because `prepare-payment` still reads `order.config?.billingTerm` as a fallback instead of trusting only the request body.

- [ ] **Step 6: Update the imports**

In `backend/routes/ordersRoutes.js`, replace:

```js
const accountBillingTerm = require("../services/billingTerm").accountBillingTerm;
// Same plain-assignment rationale as accountBillingTerm above — kept as a
// second statement (not merged into one destructure) so the static wiring
// check's regex still finds its target unambiguously.
const annualPrepayKes = require("../services/billingTerm").annualPrepayKes;
```

with:

```js
const annualPrepayKes = require("../services/billingTerm").annualPrepayKes;
// Same plain-assignment rationale as annualPrepayKes above — kept as a
// second statement (not merged into one destructure) so the static wiring
// check's regex still finds its target unambiguously.
const isEligibleForTermChoice = require("../services/checkoutBillingTerm").isEligibleForTermChoice;
```

- [ ] **Step 7: Update the ctx destructure**

Replace the `module.exports = function (ctx) { const { ... } = ctx;` block's contents — remove `fetchInvoicesForUser` (no longer used anywhere in this file after Step 9 below) — new full destructure:

```js
  const {
    requireAuth,
    frappeClient,
    fetchWebAccount,
    applyPlanAndCreateInvoice,
    updateWebAccountServices,
    asArray,
    hasPaidSubscriptionForPlan,
    normalizeSelectedServices,
    findOpenInvoice,
    normalizeInvoiceServiceRow,
    buildInvoiceServiceRows,
    PORTAL_INVOICE_SERVICES_FIELD,
    WEB_ACCOUNT_SERVICES_FIELD,
    mergeServicesById,
    buildWebAccountServiceRows,
    assertOrderWithinCapacity,
    CAPACITY_REQUEST_DOCTYPE,
    createAddonInvoice,
    getReservedRamMb,
    createOrder,
    getOrder,
    cancelOrder,
    linkInvoice,
    sumSelectedServicesMonthlyKes,
  } = ctx;
```

Note: `ctx.isEligibleForTermChoice` is deliberately NOT read from `ctx` — it is imported directly as a plain module function (Step 6), the same way `annualPrepayKes` already is, since it has no dependency on anything else in `server.js`'s `routeContext`. (The test file's `baseCtx` in Step 4 above adds `isEligibleForTermChoice` to `ctx` purely so individual tests can override its behavior; the production route module calls the real one directly regardless of what's in `ctx`.)

- [ ] **Step 8: Update GET /api/orders/:id**

Replace:

```js
  router.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      // renew:true — this GET is the checkout page's heartbeat, keeping the
      // reservation alive while the buyer is present.
      const order = await getOrder({
        client,
        webAccountName,
        orderId: req.params.id,
        nowMs: Date.now(),
        renew: true,
      });
      return res.json({ ok: true, order });
    } catch (err) {
      return sendError(res, err, "Failed to fetch order.", "GET ORDER");
    }
  });
```

with:

```js
  router.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      // renew:true — this GET is the checkout page's heartbeat, keeping the
      // reservation alive while the buyer is present.
      const order = await getOrder({
        client,
        webAccountName,
        orderId: req.params.id,
        nowMs: Date.now(),
        renew: true,
      });

      // Fails safe to false (never true) on error — the risk direction here
      // is showing an inappropriate term choice to an existing customer
      // (C5), the opposite of the renewal sweep's fail-safe-to-monthly.
      let eligibleForTermChoice = false;
      try {
        eligibleForTermChoice = await isEligibleForTermChoice(client, webAccountName, order.category);
      } catch (e) {
        console.warn("GET ORDER eligibility check failed, defaulting to false:", e.response?.data || e.message);
      }

      return res.json({ ok: true, order: { ...order, eligibleForTermChoice } });
    } catch (err) {
      return sendError(res, err, "Failed to fetch order.", "GET ORDER");
    }
  });
```

- [ ] **Step 9: Rewrite POST /api/orders/:id/prepare-payment**

Replace the entire handler (from `router.post("/api/orders/:id/prepare-payment", requireAuth, async (req, res) => {` through its closing `});`) with:

```js
  router.post("/api/orders/:id/prepare-payment", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      const orderId = req.params.id;
      const nowMs = Date.now();

      const order = await getOrder({ client, webAccountName, orderId, nowMs, renew: false });

      // Idempotent: already prepared. There is exactly one prepare-payment
      // call per order under this design — the checkout page defers this
      // call until any term choice is confirmed (see Checkout.tsx) — so a
      // repeat call here only ever happens on a retry/refresh, never a term
      // change. There is nothing left to re-apply; just return the invoice.
      if (order.invoiceDocName) {
        return res.json({ ok: true, invoiceDocName: order.invoiceDocName });
      }

      if (order.status !== "Draft") {
        return res.status(409).json({ error: "This order can no longer be paid.", code: "ORDER_NOT_DRAFT" });
      }
      if (!(Date.parse(order.reservationExpiresAt) > nowMs)) {
        return res.status(409).json({
          error: "Your reservation has expired. Please refresh to reserve capacity again.",
          code: "RESERVATION_EXPIRED",
        });
      }

      const record = await fetchWebAccount(client, webAccountName);
      const planKey = record?.plan || "None";
      const hasPaidPlan = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);

      // Re-verify eligibility server-side — never trust the client for
      // whether annual is even on offer. A crafted request sending
      // billingTerm: "annual" for an ineligible order (an add-on, a domain,
      // a returning customer's purchase) is silently normalized back to
      // monthly. A customer with any paid plan already has a paid
      // Subscription invoice on file (some plan), so isEligibleForTermChoice
      // would also return false for them — skip the extra query in that
      // case rather than proving it twice.
      const eligible = hasPaidPlan
        ? false
        : await isEligibleForTermChoice(client, webAccountName, order.category);
      const bodyBillingTerm = (req.body || {}).billingTerm;
      const effectiveBillingTerm = eligible ? normalizeBillingTerm(bodyBillingTerm) : "monthly";

      // Domain-registration purchases carry the purchased domain string in
      // config.domain (see frontend Products.tsx's handleSelectDomain), NOT
      // config.domainChoice — that key is a different, pre-existing concept
      // reused by the hosting flow for "Bring My Domain" / "Use Murzak
      // Subdomain" / "Register New Domain". Route the right value into the
      // domainChoice field so it flows into the invoice + Web Account service
      // rows (buildInvoiceServiceRows / buildWebAccountServiceRows already
      // persist it) and from there into the staff provisioning notification.
      const isDomainProduct = order.category === "Domain Registration";
      const serviceRow = {
        serviceId: order.serviceId,
        serviceName: order.serviceName,
        tier: order.tier,
        domainChoice: isDomainProduct
          ? String(order.config?.domain || "").trim()
          : (order.config?.domainChoice || ""),
      };

      let invoiceDocName;
      if (hasPaidPlan) {
        // Never eligible for a term choice (eligible is false whenever
        // hasPaidPlan is true) — createAddonInvoice's own pro-rata (via
        // getCurrentBillingTerm) is the sole amount authority here,
        // unaffected by effectiveBillingTerm.
        const result = await createAddonInvoice({
          client,
          webAccountName,
          services: [serviceRow],
          deps: {
            fetchWebAccount,
            hasPaidSubscriptionForPlan,
            normalizeSelectedServices,
            findOpenInvoice,
            normalizeInvoiceServiceRow,
            buildInvoiceServiceRows,
            PORTAL_INVOICE_SERVICES_FIELD,
          },
        });
        invoiceDocName = result.invoiceDocName;
      } else {
        // First purchase: apply the order's plan and bill it, then attach
        // the order's service to the account.
        //
        // The 4th arg MUST be an array of selected services — passing an
        // opts object here makes applyPlanAndCreateInvoice default
        // selectedServices to [], bill KES 0, and skip invoice creation
        // entirely (server.js's zero_amount early-return).
        const result = await applyPlanAndCreateInvoice(client, webAccountName, order.planKey || "Starter", [serviceRow], {
          force: true,
          creditKes: 0,
        });
        if (!result?.invoice?.name) {
          const err = new Error("Failed to create an invoice for this order.");
          err.statusCode = 500;
          throw err;
        }
        invoiceDocName = result.invoice.name;

        const acct = await fetchWebAccount(client, webAccountName);
        const existingServices = normalizeSelectedServices(asArray(acct?.[WEB_ACCOUNT_SERVICES_FIELD]));
        const merged = mergeServicesById(existingServices, [serviceRow]);
        await updateWebAccountServices(client, webAccountName, buildWebAccountServiceRows(merged));

        // applyPlanAndCreateInvoice has no billing-term awareness — it
        // always bills the plain monthly sum. For a confirmed annual choice
        // on this first purchase, immediately correct the invoice it just
        // created to the annual-prepay amount and stamp its own
        // billing_term, within this same request — there is no later
        // correction step anywhere else in this design. Deliberately scoped
        // to ONLY this first-purchase branch: the hasPaidPlan branch above
        // already bills the correct annual amount via createAddonInvoice's
        // own pro-ration, and re-applying annualPrepayKes there would
        // 12x-overcharge an add-on.
        if (effectiveBillingTerm === "annual") {
          const monthlySumKes = sumSelectedServicesMonthlyKes([serviceRow]);
          const annualAmountKes = annualPrepayKes(monthlySumKes);
          await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
            amount: annualAmountKes,
            billing_term: "annual",
          });
        }
      }

      await linkInvoice({ client, orderId, invoiceDocName });
      return res.json({ ok: true, invoiceDocName });
    } catch (err) {
      return sendError(res, err, "Failed to prepare payment.", "PREPARE PAYMENT");
    }
  });
```

- [ ] **Step 10: Run it to verify it passes**

Run: `cd backend && node test/ordersRoutes.test.js`
Expected: `... passed, 0 failed`

- [ ] **Step 11: Run the full suite**

Run: `cd backend && npm test`
Expected: all green — this includes `test/routesContext.test.js`, which will confirm `ordersRoutes.js`'s remaining ctx destructure keys are still all wired in `server.js`'s `routeContext` (removing `fetchInvoicesForUser` from the destructure only shrinks the set it checks; `server.js` keeps the key for its own other call sites, so nothing there needs to change).

- [ ] **Step 12: Commit**

```bash
git add backend/routes/ordersRoutes.js backend/test/ordersRoutes.test.js
git commit -m "feat: resolve billing term before invoice creation, gated by first-purchase eligibility (fixes C1, C5)"
```

---

### Task 5: Checkout page — defer invoice creation until the term is confirmed

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx`

**Interfaces:**
- Consumes: `order.eligibleForTermChoice` from Task 4's `GET /api/orders/:id` response.
- Produces: no change to any other component's props; `Checkout` remains a route-level page with the same `CheckoutProps`.

- [ ] **Step 1: Add `eligibleForTermChoice` to the `OrderView` type**

In `frontend/src/pages/Checkout.tsx`, add the field to the interface:

```ts
interface OrderView {
  id: string;
  status: 'Draft' | 'Paid' | 'Cancelled';
  serviceId: string;
  serviceName: string;
  tier: string;
  category: string;
  monthlyKes: number;
  setupKes: number;
  totalDueKes: number;
  reservationExpiresAt: string;
  invoiceDocName: string | null;
  config: Record<string, any>;
  eligibleForTermChoice: boolean;
}
```

- [ ] **Step 2: Add a `preparingPayment` state and an unmount guard**

Immediately after the existing `const [billingTerm, setBillingTerm] = useState<'monthly' | 'annual'>('monthly');` line, add:

```ts
  const [preparingPayment, setPreparingPayment] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
```

- [ ] **Step 3: Extract the prepare-payment + invoice-pricing call into a reusable function**

Add this function inside the `Checkout` component, above the `/checkout/:orderId` load effect (it needs `orderId` from the component scope, which is already destructured via `useParams` above):

```ts
  const preparePaymentAndPrice = async (term?: 'monthly' | 'annual') => {
    if (!orderId) return;
    try {
      setPreparingPayment(true);
      const body: Record<string, any> = {};
      if (term) body.billingTerm = term;
      const prepRes = await fetch(`/api/orders/${encodeURIComponent(orderId)}/prepare-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok || !prepData?.invoiceDocName) {
        throw new Error(prepData?.error || 'Failed to prepare payment.');
      }

      const invRes = await fetch(`/api/billing/invoice/${encodeURIComponent(prepData.invoiceDocName)}`, {
        credentials: 'include',
      });
      const invData = await invRes.json().catch(() => ({}));
      if (!invRes.ok || !invData?.invoice) {
        throw new Error(invData?.error || 'Failed to load invoice.');
      }

      if (!mountedRef.current) return;
      setInvoice({
        docName: prepData.invoiceDocName,
        chargeKes: Number(invData.invoice.chargeKes ?? invData.invoice.amount ?? 0),
        paypalAmountUsd: Number(invData.invoice.paypalAmountUsd || 0),
      });
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message || 'Something went wrong preparing your payment.');
      }
    } finally {
      if (mountedRef.current) setPreparingPayment(false);
    }
  };
```

- [ ] **Step 4: Simplify the order-load effect — auto-prepare only when ineligible**

Replace the body of the `/checkout/:orderId` load effect's success path, from `// billingTerm here is whatever the term selector is set to...` through the invoice-fetch block ending just before `setLoading(false);` at the end of the `try`, with a single call to the new helper, gated on eligibility:

```ts
        if (ord.status === 'Cancelled') {
          setError('This order was cancelled.');
          setLoading(false);
          return;
        }

        setLoading(false);

        // Eligible orders (a genuine first monthly-billed purchase) wait for
        // the customer to confirm a term via the selector + "Continue to
        // payment" button below before prepare-payment is ever called.
        // Every other order (add-ons, domains, returning customers) is
        // unaffected — prepare-payment fires immediately, exactly as before
        // this feature existed.
        if (!ord.eligibleForTermChoice) {
          await preparePaymentAndPrice();
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Something went wrong loading your order.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, navigate]);
```

- [ ] **Step 5: Delete the "re-send on billingTerm change" effect entirely**

Delete the whole block, from its leading comment (`// ---- Re-send a billing-term change made AFTER the initial prepare-payment`) through the closing `}, [billingTerm]);`, including the `const isFirstRenderRef = useRef(true);` declaration immediately above it. There is exactly one `prepare-payment` call per order now, so there is nothing to re-send.

- [ ] **Step 6: Add a `handleConfirmTerm` handler**

Add this function near `handleResume` (same component, any point before the JSX `return`):

```ts
  const handleConfirmTerm = () => {
    preparePaymentAndPrice(billingTerm);
  };
```

- [ ] **Step 7: Gate the billing selector on eligibility, not on period, and add the confirm button**

Replace:

```tsx
      {period === "/mo" && (
        <div className="glass-card rounded-3xl p-6">
          <p className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-3">
            Billing
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBillingTerm('monthly')}
              className={`text-left rounded-2xl p-4 border transition-all ${
                billingTerm === 'monthly'
                  ? 'border-murzak-accent bg-murzak-accent/10'
                  : 'border-murzak-border hover:border-murzak-accent/40'
              }`}
            >
              <span className="block text-sm font-black text-murzak-ink dark:text-slate-100">
                {formatKes(order.monthlyKes)}/mo
              </span>
              <span className="block text-xs font-bold text-slate-600 dark:text-slate-400 mt-1">
                Billed monthly
              </span>
            </button>
            <button
              type="button"
              onClick={() => setBillingTerm('annual')}
              className={`text-left rounded-2xl p-4 border transition-all ${
                billingTerm === 'annual'
                  ? 'border-murzak-accent bg-murzak-accent/10'
                  : 'border-murzak-border hover:border-murzak-accent/40'
              }`}
            >
              <span className="block text-sm font-black text-murzak-ink dark:text-slate-100">
                {formatKes(annualPrepayKes(order.monthlyKes))}/yr
              </span>
              <span className="block text-xs font-bold text-murzak-accent mt-1">
                Save {ANNUAL_DISCOUNT_PCT}% — paid once a year
              </span>
            </button>
          </div>
        </div>
      )}
```

with (gated on `order.eligibleForTermChoice && !invoice` instead of `period === "/mo"` — this is the structural fix for C5: a returning customer's add-on is period `/mo` too, but is never eligible, so it never sees the selector at all):

```tsx
      {order.eligibleForTermChoice && !invoice && (
        <div className="glass-card rounded-3xl p-6">
          <p className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-3">
            Billing
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBillingTerm('monthly')}
              className={`text-left rounded-2xl p-4 border transition-all ${
                billingTerm === 'monthly'
                  ? 'border-murzak-accent bg-murzak-accent/10'
                  : 'border-murzak-border hover:border-murzak-accent/40'
              }`}
            >
              <span className="block text-sm font-black text-murzak-ink dark:text-slate-100">
                {formatKes(order.monthlyKes)}/mo
              </span>
              <span className="block text-xs font-bold text-slate-600 dark:text-slate-400 mt-1">
                Billed monthly
              </span>
            </button>
            <button
              type="button"
              onClick={() => setBillingTerm('annual')}
              className={`text-left rounded-2xl p-4 border transition-all ${
                billingTerm === 'annual'
                  ? 'border-murzak-accent bg-murzak-accent/10'
                  : 'border-murzak-border hover:border-murzak-accent/40'
              }`}
            >
              <span className="block text-sm font-black text-murzak-ink dark:text-slate-100">
                {formatKes(annualPrepayKes(order.monthlyKes))}/yr
              </span>
              <span className="block text-xs font-bold text-murzak-accent mt-1">
                Save {ANNUAL_DISCOUNT_PCT}% — paid once a year
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={handleConfirmTerm}
            disabled={preparingPayment}
            className="mt-4 w-full px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-murzak-accent text-murzak-ink flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {preparingPayment ? <Loader2 size={16} className="animate-spin" /> : null}
            Continue to payment
          </button>
        </div>
      )}
```

- [ ] **Step 8: Update the bottom render — no spinner while waiting on a confirmation**

Replace the final ternary's fallback branch:

```tsx
      ) : invoice ? (
        <PaymentMethods
          invoiceDocName={invoice.docName}
          chargeKes={invoice.chargeKes}
          amountUsd={invoice.paypalAmountUsd}
          onSuccess={onSuccess}
          successContent={<p className="text-sm font-bold text-slate-500 leading-relaxed">{afterPaymentCopy}</p>}
        />
      ) : (
        <div className="glass-card rounded-3xl p-8 flex items-center gap-3 text-slate-600 dark:text-slate-400 font-bold">
          <Loader2 size={18} className="animate-spin text-murzak-accent" />
          Preparing payment…
        </div>
      )}
```

with:

```tsx
      ) : invoice ? (
        <PaymentMethods
          invoiceDocName={invoice.docName}
          chargeKes={invoice.chargeKes}
          amountUsd={invoice.paypalAmountUsd}
          onSuccess={onSuccess}
          successContent={<p className="text-sm font-bold text-slate-500 leading-relaxed">{afterPaymentCopy}</p>}
        />
      ) : order.eligibleForTermChoice ? null : (
        <div className="glass-card rounded-3xl p-8 flex items-center gap-3 text-slate-600 dark:text-slate-400 font-bold">
          <Loader2 size={18} className="animate-spin text-murzak-accent" />
          Preparing payment…
        </div>
      )}
```

(For an eligible order, the selector block above already owns the only call-to-action — `Continue to payment` — so there is nothing to render here until `invoice` exists.)

- [ ] **Step 9: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors introduced by `Checkout.tsx` (the pre-existing, unrelated `Portal.tsx(1322,24)` `capacityClass` error may still appear — that is a known issue outside this plan's scope).

- [ ] **Step 10: Manual verification in the browser**

Start the dev server, open `/cloud`, add a fresh (never-purchased) account's first monthly-billed service to cart, and walk through `/checkout/:orderId`:
- Confirm the billing selector renders with no invoice/payment UI below it yet.
- Click "Annual" then "Continue to payment" — confirm exactly one network call to `prepare-payment` fires (check the Network tab), carrying `{"billingTerm":"annual"}`, and that `PaymentMethods` then renders with the annual-prepay amount.
- Repeat as a returning customer buying an add-on — confirm the selector never appears and payment prepares automatically, unchanged from current production behavior.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/Checkout.tsx
git commit -m "feat: checkout defers invoice creation until a first-purchase term choice is confirmed"
```

---

### Task 6: E2E coverage and full-branch verification

**Files:**
- Modify: `frontend/e2e/domain-price-display.spec.ts`

**Interfaces:**
- Consumes: nothing new — exercises the routes/pages built in Tasks 4–5 through the browser.

- [ ] **Step 1: Read the existing PRICE-02 spec**

The existing `PRICE-02` spec (added in commit `3f921fd`) covers "checkout offers monthly vs. 20%-off annual prepay" against the OLD auto-fire-then-correct flow. Read `frontend/e2e/domain-price-display.spec.ts` in full before editing, to match its existing mocking/assertion style exactly (route interception pattern, selectors used, KES value assertions).

- [ ] **Step 2: Update PRICE-02 for the confirm-before-create flow**

Update its route-interception mocks so that:
- The mocked `GET /api/orders/:id` response includes `eligibleForTermChoice: true`.
- The test asserts the mocked `prepare-payment` endpoint receives exactly ONE request for the whole test (not one on load plus one on term change) — assert this via the mock route handler's call counter.
- The test clicks "Annual", then clicks "Continue to payment", THEN asserts the mocked `prepare-payment` request body was `{"billingTerm":"annual"}` and that the payment UI renders the KES 11,520/yr figure (unchanged assertion value from the existing spec — `annualPrepayKes` itself is untouched by this rework).
- Before clicking "Continue to payment", assert that no payment-method UI is visible yet (proving the invoice truly hasn't been created).

Add a second scenario to the same spec, `PRICE-03`, covering a returning customer's add-on purchase: mock `GET /api/orders/:id` with `eligibleForTermChoice: false`, and assert the billing selector never renders and `prepare-payment` fires automatically with no user interaction required — this is the direct regression guard for C5 (mid-relationship term switching must be structurally absent from the UI, not just untested).

- [ ] **Step 3: Run the e2e suite**

Run: `cd frontend && npx playwright test domain-price-display`
Expected: all specs pass, including the updated PRICE-02 and new PRICE-03.

- [ ] **Step 4: Run the full backend suite one final time**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 5: Run the frontend type check one final time**

Run: `cd frontend && npx tsc --noEmit`
Expected: only the pre-existing, unrelated `Portal.tsx` error (if any).

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/domain-price-display.spec.ts
git commit -m "test: e2e coverage for the confirm-before-create checkout flow and the C5 eligibility gate"
```

---

## Final Whole-Branch Review

After Task 6, request a full whole-branch code review (per `superpowers:subagent-driven-development`'s process) covering every commit on `worktree-billing-term` from `c9d073c` (`feat: billingTerm service`) forward, since this plan's commits sit on top of that existing history rather than replacing it wholesale. Confirm specifically:
- No remaining reference to `accountBillingTerm`, `term_started_on`, or any Web Account billing field anywhere in `backend/` or `frontend/`.
- No list query anywhere includes `billing_term` in its `fields`.
- `POST /api/orders/:id/prepare-payment` is reachable at most once per order from the frontend under any interaction sequence.
- The five original Criticals (C1–C5) each map to a specific test added or rewritten in Tasks 1–6.
