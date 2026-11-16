# Portal Coolify-Inspired Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the customer portal (`/portal/*`) a flat, Coolify-style shell and one page per service where all of that service's actions live.

**Architecture:** A portal-scoped token layer (`.portal` CSS variables, light + dark) and a small set of building blocks in `frontend/src/components/portal/ui/`. `PortalShell.tsx` is rebuilt from them; each tab is then converted in place. Data and actions stay in `usePortalState.tsx`; only presentation and routing change. No backend change.

**Tech Stack:** React 19, react-router-dom 6, Tailwind CSS 4 (`@theme` in `src/index.css`, dark via `html.dark`), lucide-react, cmdk, Playwright e2e (`npm run test:e2e`, dev server on :5175). There is no unit-test runner; tests are Playwright specs.

**Spec:** `docs/superpowers/specs/2026-11-16-portal-coolify-inspired-redesign-design.md`

## Global Constraints

- Branch: new branch `claude/portal-coolify-redesign` off `origin/master` (run `git fetch` first). Never on `claude/mail-pro-5gb`.
- All paths below are relative to `frontend/`.
- Only `/portal/*` changes. Storefront, checkout, payment, login untouched. No backend change. No new features.
- Inside `.portal`: no `backdrop-blur`, no gradient backgrounds, no glow, no `hover:scale-*`, no `font-black`, no `uppercase` except sidebar group labels.
- Corners: panels `rounded-lg` (8px), buttons/inputs `rounded-md` (6px), pills/avatars `rounded-full`.
- Accent is `--p-accent` (`#882ffd` light, `#a66bff` dark). Cyan `murzak-accent` is not used inside `.portal`.
- New components use `--p-*` tokens only; no paired `dark:` classes in new code.
- Customer-facing labels never say "production", "environment", "container", or "resource".
- Labels: Overview → "Home", Resources → "Your services", Deployments → "Updates", Support → "Help". Route paths and `Tab` ids are unchanged.
- A section or nav item renders only when it has real content for that account/service.
- Every interactive element is at least 40px high at `pointer: coarse`; visible focus ring (`outline: 2px solid var(--p-accent)`).
- Errors shown to users go through `toUserMessage()` from `src/services/errors.ts`.
- Existing e2e text contracts must keep passing: `h1` contains "Client Dashboard" on the pre-onboarding screen; "No Active Services"; "Your account is ready. Here's what you can add."

## Review Focus

1. **Old deep links** — `/portal/cloud?service=<id>` (used by Checkout, ThankYou, MurzakPOS, emails) must land on the new service page, not the list. Test in Task 4.
2. **Unknown or foreign service id** in `/portal/cloud/<id>` — show a "We couldn't find that service" panel with a link back, not a blank page or crash. Test in Task 4.
3. **Payment-due / suspended account** — the banner and its "Pay now" / "Pay & restore" button stay visible on every portal page, including a service page at phone width. Test in Task 3.
4. **Long names** — a 60-character service name or domain truncates in sidebar, breadcrumb and table without pushing the primary action off-screen. Test in Task 5.
5. **Phone width (375px)** — drawer opens/closes, section menu scrolls horizontally, no horizontal page scroll. Test in Tasks 3 and 4.

---

### Task 1: Tokens and building blocks

**Files:**
- Modify: `src/index.css` (append a `.portal` block)
- Create: `src/components/portal/ui/Panel.tsx`, `PageHeader.tsx`, `StatusPill.tsx`, `PButton.tsx`, `Field.tsx`, `DataTable.tsx`, `Banner.tsx`, `Modal.tsx`, `index.ts`
- Create: `src/pages/portal/tabs/UiPreview.tsx` (dev-only route `/portal/_ui`, registered only when `import.meta.env.DEV`)
- Test: `e2e/portal-redesign.spec.ts`

