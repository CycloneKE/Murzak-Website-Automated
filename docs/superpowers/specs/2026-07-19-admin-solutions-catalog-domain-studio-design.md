# Admin dashboard remake, solutions browsing, and domain studio — design

## Context

Three related gaps surfaced from real usage:

1. **Admin dashboard bug**: an admin logging in is redirected once (`navigate("/portal/admin")`)
   into a route that sits outside the customer portal's normal tab system. There's no sidebar
   entry pointing at it, so the redirect only ever fires on first mount/`isAdmin` change. Once an
   admin clicks any other sidebar tab (Overview, Billing, ...), they land in the ordinary
   customer view with no way back except re-navigating the URL by hand. The admin area itself
   (`AdminTabs`) currently only has Inbox and Provisioning — no cross-customer logs/deployment
   history view, and no visibility into pending manual-fulfilment work.
2. **Solutions browsing**: `serviceCatalog.ts` prices *tiers* (e.g. "Database Hosting (Shared)"),
   not *engines*. A marketing visitor can't browse "which databases do you support" the way they
   can on a hyperscaler or Coolify itself — there's no engine-level catalog, grid, or detail page,
   and the "Databases" card already on `Cloud.tsx`'s "What you can host" grid doesn't link
   anywhere.
3. **Domain studio**: `DomainSearch.tsx` + `services/domains.ts` already implement a domain
   search-and-price UI, but it's only reachable inside the logged-in `PlanServicesModal` checkout.
   There's no public, no-login domain register/transfer/connect experience, no `.tech` TLD, and no
   real registrar pricing behind the placeholder KES figures — pricing was simulated guesswork.
   `hostingRoutes.js` has a domain-purchase-request concept, but only as an attachment to an
   existing hosting service purchase, not as a standalone order.

See [[murzaktech-business-model]], [[murzaktech-monetization-provisioning]] for the underlying
capacity/provisioning model, and [[murzaktech-cloud-instant-checkout]] for the existing
single-resource checkout (`CloudLaunchModal`) this design hands off to.

## Scope

**In scope:**
- Fix the admin tab-switching bug by making Admin a permanent sidebar tab.
- Extend the admin area with **Logs** (provisioning/deployment history, admin-wide) and
  **Orders** (domain fulfilment queue) views.
- A new engine-level **solutions catalog** (Databases + Apps only, curated list) with
  browse → detail → deploy pages, deploying via the existing `CloudLaunchModal`.
- A public, no-login **Domain Studio** on `Cloud.tsx` (Register / Transfer / Connect tabs) with
  real Hostinger-sourced pricing + markup, handing off to the existing pending-selection →
  signup → invoice flow.

**Explicitly out of scope:**
- Real registrar API integration (availability check stays simulated; fulfilment stays manual —
  see Known limitations below). Automating this is a natural fast-follow once a registrar
  account/API is set up, but is not part of this design.
- Any solution category beyond Databases and Apps (Website Hosting, Email, Storage, etc. keep
  their current non-clickable cards on `Cloud.tsx` for now).
- Changes to `Pricing.tsx`, `PlanServicesModal`, or the bundled configurator — those are
  unaffected.

## Section 1 — Admin dashboard

**Bug fix, root cause:** Admin access is currently a one-time `navigate()` redirect into a route
(`/portal/admin`) that isn't part of Portal's tab system. Fix: promote it to a first-class tab.

- Add `"admin"` to Portal's `Tab` union (`"overview" | "cloud" | "billing" | "profile" | "admin"`).
- Add an **Admin** entry to `allMenuItems`, rendered only when `isAdmin` is true, visually
  distinguished (accent-colored icon / small "Staff" label) so it reads as a distinct zone from
  the customer tabs it sits alongside.
- `renderTab("admin")` returns `<AdminTabs />` (unchanged component, just reached differently).
- Replace the `useEffect(() => { if (isAdmin) navigate("/portal/admin", ...) }, [isAdmin])`
  redirect with initial-tab logic: on first render, if `isAdmin` and no tab is present in the URL,
  default to `"admin"` instead of `"overview"`. After that, tab switching is ordinary — clicking
  Overview/Billing/etc. and back to Admin never loses state or redirects away.
