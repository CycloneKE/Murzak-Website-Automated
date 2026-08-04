# Billing Term & Price Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display domains at a monthly-equivalent price while still billing yearly (Part A), and add an annual prepay term for hosting at 20% off with a term-aware renewal sweep (Part B).

**Architecture:** Part A is presentation-only — one pure helper plus two render sites, zero billing change. Part B models billing term as `billing_term` on the Web Account (defaulting to `"monthly"`, so existing customers are unaffected), because `sweepRenewals` already operates at account-level cadence. A new `backend/services/billingTerm.js` holds every term calculation as pure functions so they can be tested without touching Frappe.

**Tech Stack:** Express, Frappe REST via `frappeClient()`, plain-node backend tests (`ok()`/`section()` harness), React 18 + react-router v6 + Tailwind (`murzak-*` tokens), Playwright e2e.

## Global Constraints

- **The annual discount is 20% off the annualized monthly sum**: `annualKes = round(monthlySum × 12 × 0.8)`. A KES 2,500/mo service → KES 24,000/yr.
- **An annually-prepaid account must NEVER be billed by the 30-day path.** That is a double-charge and the highest-risk failure mode in this plan. Every change to the sweep needs tests in both directions.
- **An account with no `billing_term` set must behave exactly as `"monthly"`.** Every existing customer is in this state — a regression here breaks live billing.
- **Domain-registration rows stay excluded from the renewal sweep entirely**, exactly as shipped in PR #3. Part B does not change that.
- **Part A changes no billing whatsoever** — same yearly charge, same catalog products, same renewal exclusion.
- **The monthly-equivalent figure must never understate the price**: use `Math.ceil`, and assert `monthlyEquivalent × 12 >= yearlyPrice` for every TLD.
- **Disclosure is mandatory**: wherever a derived monthly domain figure appears, the annual total appears with it. Never a bare "KES 125/mo".
- **KES display always via `formatKes()`** from `frontend/src/config/serviceCatalog.ts`.
- **Backend tests** are plain node scripts registered in `backend/package.json`'s `test` chain.
- **Snapshot regeneration** (`node backend/scripts/generate-catalog-snapshot.js`) is mandatory and committed in the same commit if any catalog source field changes.

### Environment gotchas (this machine)

- git-bash lacks `/usr/bin` and the nodejs dir in PATH. Bare `node`, `npm`, `npx`, `cat`, `grep`, `tail` will fail or hang.
  - Verified working: `"/c/Program Files/nodejs/node.exe" test/foo.test.js`
  - Or prefix: `export PATH="/usr/bin:/bin:/c/Program Files/nodejs:$PATH" && ...`
  - Use the Read tool instead of `cat`.
- Frontend typecheck: `"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit` from `frontend/`. Expect ONLY this pre-existing unrelated error: `src/pages/Portal.tsx(1322,24): error TS2339: Property 'capacityClass' does not exist on type 'SelectedServiceView'.` Never touch that file.
- Disk space has been critically low. On any `ENOSPC`, STOP and report — do not attempt cleanup.
- No backend `.env` credentials, so Playwright specs needing registration fail with `ECONNREFUSED`. Known pre-existing limitation; report it honestly rather than claiming a pass.

## File Structure

```
frontend/src/config/serviceCatalog.ts   # MODIFIED — monthlyEquivalentKes()
frontend/src/components/DomainSearch.tsx # MODIFIED — monthly + annual disclosure
frontend/src/pages/Checkout.tsx          # MODIFIED — same for order summary
backend/services/billingTerm.js          # NEW — all term math, pure functions
backend/services/renewalService.js       # MODIFIED — term-aware cycle + amount
backend/routes/ordersRoutes.js           # MODIFIED — accept + persist term, pro-rata
backend/test/billingTerm.test.js         # NEW
backend/test/renewal.test.js             # MODIFIED — term matrix
frontend/src/pages/Checkout.tsx          # MODIFIED (Part B) — term selector
frontend/e2e/domain-price-display.spec.ts # NEW
```

---

# PART A — Domain monthly-equivalent display

