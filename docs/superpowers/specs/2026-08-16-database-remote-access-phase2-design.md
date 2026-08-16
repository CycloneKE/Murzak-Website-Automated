# Database Engine Remote Access (Phase 2)

Date: 2026-08-16

## Problem

The database engine fix ([2026-08-16-database-engine-provisioning-fix-design.md](2026-08-16-database-engine-provisioning-fix-design.md))
deliberately deferred real external ("remote") access — a customer connecting from their own SQL
client — as phase 2, because it's a genuinely different problem from "run the correct database
software": Coolify's reverse proxy routes HTTP traffic by hostname, but raw DB protocols
(3306/5432/27017/6379) need actual TCP port exposure on the box's one shared public IP, which means a
port-allocation scheme across customers plus a real security decision about opening database ports to
the internet.

This spec is that phase 2.

## Decisions made during brainstorming

1. **Free for all four existing products, not a new paid tier.** External access costs no extra
   RAM/compute — it's a firewall/port change, not new infrastructure — so gating it behind a new
   charge would mean billing for infrastructure already sold. `"Remote access"` goes back into the
   catalog highlights (undoing the copy correction from phase 1, now that it's true).
2. **One shared port pool across all four engines**, not per-engine ranges. The box has one IP either
   way; only the port varies per customer.
3. **Open access by default** — strong generated password only, no mandatory TLS, no IP allowlist.
   Matches how most budget shared-DB hosting works, and avoids a cert-management/allowlist-UI build
   this phase doesn't need. The tradeoff (credentials/data cross the network without transport
   encryption unless the client opts into TLS itself) is named here, not solved.
4. **No automated migration for existing customers.** Coolify's "services" kind (what these deploy
   as) has no existing redeploy-with-new-compose action in this lane. Phase 2 applies to purchases
   from this point forward; existing customers need a staff-driven recreate — a named limitation, not
   built tooling.

## Design

### Port allocation

New module `backend/services/provisioning/dbPortAllocator.js`, modeled directly on
`provisioningService.js`'s existing `getReservedRamMb` pattern: query active/running Provisioning
Jobs filtered to `category = "Database Hosting"`, parse each job's already-assigned `externalPort` out
of its stored `access` JSON, and return the lowest free port in a configured range —
`DB_EXTERNAL_PORT_RANGE_START` (default 33000) to `DB_EXTERNAL_PORT_RANGE_END` (default 33999).

### Compose change

The existing "NO host port publish" rule in `coolify.js` was specifically about port 80/443 colliding
with Coolify's own reverse proxy (documented at length in the existing code comments). A unique
per-customer port in the 33000s range doesn't collide with anything, given the allocator guarantees
uniqueness. `DB_ENGINE_CONFIG`'s compose block gains a `ports:` mapping:
`ports: [{target: <enginePort>, published: <allocatedPort>}]` — the one part of this lane's compose
generation that has never published a host port before.

### Reusing `access.host`/`access.port` — no frontend changes

Phase 1's `access.host` was already explicitly an honest best-effort guess (the internal Docker
resource name, flagged "not independently verified reachable from another customer's stack"). Phase 2
changes what values populate those same two fields: a new `DB_PUBLIC_HOST` env var (the box's public
hostname or IP — one-time DNS setup, same category as `APP_DOMAIN_BASE`) for `host`, and the allocated
port for `port`. `DatabaseConnectionPanel` and the `/database/connection` route already display
exactly these fields — the customer-facing UI becomes accurate the moment the backend starts writing
real values into them. Zero frontend changes required.

### Firewall

One-time ops prerequisite: the box's firewall needs 33000-33999 opened for inbound TCP. Same category
of setup as the wildcard DNS record `appDomain.js` already assumes — not something this code can do
for itself, and not attempted here.

### Security posture

Open access: the existing generated password (from phase 1's `generateRandomSecret`) is the only
protection. No mandatory TLS, no IP allowlist. This is a deliberate scope decision, not an oversight —
both are real hardening options for a future pass if this product's risk profile changes.

### Existing customers

Not retroactively upgraded by this change. A customer who bought `db-mysql` before this ships keeps
their phase-1 (internal-only) container until a staff member recreates it. No migration script is part
of this spec.

### Catalog copy

`db-mysql`/`db-postgres`/`db-mongo` get `"Remote access"` restored to their highlights, replacing
`"Auto-generated credentials"` (which stays true but is no longer the most relevant highlight to lead
with). `db-redis` never had this highlight even before phase 1 (its highlights were always
`["In-memory speed", "Daily backups", "Managed by us"]`), but the same port-allocator and compose
change apply to all four engines identically — there's no technical reason to withhold it from Redis.
`db-redis` gets `"Remote access"` added, replacing `"Managed by us"` (kept implicit rather than stated,
matching the other three's post-phase-2 shape).

## Out of scope

TLS support, IP allowlisting, automated migration for pre-phase-2 customers, per-engine port ranges.

## Testing

- Pure unit tests for the port allocator's "lowest free port in range" logic, including the
  already-full-range case (should fail closed — escalate, never silently reuse a port).
- Compose-generation tests confirming the `ports:` mapping appears only for `DB_ENGINE_CONFIG` jobs,
  never for `CURATED_APP_CONFIG` or the generic fallback path (regression guard, same pattern as the
  phase-1 tests).
- A regression test confirming `access.host`/`access.port` for a curated app (e.g. `starter-esign`)
  are unaffected by the new `DB_PUBLIC_HOST` env var — that value only applies to the database branch.
