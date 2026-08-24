# Marketing Pages Visual & Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every marketing page the same atmospheric background
treatment already used correctly on Home/Cloud/About/Products, rewrite
prose to remove em dashes and AI-writing tells while keeping the concrete
Kenya-specific voice that already works, and add a real plan comparison to
Pricing — per Parts A, B, and C2 of
`docs/superpowers/specs/2026-08-23-site-polish-visual-copy-design.md`.

**Architecture:** Per-page tasks (background + copy touch the same files,
so they're done together per page rather than in separate passes), reusing
one shared background-wrapper template and one shared copy rubric defined
once below. A final task extends the existing automated contrast test
(`qa-marketing.spec.ts`) to cover every page this plan touches and fixes
whatever it finds.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS, Playwright for
verification.

**Depends on:** none of Plan 1's tasks are required before this plan
starts — they touch different files (App.tsx meta effect, server.js CSP,
new JSON-LD components) except Task 2 below, which reuses Plan 1 Task 5's
`toSafeJsonLdString` util. Run Plan 1 Task 5 first, or inline the same
5-line util if this plan runs standalone.

## Global Constraints

**Background-wrapper template** (copied verbatim from the working pattern
in `Cloud.tsx:97-103`, already correct there — reuse exactly, don't
reinvent):

```tsx
      {/* GLOBAL BACKGROUND WRAPPER — one shared background image behind every
          section below [describe what it's behind], instead of a different
          image per section. */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-45" style={{ backgroundImage: "url('/images/PAGE-section-bg.webp')", filter: "saturate(.5) contrast(1.05)" }} />
        <div className="absolute inset-0 z-0 section-bg-wash" />
        <div className="absolute inset-0 z-0 section-bg-fade" />

      {/* existing sections go here, each one needs relative z-10 added — this
          exact pairing was the root cause of the 2026-08-04 Home regression
          (murzaktech-contrast-sweep-2026-08-04): a missing z-10 lets the wash
          layer paint over the text on top of it, both visually and for
          pointer-events. Every section between the wrapper open and its
          closing </div> below MUST have relative z-10 added to its className. */}

      </div>
```

Each page in this plan needs its own `/images/PAGE-section-bg.webp` —
sourced from Unsplash (the site's existing convention: `About.tsx`,
`Products.tsx`, `CustomSoftware.tsx`, `ForLogistics.tsx`, `Cloud.tsx`,
`Home.tsx` all already do this) via the Browser tool at execution time,
matched to that page's subject (this is a visual decision, not a
mechanically-describable one — same precedent as the 2026-08-05 Home hero
photo task). Download to `frontend/public/images/`, reference by that
path, `.webp` format to match every existing asset in that directory.

**Copy rubric** (apply to every prose string touched — headings,
paragraphs, button labels, FAQ answers — not to code comments or the `—`
placeholder character used for empty portal data states):

1. Replace em dashes (`—`). Judge per sentence: sometimes it's two
   sentences that should just be split with a period; sometimes a comma
   or "and"/"but" reads more naturally. No mechanical find-replace.
2. Cut AI-writing tells: "not just X, but Y" constructions, rule-of-three
   overload (three parallel adjectives/phrases in a row where one or two
   would read more naturally), hollow intensifiers ("seamless," "robust,"
   "leverage," "unlock," "empower," "cutting-edge"), throat-clearing
   openers ("In today's fast-paced world...").
3. Keep and lean into concrete specificity already present: M-Pesa, KES,
   Nairobi, named numbers ("36-hour trial," "99.97% uptime") — these read
   as human precisely because they're specific, not because of any
   particular sentence structure.
4. Never invent a new claim to make copy sound more natural — naturalness
   comes from keeping existing concrete detail, not adding unverified
   detail.

**Verification per task**: after editing, run
`cd frontend && npm run dev` (if not already running), open the page in
both light and dark mode, confirm no console errors, confirm the new
background renders and text is readable, and grep the file for the em
dash character to confirm none remain in prose (the check command is
given per-task since the em-dash character itself needs to be pasted
literally, not typed).

---

### Task 1: Cloud.tsx — copy pass (background already correct)

