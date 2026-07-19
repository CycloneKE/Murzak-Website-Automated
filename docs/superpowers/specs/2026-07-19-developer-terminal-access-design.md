# Developer terminal access — consent workflow & UI placement — design

## Context

"Developer access" (Enterprise-plan jailed shell into a customer's own service container) has
existed as a *marketing upsell* in the portal for a while — `Portal.tsx`'s Developer Upsell modal
lets an Enterprise customer submit a request, which today just files a support ticket. Nothing
live exists yet: the backend's terminal WebSocket handler (`server.js` ~3862) authenticates the
request end-to-end and then sends `"the developer terminal isn't wired to a real shell yet
(Phase 5.3)"` and closes. There is no frontend terminal UI at all (no xterm.js, nothing).

Reviewing this ahead of actually wiring it surfaced two gaps worth designing before any shell
ever opens for a real customer:

1. **No consent/security workflow.** Even a jailed, non-root exec inside a customer's own
   container lets them see real infrastructure details (the container's internal IP, its
   hostname, process list) that a customer has no way of knowing about ahead of time today.
   Automatic Enterprise-plan gating alone isn't enough — there should be an explicit human
   approval step and an explicit disclosure the customer has to accept.
2. **No planned UI placement.** The natural instinct is to float it (this codebase already has
   a floating pattern via `LogConsole.tsx`), but a live interactive shell deserves a fixed,
   always-visible spot in the layout rather than an overlay that can be accidentally dismissed
   or fought for screen space with other floating panels (CommandPalette, LogConsole itself).

**A genuinely useful finding from exploring this:** the broker's actual exec bridge
(`broker/index.js`, `broker/lib/dockerClient.js`) is fully implemented — real Docker
create-exec/hijacked-stream code, session caps, resize, recording, orphan reaper. The "Phase
5.3 doesn't exist" comments in `server.js`/`portalRoutes.js` are stale. What's actually still
missing to get a *live* shell working: the backend WS handler needs to connect out to the
broker instead of closing immediately, and the broker+socket-proxy stack
(`docker-compose.broker.yml`) has never been deployed on the VPS at all. Both of those, plus the
xterm.js frontend, are **explicitly out of scope for this spec** — see below.

See [[murzaktech-go-live-blockers]] for other pending ops items this shares infrastructure with
(Coolify env, VPS deploy patterns).

## Scope

**In scope:**
- Frappe schema: `terminal_access_approved_at` / `_by` and `terminal_disclosure_accepted_at` on
  Web Account.
- A staff-facing approval action in AdminInbox (a real button, not a raw Frappe-desk field edit).
- Backend: `GET /api/portal/terminal/eligibility`, `POST /api/portal/terminal/accept-disclosure`,
  and two new gate checks added to the existing mint endpoint
  (`POST /api/portal/services/:serviceId/terminal/session`).
- Frontend: an allocated (non-floating) terminal panel in the My Systems service detail page,
  rendering the not-Enterprise / pending-approval / disclosure / connecting states.

**Explicitly out of scope (separate, later sub-projects):**
- The backend WS handler actually bridging to the broker.
- Deploying `docker-compose.broker.yml` to the VPS (secrets generation, network wiring,
  `/health`+`/resolve` verification).
- The xterm.js terminal widget itself and its WebSocket client (the panel built here reaches a
  "ready to connect" state and attempts one, but today gets back the backend's existing
  "not wired yet" notice — see Error Handling).

## Data model

Three new fields on **Web Account** (Frappe custom fields, same fixture pattern as
`custom-fields-portal-invoice.json`):

| Field | Type | Set by |
|---|---|---|
| `terminal_access_approved_at` | Datetime | Staff, via the new AdminInbox action |
| `terminal_access_approved_by` | Data (staff email) | Same action, for audit |
| `terminal_disclosure_accepted_at` | Datetime | Customer, via `accept-disclosure` |

All three are read-only from the customer's side — never client-settable, consistent with this
codebase's existing rule that plan/admin gates are never trusted from client input.

## Architecture & data flow

1. Customer requests developer access via the **existing, unchanged** Developer Upsell modal →
   files a Portal Users Requests ticket (no change here).
2. Staff opens that ticket in **AdminInbox**, which now shows an **"Approve Developer Access"**
   button whenever the thread's subject matches the existing, already-distinct prefix
   `handleDeveloperUpsell` sends (`"Developer Access Request: {serviceName}"` —
   `Portal.tsx:255`) — no new tagging/categorization mechanism needed, the request already
   identifies itself. Clicking the button calls a new admin endpoint that
   stamps `terminal_access_approved_at`/`_by` and writes an audit line to the account's log,
   matching the existing `[TERMINAL] session minted by …` audit pattern already used at mint time.
3. On the customer's next visit to the service's My Systems page, the new **allocated terminal
   panel** calls `GET /api/portal/terminal/eligibility` and renders one of four states:
   - Not Enterprise → today's upsell modal, unchanged.
   - Enterprise, not yet approved → "Request submitted, awaiting approval" (reuses existing
     ticket-request copy).
   - Approved, disclosure not yet accepted → the disclosure text renders **inline in the panel**
     (never a floating modal) — what the customer is about to get access to (a shell inside
     their own container), what they'll be able to see (its internal IP/hostname/processes),
     that sessions are recorded, and acceptable-use expectations — with an explicit "I
     understand and agree" action that calls `POST /api/portal/terminal/accept-disclosure`.
   - Approved + accepted → the panel attempts to mint a session and connect (see Error Handling
     for what happens today, before the broker bridge exists).

**UI placement:** the panel lives in a fixed section of the service detail page (My Systems),
below the Deployments card from the earlier milestone — always occupies its own layout space,
never overlays other content, and is scoped to whichever service the customer is already
viewing (no separate route, no new tab, no floating overlay).

## Error handling

- **Mint endpoint** keeps its existing checks (plan gate, service must be an active coolify-lane
  job) and gains two more, each with a distinct `code` so the frontend renders the right state
  instead of a generic failure:
  - `403 { code: "not_approved" }`
  - `403 { code: "disclosure_required" }`
- **`accept-disclosure`** is idempotent — re-calling it just refreshes the timestamp; never
  errors on a double-click or retry.
- **`eligibility`** degrades the same way this codebase's other soft-fail reads do: any
  Frappe/backend hiccup returns `{ enterprisePlan: false, approved: false,
  disclosureAccepted: false }` rather than a 500 that blanks the whole service page.
- **Panel-side**, the backend's current "not wired to a real shell yet" WS notice is rendered as
  an honest, expected state — **"Terminal access is finalizing — check back soon"** — not an
  error banner, since it isn't actually broken, just not built yet (the separate, later
  sub-project this spec deliberately excludes).
- **Admin approve action** reuses the existing job/account audit-log trail rather than
  introducing a new logging mechanism.

## Testing

- **Backend**: new unit tests in the existing mock-store style (`provisioning.test.js`'s
  pattern) covering the mint endpoint's two new gates in isolation and combined with the
  existing plan/service checks, `accept-disclosure` idempotency, and `eligibility`'s safe
  degradation on a simulated Frappe error.
- **Frontend**: no component-test harness exists in this codebase; verify live in the browser
  across all four panel states, same approach used for every other feature this session.
- **Full suite**: `npm test` (backend), `tsc --noEmit`, and `vite build` must stay green — same
  bar as every other change shipped this session.

## Follow-on work (not this spec)

1. Deploy `docker-compose.broker.yml` to the VPS: generate `BROKER_API_KEY`/`BROKER_SIGNING_KEY`,
   wire the backend onto the broker's internal network, verify `/health` and the `/resolve`
   diagnostic endpoint before enabling anything customer-facing.
2. Wire the backend's WS handler to actually bridge to the broker's `/exec` WebSocket instead of
   closing immediately.
3. Build the xterm.js widget + WebSocket client that mounts inside the panel this spec defines,
   replacing the "finalizing — check back soon" state with a live shell.