### Task 1: `monthlyEquivalentKes` helper

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts`
- Test: `backend/test/catalogSnapshot.test.js` (extend — it already imports catalog data backend-side)

**Interfaces:**
- Produces (Task 2 consumes):
  ```ts
  /** Monthly-equivalent of a yearly price, rounded UP so it never understates. */
  export function monthlyEquivalentKes(yearlyKes: number): number
  ```

- [ ] **Step 1: Write the failing test**

Append to `backend/test/catalogSnapshot.test.js`, before its final summary/exit block:

```js
  section("monthly-equivalent domain pricing never understates");
  // Mirror of frontend monthlyEquivalentKes (Math.ceil(yearly / 12)). The
  // frontend function is the source of truth for display; this asserts the
  // arithmetic property that matters commercially — a customer must never see
  // a monthly figure that annualizes to LESS than what they'll actually be
  // charged.
  const monthlyEquiv = (yearly) => Math.ceil(yearly / 12);
  const domainYearly = {
    "domain-coke": 1200,
    "domain-com": 1500,
    "domain-ke": 1800,
    "domain-org": 1800,
    "domain-net": 1800,
    "domain-africa": 2500,
    "domain-io": 4500,
  };
  for (const [id, yearly] of Object.entries(domainYearly)) {
    const meta = getServiceMeta(id);
    ok(meta?.monthlyKes === yearly, `${id} yearly price is ${yearly}`);
    ok(monthlyEquiv(yearly) * 12 >= yearly, `${id} monthly-equivalent never understates`);
  }
  ok(monthlyEquiv(1500) === 125, ".com -> 125/mo exactly");
  ok(monthlyEquiv(2500) === 209, ".africa 2500/12 = 208.33 rounds UP to 209");
  ok(monthlyEquiv(1200) === 100, ".co.ke -> 100/mo exactly");
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `"/c/Program Files/nodejs/node.exe" test/catalogSnapshot.test.js`
Expected: FAIL on `.africa 2500/12 = 208.33 rounds UP to 209` only if the arithmetic is wrong — since the helper is inlined in the test, this step actually verifies the *expectations* are self-consistent. If all pass immediately, that is expected and fine: this test locks the property; Step 3 adds the real frontend helper the display uses.

- [ ] **Step 3: Add the helper to the catalog**

In `frontend/src/config/serviceCatalog.ts`, add immediately after the existing `isYearlyBilled` function:

```ts
/**
 * Monthly-equivalent of a yearly price, for DISPLAY ONLY — nothing is billed
 * monthly. Rounded UP so the advertised monthly figure can never annualize to
 * less than the amount actually charged (only .africa is non-exact:
 * 2500/12 = 208.33 -> 209).
 *
 * Callers MUST show the annual total alongside this figure — a bare
 * "KES 125/mo" without "billed annually at KES 1,500" is a misleading price
 * representation.
 */
export function monthlyEquivalentKes(yearlyKes: number): number {
  return Math.ceil(yearlyKes / 12);
}
```

- [ ] **Step 4: Run tests**

Run: `"/c/Program Files/nodejs/node.exe" test/catalogSnapshot.test.js` — Expected: all `ok:`, exit 0.
Run (from `frontend/`): `"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit` — Expected: only the known `Portal.tsx` error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/test/catalogSnapshot.test.js
git commit -m "feat: monthlyEquivalentKes helper for domain price display"
```

---

### Task 2: Render monthly-equivalent + annual disclosure

**Files:**
- Modify: `frontend/src/components/DomainSearch.tsx` (price span, currently `{formatKes(r.priceKes)}/yr` around line 88)
- Modify: `frontend/src/pages/Checkout.tsx` (order-summary price, currently `{formatKes(order.monthlyKes)}{period}` around line 443)

**Interfaces:**
- Consumes: `monthlyEquivalentKes(yearlyKes: number): number`, `formatKes`, `isYearlyBilled` (all from `serviceCatalog.ts`).

- [ ] **Step 1: Update DomainSearch's price display**

In `frontend/src/components/DomainSearch.tsx`, add `monthlyEquivalentKes` to the existing import from `../config/serviceCatalog` (currently imports `formatKes` only).

Replace the price span:

```tsx
                      <span className="text-label font-black text-slate-600 dark:text-slate-400">
                        {formatKes(r.priceKes)}/yr
                      </span>
```

with:

```tsx
                      <span className="text-right leading-tight">
                        <span className="block text-label font-black text-murzak-ink dark:text-slate-100">
                          {formatKes(monthlyEquivalentKes(r.priceKes))}/mo
                        </span>
                        <span className="block text-micro font-bold text-slate-600 dark:text-slate-400">
                          billed annually at {formatKes(r.priceKes)}
                        </span>
                      </span>
```

- [ ] **Step 2: Update Checkout's order summary**

In `frontend/src/pages/Checkout.tsx`, add `monthlyEquivalentKes` to the existing `serviceCatalog` import (which already brings in `getService, formatKes, postPurchaseCopy, GENERIC_POST_PURCHASE_COPY, isYearlyBilled`).

Replace the price span:

```tsx
          <span className="text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter whitespace-nowrap">
            {formatKes(order.monthlyKes)}{period}
          </span>