This is the page you specifically flagged for invisible text. It already
has the background-wrapper pattern correctly applied (confirmed during
spec grounding — every section already carries `relative z-10`), so this
task is copy-only; the final Task 12 contrast sweep will independently
re-verify no invisible text remains here.

**Files:**
- Modify: `frontend/src/pages/Cloud.tsx`

- [ ] **Step 1: Fix the confirmed em-dash instances**

Replace (line 57-58):

```tsx
            <p className="mt-7 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-xl leading-relaxed">
              Your site, email and apps — set up, secured and backed up by us, on fast infrastructure,
              billed in shillings. You get the result; we handle the servers.
            </p>
```

with:

```tsx
            <p className="mt-7 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-xl leading-relaxed">
              Your site, email and apps, set up, secured and backed up by us, on fast infrastructure,
              billed in shillings. You get the result; we handle the servers.
            </p>
```

Replace (line 31):

```tsx
    { icon: <HardDrive size={20} />, t: 'File storage', s: 'A private cloud drive for your team — share without the chaos.' },
```

with:

```tsx
    { icon: <HardDrive size={20} />, t: 'File storage', s: 'A private cloud drive for your team, without the shared-folder chaos.' },
```

Replace (line 39):

```tsx
    { icon: <ShieldCheck size={22} />, t: 'Secured & patched', s: 'Firewalls and security updates handled for you — not left for "later".' },
```

with:

```tsx
    { icon: <ShieldCheck size={22} />, t: 'Secured & patched', s: 'Firewalls and security updates handled for you. Not left for "later".' },
```

Replace (line 145):

```tsx
              <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-w-md">
                Real engineers watching real infrastructure — not a support queue that routes you overseas.
              </p>
```

with:

```tsx
              <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-w-md">
                Real engineers watching real infrastructure, not a support queue that routes you overseas.
              </p>
```

- [ ] **Step 2: Grep for any remaining em dashes in this file**

```bash
grep -n "—" frontend/src/pages/Cloud.tsx
```

Expected: no output (the 10 occurrences found during spec grounding are
now down to the ones in Step 1's targets — if more remain, apply the same
rubric to each).

- [ ] **Step 3: Live-check in browser, both themes**

Navigate to `/cloud`, toggle dark/light, confirm the hero and "What you
can host" sections read naturally and no text is invisible.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Cloud.tsx
git commit -m "copy: remove em dashes and tighten AI-sounding phrasing on Cloud"
```

---

### Task 2: Pricing.tsx — background, copy, comparison table, Product schema

**Interfaces:**
- Consumes: `toSafeJsonLdString` (Plan 1, Task 5) — if Plan 1 hasn't run
  yet, inline the 4-line util directly in this file instead of importing.
- Consumes: `PLAN_META`, `formatKes` (already imported in `Pricing.tsx`
  from `../config/serviceCatalog` — no new import needed).

**Files:**
- Modify: `frontend/src/pages/Pricing.tsx`

- [ ] **Step 1: Add a toned-down background (per spec A3 — not a full
  revert of the minimal-glass decision)**

Source one Unsplash image matched to "pricing/value" imagery (abstract,
subtle, not busy — it sits behind glass cards that need to stay
legible). Save to `frontend/public/images/pricing-section-bg.webp`.

Replace (around line 170-172):

```tsx
      <section className="relative pt-10 sm:pt-16 lg:pt-24 pb-16 sm:pb-24 lg:pb-28 overflow-hidden bg-transparent">
        {/* Background intentionally removed — the universal site backdrop
            (body image in index.css) now shows through this transparent hero. */}
```

with:

```tsx
      <section className="relative pt-10 sm:pt-16 lg:pt-24 pb-16 sm:pb-24 lg:pb-28 overflow-hidden bg-transparent">
        {/* A subtle atmosphere layer behind the glass cards — the cards'
            own bg-white/60 dark:bg-white/5 backdrop-blur-md still does the
            legibility work; this only adds depth behind them instead of
            leaving the page flat. Lower opacity than other pages' hero
            treatment on purpose, since the plan cards need to stay the
            visual focus, not the backdrop. */}
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-25" style={{ backgroundImage: "url('/images/pricing-section-bg.webp')", filter: "saturate(.5) contrast(1.05)" }} />
        <div className="absolute inset-0 z-0 section-bg-wash" />
