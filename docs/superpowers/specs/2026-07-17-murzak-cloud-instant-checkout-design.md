# Murzak Cloud instant checkout — design

## Context

Murzak's existing checkout (`Pricing.tsx` → `PlanServicesModal` → `Payment.tsx`) is a bundled,
plan-based configurator: pick a plan archetype (Starter/Business/Enterprise), multi-select
services across many categories, optionally pick a domain choice, review universal add-ons,
then pay. It's the right tool for assembling a mixed bundle (website + email + a database, or
a fully managed ERP/POS/CRM setup), but it's overkill for a customer who just wants **one**
self-serve cloud resource — an app hosting instance, a database, a storage bucket, a website
slot — right now.

Reviewed for comparison (2026-07-17):
- **HostAfrica** (closest analog — Kenyan hosting reseller): no bundle wizard for infra at all.
  Each VPS tier is its own spec card (vCPU/RAM/storage spelled out) with an instant "Order Now."
  Checkout is a single page: region → plan tier (radio grid) → billing cycle → OS/template →
  a couple of resource fields (hostname, SSH key) → inline addon upsells → order summary with
  pro-rata math → payment method tiles (M-Pesa/PayPal/Bank/Crypto) → one "Pay Now" button.
- **AWS/Azure/GCP**: account + payment method is a one-time setup; after that there is no
  "checkout" per resource — launching a new instance/database is a config wizard ending in
  "Launch," billed later via usage metering. Friction is front-loaded into onboarding once,
  not repeated per resource.

Murzak can't adopt hyperscaler-style continuous usage metering (no metering infra, M-Pesa is
push-per-charge, not a stored card), but the *shape* worth taking is: (1) single-page,
spec-first checkout for one resource instead of a multi-service bundle wizard, and (2) friction
should drop after the first purchase, not stay flat every time.

See [[murzaktech-business-model]], [[murzaktech-monetization-provisioning]],
[[murzaktech-byoa-app-hosting]] for the underlying capacity/provisioning model this sits on top of.

## Scope

**In scope:** a new instant single-resource picker ("Launch a cloud resource") covering exactly
the four `capacityClass: "volume"` categories that already provision without a human via the
Coolify lane: Website Hosting, App Hosting (BYOA), Database Hosting, Storage.

**Explicitly out of scope / unchanged:** `Pricing.tsx`, `PlanServicesModal`, `AddonsModal`,
`Payment.tsx`, the provisioning backend, and the sales-assisted flow for managed ERP/POS/CRM
(`capacityClass: "premium"`) and Enterprise (`capacityClass: "dedicated"`) — those still need
human-configured setup regardless of how fast checkout is, and stay on the existing bundled
configurator.

## Entry point

`Cloud.tsx`'s hero CTA changes from "Build my plan" (→ `/pricing`) to **"Launch a resource,"**
opening the new picker as a modal — same pattern as `PlanServicesModal`/`AddonsModal` (reuses
the existing modal scroll-lock/portal conventions), not a new route. The same modal is also
reachable from the Portal, so an existing customer launching a *second* cloud resource doesn't
have to re-register or walk the bundled flow again.

## Picker UI (`CloudLaunchModal`)

In HostAfrica's order, but trimmed to one resource:

1. **Category tabs** — Website Hosting / App Hosting / Database / Storage (4 tabs, not the
   full 15-category list from the bundled configurator).
2. **Spec cards** for that category's available tiers (today, mostly one SKU per category —
   e.g. `starter-app-hosting` — more tiers can be added to the catalog later without picker
   changes). RAM/storage/price shown up front, no hidden math.
