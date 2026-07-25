# Domains & Databases as Product Lines — Design

**Date:** 2026-07-25
**Status:** Approved design, pending implementation plan
**Implements:** phase 5 of `docs/superpowers/plans/2026-07-23-unified-checkout-phase1.md`'s
Follow-ups ("Domains + databases product-page sections"), per
`docs/superpowers/specs/2026-07-23-unified-checkout-design.md` and
`docs/superpowers/specs/2026-07-23-two-lane-storefront-design.md`.

## Problem

The storefront design says domains and databases should be their own product
lines: the user picks the exact domain name or database engine on the
products page, and checkout only confirms and pays — no configuration
questions at checkout. Today:

- **Databases** are already self-serve-purchasable (`Database Hosting` is one
  of the four `CLOUD_LAUNCH_CATEGORIES` `CloudLaunchModal` sells), but the
  catalog has only two generic products ("Shared" and "MongoDB") — not the
  per-engine choice the storefront spec calls for.
- **Domains** have no purchasable product at all. They exist only as a
  `domainChoice` field attached to *other* purchases (website hosting, app
  hosting), fulfilled by a manual request flow
  (`POST /api/hosting/domain-purchase-requests`).

This makes the two halves of this feature very different in size: databases
is a storefront/catalog change reusing the existing checkout pipeline;
domains needs a genuinely new product type — live availability search,
registrant (WHOIS) contact collection, real registrar transactions, and a
money-safety net if a paid-for domain fails to register.

## Section A — Databases

### Catalog change

Retire the two generic `Database Hosting` catalog entries. Add four
per-engine products, same tier shape/pricing class as today's
(`capacityClass: "volume"`, ~KES 2,000/mo, `resources: { ramMb: 768,
diskGb: 10 }`, fulfilled through the existing Coolify lane):

- `db-mysql` — MySQL
- `db-postgres` — PostgreSQL
- `db-mongo` — MongoDB
- `db-redis` — Redis

No new fulfillment lane, no new order mechanics — `capacityClass: "volume"`
services already flow through the phase-1 checkout (`/checkout/new?serviceId=`
→ `/checkout/:orderId` → existing payment rails).

### Storefront change

Products page gains a "Databases" section: one card per engine, each linking
to `/checkout/new?serviceId=<engine-id>`. No engine-picker UI is needed at
checkout — the product page IS the picker, matching the storefront spec's
"all choosing happens in the storefront" rule.

## Section B — Domains

Three sub-phases, increasing in risk. Each ships working, testable software
before the next begins; B3 (the money-touching piece) lands last.

### B1 — Live availability search

- New backend secret: `HOSTINGER_API_TOKEN` (generated in Hostinger's hPanel,
  tied to Murzak's own Hostinger account — not a separate paid third-party
  API). Never exposed to the client; all calls are server-side, preserving
  the white-label rule.
- Server-side integration with Hostinger's `checkDomainAvailabilityV1`
  endpoint (rate limit: 10 requests/minute — the backend debounces domain
  search input and never proxies raw client keystrokes 1:1 to Hostinger).
- **Curated TLD allow-list** for this first pass: `.com`, `.co.ke`, `.org`,
  `.net`, `.info`, `.africa`. Search only offers these TLDs, not Hostinger's
  full catalog — bounds support load and pricing complexity. Extending the
  list later is a catalog-only change.
- **Pricing**: fetched live from Hostinger per TLD at search time, marked up
  by a flat **30%** and rounded to a clean KES figure. Reuses the existing
  `monthlyKes` order/catalog field (per the phase-1 pricing-shape decision)
  but displayed as "**/yr**" wherever domain products render — no schema
  change anywhere in the catalog, orders API, or checkout page.
- **Fallback**: if the Hostinger call fails or times out, the product page
  does not block the buyer — it falls back to the phase-1-anticipated
  behavior: accept a well-formed domain name, and checkout copy reads
  "availability confirmed within 24 hours" instead of showing a live
  price/status.

### B2 — Registrant details + automated registration

- The domain product page collects ICANN-required WHOIS registrant details
  (name, email, phone, physical address) before the buyer proceeds to
  checkout. This rides in the order's `config` object, the same way
  `domainChoice` does for other services today.
- **The buyer is the legal registrant of record.** Murzak relays the
  submitted details to Hostinger's registration API and never holds
  ownership or acts as a privacy/proxy registrant.
- On payment success, the backend calls Hostinger's domain-registration API
  with the order's domain name and registrant details, then transitions the
  order/service to active on success.

### B3 — Payment-safety net for registration failure

If registration fails after payment succeeds (domain taken in the interim,
Hostinger API error, registrant-detail rejection):

1. The order flips to a `RegistrationFailed` state.
2. The original charge is **automatically refunded**:
   - **PayPal**: a real refund-API call (new call against an existing
     capability class — PayPal already supports refunds, this codebase just
     hasn't called that endpoint before).
   - **M-Pesa**: no reversal path exists today (the current integration only
     handles STK push + callback). This requires a **new Safaricom B2C
     (business-to-customer) integration** — separate credentials (initiator
     name, security credential, B2C shortcode) from the existing STK-push
     setup.
3. The customer is notified with the failure reason; an internal ops alert
   fires in parallel.

**This is new infrastructure, not reuse, and is the highest-risk piece of
this feature** — it is the only part of the whole phase-1/phase-5 checkout
work that moves money back out automatically. Treat it with the same care as
the payment-in rails: fail closed, verify every amount, log every attempt.

**Go-live dependency**: the M-Pesa B2C credentials are a distinct Safaricom
API product from the existing STK-push credentials and must be separately
provisioned with Safaricom before B3 can go live in any environment — an
explicit blocker, the same way the phase-1 checkout plan flagged the
`Checkout Order` Frappe doctype as a manual per-environment setup step.

## Testing

- **Unit (backend)**: TLD allow-list enforcement, markup calculation and KES
  rounding, Hostinger-call fallback behavior (search proceeds in
  format-only mode on API failure), registrant-detail validation, the
  `RegistrationFailed` → refund state transition (mocked PayPal/M-Pesa
  responses, including a refund-attempt failure — that case must alert
  ops loudly rather than silently drop the failure).
- **Integration**: end-to-end order flow through B1→B2 with a mocked
  Hostinger client, proving the price shown at search time matches the
  price actually charged at payment time (no drift between quote and
  charge).
- **E2E (Playwright)**: database engine card → checkout → pay (mirrors the
  existing Cloud happy-path pattern); domain search → registrant form →
  checkout → pay, with a mocked capacity/availability response.

## Rollout order

A (Databases) → B1 (live search) → B2 (automated registration) → B3
(refund safety net). Each phase is independently shippable and testable;
nothing in A or B1 depends on B2/B3 existing.

**Implementation-plan scoping note**: A and B1 have no external blockers and
can be planned and built now. B2 (automated registration) is gated on
confirming Hostinger's domain-check/registration API cost and quota terms
with their support (unconfirmed as of this spec — see Section B1). B3
(refund safety net) is additionally gated on provisioning M-Pesa B2C
credentials with Safaricom, a separate request from the existing STK-push
setup. The accompanying implementation plan should therefore cover A and B1
in full; B2 and B3 should get their own plan(s) once those external
dependencies are confirmed, rather than being planned against unconfirmed
assumptions.
