# Marketing Visual Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the sparse icon-and-one-line-of-text sections on `MurzakERP.tsx`, `Cloud.tsx`, and `Products.tsx` with hand-coded JSX dashboard mockups and real, de-branded ERP documentation content, matching the visual-proof pattern already established by `MurzakCRM.tsx`/`MurzakPOS.tsx` (mockup heroes) and `CustomSoftware.tsx` (inline code-viz panel).

**Architecture:** One new shared presentational component (`MetricBar`) for the bar-meter visual reused across two mockup panels. Everything else is inline JSX added directly to the three page files, following the codebase's existing convention of building mockups in-place rather than as external image assets.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS (existing token scale — `text-micro`/`text-label`/etc. from prior revamp work), lucide-react icons. No new dependencies.

## Global Constraints

- No occurrence of "Frappe" or "ERPNext" (any casing) anywhere in new content — this is a white-label product. Verified by grep in the final task.
- No new image assets — every mockup is hand-coded JSX (per spec decision; no image-generation tool available, no live product to screenshot).
- Mockup panels use fixed dark styling (`bg-slate-900`, cyan accent, white/slate text) regardless of page theme — matching the existing ERP Tax Settings panel and CRM/POS mockup precedent. They are NOT `dark:`-conditional; they always render dark, same as their siblings already in the codebase.
- This project has no frontend unit test runner (Playwright e2e only, no component-level tests). "Tests" in this plan mean: `tsc --noEmit` (type check), `npm run build` (production build), and `grep` assertions on rendered content — the same verification approach used throughout this project's prior revamp work.
- Follow the existing rem-based type scale (`text-micro`, `text-label`, etc.) — never reintroduce `text-[Npx]` arbitrary values.

---

### Task 1: Shared `MetricBar` component

**Files:**
- Create: `frontend/src/components/mockups/MetricBar.tsx`

**Interfaces:**
- Consumes: nothing (leaf component).
- Produces: default export `MetricBar(props: { label: string; percent: number; valueLabel?: string; tone?: "accent" | "warning" | "success" })` — a horizontal bar-meter row (label + value on top, colored fill bar below). `percent` is clamped to [0, 100]. `valueLabel` overrides the auto-generated `${percent}%` text (used later for non-percentage displays like uptime). `tone` defaults to `"accent"`. Consumed by Task 2 and Task 4.

- [ ] **Step 1: Create the component file**

```tsx
import React from "react";

interface MetricBarProps {
  label: string;
  percent: number; // 0-100
  valueLabel?: string; // overrides the auto `${percent}%` text
  tone?: "accent" | "warning" | "success";
}

const TONE_CLASSES: Record<NonNullable<MetricBarProps["tone"]>, string> = {
  accent: "bg-murzak-accent",
  warning: "bg-orange-500",
  success: "bg-murzak-success",
};

// Bar-meter used inside dark hand-coded "screenshot" mockup panels (ERP
// hero, Cloud resource monitor). Always renders on a dark track — these
// mockups are fixed-dark regardless of page theme, matching the existing
// CRM/POS mockups and the ERP Tax Settings panel.
export default function MetricBar({ label, percent, valueLabel, tone = "accent" }: MetricBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-micro font-bold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="text-micro font-black text-white">{valueLabel ?? `${clamped}%`}</span>
      </div>
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${TONE_CLASSES[tone]}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors mentioning `MetricBar.tsx` (the file isn't imported anywhere yet, so this just confirms the file itself is syntactically and structurally valid TypeScript — `tsc` still parses every file under `include` even if unimported).

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add frontend/src/components/mockups/MetricBar.tsx
git commit -m "feat: add shared MetricBar component for dashboard mockups"
```

---

### Task 2: MurzakERP.tsx — hero business-snapshot mockup

**Files:**
- Modify: `frontend/src/pages/products/MurzakERP.tsx`

**Interfaces:**
- Consumes: `MetricBar` from `../../components/mockups/MetricBar` (Task 1).
- Produces: nothing new consumed by later tasks — this is a leaf UI change.

- [ ] **Step 1: Add the `Check` icon and `MetricBar` imports**

In `frontend/src/pages/products/MurzakERP.tsx`, change:

```tsx
import { ArrowRight, ArrowUpRight, Boxes, Users, Briefcase, Calculator, ShieldCheck, Factory, BookOpen, Layers } from 'lucide-react';
```

