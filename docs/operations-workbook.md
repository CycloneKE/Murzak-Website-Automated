# Murzak Technologies — Operations Workbook

**The single "run the whole business" reference.** Where `operations-manual.md`
teaches the general shape of the job and `provisioning-go-live.md`/
`provisioning-automation-plan.md` cover the provisioning engine internals,
this workbook is organized **product by product and workflow by workflow** so
that "a customer just bought X" or "I need to do Y" always has one obvious
place to look. It assumes no coding knowledge.

**Companion docs** (read this first, then go deeper as needed):
- `docs/operations-manual.md` — general staff handbook (roles, daily checklist, glossary).
- `docs/application-overview.md` — technical architecture, repo layout, local dev.
- `docs/provisioning-go-live.md` — turning provisioning automation on, env var by env var.
- `docs/provisioning-automation-plan.md` — the provisioning architecture/strategy.
- `backend/services/provisioning/README.md` — provisioning internals runbook.

---

## Part 1 — How to use this workbook

- **Section 2** is the master **product catalog** — every single thing Murzak
  sells, in one table, with its lane, footprint, and current automation status.
- **Section 3** is **per-product playbooks** — for each product line, the full
  lifecycle: how a customer buys it, what happens automatically, what you do
  by hand, and what "done" looks like.
- **Section 4** is **cross-cutting workflows** that apply across every
  product: signup, checkout, support, billing, admin, security.
- **Section 5** is the **incident playbook** — concrete "if you see X, do Y"
  entries, including real incidents already found and fixed on this platform,
  kept here so the next person recognizes the pattern immediately instead of
  re-diagnosing from scratch.
- **Section 6** is the **go-live / readiness master checklist** — every
  Frappe doctype and custom field the platform depends on, in one table,
  cross-referenced to the automated readiness panel.

---

## Part 2 — The master product catalog

Source of truth: `frontend/src/config/serviceCatalog.ts` (frontend) mirrored
into `backend/data/serviceCatalogSnapshot.json` (backend) — **always edit the
frontend file and run `npm run gen:catalog` in `backend/`, never edit the
snapshot directly.**

Every product has a **capacity class**, which decides everything about how
it's built:

| Capacity class | What it means | Lane | Density |
|---|---|---|---|
| `volume` | Light, shared slice of the box | `coolify` | High — dozens per box |
| `premium` | Heavy managed Frappe app | `bench` | Low — ~4–8 per box |
| `dedicated` | Too big for the shared box | `manual` | Its own server, quote-only |
| `scalable` | Runs on the K8s cluster, not box RAM | `k8s` (if configured) | Cluster-managed |

### 2.1 Murzak Cloud (self-serve infrastructure)

| Product | Ids | Category | Class | Lane | Buy path | Automation today |
|---|---|---|---|---|---|---|
| Website hosting | `starter-web-hosting`, `starter-web-hosting-plus`, `biz-web-hosting`, `ent-ecom-large` | Website Hosting | volume→dedicated (ent) | coolify→manual | Cloud "Launch a resource" or Pricing configurator | Auto (volume); ent is quote-only |
| App Hosting (BYOA) | `starter-app-hosting`, `biz-scalable-webapp` | App Hosting | volume/scalable | coolify/k8s | Cloud "Launch a resource" **or** `/deploy` wizard (GitHub repo) | Auto once runner is on — see §3.2 |
| Email hosting | `starter-email`, `biz-email`, `ent-mail` | Email Hosting | volume→dedicated | coolify→manual | Configurator | Auto (volume); ent is quote-only |
| Storage | `starter-storage`, `addon-storage-50` | Storage | volume | coolify | Cloud "Launch a resource" / add-on | Auto |
| Database hosting | `starter-db-light`, `starter-db-mongo`, `db-mysql`, `db-postgres`, `db-mongo`, `db-redis`, `biz-db-medium`, `ent-db-large` | Database Hosting | volume→dedicated | coolify→manual | Cloud "Launch a resource" / Products page | Auto (volume); ent is quote-only |
| Domain registration | `domain-coke`, `domain-com`, `domain-ke`, `domain-org`, `domain-net`, `domain-africa`, `domain-io` | Domain Registration | volume (zero-footprint) | **manual** always | Products page domain search | **Fully manual** — see §3.6 |

