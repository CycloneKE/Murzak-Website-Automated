# Site-Wide Visual Consistency & Natural Copy Pass — Design

**Date:** 2026-08-23
**Status:** Approved design, pending implementation plan
**Scope:** Marketing pages + portal discoverability/density. Phase 1 of a
3-phase engagement — Phase 2 is a privacy policy rewrite, Phase 3 is a
competitive/market-opportunity strategy brief. Both are separate specs,
written after this phase ships.

## Problem

User-reported visual QA across the live site:

1. Some marketing pages render text that isn't visible against its
   background (specifically called out again on the Cloud landing page,
   despite a contrast sweep on 2026-08-04 — treat as a possible regression,
   not assume it's already fixed).
2. Several pages have no background image/atmosphere at all, reading as
   flat/unfinished next to pages that do (Home, Cloud, About, Products,
   CustomSoftware, ForLogistics all use a shared "GLOBAL BACKGROUND WRAPPER"
   pattern; many other routes don't).
3. The customer portal "seems very empty" — resource controls, plan/product
   comparison, and general information density all feel thin next to
   comparable SaaS dashboards.
4. Marketing copy reads as AI-generated in places: heavy em dash (—) usage
   and generic corporate phrasing undercut the otherwise-good, concrete,
   Kenya-specific voice (M-Pesa, shillings, Nairobi support, named trial
   length).
5. Visuals should be benchmarked against real sites, not default
   stock-abstract-tech imagery, to read as human-made rather than
   templated/AI-assembled.

## Decisions (from brainstorming)

- **Sequencing**: this phase (visual + copy) ships first because both share
  the same files; privacy policy and competitive strategy are independent
  and follow as separate specs.
- **Portal scope, confirmed**: resource action controls (buried), plan/
  product comparison (thin), and general visual density — NOT a
  reviews/testimonials feature (not requested).
- **Pricing's missing background is not an automatic fix**: a prior session
  deliberately stripped Pricing's background and plan-card images for a
  "minimal glass UI" look (comment in `Pricing.tsx`: "Background
  intentionally removed... Image section removed as the Glass UI design is
  minimal, text-focused, and cleaner without heavy images"). This phase
  revisits that call against the new "looks empty" feedback rather than
  silently overriding a past deliberate decision.
- **Imagery**: real, license-free photography (Unsplash — already the
  site's source for existing background/hero images), subject-matched per
  page, not generic tech-abstract stock.
- **Em dash policy**: remove/rewrite in marketing and portal *prose* only.
  The literal `—` character used as a data placeholder (e.g. "no invoice
  yet" states, `nextInvoiceLabel()` in `OverviewTab.tsx`) is a legitimate UI
  convention and stays untouched.

## Part A — Visual consistency

**A1. Fresh contrast/visibility sweep.** Re-run a real in-browser check
(WCAG luminance + `elementFromPoint` occlusion testing, same method as the
2026-08-04 sweep, not visual guessing) across every marketing route and all
portal tabs, both themes. Priority: verify/diagnose the Cloud page complaint
specifically first, since it was supposedly already fixed. Fix using the
same taxonomy as last time: theme-conditional text on an always-dark
surface, unpaired `dark:` background classes, and any new stacking-context
regressions (`position`/`filter`/`backdrop-filter` ancestor issues).

**A2. Extend the background-wrapper treatment** to pages currently flat:
Login, Contact/ContactPage, Checkout, Payment, ThankYou, TestRequest,
DeployWizard steps, `/for/retail`, `/for/healthcare`, `/for/services`,
MurzakPOS, MurzakERP, MurzakCRM. Reuse the existing pattern (a shared
background image + wash + fade layered behind sections, `relative z-10` on
every section after it — the exact bug class from the 2026-08-04 sweep,
so new applications of this pattern must get the z-index pairing right from
the start). Source one subject-appropriate Unsplash image per page group
(e.g. product pages get software/dashboard-adjacent imagery, `/for/*`
pages get imagery matched to that vertical) rather than reusing one image
everywhere.

**A3. Pricing page**: bring back a toned-down version of the background
treatment (not a full revert of the minimal-glass decision — a subtle
atmosphere layer behind the existing glass cards, consistent with how
other glass-panel sections on other pages already sit on top of a
background). Plan-card images stay removed — that specific call was about
card content density, not page-level flatness, and is out of scope to
re-litigate.

## Part B — Copywriting naturalization

Page-by-page prose pass over: Home, Cloud, Pricing, About, Products +
4 product subpages, all 4 `/for/*` pages, Footer, Header, Faq, PlanAdvisor,
ManagedComparison, Login, Checkout, ThankYou, SalesModal, CloudLaunchModal,
PlanServicesModal.

- Replace em dashes with periods, commas, or restructured sentences —
  judged per sentence, not a mechanical find/replace (a dash sometimes
  signals a sentence that should just be split in two).
- Cut AI-writing tells: "not just X, but Y" constructions, rule-of-three
  overload, hollow intensifiers ("seamless," "robust," "leverage,"
  "unlock," "empower"), throat-clearing openers.
- Preserve and lean into what's already working: concrete local detail
  (M-Pesa, KES, Nairobi, specific trial length), specific claims over vague
  ones ("99.97% uptime" beats "highly reliable").
- No new claims invented to sound more natural — naturalness comes from
  concrete specificity already in the copy, not from adding unverified
  detail.

## Part C — Portal discoverability + density

**C1. Resource controls.** Stop/delete currently require: resource list →
click into resource → Settings tab → Danger Zone. Add a lighter-weight
entry point from the resource list/card level (a kebab menu or inline quick
action) so stopping or deleting doesn't require two navigations to
discover exists. Full Danger Zone (with its confirm-before-destructive
framing) stays as the actual action surface — this is a discoverability
fix, not a rework of the confirmation flow.

**C2. Plan/product comparison.** Add a real side-by-side feature comparison
on Pricing (extending the existing `ManagedComparison` pattern or a
dedicated table) so choosing between plans doesn't rely solely on each
card's own feature list. No new pricing logic — purely presentational,
sourced from the existing `PLAN_META` catalog so numbers can't drift from
the cards.

**C3. Portal visual density.** Review `OverviewTab`, `ResourceListTab`,
and their empty states against real dashboard patterns (Vercel, Linear,
DigitalOcean-style resource lists — used as a benchmark, not copied
verbatim) and tighten layout/information density. No fabricated data —
every element shown must come from real state already available in
`usePortalState`, matching the existing "honest status, never a fake-looking
empty dashboard" principle already established in `ResourceDetail.tsx`.

## Verification

- Dev server run, each changed route checked live in both light and dark
  mode via the in-browser tools (console errors, contrast, layout).
- Screenshot pass shared with the user for the before/after on the
  highest-impact pages (Cloud hero, Pricing, one portal resource view).
- No new automated visual-regression tooling — matches the precedent set
  in the 2026-08-05 Home design spec.

## Out of scope (this phase)

- Privacy policy content — separate Phase 2 spec.
- Competitive/market-opportunity strategy brief — separate Phase 3 spec,
  strategic research output only, no auto-implemented pricing/positioning
  changes (per user decision).
- Customer reviews/testimonials feature — not requested.
- Admin-only pages (`/portal/admin/*`) and mobile/narrow-viewport-specific
  work, unless the fresh contrast sweep (A1) turns up something there.
- Reworking Pricing's plan-card content layout (images) — only the
  page-level background changes.