```

Confirm the section's content wrapper (the `<div className="max-w-[1440px] ...">`
immediately after) already carries `relative z-10` — it does, per the
existing `relative z-10` on that div (verify during this step; add it if
missing).

- [ ] **Step 2: Fix the confirmed em-dash/AI-tell instances**

Replace (line 116):

```tsx
    { q: "How do I pay — and in what currency?", a: "Everything is billed in Kenyan Shillings (KES). Pay by M-Pesa STK push or card from your client portal. No forex surprises." },
```

with:

```tsx
    { q: "How do I pay, and in what currency?", a: "Everything is billed in Kenyan Shillings (KES). Pay by M-Pesa STK push or card from your client portal. No forex surprises." },
```

Replace (line 119):

```tsx
    { q: "Can I add services or upgrade later?", a: "Yes — add services anytime from your portal. Each one is a clearly-priced add-on billed in KES, so you only ever pay for what you actually use." },
```

with:

```tsx
    { q: "Can I add services or upgrade later?", a: "Yes. Add services anytime from your portal. Each one is a clearly-priced add-on billed in KES, so you only ever pay for what you actually use." },
```

- [ ] **Step 3: Grep for any remaining em dashes**

```bash
grep -n "—" frontend/src/pages/Pricing.tsx
```

Fix any remaining hits per the Global Constraints rubric (11 were found
during spec grounding; Step 2 above covers the two in prose copy — the
rest, if any, may be in code comments, which are out of scope).

- [ ] **Step 4: Add a real plan-comparison table (spec C2)**

Add this component inline in `Pricing.tsx`, rendered as a new section
between the "Included in every paid plan" section and the "Managed vs DIY
comparison" section (after the closing `</section>` around line 293,
before the `<ManagedComparison />` section at line 296):

```tsx
      {/* Plan comparison — spec C2: choosing between plans shouldn't rely
          solely on each card's own feature list. Sourced from PLAN_META so
          numbers can never drift from the cards above. */}
      <section className="py-16 sm:py-24 relative z-20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-4">Side by side</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100">
              Compare plans at a glance.
            </h2>
          </div>
          <div className="overflow-x-auto rounded-3xl border border-murzak-border/50">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-black/5 dark:bg-white/5">
                  <th className="p-4 font-black text-murzak-ink dark:text-slate-100">Plan</th>
                  <th className="p-4 font-black text-murzak-ink dark:text-slate-100">Starting price</th>
                  <th className="p-4 font-black text-murzak-ink dark:text-slate-100">Best for</th>
                  <th className="p-4 font-black text-murzak-ink dark:text-slate-100">Key features</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.name} className="border-t border-murzak-border/30">
                    <td className="p-4 font-black text-murzak-ink dark:text-slate-100">{plan.name}</td>
                    <td className="p-4 font-mono text-murzak-ink dark:text-slate-100">
                      {plan.pricePrefix ? `${plan.pricePrefix} ` : ""}{plan.price}
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-400">{plan.bestFor}</td>
                    <td className="p-4 text-slate-600 dark:text-slate-400">{plan.features.slice(0, 3).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
```

(Confirm `plans[].bestFor` is populated for every `PLAN_META` entry before
this ships — it's already read into the `plans` array at line 108 from
`m.bestFor`; if any plan's `bestFor` is empty, source real copy from that
plan's existing card description rather than leaving a blank table cell.)

- [ ] **Step 5: Add `Product`/`Offer` JSON-LD (spec D3)**

Add the import near the top of `Pricing.tsx`:

```ts
import { toSafeJsonLdString } from "../utils/jsonLd";
```

Before the component's `return`, add:

```ts
  const pricingJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: plans.map((plan, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: `Murzak ${plan.name}`,
        description: plan.description,
        offers: {
          "@type": "Offer",
          price: plan.price === "Free" ? "0" : plan.price === "Custom" ? undefined : String(plan.price).replace(/[^\d]/g, ""),
          priceCurrency: "KES",
          url: "https://murzaktech.com/pricing",
        },
      },
    })),
  };
  const pricingJsonLdString = toSafeJsonLdString(pricingJsonLd);
