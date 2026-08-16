# Unified Product-First Checkout — Design

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan

## Problem

Murzak sells several business lines (cloud VMs, BYOA app hosting, business
systems, hosting services), and each has its own purchase flow: the plan-first
configurator on `/pricing`, in-modal payment in `CloudLaunchModal` on `/cloud`,
an upsell step inside `DeployWizard` on `/deploy`, and portal add-on flows. Two
kinds of confusion result:

1. **Product/plan coupling** — buying a product (e.g. app hosting) forces a
   separate "plan" decision whose purpose is unclear to the buyer.
2. **Scattered checkout** — the review-and-pay experience looks and behaves
   differently per line.

## Decisions (agreed in brainstorm)

- **Product-first, plan hidden.** The buyer picks a product and a tier and sees
  one price. Plans (`PLAN_META`) stop being customer-facing for new purchases;
  a tier maps to internal sizing.
- **No cart.** Every purchase is a single-intent flow: configure → checkout →
  pay. Cross-sells happen post-purchase in the portal.
- **One shared `/checkout/:orderId` route.** Configurators never take payment.
- **All lines self-serve**, including CRM/ERP/POS with fixed tiers. SalesModal
  remains alongside for demos/quotes on larger deployments.
- **All choosing happens in the storefront; checkout only confirms and pays.**
  Products with a selectable resource (domain names, database engines) put that
  selection on the product page, and the concrete choice rides in the order
  config. Checkout never asks a configuration question.
- **Capacity is reserved at checkout start**, not merely checked (see Capacity
  gate).

## Catalog taxonomy

Five self-serve lines, each product-first with fixed tiers:

| Line | Storefront | Pre-checkout configuration |
|---|---|---|
| Cloud (VMs/resources) | `/cloud` | region, size, snapshot (existing modal UI) |
| App Hosting (BYOA) | `/deploy` | repo, framework, sizing (existing wizard) |
| Business Systems (CRM/ERP/POS) | `/products/*` | none — pick a tier card |
| Domains | products page | availability search; user picks the exact domain |
| Databases | products page | engine choice (MySQL, PostgreSQL, MongoDB, Redis) + tier |

`frontend/src/config/serviceCatalog.ts` gains a `PRODUCT_CATALOG`. Each
product's tiers carry: `priceKes`, RAM requirement (MB), fulfillment lane id,
display copy, and post-purchase ("what happens next") copy. The backend reads
the same catalog data (shared JSON or a backend mirror — implementation plan
decides) so prices are never trusted from the client.

`/pricing` is reframed as a cross-line tier comparison page rather than a
plan-first configurator. The existing `mode=add-services` portal deep-link
keeps working for current customers until the legacy migration phase.

> **Amended 2026-07-23** by `2026-07-23-two-lane-storefront-design.md`:
> `/pricing` becomes a thin router page to per-lane pricing sections instead
> of a cross-line comparison. See the storefront spec's Pricing decision.

### Domains — dependency note

Today domains are a manual request (`POST /api/hosting/domain-purchase-requests`).
Live availability search requires a registrar lookup API. Until that
integration exists, the products page performs a best-effort check and the
checkout copy states "domain registration confirmed within 24 hours"; the
fulfillment lane remains the existing manual/assisted workflow. The order
model does not change when the registrar API lands — only the lane does.

### Databases — fulfillment note

Database products are fulfilled as one-click databases through the existing
Coolify lane. Each engine is its own catalog product with its own tiers; there
is no generic "database hosting" product.

## Order model (backend)

New `orders` store plus `backend/routes/ordersRoutes.js`:

- `POST /api/orders` — creates a draft order:
  `{ lineType, productId, tier, config, priceKes, status: 'draft', userId,
  reservation }`.
  - Server validates product+tier against the catalog and **computes
    `priceKes` server-side**; the client sends only product, tier, and config.
  - Config is validated per line (e.g. a domain order must carry the chosen
    domain; a database order must carry the engine).
  - **Reserves RAM** (see Capacity gate). If headroom is insufficient the
    request fails with a `capacity` error and the UI offers the waitlist —
    money is never taken for capacity that does not exist.
- `GET /api/orders/:id` — owner-only; feeds the checkout page.
- `POST /api/orders/:id/cancel` — releases the reservation, marks the draft
  cancelled.
- `GET /checkout/new?product=<id>&tier=<tier>` (frontend route backed by
  `POST /api/orders`) — deep-link entry for zero-config products: creates the
  draft server-side and redirects to `/checkout/:orderId`. Products that need
  configuration redirect to their configurator instead.