### 2.2 Ready-made business systems

| Product | Ids | Category | Class | Lane | Buy path | Automation today |
|---|---|---|---|---|---|---|
| Murzak ERP | `test-erpnext-demo`, `biz-erp-light`, `biz-erp-configured`, `ent-erp-large` | ERP Hosting | premium→dedicated | bench→manual | `/products/erp` → configurator | Manual (Stage 0) unless bench lane is wired |
| Murzak POS | `biz-pos-inventory`, `ent-pos-multibranch` | POS & Inventory | premium→dedicated | bench→manual | `/products/pos` → configurator | Same as above |
| Murzak CRM & Helpdesk | `test-crm-demo`, `biz-crm-helpdesk` | CRM & Helpdesk | premium | bench | `/products/crm` → configurator | Same as above |
| HR & Payroll | `starter-hrpay` | Apps | volume | coolify | Configurator | Auto |
| Accounting | `biz-accounting` | Apps | premium | bench | Configurator | Manual (Stage 0) |
| Custom web apps | `biz-webapps` | Apps | premium | bench | Configurator | Manual (Stage 0) |
| Docs / knowledge base | `biz-docs` | Apps | volume | coolify | Configurator | Auto |
| BI / Analytics | `ent-bi` | Analytics | dedicated | manual | Configurator (Enterprise) | Quote-only, always manual |
| CCTV | `ent-cctv` | CCTV | dedicated | manual | Configurator (Enterprise) | Quote-only, physical install, always manual |
| Dedicated backup/DR server | `ent-backup-server` | Security & Backup | dedicated | manual | Configurator (Enterprise) | Quote-only, always manual |

### 2.3 Custom Software Development

Not in the catalog at all — a **quote/contact-sales product**. `/products/custom`
routes to a "Talk to Sales" CTA, not checkout. Handle entirely out-of-band:
scope, quote, contract, build, deliver. See §3.7.

### 2.4 Universal add-ons (attach to any paid plan)

| Add-on | Id | Category | What it does |
|---|---|---|---|
| Premium SSL | `addon-ssl-premium` | Domains & SSL | Wildcard/EV cert |
| Dedicated IP | `addon-dedicated-ip` | Domains & SSL | Own IP address |
| +5 mailboxes | `addon-mailboxes-5` | Email Hosting | More mailboxes on existing plan |
| Bulk email/newsletters | `addon-bulk-email` | Email Hosting | Campaign sending |
| +50GB storage | `addon-storage-50` | Storage | Disk expansion |
| Hourly backups | `addon-backup-plus` | Security & Backup | Backup cadence upgrade |
| WAF | `addon-waf` | Security & Backup | Web application firewall |
| Malware scanning | `addon-malware` | Security & Backup | Scheduled scans |
| CDN | `addon-cdn` | Performance | Edge caching |
| Staging environment | `addon-staging` | Performance | Second, non-prod copy |
| Priority support | `addon-priority-support` | Support & SLA | Faster response tier |
| Managed updates | `addon-managed-updates` | Support & SLA | We patch/update for them |
| Migration assistance | `addon-migration` | Support & SLA | We move their existing site/data in |

Add-ons attach via `AddonsModal` from the portal ("My Systems" → add a
service) and are gated by `addonEligibility.js` (a customer must already hold
a real, non-domain-only paid service to buy most add-ons — see §5 for the
bypass bug this closed).

### 2.5 Free trial

`starter-web-hosting-demo` / `test-erpnext-demo` / `test-crm-demo` — a
time-boxed sandbox via `/test-request`, auto-expires after **36 hours**. Not a
real purchase; see §3.8.

---

## Part 3 — Per-product playbooks

### 3.1 Website Hosting

1. **Buy:** Cloud "Launch a resource" (instant, logged-in) or the Pricing
   configurator (creates an invoice, pay via M-Pesa/PayPal).
2. **Provision:** Coolify lane. Auto once the runner + Coolify are configured
   (§6); by hand otherwise — create the site in Coolify, set a memory limit,
   attach domain + SSL, record the URL on the job, mark `active`.
3. **Active state:** shows in the customer's "My Systems" as Active with a
   link. They can add domain/SSL/backup add-ons from there.
4. **Renewal:** monthly, automatic (see §4.4).
5. **Offboarding:** customer cancels or lapses past the grace window → free
   the Coolify resource and its RAM allocation; see §4.4 for when to reclaim.