**Interfaces — Produces:**
- CSS variables on `.portal` and `html.dark .portal`: `--p-bg`, `--p-panel`, `--p-panel-2`, `--p-sidebar`, `--p-border`, `--p-text`, `--p-muted`, `--p-accent`, `--p-accent-fg`, `--p-accent-soft`, `--p-success`, `--p-warning`, `--p-danger`. Light: bg `#f7f7f9`, panel `#ffffff`, sidebar `#fbfbfd`, border `#e4e4ea`, text `#14141a`, muted `#5f6170`. Dark: bg `#0c0c10`, panel `#15151b`, sidebar `#120f1a`, border `#27272f`, text `#ececf1`, muted `#9a9aa8`.
- `Panel({ title?, description?, actions?, tone?: "default" | "danger", children })`
- `PageHeader({ title, description?, actions? })` — renders the page `h1`.
- `StatusPill({ tone: "ok" | "progress" | "warn" | "bad" | "idle", children })`
- `statusTone(status: string): StatusPill tone` in `StatusPill.tsx` — "Active"→ok, "Setting up"→progress, "Awaiting Payment"→warn, "Failed"/"Suspended"→bad, else idle.
- `PButton({ variant?: "primary" | "secondary" | "danger" | "ghost", size?: "sm" | "md", icon?, loading?, ...buttonProps })`
- `Field({ label, hint?, error?, children })`
- `DataTable<T>({ columns: { key: string; header: string; cell: (row: T) => ReactNode; primary?: boolean }[], rows: T[], rowKey: (row: T) => string, onRowClick?, empty: ReactNode })` — table at `md+`, stacked cards below.
- `Banner({ tone: "danger" | "warning" | "info", icon?, children, action?: { label: string; onClick: () => void } })`
- `Modal({ open, onClose, title, children, footer?, busy? })` — rendered with `createPortal` to `document.body` inside a `.portal` wrapper; Escape and backdrop click close unless `busy`.

- [ ] **Step 1:** Create the branch (`git fetch && git switch -c claude/portal-coolify-redesign origin/master`), then cherry-pick nothing; copy the spec and this plan onto it.
- [ ] **Step 2:** Write failing test `ui preview renders every building block in light and dark`: visit `/portal/_ui`, assert one of each block is visible; assert `getComputedStyle` of a `Panel` has `border-radius: 8px` and `backdrop-filter: none`; toggle `html.dark` and assert panel background is `rgb(21, 21, 27)`.
- [ ] **Step 3:** Run `npx playwright test e2e/portal-redesign.spec.ts` — expect FAIL (route missing).
- [ ] **Step 4:** Add tokens and implement the blocks and `UiPreview`.
- [ ] **Step 5:** Run the spec — expect PASS. Run `npm run build` — expect no type errors.
- [ ] **Step 6:** Commit `feat(portal): design tokens and building blocks`.

### Task 2: Navigation model

**Files:**
- Modify: `src/pages/portal/usePortalState.tsx` (`allMenuItems` ~L684, command palette titles ~L748)
- Modify: `src/pages/portal/types.ts`

**Interfaces — Produces:**
- `type NavGroup = { id: "main" | "services" | "account" | "staff"; label?: string; items: NavItem[] }`
- `type NavItem = { id: Tab; label: string; icon: React.ReactNode; badge?: number }`
- `navGroups: NavGroup[]` from `usePortal()` — main: Home; services ("Services"): Your services, Domains, Databases*, Storage*, Updates*; account ("Account"): Billing, Help, Settings; staff ("Staff"): Admin*. Starred items keep today's conditions. Groups with no items are omitted.
- `allMenuItems` stays exported as `navGroups.flatMap(g => g.items)` until Task 3 removes its last use.

- [ ] **Step 1:** Write failing test `sidebar shows grouped, plainly-labelled navigation` (logged-in fixture from `qa-portal.spec.ts`): expects links "Home", "Your services", "Domains", "Billing", "Help", "Settings"; expects no text "Resources" or "Overview" in the nav.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `navGroups`; rename command-palette entries to the same labels.
- [ ] **Step 4:** Leave test failing on group headings until Task 3 (labels part passes). Commit `feat(portal): grouped navigation model`.

### Task 3: Shell — sidebar, top bar, user menu, banner slot

**Files:**
- Create: `src/components/portal/ui/SideNav.tsx`, `TopBar.tsx`, `UserMenu.tsx`
- Modify: `src/pages/portal/PortalShell.tsx` (rewrite L66–335: chrome and banner; route table and modals keep their logic)
- Modify: `src/components/portal/CommandPalette.tsx` (tokens only)

**Interfaces:**
- Consumes: `navGroups`, `Banner`, `PButton`, `StatusPill`.
- Produces:
  - `SideNav({ groups, activeTab, onSelect, collapsed, onToggleCollapsed, onSearch, footer })` — 232px wide, 64px when collapsed; collapsed state persisted in `localStorage["murzak_portal_nav_collapsed"]` inside try/catch; drawer below `lg`.
  - `TopBar({ crumbs: { label: string; to?: string }[], status?: ReactNode, actions?: ReactNode, onOpenMenu })`
  - `UserMenu({ user, theme, onToggleTheme, onSettings, onLogout })` — popover with name, plan, account status, theme switch, Settings, Log out.
  - Context value `setTopBar(extra: { crumbs?: Crumb[]; status?: ReactNode; actions?: ReactNode } | null)` from `usePortal()` so a page can add crumbs, a status pill and a primary action.
