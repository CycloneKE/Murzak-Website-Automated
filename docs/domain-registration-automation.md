# Domain registration automation

How `.com`/`.org`/`.net`/`.io` purchases at checkout get registered with
Hostinger automatically, why the other three TLDs Murzak sells don't, and the
research trail behind both. Written 2026-08-17.

## What triggered this

"Domains today are availability-lookup only — why can't a purchased domain
register itself the way an app deploys itself?" The honest answer turned out
to be: it can, for some TLDs, but getting there required correcting a wrong
assumption already baked into the code, fixing a real pricing bug, and
resolving a legal/compliance question — none of which were obvious going in.

## TLD coverage is partial, and it's not a lookup gap

Hostinger's own catalog (`GET /api/billing/v1/catalog`, ~900 items) only sells
**`.com`, `.org`, `.net`, `.io`** of Murzak's seven TLDs. Confirmed by
searching the *entire* catalog for `.ke`/`.africa` matches, not just a missed
itemId — there is no `.ke`, `.co.ke`, or `.africa` domain product in Hostinger's
system at all. Those three stay on the pre-existing manual fulfilment queue
permanently, regardless of anything built here — they're not "not automated
yet", they're "not automatable through this provider".

`hostingerDomains.findDomainCatalogItem(tld)` looks this up **live** rather
than hardcoding the four known itemIds, so if Hostinger starts or stops
selling a TLD, coverage adjusts automatically instead of silently going stale.

## The wire format is snake_case, not the SDK docs' camelCase

The PHP SDK's markdown docs (`hostinger/api-php-sdk` on GitHub) describe
property names like `entityType`, `whoisDetails`, `itemId`. The actual JSON
API wants `entity_type`, `whois_details`, `item_id`. Confirmed by sending a
deliberately malformed request and reading Hostinger's own validation error,
which named the snake_case fields as missing when the camelCase ones were
present. Trusting the SDK docs literally would have made every request 422
with "field required" errors for fields that were, in fact, present.

## The WHOIS contact schema, reverse-engineered from live validation errors

`POST /api/domains/v1/whois` creates a registrant contact profile. Confirmed
required fields for `entity_type: individual`:

```
tld, country                                   — top level
first_name, last_name                          — 2-64 chars, letters only
email                                          — valid email
address, city                                  — no special characters
country_code                                   — ISO 3166 alpha-2
phone_cc, phone_number                         — numeric calling code + number
```

Plus **country-specific fields** — for `country_code: KE` specifically, also
`state_ke` (one of Kenya's 47 counties, by exact name) and `zip_ke` (5-digit).
The field set is not fixed; it depends on which country the registrant is in.

**`entity_type: company` could not be fully resolved.** Every probe with
plausible extra fields (`company_name`, `org`, `organization_name`) returned
an opaque `[Domains:2003] The given data was invalid` instead of the
field-level errors `individual` gives — likely because Kenyan company
registration needs a business/KRA registration number Murzak may not have
configured, but this was never confirmed. Moot for the current design (see
below), but worth knowing if `company` is revisited later.

## Registrant identity: reused, not invented

`GET /api/domains/v1/whois` (read-only) revealed **two WHOIS profiles already
live on the account**, both `entity_type: individual`, registrant "Joe Mugoh",
`murzaktech@gmail.com`, real Nairobi address and phone — one of them backing
the actual live registration of `murzaktech.tech`. So domain registration via
this exact mechanism was already proven working for this account before any
of this was built; the only question was whether to keep using that identity
or set up a separate "Murzak the company" one.

Chosen: **reuse the existing individual profile.** `ensureWhoisProfile(tld)`
clones its real `whois_details` onto any TLD missing a profile — WHOIS
profiles are scoped one-per-TLD (creation requires `tld` as a field), so
`.com`/`.org`/`.net`/`.io` each need their own, cloned from whichever profile
already exists. Nothing here invents contact data; every field written for a
new profile comes from a profile Hostinger already returned for this account.

## The disclosure requirement

Hostinger's [Domain Name Registration Agreement](https://www.hostinger.com/legal/domain-name-registration-agreement),
§7:

> "In the event you are purchasing a domain name on behalf of a third party,
> you agree to inform any customer of yours...that they are in fact
> registering their domain name through Hostinger."

This conflicts with the platform's white-label posture by default (nothing
elsewhere ever names the upstream provider). Resolved by adding a one-line
disclosure — *"Domains are registered through our infrastructure partner,
Hostinger."* — at both places a customer commits to a domain: the checkout
page (`Checkout.tsx`, shown only when the item being paid for is a Domain
Registration product) and the in-portal request modal (`AddDomainModal.tsx`,
"Register a new domain" path). Nowhere else changed — internal fields
(`registrar` on `Customer Domain`, `provider` on the purchase-request
doctype) stay `"Murzak Cloud"`; the disclosure is the one place "Hostinger"
is allowed to appear, because it's required to.

