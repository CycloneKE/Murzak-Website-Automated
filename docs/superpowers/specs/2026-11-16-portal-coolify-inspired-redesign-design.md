# Customer portal redesign, inspired by Coolify

Date: 2026-11-16. Status: awaiting approval.

## Intent

The customer portal (`/portal/*`) should look and navigate like Coolify's
console: calm, flat, dense enough to scan, with an obvious place for
everything. It must stay easy for a non-technical business owner. Coolify
is the reference for look and structure, not for wording.

Today the portal is the opposite in style (blurred glass, 2xl-4xl corners,
all-caps heavy labels, gradient backdrop) and its actions are scattered: a
service's controls live partly on Overview, partly on Billing, partly on
the service's own page.

## Goals

1. A Coolify-like shell: compact grouped sidebar, breadcrumb top bar, user
   menu at the bottom of the sidebar.
2. Every service (app, database, storage, hosting) has one page of its own,
   with a section menu, where all of its actions live.
3. One small set of shared building blocks so every screen looks the same.
4. Works in light and dark, and on a phone.

## Non-goals

- The public storefront, checkout, payment and login pages.
- New features or any backend change. Nothing is added that does not
  already work today.
- A theme picker, page-width or navigation-style settings (Coolify's
  Profile page). The existing light/dark toggle stays.
- Redesigning the inside of the staff Admin screens. They get the new
  shell and tokens only.

## Anti-goals (failure even if it "works")

- Developer jargon in customer-facing labels ("production", "environment",
  "container", "resource").
- A section that is empty, fake, or leads nowhere. If a service type has no
  logs, it has no Logs section.
- Payment or "restore service" prompts becoming harder to find than today.
- Density that hurts touch: no tap target under 40px high.

## Approaches considered

| Approach | Trade-off |
|---|---|
| Restyle only | Fast, low risk; scattered actions stay scattered. |
| **Restyle + navigation (chosen by Joe, 2026-11-16)** | Bigger; touches every tab; delivers the part of Coolify that makes it intuitive. |
| Rebuild the portal from scratch on a component library | Cleanest result; throws away working, tested flows. Rejected. |

## Look

All calls below are Claude's unless marked.

- **Surfaces:** flat. No backdrop blur, no gradient wash, no glow, no
  hover-scale inside the portal. Panels are a solid surface with a 1px
  border. Shadows only on popovers and modals.
- **Corners:** 8px panels, 6px buttons and inputs, full-round only for
  status pills and avatars.
- **Type:** sentence case everywhere. Weights 500/600; no `font-black`.
  Small uppercase is kept for one thing only: sidebar group labels.
  Page title 20px, section title 14px semibold, body 14px, help text 13px.
- **Colour:** neutral greys carry the UI. Murzak purple (`brand1 #882ffd`)
  is the only accent: active nav item, primary button, focus ring, links.
  This replaces cyan as the portal accent. Green/amber/red are reserved for
  status.