- The root element gets `className="portal"`. The gradient backdrop div (L226) and the fixed mobile menu button (L242) are removed; the menu button lives in `TopBar`.
- Banner logic (L254–330) keeps its conditions, order, copy and button targets; only the `banner()` renderer changes to `<Banner>`.
- The `h1` on each page comes from that page's `PageHeader`; the shell renders none.

- [ ] **Step 1:** Extend the spec: group headings "Services" and "Account" visible; collapsing the sidebar hides labels and survives reload; user menu opens and contains "Log out" and a theme switch; at 375px the drawer opens from the top-bar menu button and closes on navigation; `document.documentElement.scrollWidth <= innerWidth`.
- [ ] **Step 2:** Add test `payment-due banner stays visible with its button` using route interception to return an account with a due subscription invoice; assert "Pay now" is visible on `/portal/overview` and `/portal/billing` at 1280px and 375px.
- [ ] **Step 3:** Run — FAIL.
- [ ] **Step 4:** Implement the three components and rewrite the shell chrome.
- [ ] **Step 5:** Run `npx playwright test e2e/portal-redesign.spec.ts e2e/qa-portal.spec.ts e2e/auth-guards.spec.ts` — PASS.
- [ ] **Step 6:** Commit `feat(portal): Coolify-style shell`.

### Task 4: Service page

**Files:**
- Create: `src/components/portal/ui/SectionNav.tsx`
- Create: `src/pages/portal/tabs/service/ServicePage.tsx`, `sections.ts`, `GeneralSection.tsx`, `AddressSection.tsx`, `UpdatesSection.tsx`, `ActivitySection.tsx`, `UsageSection.tsx`, `SettingsSection.tsx`, `BillingSection.tsx`, `DangerSection.tsx`
- Modify: `src/pages/portal/usePortalState.tsx` (L284 `cloudServiceId`, L151 navigate)
- Modify: `src/pages/portal/PortalShell.tsx` (routes), `src/pages/portal/tabs/CloudTab.tsx`
- Delete after move: `src/pages/portal/tabs/ResourceDetail.tsx`
- Modify links: `tabs/BillingTab.tsx`, `tabs/DeploymentsTab.tsx`, `tabs/PortalLanding.tsx`, `tabs/ResourceListTab.tsx`

**Interfaces:**
- Consumes: `setTopBar`, `Panel`, `PButton`, `StatusPill`, `statusTone`, `Modal`.
- Produces:
  - Routes `cloud/:serviceId` and `cloud/:serviceId/:section`. `cloud?service=<id>` renders `<Navigate replace to={servicePath(id)} />`.
  - `servicePath(id: string, section?: SectionId): string` in `src/pages/portal/helpers.ts`.
  - `cloudServiceId` = route param, falling back to `?service=`.
  - `type SectionId = "general" | "address" | "updates" | "activity" | "usage" | "settings" | "billing" | "danger"`
  - `sectionsFor(ctx: { service: SelectedService; deployable: boolean; hasLogs: boolean; hasUsage: boolean; adminEnabled: boolean }): { id: SectionId; label: string; icon: ReactNode }[]` — labels "General", "Web address", "Updates", "Activity log", "Usage", "Settings", "Billing", "Danger zone". General, Billing and Danger zone always; the rest only when their flag is true.
  - `SectionNav({ items, active, onSelect })` — vertical list at `lg+`, horizontally scrolling tab row below.
- Each section file receives the JSX that exists today in `ResourceDetail.tsx` for that concern (provisioning states L219–330 → General; deployments L331+ → Updates; scale/stop L460–500 → Settings/Danger), rebuilt from the blocks. Behaviour and copy of honest provisioning states are unchanged.
- `ServicePage` calls `setTopBar` with crumbs `Home / Your services / <name>`, the status pill, and primary action "Open" (link to `cloudAccessUrl`, only when it is set and status is Active).
- `biz-web-hosting` renders `WebsiteHostingDashboard` inside the General section frame.
- Unknown id: `Panel` titled "We couldn't find that service" with a "Back to your services" button.
- `BillingSection` lists only this service's subscription and invoices, with "Pay now" → `/payment/:docName`.
- `DangerSection` holds Stop (existing confirm modal) and Delete (existing `onRequestDelete` flow).

