# Home Page Warmth, Motion & Visual Richness — Design

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan
**Scope:** `frontend/src/pages/Home.tsx` only

## Problem

Following the site-wide dark/light contrast sweep and the branded-duotone
background rollout (`2026-08-04` sessions), the user flagged the Home page
specifically as still falling short on three fronts, roughly equally:

1. **Too corporate/generic** — the hero photo (`server-man.webp`) is a stock
   server-room shot with no Nairobi or local character; nothing on the page
   signals *who* this is for or *where*.
2. **Too static/lifeless** — the page has almost no scroll-driven motion.
   Grepping `Home.tsx` for animation classes turns up exactly two:
   `animate-pulse` on a status dot and `animate-drift-slow` on one decorative
   blob. Tailwind already defines `fade-in`, `fade-in-up`, `scale-in`, and
   `slide-in-right` keyframes (`tailwind.config.js`), used elsewhere in the
   app for modal/dropdown mount transitions, but never for scroll-triggered
   section reveals — no `IntersectionObserver` usage exists anywhere in the
   codebase today.
3. **Visually flat/thin** — falls out of (1) and (2) together rather than
   needing its own separate fix; addressed as a byproduct.

Other landing pages (Cloud, Products, About, etc.) are explicitly out of
scope — user confirmed those are fine as of the duotone-treatment rollout.

## Decisions (from brainstorming)

- **Motion intensity: subtle & professional.** Fade/slide reveals on scroll,
  numbers counting up, gentle hover lift on cards. Not playful/bouncy, not
  scroll-jacked/parallax-choreographed — motion supports content, doesn't
  compete with it. Matches the site's B2B trust-building tone.
- **Imagery: source new photography**, not a treatment change on existing
  assets. The current hero photo itself is the problem, not how it's styled.
- **Photo subject: Nairobi place/context** — street life, skyline, local
  business storefronts. Not people-focused portraiture, not
  product-screenshot composites, not staying abstract/technical.
- **Only the hero image is replaced.** The body "GLOBAL BACKGROUND WRAPPER"
  section (`home-section-bg.webp`) keeps its current image and the
  purple/blue duotone treatment applied last session — that treatment is
  shared across 6 pages for visual consistency across the site; reworking it
  again on Home alone would break that consistency for no real gain.

## Part A — Hero photography

- Search free-license stock photography (Unsplash/Pexels — free for
  commercial use, no attribution required) for Nairobi-specific place/context
  shots: CBD street scenes, skyline, matatu/transport life, local storefronts.
- Bring back 2–3 candidates for the user to pick from before wiring anything
  in — this is a visual decision, not a describable one.
- Once picked: download (explicit user permission per download policy already
  covered by "proceed"), save to `frontend/public/images/`, replace
  `heroImages.home` in `App.tsx` (used for route-based preloading) and the
  hero's `backgroundImage` in `Home.tsx`. Keep the existing
  `bg-gradient-to-r from-murzak-ink/95 via-murzak-ink/60 to-transparent`
  overlay treatment — already proven to keep hero text legible against a
  photo background (this is the same pattern that diagnosed and fixed the
  Home stacking-context bug two sessions ago); no need to redesign it, only
  swap the photo underneath it.

## Part B — Scroll-triggered motion

### `useInView` hook

New file `frontend/src/hooks/useInView.ts` — a small `IntersectionObserver`
wrapper, not a dependency:

```ts
function useInView<T extends Element>(options?: IntersectionObserverInit): [RefObject<T>, boolean]
```

Returns a ref to attach and a boolean that flips true once the element
crosses the viewport threshold (default `threshold: 0.15`, fires once — no
re-triggering on scroll back up, which would feel gimmicky on repeated
viewing). Unobserves after first trigger to avoid holding observers on every
section for the page's lifetime.

### Where it's applied

- **Section reveals**: each major section's heading/content block
  (Trust strip stats, Empathy, What We Do bento, Configurator teaser, How It
  Works steps, Products, Local Edge, Why Switch, Pricing preview, FAQ, Final
  CTA) gets `fade-in-up` triggered by `useInView`, staggered slightly
  (~80ms) across multi-item grids (bento cards, step cards) rather than all
  firing at once.
- **Stat count-up**: the four trust-strip stats (99.9%, &lt;1 day, 24/7, KES)
  and the "How it works" numbered steps' entrance get a lightweight
  count-up/tick treatment on first reveal rather than appearing static.
  Numeric ones (99.9) count up; the non-numeric ones (&lt;1 day, 24/7, KES)
  just get the fade-in-up like everything else — forcing a count-up onto
  text that isn't a number would be the "gimmick over intent" trap this
  design is explicitly avoiding.
- **Hover**: cards that are already interactive (`onClick` pillars, product
  cards, plan cards) get a consistent subtle lift (`hover:-translate-y-1` —
  already used in a couple of spots, just made consistent) plus the existing
  border/glow hover states left as-is.

### Respecting reduced motion

Already globally handled — `index.css`'s `@media (prefers-reduced-motion:
reduce)` block forces near-zero animation/transition durations site-wide.
The `useInView` hook still fires (content must still become visible), it's
only the *transition* into view that collapses to instant for those users —
no separate reduced-motion branch needed in the hook itself.

### Testing

- Hook: unit test with a mocked `IntersectionObserver` — fires once on
  entering threshold, does not re-fire on a second entry, cleans up its
  observer on unmount.
- Visual: manual scroll-through in both themes post-implementation (no new
  automated visual-regression tooling — out of scope).

## Out of scope

- Any page other than Home.
- New animation library (Framer Motion, GSAP, etc.) — the existing Tailwind
  keyframes plus one small hook cover everything decided here.
- Redesigning the hero's overlay gradient, layout, or copy — only the photo
  underneath changes.
- Body-section (`home-section-bg.webp`) image or treatment — stays as
  shipped in the duotone rollout.
- Parallax/scroll-choreographed motion — explicitly declined in favor of
  "subtle & professional."
