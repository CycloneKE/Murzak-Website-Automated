# Portal Discoverability & Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resource stop/delete controls reachable from the resource
list without a two-step drill-down, and tighten the portal's visual
density where it currently reads as empty — per Part C of
`docs/superpowers/specs/2026-08-23-site-polish-visual-copy-design.md`
(C1, C3 — C2 was Pricing-page work, already covered in the marketing plan).

**Architecture:** `ResourceListTab` and `OverviewTab` both already consume
the single shared `usePortal()` context (`PortalContext.tsx` →
`usePortalState.tsx`), which already exposes `handleServiceHealthAction`,
`onRequestDelete`, and `pendingServiceAction` — the exact same functions
`ResourceDetail.tsx`'s Danger Zone already calls. This plan wires existing
functions into a new UI surface; it does not add new backend calls or
state.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS, `lucide-react` icons
(already the icon library used throughout the portal).

## Global Constraints

- No fabricated data anywhere — matches the existing "honest status, never
  a fake-looking empty dashboard" principle already established in
  `ResourceDetail.tsx` (spec C3). Every element added must come from real
  state already available via `usePortal()`.
- Apply the same copy rubric as the marketing-visual-copy plan (remove em
  dashes, cut AI-writing tells) to any portal copy touched — two instances
  already found in `OverviewTab.tsx` during grounding.
- `onRequestDelete`'s `sourceTab` parameter is typed
  `"overview" | "billing"` (no third option) — use `"overview"` from any
  new call site outside those two tabs, matching the existing convention
  in `ResourceDetail.tsx`.

---

### Task 1: Quick actions on `ResourceListTab` cards (spec C1)

**Interfaces:**
- Consumes: `handleServiceHealthAction(action: string, id: string)`,
  `onRequestDelete(s: SelectedServiceView, sourceTab?: "overview" | "billing")`,
  `pendingServiceAction: {id: string; action: string} | null` — all
  already defined in `usePortalState.tsx` and already exposed through
  `usePortal()`.

**Files:**
- Modify: `frontend/src/pages/portal/tabs/ResourceListTab.tsx`

- [ ] **Step 1: Confirm the current file (read again — this plan was
  scoped against it, re-read immediately before editing since other work
  may have touched it)**

```bash
cat frontend/src/pages/portal/tabs/ResourceListTab.tsx
```

- [ ] **Step 2: Add the new imports and context fields**

Replace:

```tsx
import React, { useEffect, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import EmptyState from "../../../components/portal/EmptyState";
import { usePortal } from "../PortalContext";
import { type SelectedServiceView } from "../../../types";
import { fetchAllServiceActivity, ProvisioningActivityEntry } from "../../../services/serviceActivity";
import { RealStateBadge } from "../../../components/portal/resourceState";
```

with:

```tsx
import React, { useEffect, useState } from "react";
import { ArrowRight, Plus, Square, Trash2 } from "lucide-react";
import EmptyState from "../../../components/portal/EmptyState";
import { usePortal } from "../PortalContext";
import { type SelectedServiceView } from "../../../types";
import { fetchAllServiceActivity, ProvisioningActivityEntry } from "../../../services/serviceActivity";
import { RealStateBadge } from "../../../components/portal/resourceState";
```

Replace:

```tsx
  const { navigate, openAddonsModal } = usePortal();
```

with:

```tsx
  const { navigate, openAddonsModal, handleServiceHealthAction, onRequestDelete, pendingServiceAction } = usePortal();
```

- [ ] **Step 3: Restructure each card from `<button>` to a keyboard-accessible
  `<div>` (a nested quick-action `<button>` inside a `<button>` is invalid
  HTML and produces broken/undefined click behavior in some browsers)**

Replace the card's opening tag and its `Manage` footer:

