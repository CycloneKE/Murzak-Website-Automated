# Two-Lane Storefront — Design

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan
**Companion to:** `2026-07-23-unified-checkout-design.md` (amends its /pricing
section; see Pricing below)

## Problem

Murzak sells five-plus lines (business systems, cloud VMs, app hosting,
domains, databases, custom software) off one 16 GB server, to two very
different buyers: business owners who want an outcome (POS/CRM/ERP) and
developers who want infrastructure. Today one site speaks to both at once,
which creates ambiguity about what is being bought, dilutes the high-margin
business-systems funnel, and sprawls across redundant pages.

## Decisions (agreed in brainstorm)

- **Two-lane storefront**: "Murzak Business" (outcomes) and "Murzak Cloud"
  (infrastructure). Lane names are working placeholders; final branding may
  change without affecting the structure.
- **Homepage: business hero + dev doorway.** The hero sells the business
  outcome; a clearly-marked Developers → Cloud doorway sits in the nav and a
  slim band lower on the page.
- **Per-lane pricing.** Each lane has its own pricing section. Global
  `/pricing` survives only as a thin router page ("Business plans → / Cloud
  pricing →"). **This amends the checkout spec**, which previously made
  `/pricing` a cross-line comparison page.
- **Aggressive prune** of long-tail pages (see Deletions).
- **Evolve the existing purple-gradient design system, mobile-first.** No
  wholesale redesign; investment goes where buyers touch money.
- **Tech as proof, not as choices** (user refinement): the Business lane
  actively showcases the tech stack as a strength story, but technical jargon
  never appears on the buying path and the buyer never makes a technical
  decision.

## The lanes

### Murzak Business (default lane, owns the hero)

Sells outcomes: POS, CRM, ERP — each with 2–3 fixed tiers linking straight to
`/checkout/new` deep links (checkout spec). Custom software is a quote CTA
card inside this lane, not a dedicated page.

**Vocabulary rule:** tier cards, buying-path copy, and checkout never say
server, RAM, VPS, deploy, or instance. The buyer learns their system will be
"live at yourname.murzak.app" — nothing more technical is required to buy.

**Tech-stack story ("Why our technology wins" section):** the lane sells the
stack's strengths in business language, **without naming upstream projects**
(Frappe/ERPNext never appear in marketing copy — white-label rule). The
strategy is *name the layer, not the lineage*: the stack is branded the
**Murzak Platform** and every claim is made about it.

- *Built on the Murzak Platform* — "an enterprise-grade core refined by a
  global open-source community and tailored by us for Kenyan businesses."
- *No per-user license fees, ever* / *no vendor lock-in* / *your data is
  yours, exportable in standard formats anytime* — open source sold as
  benefits, never as an identity or brand name.
- *One platform, shared database* — POS, CRM and ERP are modules of one
  platform; no integrations to buy, and customizing doesn't mean starting
  over.
- *Proven in production by thousands of businesses worldwide* — credibility
  claim that is true of the core without naming it.
- *The same platform powers our custom builds* — makes the Custom Software
  CTA credible: "you're extending a proven system, not commissioning an
  experiment."
- *Hosted in-region, billed in KES* — infrastructure presented as trust
  benefits (speed, data residency, M-Pesa-native billing), never as specs.

**Disclosure policy:** every claim must be literally true ("built on open
technology we've customized and operate" — never "built from scratch").
Sales/support answer a direct "what's under the hood?" honestly; marketing
surfaces never volunteer it. **Dependency:** this strategy requires the
product-side white-label hygiene already flagged in the go-live audit (login
screens, system emails, error pages, About dialogs, help links must not show
upstream branding); marketing copy and product hygiene are one workstream.

Principle: buyers **decide** outcomes; the tech story exists to earn
**trust**.

### Murzak Cloud (doorway lane)

Sells infrastructure: VMs, app hosting, databases, domains. Vocabulary is
technical and proud of it (specs, regions, engines). Inherits `/cloud` and
`/deploy` as-is, plus the domain search and database engine pickers defined in
the checkout spec.

### Navigation

**Business | Cloud | Industries | Pricing ▾ (two links) | Contact.** Nothing
else in the top nav.

## Conversion mechanics

- **Three-click rule:** from any landing point, a decided buyer reaches
  `/checkout/:orderId` in at most three clicks (tier card → checkout). The
  checkout spec's deep-link entry makes this free for fixed-tier products.
- **One price, one button per tier card:** monthly KES, three outcome
  bullets, one CTA. Feature-comparison tables live behind a "compare tiers"
  disclosure, off the primary buying path.
- **Honest scarcity:** the capacity ledger (checkout spec) powers a truthful
  "N slots left this month" `CapacityBadge` on business tiers. On a 16 GB box
  the scarcity is real; the waitlist doubles as lead capture.
- **M-Pesa-first trust strip** under every price: M-Pesa mark, "pay in KES",
  "live in ~10 minutes", SLA link.
- **Post-purchase cross-sell, not pre-purchase upsell** (respects the no-cart
  decision): order-success screen and portal suggest exactly one logical next
  product (bought CRM → "add your own domain"), never a menu.

## Ambiguity killers

- A product exists in **exactly one lane**. Databases are Cloud products; if
  a CRM needs a database internally, that is invisible plumbing, never a
  buyer decision.
- **Lane-scoped tier naming:** Business uses Starter/Growth/Pro consistently
  across POS/CRM/ERP; Cloud uses spec-based names (e.g. `VM 2-4` for
  2 vCPU / 4 GB). No tier name appears in both lanes.
- The word **"plan" disappears from the storefront.** Buyers buy products at
  tiers. (`PLAN_META` remains internal sizing per the checkout spec.)

## Mobile-first component kit

Evolve the purple-gradient system into a small reused kit, designed at 320 px
first and enhanced upward:

- `LaneNav` — two-lane top navigation
- `TierCard` — thumb-sized CTA; price never below the fold on mobile
- `TrustStrip` — M-Pesa/KES/SLA band
- `CapacityBadge` — live slots-left indicator fed by the capacity ledger
- `OrderSummary`, `PaymentMethods` — already specified in the checkout spec
- `IndustryAnchor` — section blocks for the consolidated Industries page

Every money-touching screen must pass the existing dark-mode and a11y QA
specs (Playwright suite).

## Deletions (aggressive prune)

| Today | Becomes |
|---|---|
| `/products/custom` | CTA card inside the Business lane (quote flow) |
| `/for/retail`, `/for/clinics`, `/for/logistics`, `/for/services` | One `/industries` page with anchor sections; 301 redirects from old URLs |
| `/test-request` | Removed |
| `Contact.tsx` + `ContactPage.tsx` duplication | Single contact page |
| `/pricing` plan-first configurator | Thin router page to the two lanes' pricing sections |

## Sequencing

**Checkout first, storefront second:** checkout spec phases 1–2 (catalog +
orders + capacity ledger + `/checkout` page, then Cloud rewire), then this
restructure, then checkout phases 3–5. The storefront's tier cards need
`/checkout/new` targets to point at, and `CapacityBadge` needs the capacity
ledger to exist. Building the storefront first would wire new tier cards to
the old confusing flows — the exact ambiguity being killed.

## Testing

- Playwright: three-click rule asserted per lane (landing → tier card →
  checkout render); lane vocabulary lint (buying-path pages fail if they
  contain banned jargon terms in the Business lane); 301 redirects for pruned
  pages; mobile-320 layout checks on `TierCard` and checkout; dark-mode and
  a11y coverage extended to new components.
