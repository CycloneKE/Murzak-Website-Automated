# Bundle Pricing and Combined Checkout — Design

**Date:** 2026-10-25
**Status:** Draft for review (no code written). Amends
`2026-07-23-unified-checkout-design.md` ("No cart") in one narrow way, see
Decisions.

## Problem

A new customer who buys one Murzak product almost always needs a second thing
to make it useful: a POS shop wants its own domain and a mailbox, an ERP wants
a domain and a database. Today:

- `POST /api/orders` accepts a single `serviceId`. Every order is one product.
- Combining only happens after purchase, in the portal (Add-ons modal, Domains
  tab), where the customer must find those screens themselves.
- The post-payment screens (`AppWelcome`, `ThankYou`) offer no next product.
- Product pages never mention companion products.
- Prices are independent per line; there is no reason to buy two things from
  us in one sitting.

Result: customers who would buy two things buy one, or buy the second from a
registrar or mail provider elsewhere.

## Goals

- A buyer can add a small number of **low-footprint companions** to the product
  they are buying and pay once.
- The storefront shows which companions go with which product, and what the
  bundle saves.
- The portal and welcome screens surface the same companions after purchase,
  for the buyers who skipped them.
- Combined orders can never oversell the host.

## Non-goals

- A general shopping cart or multi-heavy-product orders (ERP + POS, two apps).
- A discount engine, coupon codes, or per-customer pricing.
- Changing capacity, adding servers, or the self-serve RAM cap itself.
- Changing how any single product is provisioned.

## Anti-goals

- Selling a combination the box cannot host. A combo that fails after payment
  is worse than not offering it.
- Checkout asking configuration questions. All choosing still happens in the
  storefront; checkout confirms and pays.
- Discounting RAM-heavy items. The bundle saving comes only out of
  zero-RAM items, where our marginal cost is near nothing.

## Constraints (from the code today)

- Orders are single-service. `prepare-payment` already builds
  `createAddonInvoice({ services: [serviceRow] })`, an array, so extending to
  several rows on one invoice is a small step. `mergeIntoOpenInvoice` must stay
  `false`: one order, one invoice, one quoted total.
- Per-order cap: `SELF_SERVE_ORDER_RAM_CAP_MB` (3200 MB). ERP and POS are each
  2048 MB, so the heavy pair can never share an order. Zero-RAM items
  (domains, Business Email, storage, `ramMb: 0`) add nothing to it.
- One live shop per app per account, and the shop address is reserved against
  the order.
- Annual prepay (20% off) is only offered to first-purchase, plan-less
  customers (`isEligibleForTermChoice`). Add-on purchases are never eligible
  and are billed monthly with pro-rating. This design keeps that rule.
- Prices are computed server-side from the catalog and never trusted from the
  client.

## Decisions

1. **Companions, not a cart.** An order has one *primary* product and up to
   three *companions*. Companions are limited to catalog items whose
   `resources.ramMb` is 0, plus at most one database of the existing 768 MB
   engines when the primary leaves room under the per-order cap. This keeps
   "no cart" intact for anything heavy. *This is the single amendment to the
   2026-07-23 spec.*
2. **Companions are chosen on the storefront**, on the primary product's page
   and on the product's pre-checkout step, as an "Add to your order" row with
   checkboxes. Checkout only displays them and lets the buyer remove one.
   Nothing new is configured at checkout. Domains are searched and picked on
   the storefront as today, and the chosen name rides in the order config.
3. **One order, one invoice, one payment.** Companion rows are extra service
   rows on the same invoice. The invoice stays a receipt written at payment
   time.
4. **Bundle pricing is a fixed saving on specific pairings**, defined in a
   small catalog table, not a rules engine. Shape:
   `{ primaryIds: [...], companionId, savingKes | savingPct }`. Starting
   proposal (all numbers are tunable and are my guesses, not agreed):
   - POS (any tier) + Business Email (Starter): first month of email free.
   - POS or ERP + one domain: domain registration at cost (no margin).
   - Any primary + database: setup fee (KES 500) waived.
   Savings show as a negative line on the checkout summary, never hidden
   inside a changed unit price.
5. **Billing term.** Companions follow the primary's term when the primary is
   offered annual (they are included in the 20% annual calculation as one
   order); otherwise monthly. Domain registration keeps its own pricing rule
   from `2026-08-04-monthly-domain-pricing-design.md`.
6. **Post-purchase cards.** The welcome screen and the portal Overview show
   "Complete your setup" cards for companions the buyer skipped, using the
   same catalog table. These go through the existing Add-ons invoice path,
   so no new payment flow is needed. The bundle saving applies for 14 days
   after the primary's payment (proposal), so skipping at checkout is not a
   penalty.
7. **Capacity.** The order's reservation is the sum of primary and companion
   footprints (`effectiveFootprint`), checked against both the per-order cap
   and fleet headroom, before any payment is taken. A companion that would
   push the order over either limit is shown disabled with the reason, not
   hidden.

## Backend changes

- `POST /api/orders` accepts `companions: string[]` (service ids). It
  validates each against the allowed-companion rule (Decision 1), the pairing
  table, and `assertOrderWithinCapacity([primary, ...companions])`. Unknown or
  disallowed ids return 422 and nothing is reserved.
- The order record stores companion lines and a computed `bundleSavingKes`.
  `totalDueKes` is server-computed from the lines minus the saving.
- `prepare-payment` builds one `serviceRow` per line and passes the array to
  `createAddonInvoice`; Web Account service rows are attached for each line
  (the same attach step the single-service path already does).
- Fulfilment enqueues one provisioning job per line. A companion failing does
  not roll back the primary; the job runner's existing requeue handles it, and
  the portal shows the companion as "setting up". If a domain cannot be
  registered the existing manual-lane fallback applies.
- Cancel and expiry release the whole reservation.
- Pairing table lives with the catalog and is mirrored to the backend the same
  way the catalog snapshot already is.

## Frontend changes

- A shared `CompanionPicker` component on `/products/pos`, `/products/erp`,
  `/products/crm`, `/cloud` and `/deploy`, driven by the pairing table.
- `Checkout.tsx` summary lists primary, companions, saving and total, with a
  remove control per companion.
- `AppWelcome`, `ThankYou` and portal Overview get "Complete your setup" cards.
- Product pages show the bundle saving next to the price.

## Rollout and risk

- Ship behind a flag. Order shape is backward compatible: no `companions`
  field means today's behaviour.
- Risks: partial fulfilment (one line provisions, another fails), pro-rating
  of companions bought later, and domain pricing interacting with the saving.
  Each needs a test: partial-failure job state, add-on invoice amount with and
  without the saving window, and the domain-at-cost case.

## Open questions (need the owner's call)

1. Are the starting savings in Decision 4 acceptable margin-wise, or should
   email and domain be sold at full price with only the setup-fee waiver?
2. Is the 14-day post-purchase saving window wanted, or should the saving only
   apply at checkout?
3. Should one 768 MB database be allowed as a companion at all, given the
   current free-RAM gap, or restrict companions to strictly zero-RAM items
   until capacity is resolved?

## Left to the builder

Component naming and layout, exact pairing-table storage format, test layout,
and the flag mechanism.
