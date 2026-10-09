# App checkout (SaaS apps, POS first): design

- **Status:** approved in brainstorming, 2026-10-09. Awaiting spec review.
- **Builds on:** `2026-07-23-unified-checkout-design.md` (shared `/checkout/:orderId`, RAM reserved at checkout start) and the per-shop POS deploy of 2026-10-08 (`<slug>.pos.murzaktech.tech` → `<slug>.erp.murzaktech.tech`, `deploy/vps/nginx/pos-tenants-wildcard`).

## Problem

Business apps such as Murzak POS are sold through the hosting configurator (`PlanServicesModal`). Clicking "Start from KES 4,500/mo" on the POS page opens a plan modal with RAM and disk meters, add-on services and a domain step. A shop owner is being sold server space instead of a POS. On top of that:

- there is no tier choice;
- the buyer must sign in **before** reaching checkout (`RequireAuth`), which sends a new buyer off to the login page;
- the shop's address is derived from the account ID (`user-26-…​.pos.murzaktech.tech`).

## Market benchmark (summary)

| Pattern | Examples | Taken |
|---|---|---|
| Price by shop or business size, never by server resources; extra tills free | Shopify POS Pro (per location), Square for Retail (per location, registers free), Uzapoint (KES 1.5–4k per till) | Yes: size tiers |
| Named tiers with plain limits (outlets, users, products) | SokoniPOS "Duka" KES 1,500 (1 outlet, 3 users, 500 products), Lightspeed Basic/Core/Plus | Yes |
| Free trial before paying | Loyverse, Zoho (14 days), Olickhom (30 days) | **No.** Each shop is a ~2 GB private site and the box has ~3.5 GB free. Pay now with a 14-day money-back promise instead. |
| Monthly/annual toggle with annual discount | Shopify, Zoho, Loyverse | Yes: annual = 10 × monthly |
| No setup fee for self-serve | All of the above | Yes |

## Decisions

1. **Customers pay for business-size tiers.** Every tier is one private site, the same as today. Tiers reflect value to the customer, not cost to Murzak, so an upgrade is a billing change only.
2. **Pay now, 14-day money-back, no free trial.**
3. **One generic app checkout, catalog-driven.** POS ships first; ERP, CRM, Accounting and HR & Payroll adopt it later through data alone.
4. **Approach A:** a dedicated app pricing block plus a `/get/:app` setup page, reusing the existing `/checkout/:orderId` for payment. No modal.
5. **A customer with an existing shop chooses:** upgrade that shop, or open a new separate shop.

## 1. Tiers and catalog data

POS tiers (`biz-pos-inventory`):

| | Duka | Biashara (most popular) | Chain |
|---|---|---|---|
| Branches | 1 | up to 3 | unlimited |
| Staff logins | 3 | 10 | unlimited |
| Products | 1,000 | unlimited | unlimited |
| Extras | M-Pesa, receipts, stock, reports | + purchase orders, loyalty, stock transfers | + multi-branch reports, priority support |
| Monthly | KES 2,500 | KES 4,500 | KES 8,500 |
| Annual | KES 25,000 | KES 45,000 | KES 85,000 |
| Setup fee | 0 | 0 | 0 |

- **Limits are soft in v1.** The POS does not block, the portal shows an over-limit upgrade prompt, and Murzak monitors usage.
- **Resources:** every tier uses the existing `resources: { ramMb: 2048, diskGb: 25 }` and `benchApps`.

**Catalog shape** (`frontend/src/config/serviceCatalog.ts`, mirrored in `backend/data/serviceCatalogSnapshot.json`):

```ts
interface AppTier {
  id: string;                 // "duka" | "biashara" | "chain"
  name: string;
  tagline: string;
  monthlyKes: number;
  annualKes: number;
  limits: { branches: number | null; users: number | null; products: number | null }; // null = unlimited
  highlights: string[];
  featured?: boolean;
}

interface AppCheckout {
  slug: string;               // route segment: /get/pos
  productName: string;        // "Murzak POS"
  addressSuffix: string;      // "pos.murzaktech.tech"
  afterPayment: string;       // one line shown on the welcome screen
}

// on ServiceItem:
appCheckout?: AppCheckout;
tiers?: AppTier[];
```

The **server** prices every app order from `serviceId + tierId + billingTerm` using the snapshot. Any amount sent by the browser is ignored.

## 2. Buyer flow

There are four screens and no modals. On a phone, each is a single column with a sticky bottom action.

