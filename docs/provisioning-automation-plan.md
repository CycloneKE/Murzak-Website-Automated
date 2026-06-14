# Hosting Provisioning Automation — Implementation Plan

**Goal:** when a customer pays, their hosting/service is created automatically (no manual setup), within the limits of the single Hostinger KVM 4 — and the system refuses to oversell the box.

**Owner:** Murzak engineering · **Status:** proposed · **Last updated:** 2026-06-14

---

## 1. Where this plugs in (current state)

The payment → activation path already exists. A paid invoice flips to **Paid** and calls one function from three places:

- `backend/services/billingActivationService.js → activateServicesForInvoice()`
  - PayPal capture: `routes/paypalRoutes.js:85`
  - M-Pesa callback: `server.js:2349`
  - Manual activate endpoint: `server.js:2059`

Today `activateServicesForInvoice` marks the invoice's child services **Active** in Frappe. **That is the single hook we extend** — after marking Active, it enqueues a provisioning job per service. Nothing else in the payment flow changes.

Each catalog item already carries what provisioning needs (`frontend/src/config/serviceCatalog.ts`): `capacityClass` (volume / premium / dedicated), `resources.ramMb` / `diskGb`, and `category`. The backend will mirror this catalog (or import it) to route and size each job.

---

## 2. Target architecture

```
Paid invoice ──> activateServicesForInvoice()
                      │  (mark services Active — unchanged)
                      ▼
              enqueueProvisioning(service)         ┌─ capacity gate (RAM/disk ledger) ─┐
                      │                            │  refuse premium/ERP past threshold │
                      ▼                            └────────────────────────────────────┘
              Provisioning Job (Frappe doctype: queued)
                      │
        ┌─────────────┴───────────────┐
        ▼ category = web/email/static  ▼ category = ERP/POS/CRM (Frappe apps)
   LANE A: Coolify API            LANE B: Frappe bench
   (create app/site/db, SSL,      (`bench new-site`, install app,
    route, container limits)       DNS multitenant, restore data)
        │                              │
        └─────────────┬────────────────┘
                      ▼
        update Provisioning Job (active / failed)
        write access details back to the customer's service
        notify customer (email) + staff (on failure)
```

**Two lanes, one queue.** No single tool covers both cheap web/email *and* multi-tenant ERPNext, so jobs are routed by category. Both lanes are driven by the same job runner.

---

## 3. Tooling decisions

| Concern | Choice | Why |
|---|---|---|
| Web / app / static / DB | **Coolify** (self-hosted on the KVM 4) | Free OSS, clean REST API + deploy webhooks, Docker-native (matches the stack), per-container memory limits for isolation |
| Business systems (ERPNext/POS/CRM) | **Frappe `bench new-site`** scripts | Purpose-built multi-tenant ERP; DNS-based multitenancy; same Frappe we already run |
| Baseline box config & playbooks | **Ansible** | Idempotent, version-controlled box + per-site provisioning |
| Domains / DNS / 2nd-box scaling | **Hostinger API / Terraform provider** | Official; automates DNS records and spinning up KVM #2 when RAM caps out |
| Off-site backups | **Backblaze B2 / DO Spaces** | Backups must NOT live on the same NVMe as the data |
| Queue/runner | Start with an in-process queue + DB-backed job rows; move to **BullMQ (Redis)** once volume warrants | Redis is already wired (`REDIS_URL`) |

**Explicitly not** using cPanel/WHM — per-account licensing tax, heavyweight, wrong fit for a Frappe-centric single box.

---

## 4. Data model (Frappe)

Add a **`Provisioning Job`** doctype:

| Field | Type | Notes |
|---|---|---|
| `web_account` | Link | owner |
| `invoice` | Link | Portal Invoice that paid for it |
| `service_id` | Data | catalog id, e.g. `biz-pos-inventory` |
| `lane` | Select | `coolify` / `bench` / `manual` |
| `status` | Select | `queued` / `running` / `active` / `failed` / `needs_human` |
| `attempts` | Int | retry count |
| `ram_mb` / `disk_gb` | Int | reserved footprint (from catalog `resources`) |
| `external_ref` | Data | Coolify app id / bench site name |
| `access` | Small Text (JSON) | URL, admin user, etc. shown in portal |
| `log` | Long Text | last runner output |
| `error` | Small Text | failure reason |

Add a lightweight **capacity ledger** (a single Frappe doc or computed view): `reserved_ram_mb`, `reserved_disk_gb` = sum of `ram_mb`/`disk_gb` over `Provisioning Job` where `status in (running, active)`. Compare against `SERVER_CAPACITY.sellableRamMb` (12,800) / `sellableDiskGb` (160).

---

## 5. Phased rollout