```

with:

```tsx
          <span className="text-right whitespace-nowrap">
            {period === "/yr" ? (
              <>
                <span className="block text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter">
                  {formatKes(monthlyEquivalentKes(order.monthlyKes))}/mo
                </span>
                <span className="block text-xs font-bold text-slate-600 dark:text-slate-400">
                  billed annually at {formatKes(order.monthlyKes)}
                </span>
              </>
            ) : (
              <span className="block text-2xl font-black text-murzak-ink dark:text-slate-100 tracking-tighter">
                {formatKes(order.monthlyKes)}{period}
              </span>
            )}
          </span>
```

Note: the "Due now" line below (`{formatKes(order.monthlyKes)}`) is deliberately left unchanged — it already shows the real amount being charged today, which for a yearly domain IS the full annual figure. That is correct and must not be converted to a monthly number.

- [ ] **Step 3: Verify**

Run (from `frontend/`): `"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit`
Expected: only the known `Portal.tsx` error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DomainSearch.tsx frontend/src/pages/Checkout.tsx
git commit -m "feat: show domains at monthly-equivalent price with annual disclosure"
```

---

# PART B — Annual prepay for hosting

### Task 3: `billingTerm.js` — pure term calculations

**Files:**
- Create: `backend/services/billingTerm.js`
- Test: `backend/test/billingTerm.test.js`
- Modify: `backend/package.json` (test chain)

**Interfaces:**
- Produces (Tasks 4 and 6 consume these exact signatures):
  ```js
  const ANNUAL_DISCOUNT_PCT = 20;
  const ANNUAL_CYCLE_DAYS = 365;

  /** "annual" only when explicitly set; anything else (incl. missing) is "monthly". */
  function accountBillingTerm(account)                    // -> "monthly" | "annual"
  /** round(monthlySum * 12 * 0.8) */
  function annualPrepayKes(monthlySumKes)                 // -> number
  /** Cycle length for a term. monthlyCycleDays comes from renewalConfig().cycleDays. */
  function cycleDaysForTerm(term, monthlyCycleDays)       // -> number
  /** What the renewal sweep should bill for this term. */
  function renewalAmountForTerm(term, monthlySumKes)      // -> number
  /** Annual price of one add-on, pro-rated to the days left in the term. */
  function proRatedAddonKes(addonMonthlyKes, daysRemainingInTerm) // -> number
  /** Days left in an annual term that began on termStartedOn ("YYYY-MM-DD").
   *  Returns 0 for a missing/unparseable date (bill nothing off garbage data)
   *  and clamps to [0, 365]. */
  function daysRemainingInTerm(termStartedOn, nowMs)      // -> number
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/test/billingTerm.test.js`:

```js
// Billing-term math. Pure functions — no Frappe, no clock dependence.
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  ANNUAL_DISCOUNT_PCT,
  ANNUAL_CYCLE_DAYS,
  accountBillingTerm,
  annualPrepayKes,
  cycleDaysForTerm,
  renewalAmountForTerm,
  proRatedAddonKes,
  daysRemainingInTerm,
} = require("../services/billingTerm");