to:

```tsx
import { ArrowRight, ArrowUpRight, Boxes, Users, Briefcase, Calculator, ShieldCheck, Factory, BookOpen, Layers, Check } from 'lucide-react';
import MetricBar from '../../components/mockups/MetricBar';
```

- [ ] **Step 2: Turn the hero into a two-column grid and add the mockup panel**

Find this block (the entire `{/* Hero Section */}` section):

```tsx
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">Murzak ERP</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            One system for your whole business. <span className="text-murzak-gradient">Made for Kenya.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl leading-relaxed">
            The first ERP purpose-built for how Kenyan companies actually do business. Stop bridging gaps between spreadsheets and legacy accounting software.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => onNavigate('/pricing?configure=biz-erp-light')}>
              Start from {formatKes(serviceMonthlyKes('biz-erp-light'))}/mo <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => setSalesOpen(true)}>
              Book a Demo
            </Button>
          </div>
        </div>
      </section>
```

Replace it with:

```tsx
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
              <span className="text-micro font-black uppercase text-murzak-accent">Murzak ERP</span>
            </div>
            <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
              One system for your whole business. <span className="text-murzak-gradient">Made for Kenya.</span>
            </h1>
            <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl leading-relaxed">
              The first ERP purpose-built for how Kenyan companies actually do business. Stop bridging gaps between spreadsheets and legacy accounting software.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-4">
              <Button onClick={() => onNavigate('/pricing?configure=biz-erp-light')}>
                Start from {formatKes(serviceMonthlyKes('biz-erp-light'))}/mo <ArrowRight size={18} />
              </Button>
              <Button variant="outline" onClick={() => setSalesOpen(true)}>
                Book a Demo
              </Button>
            </div>
          </div>

          {/* Business snapshot mockup — hand-coded JSX, not a screenshot */}
          <div className="lg:col-span-5">
            <div className="rounded-[2rem] bg-slate-900 border border-murzak-border shadow-2xl p-6 sm:p-7">
              <div className="flex items-center justify-between mb-5">
                <span className="text-micro font-black uppercase tracking-widest text-slate-500">Business Snapshot</span>
                <span className="flex items-center gap-1.5 text-micro font-black uppercase text-murzak-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-murzak-accent animate-pulse" /> Live
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-500 mb-1">Revenue</div>
                  <div className="text-sm font-black text-white">KES 4.2M</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-500 mb-1">Expenses</div>
                  <div className="text-sm font-black text-white">KES 2.8M</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-500 mb-1">Net</div>
                  <div className="text-sm font-black text-murzak-accent">KES 1.4M</div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <MetricBar label="Warehouse — Nairobi" percent={72} tone="accent" />
                <MetricBar label="Warehouse — Mombasa" percent={38} tone="warning" />
              </div>

              <div className="flex items-center gap-2.5 rounded-xl bg-murzak-accent/10 border border-murzak-accent/20 px-4 py-3">
                <Check size={16} className="text-murzak-accent shrink-0" />
                <span className="text-body-sm font-bold text-slate-200">3 payroll runs processed this quarter</span>
              </div>
            </div>
          </div>
        </div>
      </section>
```

- [ ] **Step 3: Type-check and build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 4: Visual check**