- **Dark:** near-black page (`#0c0c10`), panels one step lighter, sidebar
  with a faint purple tint (as in Coolify's dark console).
  **Light:** white panels on `#f7f7f9`.
- **Tokens:** a portal-scoped set (`--p-bg`, `--p-panel`, `--p-border`,
  `--p-text`, `--p-muted`, `--p-accent`, ...) defined once for light and
  once for dark, so components never need paired `dark:` classes. This
  removes the class of dark-mode bugs fixed in August and September.

## Shell

```
+--------------------+------------------------------------------------------+
| Murzak             | Home / Your services / Shop ERP   ● Running  [Open ↗]|
| [ Search  Ctrl+K ] +------------------------------------------------------+
|                    |                                                      |
| ▣ Home             |   (page)                                             |
| SERVICES           |                                                      |
| ▣ Your services    |                                                      |
| ▣ Domains          |                                                      |
| ▣ Databases *      |                                                      |
| ▣ Storage *        |                                                      |
| ▣ Updates *        |                                                      |
| ACCOUNT            |                                                      |
| ▣ Billing          |                                                      |
| ▣ Help        (2)  |                                                      |
| ▣ Settings         |                                                      |
| STAFF *            |                                                      |
| ▣ Admin       (1)  |                                                      |
|                    |                                                      |
| (J) Joe S.      ⌄  |                                                      |
+--------------------+------------------------------------------------------+
* shown only when it applies, exactly as today
```

- **Sidebar:** 232px, icon in a small bordered tile + label, 36px rows
  (40px on touch). Collapses to an icon rail with the toggle beside the
  user menu; choice remembered per browser. On phones it is a drawer.
- **Labels:** "Overview" → Home, "Resources" → Your services,
  "Deployments" → Updates, "Support" → Help. Routes do not change.
- **Search** opens the existing command palette.
- **User menu** (bottom): name, plan, account status, light/dark switch,
  Settings, Log out. Replaces the account card and the big red log-out
  button.
- **Top bar:** breadcrumb on the left; on a service page, its status pill
  and one primary action on the right. The existing single status-banner
  slot (trial, payment due, suspended) stays directly under the top bar,
  restyled as a flat strip, with the same priority order and buttons.
- The per-service sub-list under "Resources" in today's sidebar is
  removed; the services list page and search replace it.

## A service's own page

Route: `/portal/cloud/:serviceId/:section?`. The old
`/portal/cloud?service=<id>` links redirect to it.

```
Home / Your services / Shop ERP                  ● Running   [Open app ↗]
+----------------+--------------------------------------------------------+
| ▣ General      |  General                                               |
| ▣ Web address  |  +--------------------------------------------------+  |
| ▣ Updates *    |  | Name        Shop ERP                             |  |
| ▣ Activity log*|  | Address     https://shop.apps.murzaktech.tech  ⧉ |  |
| ▣ Usage *      |  | Plan        Biashara · renews 12 Dec             |  |
| ▣ Settings *   |  +--------------------------------------------------+  |
| ▣ Billing      |                                                        |
| ---            |                                                        |
| ▣ Danger zone  |                                                        |
+----------------+--------------------------------------------------------+
```

- Sections are built from what already exists for that service and nothing
  else: General (status, address, honest provisioning states), Web address
  (domains), Updates (deploy history, git apps only), Activity log (logs),
  Usage (real metrics or hidden), Settings (env vars, scaling, terminal;
  only when their kill switches are on), Billing (this service's
  subscription and invoices, with Pay now), Danger zone (stop, delete).
- Stop/restart, pay, and delete controls that today sit on Overview and
  Billing move here. Overview and Billing keep a link to the service.
- On phones the section menu becomes a horizontally scrolling tab row
  under the top bar.
- Website Hosting keeps its existing dashboard content, placed inside the
  same frame.

## Other screens

- **Home:** a "Needs your attention" list (unpaid, setting up, failed),
  then "Your services" as a table (name, type, address, status), then
  recent activity. The four metric cards stay only where the number is
  real.
- **Your services / Databases / Storage / Domains:** one row per item on
  desktop, stacked cards on phones, with a single "Add" button top right
  and a helpful empty state.
- **Billing, Help, Settings:** same content in the new panels; forms use a
  label-above-field layout with one Save button per panel.
- **Modals:** flat panel, 8px corners, plain dimmed backdrop.

## Building blocks (new, in `components/portal/ui/`)

`Panel`, `PageHeader`, `StatusPill`, `PButton` (primary / secondary /
danger / ghost), `Field`, `DataTable` (rows collapse to cards), `SideNav`,
`SectionNav`, `TopBar`, `UserMenu`, `Banner`, `Modal`. Screens are rebuilt
from these; one-off class strings are removed as each screen is converted.

## Order of work

Each step leaves the portal working and can ship alone.

1. Tokens + building blocks + shell (sidebar, top bar, user menu, banner).
2. Service page: new route, section menu, moving actions onto it.
3. Home and list screens.
4. Billing, Help, Settings, modals; Admin picks up shell and tokens.
5. Check: existing Playwright specs pass; every screen viewed in light,
   dark and at phone width; keyboard focus visible everywhere.

Work happens on a new branch off `origin/master`, not on
`claude/mail-pro-5gb`.

## Left to the builder

Exact grey values, icon choices, spacing scale, and how `usePortalState`
is trimmed as actions move.