(async () => {
  section("accountBillingTerm — missing/unknown defaults to monthly");
  // EVERY existing customer has no billing_term field. A regression here
  // silently changes live billing for the whole book.
  ok(accountBillingTerm(undefined) === "monthly", "undefined account -> monthly");
  ok(accountBillingTerm({}) === "monthly", "no billing_term -> monthly");
  ok(accountBillingTerm({ billing_term: "" }) === "monthly", "empty string -> monthly");
  ok(accountBillingTerm({ billing_term: "nonsense" }) === "monthly", "unknown value -> monthly");
  ok(accountBillingTerm({ billing_term: "monthly" }) === "monthly", "explicit monthly");
  ok(accountBillingTerm({ billing_term: "annual" }) === "annual", "explicit annual");
  ok(accountBillingTerm({ billing_term: "ANNUAL" }) === "annual", "case-insensitive annual");

  section("annualPrepayKes — 20% off the annualized sum");
  ok(ANNUAL_DISCOUNT_PCT === 20, "discount is 20%");
  ok(annualPrepayKes(2500) === 24000, "2500/mo -> 24000/yr (30000 less 20%)");
  ok(annualPrepayKes(1200) === 11520, "1200/mo -> 11520/yr");
  ok(annualPrepayKes(0) === 0, "zero stays zero");
  ok(annualPrepayKes(2000) < 2000 * 12, "annual is always cheaper than 12x monthly");

  section("cycleDaysForTerm");
  ok(ANNUAL_CYCLE_DAYS === 365, "annual cycle is 365 days");
  ok(cycleDaysForTerm("monthly", 30) === 30, "monthly uses the configured cycle");
  ok(cycleDaysForTerm("monthly", 45) === 45, "monthly respects a non-default config");
  ok(cycleDaysForTerm("annual", 30) === 365, "annual ignores the monthly cycle");

  section("renewalAmountForTerm");
  ok(renewalAmountForTerm("monthly", 2500) === 2500, "monthly bills the monthly sum");
  ok(renewalAmountForTerm("annual", 2500) === 24000, "annual bills the discounted year");

  section("proRatedAddonKes");
  // A full term remaining costs the full annual price; half a term, half.
  ok(proRatedAddonKes(2500, 365) === 24000, "full term remaining = full annual price");
  ok(proRatedAddonKes(2500, 0) === 0, "no days remaining = nothing owed");
  ok(proRatedAddonKes(2500, 182) === Math.round(24000 * (182 / 365)), "mid-term is proportional");
  ok(proRatedAddonKes(2500, 182) < 24000, "mid-term costs less than a full term");
  ok(proRatedAddonKes(2500, 1) > 0, "one day remaining still bills something");

  section("daysRemainingInTerm");
  const NOW = Date.parse("2026-07-02T12:00:00Z");
  ok(daysRemainingInTerm("2026-07-02", NOW) === 365, "term started today -> full 365 left");
  ok(daysRemainingInTerm("2026-06-02", NOW) === 335, "30 days in -> 335 left");
  ok(daysRemainingInTerm("2025-07-02", NOW) === 0, "a full year elapsed -> 0 left");
  ok(daysRemainingInTerm("2020-01-01", NOW) === 0, "long past -> clamps at 0, never negative");
  // Garbage data must bill nothing, never a wrong amount.
  ok(daysRemainingInTerm(undefined, NOW) === 0, "missing date -> 0");
  ok(daysRemainingInTerm("", NOW) === 0, "empty date -> 0");
  ok(daysRemainingInTerm("not-a-date", NOW) === 0, "unparseable date -> 0");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `"/c/Program Files/nodejs/node.exe" test/billingTerm.test.js`
Expected: FAIL — `Cannot find module '../services/billingTerm'`

- [ ] **Step 3: Implement `billingTerm.js`**

Create `backend/services/billingTerm.js`:

```js
// services/billingTerm.js
//
// All billing-term arithmetic, as pure functions with no Frappe or clock
// dependency so they can be tested exhaustively.
//
// Term lives on the Web Account (`billing_term`), NOT on catalog products.
// That is deliberate: sweepRenewals already runs at account-level cadence, and
// putting a yearly figure into a product's `monthlyKes` field is exactly the
// pattern that caused the 12x domain-overcharge bug fixed in PR #3.

const ANNUAL_DISCOUNT_PCT = 20;
const ANNUAL_CYCLE_DAYS = 365;

/**
 * The account's billing term. FAILS SAFE TO "monthly": every pre-existing
 * customer has no `billing_term` field at all, and monthly is their current
 * (correct) behavior. Only an explicit "annual" opts in.
 */
function accountBillingTerm(account) {
  return String(account?.billing_term || "").toLowerCase() === "annual"
    ? "annual"
    : "monthly";
}

/** Annualized monthly sum, less the annual-prepay discount. */
function annualPrepayKes(monthlySumKes) {
  const gross = Number(monthlySumKes) || 0;
  return Math.round(gross * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}

/** How many days between renewals for this term. */
function cycleDaysForTerm(term, monthlyCycleDays) {
  return term === "annual" ? ANNUAL_CYCLE_DAYS : monthlyCycleDays;
}

/** What the renewal sweep bills for this term. */
function renewalAmountForTerm(term, monthlySumKes) {
  return term === "annual"
    ? annualPrepayKes(monthlySumKes)
    : Number(monthlySumKes) || 0;
}

/**
 * An add-on bought mid-term is charged only for the remainder of the term, so
 * the whole account keeps renewing on a single anniversary.
 */
function proRatedAddonKes(addonMonthlyKes, daysRemainingInTerm) {
  const days = Math.max(0, Math.min(ANNUAL_CYCLE_DAYS, Number(daysRemainingInTerm) || 0));
  return Math.round(annualPrepayKes(addonMonthlyKes) * (days / ANNUAL_CYCLE_DAYS));
}

/**
 * Days left in an annual term that began on `termStartedOn` ("YYYY-MM-DD").
 *
 * FAILS SAFE TO 0 on missing/unparseable input: a pro-rated charge computed
 * from garbage would be a wrong amount on a real invoice, whereas 0 simply
 * bills nothing and is visible as an anomaly. Clamped to [0, 365] so an
 * expired or future-dated term can never produce a negative or inflated
 * charge.
 */
function daysRemainingInTerm(termStartedOn, nowMs = Date.now()) {
  if (!termStartedOn) return 0;
  const iso = String(termStartedOn).slice(0, 10);
  const startMs = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(startMs)) return 0;
  const elapsedDays = Math.floor((nowMs - startMs) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(ANNUAL_CYCLE_DAYS, ANNUAL_CYCLE_DAYS - elapsedDays));
}

module.exports = {
  ANNUAL_DISCOUNT_PCT,
  ANNUAL_CYCLE_DAYS,
  accountBillingTerm,
  annualPrepayKes,
  cycleDaysForTerm,
  renewalAmountForTerm,
  proRatedAddonKes,
  daysRemainingInTerm,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"/c/Program Files/nodejs/node.exe" test/billingTerm.test.js`
Expected: all `ok:`, exit 0.

- [ ] **Step 5: Register test and commit**

Append `&& node test/billingTerm.test.js` to the `test` script in `backend/package.json`.

```bash
git add backend/services/billingTerm.js backend/test/billingTerm.test.js backend/package.json
git commit -m "feat: billingTerm service — annual prepay and pro-rata math"
```

---

### Task 4: Term-aware renewal sweep

**This is the highest-risk task in the plan.** Billing an annual account on the 30-day path is a double-charge.

**Files:**
- Modify: `backend/services/renewalService.js`
- Test: `backend/test/renewal.test.js`

**Interfaces:**
- Consumes: `accountBillingTerm`, `cycleDaysForTerm`, `renewalAmountForTerm` (Task 3).

**Required reordering:** today the sweep checks `isDueForRenewal(lastPaid.invoice_date, cfg.cycleDays)` at line ~170 and only fetches the account at line ~186. The term lives on the account, so the account fetch must move ABOVE the due check.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/renewal.test.js`, before its final summary block:

```js
console.log("# billing term — sweep cycle and amount");
{
  const {
    accountBillingTerm,
    cycleDaysForTerm,
    renewalAmountForTerm,
  } = require("../services/billingTerm");

  const monthlyCycle = 30;

  // The four rows of the safety matrix from the spec.
  const monthlyAcct = { billing_term: "monthly" };
  const annualAcct = { billing_term: "annual" };
  const legacyAcct = {}; // every existing customer

  const mTerm = accountBillingTerm(monthlyAcct);
  const aTerm = accountBillingTerm(annualAcct);
  const lTerm = accountBillingTerm(legacyAcct);

  // Row 1: annual account is NOT due at 30 days. THE double-charge guard.
  ok(
    !isDueForRenewal("2026-06-02", cycleDaysForTerm(aTerm, monthlyCycle), NOW),
    "annual account is NOT due after 30 days (double-charge guard)"
  );
  // Row 2: annual account IS due past 365 days, at the discounted amount.
  const longAgo = "2025-06-02"; // > 365d before NOW (2026-07-02)
  ok(
    isDueForRenewal(longAgo, cycleDaysForTerm(aTerm, monthlyCycle), NOW),
    "annual account IS due after 365 days"
  );
  ok(
    renewalAmountForTerm(aTerm, 2500) === 24000,
    "annual account bills the 20%-discounted year"
  );
  // Row 3: monthly account unchanged.
  ok(
    isDueForRenewal("2026-06-02", cycleDaysForTerm(mTerm, monthlyCycle), NOW),
    "monthly account still due at 30 days (no regression)"
  );
  ok(
    renewalAmountForTerm(mTerm, 2500) === 2500,
    "monthly account still bills the monthly sum"
  );
  // Row 4: legacy account (no billing_term) behaves exactly as monthly.
  ok(lTerm === "monthly", "account with no billing_term is treated as monthly");
  ok(
    isDueForRenewal("2026-06-02", cycleDaysForTerm(lTerm, monthlyCycle), NOW) === true &&
      renewalAmountForTerm(lTerm, 2500) === 2500,
    "legacy account bills identically to an explicit monthly account"
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `"/c/Program Files/nodejs/node.exe" test/renewal.test.js`
Expected: FAIL — `Cannot find module '../services/billingTerm'` if Task 3 is not yet merged; otherwise these pass immediately (they exercise Task 3's pure functions). Either way Step 3 wires them into the actual sweep, which is the behavior change.

- [ ] **Step 3: Make the sweep term-aware**

In `backend/services/renewalService.js`:

Add to the requires at the top of the file, beside the existing catalog require:

```js
const {
  accountBillingTerm,
  cycleDaysForTerm,
  renewalAmountForTerm,
} = require("./billingTerm");
```

Then restructure the sweep body. Currently it reads (abridged):

```js
        if (!isDueForRenewal(lastPaid.invoice_date, cfg.cycleDays)) continue;
        // ...open-invoice check...
        const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`);
        const account = accRes.data?.data;
        if (!account) continue;
```

Change to fetch the account FIRST, derive the term, then apply the term-appropriate cycle:

```js
        // The billing term lives on the account, so the account must be loaded
        // BEFORE the due-check — an annual account is not due at 30 days, and
        // checking with the monthly cycle first would bill it 12x a year.
        const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`);
        const account = accRes.data?.data;
        if (!account) continue;

        const term = accountBillingTerm(account);
        if (!isDueForRenewal(lastPaid.invoice_date, cycleDaysForTerm(term, cfg.cycleDays))) continue;
```

Keep the existing open-invoice check exactly where it is relative to these lines (it may sit before or after; do not change its logic — only ensure the account fetch precedes the due check).

Delete the now-duplicated later account fetch (the original `const accRes = ...` / `const account = ...` block at ~line 186), since the account is now loaded above.

Then make the billed amount term-aware. Replace:

```js
        const amount = sumSelectedServicesMonthlyKes(serviceRows);
        if (!(amount > 0)) continue;
```

with:

```js
        const monthlySum = sumSelectedServicesMonthlyKes(serviceRows);
        if (!(monthlySum > 0)) continue;
        // Annual-term accounts pay the discounted year up front; monthly-term
        // (and every legacy account with no billing_term) pay the monthly sum.
        const amount = renewalAmountForTerm(term, monthlySum);
```

The rest of the invoice creation is unchanged — it already uses `amount`.

- [ ] **Step 4: Run tests**

Run: `"/c/Program Files/nodejs/node.exe" test/renewal.test.js` — Expected: all `ok:`, exit 0.
Run the full backend chain (each file individually, since bare `npm` may hang):
```bash
cd backend && for f in test/*.test.js; do "/c/Program Files/nodejs/node.exe" "$f" || echo "FAILED: $f"; done
```
Expected: no `FAILED:` lines.

- [ ] **Step 5: Commit**

```bash
git add backend/services/renewalService.js backend/test/renewal.test.js
git commit -m "feat: term-aware renewal sweep — annual accounts bill yearly at 20% off"
```

---

### Task 5: Persist billing term on order creation

**Files:**
- Modify: `backend/routes/ordersRoutes.js`
- Test: `backend/test/ordersRoutes.test.js`

**Interfaces:**
- Consumes: `accountBillingTerm` (Task 3).
- Produces: `POST /api/orders` accepts an optional `billingTerm: "monthly" | "annual"` in the body; when `"annual"`, the account's `billing_term` is set to `"annual"` at prepare-payment time.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/ordersRoutes.test.js`, before its final summary block:

```js
  section("POST /api/orders — billingTerm is accepted and persisted");
  {
    const client = makeMockFrappe({
      "Web Account": { "acct-term": { name: "acct-term", plan: "None", selected_services: [] } },
    });
    const ctx = baseCtx(client);
    const router = createOrdersRouter(ctx);
    const create = findHandler(router, "post", "/api/orders");

    const res = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting", billingTerm: "annual" } },
      res
    );
    ok(res.statusCode === 200, "annual-term order is accepted");
    ok(res.body?.order?.billingTerm === "annual", "order echoes the requested term");

    const res2 = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting" } },
      res2
    );
    ok(res2.body?.order?.billingTerm === "monthly", "omitted term defaults to monthly");

    const res3 = makeRes();
    await create(
      { session: { webAccount: "acct-term" }, body: { serviceId: "starter-web-hosting", billingTerm: "bogus" } },
      res3
    );
    ok(res3.body?.order?.billingTerm === "monthly", "unknown term falls back to monthly, never errors");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"/c/Program Files/nodejs/node.exe" test/ordersRoutes.test.js`
Expected: FAIL on `order echoes the requested term` (`billingTerm` is `undefined`).

- [ ] **Step 3: Accept and persist the term**

In `backend/routes/ordersRoutes.js`:

Add to the requires at the top:

```js
const { accountBillingTerm } = require("../services/billingTerm");
```

In the `POST /api/orders` handler, where the body is destructured (currently `{ serviceId, config, planKey, source }`), add `billingTerm`:

```js
      const { serviceId, config, planKey, source, billingTerm } = req.body || {};
```

Normalize it the same way the account helper does — never trust the raw string — and pass it into `createOrder`'s config so it round-trips on the order:

```js
      // Normalized here (not trusted raw) so an unknown value can never become
      // an accidental "annual". Mirrors accountBillingTerm's fail-safe rule.
      const normalizedTerm =
        String(billingTerm || "").toLowerCase() === "annual" ? "annual" : "monthly";
```

Pass `normalizedTerm` through to the created order by merging it into the stored config:

```js
        config: { ...(config || {}), billingTerm: normalizedTerm },
```

and surface it on the API response object by adding to the JSON the handler returns:

```js
      return res.json({ ok: true, order: { ...order, billingTerm: normalizedTerm } });
```

In the `prepare-payment` handler, when the normalized term on the order is `"annual"`, persist it to the account before invoicing:

```js
      // Persist the chosen term on the account so the renewal sweep bills on
      // the right cadence from here on. Only ever writes "annual" — an account
      // is never silently downgraded to monthly by an order.
      //
      // `term_started_on` anchors pro-rata for mid-term add-ons. It is written
      // ONLY when the account is not already annual, so a second annual
      // purchase never resets an in-flight term (which would hand the customer
      // a fresh 365 days they did not pay for).
      if (String(order.config?.billingTerm || "").toLowerCase() === "annual") {
        const alreadyAnnual = accountBillingTerm(record) === "annual";
        await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
          billing_term: "annual",
          ...(alreadyAnnual ? {} : { term_started_on: new Date().toISOString().slice(0, 10) }),
        });
      }
```

Place this immediately before the `hasPaidPlan` branch so it applies to both invoice paths. (`record` is the Web Account already fetched a few lines above via `fetchWebAccount`.)

- [ ] **Step 4: Run tests**

Run: `"/c/Program Files/nodejs/node.exe" test/ordersRoutes.test.js` — Expected: all `ok:`, exit 0.
Run the full chain as in Task 4 Step 4 — Expected: no `FAILED:` lines.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/ordersRoutes.js backend/test/ordersRoutes.test.js
git commit -m "feat: accept and persist billing term on order creation"
```

---

### Task 6: Pro-rate mid-term add-ons for annual accounts

**Files:**
- Modify: `backend/services/addonInvoiceService.js`
- Test: `backend/test/addonInvoiceService.test.js`

**Interfaces:**
- Consumes: `accountBillingTerm`, `daysRemainingInTerm`, `proRatedAddonKes` (Task 3); `term_started_on` on the Web Account (Task 5).

**Behavior:** when an account's term is `"annual"`, an add-on bought mid-term is billed the annual price of that add-on pro-rated to the days left in the term, so everything renews on one anniversary. Monthly-term accounts (and every legacy account with no `billing_term`) are billed exactly as today — unchanged.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/addonInvoiceService.test.js`, before its final summary block:

```js
  section("annual-term accounts get mid-term add-ons pro-rated");
  {
    const { annualPrepayKes } = require("../services/billingTerm");
    // Term started 182 days ago -> ~half the year left.
    const started = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = makeClient({
      account: {
        plan: "Starter",
        billing_term: "annual",
        term_started_on: started,
        selected_services: [],
      },
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

  section("monthly-term and legacy accounts are billed exactly as before");
  {
    const client = makeClient({ account: { plan: "Starter", selected_services: [] } });
    const res = await createAddonInvoice({
      client,
      webAccountName: "acct-1",
      deps,
      services: [{ serviceId: "starter-web-hosting", serviceName: "Website Hosting (Starter)", tier: "Light", domainChoice: "" }],
    });
    ok(res.amountKes === 1200, "legacy account (no billing_term) still bills the monthly price");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `"/c/Program Files/nodejs/node.exe" test/addonInvoiceService.test.js`
Expected: FAIL on `mid-term add-on costs less than a full annual term` — the annual account is currently billed the flat monthly 1200, so the assertion that it exceeds a single month fails.

- [ ] **Step 3: Pro-rate in `createAddonInvoice`**

In `backend/services/addonInvoiceService.js`, add to the requires at the top:

```js
const {
  accountBillingTerm,
  daysRemainingInTerm,
  proRatedAddonKes,
} = require("./billingTerm");
```

Find where the à-la-carte amount is computed (`const amount = sumSelectedServicesMonthlyKes(norm);`) and replace it with:

```js
  // Annual-term accounts pay each add-on's ANNUAL price pro-rated to the days
  // left in their current term, so the whole account keeps renewing on one
  // anniversary. Monthly-term accounts — and every legacy account with no
  // billing_term — are billed the monthly sum exactly as before.
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

`record` is the Web Account already fetched earlier in this function; `getServiceMeta` is already imported.

Apply the same treatment to the merged-invoice branch: where it computes `const mergedAmount = sumSelectedServicesMonthlyKes(mergedServices);`, wrap it identically so a merged open invoice does not silently revert an annual account to monthly pricing:

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
```

- [ ] **Step 4: Run tests**

Run: `"/c/Program Files/nodejs/node.exe" test/addonInvoiceService.test.js` — Expected: all `ok:`, exit 0.
Run the full chain (each file individually):
```bash
cd backend && for f in test/*.test.js; do "/c/Program Files/nodejs/node.exe" "$f" || echo "FAILED: $f"; done
```
Expected: no `FAILED:` lines.

- [ ] **Step 5: Commit**

```bash
git add backend/services/addonInvoiceService.js backend/test/addonInvoiceService.test.js
git commit -m "feat: pro-rate mid-term add-ons for annual-term accounts"
```

---

### Task 7: Checkout term selector

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx`

**Interfaces:**
- Consumes: `POST /api/orders` `billingTerm` field (Task 5); `annualPrepayKes` equivalent on the frontend (add a matching helper — see Step 1).

**Scope note:** the selector appears ONLY for non-domain products (`period === "/mo"`). Domains are yearly one-offs and must not show a term choice.

- [ ] **Step 1: Add the frontend annual-price helper**

In `frontend/src/config/serviceCatalog.ts`, add after `monthlyEquivalentKes`:

```ts
/** Annual-prepay discount, must stay in sync with backend/services/billingTerm.js. */
export const ANNUAL_DISCOUNT_PCT = 20;

/** Annualized monthly price less the annual-prepay discount. */
export function annualPrepayKes(monthlyKes: number): number {
  return Math.round(monthlyKes * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}
```

- [ ] **Step 2: Render the selector**

In `frontend/src/pages/Checkout.tsx`, add `annualPrepayKes` and `ANNUAL_DISCOUNT_PCT` to the `serviceCatalog` import, and add state near the other `useState` declarations:

```tsx
  const [billingTerm, setBillingTerm] = useState<'monthly' | 'annual'>('monthly');
```

Insert this block immediately after the order-summary card's closing `</div>`, rendered only for monthly-billed products:

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

- [ ] **Step 3: Verify**

Run (from `frontend/`): `"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit`
Expected: only the known `Portal.tsx` error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts frontend/src/pages/Checkout.tsx
git commit -m "feat: checkout offers monthly or annual-prepay billing term"
```

---

### Task 8: E2E coverage

**Files:**
- Create: `frontend/e2e/domain-price-display.spec.ts`

- [ ] **Step 1: Write the spec**

Create `frontend/e2e/domain-price-display.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Registration helper, copied verbatim from frontend/e2e/checkout.spec.ts.
// Keep identical to the source if its selectors ever change.
async function registerNewUser(page: import('@playwright/test').Page, tag: string) {
  const suffix = Math.floor(Math.random() * 100000);
  const email = `test_pricedisp_${tag}_${suffix}@example.com`;

  await page.goto('/login');
  await expect(page.locator('h1')).toContainText(/Client Dashboard/, { timeout: 10000 });
  await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
  await page.getByPlaceholder('Samuel Okoth').fill(`PriceDisp ${tag} Tester`);
  await page.getByPlaceholder('My Company Ltd').fill(`PriceDisp ${tag} Co`);
  await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing price display');
  await page.getByPlaceholder('sam@company.co.ke').fill(email);
  await page.getByPlaceholder('••••••••').fill('TestPassword123!');
  await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
  await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 15000 });
  return { email };
}

test.describe('PRICE-01 — domain results show monthly figure with annual disclosure', () => {
  test.describe.configure({ timeout: 60_000 });

  test('a domain search result shows /mo and the annual total together', async ({ page }) => {
    await registerNewUser(page, 'domain');
    await page.goto('/products');

    await page.getByPlaceholder('yourbusiness').fill('pricedisplaytest99');
    await page.getByRole('button', { name: 'Search' }).click();

    const results = page.locator('li').filter({ hasText: /\/mo/ });
    await expect(results.first()).toBeVisible({ timeout: 15000 });

    // The disclosure must accompany the monthly figure — a bare "/mo" with no
    // annual total is exactly what this feature must never ship.
    await expect(page.getByText(/billed annually at/i).first()).toBeVisible();
  });
});

test.describe('PRICE-02 — checkout offers a billing term for monthly products', () => {
  test.describe.configure({ timeout: 60_000 });

  test('a hosting order shows monthly and annual options with the saving', async ({ page }) => {
    await registerNewUser(page, 'term');
    await page.goto('/checkout/new?serviceId=starter-web-hosting');

    await expect(page.getByText('Order summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Billed monthly')).toBeVisible();
    await expect(page.getByText(/Save 20%/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Attempt a live run and report honestly**

Run (from `frontend/`):
```bash
npx playwright test e2e/domain-price-display.spec.ts --project=chromium --reporter=list
```
If no backend is available the registration-dependent tests will fail with `ECONNREFUSED` on `/api/register`. That is the known pre-existing environment limitation — report the REAL outcome (which tests ran, which failed, and the actual error), and do NOT claim a pass that did not happen. Verify the spec at least type-checks.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/domain-price-display.spec.ts
git commit -m "test: e2e coverage for domain price display and billing term selector"
```

---

## Follow-ups (explicitly out of this plan's scope)

- **Switching an existing customer's term mid-relationship** (monthly → annual upgrade, annual → monthly downgrade) and any refund/credit logic. New purchases pick a term; changing it later is its own project.
- Live Hostinger cost lookup / markup-derived domain pricing (blocked on `HOSTINGER_API_TOKEN`).
- RAM ceiling monitoring and upgrade prompts — separate feature; actual-consumption telemetry does not exist yet.