### Phase 0 — Notify + runbook (week 0–1) ✅ low risk, ship first
- Extend `activateServicesForInvoice` to, after marking Active, create a `Provisioning Job` row with `status=queued` and **notify staff** (email/Telegram/Slack) with the order details and a link.
- Humans follow a written runbook to provision; flip the job to `active` in an admin view.
- Portal: show the customer "We're setting up your <service> — you'll get an email when it's live" (the portal already has a Provisioning state to reuse).
- **Outcome:** zero customer-visible delay regression, full audit trail, and you learn the real product mix before automating the wrong lane.

### Phase 1 — Two scripted lanes (week 2–6)
- Stand up **Coolify** on the KVM 4 (or a small slice) behind the firewall; create an API token.
- Build a **job runner** (`backend/services/provisioning/`):
  - `runner.js` — polls `Provisioning Job` where `status=queued`, claims one, sets `running`, dispatches by lane, writes back `active`/`failed`, retries up to N with backoff, escalates to `needs_human` after N.
  - `lanes/coolify.js` — create app/site/db via Coolify API, set memory/CPU limits, attach domain, trigger SSL.
  - `lanes/bench.js` — shell out to an Ansible playbook that runs `bench new-site`, installs the app (erpnext/pos/crm), sets DNS multitenancy, restores any seed data.
- **Capacity gate** in `enqueueProvisioning`: if `category` is premium/ERP and `reserved_ram_mb + service.ram_mb > threshold (e.g. 85% of sellable)`, set job `needs_human` + alert instead of auto-running, and trigger a "provision KVM #2" task.
- Domains/DNS handled via the Hostinger API in the bench/coolify step.
- **Outcome:** ~80% of orders (web/email/static + the first handful of ERP tenants) provision end-to-end; edge cases escalate cleanly.

### Phase 2 — Full automation + horizontal scale (month 2–6, demand-driven)
- All web/app/static/db tenants via Coolify API; ERP fleet via bench scripts (or self-host **Frappe Press** once the ERP fleet is large enough to justify its ops cost).
- When the RAM gate trips, use the **Hostinger Terraform provider / API** to spin up **KVM box #2** and register it as a second Coolify/bench target; route new premium tenants there.
- Every new tenant gets an **off-site backup** (B2/Spaces) wired in at creation.
- Move the queue to **BullMQ on Redis** for concurrency, retries and dashboards.

---

## 6. The webhook → provision flow (concrete)

1. PayPal capture / M-Pesa callback marks invoice **Paid** → `activateServicesForInvoice()` (unchanged) marks child services Active.
2. New step inside that function: for each newly-active service, call `enqueueProvisioning({ webAccount, invoice, service })`.
3. `enqueueProvisioning` looks up the catalog item, runs the **capacity gate**, and creates a `Provisioning Job` (`queued`, or `needs_human` if gated).
4. The **runner** picks it up, dispatches to the lane, and on success writes `access` JSON + flips `status=active`.
5. Portal reads `Provisioning Job.access` to show the customer their URL/credentials; on failure, staff are alerted and the customer sees "being set up".
6. Idempotency: jobs are keyed by `(invoice, service_id)`; re-running activation never double-provisions.

---

## 7. Security & isolation (non-negotiables)
- **Containerize every tenant** (Coolify/Docker) with hard memory limits; never co-mingle on one filesystem; never hand out shell access.
- Per-tenant DB credentials; secrets stored server-side only.
- Front everything with **Cloudflare WAF**; offer the paid WAF add-on as an upsell.
- **Backups off-box** (B2/Spaces), with periodic tested restores. Hostinger's free weekly backup is a *secondary* layer only.

## 8. Capacity reality (build the gate around RAM)
- 16 GB RAM is the ceiling. Light WordPress/static/email tenants are cheap (50–150 MB) — host dozens. **ERPNext tenants eat 1–2 GB each → ~4–8 active before KVM #2.**
- The gate keys on **RAM**, not disk/bandwidth (200 GB / 16 TB are rarely the first constraint).

## 9. Testing & rollout
- Unit-test `enqueueProvisioning` + capacity gate (gated vs allowed).
- Integration-test each lane against a staging Coolify + a throwaway bench site.
- Ship Phase 0 to production behind the existing flow; dark-launch Phase 1 lanes on internal/test invoices before enabling for real customers.
- Add a `PROVISIONING_ENABLED` env flag so the runner can be paused without touching payments.

## 10. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Oversubscribing one KVM 4 | RAM capacity gate + auto-trigger KVM #2 |
| Tenant breach blast-radius | Containers, per-tenant creds, no shell, WAF |
| Disk failure wipes data + backup | Off-box backups, tested restores |
| Automation outpaces support | Sell Priority Support / Managed Care tiers (already in catalog) |
| Single box = single outage | Phase-2 second box doubles as redundancy + the 99.9% SLA story |

---

**Bottom line:** extend the one existing activation hook to enqueue jobs; run two lanes (Coolify for web/app, Frappe bench for ERP) behind a RAM-aware capacity gate; ship notify-only first, then automate, then scale to a second box when RAM demands it.