```

Add `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pricingJsonLdString }} />`
as a sibling near the top of the component's returned JSX (inside the
existing root `<div className="bg-transparent min-h-screen">`, as its
first child).

- [ ] **Step 6: Verify**

```bash
grep -n "—" frontend/src/pages/Pricing.tsx
```

Expected: no output in prose strings (comments may remain, out of scope).

Live-check `/pricing` in both themes: background visible but subtle,
comparison table renders with real data matching the cards above, no
console errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Pricing.tsx frontend/public/images/pricing-section-bg.webp
git commit -m "feat: add Pricing background, plan comparison table, and Product JSON-LD; copy cleanup"
```

---

### Task 3: Login.tsx — background + copy

**Files:**
- Modify: `frontend/src/pages/Login.tsx`

- [ ] **Step 1: Add the background wrapper**

Source an Unsplash image matched to "secure access / data center" imagery
(consistent with the auth context). Note: `App.tsx`'s `heroImages` map
already references `/images/data-center.webp` for `login` — check whether
this file already exists in `frontend/public/images/` before sourcing a
new one; reuse it as the background-wrapper image if so, for consistency
with whatever hero treatment already expects it.

```bash
ls frontend/public/images/ | grep -i data-center
```

If it exists, use `url('/images/data-center.webp')` in the wrapper
template from Global Constraints, wrapping Login's main form section. If
it doesn't exist, source a new Unsplash image and save it to that exact
path (so `App.tsx`'s existing `heroImages.login` reference starts working
too — currently pointing at a file that may not exist, which is worth
confirming as a side effect of this task).

- [ ] **Step 2: Apply the copy rubric**

Read the file in full, identify any em dashes or AI-writing tells in
user-facing copy (form labels, helper text, error/info messages — not
validation logic), and rewrite per the Global Constraints rubric.

- [ ] **Step 3: Verify**

```bash
grep -n "—" frontend/src/pages/Login.tsx
```

Live-check `/login` in both themes, confirm the form remains fully usable
(this page has real functional state — don't let a background addition
cover or obscure the form).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Login.tsx
git commit -m "feat: add Login background treatment; copy cleanup"
```

---

### Task 4: Contact.tsx / ContactPage.tsx — background + copy

**Files:**
- Modify: `frontend/src/pages/ContactPage.tsx`
- Check: `frontend/src/pages/Contact.tsx` (confirm during this task
  whether this is the routed marketing contact page or a different
  component — e.g. a portal support-message view — before applying
  background treatment; only the public marketing contact page needs one)

- [ ] **Step 1: Confirm which file is the routed `/contact` page**

```bash
grep -n "\"/contact\"" frontend/src/App.tsx
```

Apply background + copy only to whichever file that route actually
renders.

- [ ] **Step 2: Add the background wrapper**

Source an Unsplash image matched to "Nairobi office / customer support"
imagery. Save to `frontend/public/images/contact-section-bg.webp`.

- [ ] **Step 3: Apply the copy rubric**

Read the file, identify em dashes/AI-tells in user-facing copy, rewrite
per Global Constraints.

- [ ] **Step 4: Verify**

```bash
grep -n "—" frontend/src/pages/ContactPage.tsx
```

Live-check `/contact` in both themes, confirm the contact form still
submits correctly (functional regression check, not just visual).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ContactPage.tsx frontend/public/images/contact-section-bg.webp
git commit -m "feat: add Contact background treatment; copy cleanup"
```

---

### Task 5: Checkout.tsx, Payment.tsx, ThankYou.tsx, TestRequest.tsx — background + copy

These are transactional pages with light copy footprints (mostly UI
labels and status text, not marketing prose) — group as one task since
each file's change is small.

**Files:**
- Modify: `frontend/src/pages/Checkout.tsx`
- Modify: `frontend/src/pages/Payment.tsx`
- Modify: `frontend/src/pages/ThankYou.tsx`
- Modify: `frontend/src/pages/TestRequest.tsx`

- [ ] **Step 1: For each file, add a subtle background wrapper**

These pages carry real transactional state (payment forms, order
summaries) — use a lower opacity (0.15-0.25, lower than the marketing-page
default 0.45) so the background never competes with financial
information the user needs to read carefully. Source one shared
Unsplash image for all four (consistency across the checkout flow matters
more than per-page variety here) — save as
`frontend/public/images/checkout-flow-bg.webp`.