Start the dev server (`npm run dev` in `frontend/`, or use the project's existing `murzak-frontend` preview config) and open `/products/erp`. Confirm:
- The hero is now two columns on desktop (≥1024px): copy on the left, dark mockup panel on the right.
- The panel shows Revenue/Expenses/Net stat tiles, two warehouse bars (Nairobi mostly full, Mombasa noticeably lower with an orange fill), and the payroll chip with a checkmark.
- On mobile width (<1024px) the panel stacks below the copy (grid collapses via `lg:grid-cols-12` → single column, matching the same responsive behavior `Cloud.tsx`'s hero already uses).

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add frontend/src/pages/products/MurzakERP.tsx
git commit -m "feat: add business-snapshot hero mockup to Murzak ERP page"
```

---

### Task 3: MurzakERP.tsx — module grid documentation expansion

**Files:**
- Modify: `frontend/src/pages/products/MurzakERP.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Replace the `modules` array's single-line `desc` with a `bullets` array, sourced from real ERPNext documentation and rewritten de-branded**

Find:

```tsx
  const modules = [
    { icon: <Calculator size={20} />, title: "Accounting", desc: "General ledger, accounts payable/receivable, invoicing, and tax." },
    { icon: <Boxes size={20} />, title: "Inventory", desc: "Multi-warehouse stock tracking, stock valuation, and serial numbers." },
    { icon: <Users size={20} />, title: "HR & Payroll", desc: "Employee records, attendance, leaves, and KRA-compliant payroll runs." },
    { icon: <Factory size={20} />, title: "Manufacturing", desc: "Bill of materials, production planning, and shop floor control." },
    { icon: <Briefcase size={20} />, title: "CRM", desc: "Lead tracking, sales pipelines, and customer communications." },
    { icon: <BookOpen size={20} />, title: "Projects", desc: "Task management, time tracking, and project profitability analysis." },
  ];
```

Replace with:

```tsx
  const modules = [
    {
      icon: <Calculator size={20} />,
      title: "Accounting",
      bullets: [
        "Auto-generated general ledger from every sale, purchase, and journal entry — drill down to trace any transaction",
        "Multi-currency, multi-branch chart of accounts with consolidated reporting",
        "VAT/PAYE-ready tax ledgers, plus KRA eTIMS integration",
        "Real-time Balance Sheet, P&L, Trial Balance, and Cash Flow reports",
      ],
    },
    {
      icon: <Boxes size={20} />,
      title: "Inventory",
      bullets: [
        "Live stock levels across every warehouse, updated the moment a sale or delivery happens",
        "Item variants, batch/serial tracking, and automatic valuation",
        "Scheduled stock audits that flag discrepancies before they become losses",
        "Reports on stock value, movement trends, and slow-moving inventory",
      ],
    },
    {
      icon: <Users size={20} />,
      title: "HR & Payroll",
      bullets: [
        "Full employee lifecycle — onboarding, transfers, promotions, exit interviews",
        "Geolocation-enabled attendance, configurable leave policies and KE public holidays",
        "Custom salary structures with PAYE/NHIF/NSSF-ready payroll runs and payslips",
        "Expense claims and advances with multi-level approval, synced straight to accounting",
      ],
    },
    {
      icon: <Factory size={20} />,
      title: "Manufacturing",
      bullets: [
        "Bills of materials define exactly what a finished product needs",
        "Work orders and job cards track every production step in real time",
        "Production planning that schedules runs against real demand and resource availability",
        "Quality checks built into the process, not bolted on after",
      ],
    },
    {
      icon: <Briefcase size={20} />,
      title: "CRM",
      bullets: [
        "Capture and nurture leads through a visible pipeline, stage by stage",
        "Opportunity tracking with revenue forecasting",
        "Full customer history — every call, meeting, and quote in one record",
        "Sales performance reports your team can actually act on",
      ],
    },
    {
      icon: <BookOpen size={20} />,
      title: "Projects",
      bullets: [
        "Task boards, milestones, and deadlines your team can see at a glance",
        "Time tracking that rolls straight into project cost and profitability",
        "Client-ready progress reporting without a separate spreadsheet",
      ],
    },
  ];
```

- [ ] **Step 2: Update the render to list bullets instead of a single description line**

Find:

```tsx
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {modules.map((m, i) => (
            <div key={i} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7 hover:border-murzak-accent/40 transition-colors">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">
                {m.icon}
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{m.title}</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
```

Replace with:

```tsx
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {modules.map((m, i) => (
            <div key={i} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7 hover:border-murzak-accent/40 transition-colors h-full flex flex-col">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5 w-fit">
                {m.icon}
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-3">{m.title}</h3>
              <ul className="space-y-2">
                {m.bullets.map((b, bi) => (
                  <li key={bi} className="flex items-start gap-2 text-body-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                    <span className="text-murzak-accent mt-1.5 shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
```

- [ ] **Step 3: Type-check and build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: both succeed. (This step will also catch it if any other part of the file still references the old `m.desc` field — there shouldn't be any, since the modules grid was the only consumer, but the type error would be immediate and clear if there were.)

- [ ] **Step 4: Verify no de-branding leak**

Run: `cd frontend && grep -in "frappe\|erpnext" src/pages/products/MurzakERP.tsx`
Expected: no output (grep exits non-zero / prints nothing).

- [ ] **Step 5: Visual check**

Reload `/products/erp` in the browser. Confirm each of the 6 module cards now shows a title and a bulleted list (3-4 items) instead of a single description line, and that the cards in each grid row remain visually aligned (CSS Grid's default `align-items: stretch` should make same-row cards match height automatically).

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add frontend/src/pages/products/MurzakERP.tsx
git commit -m "feat: expand ERP module cards with detailed feature documentation"
```

---

### Task 4: Cloud.tsx — resource monitor mockup

**Files:**
- Modify: `frontend/src/pages/Cloud.tsx`

**Interfaces:**
- Consumes: `MetricBar` from `../components/mockups/MetricBar` (Task 1).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add the `MetricBar` import**

In `frontend/src/pages/Cloud.tsx`, change:

```tsx
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';
```

to:

```tsx
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';
import MetricBar from '../components/mockups/MetricBar';
```

- [ ] **Step 2: Restructure the "Managed for you" section header into a two-column layout with the mockup, keeping the 4-card grid below it**

Find:

```tsx
      {/* Managed for you */}
      <section className="py-16 lg:py-24 relative overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-3">Fully managed</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The parts you'd rather not think about.</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-w-md">
              Real engineers watching real infrastructure — not a support queue that routes you overseas.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {managed.map((c) => (
              <div key={c.t} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                <h3 className="text-base font-black text-murzak-ink dark:text-slate-100 mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
```

Replace with:

```tsx
      {/* Managed for you */}
      <section className="py-16 lg:py-24 relative overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 items-center mb-12">
            <div className="lg:col-span-7">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-3">Fully managed</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The parts you'd rather not think about.</h2>
              <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-w-md">
                Real engineers watching real infrastructure — not a support queue that routes you overseas.
              </p>
            </div>

            {/* Resource monitor mockup — hand-coded JSX, not a screenshot */}
            <div className="lg:col-span-5">
              <div className="rounded-[2rem] bg-slate-900 border border-murzak-border shadow-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-micro font-black uppercase tracking-widest text-slate-500">Resource Monitor</span>
                  <span className="rounded-full bg-murzak-success/15 text-murzak-success text-micro font-black uppercase px-2.5 py-1">99.97% uptime</span>
                </div>
                <div className="space-y-3.5 mb-5">
                  <MetricBar label="CPU" percent={34} tone="accent" />
                  <MetricBar label="RAM" percent={58} tone="accent" />
                  <MetricBar label="Disk" percent={22} tone="accent" />
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-murzak-success animate-pulse shrink-0" />
                  <span className="text-body-sm font-bold text-slate-200">Watched 24/7 — last 30 days</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {managed.map((c) => (
              <div key={c.t} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                <h3 className="text-base font-black text-murzak-ink dark:text-slate-100 mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
```

- [ ] **Step 3: Type-check and build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 4: Visual check**

Reload `/cloud` in the browser. Confirm:
- The "Fully managed" heading now sits beside a dark resource-monitor panel on desktop (≥1024px), with the 4-icon-card grid still present in full width below both.
- The panel shows a "99.97% uptime" pill, three bar-meters (CPU/RAM/Disk) with plausible low-to-mid fill levels, and the "Watched 24/7" status row with a pulsing dot.
- On mobile the panel stacks below the heading text, same responsive pattern as the rest of the site's two-column hero sections.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add frontend/src/pages/Cloud.tsx
git commit -m "feat: add resource-monitor mockup to Cloud managed-hosting section"
```

---

### Task 5: Products.tsx — hub preview strips

**Files:**
- Modify: `frontend/src/pages/Products.tsx`

**Interfaces:**
- Consumes: nothing new (bespoke, no `MetricBar` — these are single-stat chips, not bar-meters).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add `previewLabel`/`previewValue` fields to the `businessSystems` array**

Find:

```tsx
  const businessSystems = [
    { title: "Murzak POS", desc: "Multi-branch point of sale, inventory tracking, and M-Pesa integration.", path: "pos", priceId: "biz-pos-inventory" },
    { title: "Murzak ERP", desc: "Accounting, HR, and inventory tailored for Kenyan compliance.", path: "erp", priceId: "biz-erp-light" },
    { title: "Murzak CRM & Helpdesk", desc: "Track leads, manage support tickets, and integrate WhatsApp.", path: "crm", priceId: "biz-crm-helpdesk" }
  ];
```

Replace with:

```tsx
  const businessSystems = [
    { title: "Murzak POS", desc: "Multi-branch point of sale, inventory tracking, and M-Pesa integration.", path: "pos", priceId: "biz-pos-inventory", previewLabel: "Today's total", previewValue: "KES 24,180" },
    { title: "Murzak ERP", desc: "Accounting, HR, and inventory tailored for Kenyan compliance.", path: "erp", priceId: "biz-erp-light", previewLabel: "Net this month", previewValue: "KES 1.4M" },
    { title: "Murzak CRM & Helpdesk", desc: "Track leads, manage support tickets, and integrate WhatsApp.", path: "crm", priceId: "biz-crm-helpdesk", previewLabel: "Open pipeline", previewValue: "12 deals" }
  ];
```

- [ ] **Step 2: Render a small preview chip inside each card**

Find:

```tsx
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-8 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 hover:border-murzak-accent/40 transition-all flex flex-col h-full">
                  <h3 className="text-xl font-black mb-3 text-murzak-ink dark:text-slate-100">{item.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 flex-grow">{item.desc}</p>
                  <div className="text-murzak-accent text-sm font-bold flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 text-xs font-mono uppercase">From {formatKes(serviceMonthlyKes(item.priceId))}/mo</span>
                    <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">View <ArrowRight size={14} /></span>
                  </div>
               </div>
```

Replace with:

```tsx
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-8 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 hover:border-murzak-accent/40 transition-all flex flex-col h-full">
                  <h3 className="text-xl font-black mb-3 text-murzak-ink dark:text-slate-100">{item.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 flex-grow">{item.desc}</p>
                  <div className="rounded-xl bg-slate-900 px-4 py-3 mb-5">
                    <div className="text-micro font-bold uppercase text-slate-500 mb-1">{item.previewLabel}</div>
                    <div className="text-sm font-black text-murzak-accent">{item.previewValue}</div>
                  </div>
                  <div className="text-murzak-accent text-sm font-bold flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 text-xs font-mono uppercase">From {formatKes(serviceMonthlyKes(item.priceId))}/mo</span>
                    <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">View <ArrowRight size={14} /></span>
                  </div>
               </div>
```

- [ ] **Step 3: Type-check and build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 4: Visual check**

Reload `/products` in the browser. Confirm each of the 3 "Ready-Made Systems" cards (POS, ERP, CRM & Helpdesk) now shows a small dark preview chip (label + value) between the description and the price/view row, and that all 3 cards remain equal height in the grid.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add frontend/src/pages/Products.tsx
git commit -m "feat: add product preview chips to Products hub page"
```

---

### Task 6: Final verification sweep

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full type-check and production build**

Run: `cd frontend && npx tsc --noEmit -p . && npm run build`
Expected: both succeed with zero errors.

- [ ] **Step 2: De-branding grep across all touched files**

Run: `cd frontend && grep -rin "frappe\|erpnext" src/pages/products/MurzakERP.tsx src/pages/Cloud.tsx src/pages/Products.tsx src/components/mockups/MetricBar.tsx`
Expected: no output.

- [ ] **Step 3: Chromium e2e navigation smoke test**

Run: `cd frontend && npx playwright test e2e/navigation.spec.ts --project=chromium --reporter=line`
Expected: all 6 tests pass (this suite loads the homepage and navigates to Cloud, Products, Pricing, About, and legal pages from the footer — it will catch any rendering crash introduced by this plan's changes).

- [ ] **Step 4: Dark-mode visual pass**

With the dev server running, open `/products/erp`, `/cloud`, and `/products`. Toggle dark mode (the sun/moon control in the header). Confirm the three new mockup panels look identical in both themes (they use fixed `bg-slate-900` styling, not `dark:` classes, so they should NOT change — only the surrounding page chrome should shift between light and dark). Confirm no light-mode-only white flash or unstyled flicker on the panels themselves.

- [ ] **Step 5: Commit (only if any fixes were needed in this task)**

If steps 1-4 all passed cleanly with no code changes required, there is nothing to commit for this task — it's a pure verification gate. If a fix was needed, stage exactly the files touched and commit with a message describing the fix, e.g.:

```bash
cd "C:\Users\joesy\Desktop\MURZAK\murzaktech.com"
git add <fixed files>
git commit -m "fix: <what was wrong and how it was fixed>"
```
