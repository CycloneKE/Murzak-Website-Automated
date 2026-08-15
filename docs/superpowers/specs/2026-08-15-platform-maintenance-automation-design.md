# Platform Maintenance Automation — Design

## Context

This session's infra audit found real gaps that only surfaced because a human happened to go
looking by hand: 18 orphaned Coolify containers went undetected until a manual `docker ps`
comparison ([[murzaktech-live-infra-2026-08-15]]), Sentinel had been silently out of sync, and
Coolify's own control-plane database has no backup at all
([[murzaktech-security-hardening-2026-08-15]]). None of this is exotic — it's the class of thing a
recurring check would have caught on day one instead of weeks later. This spec turns three of
those manual checks into scheduled jobs with a place for staff to see the results, rather than
relying on someone remembering to look.

The scope is deliberately narrow: three specific jobs (orphan reconciliation, a capacity/health
snapshot, and a host-level backup), persisted results an admin can see, and an email when something
actually needs attention. It does not attempt a general-purpose job scheduler, a metrics/observability
platform, or customer-facing status — those are explicitly out of scope.

## Architecture

Two different mechanisms, because the three jobs have genuinely different constraints:

- **Orphan reconciliation and capacity snapshot** run *inside* the existing Node backend process.
  They only need to call Coolify's API and Frappe — both already reachable from the app container —
  so they extend the exact pattern `server.js` already uses for the renewal sweep, the checkout-order
  sweep, and the (currently dormant) terminal-retention sweep: a `setTimeout` initial delay followed
  by `setInterval(...).unref()`, each gated by its own env flag, logged once at startup.

- **Backup** cannot run this way. It needs to tar `/data/coolify` on the **host filesystem**, and the
  Node app runs inside a Docker container with no access to that path. This one is a real `crontab`
  entry on the VPS host, outside any container — matching what the Coolify backup research
  recommended directly ("a small cron job on the host"). It reports its result back to the app over
  one authenticated HTTP call, so notification logic lives in exactly one place (the app) instead of
  being duplicated in shell.

Nothing here deletes or modifies live infrastructure. Orphan reconciliation stays strictly
read-only, exactly like the existing `findOrphanedCoolifyResources` it wraps — deletion is a
deliberate, separate, human-run action (`scripts/coolify-orphan-cleanup.js`), not something a
background job ever does silently.

## New storage: one doctype, three job types

A single lightweight Frappe doctype, `Platform Health Check`, holds every run of every job — matching
this app's existing pattern of a doctype per persistent concern (Provisioning Job, Checkout Order,
Terminal Session) rather than a flat log file, and avoiding three near-identical doctypes for what is
structurally the same "a job ran, here's what it found" record.

Fields:
- `job_type` — Select: `orphan_check` \| `capacity_snapshot` \| `backup`
- `status` — Select: `ok` \| `attention` \| `error`
- `summary` — Data, a short one-line human string for the admin list view (e.g. `"3 orphaned resources found on box-1"`, `"Reserved 5200MB / 6400MB sellable (81%)"`, `"Backup uploaded, 340MB, 42s"`)
- `detail_json` — Long Text, the structured payload (orphan list per target / capacity numbers / backup file size & duration)
- `alert_sent` — Check, whether this run triggered an admin email (avoids re-alerting on read)

Frappe's built-in `creation` timestamp is the "when" — no redundant field for it.

## Job 1 — Orphan reconciliation

Wraps the existing `services/provisioning/orphans.js::findOrphanedCoolifyResources` — unchanged,
still read-only, still fails closed (a Frappe read failure returns `checked: false` rather than
false-flagging everything, exactly as it does today). The sweep calls it, writes one
`Platform Health Check` row (`status: "ok"` if nothing found, `"attention"` if any orphan exists across
any target), and emails `ADMIN_EMAILS` via the existing `utils/mailer` + `adminRecipients()` pattern
(same one `provisioningService.js::notifyStaffOfJobs` already uses) when status is `attention`.
Never alerts on a clean run.

Env: `ORPHAN_RECONCILE_SWEEP_ENABLED` (default `true` — this is safe/read-only, same polarity as the
checkout-order sweep), `ORPHAN_RECONCILE_SWEEP_INTERVAL_MS` (default 6h).

## Job 2 — Capacity/health snapshot