- [ ] **Step 2: Apply the copy rubric to each file's user-facing strings**

Read each file, identify em dashes/AI-tells, rewrite per Global
Constraints. Do not touch strings that mirror backend status values
(e.g. exact invoice status labels) — those must stay byte-identical to
what the backend sends.

- [ ] **Step 3: Verify each page**

```bash
grep -n "—" frontend/src/pages/Checkout.tsx frontend/src/pages/Payment.tsx frontend/src/pages/ThankYou.tsx frontend/src/pages/TestRequest.tsx
```

Live-check each route. These are functional, revenue-critical pages —
click through an actual checkout flow (or the closest reachable state in
dev with `MOCK_FRAPPE=true`) end to end after the change, not just a
visual glance.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Checkout.tsx frontend/src/pages/Payment.tsx frontend/src/pages/ThankYou.tsx frontend/src/pages/TestRequest.tsx frontend/public/images/checkout-flow-bg.webp
git commit -m "feat: add subtle background to the checkout flow pages; copy cleanup"
```

---

### Task 6: Product subpages — MurzakPOS, MurzakERP, MurzakCRM (background + copy)

`CustomSoftware.tsx` already has the background wrapper (confirmed during
spec grounding) — handled separately in Task 7 (copy only).

**Files:**
- Modify: `frontend/src/pages/products/MurzakPOS.tsx`
- Modify: `frontend/src/pages/products/MurzakERP.tsx`
- Modify: `frontend/src/pages/products/MurzakCRM.tsx`

- [ ] **Step 1: Add the background wrapper to each**

Source one Unsplash image per product, matched to its subject (POS:
retail/checkout imagery; ERP: business operations/dashboard imagery; CRM:
customer relationship/office imagery). Save as
`frontend/public/images/pos-section-bg.webp`,
`erp-section-bg.webp`, `crm-section-bg.webp` respectively.

- [ ] **Step 2: Apply the copy rubric to each**

Read each file, identify em dashes/AI-tells, rewrite per Global
Constraints.

- [ ] **Step 3: Verify each**

```bash
grep -n "—" frontend/src/pages/products/MurzakPOS.tsx frontend/src/pages/products/MurzakERP.tsx frontend/src/pages/products/MurzakCRM.tsx
```

Live-check `/products/pos`, `/products/erp`, `/products/crm` in both
themes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/products/MurzakPOS.tsx frontend/src/pages/products/MurzakERP.tsx frontend/src/pages/products/MurzakCRM.tsx frontend/public/images/pos-section-bg.webp frontend/public/images/erp-section-bg.webp frontend/public/images/crm-section-bg.webp
git commit -m "feat: add background treatment to POS/ERP/CRM product pages; copy cleanup"
```

---

### Task 7: Home.tsx, About.tsx, Products.tsx, CustomSoftware.tsx — copy only