On payment success (M-Pesa callback or PayPal capture), the order flips to
`paid`, an invoice is generated as a **receipt** (not a pre-purchase
artifact), the RAM reservation converts to a permanent allocation, and the
catalog-designated fulfillment job is enqueued on the existing Provisioning
Job runner. Enqueue is idempotent (the runner's requeue path covers retries).

Draft orders expire after 24 hours (cleanup job); expiry releases any live
reservation.

## Capacity gate — reserve at checkout start

The single KVM 2 host (8 GB RAM) is the hard cap, with an operator-configured
reserve held back for the system itself.

- **Ledger:** one capacity ledger tracks `allocated` (active services) +
  `reserved` (live checkout reservations) against the cap.
- **Reserve on draft:** `POST /api/orders` atomically reserves the tier's RAM
  requirement (transactional update so concurrent checkouts cannot oversell).
- **Reservation TTL:** 30 minutes. The checkout page renews the reservation
  while open (heartbeat on load/poll). A draft order can outlive its
  reservation; re-opening checkout re-reserves (and can fail with the same
  `capacity` error if headroom is gone).
- **Release:** on cancel, TTL expiry, or terminal payment failure.
- **Convert:** on payment success the reservation becomes a permanent
  allocation; fulfillment consumes it.
- **Waitlist:** a `capacity` failure offers a waitlist entry
  (product + tier + contact); operators are notified when headroom returns.

## Checkout page (frontend)

New auth-guarded route `/checkout/:orderId` (login round-trips back):

1. **Order summary** — in the line's own language ("Murzak CRM — Growth,
   10 users"; "yourdomain.co.ke — 1 year"), rendered from catalog copy plus
   order config. No configuration controls.
2. **What happens after payment** — per-lane copy ("your CRM will be live at
   yourname.murzak.app within ~10 min"; "domain registration confirmed within
   24 hours").
3. **Payment methods** — the M-Pesa/card/PayPal section extracted from
   `frontend/src/pages/Payment.tsx` into a shared `<PaymentMethods>` component
   used by both the legacy invoice page and the new checkout page.
4. A visible reservation timer ("we're holding your spot for 30 minutes") when
   the order carries a RAM reservation.

## Per-flow refactors

- **CloudLaunchModal** — becomes config-only; "Launch" creates an order and
  navigates to `/checkout/:orderId`. In-modal payment and the direct
  `/api/addons/invoice/create` call are removed.
- **DeployWizard** — `ConfigAndUpsellStep` ends by creating an order →
  `/checkout/:orderId`; the build starts on payment and `BuildProgressStep`
  reads job status keyed by the order.
- **Business systems pages** — tier cards link to
  `/checkout/new?product=…&tier=…`; SalesModal stays for demo/quote.
- **Domains & databases** — new product-page sections with their selection UIs
  (domain search, engine picker) feeding order config.
- **Legacy** — `/payment/:invoiceDocName` survives for existing invoices,
  renewals, and portal add-ons. Migrating those onto orders is a later phase,
  explicitly out of scope here.

## Error handling

- Server-side price computation and per-line config validation on order
  creation (no client-trusted pricing; this class of bug already bit once with
  the snapshot-tier authz fix).
- Reservation races resolved by transactional ledger updates.
- Payment initiated after reservation expiry: payment endpoints verify a live
  reservation (re-reserving if headroom allows) before charging.
- Fulfillment enqueue is idempotent; a paid order whose fulfillment cannot
  proceed is surfaced to operators for manual resolution/refund.
- Expired-draft cleanup releases reservations.

## Testing

- **Unit:** order creation (pricing computed server-side, tier validation,
  per-line config validation, owner-only reads), capacity ledger
  (reserve/release/convert, concurrent reserve race, TTL expiry).
- **E2E (Playwright, extending the existing QA suite):** one happy path per
  line — configure in storefront → `/checkout/:orderId` renders the right
  summary → mocked payment → order `paid` → correct fulfillment job enqueued.
  Plus: capacity-exhausted path shows waitlist; reservation timer visible;
  deep-link `/checkout/new` works for a zero-config product.

## Rollout order

1. Catalog (`PRODUCT_CATALOG`) + orders API + capacity ledger + `/checkout`
   page with `<PaymentMethods>` extraction.
2. Rewire Cloud (smallest surface) — CloudLaunchModal → orders.
3. Rewire DeployWizard.
4. Business systems tier cards + deep-link entry.
5. Domains + databases product-page sections.
6. (Later phase, separate spec) migrate portal add-ons/renewals onto orders.