Wraps the existing `services/provisioning/capacity.js::summary()` plus
`provisioningService.js::getReservedRamMb` — no new capacity logic or new threshold. `status:
"attention"` is exactly `capacity.gateExceeded({reserved, ramMb: 0})` (the same
`PROVISIONING_RAM_THRESHOLD_PCT`-controlled 85% gate real orders are checked against, evaluated with
no hypothetical incoming job — i.e. "is the box already past the line on its own"). One threshold,
one env var, no second number to keep in sync. Writes a `Platform Health Check` row every run
(`job_type: "capacity_snapshot"`) so the dashboard has a trend, not just a live number. Emails admins
only on `attention`.

Env: `CAPACITY_SNAPSHOT_SWEEP_ENABLED` (default `true`), `CAPACITY_SNAPSHOT_SWEEP_INTERVAL_MS`
(default 1h).

## Job 3 — Backup

A thin shell script (`backend/scripts/host/coolify-backup.sh`, deployed to the VPS host, not part of
the app image, run via `crontab`) that:
1. Tars `/data/coolify`.
2. Invokes a small Node one-off (`backend/scripts/host/upload-backup.js <tarfile>`) that `require`s
   `services/terminal/s3Client.js` directly to sign and upload — Node is already on the host (it's how
   the app itself runs), so this avoids ever hand-rolling AWS SigV4 a second time in bash. The shell
   script's only job is orchestration: tar, invoke Node, check its exit code.
3. `curl`s one authenticated `POST` to a new internal endpoint reporting success/failure, file size,
   and duration.

New env (separate from `TERMINAL_S3_*` — logically a different bucket/purpose, even if an operator
chooses to point both at the same account): `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
`BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`. **Blocked on the open
question from this session: no S3-compatible destination is configured yet anywhere** — this job
cannot be deployed until that exists.

### The status-report endpoint

`POST /api/admin/platform-health/backup-status` — deliberately NOT behind `requireAuth`/`requireAdmin`
(there is no staff browser session in a host crontab), but never open. Authenticated with a static
bearer token compared via `crypto.timingSafeEqual` (constant-time, avoiding a timing side-channel),
read from a new `BACKUP_STATUS_REPORT_TOKEN` env var — the same "shared secret, not a session"
pattern the terminal broker already uses for backend↔broker calls. Body: `{ok, sizeBytes, durationMs,
error?}`. Writes the `Platform Health Check` row and sends the admin email on `error`, exactly like
Jobs 1 and 2 — this is the one place all three jobs' notification logic converges.

## Admin dashboard

Extends the existing `routes/adminRoutes.js` (`/api/admin/provisioning/orphans` and `/capacity`
already exist as live/on-demand reads) with a new `GET /api/admin/platform-health` returning the most
recent `Platform Health Check` row per `job_type`, so the admin panel shows "last checked: X, found:
Y" without hitting Coolify's API on every page load. The existing on-demand endpoints stay as-is for
an explicit "check right now" action — the scheduled jobs and the manual button both write to the
same doctype, so a manual check between scheduled runs shows up in the same history.

## Explicitly out of scope

- Slack/webhook alerting — email only, per this session's decision; revisit if email turns out to be
  insufficient.
- Any change to what orphan reconciliation *does* on finding something (still surface-only, never
  deletes) — that boundary from `orphans.js`'s own doc comment is not being touched.
- A general job-scheduling framework — three specific jobs, extending the pattern already in
  `server.js`, not a new subsystem.
- Restoring FROM a backup — this spec only covers producing one; a restore runbook is a separate,
  later piece of work once backups are actually landing somewhere.

## Testing

Unit tests for the sweep functions follow the existing house style (hand-rolled `ok()`/`section()`
harness, scripted Frappe/Coolify clients, no real network — see `test/orphanReconciliation.test.js`
and `test/provisioning.test.js` for the pattern to match): the orphan sweep's doctype-write and
alert-firing logic, the capacity snapshot's threshold/alert logic, and the backup-status endpoint's
auth (rejects a bad/missing token, constant-time comparison) and doctype-write behavior.

The shell script and the real S3 upload are, like every other live-infra piece touched this session,
unverifiable from a dev machine — the VPS-only S3 credentials and the host filesystem path both only
exist on the box. This needs a live dry run on the VPS before the crontab entry is installed for
real, the same discipline `coolify-smoke.js` already established for the Coolify lane.