All four already have the correct background treatment (confirmed during
spec grounding) — this task is copy-only. Home was already deeply
reworked in the 2026-08-05 warmth/motion pass; touch only prose text here,
not layout, imagery, or motion (that spec's decisions stand).

**Files:**
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/pages/About.tsx`
- Modify: `frontend/src/pages/Products.tsx`
- Modify: `frontend/src/pages/products/CustomSoftware.tsx`

- [ ] **Step 1: Apply the copy rubric to each file**

Read each file, identify em dashes (Home: 20 found during grounding,
About: 11, Products: 6, CustomSoftware: 5) and AI-tells, rewrite per
Global Constraints.

- [ ] **Step 2: Verify each**

```bash
grep -n "—" frontend/src/pages/Home.tsx frontend/src/pages/About.tsx frontend/src/pages/Products.tsx frontend/src/pages/products/CustomSoftware.tsx
```

Live-check `/`, `/about`, `/products`, `/products/custom` in both themes —
confirm nothing about Home's existing scroll-motion/hero from the
2026-08-05 work regressed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Home.tsx frontend/src/pages/About.tsx frontend/src/pages/Products.tsx frontend/src/pages/products/CustomSoftware.tsx
git commit -m "copy: remove em dashes and AI-sounding phrasing on Home/About/Products/CustomSoftware"
```

---

### Task 8: `/for/*` subpages — background (3 of 4) + copy (all 4)

`ForLogistics.tsx` already has the background wrapper — copy only.
`ForRetail.tsx`, `ForHealthcare.tsx`, `ForServices.tsx` need both.

**Files:**
- Modify: `frontend/src/pages/for/ForRetail.tsx`
- Modify: `frontend/src/pages/for/ForHealthcare.tsx`
- Modify: `frontend/src/pages/for/ForServices.tsx`
- Modify: `frontend/src/pages/for/ForLogistics.tsx`

- [ ] **Step 1: Add background wrappers to the 3 missing pages**

Source Unsplash images matched to each vertical (retail: shop/storefront;
healthcare: clinic imagery, careful to keep it professional and not
stock-clinical/sterile in a way that reads cold; services: professional
office/consulting imagery). Save as
`frontend/public/images/for-retail-bg.webp`,
`for-healthcare-bg.webp`, `for-services-bg.webp`.

- [ ] **Step 2: Apply the copy rubric to all 4 files**

Read each, identify em dashes (ForLogistics: 3 found during grounding)
and AI-tells, rewrite per Global Constraints.

- [ ] **Step 3: Verify**

```bash
grep -n "—" frontend/src/pages/for/ForRetail.tsx frontend/src/pages/for/ForHealthcare.tsx frontend/src/pages/for/ForServices.tsx frontend/src/pages/for/ForLogistics.tsx
```

Live-check all 4 `/for/*` routes in both themes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/for/ frontend/public/images/for-retail-bg.webp frontend/public/images/for-healthcare-bg.webp frontend/public/images/for-services-bg.webp
git commit -m "feat: add background treatment to for/retail, for/healthcare, for/services; copy cleanup across all four for/* pages"
```

---

### Task 9: DeployWizard steps — background + copy

**Files:**
- Modify: `frontend/src/pages/DeployWizard/DeployWizard.tsx`
- Modify: `frontend/src/pages/DeployWizard/components/*.tsx` (as needed —
  read the directory listing first)

- [ ] **Step 1: List the actual step components**

```bash
ls frontend/src/pages/DeployWizard/components/
```

- [ ] **Step 2: Add a shared, subtle background wrapper**

Same low-opacity rationale as Task 5 (checkout flow) — this wizard has an
active build/deploy progress state that must stay legible. Add the wrapper
once at the `DeployWizard.tsx` shell level if the step components render
inside a shared layout (check this before duplicating the wrapper into
every step file). Source one Unsplash image (developer/deploy/code
imagery), save as `frontend/public/images/deploy-wizard-bg.webp`.

- [ ] **Step 3: Apply the copy rubric**

Read each step component, identify em dashes/AI-tells in user-facing
copy, rewrite per Global Constraints.

- [ ] **Step 4: Verify**

```bash
grep -rn "—" frontend/src/pages/DeployWizard/
```

Live-check the deploy wizard flow end to end (`/deploy`), confirm the
build-progress step's live log view isn't visually competing with the new
background.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DeployWizard/ frontend/public/images/deploy-wizard-bg.webp
git commit -m "feat: add subtle background to the deploy wizard; copy cleanup"
```

---

### Task 10: Shared components — Footer, Header, Faq, PlanAdvisor, ManagedComparison

Components, not routes — copy only, no background work (they render
inside whatever page's background is already in place).

**Files:**
- Modify: `frontend/src/components/Footer.tsx`
- Modify: `frontend/src/components/Header.tsx`
- Modify: `frontend/src/components/PlanAdvisor.tsx`
- Modify: `frontend/src/components/ManagedComparison.tsx`

- [ ] **Step 1: Apply the copy rubric to each**

Read each file, identify em dashes (Footer: 2, PlanAdvisor: 6,
ManagedComparison: 2 found during grounding) and AI-tells, rewrite per
Global Constraints.

- [ ] **Step 2: Verify**

```bash
grep -n "—" frontend/src/components/Footer.tsx frontend/src/components/Header.tsx frontend/src/components/PlanAdvisor.tsx frontend/src/components/ManagedComparison.tsx
```

Live-check: these render on every/most pages, so spot-check 2-3 different
routes to confirm each component still renders correctly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Footer.tsx frontend/src/components/Header.tsx frontend/src/components/PlanAdvisor.tsx frontend/src/components/ManagedComparison.tsx
git commit -m "copy: remove em dashes and AI-sounding phrasing from shared marketing components"
```

---

### Task 11: SalesModal, CloudLaunchModal, PlanServicesModal — copy only

**Files:**
- Modify: `frontend/src/components/SalesModal.tsx`
- Modify: `frontend/src/components/CloudLaunchModal.tsx`
- Modify: `frontend/src/components/PlanServicesModal.tsx`

- [ ] **Step 1: Apply the copy rubric to each**

Read each file, identify em dashes (CloudLaunchModal: 5, PlanServicesModal:
10 found during grounding) and AI-tells in user-facing copy — not in
functional logic strings (e.g. API payload keys).

- [ ] **Step 2: Verify**

```bash
grep -n "—" frontend/src/components/SalesModal.tsx frontend/src/components/CloudLaunchModal.tsx frontend/src/components/PlanServicesModal.tsx
```

Live-check: open each modal (Sales modal from a Pricing CTA, CloudLaunchModal
from Cloud's "Launch a resource" button, PlanServicesModal from a plan
card's CTA) and confirm the copy still reads correctly in context, not
just in isolation.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SalesModal.tsx frontend/src/components/CloudLaunchModal.tsx frontend/src/components/PlanServicesModal.tsx
git commit -m "copy: remove em dashes and AI-sounding phrasing from checkout/launch modals"
```

---

### Task 12: Extend and re-run the automated contrast sweep (spec A1)

This is the final task — it runs after every page above has its new
background and copy, since new backgrounds are exactly the kind of change
that can introduce a fresh contrast regression (per the 2026-08-04
precedent), and it needs to check the *final* state of every page this
plan touched.

**Files:**
- Modify: `frontend/e2e/qa-marketing.spec.ts` (extend `MARKETING_PAGES`)

- [ ] **Step 1: Extend the route list**

Replace:

```ts
const MARKETING_PAGES = ['/', '/cloud', '/products', '/about', '/pricing', '/terms', '/privacy', '/sla'];
```

with:

```ts
const MARKETING_PAGES = [
  '/', '/cloud', '/products', '/about', '/pricing', '/terms', '/privacy', '/sla',
  '/contact', '/login', '/test-request',
  '/products/pos', '/products/erp', '/products/crm', '/products/custom',
  '/for/retail', '/for/healthcare', '/for/logistics', '/for/services',
];
```

(Confirm the exact `/for/*` path segments against `pageToPath` in
`frontend/src/types.ts` before finalizing — don't guess whether it's
`/for/retail` or `/for-retail`.)

- [ ] **Step 2: Run the full MKT-01 contrast suite, both themes**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT-01"
```

- [ ] **Step 3: Also run it in light mode**

The existing `MKT-01` block only emulates dark mode (`page.emulateMedia({
colorScheme: 'dark' })`). Add a light-mode counterpart:

```ts
test.describe('MKT-01b — light-mode text contrast', () => {
  for (const path of MARKETING_PAGES) {
    test(`no near-invisible text on ${path} (light mode)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await assertNoInvisibleText(page, path);
    });
  }
});
```

```bash
cd frontend && npx playwright test qa-marketing.spec.ts -g "MKT-01"
```

- [ ] **Step 4: Fix every failure the same way the 2026-08-04 sweep did**

For each reported offender: check whether it's a theme-conditional color
on an always-dark/always-light surface (pair correctly), an unpaired
`dark:` background class, or a new stacking-context issue from a
background wrapper missing `relative z-10` on one of its sections (the
exact bug class from Global Constraints' template note). Re-run the
suite after each fix until 0 failures.

- [ ] **Step 5: Final full run**

```bash
cd frontend && npx playwright test qa-marketing.spec.ts
```

Expected: all tests pass, including the pre-existing MKT-02 through MKT-09
blocks (regression check — nothing in this plan should have broken an
existing marketing-page behavior test).

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/qa-marketing.spec.ts
git commit -m "test: extend contrast sweep to every page touched by the visual/copy plan, add light-mode coverage"
```

(If Step 4 required source fixes in specific page files, commit those in
the same pass, file by file, with a message identifying the specific bug
fixed — e.g. `fix: pair text-slate-600 with dark: variant on Contact's
always-dark card`.)
