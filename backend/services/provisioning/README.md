# Provisioning — Phase 0 (notify + audit trail)

Implements Phase 0 of `docs/provisioning-automation-plan.md`: when a customer
pays, every newly-active service is recorded as a **Provisioning Job** and staff
are emailed to provision it from the runbook. No automation builds anything yet —
that's Phase 1 (the runner).

## Files

- `catalog.js` — backend view of the catalog, read from the generated snapshot
  (`backend/data/serviceCatalogSnapshot.json`). Exposes `getServiceMeta(id)` and
  `laneFor(meta)` (volume → `coolify`, premium → `bench`, dedicated → `manual`).
- `provisioningService.js` — `runProvisioningForInvoice()` enqueues idempotent
  jobs (keyed by `invoice` + `service_id`) and notifies staff. **Never throws** —
  a provisioning hiccup can't roll back a paid invoice.
- Wired in `services/billingActivationService.js`, after services flip Active.

## The snapshot is generated — don't hand-edit it

The frontend catalog (`frontend/src/config/serviceCatalog.ts`) is the single
source of truth. After changing it, regenerate:

```bash
node backend/scripts/generate-catalog-snapshot.js
```

## Enable in production

1. Import the doctype into Frappe (one-time):
   `backend/data/doctype-provisioning-job.json`
   (Desk → "Import Document", or `bench --site <site> import-doc <path>`).
   Notify-only still works without it — jobs just aren't recorded.
2. Set `ADMIN_EMAILS` (recipients) and SMTP_* (already used for other mail).
3. `PROVISIONING_ENABLED=true` (default). Set `false` to pause without touching
   payments.

## Runbook (humans, until Phase 1)

When a `[Provisioning] …` email arrives:

1. Open the order; note each service's **lane** and **RAM**.
2. **coolify** → create the app/site/db in Coolify, set a memory limit, attach the
   domain, issue SSL.
   **bench** → `bench new-site`, install the app (erpnext/pos/crm), set DNS
   multitenancy, restore any seed data.
   **manual** → dedicated/quote item: handle out-of-band (separate box).
3. Check RAM headroom in the email before provisioning a premium/ERP tenant; if
   the box is near the sellable cap, plan KVM #2 instead of overselling.
4. Write the customer's URL/credentials into the job's `access` field and flip
   `status` → `active`. The portal reads `access` to show the customer.

## Phase 1 — the runner (built)

`runner.js` turns queued jobs into real builds:

```
fetch queued (backoff-aware) → capacity recheck (premium) → dispatch by lane
   → active            (lane reported success)
   → queued + backoff  (transient failure, attempts < max)
   → needs_human       (out of attempts, capacity-gated, manual, or lane unconfigured)
```

- **Lanes** (`lanes/`): `coolify.js` (volume) and `bench.js` (premium). Each has
  `isConfigured()`; the runner **escalates** unconfigured lanes to a human rather
  than fake a build. `manual`/dedicated always escalates.
