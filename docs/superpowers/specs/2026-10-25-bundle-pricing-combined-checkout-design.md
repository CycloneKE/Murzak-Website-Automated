# Bundle Pricing and Combined Checkout — Design

**Date:** 2026-10-25
**Status:** Revised 2026-10-25 after owner review (savings approved, 14-day
window approved, databases excluded, capacity figures corrected). No code
written. Amends `2026-07-23-unified-checkout-design.md` ("No cart") in one
narrow way, see Decisions.

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

- A general shopping cart. Combined orders stay capped at one primary plus a
  few companions.
- A discount engine, coupon codes, or per-customer pricing.
- Changing capacity, adding servers, or the self-serve RAM cap itself.
- Changing how any single product is provisioned.

## Anti-goals

- Selling a combination the box cannot host. A combo that fails after payment
  is worse than not offering it. Because the fleet holds only about five bench
  tenants, the picker must reflect live headroom.
- Checkout asking configuration questions. All choosing still happens in the
  storefront; checkout confirms and pays.
- Discounting bench or container tenants. The bundle saving comes only out of
  zero-RAM items, where our marginal cost is near nothing.

## Constraints (from the code today)

- Orders are single-service. `prepare-payment` already builds
  `createAddonInvoice({ services: [serviceRow] })`, an array, so extending to
  several rows on one invoice is a small step. `mergeIntoOpenInvoice` must stay
  `false`: one order, one invoice, one quoted total.
- **Capacity is charged by effective footprint, not the advertised spec.**
  ERP, CRM and POS tiers are bench-lane tenants (`capacityClass: premium` with
  `benchApps`). They advertise 2 GB on the product page but are charged
  `benchTenantRamMb` = 480 MB and 1 GB disk against the box
  (`effectiveFootprint`, used by both `orderCapacity.js` and the frontend
  `sumFootprint`). The advertised spec stays honest for customers; the gate
  charges what the box really loses. *An earlier draft of this document treated
  them as 2048 MB each and concluded ERP + POS could never share an order. That
  was wrong.* ERP + POS is 960 MB, ERP + POS + CRM is 1,440 MB, both under the
  self-serve per-order cap (frontend constant 2048 MB; backend
  `SELF_SERVE_ORDER_RAM_CAP_MB` env-configurable).
- Per-order cap is not the binding limit; **fleet headroom is.** `sellableRamMb`
  is 3000 MB with an 85% auto-commit threshold (about 2,550 MB), so the box
  holds roughly five bench tenants in total across all customers. Zero-RAM
  items (domains, Business Email, storage) add nothing.
- Container-lane items (databases 768 MB, app hosting 1024 MB) are still
  charged at their declared footprint.
- One live shop per app per account, and the shop address is reserved against
  the order.
- Annual prepay (20% off) is only offered to first-purchase, plan-less
  customers (`isEligibleForTermChoice`). Add-on purchases are never eligible
  and are billed monthly with pro-rating. This design keeps that rule.
- Prices are computed server-side from the catalog and never trusted from the
  client.

## Decisions

1. **Companions, not a cart.** An order has one *primary* product and up to
   three *companions*. Allowed companions: zero-RAM catalog items (domains,
   Business Email, storage), and **one other business app** (ERP, CRM or POS
   tier) when its effective footprint fits under the per-order cap and fleet
   headroom. **Databases are not allowed as companions** (owner decision):
   they are charged at 768 MB each and the box cannot spare it. App hosting
   and other container-lane items are also excluded. One live shop per app per
   account still applies. *This is the single amendment to the 2026-07-23
   spec.*
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
   Approved by the owner as acceptable margin. A cross-app saving (for
   example ERP + POS together) is out of scope for now.
   Savings show as a negative line on the checkout summary, never hidden
   inside a changed unit price.
5. **Billing term.** Companions follow the primary's term when the primary is
   offered annual (they are included in the 20% annual calculation as one
   order); otherwise monthly. Domain registration keeps its own pricing rule
   from `2026-08-04-monthly-domain-pricing-design.md`.
6. **Post-purchase cards.** The welcome screen and the portal Overview show
   "Complete your setup" cards for companions the buyer skipped, using the
   same catalog table. These go through the existing Add-ons invoice path,
   so no new payment flow is needed. **The bundle saving stays available for
   14 days after the primary's payment** (owner decision), so skipping at
   checkout is not a penalty. The window is measured from the primary order's
   paid time, stored on the order, and checked server-side when the add-on
   invoice is created; after it lapses the item is sold at full price.
7. **Capacity.** The order's reservation is the sum of primary and companion
   *effective* footprints (`effectiveFootprint`), checked against both the
   per-order cap and fleet headroom, before any payment is taken. A companion
   that would push the order over either limit is shown disabled with the
   reason, not hidden. Storefront copy keeps the honest advertised specs.

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
- Risks: a customer buying a second app consumes scarce fleet headroom (see
  open question 1); partial fulfilment (one line provisions, another fails), pro-rating
  of companions bought later, and domain pricing interacting with the saving.
  Each needs a test: partial-failure job state, add-on invoice amount with and
  without the saving window, and the domain-at-cost case.

## Open questions

1. Should a second business app be a companion at all, or only zero-RAM items?
   This revision allows it (it fits by effective footprint), but with roughly
   five bench tenants of fleet headroom, a combined ERP + POS sale consumes
   two of them. The owner may prefer to keep this off until capacity grows.
2. Is the live headroom check at picker time good enough, or should the
   storefront also show a plain "limited availability" notice as the fleet
   fills?

## Left to the builder

Component naming and layout, exact pairing-table storage format, test layout,
and the flag mechanism.