- [ ] **Step 1:** Write failing tests: `old ?service= link redirects to the service page`; `unknown service id shows a not-found panel`; `service page lists only sections that apply` (intercepted account with one non-git Active service: no "Updates"); `section menu scrolls horizontally at 375px with no page overflow`; `danger zone stop opens the confirm dialog`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement routing, `sectionsFor`, `ServicePage` and sections; update links to `servicePath`.
- [ ] **Step 4:** Run the spec plus `e2e/qa-byoa-deploy.spec.ts e2e/customer-journey.spec.ts e2e/cloud-launch.spec.ts` — PASS.
- [ ] **Step 5:** Commit `feat(portal): one page per service with section menu`.

### Task 5: Home and list screens

**Files:**
- Modify: `src/pages/portal/tabs/OverviewTab.tsx`, `CloudTab.tsx`, `ResourceListTab.tsx`, `DomainsTab.tsx`, `DeploymentsTab.tsx`, `PortalLanding.tsx`
- Modify: `src/components/portal/ResourceList.tsx`, `EmptyState.tsx`, `ActivityTimeline.tsx`, `MetricCard.tsx`, `ServiceHealthCard.tsx`, `ResourceUtilizationCard.tsx`, `SecurityOverviewCard.tsx`, `AddDomainModal.tsx`

**Interfaces — Consumes:** `PageHeader`, `Panel`, `DataTable`, `StatusPill`, `statusTone`, `PButton`, `Modal`, `servicePath`.

- Home order: `PageHeader` → "Needs your attention" panel (services with status Awaiting Payment, Setting up, Failed; hidden when empty) → "Your services" `DataTable` (Name, Type, Address, Status) → Recent activity. Metric cards render only for values that are defined. Row click → `servicePath(id)`; Awaiting Payment rows → `/portal/billing` as today.
- Per-row Stop buttons on `ResourceListTab` (L135) and `ServiceHealthCard` actions are removed; rows link to the service page.
- Each list page: one "Add" primary button in `PageHeader.actions`; empty state copy unchanged.

- [ ] **Step 1:** Write failing tests: `home lists services in a table and links to the service page`; `a 60-character service name truncates without hiding the Open button` (intercepted account; assert the button's bounding box is inside the viewport at 1280px and 375px); `empty account still shows "No Active Services"`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Convert the screens. **Step 4:** Run the spec and `e2e/qa-portal.spec.ts e2e/products-domains.spec.ts e2e/products-databases.spec.ts` — PASS.
- [ ] **Step 5:** Commit `feat(portal): home and list screens on the new system`.

### Task 6: Billing, Help, Settings, modals, Admin shell

**Files:**
- Modify: `src/pages/portal/tabs/BillingTab.tsx`, `SupportTab.tsx`, `ProfileTab.tsx`
- Modify: `src/components/portal/ChangePasswordCard.tsx`, `OnboardingWizard.tsx`, `LogConsole.tsx`, `ScalingSettings.tsx`, `DeveloperTerminalPanel.tsx`, `src/components/AddonsModal.tsx` (portal usage only)
- Modify: `src/pages/portal/PortalShell.tsx` (stop / delete / upgrade / developer modals L405–630 → `Modal`)
- Modify: `src/pages/admin/AdminTabs.tsx` (tab strip tokens only)

- Billing: plan panel is a flat `Panel` (the dark gradient card L73 goes); invoices in a `DataTable` (Invoice, Date, Amount, Status, action); included services link to `servicePath(id, "billing")`.
- Forms: `Field` label-above layout, one Save `PButton` per `Panel`.
- Modal copy, confirm-text rules and handlers are unchanged.

- [ ] **Step 1:** Write failing tests: `invoice table shows Pay now for an unpaid invoice`; `delete dialog still requires the typed confirmation`; `no element inside .portal has backdrop-filter or text-transform: uppercase outside nav group labels` (walk the DOM on each portal route in both themes).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Convert. **Step 4:** Run full `npm run test:e2e` — PASS (note any pre-existing failures against `origin/master` separately).
- [ ] **Step 5:** Commit `feat(portal): billing, help, settings and dialogs on the new system`.

### Task 7: Visual check and cleanup

- [ ] **Step 1:** `grep -rn "backdrop-blur\|font-black\|rounded-2xl\|rounded-3xl\|rounded-4xl\|murzak-accent" src/pages/portal src/components/portal` — expect no matches; fix any.
- [ ] **Step 2:** Remove `UiPreview` route guard check: confirm `/portal/_ui` 404s in `npm run build && npm run preview`.
- [ ] **Step 3:** Start the dev preview and screenshot every portal route in light, dark and at 375px; fix contrast or overflow found.
- [ ] **Step 4:** Tab through Home and a service page; every focused control shows the accent outline.
- [ ] **Step 5:** Commit `chore(portal): remove leftovers from the old style`.
