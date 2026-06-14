# Provisioning — go-live checklist

The admin panel (**Portal → admin → Provisioning**) shows a live **readiness**
checklist. Add env vars, reload, and watch items turn green. This doc is the map.

> Open the panel as any account whose email is in `ADMIN_EMAILS`.

---

## Stage 0 — Notify-only (safe first step, no automation)

Records a job per paid service and emails staff to provision by hand. Zero risk.

1. **Import the doctype** into Frappe (once):
   - `backend/data/doctype-provisioning-job.json`
   - (Desk → *Import Document*, or `bench --site <site> import-doc <path>`)
   - Optional now, needed for Stage 2: `backend/data/doctype-capacity-request.json`
2. **Env:**
   ```
   PROVISIONING_ENABLED=true        # default
   ADMIN_EMAILS=you@murzaktech.com  # notification recipients (comma-sep)
   SMTP_HOST= SMTP_USER= SMTP_PASS= # already used for other portal mail
   ```
   Readiness "Required" group should now be all green.

The runner stays **off** — jobs sit as `queued`, staff follow the runbook
(`backend/services/provisioning/README.md`).

---

## Stage 1 — Automated builds (one box)

Turn on the runner and wire at least one build lane.

3. **Configure a lane** (either or both):
   - **Coolify** (web / app / static / DB):
     ```
     COOLIFY_BASE_URL= COOLIFY_TOKEN= COOLIFY_PROJECT_UUID= COOLIFY_SERVER_UUID=
     ```
   - **Frappe bench** (ERP / POS / CRM) — path to your idempotent script:
     ```
     BENCH_PROVISION_CMD=/opt/murzak/provision-bench.sh
     ```
4. **Enable the runner:**
   ```
   PROVISIONING_RUNNER_ENABLED=true
   PROVISIONING_QUEUE=poll          # default; in-process interval runner
   ```
   With a lane configured, the "Conditional" readiness group goes green.

> Dark-launch first: run on internal/test invoices before real customers. With
> no lane configured every job just escalates to `needs_human` (never faked).

**Hardening (optional, each is an upsell too):**
```
BACKUP_PROVIDER=b2   BACKUP_CONFIG_CMD=/opt/murzak/backup.sh     # off-site backups
EDGE_PROVIDER=cloudflare  EDGE_CONFIG_CMD=/opt/murzak/edge.sh    # per-tenant WAF
PROVISIONING_BOX1_MAX_PREMIUM=6                                  # cap ERP tenants/box
```

---

## Stage 2 — Scale-out + BullMQ (multi-box / HA)

5. **More boxes** — add each new server to the placement pool:
   ```
   PROVISIONING_TARGETS=[{"id":"box-2","sellableRamMb":12800,"status":"active",
     "coolify":{"baseUrl":"…","token":"…","projectUuid":"…","serverUuid":"…"},
     "benchCmd":"/opt/murzak/provision-box2.sh","maxPremiumTenants":6}]
   ```
6. **Auto-scale** (optional — creates a *paid* VPS, so opt-in):
   ```
   PROVISIONING_AUTOSCALE=true
   HOSTINGER_API_TOKEN=  HOSTINGER_VPS_PLAN=  HOSTINGER_DC_ID=  HOSTINGER_TEMPLATE_ID=
   ```
   Off => when all boxes are full a Capacity Request is logged + staff emailed.
7. **BullMQ dispatch** (only once you run >1 backend instance, or want low-latency
   pickup + dashboards):
   ```
   PROVISIONING_QUEUE=bullmq
   PROVISIONING_REDIS_URL=redis://…   # DEDICATED + persistent (NOT the session cache)
   ```
   The Redis must be `maxmemory-policy=noeviction` with AOF/RDB on — otherwise an
   evicting cache can drop a paid job. The dispatcher warns/errors on startup if
   this is wrong, and **falls back to poll** if Redis is unreachable.

---

## Kill switches

| Flag | Effect |
|---|---|
| `PROVISIONING_ENABLED=false` | Stop recording/notifying — payments untouched |
| `PROVISIONING_RUNNER_ENABLED=false` | Stop building; jobs queue for humans |
| `PROVISIONING_AUTOSCALE=false` | Never auto-create a VPS |
| `PROVISIONING_QUEUE=poll` | Drop BullMQ, use the in-process runner |

## What still needs hands-on (not just env)

- Importing the Frappe doctype(s).
- Writing the lane scripts (`BENCH_PROVISION_CMD`) / Coolify project setup, and
  the optional `BACKUP_CONFIG_CMD` / `EDGE_CONFIG_CMD`.
- Standing up the dedicated Redis for BullMQ.
- A staging shakedown of each lane before flipping the flag in production.

Everything is gated: with the flags unset the app behaves exactly as today.
