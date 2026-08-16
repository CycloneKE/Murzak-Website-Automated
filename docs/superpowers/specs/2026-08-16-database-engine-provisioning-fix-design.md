# Database Engine Provisioning Fix

Date: 2026-08-16

## Problem

`db-mysql`, `db-postgres`, `db-mongo`, and `db-redis` (KES 2,000/mo each, the current non-deprecated
database products — `starter-db-light`/`starter-db-mongo` were deprecated *in favor of* these four,
see [serviceCatalog.ts:1017-1023](../../../frontend/src/config/serviceCatalog.ts)) are live and
self-serve purchasable today, but provision as a blank `nginx:alpine` container doing nothing
MySQL/Postgres/MongoDB/Redis-like at all.

Root cause, confirmed by reading the code (not reproduced against a live box — none of this session
has VPS access):

- [coolify.js:617-634](../../../backend/services/provisioning/lanes/coolify.js) builds every
  non-BYOA container from one hardcoded compose block: `image: job.docker_image || "nginx:alpine"`,
  port 80 only, **no `volumes:` section at all**.
- `job.docker_image` is only ever set for BYOA jobs (built from the customer's own repo,
  [coolify.js:1085](../../../backend/services/provisioning/lanes/coolify.js)). No catalog field or
  provisioning code sets it for anything else.
- `generate-catalog-snapshot.js` doesn't extract an image field from `serviceCatalog.ts` at all —
  there is no existing mechanism for a non-BYOA catalog item to declare what it deploys.

This is the same class of bug the File Storage product had (see
[2026-08-16-file-storage-object-browser-design.md](2026-08-16-file-storage-object-browser-design.md)),
except these four are already sold, not merely under-built.

## Decisions made during brainstorming

1. **Scope: deploy the correct database, defer external ("remote") access.** The catalog highlights
   promise `"Remote access"` — a customer connecting with their own SQL client — but that requires
   real TCP port exposure on the box's one shared public IP (a port-allocation scheme across
   customers, plus a real security decision about opening raw DB ports to the internet). That's a
   separate, harder problem from "run the right database software," and conflating them would block
   the urgent fix on a slower design. Phase 1 fixes what's actually broken (the wrong container
   entirely); phase 2 (not part of this spec) tackles real external connectivity.
2. **No generic "curated third-party app" catalog schema — yet.** A small, purpose-built 4-entry
   lookup table in `coolify.js`, not a new catalog-wide image/port/volume schema. That generalization
   is real future work (it's what the E-Signature/ecosystem roadmap will need), but building it now
   under bug-fix pressure solves a bigger problem than the one in front of us. YAGNI.
3. **No kill switch.** Unlike File Storage (a brand-new customer-facing surface with a real
   live-infra dependency not yet deployed), this fix corrects what an *existing* purchase flow
   already provisions. The provisioning runner's existing safety net — a thrown error during
   `provision()` retries then escalates to `needs_human`, never marks a job "active" on failure — is
   the same protection every other lane already relies on for its own unverified-live surface (e.g.
   `s3Client.js`'s `putObject`/`deleteObject`). Adding a parallel kill switch here would be new
   ceremony this codebase doesn't use for provisioning-correctness fixes.
4. **Marketing honesty.** `"Remote access"` in the catalog highlights is corrected to describe what
   phase 1 actually delivers, not left as an unmet promise.

## Design

### Per-engine config table

A 4-entry lookup, keyed by `service_id`, colocated in `coolify.js` next to the compose builder that
consumes it:

| service_id | image | port | volume path | credential mechanism |
|---|---|---|---|---|
| `db-mysql` | `mysql:8` | 3306 | `/var/lib/mysql` | `MYSQL_ROOT_PASSWORD` env var |
| `db-postgres` | `postgres:16` | 5432 | `/var/lib/postgresql/data` | `POSTGRES_PASSWORD` env var |
| `db-mongo` | `mongo:7` | 27017 | `/data/db` | `MONGO_INITDB_ROOT_USERNAME` + `MONGO_INITDB_ROOT_PASSWORD` env vars |
| `db-redis` | `redis:7` | 6379 | `/data` | no env var in the official image — `command: redis-server --requirepass <generated>` |

### Compose builder changes

For a job whose `service_id` matches the table, the compose block gets: the real `image` (not the
`job.docker_image || "nginx:alpine"` fallback), `expose: ["<engine port>"]` instead of `["80"]`
(internal to the box's Docker network only — no host port publish, matching the existing
no-host-port-publish reasoning already documented for the generic app path), a named volume mounted
at the engine's data directory (new — the generic template has none today), and the engine's
credential env var(s)/command populated from a freshly generated password. Every other job
(BYOA, File Storage's now-removed placeholder path, any future non-DB "volume" item) is
byte-for-byte unaffected — the table only matches these four `service_id`s.

### Credential generation and storage

A random password is generated at provision time with Node's `crypto.randomBytes` (no new
dependency — matches this codebase's existing convention, e.g. `s3Client.js`'s own use of `crypto`).
It's stored in the job's `access` field the same way every other lane already stores its connection
info (bench stores `{site, url, admin}`; this stores
`{engine, host, port, database, username, password}`).

### Surfacing to the customer

New `GET /api/portal/services/:serviceId/database/connection` route, following the exact ownership
pattern already established for every per-service route in `portalRoutes.js`: `requireAuth` +
`loadOwnedJob` + a category check (`job.category === "Database Hosting"`) + `job.status === "active"`.
**No resource-admin/plan gating** — a database's own credentials are the product itself, not an
advanced-controls extra, same reasoning already applied to File Storage's file browser.

New `DatabaseConnectionPanel.tsx`, rendered in `ResourceDetail`'s Settings pane when
`svc.category === "Database Hosting"` (alongside `ResourceAdminPanel`/`DeveloperTerminalPanel`,
which still apply here since these ARE real containers with env vars/logs worth managing — unlike
Storage, this category doesn't need to suppress those panels). Reveal/hide styled like the existing
env-var UI in `ResourceAdminPanel.tsx`.

### Catalog copy correction

`db-mysql`/`db-postgres`/`db-mongo`/`db-redis`'s `"Remote access"` highlight is replaced with
`"Auto-generated credentials"` (or similar, matching what phase 1 actually ships) until phase 2 makes
real external connectivity true.

## Out of scope (phase 2, not this spec)

External TCP port exposure, the port-allocation scheme across customers sharing one public IP, and
the firewall/security design for opening raw database ports to the internet.

## Untouched

The existing generic post-provision backup hook (`backups.registerBackup`, called by the runner for
every lane) already runs regardless of container content — not part of this fix, not re-verified here.

## Testing

- Pure unit tests for the per-engine lookup and the compose-block generation it drives (mirroring
  `coolify.js`'s existing `resourceLimits()` being "kept side-effect-free so it's unit-tested
  directly").
- A regression test confirming every `service_id` NOT in the 4-entry table still gets the exact
  `nginx:alpine`-fallback behavior unchanged (no accidental widening of the special-case match).
- Route ownership/category tests for the new connection-details endpoint, following the same
  hand-rolled test harness (`ok()`/`section()`, no Express harness) used throughout `backend/test/`.