- `/portal/admin` as a route can be removed once Admin is reached via the tab mechanism, or kept
  as an alias that sets the active tab to `"admin"` (implementation detail, either is fine —
  writing-plans should pick based on how much other code references that path).

**`AdminTabs` extended from 2 views to 4:**

```
type AdminView = "inbox" | "provisioning" | "logs" | "orders";
```

- **Inbox** *(unchanged)* — existing support/contact request view.
- **Provisioning** *(unchanged)* — existing readiness/queue/capacity view.
- **Logs** *(new)* — a cross-customer view over data the backend already records: provisioning
  job list (via the same `listJobs()` the Provisioning view uses, but without a per-customer
  filter) and deployment history (via `services/provisioning/deploymentHistory.js`). Table: customer,
  service, status, timestamps; row expands to show that run's output. No new backend data model —
  this is a new read surface over existing records. If the current job/history endpoints are
  scoped to "my services" rather than "all services," they need an admin-only variant that removes
  that filter (reusing the same `requireAdmin` middleware `adminRoutes.js` already uses elsewhere).
- **Orders** *(new)* — the domain fulfilment queue from Section 3: pending Register/Transfer
  orders, staff action to mark fulfilled/failed.

## Section 2 — Solutions catalog (Databases + Apps)

**New config** `frontend/src/config/solutionsCatalog.ts` — one entry per engine/app, distinct from
`serviceCatalog.ts`'s per-tier pricing entries:

```ts
type SolutionCategory = "Database" | "App";

type Solution = {
  id: string;                    // e.g. "postgresql"
  category: SolutionCategory;
  name: string;
  icon: string;                  // icon key/component reference
  blurb: string;                 // one-liner for the grid card
  description: string;           // longer "what is this / when to use it"
  useCases: string[];
  versions?: string[];           // e.g. ["16", "15", "14"] for Postgres
  tierServiceIds: string[];      // serviceCatalog IDs this deploys onto
};
```

**Curated v1 list** (expand later by adding entries, no new page code needed):
- Databases: PostgreSQL, MySQL, MariaDB, MongoDB, Redis.
- Apps: WordPress, n8n, Ghost, Metabase, Uptime Kuma.

**Two generic page types, driven entirely by the catalog data:**
1. **Category grid** (`/solutions/databases`, `/solutions/apps`) — one component, card grid
   (icon/name/blurb), reusing the existing card visual language (`rounded-3xl`,
   `bg-white/60 dark:bg-white/5`) already established across the site.
2. **Detail page** (`/solutions/databases/postgresql`) — hero (icon/name/description), version
   picker if `versions` is set, a size/tier picker rendering the real specs + KES price of each
   `tierServiceIds` entry (pulled live from `serviceCatalog.ts`, not duplicated), and a **Deploy**
   button.

**Deploy handoff:** clicking Deploy opens the existing `CloudLaunchModal` pre-configured with the
chosen `serviceId` — reusing its already-built login-vs-signup branching, capacity/eligibility
checks (`addonEligibility.js`, `orderCapacity.js`), and invoicing. No new checkout logic.

**Entry point:** `Cloud.tsx`'s existing "What you can host" grid already has a Databases card;
wire its click to `/solutions/databases`. Add an Apps card to the same grid, linking to
`/solutions/apps`. Other cards in that grid (email, file storage) are unchanged.

## Section 3 — Domain studio

**New public section on `Cloud.tsx`**, no login required, three tabs:

- **Register** — promotes the existing `DomainSearch` component out of the logged-in checkout
  modal into this public section. Same search-by-label, same `checkDomain()` service call.
- **Transfer** — domain name + EPP/authorization-code fields, transfer fee shown inline
  (registration-equivalent price, "includes 1 year"). The EPP code is write-only from the UI's
  perspective: submitted, stored for staff to use during manual fulfilment, never echoed back or
  logged.
- **Connect** — domain name field + DNS/nameserver guidance for pointing an existing registrar's
  domain at Murzak hosting. Free, no order created — informational only, reusing whatever DNS
  guidance content the portal already shows logged-in customers connecting a domain
  (`appDomain.js` / `WebsiteHostingDashboard.tsx`), simplified for a pre-signup audience.