1. **App product page** (`frontend/src/pages/products/MurzakPOS.tsx`)
   - The hero button becomes **"See plans"** and scrolls to the `AppPlans` block on the same page.
   - A Monthly | Annual toggle sits above the cards. Monthly is the default; Annual carries a "2 months free" badge.
   - Biashara is marked "Most popular". Each card has one button, e.g. "Start with Biashara", linking to `/get/pos?tier=biashara&term=monthly`.
   - The POS page no longer links to `/pricing?configure=`.
2. **`/get/:app` "Set up your shop"** (public route; not wrapped in `RequireAuth`)
   - **Shop name:** a live preview of `<slug>.pos.murzaktech.tech`, a debounced availability check, and suggestions when the name is taken.
   - **Your details:** one line if signed in ("Signed in as … · not you?"). Otherwise name, email, M-Pesa phone and password. The account is created on continue. "Already have an account? Sign in" happens inline, keeping everything entered.
   - **Existing-shop choice:** shown when the signed-in account already has an active shop for this app (see section 4).
   - **Summary:** sticky on the right on desktop, collapsed to one line at the top on a phone. It shows the tier with an in-place **Change**, the term toggle and the total, plus a trust row: *14-day money-back · Cancel anytime · Pay with M-Pesa*.
   - **Button:** "Continue to payment · KES {total}". When there's no capacity it becomes "Join the waitlist" instead, before any payment.
3. **`/checkout/:orderId`** (existing page)
   - M-Pesa is preselected, with the phone number from step 2 prefilled; PayPal is unchanged.
   - App orders show an app summary ("Murzak POS · Biashara · mamanjeri.pos.murzaktech.tech") instead of a services list.
4. **`/welcome/:orderId` "Your shop is getting ready"**
   - A live checklist driven by the real provisioning job: Payment received → Creating your private POS → Setting up your owner account → Ready.
   - When ready: the POS address, the owner email, the password (reveal and copy, reusing `PosLoginPanel`), and **Open your POS**. A note says shop details, branches and products are set up on first sign-in.
   - If setup runs past the expected time, the page says so honestly and offers support.
   - The same details remain on the portal resource page.

## 3. Components and data flow

**Frontend**

| Unit | Responsibility |
|---|---|
| `AppPlans` | Tier cards and term toggle, rendered from `tiers`. Reused on any app page. |
| `AppSetup` (route `/get/:app`) | Shop name, details, existing-shop choice and summary; creates the order. |
| `ShopAddressField` | Name → slug preview, debounced availability check, suggestions. |
| `InlineAccount` | Sign up or sign in in place, using the existing `/api/auth` endpoints. |
| `AppWelcome` (route `/welcome/:orderId`) | Polls the order's provisioning job and renders the checklist, then the credentials. |

**Backend**

1. **`Tenant Slug` doctype** (new, Frappe)
   - `name` is the slug, so uniqueness is enforced by the database.
   - Fields: `app`, `web_account`, `status` (`reserved` | `active` | `released`), `order`, `expires_at`.
   - A slug is reserved on order creation, becomes active on payment, and is released when an unpaid order expires (the existing 30-minute reservation sweep).
2. **`GET /api/apps/:app/address?name=`** returns `{ ok, slug, available, suggestions[] }`.
   - Slug rules: lowercase a–z, 0–9 and hyphen; 3–40 characters; no leading or trailing hyphen.
   - Blocklist: `api`, `www`, `admin`, `pos`, `erp`, `mail`, `apps`, `murzak`, `support`, `billing`, `status`.
3. **`POST /api/orders`** accepts `{ serviceId, tierId, billingTerm, config: { shopName, slug, mode: "new" | "upgrade", targetServiceRow? } }`.
   - Rejects an unknown `tierId`.
   - Rejects a slug the account does not hold (or reserves it atomically if it is free).
   - Prices server-side.
   - Capacity reservation applies to `mode: "new"` only.
4. **Billing state:** the Web Account service row gains `tier` (and keeps `billing_term`). Renewals bill the tier price.
5. **Provisioning**
   - The Provisioning Job carries `site_slug`, and `murzak-bench-runner` passes it as `JOB_SITE_SLUG`.
   - `murzak-bench-provision` uses `JOB_SITE_SLUG`, when set and valid, in place of the account-derived slug. The site is `<slug>.erp.murzaktech.tech` and the POS is `<slug>.pos.murzaktech.tech`.
   - Without it, today's behaviour is unchanged, so ERP and the other apps keep working until they switch over.
   - A second "new shop" purchase therefore produces a second, separate site.

