# Billing Term & Price Display — Design

**Date:** 2026-08-04
**Status:** Approved design, pending implementation plan
**Supersedes:** `2026-08-04-monthly-domain-pricing-design.md` (see note there)
**Builds on:** `2026-07-25-domains-databases-design.md` (shipped as PR #3)

## Problem

Two related pricing goals:

1. **Domains look expensive.** A `.com` shows as KES 1,500/yr. The same price
   framed as KES 125/mo reads far cheaper to a price-sensitive buyer, and
   costs nothing to offer — the billing does not have to change, only the
   presentation.
2. **Hosting has no annual option.** Every hosting customer pays monthly,
   which means Murzak carries the upstream server cost with no cash pulled
   forward. An annual prepay option with a real discount improves cash flow
   materially and increases retention (a prepaid year cannot churn in month 3).

## Key finding that shaped this design

**Hosting products are genuinely billed monthly** — `renewalService.sweepRenewals`
bills `sumSelectedServicesMonthlyKes` every `RENEWAL_CYCLE_DAYS` (30). So "/mo"
is already literally true for hosting and needs no display change.

**Only domains are yearly-billed.** They are the sole place a *derived* monthly
figure applies. This splits the work cleanly into a display-only change
(domains) and a billing change (hosting).

## Part A — Domain monthly-equivalent display

**No billing change whatsoever.** Same yearly charge, same catalog products,
same renewal exclusion. Presentation only.

- New helper in `frontend/src/config/serviceCatalog.ts`:
  ```ts
  export function monthlyEquivalentKes(yearlyKes: number): number {
    return Math.ceil(yearlyKes / 12);
  }
  ```
  `Math.ceil` so the displayed monthly figure never *understates* the price.
  Only `.africa` is non-exact (2,500 ÷ 12 = 208.33 → 209).
- Applies **only** to products with category `"Domain Registration"`.
- **Display format** (both sites): monthly figure prominent, annual total
  directly beneath in muted text:
  > **KES 125/mo**
  > billed annually at KES 1,500
- **Sites**: `frontend/src/components/DomainSearch.tsx` (Products page search
  results, currently renders `formatKes(r.priceKes)}/yr`) and
  `frontend/src/pages/Checkout.tsx` (order summary), so the framing is
  identical while browsing and at the moment of payment — no surprise between
  the two.

**Disclosure is deliberate, not incidental.** The annual total is shown
alongside the monthly figure everywhere the monthly figure appears. A bare
"KES 125/mo" that only reveals KES 1,500 at payment would be a misleading
price representation under Kenya's Consumer Protection Act 2012, and in
practice drives chargebacks and refund demands that cost more than the
conversions it wins.

### Part A testing

- Unit: `monthlyEquivalentKes` — exact cases, the `.africa` rounding case, and
  a property check that for every TLD `monthlyEquivalent × 12 >= yearlyPrice`
  (never understates).
- E2E: a domain search result renders both the monthly figure and the annual
  disclosure.

## Part B — Annual prepay for hosting

### Billing term lives on the account, not the product

`sweepRenewals` already operates at **account-level cadence** — it finds the
account's latest paid Subscription invoice and bills all services when that
invoice ages past the cycle. Billing term is therefore modelled as a property
of the account:

- **`billing_term`** on the Web Account doctype: `"monthly" | "annual"`,
  **defaulting to `"monthly"`**.
- Existing customers default to monthly → **zero behavior change, no
  migration**.

This deliberately avoids the alternative (a per-product annual variant, e.g.
`starter-web-hosting-annual`), because that would put a *yearly* figure in a
field named `monthlyKes` — precisely the pattern that caused the 12×
domain-overcharge bug fixed in PR #3.

### Pricing

Annual prepay is **20% off** the annualized monthly sum, charged upfront:

```
annualKes = round(monthlySum × 12 × 0.8)
```

Worked example: a KES 2,500/mo service → 30,000/yr at full price →
**KES 24,000/yr** on annual term.

### Renewal sweep becomes term-aware

| Account term | Cycle | Amount billed |
|---|---|---|
| `monthly` (default) | 30 days (`RENEWAL_CYCLE_DAYS`) | `sumSelectedServicesMonthlyKes` |
| `annual` | 365 days | `monthlySum × 12 × 0.8` |

Domain-registration rows stay excluded from the sweep entirely, exactly as
shipped in PR #3 — unchanged by this work.

**THE critical safety property:** an annually-prepaid account must **never** be
billed by the 30-day path. That is a double-charge — the inverse of the domain
bug, and the highest-risk failure mode in this design. It requires explicit
tests in both directions:

- an `annual`-term account is NOT billed at 30 days
- an `annual`-term account IS billed at 365 days, at the discounted amount
- a `monthly`-term account is billed at 30 days at the undiscounted amount
  (no regression)
- an account with no `billing_term` set (all existing customers) behaves
  exactly as `monthly`

### Mid-term add-ons are pro-rated

A customer on annual term who buys an add-on partway through the term pays
only for the remainder, so the whole account keeps renewing on one
anniversary:

```
proRatedKes = round(addonMonthlyKes × 12 × 0.8 × (daysRemainingInTerm / 365))
```

Keeping one anniversary per account is what allows the account-level cadence
to stay simple; per-service renewal dates would force the per-service period
tracking this design exists to avoid.

### Checkout

The hosting checkout flow offers the term choice — monthly at today's price,
or annual at the discounted rate — with both totals shown so the saving is
explicit.

### Part B testing

- Unit: the term-aware cycle/amount matrix above (all four rows); the annual
  discount calculation; the pro-rata calculation including boundaries (day 1
  of term, final day of term).
- Integration: an annual-term account run through `sweepRenewals` at day 30,
  day 200, and day 366 — billed only at 366.
- E2E: checkout presents both terms with correct totals; selecting annual
  produces an invoice at the discounted amount.

## Out of scope

- **Switching an existing customer's term mid-relationship** (monthly → annual
  upgrade, or annual → monthly downgrade) and any associated refund or credit
  logic. New purchases choose a term; changing it later is a separate project.
- Live Hostinger cost lookup and markup-derived domain pricing — still blocked
  on `HOSTINGER_API_TOKEN` not being configured.
- Automated domain registration (B2) and automated refunds (B3), still blocked
  on their own external dependencies.
- RAM ceiling monitoring and upgrade prompts — a separate feature, to be
  brainstormed on its own. Note that actual-consumption telemetry does not
  exist today (the Coolify adapter sets resource limits but never reads usage);
  only *allocated* ceilings are currently knowable.

## Build order

Part A first — small, self-contained, zero billing risk, ships fast. Part B
second, as its own task sequence with full review, since it touches the
billing core.