**Pricing** — `services/domains.ts`'s `TLD_OPTIONS` updated with real Hostinger-sourced wholesale
rates (confirmed via Hostinger's own pricing pages, 2026-07-19) converted at the existing
`KES_TO_USD_RATE` env rate, **+40% markup, +KES 500 one-time setup fee on year 1 only** (waived on
renewal):

| TLD | Wholesale (USD/yr) | Wholesale (KES) | Year 1 price (KES) | Renewal (KES) | Source |
|---|---|---|---|---|---|
| .com | $19.99 | 2,579 | 4,110 | 3,610 | Hostinger (confirmed) |
| .net | $17.99 | 2,321 | 3,749 | 3,249 | Hostinger (confirmed) |
| .org | $17.99 | 2,321 | 3,749 | 3,249 | Hostinger (confirmed) |
| .tech | $63.99 | 8,256 | 12,058 | 11,558 | Hostinger (confirmed) |
| .io | $74.99 | 9,676 | 14,046 | 13,546 | Hostinger (confirmed) |
| .co.ke | — | ~1,200 | 2,180 | 1,680 | **estimate** — not sold by Hostinger, needs a KeNIC-accredited registrar account |
| .ke | — | ~4,000 | 6,100 | 5,600 | **estimate** — same |
| .africa | — | ~1,935 | 3,209 | 2,709 | **estimate** — not in Hostinger's catalog; market range $5.79–$24 |

Transfer fee = the same table's Year-1 price (registration-equivalent, "includes 1 year").

**Pick → pay flow:** picking a domain (Register or Transfer) creates a **pending selection**,
reusing the exact mechanism `CloudLaunchModal` already uses for "choose before you're logged in,
continue after signup" (see [[murzaktech-cloud-instant-checkout]]). Continue → account
creation/login prompt → the selection becomes an invoice → existing M-Pesa/PayPal payment rails.

**Fulfilment (backend):** extend the domain-purchase-request pattern already in `hostingRoutes.js`
(currently only fires attached to a hosting service purchase) to also support a **standalone**
order not attached to any hosting service. New/extended record: `type` (register|transfer),
`domain`, `tld`, `priceKes`, `customer`, `eppCode` (transfer only, write-only field), `status`
(`pending` → `in_progress` → `fulfilled` | `failed`), `createdAt`, `fulfilledAt`, `staffNote`.
Surfaced in the admin **Orders** view from Section 1.

## Known limitations / risks

- **Availability stays simulated in v1.** `checkDomain()` uses a deterministic hash, not a real
  WHOIS/registrar lookup — same as today. A customer could pay for a domain that's actually taken.
  Mitigation: the Register/Transfer UI must carry a visible disclaimer ("final availability
  confirmed during setup"), and the admin Orders flow must support marking an order `failed` with
  a reason, which should trigger a refund/credit and a customer notification, reusing the refund
  handling already implemented in `billingRoutes.js`/`paypalWebhook.js` — this design does not
  invent a new refund mechanism.
  This mirrors the project's existing convention of honest "not available" states over fabricated
  data (see `ResourceUtilizationCard.tsx`'s unsupported-metric handling).
- **`.co.ke`, `.ke`, `.africa` wholesale prices are estimates**, not confirmed via an actual
  Hostinger account (because Hostinger doesn't sell them). These need correcting once Murzak has
  an actual account with whichever registrar handles those TLDs.
- **Manual fulfilment is a real operational load.** Every paid domain order needs a human to log
  into a registrar and act on it — this doesn't scale past a modest order volume. Acceptable for
  v1 per explicit decision; flagged here so it isn't forgotten as a fast-follow.

## Testing

- Admin tab switching: an admin can navigate Overview → Billing → Admin → Logs → Orders → Overview
  without losing the Admin tab or falling back to the customer-only view.
- Solutions deploy: selecting a database/app + tier and clicking Deploy opens `CloudLaunchModal`
  with the correct `serviceId` pre-selected, for both logged-in and logged-out entry.
- Domain studio: Register/Transfer selection persists across a logged-out → signup → invoice
  round-trip (same pattern as existing `CloudLaunchModal` e2e coverage); Connect tab creates no
  order/invoice.
- Admin Orders: a fulfilled/failed status change by an admin is reflected correctly and is not
  actionable by non-admins.