```
tier card ─► /get/pos ─(address check)─► POST /api/orders {tier, term, slug}
                                          │ reserves RAM + slug, server prices it
                                          ▼
                              /checkout/:orderId (M-Pesa / PayPal, unchanged)
                                          │ payment confirmed
                                          ▼
                Provisioning Job (lane=bench, site_slug) ─► host runner ─► provisioner
                                          │ access {url, posUser, posPassword}
                                          ▼
                /welcome/:orderId polls job ─► "Open your POS"  (also in portal)
```

## 4. Existing shop: upgrade or new

When the signed-in account already has an active shop for this app, `/get/:app` shows:

- **Upgrade {shop name}:** the shop-name field is hidden, and the summary shows *{current tier} → {chosen tier}*. Only a higher tier is allowed; for the same or a lower tier the page explains and suggests the next tier up.
  - **Price:** the pro-rated difference to the end of the current billing period, `(newPrice − oldPrice) × remainingDays / periodDays`, rounded up to the nearest shilling.
  - **On payment:** the service row's `tier` changes and renewals bill the new tier. No provisioning job is created; the upgrade is instant because every tier already runs on its own private site.
- **Open a new, separate shop:** the normal flow, with a new slug and a new site.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Slug taken between the check and the order | `409 { code: "slug_taken", suggestions }`; shown inline, all other input kept. |
| No capacity | The existing `CAPACITY` code at order creation; the button becomes "Join the waitlist" and the slug is released. |
| Abandoned checkout | The order expires after 30 minutes, releasing both the RAM and the slug. |
| M-Pesa declined or timed out | The existing checkout retry and PayPal fallback; the reservation is held while the page is open. |
| Paid, provisioning fails (retryable) | The runner retries (3 attempts). The welcome page says payment is safe and the team has been alerted, and a support ticket is filed automatically. |
| Paid, provisioner refuses (exit 2) | Same customer message; the job is set to `needs_human` with the reason. |
| Inline sign-up with an existing email | "You already have an account — sign in" switches the panel, keeping the shop name and tier. |
| Price tampering | Not possible: server-side pricing from `tierId`. |
| Welcome page closed | The portal resource page shows the same progress and the credentials. |

All customer-facing errors go through `services/errors.ts` `toUserMessage()`.

## 6. Testing

- **Server unit tests** (`backend/test`):
  - tier pricing (monthly, annual, unknown tier, client amount ignored);
  - slug rules and blocklist;
  - suggestions;
  - pro-rating (mid-period, last day, same or lower tier refused);
  - order creation (unheld slug refused, `409` race).
- **Live schema check:** confirm the `Tenant Slug` doctype and the service-row `tier` field exist on the real Frappe instance before relying on tests. `MOCK_FRAPPE` accepts any field.
- **Provisioner:** a throwaway shop on the VPS with `JOB_SITE_SLUG`. Confirm `<slug>.erp` and `<slug>.pos` come up and the owner can sign in, then `bench drop-site`.
- **Browser** (existing Playwright QA suite):
  - POS page → tier → `/get/pos`, both signed out and signed in;
  - address taken;
  - the existing-shop choice;
  - order created → checkout renders.

  Run at 375 px width and in dark mode.
- **Real path, once:** a genuine M-Pesa purchase of Duka from the public site to opening the POS, then refunded.

## 7. Rollout

Each phase ships independently.

1. **Backend foundation.** Nothing visible to customers yet.
   - Tiers in the catalog and snapshot.
   - Server-side pricing.
   - The `Tenant Slug` doctype, address check and reservation.
   - The extended `POST /api/orders`.
   - `JOB_SITE_SLUG` in the runner and provisioner.
2. **POS buyer experience:** `AppPlans`, `/get/pos`, `/welcome/:orderId`, and the app summary on checkout. The POS page stops using the hosting configurator.
3. **Upgrades:** the existing-shop choice and pro-rated billing.
4. **Other apps:** ERP, CRM, Accounting and HR & Payroll gain `appCheckout` and `tiers`.

## Out of scope

- Hard enforcement of tier limits inside the POS.
- Self-service downgrades and cancellations (handled by support).
- Coupons.
- A multi-app cart.
- Free trials.
- Moving existing customers onto tiers. Today's KES 4,500 buyers are mapped to Biashara, which is the same price.