- **Capacity gate** (`capacity.js`): premium jobs are checked against reserved RAM
  at both enqueue and run time. Over `PROVISIONING_RAM_THRESHOLD_PCT`% of sellable
  RAM → `needs_human` (provision KVM #2) instead of overselling.
- **Retries**: exponential backoff (`next_run_at`), capped 30 min,
  `PROVISIONING_MAX_ATTEMPTS` (default 3) then `needs_human`.
- **Single-runner assumption**: claims are optimistic (`status=running`). Run one
  backend process; don't point two runners at one site.

### Enable the runner

1. Configure a lane (`COOLIFY_*` and/or `BENCH_PROVISION_CMD`).
2. `PROVISIONING_RUNNER_ENABLED=true` (default false). It auto-starts with the
   server and polls every `PROVISIONING_POLL_MS`.

### Admin endpoints (require admin session)

- `GET  /api/admin/provisioning/jobs[?status=queued|needs_human|…]` — list jobs.
- `POST /api/admin/provisioning/run` — trigger one runner pass now.
- `POST /api/admin/provisioning/jobs/:id/retry` — re-queue a failed/needs_human job.

## Phase 2 — scale-out + backups (built)

- **Multi-target placement** (`targets.js`): box-1 (the KVM 4) is always present;
  extra boxes are declared in `PROVISIONING_TARGETS` (JSON, each with its own
  Coolify creds / bench command). Premium tenants are placed on the first box
  with RAM headroom; the chosen box is recorded on the job (`target`).
- **Scale-out** (`scaling.js`): when no box has headroom, a `Capacity Request` is
  recorded (idempotent — one open request at a time) and staff are emailed. With
  `PROVISIONING_AUTOSCALE=true` + `HOSTINGER_API_TOKEN`, it also calls the
  Hostinger API to create the next VPS. **Off by default** — auto-creating a paid
  server is an explicit opt-in. Gated jobs park as `needs_human`; re-queue them
  (admin retry) once the new box is added to `PROVISIONING_TARGETS`.
- **Off-site backups** (`backups.js`): at create-time the runner registers a
  backup via `BACKUP_CONFIG_CMD` (provider in `BACKUP_PROVIDER`). Result is stored
  on the job (`backup_status`: pending/configured/skipped/failed) — no silent gap.
- **Concurrency**: the runner builds `PROVISIONING_CONCURRENCY` (default 2) jobs
  per pass in parallel, with the per-target gate re-checked at run time.

### New admin endpoint

- `GET /api/admin/provisioning/capacity` — targets, per-box reserved vs limit RAM,
  and open scale-out requests.

### New doctype

Import `backend/data/doctype-capacity-request.json` (alongside the Provisioning
Job doctype) to record scale-out requests.

## Dispatch layer — poll vs BullMQ hybrid (built)

`queue.js` chooses how queued jobs get dispatched (`PROVISIONING_QUEUE`):

- **`poll`** (default) — the in-process interval runner. Simple; fine for one
  backend instance.
- **`bullmq`** — Redis-backed dispatch. **Hybrid contract:** the Frappe doctype
  stays the source of truth; BullMQ carries only the job *name* and provides the
  atomic per-job lock (no double-build across many workers), low-latency pickup,
  and delayed retries. The worker loads the doctype, runs `processJobByName`
  (which writes all state back), and a **reconcile loop** re-injects any queued
  rows missing from Redis (covers Redis restarts / lost events).

`queue.start()` falls back to `poll` if bullmq mode is requested without a Redis
URL or if the library can't load — provisioning never hard-fails on Redis.

### Redis safety (important)

Use a **dedicated, persistent** Redis via `PROVISIONING_REDIS_URL` — *not* the
session cache. On startup the dispatcher warns if you're sharing the session
Redis, and errors if `maxmemory-policy` isn't `noeviction` (an evicting cache can
silently drop a paid customer's provisioning job). Enable AOF/RDB persistence.

Admin: `GET /api/admin/provisioning/queue` → mode + (bullmq) live job counts.

## Admin UI + go-live

- **Panel:** Portal → admin → **Provisioning** (`frontend/src/pages/admin/AdminProvisioning.tsx`).
  Readiness checklist, dispatcher mode/counts, per-box capacity bars, scale-out
  requests, and a jobs table with status filters + per-job **Retry** + **Run queue now**.
  Visible to anyone in `ADMIN_EMAILS` (the user payload now carries `is_admin`).
- **Readiness API:** `GET /api/admin/provisioning/readiness` → `{ ready, mode,
  checks[] }` (`services/provisioning/readiness.js`). Each check has a level
  (required / conditional / optional); `ready` is true when required+conditional
  pass. Drives the panel's green/red list.
- **Go-live steps:** `docs/provisioning-go-live.md` maps each env var to what it
  turns on, in safe stages.

## Gap fixes shipped alongside

- **Atomic claim (poll path):** `claimJob` writes `runner_id` then reads it back;
  if another runner won, it backs off. Reduces double-processing when multiple
  poll runners share a queue (BullMQ's lock is the hard guarantee).
- **Premium-tenant cap per box:** `PROVISIONING_BOX1_MAX_PREMIUM` /
  per-target `maxPremiumTenants` bound noisy-neighbour load on the shared
  bench/MariaDB beyond the raw RAM gate.
- **Per-tenant edge / WAF** (`edge.js`): `EDGE_CONFIG_CMD` wires each tenant into
  Cloudflare/WAF at create-time; recorded on the job (`edge_status`).
- **Isolation contract** the lane scripts must honour: per-tenant DB creds,
  container memory limits (coolify lane sets `limits_memory`), no shell access,
  edge/WAF in front. Dedicated/large tenants go to their own box (manual lane).

## Tests

`npm test` (`test/provisioning.test.js`) — 40 cases, no Redis/Frappe needed
(everything mocked): catalog routing, enqueue (idempotency / doctype-missing /
gate / scale-out), runner state machine (active / escalate / retry+backoff),
multi-target placement + premium cap, scale-out idempotency, backups + edge,
atomic claim, `processJobByName`, BullMQ hybrid processor logic, and dispatcher
mode selection. A **live BullMQ end-to-end test still needs a real Redis** and a
staging Coolify/bench — out of scope for the mocked suite.
