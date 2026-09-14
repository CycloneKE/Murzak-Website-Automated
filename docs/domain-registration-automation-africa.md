# `.africa` domain registration automation — proposal

Companion to `docs/domain-registration-automation.md`. That doc explains why
`.co.ke`/`.ke`/`.africa` stay on the manual queue under Hostinger: its catalog
doesn't sell them at all, confirmed by a full-catalog search, not a lookup
gap. This doc is the fix for one of those three — `.africa` — via a second
registrar. It is a **proposal, not shipped code**: nothing below has been
verified against a live account, because Murzak doesn't have one yet. Every
claim is marked confirmed (public research) or open (needs an actual account
to resolve) — do not treat the open items as settled.

## Why `.africa` is fixable and `.co.ke` isn't, the same way

`.co.ke` is a ccTLD gated by KeNIC accreditation — a Kenya-specific
registrar relationship. `.africa` looks like it should be the same kind of
problem (it's a place-name TLD administered by an African registry,
Registry.Africa) but it isn't: structurally it's run like any global gTLD.
Registry.Africa accredits 50+ registrars worldwide, and that list includes
mainstream registrars with established self-serve reseller APIs — Namecheap,
GoDaddy, Dynadot among them. **Confirmed**: Namecheap's own pricing/TLD
catalog includes `.africa`, and their API explicitly supports registering any
TLD on that catalog. So this doesn't need a Kenya-specific relationship or
accreditation at all — just a reseller account with a registrar that already
has the API.

## Recommended registrar: Namecheap

**Confirmed** (Namecheap's own API FAQ/docs):
- API access is free, gated on either a $50 account balance or 20+ domains
  already registered on the account — not a paid program or an application
  process.
- Access is IP-whitelisted: the calling server's public IPv4 has to be added
  in My Profile → Tools → API Access before any call succeeds.
- The API is XML-based (`https://api.namecheap.com/xml.response`), not REST/
  JSON — different shape from Hostinger's JSON API, so `hostingerDomains.js`
  is a pattern to follow, not code to share.
- `.africa` is on Namecheap's sellable TLD list, and their reselling model is
  the same shape Murzak already runs on: buy at Namecheap's price, resell at
  Murzak's own retail price, keep the spread.

**Open, needs a real account to resolve:**
- Exact request/response shape for domain availability (`namecheap.domains.check`)
  and registration (`namecheap.domains.create`) — field names, required
  contact fields, and how registrant/admin/tech/billing contacts map (whether
  one profile can cover all four roles the way Hostinger's WHOIS profile does).
- Whether Namecheap requires its own registrant identity to be created per
  purchase or supports a stored/reusable profile like Hostinger's WHOIS
  profiles — this determines whether `ensureWhoisProfile`'s reuse pattern
  transfers directly or needs rework.
- Real per-domain wholesale cost for `.africa` in USD, to set a retail KES
  price with real margin — the same pricing-bug risk flagged in the Hostinger
  doc (four TLDs there were briefly priced below cost) applies here from day
  one if a placeholder price ships before the real cost is checked.
- Whether Namecheap's privacy-protection equivalent (WhoisGuard) is free or
  paid, and whether it needs a separate API call the way Hostinger's does.
- Dynadot as a fallback/second option if Namecheap's onboarding threshold
  ($50 balance / 20 domains) or contract terms turn out to be a blocker —
  Dynadot also runs a documented REST domain API, but its `.africa` coverage
  wasn't confirmed in this research pass and needs a direct check against
  their supported-TLD list.

## Proposed architecture — mirrors the existing pattern, doesn't touch it

The existing fulfilment pipeline (`domainPurchaseFulfilment.js`) already
separates "does this TLD have a live-registration path" from "create the
fulfilment records" — that's why adding a second registrar is additive, not
a rewrite:

```
attemptLiveRegistration(fullDomain, tld):
  route by tld:
    .com/.org/.net/.io  → hostingerDomains adapter   (existing, unchanged)
    .africa              → namecheapDomains adapter   (new)
    .co.ke/.ke            → no adapter — stays on the manual queue
                            (see the Register.co.ke outreach note)
```

Concretely:
- New file `backend/services/namecheapDomains.js`, same shape as
  `hostingerDomains.js`: `isConfigured()`, `configError()`,
  `findDomainCatalogItem(tld)` (or a Namecheap-appropriate equivalent — their
  API may not need a catalog lookup the way Hostinger's item-id system does),
  a registrant-profile helper, `purchaseDomain(...)`, and a privacy-protection
  helper if WhoisGuard needs its own call.
- `attemptLiveRegistration` in `domainPurchaseFulfilment.js` gains a TLD
  switch: `.africa` routes to the new adapter, `.com/.org/.net/.io` keep
  routing to `hostingerDomains` exactly as today. Everything else (fulfilment
  record creation, the "never blocks, never throws, falls back to pending"
  contract, the white-label `registrar: "Murzak Cloud"` field) is unchanged —
  those already don't know or care which upstream vendor did the work.
- Same disclosure obligation to check: Namecheap's own registrar agreement
  needs to be read for an equivalent to Hostinger's §7 "must disclose you're
  registering through us" clause before this ships — not assumed absent just
  because it hasn't been checked yet.
- Same pricing-safety step Hostinger got: confirm real wholesale cost in KES
  before setting `.africa`'s retail price, not after.
- `DOMAIN_PRODUCT_TLDS` / `serviceCatalog.ts` / `frontend/src/services/domains.ts`
  need `.africa` added as a fourth automatable TLD, same three-copy update the
  Hostinger pricing fix already had to make once.

## Suggested next step

Open a Namecheap account and check the $50-balance/20-domains API threshold
in practice, then run `domains.check` and `domains.create` against a cheap
throwaway TLD in sandbox/staging before writing `namecheapDomains.js` for
real — the same "reverse-engineer from live validation errors, don't trust
the docs literally" approach that found Hostinger's actual wire format
(snake_case, not the SDK docs' camelCase) applies here; Namecheap's API docs
have the same reputation for drifting from actual behavior.