### 3.2 App Hosting (Bring Your Own App / BYOA)

Two entry points that both feed the **same** pipeline (unified 2026-07-20 —
there used to be two independent Coolify-calling code paths; don't
reintroduce that):

- **Cloud "Launch a resource" → App Hosting** — enter a repo URL directly,
  pay, done.
- **`/deploy` wizard** — richer flow: GitHub OAuth (or paste a public repo
  URL) → stack analysis → config → **requires App Hosting already purchased**
  (gates with a 402 + "Get App Hosting" CTA if not) → deploy.

**What actually happens on deploy:** the repo URL is written onto the
customer's `Web Account.source_code`, the existing Provisioning Job for their
App Hosting service is **requeued** (not recreated — one job per service,
reused across redeploys), and the runner is kicked immediately.

**Build progress the customer sees:** Provisioning Infrastructure → Building
Application → Deploying to Edge → Securing with SSL, polling
`GET /api/portal/services/starter-app-hosting/activity` every 4s.

**Operator checklist when a customer reports a stuck/failed deploy:**
1. Open **Admin → Provisioning**, find the job by service id + web account.
2. Check `status`: `queued` waiting to be picked up, `running` mid-build,
   `needs_human` stuck (read the `error` field), `active` done.
3. If `queued` and **not moving for more than a poll cycle**, that's the
   exact incident in §5.1 — check whether the runner is actually enabled and
   actually reachable, don't assume it will self-heal.
4. If `needs_human`: read the reason (unconfigured lane, capacity gate, build
   failed after retries), fix the cause, **Retry**.
5. Never re-trigger a deploy repeatedly hoping it works — one clean attempt,
   then escalate if it doesn't move.

### 3.3 Databases (standalone)

1. **Buy:** Cloud "Launch a resource" → Database Hosting, or the Products
   page database cards (`/checkout/new?serviceId=db-*`).
2. **Provision:** coolify lane for the light/volume engines (MySQL, Postgres,
   Mongo, Redis, `starter-db-*`) — auto once configured. `biz-db-medium` and
   `ent-db-large` are premium/dedicated — bench/manual.
3. **Active state:** connection details recorded on the job, shown in
   "My Systems". Customer is responsible for their own app's connection
   string; we don't manage schema.
4. **Renewal/offboarding:** same as Website Hosting.

### 3.4 Storage

Same as Database Hosting — coolify lane, instant via Cloud launch, auto once
configured. Nothing product-specific beyond capacity math (disk, not RAM,
though `resources.ramMb` still applies for the container overhead).

### 3.5 Email Hosting

Coolify lane for `starter-email`/`biz-email` (volume); `ent-mail` is
dedicated/manual. **Note:** email deliverability (SPF/DKIM/DMARC) is a
per-domain setup step regardless of automation — verify it explicitly when
provisioning, it's not something the lane configures for you.

### 3.6 Domain Registration — the one product that is **always** manual

This is a deliberate architectural choice, not a gap: domain products are
`capacityClass: "volume"` but **zero server footprint** (`ramMb: 0`,
`diskGb: 0`) and are hard-routed to the `manual` lane in `catalog.js` — they
must never fall through to `coolify`, which would try to build a real
container for a purchase that touches no infrastructure at all.

1. Customer searches/picks a domain on the Products page (no login required
   to price it) and checks out — billed **yearly**, shown at a
   monthly-equivalent price with an annual-billing disclosure.
2. A Provisioning Job is created but will **never** auto-complete — it always
   lands `needs_human` by design.
3. **You, by hand:** register/transfer the domain with the upstream
   registrar, point DNS at whatever the customer is hosting with us (or their
   own infra if they're bringing their own hosting), then mark the job
   `active` with the registration reference on it.
4. **Known deferred automation** (see project memory, not yet unblocked):
   automated registration via Hostinger's API is possible (pricing calls are
   supported) but not yet wired; auto-refund on registration failure needs
   M-Pesa B2C credentials Murzak doesn't have yet. Both are pure resale
   margin plays, not urgent — keep doing this by hand until those land.
5. **Renewal:** yearly, not monthly — don't apply the standard 30-day renewal
   cycle logic to domain line items; check the renewal service's domain
   handling before assuming a lapsed domain behaves like a lapsed hosting
   plan.