## Pricing was below wholesale cost on every automatable TLD

Checked because automating purchase would have automated the loss on every
sale, removing the human checkpoint manual fulfilment implicitly provided.
Confirmed against every pricing tier in the live catalog, not a promotional
rate:

| TLD | Hostinger cost (~129.3 KES/USD) | Old retail | Was selling at |
|-----|----------------------------------|-----------|-----------------|
| .com | ~2,585 KES | 1,500 | 58% of cost |
| .org | ~2,326 KES | 1,800 | 77% of cost |
| .net | ~2,326 KES | 1,800 | 77% of cost |
| .io  | ~9,698 KES | 4,500 | 46% of cost |

New prices (`DOMAIN_TLD_PRICES` in `backend/server.js`, and the matching
`domain-*` entries in `frontend/src/config/serviceCatalog.ts` and
`frontend/src/services/domains.ts`): **.com 4200, .org 3800, .net 3800,
.io 15500** — roughly 60% margin over cost with headroom for KES/USD moving
to ~140 before going underwater again. `.co.ke`/`.ke`/`.africa` are
unchanged; there's no wholesale cost to check them against.

Renewal economics for customers who already bought at the old price is a
separate, larger question this doesn't address.

## One operational finding, unrelated to the code but worth flagging

The only payment method on the Hostinger account (`GET
/api/billing/v1/payment-methods`) — a card ending `1000` — had `expires_at`
of **2026-08-17**, the same day this was found. `hasUsablePaymentMethod()`
checks `is_expired`, `is_suspended`, and `expires_at` against the current
time before ever attempting a purchase, so an expired card degrades safely to
"stays on the manual queue" rather than a confusing mid-purchase failure —
but if this card lapses without a replacement, **every** automated
registration attempt will silently fall back to manual until it's replaced.
Hostinger's API has no endpoint to add or update a card; it has to happen in
hPanel.

## Architecture

```
customer pays for domain-com/org/net/io at checkout
                    ↓
billingActivationService.js → domainPurchaseFulfilment.fulfilPurchasedDomains()
                    ↓
  [always] create Hosting Domain Purchase Request (status: pending)
  [always] create Customer Domain record (status: pending)  ← this exists even
                                                                if everything
                                                                below fails
                    ↓
  [best-effort] attemptLiveRegistration(fullDomain, tld):
    1. hostingerDomains.findDomainCatalogItem(tld)     — is this TLD sold at all?
    2. hostingerDomains.hasUsablePaymentMethod()        — can we actually pay?
    3. hostingerDomains.ensureWhoisProfile(tld)         — registrant contact
    4. hostingerDomains.purchaseDomain(...)             — the actual registration
    5. hostingerDomains.enablePrivacyProtection(domain) — best-effort within
                                                            best-effort; a
                                                            failure here does
                                                            NOT undo a
                                                            successful purchase
                    ↓
  on success: Customer Domain → active, registrar="Murzak Cloud", expires_on set
              Purchase Request → "connected" (same word a human's manual
              fulfilment already uses — see adminRoutes.js)
  on ANY failure at any step: nothing changes. The domain stays exactly
  "pending" — the same state it was in before any of this existed, and the
  same queue a human already works from.
```

`attemptLiveRegistration` never throws and never blocks the fulfilment
records above from being created — a customer's purchase request and
ownership record exist regardless of whether automation could complete.

## Deliberately not built

**No auto-purchase test against production.** Every test in
`test/domainRegistrationAutomation.test.js` stubs `hostingerDomains`'s
exported functions — no live HTTP call happens anywhere in the test suite,
and no domain has actually been registered through this code as verification.
Registering a real domain costs real money and creates a real, hard-to-fully-
undo registration; that first live run should happen through an actual
customer checkout (or a deliberate, informed test purchase), not as a side
effect of shipping the automation.

**No `entity_type: company` support.** Moot given the reuse-the-existing-
profile decision, but if Murzak later wants domains registered under a
company identity rather than an individual's name, the required field(s)
still need to be found — see the WHOIS schema section above.