```tsx
          {services.map((s) => (
            <button
              key={s.serviceId}
              type="button"
              onClick={() => navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`)}
              className="text-left bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-6 shadow-lg hover:border-murzak-accent/40 transition group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-black text-murzak-ink dark:text-slate-100 truncate">{s.name}</p>
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1.5">
                    {s.tier || "—"}
                    {s.isAddon ? " • Add-on" : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${
                    STATUS_TONE[s.status] || STATUS_TONE["Awaiting Payment"]
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-3">
                <RealStateBadge svc={s} job={jobsByService[s.serviceId]} loading={loading} />
              </div>
              <span className="mt-5 inline-flex items-center gap-2 text-micro font-black uppercase text-murzak-accent">
                Manage <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          ))}
```

with:

```tsx
          {services.map((s) => {
            const isPendingStop = pendingServiceAction?.id === s.serviceId && pendingServiceAction.action === "stop";
            return (
            <div
              key={s.serviceId}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                }
              }}
              className="text-left bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-6 shadow-lg hover:border-murzak-accent/40 transition group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-black text-murzak-ink dark:text-slate-100 truncate">{s.name}</p>
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1.5">
                    {s.tier || "—"}
                    {s.isAddon ? " • Add-on" : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${
                    STATUS_TONE[s.status] || STATUS_TONE["Awaiting Payment"]
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-3">
                <RealStateBadge svc={s} job={jobsByService[s.serviceId]} loading={loading} />
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-micro font-black uppercase text-murzak-accent">
                  Manage <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
                {/* Quick actions — same handlers ResourceDetail's Danger Zone
                    already calls, surfaced here so stopping or deleting a
                    resource doesn't require navigating in twice first. */}
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {s.status === "Active" && (
                    <button
                      type="button"
                      title="Stop service"
                      disabled={isPendingStop}
                      onClick={() => handleServiceHealthAction("stop", s.serviceId)}
                      className="p-2 rounded-xl border border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition disabled:opacity-50"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Delete service"
                    onClick={() => onRequestDelete(s, "overview")}
                    className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
```

- [ ] **Step 4: Confirm the actual delete confirmation still fires**

`onRequestDelete` opens the existing delete-confirm modal (state already
lives in `usePortalState` — this task doesn't touch that modal). Verify
by reading `usePortalState.tsx` around line 768-790 (already read during
planning) — `s.status === "Active"` sets `deleteTarget`, which some parent
component (`PortalShell.tsx`, per the existing pattern) renders as a
confirm dialog. No new modal needed here.

- [ ] **Step 5: Live-check**

Navigate to `/portal/cloud` (or wherever `ResourceListTab` is used —
confirm via `grep -rn "ResourceListTab" frontend/src/pages/portal/`),
confirm:
- Clicking a card body still navigates into the resource detail view.
- Clicking the stop/delete icons does NOT navigate (event doesn't bubble).
- Stop button only shows for Active services.
- Delete opens the existing confirm modal, not an immediate delete.
- Tab-to-card + Enter still navigates (keyboard accessibility check for
  the new `role="button"` div).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/portal/tabs/ResourceListTab.tsx
git commit -m "feat: surface stop/delete quick actions on resource list cards (spec C1)"
```

---

### Task 2: Fix em-dash copy instances found in the portal during grounding

**Files:**
- Modify: `frontend/src/pages/portal/tabs/OverviewTab.tsx`

- [ ] **Step 1: Fix the two confirmed instances**

Replace (around line 190-191):

```tsx
              {selectedServices.length === 0
                ? "No services deployed yet"
                : hasDegradedService
                  ? `${onlineServiceCount}/${selectedServices.length} services online — some need attention`
                  : `${onlineServiceCount}/${selectedServices.length} services online — all healthy`}
```

with:

```tsx
              {selectedServices.length === 0
                ? "No services deployed yet"
                : hasDegradedService
                  ? `${onlineServiceCount}/${selectedServices.length} services online, some need attention`
                  : `${onlineServiceCount}/${selectedServices.length} services online, all healthy`}
```

- [ ] **Step 2: Sweep the rest of the portal for the same character**

```bash
grep -rln "—" frontend/src/pages/portal/ frontend/src/components/portal/
```

For each file listed, open it, distinguish the legitimate `—` placeholder
usage (e.g. `s.tier || "—"` — a real UI convention for "no value," leave
untouched) from actual prose using it as a dash (rewrite per the copy
rubric: period, comma, or restructured sentence).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/portal/ frontend/src/components/portal/
git commit -m "copy: remove em dashes from portal prose (placeholder dashes left untouched)"
```

---

### Task 3: Portal density pass on `OverviewTab` (spec C3)

This is a visual-judgment task, not a mechanical one — same category as
choosing background photography in the marketing plan. The dashboard
already has real structure (status band, 4 metric cards, system health
grid, security + resource-utilization cards, file upload) — the "empty"
feeling is most likely concentrated in the various empty/sparse states
that show when an account has few or no active services, not a missing
section.

**Files:**
- Modify: `frontend/src/pages/portal/tabs/OverviewTab.tsx`
- Read (context, don't modify unless the empty-state text itself needs
  the copy rubric applied): `frontend/src/components/portal/EmptyState.tsx`,
  `frontend/src/components/portal/MetricCard.tsx`

- [ ] **Step 1: Read the current empty/sparse states**

```bash
cat frontend/src/components/portal/EmptyState.tsx frontend/src/components/portal/MetricCard.tsx
```

- [ ] **Step 2: Benchmark against real dashboard patterns**

Look at how Vercel's project overview, Linear's issue list, and
DigitalOcean's resource dashboard handle low-content states — the common
pattern is: don't leave a large empty card with just an icon and one line
of text; instead surface a short, concrete next action *and* useful
context even at zero services (e.g. "Your account is ready — here's what
you can add" with 2-3 concrete service suggestions, not just a generic
"Deploy Services" button). Use this as a reference point, not something to
copy verbatim — Murzak's voice and actual catalog should drive the
specifics.

- [ ] **Step 3: Tighten the zero/low-service empty state**

In `OverviewTab.tsx`, the current empty state (around line 258-267) is:

```tsx
              <div className="text-center py-12 rounded-[2rem] border border-dashed border-murzak-border bg-black/5">
                <Server className="w-8 h-8 text-slate-500 mx-auto mb-4" />
                <p className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-2">No Active Services</p>
                <p className="text-micro text-slate-600 dark:text-slate-400 max-w-xs mx-auto mb-6">You don't have any infrastructure running yet.</p>
                <button onClick={goToAddServices} className="px-6 py-3 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-105 transition-all inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Deploy Services
                </button>
              </div>
```

Replace the single generic CTA with 2-3 concrete, clickable service
suggestions sourced from the real catalog (`getService`/`serviceCatalog.ts`,
already imported in this file) — e.g. the same "quick add" pattern already
used elsewhere in the portal for add-ons, not new data. Read
`frontend/src/config/serviceCatalog.ts` to pick 2-3 real, commonly-added
services (do not invent service names or prices) and render them as small
clickable chips/cards above or below the existing button, each calling
`goToAddServices` or the equivalent add-on flow already wired for that
purpose.

- [ ] **Step 4: Verify no fabricated data**

Confirm every string/number added in Step 3 traces back to a real field
in `usePortal()`'s returned state or `serviceCatalog.ts` — none hardcoded
as a guess.

- [ ] **Step 5: Live-check with a zero-service test account**

If `MOCK_FRAPPE=true` is set in `backend/.env` (per
`murzaktech-repo-layout` — dev runs auto-authenticate against an
in-memory mock store), confirm the mock account's service list can be
emptied for this check, or use whatever existing dev affordance shows the
zero-service state. Confirm the new suggestions render correctly and each
one's click target actually starts the add-service flow.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/portal/tabs/OverviewTab.tsx
git commit -m "feat: replace generic empty-service state with concrete catalog suggestions (spec C3)"
```