### 3.7 Custom Software Development

Entirely outside the catalog/checkout system.
1. Lead comes in via "Talk to Sales" / Contact / the Custom Software page CTA.
2. Scope, quote, and contract **out-of-band** (email, calls, a proposal doc).
3. Build and deliver per the agreed contract — this is bespoke engineering
   work, not something this platform automates.
4. If the delivered system needs hosting, sell it a normal hosting product
   (App Hosting via BYOA if it's containerizable, or a dedicated/manual
   product if not) through the regular catalog so it gets tracked like
   everything else.

### 3.8 Ready-made business systems (ERP / POS / CRM)

1. **Buy:** dedicated marketing pages (`/products/erp`, `/products/pos`,
   `/products/crm`) link into the Pricing configurator, or the industry pages
   (`/for/retail`, `/for/clinics`, etc.) pitch the same systems by vertical.
2. **Provision:** `bench` lane — create a Frappe site (`bench new-site`),
   install the right app, restore seed data if applicable. **Check capacity
   first** (§4.5) — these eat 1–2 GB RAM each, only ~4–8 fit per box.
3. **Configured vs light:** `biz-erp-light` is a bare install;
   `biz-erp-configured` includes setup/configuration work — budget staff time
   accordingly, it is not a bigger VM, it's more of your labor.
4. **Enterprise tier** (`ent-erp-large`, `ent-pos-multibranch`) is
   dedicated/manual — own server, quote-only, coordinate directly with the
   customer on scope and timeline.
5. **Renewal/offboarding:** same monthly cycle as everything else, but
   offboarding a business-system tenant is higher-stakes — confirm the
   customer has exported their data before decommissioning.

### 3.9 Free 36-hour trial

1. Prospect requests a trial at `/test-request` — no payment.
2. A time-boxed demo (ERPNext sandbox / demo site) spins up.
3. **Auto-expires after 36 hours** — this is a sales tool, not free hosting;
   don't manually extend it without a real reason (an active sales
   conversation, not just a forgetful prospect).
4. A trial that wants to convert becomes a **normal paid order** — it does
   not "upgrade in place"; run it through the regular buy flow.

### 3.10 Universal add-ons

Purchased from within the portal (`AddonsModal`, "My Systems" → add a
service), never standalone. **Eligibility is enforced server-side**
(`addonEligibility.js`): a customer needs at least one real, non-domain-only
paid service before most add-ons unlock — this closes a bypass where a
domain-only purchase could be used to unlock add-on pricing meant for actual
hosting customers. Provisioning for an add-on is usually a config change on
the existing service (attach SSL, raise a backup cadence, etc.), not a new
job — confirm the specific add-on's fulfillment before assuming it needs its
own Provisioning Job.

---

## Part 4 — Cross-cutting workflows

### 4.1 Discovery & signup

- Marketing surfaces: Home, `/cloud` (infrastructure lane), `/products`
  (business systems + custom software + domains), `/pricing` (the
  configurator), industry pages (`/for/*`).
- Auth: email/password (bcrypt) or Google sign-in (Firebase → backend
  verifies token → Frappe Web Account → Express session). Brute-force
  lockout after repeated failures, Redis-backed with in-memory fallback.
- Session state drives everything downstream — `req.session.webAccount` is
  the identity used by every purchase/provisioning/support call.

### 4.2 Checkout & payment

Two shapes exist and both must be understood:

**A) Configurator checkout** (Pricing page) — build a plan across multiple
services → one invoice → pay once → `activateServicesForInvoice` marks the
invoice Paid, flips every purchased service Active, and enqueues one
Provisioning Job per service.

