# Visual proof for sparse marketing sections — design

## Context

A prior revamp pass fixed typography, dark mode, accessibility, and image performance across the marketing site and portal. The remaining complaint: several product pages have large stretches of "empty real estate" — icon-and-one-line-of-text card grids with no visual proof that the product actually does what the copy claims. The user asked to fill that space with screenshots of systems, AI computation, and dashboards that work hand-in-hand with the copy, plus richer documentation content for Murzak ERP sourced from real product documentation — without ever naming the underlying platform Murzak white-labels.

Scope is marketing/product pages only (not the authenticated portal, which was already addressed in the prior pass).

## What exists today

Two established visual-proof patterns already live in the codebase, both hand-coded JSX (no image assets):

- **Static-feel dashboard mockups as hero images**: `MurzakCRM.tsx` (a kanban pipeline board) and `MurzakPOS.tsx` (a POS checkout screen) each have a polished, dark-navy/cyan-accent mockup as their hero visual — built as real PNGs (`crm-kanban.png`, `pos-dashboard.png`), not JSX.
- **Hand-coded "live panel" mockups inline**: `MurzakERP.tsx`'s "Deep Dive" section (a small Tax Settings panel) and `CustomSoftware.tsx`'s "Deep Dive: Code viz" section (a syntax-highlighted code snippet) are both built from real divs/spans/icons — no external image, fully theme-aware, brand-consistent.

**Gap found**: `MurzakERP.tsx` has no hero mockup at all (unlike CRM/POS), and its 6-module grid is bare icon + one-line description. `Cloud.tsx`'s "Managed for you" section describes 24/7 monitoring in prose only, with nothing tangible. `Products.tsx` (the hub page) links to ERP/POS/CRM with plain icon cards, previewing nothing about what each product looks like.

No live Murzak product exists yet to screenshot, and no image-generation tool is available in this session — so all new visual proof is built the second way: hand-coded JSX mockups, extending the existing pattern rather than introducing a new one.

## Decisions made in brainstorming

1. **Scope**: marketing/product pages only (Products, MurzakERP, Cloud). Portal excluded — already handled in a prior pass.
2. **Visual approach**: hand-coded JSX mockups (matches existing ERP Tax Settings panel / CustomSoftware code viz precedent), not static images. No new image assets, fully dark-mode aware for free via existing `dark:` classes.
3. **Priority pages**: MurzakERP (biggest gap), Cloud (hosting), Products (hub preview). Home page AI/automation showcase was considered but explicitly deprioritized — out of scope for this pass.
4. **Documentation placement**: expand `MurzakERP.tsx`'s existing module grid in place (not a new dedicated docs page/route). Content sourced from real ERPNext documentation (fetched live from docs.frappe.io / frappe.io during brainstorming), rewritten in Murzak's own plain-spoken voice, with zero references to the underlying platform's name anywhere in the output.
5. **ERP hero mockup depth**: multi-panel composite snapshot (P&L strip + stock levels + payroll status in one panel) over a single focused view — matches the page's own "one system, everything connects" headline.

## Design

### 1. MurzakERP.tsx — hero mockup

A new JSX-built "business snapshot" panel placed beside the hero headline (mirroring the two-column hero layout CRM/POS use, but as a coded panel instead of an `<img>`). Three compact sub-panels stacked or grid-arranged inside one card:

