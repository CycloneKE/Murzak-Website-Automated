# Billing Term Rework — Design

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan
**Supersedes:** the Part B (annual prepay) sections of `2026-08-04-billing-term-and-price-display-design.md`. Part A of that spec (domain monthly-equivalent display) is unaffected, already shipped as PR #4, and is not touched by this document.

## Problem

The first implementation of annual prepay billing (built and merged to a feature branch, never merged to master) failed its final whole-branch review with five Critical findings, all sharing one root cause: `billing_term` and `term_started_on` were stored as mutable fields on the Web Account, written and read independently by three subsystems (order creation, the renewal sweep, add-on pro-rata) with no single owner of the field's lifecycle.

The five findings:
- **C1**: choosing "Annual" at checkout charged the monthly amount and left a year unbilled. The correction code that was meant to fix this sat behind an idempotency short-circuit the real UI flow always hit first, so it was unreachable in production.
- **C2**: the renewal sweep used the invoice's recorded term for its due-check cycle but the account's *current* term for the billed amount — a path existed where these could disagree, producing up to a 9.6× overcharge.
- **C3**: `term_started_on` was written once and never advanced. From day 366 onward, every mid-term add-on pro-rated to KES 0.
- **C4**: three new Frappe fields shipped with no fixture or migration, and one was added to a bulk list-query's `fields`, which fails the entire query on an unrecognized column — risking zero renewal invoices for the whole existing customer base, not just annual ones.
- **C5**: mid-relationship monthly→annual switching, explicitly deferred in the original spec, was fully reachable from the UI because nothing structurally prevented it.

## Root-cause fix: term is derived, not stored

**Web Account gains zero new fields.** `Portal Invoice` gains exactly one: `billing_term` (`"monthly" | "annual"`; absent means monthly — this is what makes every pre-existing invoice safe by construction).

A single function, `currentBillingTerm(account)`, is the only way anything in the codebase answers "what term is this account on, and since when":

```js
// Reuses findLatestPaidSubscriptionInvoice (an existing server.js primitive
// already trusted for plan-state decisions elsewhere in this codebase).
function currentBillingTerm(account) {
  const lastPaid = findLatestPaidSubscriptionInvoice(account);
  if (!lastPaid) return { term: "monthly", anchorDate: null }; // no history yet
  const term = lastPaid.billing_term === "annual" ? "annual" : "monthly";
  return { term, anchorDate: lastPaid.invoice_date };
}
```

The renewal sweep, `createAddonInvoice`'s pro-rata, and order creation's eligibility check all call this one function. They cannot disagree about the term, because there is exactly one place the term is computed.

This also resolves C3 without any "advance the anchor" step: the anchor **is** "whichever Subscription invoice was paid most recently." Every renewal invoice the sweep creates automatically becomes next year's anchor, because it becomes the new most-recent paid Subscription invoice. There is no separate field to remember to update.

## The renewal sweep (fixes C2)

The sweep computes `{ term, anchorDate } = currentBillingTerm(account)` once per account and uses that single `term` for both the due-check cycle (`cycleDaysForTerm(term, cfg.cycleDays)`) and the billed amount (`renewalAmountForTerm(term, monthlySum)`). There is no second, independently-read "account's current term" to diverge from it — the two-variable disagreement that caused C2 cannot recur because there is only one variable.

The existing `Math.min(cfg.cycleDays, ANNUAL_CYCLE_DAYS)` pre-filter (added in the prior implementation to bound fetch volume) is retained unchanged — it is correct and unrelated to the bug.

### Fail-open on an unimported field (fixes C4's severity)

The bulk query fetching paid Subscription invoices is the one query that runs for every customer on every sweep. It first attempts `fields` including `billing_term`. If that throws (the shape of a Frappe "unrecognized column" failure), it retries the identical query **without** that field and logs a loud warning naming the fixture file to import. Every account is then treated as monthly for that sweep run — exactly today's live behavior — instead of the sweep failing for the entire book.

This does not replace the standard fixture-import step (see below); it bounds the damage of forgetting it to "annual billing doesn't work yet" rather than "no renewals happen for anyone."

## Migration (fixes C4)

One field, following this codebase's own established pattern (see `backend/data/custom-fields-web-account.json`, documented in `docs/provisioning-go-live.md`):

- Add `backend/data/custom-fields-portal-invoice.json` entry: `Portal Invoice.billing_term`, Select field, options `\nmonthly\nannual`, `insert_after: "amount"`.
- Add a line to `docs/provisioning-go-live.md`'s "what still needs hands-on" section documenting the import command and the fail-open fallback's warning log as what to look for if it's forgotten.

