# Monthly Domain Pricing (Hosting-Bundled) — Design

**Date:** 2026-08-04
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-07-25-domains-databases-design.md` (shipped as PR #3)

## Problem

Domains currently sell at a fixed yearly price (e.g. `.com` at KES 1,500/yr).
In a price-sensitive market, a ~KES 2,000 upfront ask reads very differently
from ~KES 200/month, and effectively no competitor in the Kenyan reseller
space prices domains monthly. That is a real differentiator.

The complication: **domains cannot be registered monthly.** ICANN/registry
minimum is one year, so Murzak pays the registrar a full year upfront while
collecting monthly — financing the customer, not merely repricing.

Break-even, using a ~KES 2,000/yr cost assumption:

| Monthly price | Annualized | Markup | Break-even |
|---|---|---|---|
| KES 200 | 2,400 | 20% | month 10 |
| KES 250 | 3,000 | 50% | month 8 |
| KES 300 | 3,600 | 80% | month 7 |

A customer who pays three months and leaves costs roughly KES 1,250, and the
domain cannot be resold — it is their chosen name.

## Decisions (agreed in brainstorm)

- **Monthly pricing is bundled-only.** Offered exclusively to accounts with an
  active paid hosting plan. The hosting plan's own retention carries the churn
  risk, and the domain becomes a stickiness hook. Standalone buyers keep
  yearly-only.
- **Yearly remains available to everyone**, priced as a discount against
  12× monthly (pulls cash forward, self-selects committed buyers).
- **On cancellation: the domain runs to its registrar paid-through date, then
  lapses.** No exit invoice, no forced conversion, no suspension. Rationale:
  the registrar fee is *sunk* the moment the domain is registered, so an exit
  invoice chases sunk cost from a departing customer — poor collection odds and
  a reputational cost — while letting it run costs Murzak nothing additional
  and leaves the door open for a return.
- **Real wholesale cost is not yet available** (`HOSTINGER_API_TOKEN` is not
  configured). The mechanism is cost-agnostic and gets built now; real
  per-TLD figures are configuration filled in before launch.

## Architecture

### 1. Two catalog products per TLD

`POST /api/orders` prices strictly from `getServiceMeta(serviceId).monthlyKes`
— one static number per catalog id. That constraint is what made the yearly
domain design work, so this follows it rather than fighting it.

Each of the seven TLDs gains a monthly sibling alongside its existing yearly
entry:

| Yearly (exists) | Monthly (new) |
|---|---|
| `domain-coke` | `domain-coke-monthly` |
| `domain-com` | `domain-com-monthly` |
| `domain-ke` | `domain-ke-monthly` |
| `domain-org` | `domain-org-monthly` |
| `domain-net` | `domain-net-monthly` |
| `domain-africa` | `domain-africa-monthly` |
| `domain-io` | `domain-io-monthly` |

Monthly entries share the yearly ones' shape: category
`"Domain Registration"`, `capacityClass: "volume"`,
`resources: { ramMb: 0, diskGb: 0 }`. They are distinguished by a new
`billingPeriod` field (`"monthly"` | `"yearly"`) rather than by id-string
parsing, so downstream consumers never infer billing behavior from a name.

**No order-schema change and no dynamic pricing at checkout.**

### 2. The bundle gate

Monthly variants require an active paid hosting plan. The predicate already
exists: `accountHasNonDomainPaidService()` in
`backend/services/addonEligibility.js`, built to close the add-on bypass.

- **UI**: the Products page offers monthly + yearly when the account
  qualifies, yearly-only when it does not.
- **Server**: `createOrder` rejects a monthly-domain `serviceId` when the
  account lacks qualifying paid hosting. UI hiding is not the enforcement —
  a crafted request must fail too.

### 3. Renewal handling — the risk point

`excludeDomainRegistrations()` in `backend/services/renewalService.js`
currently excludes **all** domain-registration rows from the monthly sweep,
because a yearly price swept monthly is a 12× overcharge.

That filter narrows to exclude only rows whose `billingPeriod` is
`"yearly"`. Monthly domains flow through the sweep normally — their
`monthlyKes` is a genuine monthly price.

**This is the single most dangerous change in the feature.** Getting it wrong
in one direction resurrects the 12× overcharge; wrong in the other, monthly
domains never re-bill. It requires explicit tests for both:
- a yearly domain row is excluded from the sweep sum
- a monthly domain row IS included, at its monthly price
- a mixed account (yearly domain + monthly domain + hosting) sums correctly

### 4. Cancellation — nothing to build

Account cancelled → the sweep already skips cancelled accounts → no further
invoices → the domain runs out the registrar year already paid → lapses at
its natural expiry. This is existing behavior and matches the agreed outcome
exactly. No new code, no new state.

Note: suspension in this codebase is account-level, not per-service, so there
is no "suspend just the domain" path to implement or worry about.

### 5. Below-cost guard

Real wholesale cost is unknown, and there is an open question about whether
the shipped `.com` price (KES 1,500/yr) is already below cost.

Add a per-TLD wholesale cost table, initially unpopulated, plus a catalog test
that **fails** when any TLD's retail falls below its declared cost — checking
both the yearly price and monthly×12. While the table is empty the guard is
inert; the moment real figures are filled in it enforces margin structurally
rather than by memory.

### 6. Display

- Checkout derives its period suffix from `billingPeriod`: `/mo` for monthly,
  `/yr` for yearly. (`isYearlyBilled()` generalizes accordingly.)
- The Products page shows both options side by side for qualifying accounts,
  with the yearly option labelled as the cheaper-per-year choice.

## Provisional pricing

Placeholder monthly figures, **explicitly marked provisional in code** and to
be replaced with markup-on-real-cost before launch:

| TLD | Yearly (shipped) | Monthly (provisional) | Annualized |
|---|---|---|---|
| `.co.ke` | 1,200 | 150 | 1,800 |
| `.com` | 1,500 | 200 | 2,400 |
| `.ke` | 1,800 | 220 | 2,640 |
| `.org` | 1,800 | 220 | 2,640 |
| `.net` | 1,800 | 220 | 2,640 |
| `.africa` | 2,500 | 300 | 3,600 |
| `.io` | 4,500 | 500 | 6,000 |

Each annualizes above its yearly price, so yearly remains the genuine
discount.

## Testing

- **Unit**: catalog resolution for all 14 domain ids; `billingPeriod` correct
  on each; the below-cost guard (with a seeded cost fixture, since the real
  table is empty); the renewal-sweep inclusion/exclusion matrix described in
  §3; `createOrder` rejects monthly-domain purchase without qualifying hosting
  and accepts it with.
- **E2E**: a qualifying account sees both options and can buy monthly; a
  non-qualifying account sees yearly only.

## Out of scope

- Exit invoicing / conversion-to-yearly flows (deliberately excluded, §"On
  cancellation").
- Live Hostinger cost lookup and markup-derived pricing — blocked on
  `HOSTINGER_API_TOKEN`. The user has confirmed the API supports pricing
  calls; wiring it is a separate follow-up.
- Automated domain registration (B2) and automated refunds (B3), still blocked
  on their own external dependencies.