**B) Instant single-resource checkout** (Cloud "Launch a resource", and the
Products page's individual database/domain cards) — goes through
`orderStore.js`'s **Checkout Order** flow first: a Draft order reserves RAM
for 30 minutes while the customer completes payment (so two simultaneous
buyers can't both be sold the last slot), then a Portal Invoice is created
and linked, and payment proceeds exactly as in (A) once paid.

Both payment rails converge on the same activation hook:
- **M-Pesa**: STK push → Safaricom calls back a secret URL → callback matches
  the invoice via `mpesa_checkout_request_id` → activates.
- **PayPal**: client-side capture → server verifies → activates.

**This is the single most fragile join point in the whole platform** — if
either the Checkout Order doctype or the M-Pesa custom field is missing in
Frappe, payment can succeed while activation silently never happens. See §5.2
and §5.3.

### 4.3 Support (Admin Inbox)

- **Portal → admin → Inbox.** Every customer conversation is a thread:
  New / Waiting on admin / Waiting on user / Resolved.
- Prioritize **"Waiting on admin"** (shown in red).
- Brand voice: plain, human, reassuring — no jargon, no fake SLA numbers.

### 4.4 Billing, renewals, refunds

- Recurring billing is a periodic sweep (`renewalService.js`): finds each
  account's latest Paid invoice, and once it's older than the billing cycle
  (default 30 days) with no other open invoice, creates a new Unpaid renewal
  invoice, alerts the customer in-portal, and emails them (best-effort).
- **Suspension on non-payment is OFF by default** (`RENEWAL_SUSPEND_ENABLED`)
  — don't assume a lapsed customer's service gets cut automatically unless
  you've explicitly turned that on and proven the renewal-email flow works
  first.
- **Domains bill yearly, not monthly** — don't apply the 30-day cycle
  assumption to domain line items.
- **Refunds/disputes:** handled in the payment provider (M-Pesa/PayPal)
  directly, then reflect the outcome on the invoice/account by hand.
  Automated refund-on-failure exists for PayPal; M-Pesa B2C refund automation
  is blocked on Safaricom credentials Murzak doesn't have yet (§3.6 applies
  the same way here) — refund M-Pesa manually until that's unblocked.

### 4.5 Admin operations & capacity management

- **Admin Provisioning panel**: readiness checklist, dispatcher mode,
  per-box capacity bars, job list with Retry/Run-queue-now.
- **Capacity rule of thumb:** ~4–8 business-system (premium) tenants per box
  before the 85% RAM gate parks new heavy tenants as `needs_human` and logs a
  scale-out request. That is the signal to provision box #2, not to force a
  tenant onto an already-tight box.
- **Adding a box:** stand it up, register it in `PROVISIONING_TARGETS`, retry
  any parked jobs.

### 4.6 Developer/Terminal Access (Enterprise)

- Gated behind `TERMINAL_ENABLED` (off by default) and a **two-step consent
  gate**: staff approve access, then the customer accepts a disclosure — both
  writes land on `Web Account` custom fields.
- **If those custom fields were never imported into Frappe**, both steps
  silently persist nothing — approvals look like they worked but the
  customer stays stuck at "awaiting approval" forever, with no visible error
  anywhere. See §6 — this is now a readiness-panel check, use it before
  troubleshooting anything else.

### 4.7 Security & data — standing duties

- Secrets (payment keys, Frappe token, SMTP, Firebase) live in server
  settings only — never share/screenshot/commit them.
- Backups must be off-box; verify they exist and test a restore periodically.
- Never hand a customer shell access to the shared server — tenants stay
  containerized, per-tenant DB credentials, firewall in front.
- Rotate any key you suspect leaked, immediately.
- Don't poke around tenant data without a support reason.

---

## Part 5 — Incident playbook

Entries marked **(real incident)** are documented from actual bugs found and
fixed on this platform — keep them here so the *pattern* is recognized
immediately if something similar resurfaces, not just the specific instance.

### 5.1 A BYOA (or any Coolify-lane) job is stuck `queued`/`running` and not moving **(real incident)**

- **Symptom:** the deploy wizard's progress screen sits on "Provisioning
  Infrastructure" indefinitely; `GET /api/portal/services/:id/activity` shows
  the same job, same `updatedAt`, across repeated checks.
- **Root cause class:** a job claimed by a runner process that then died
  mid-build (crash/restart) is orphaned — nothing re-selects a `running` job
  (only `queued` ones are claimable), so it's stuck forever with zero
  self-healing unless something explicitly reclaims it.
- **What's already fixed:** `reclaimStaleRunning()` in `runner.js` now
  requeues (or escalates past max attempts) any job stuck `running` past
  `PROVISIONING_STALE_RUNNING_SEC` (default 15 min) — but this **only runs
  when `processQueue()` is actually invoked**.
- **Check first:** is `PROVISIONING_RUNNER_ENABLED=true`? Without it, the
  only thing that ever calls `processQueue()` is a one-shot fire-and-forget
  call right after checkout/deploy — if that single attempt fails silently
  (server logs are the only place this shows up), nothing retries it, ever.
  This is a distinct failure mode from the orphaned-`running` case: a job
  stuck `queued` (not `running`) with unchanged `attempts` means
  `processQueue()` likely never advanced it at all — check server console
  logs for what it's actually throwing before assuming the reclaim fix
  applies.
- **Fix:** enable the runner for a real background sweep, not just a single
  fire-and-forget kick per action.

### 5.2 A self-serve purchase (any product) 503s with "Checkout is not configured." **(real incident)**

- **Symptom:** clicking "Launch Now" in Cloud's launch modal (or any
  instant-checkout path) shows a red inline error "Checkout is not
  configured," or — before the fix below — a full-page "Service Temporarily
  Unavailable" takeover that hides the real message.