## Checkout flow (fixes C1)

`GET /api/orders/:id` (or the equivalent order-creation response) gains `eligibleForTermChoice: boolean`, computed server-side as: this account has no paid Subscription invoice yet (`!findLatestPaidSubscriptionInvoice(account)`) AND the product being purchased bills monthly (not a domain).

- **`eligibleForTermChoice === false`** — every add-on, every domain, every returning customer: unchanged from today. `prepare-payment` auto-calls on page load; the invoice appears instantly.
- **`eligibleForTermChoice === true`** — a genuinely new customer's first monthly-billed purchase: the checkout page shows the monthly/annual selector with a "Continue to payment" confirmation **before** calling `prepare-payment`. That call happens exactly once, carries the chosen term, and creates the invoice already at the correct amount.

There is no post-hoc invoice correction anywhere in this design. The order (Draft, RAM reservation) is still created the moment the customer lands on the checkout page, exactly as today — only the invoice-creating `prepare-payment` call is deferred, and only for the narrow case where a term choice is actually being made. The existing reservation-TTL countdown UI already covers a customer who pauses on this screen.

This also structurally removes three Important findings from the prior review that existed only because of the post-hoc-correction pattern: picking the wrong open invoice to correct, the corrected invoice missing its own `billing_term`, and the frontend never re-fetching the true charged amount after a correction. None of that machinery exists in this design.

## Add-on pro-rata (fixes C3's consumer side)

`createAddonInvoice` calls `currentBillingTerm(account)` instead of reading a stored `term_started_on`. When the term is `"annual"`, it pro-rates off `anchorDate` (the last paid Subscription invoice's `invoice_date`) using the existing, unchanged `daysRemainingInTerm`/`proRatedAddonKes` arithmetic from `billingTerm.js`. The `422 CORRUPTED_ANNUAL_TERM` guard (stopping a KES-0 invoice for a real, positively-priced service) is retained — with a real invoice date as the anchor instead of a separately-maintained field, the only way to trigger it is genuinely anomalous invoice data, not a routine write-ordering gap, but it remains cheap insurance.

## Structural fix for C5

Nothing in the add-on purchase path writes a term anywhere — it only reads `currentBillingTerm`. Combined with the selector rendering only when `eligibleForTermChoice` is true (first purchase only), there is no code path by which an existing customer's term can change. This is not a UI convention to remember; switching is unbuildable without adding a new write path, which is what "explicitly out of scope" should mean. A future project that wants to support mid-relationship switching adds that write path deliberately, with its own design for how the remainder of the current period is priced.

## Testing

- `currentBillingTerm`: no paid invoice → monthly/null; a paid invoice with `billing_term` absent → monthly (pre-existing-invoice safety); explicit `"annual"`/`"monthly"` → each returned correctly with the invoice's own `invoice_date` as `anchorDate`.
- Renewal sweep: single-`term` due-check-and-amount agreement (the specific case that produced C2 — an invoice recorded one term while a later invoice for the same account recorded another — must resolve consistently, not diverge); the fail-open fallback fires and treats every account as monthly when the bulk query's `billing_term` field throws, verified against a mocked "unrecognized column" error, and does not fire when the query succeeds normally.
- Checkout: `eligibleForTermChoice` is false for every add-on/domain/returning-customer case and true only for a genuine first monthly-billed purchase; a **single** `prepare-payment` call with a chosen annual term produces an invoice at the correct annual amount with no second call and no correction step; the resulting invoice carries `billing_term: "annual"`.
- Add-on pro-rata: an annual account's add-on prices off the real last-paid-invoice date. Note the add-on path (`createAddonInvoice`) is only ever reached when `hasPaidSubscriptionForPlan` is true, which by construction means a paid Subscription invoice exists — so `currentBillingTerm` never returns the no-history case inside this function; that case is exclusively the first-purchase branch's concern. The corrupted-term guard still fires for genuinely anomalous invoice dates (e.g. a future-dated or >365-day-stale `billing_term: "annual"` invoice).
- Regression: every existing account (no Subscription invoice ever recorded a `billing_term`) bills identically to pre-annual-prepay behavior in every path — sweep, add-on, checkout.

## Out of scope (unchanged from the original spec)

- Mid-relationship term switching (now structurally unbuildable without a deliberate new write path — see above).
- Live Hostinger cost lookup / dynamic domain pricing.
- Automated domain registration (B2) and automated refunds (B3).
- RAM ceiling monitoring.