- **P&L strip**: Revenue / Expenses / Net (KES), styled as a 3-column mini-stat row.
- **Stock levels**: 2-3 item rows with a small horizontal bar showing stock level vs. reorder threshold (reuses the visual language of the portal's `ResourceUtilizationCard` bar treatment for consistency).
- **Payroll status chip**: e.g. "3 payroll runs processed this quarter" with a checkmark, small and unobtrusive.

Visual treatment matches the existing CRM/POS mockup aesthetic: dark card (`bg-slate-900` / `#0a0f1e`-ish), cyan accent highlights, rounded-2xl, subtle shadow — consistent with `MurzakERP.tsx`'s own existing Tax Settings panel styling so the page doesn't feel like two different design systems.

### 2. MurzakERP.tsx — module grid documentation expansion

Each of the 6 existing module cards (`Accounting`, `Inventory`, `HR & Payroll`, `Manufacturing`, `CRM`, `Projects`) grows from one description line to 3-4 concrete capability bullets. Content, sourced from real ERPNext documentation and de-branded:

- **Accounting**: Auto-generated general ledger from every sale, purchase, and journal entry — drill down to trace any transaction. Multi-currency, multi-branch chart of accounts with consolidated reporting. VAT/PAYE-ready tax ledgers, plus KRA eTIMS integration. Real-time Balance Sheet, P&L, Trial Balance, and Cash Flow reports.
- **Inventory**: Live stock levels across every warehouse, updated the moment a sale or delivery happens. Item variants, batch/serial tracking, and automatic valuation. Scheduled stock audits that flag discrepancies before they become losses. Reports on stock value, movement trends, and slow-moving inventory.
- **HR & Payroll**: Full employee lifecycle — onboarding, transfers, promotions, exit interviews. Geolocation-enabled attendance, configurable leave policies and KE public holidays. Custom salary structures with PAYE/NHIF/NSSF-ready payroll runs and payslips. Expense claims and advances with multi-level approval, synced straight to accounting.
- **Manufacturing**: Bills of materials define exactly what a finished product needs. Work orders and job cards track every production step in real time. Production planning that schedules runs against real demand and resource availability. Quality checks built into the process, not bolted on after.
- **CRM**: Capture and nurture leads through a visible pipeline, stage by stage. Opportunity tracking with revenue forecasting. Full customer history — every call, meeting, and quote in one record. Sales performance reports your team can actually act on.
- **Projects**: Task boards, milestones, and deadlines your team can see at a glance. Time tracking that rolls straight into project cost and profitability. Client-ready progress reporting without a separate spreadsheet.

Cards stay a scannable grid — no accordion/click-to-expand. Card height grows to fit the bullet list; grid remains `sm:grid-cols-2 lg:grid-cols-3`.

### 3. Cloud.tsx — resource monitor mockup

A small hand-coded panel in the "Managed for you" section (which currently has copy only, no visual): CPU / RAM / Disk gauges (reusing the same bar-meter visual language as #1) plus an uptime chip ("99.97% — last 30 days") and a "Watched 24/7" badge. Placed as a supporting visual next to or below the existing copy in that section, sized modestly (not a full hero) since this section already has a heading and description — the mockup is corroboration, not the headline act.

### 4. Products.tsx — hub preview strips

Each of the 3 "Ready-Made Systems" cards (Murzak POS / Murzak ERP / Murzak CRM & Helpdesk) gains a condensed 2-3 metric preview strip in the same visual language as that product's full mockup (e.g. ERP card gets a tiny P&L number, POS card gets a tiny cart total, CRM card gets a tiny pipeline count) — a glance-preview of what the full product page shows, not a full mockup. Kept small and consistent in height across all 3 cards so the grid doesn't become lopsided.

## Non-goals

- No changes to the authenticated portal (already covered in a prior pass).
- No Home-page AI/Murzaker showcase (explicitly deprioritized this round).
- No new dedicated documentation page/route — everything expands in place on `MurzakERP.tsx`.
- No static image assets — everything is hand-coded JSX, matching the existing precedent.

## Verification

- `tsc --noEmit` and `vite build` clean.
- Visual check of all 3 touched pages in both light and dark mode (mockups must be theme-aware, matching the pattern set by the existing ERP Tax Settings panel).
- Confirm zero occurrences of "Frappe" or "ERPNext" anywhere in the new content (`grep -ri frappe\|erpnext` across the touched files).
- Chromium e2e navigation smoke test still passes.