- **Root cause:** the `Checkout Order` Frappe doctype was documented as a
  required one-time setup step but was never actually imported into
  production. `orderStore.js` returns a legitimate, JSON-bodied 503 in this
  exact case — it's the app correctly reporting a config gap, not a real
  outage.
- **What's already fixed:** `backend/data/doctype-checkout-order.json` now
  exists to import; the readiness panel checks for it
  (`doctype_checkout_order`); the frontend's `apiInterceptor.ts` no longer
  treats a JSON-bodied 503 as a platform-wide outage (see §5.5).
- **Fix:** import the doctype into Frappe. Verify via the readiness panel,
  not by re-testing checkout blind.

### 5.3 Customer paid via M-Pesa but their service never activated

- **Symptom:** customer insists they paid (has an M-Pesa confirmation SMS),
  portal still shows "Awaiting payment."
- **Root cause class:** the STK-push callback matches the paying invoice via
  `Portal Invoice.mpesa_checkout_request_id` — a custom field that must be
  imported (`backend/data/custom-fields-portal-invoice-mpesa.json`). Missing
  it means the callback logs "no invoice found" and returns, with **no
  customer notice and no staff alert**. This is the highest-risk gap in the
  whole platform — real money moved with no automatic trace.
- **Check:** readiness panel's `custom_field_mpesa` check (only shown once
  M-Pesa creds are set). If red, import the custom field immediately.
- **In the meantime:** confirm the payment genuinely settled (check Frappe /
  M-Pesa records directly, not just the customer's word), then use the
  manual activation path to flip the invoice/service — never assume "no
  record found" means the customer is lying.

### 5.4 A customer's Developer Access approval "doesn't work"

- **Symptom:** staff clicks "Approve Developer Access," customer accepts the
  disclosure, but the portal keeps showing "awaiting approval" / "disclosure
  required" indefinitely.
- **Root cause:** the three `Web Account` custom fields these actions write
  to were never imported — Frappe silently drops writes to unknown fields, so
  both actions *appear* to succeed with no error.
- **Check:** readiness panel's `custom_field_terminal_consent` check (only
  shown once `TERMINAL_ENABLED=true`). Import
  `backend/data/custom-fields-web-account.json` if red.

### 5.5 The whole site shows a full-page "Service Temporarily Unavailable" screen **(real incident, now fixed)**

- **Old behavior:** the frontend's global fetch interceor treated **any**
  502/503 response as proof the entire backend was down, and slammed a
  full-page takeover over the whole app — including legitimate,
  self-diagnosing application errors like 5.2's "Checkout is not
  configured."
- **Fixed:** it now only triggers the outage screen for **non-JSON**
  502/503s (the kind a reverse proxy serves when the Node process itself is
  genuinely unreachable). A JSON-bodied 503 with a specific `error` message
  surfaces inline through the normal per-feature error handling instead.