3. **The one resource-specific field**, shown inline only when relevant:
   - App Hosting → repo URL (same https/git@(#branch)? validation as the portal's existing
     account repo field).
   - Website Hosting → domain choice (reuses the existing `DomainChoice` control/copy).
   - Database / Storage → no extra field.
4. **Order summary + single "Launch now" button.** No addon upsell screen, no multi-step
   wizard, no billing-cycle picker (Murzak is monthly-only today — out of scope to add
   annual/quarterly billing here).

## Data flow & auth branching

```
CloudLaunchModal: pick category → pick spec card → fill resource field → price shown live
  → click "Launch now"
      ├─ not logged in:
      │    save { serviceId, domainChoice?, repoUrl? } to localStorage under
      │    "murzak_cloud_launch_pending" (same shape convention as the existing
      │    "murzak_plan_selection_pending" key, so both flows can share one
      │    "attach pending selection after auth" handler)
      │    → onNavigate('login') (or register)
      │    → on successful auth, the existing pending-selection effect (extended to also
      │      check the cloud-launch key) picks it up and proceeds to the "logged in" branch
      └─ logged in:
           ├─ customer has NO existing plan (first-ever order):
           │    POST /api/plan/attach-selection
           │    { planKey: "Starter", selectedServices: [{ serviceId, domainChoice }] }
           │    (all four volume categories already live under the Starter plan in
           │    SERVICE_CATALOG — this is the same call the bundled flow already makes
           │    for a first Starter order, just triggered from a narrower UI)
           └─ customer already has a paid plan (Starter or Business):
                POST /api/addons/invoice/create
                { services: [{ serviceId, serviceName, tier, domainChoice: "" }] }
                (existing "buy one more service without touching your current plan"
                endpoint — see Backend change below for the fix needed to unblock this
                for Business-plan customers)
      → response includes invoiceId → if serviceId is App Hosting, follow up with
        PUT /api/portal/account/repo { repo_url: repoUrl } (existing endpoint — repo_url
        is NOT threaded through attach-selection or addons/invoice/create today, so this
        stays a separate call, matching how the portal's own account-settings repo field
        already works)
      → onNavigate(`/payment/${invoiceId}`) — existing Payment.tsx handles M-Pesa/PayPal/
        Card from here, untouched.
```

## Backend change (in scope)

`allowedAddonTiersForPlan(planKey)` in `backend/server.js` currently gates `/api/addons/invoice/create`
by tier-name-matches-plan (`Starter` → `["Light"]`, `Business` → `["Medium"]`). Since all four
volume-class cloud resources are tier `"Light"`, a Business-plan customer is rejected today
trying to buy one — defeating the point of a plan-agnostic instant checkout.

Fix: for the four volume categories, gate by `capacityClass === "volume"` instead of by tier
name — a volume-class service is always safe for any paying customer to self-serve add,
regardless of their plan's own tier, because capacity/provisioning risk (not plan tier) is what
that gate exists to protect. Premium-tier add-ons keep the existing tier-matches-plan behavior
unchanged. This requires the backend catalog snapshot to carry `capacityClass` per service
(check `backend/scripts/generate-catalog-snapshot.js` / `backend/data/serviceCatalogSnapshot.json`
during planning — add the field to the snapshot generator if it isn't already pulled through).

## Error handling

- Repo URL validation reuses the existing https/git@ regex from the portal's account settings —
  no new validation logic.
- Self-serve RAM/disk caps (`SELF_SERVE_ORDER_RAM_CAP_MB`/`DISK_CAP_GB`) already exist in
  `serviceCatalog.ts`; a single-resource order is always far under them — no new capacity UI.
- The picker never offers a service where `pricing.model === "custom"` (reuses `isQuoteOnly`).
- Everything downstream of `invoiceId` (invoice load failure, M-Pesa timeout, PayPal failure) is
  already handled in `Payment.tsx` — untouched.

## Testing

- Existing backend test suite (`backend/test/provisioning.test.js` and friends) should gain
  cases for: (a) `allowedAddonTiersForPlan`/the new capacityClass-based gate allowing a
  Business-plan customer to buy a Light-tier volume service, (b) the existing tier-matches-plan
  behavior for premium add-ons stays unchanged.
- Frontend: manual browser walkthrough of both branches (not-logged-in → register → auto-attach
  → payment; logged-in Business customer → addons/invoice/create → payment), per this repo's
  established pattern of a live end-to-end run before claiming a checkout change works
  (see [[murzaktech-byoa-app-hosting]] for the verification bar this codebase holds itself to).