- **If you still see the full-page takeover:** that now means a real
  gateway-level outage (Node process down, reverse proxy can't reach it) —
  check the backend process is actually running, not application config.

### 5.6 Capacity bar going orange/red

- **Symptom:** Admin Provisioning panel's capacity bar for a box nears/hits
  85%.
- **Do:** stop placing new heavy (premium-class) tenants on that box; plan
  and provision box #2; register it in `PROVISIONING_TARGETS`; retry any jobs
  parked as `needs_human` for capacity reasons once the new box is live.
- **Don't:** raise the threshold to make the alert go away — it exists to
  prevent overselling RAM that doesn't exist.

### 5.7 Suspected security incident on a tenant

- Isolate the tenant (it's containerized — this is safe and reversible).
- Rotate its credentials.
- Check the WAF/edge logs for the tenant.
- Review access logs before concluding anything.
- Never restore from a backup you haven't verified is clean.

---

## Part 6 — Go-live / readiness master checklist

Every load-bearing Frappe doctype and custom field the platform depends on,
whether or not the automated readiness panel (`/api/admin/provisioning/readiness`,
**Admin → Provisioning**) currently checks for it. **Where the panel doesn't
check something yet, that's flagged explicitly below — those are the next
places a Checkout-Order-style silent failure could hide.**

| Requirement | File to import | Readiness panel check | Level | Silent-failure risk if skipped |
|---|---|---|---|---|
| Provisioning Job doctype | `doctype-provisioning-job.json` | `doctype_job` | required | Stage 0 (notify-only) can't even record orders |
| Capacity Request doctype | `doctype-capacity-request.json` | `doctype_capacity` | optional | Scale-out requests aren't recorded (still emailed) |
| Checkout Order doctype | `doctype-checkout-order.json` | `doctype_checkout_order` | required | **All self-serve checkout 503s** (§5.2) |
| Portal Update doctype | `doctype-portal-update.json` | `doctype_portal_update` | required | Portal "Updates & support" feed + concierge chat break |
| Portal Invoice M-Pesa fields | `custom-fields-portal-invoice-mpesa.json` | `custom_field_mpesa` (only when M-Pesa creds set) | required | **Paid services never activate** (§5.3) — highest risk on this list |
| Web Account terminal-consent fields | `custom-fields-web-account.json` | `custom_field_terminal_consent` (only when `TERMINAL_ENABLED=true`) | required | Developer Access approvals silently no-op (§5.4) |
| Terminal Session doctype | `doctype-terminal-session.json` | `doctype_terminal_session` (only when `TERMINAL_ENABLED=true`) | required | Terminal sessions can't be minted |
| Terminal Recording Access Log doctype | `doctype-terminal-recording-access-log.json` | `doctype_terminal_recording_log` (only when `TERMINAL_ENABLED=true`) | required | Recording access audit trail missing |
| Portal Invoice PayPal audit fields | (see `custom-fields-*` in `backend/data/`) | not checked | — | Already fails soft with a clear console message; lower priority |
| `ADMIN_EMAILS` set | env var | `admin_emails` | required | Staff never notified of new orders/scale-out |
| SMTP configured | env var | `smtp` | required | No customer/staff emails send at all |
| At least one build lane configured | env vars (Coolify/bench) | `lane_coolify` / `lane_bench` | conditional on runner | Jobs escalate to `needs_human` instead of building |
| Dedicated persistent Redis for BullMQ | env var | `redis_dedicated` | optional | Session-cache eviction can silently drop a paid job |

**Rule going forward:** any time a new Frappe doctype or custom field becomes
load-bearing for a feature, add it to `readiness.js` in the same commit —
that is what turns a "documented, forgotten, discovered in production" bug
into a "red checkmark in the admin panel before it ever ships to a customer"
non-event. This exact discipline gap is what caused §5.2.

---

## Part 7 — Quick reference: who does what, when

| When... | You do this |
|---|---|
| A customer buys anything | Check Admin → Provisioning for the job; it either auto-builds or waits for you |
| A job is `needs_human` | Read the reason on the job, fix the cause, click Retry |
| A domain is purchased | Always manual (§3.6) — register with upstream registrar, point DNS, mark active |
| Custom Software lead comes in | Out-of-band: scope, quote, build, deliver (§3.7) |
| A box nears 85% RAM | Plan and provision a second box (§4.5, §5.6) |
| A customer says "I paid but nothing happened" | Confirm payment genuinely settled, check for the M-Pesa custom-field gap (§5.3) before anything else |
| Setting up a new environment / going live | Walk `docs/provisioning-go-live.md` stage by stage, verify every row in Part 6 is green |
| Something that used to work now silently doesn't | Check the readiness panel first — a missing doctype/custom field is the most common silent-failure shape on this platform (Part 6) |
