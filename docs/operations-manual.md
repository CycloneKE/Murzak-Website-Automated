# Murzak Technologies — Operations Manual (the human side)

This is the staff handbook for **running** the platform day to day: what the
system does, what customers experience, and — most importantly — **what a human
needs to do, and when.** It assumes no coding knowledge.

For deep technical/automation setup, see the companion docs:
- `docs/provisioning-go-live.md` — turning automation on, env var by env var.
- `docs/provisioning-automation-plan.md` — the architecture/strategy.
- `backend/services/provisioning/README.md` — the provisioning internals + runbook.

---

## 1. What Murzak is (in one minute)

Murzak resells **managed hosting and business systems** in Kenya. We rent **one
powerful server** (a Hostinger KVM 4: 4 CPU, 16 GB RAM, 200 GB disk) and resell
slices of it as retail plans priced in **KES**, paid by **M-Pesa or card**.

The money-maker is **hosted business systems** — ERPNext, POS, CRM, accounting —
which are sticky and high-margin. Plain web hosting and email are cheap add-ons.

**The golden rule:** **RAM is the ceiling.** Light sites use ~50–150 MB each
(host dozens). A business system (ERP/POS/CRM) eats **1–2 GB each**, so only
**~4–8** fit on the box before we need a second server. Everything below is built
around not overselling that 16 GB.

---

## 2. The system at a glance

| Piece | Plain-language job | Who touches it |
|---|---|---|
| **Customer portal** (website) | Where customers sign up, pick plans, pay, and see their systems | Customers; you via Admin |
| **Backend** | The engine behind the website — accounts, payments, provisioning | Runs itself |
| **Frappe / ERPNext** | Our database of record — accounts, invoices, services, provisioning jobs | You, via the portal/admin |
| **Payments** | M-Pesa (Daraja) + PayPal (card) | Runs itself; you reconcile edge cases |
| **Provisioning** | Creating a customer's actual hosting after they pay | **You** (until automation is on) |
| **Admin panel** | Your control room: support inbox + provisioning | **You** |

You mostly live in two places: the **Admin Inbox** (support) and the **Admin
Provisioning** panel (orders & capacity).

---

## 3. Roles & access

- **Admins** are accounts whose email is listed in the server's `ADMIN_EMAILS`
  setting. Anyone on that list, after logging into the portal, automatically sees
  the **admin area** (Inbox + Provisioning). No separate admin login.
- To add/remove an admin, edit `ADMIN_EMAILS` (comma-separated) and restart the
  backend. The same list controls who the system emails about new orders.
- Customers only ever see their own account.

> Security: admins act with full power over customer data. Treat the admin
> account like the keys to the business.

---

## 4. The customer journey (so you know what they see)

1. **Discover** → browse plans, **Products** page (domains + add-ons are priced
   there without needing an account), or start a **free 36-hour trial**.
2. **Sign up** → email/password or "Continue with Google".
3. **Configure a plan** → the configurator groups services by category (Website,
   ERP, Email, Security, etc.) with live KES pricing; they can add a domain.
4. **Pay** → M-Pesa prompt or card. On success the invoice flips to **Paid**.
5. **Onboarding** → a friendly welcome wizard runs once.
6. **Portal** → tabs: **Overview**, **Updates & support**, **My Systems**,
   **Billing**, **My Account**. "My Systems" shows each service as Active or
   "Awaiting payment".

What happens the instant they pay is the heart of your job — Section 5.

---

## 5. The core workflow — a customer just paid

When an invoice is paid, the system automatically:
1. Marks the invoice **Paid** and the purchased services **Active**.
2. Creates a **Provisioning Job** for each service.
3. **Emails the team** (everyone in `ADMIN_EMAILS`) with the order.

What happens next depends on the **automation stage** you're running:

### If automation is OFF (Stage 0 — the default, safe mode)
**You provision by hand.** This is the most common day-1 situation.

1. You get an email: `[Provisioning] N service(s) queued — INV-…`.
2. Open **Admin → Provisioning**. The job(s) show as **queued**.
3. For each job, note the **lane** and **RAM** and follow the runbook (Section 7).
4. When the customer's system is live, put their access details on the job and
   set it to **active** (Frappe). The customer's portal then shows it ready.

### If the runner is ON (Stage 1+)
The system builds jobs automatically. **You only act on exceptions** — jobs that
land in **needs_human** (capacity reached, a lane not configured, or a build that
failed after retries). Open the panel, read the reason, fix it, and hit **Retry**.

> You are never blocking a payment. Provisioning runs *after* the money is in —
> if anything goes wrong, the customer has still paid and nothing is lost; the
> job simply waits for a human.

---

## 6. Using the Admin Provisioning panel

**Portal → admin → Provisioning.** Four areas:

- **Go-live readiness** — a green/red checklist of what's configured. Use it
  when setting things up: add a setting, refresh, watch it go green. "Ready"
  means the essentials are in place.
- **Dispatcher** — shows the mode (`off` / `poll` / `bullmq`) and, in queue mode,
  how many jobs are waiting/active/failed.
- **Capacity** — a RAM bar **per box**. When a bar nears the top (turns orange at
  85%), that box is nearly full — time to plan a second server. Open scale-out
  requests appear here.
- **Jobs** — every provisioning job. Filter by status. Buttons:
  - **Run queue now** — nudge the runner to process waiting jobs immediately
    (instead of waiting for its timer).
  - **Retry** (per job) — re-queue a `failed` or `needs_human` job after you've
    fixed the cause.

**Job statuses, in plain words:**

| Status | Meaning | Your action |
|---|---|---|
| `queued` | Waiting to be built | None (or build it by hand in Stage 0) |
| `running` | Being built right now | Wait |
| `active` | Live and handed to the customer | Done |
| `needs_human` | Stuck — capacity, config, or repeated failure | Read the note, fix, **Retry** |
| `failed` | Build error (will retry automatically a few times) | If it sticks, investigate + **Retry** |

The job also shows **backup** and **edge/WAF** state (`configured` / `skipped` /
`failed`) so you can see, per tenant, whether off-site backup and the firewall
were wired.

---

## 7. Provisioning a tenant by hand (the runbook)

Each service has a **lane** that tells you how to build it:

### Lane: `coolify` — websites, apps, static sites, databases (light)
1. In Coolify, create the app/site/DB for the customer.
2. **Set a memory limit** (so one tenant can't starve the box).
3. Attach their domain and issue SSL.
4. Record the URL/admin login on the job → set status **active**.

### Lane: `bench` — ERPNext / POS / CRM / accounting (heavy)
1. Create a new Frappe **site** for the tenant (`bench new-site`), DNS-routed.
2. Install the right app (erpnext / pos / crm), restore any seed data.
3. **Check capacity first** (Section 8) — these eat 1–2 GB each.
4. Record the site URL + admin login on the job → set status **active**.

### Lane: `manual` — large / dedicated (Enterprise)
These are **quote-only** and live on their own server, not the shared box. Handle
out-of-band: scope it, quote it, provision a separate machine, and coordinate
directly with the customer.

> Always: **per-tenant database credentials, never shared shell access, a
> firewall/WAF in front, and an off-site backup.** These are non-negotiable for
> keeping customers isolated and safe.

---

## 8. Capacity management — don't oversell the box

- Check the **Capacity** bars before provisioning any **ERP/POS/CRM** tenant.
- The system enforces a soft limit (default **85%** of usable RAM). Past it, new
  heavy tenants are **parked as `needs_human`** and a **scale-out request** is
  logged + emailed — that is the signal to **provision a second box**, not to
  force it.
- Light tenants (web/email/storage) rarely hit the limit — don't worry about
  them.
- **Adding a second box:** stand up the new server, then register it in the
  `PROVISIONING_TARGETS` setting (see go-live doc). New heavy tenants will start
  landing there automatically. Re-queue any parked jobs with **Retry**.

Rule of thumb: **~4–8 business-system tenants per box.** Plan the next box before
you hit the wall, not after.

---

## 9. Support — the Admin Inbox

**Portal → admin → Inbox.**

- Every customer conversation is a **thread** with a status (New, Waiting on
  admin, Waiting on user, Resolved).
- Click a thread → read it → type a reply (you can attach files). Statuses update
  automatically when you reply.
- Threads refresh live. Prioritise **"Waiting on admin"** (red).
- Brand voice: **plain, human, reassuring** — no jargon. Match the rest of the
  portal ("Usually replies same day", not "SLA 12ms").

---

## 10. Billing & payments

- **You don't normally touch payments** — M-Pesa and card capture flip invoices
  to **Paid** and trigger provisioning automatically.
- **Failed/abandoned payment:** the service stays "Awaiting payment" in the
  customer's portal; they can retry from **Billing**. No action needed from you
  unless they ask for help.
- **M-Pesa reconciliation edge cases** (paid but not reflected): check the
  invoice in Frappe; there's a manual activation path for genuine cases — use it
  only after confirming the payment really landed.
- **Renewals:** plans are monthly. Watch for lapses; a lapsed business-system
  tenant still holds its RAM until you decommission it — free the capacity when a
  customer truly leaves.
- **Refunds/disputes:** handle in the payment provider (M-Pesa/PayPal) and update
  the invoice/account accordingly.

---

## 11. Domains

- Customers can search and price domains on the **Products** page without logging
  in (prices are marked-up retail).
- Domain registration/transfer is a **pure resale** — low effort, do it freely.
- Until the registrar API is wired, treat a domain order as a manual task:
  register/transfer with the upstream registrar, then point DNS at the tenant.

---

## 12. Free 36-hour trials

- Prospects can spin up a **time-boxed demo** (ERPNext sandbox, a demo site).
- Trials **auto-expire after 36 hours** — they're a sales tool, not free hosting.
- A trial that wants to convert becomes a normal paid order (Section 5).

---

## 13. Incident response — common situations

| Situation | What it looks like | What to do |
|---|---|---|
| Order paid, nothing provisioned | Customer says "I paid, where's my system?" | Check **Admin → Provisioning** for the job; build it / **Retry**; reassure them payment is safe |
| Job stuck `needs_human` | Panel shows it with a reason | Read the reason: capacity → add a box; lane not configured → fix settings; build failed → investigate, then **Retry** |
| Box getting full | Capacity bar orange/red | Stop placing heavy tenants there; provision box #2; register it |
| Site down / slow | Customer reports outage | Check the box/Coolify; a noisy tenant may be over its limit; verify backups exist before any risky fix |
| Suspected breach | Odd activity on a tenant | Isolate the tenant (it's containerised), rotate its credentials, check the WAF, review logs |
| Payment landed but not reflected | Paid in M-Pesa, portal still "Awaiting" | Confirm the payment truly settled, then use the manual activation path |

**First instinct for any provisioning problem:** open the Provisioning panel,
read the job's status + note. It almost always tells you what's wrong.

---

## 14. Security & data — your standing duties

- **Secrets** (payment keys, the Frappe token, SMTP, Firebase) live in server
  settings only — **never** share, screenshot, or commit them. The backend holds
  **one powerful key** to Frappe, so all real permission checks happen
  server-side; don't try to bypass them.
- **Backups must be off the box.** A disk failure should never destroy both the
  data and its backup. Verify backups exist (and test a restore periodically).
- **Never hand a customer shell access** to the shared server. Keep tenants
  isolated (containers, per-tenant DB creds, firewall in front).
- **Rotate any key you suspect leaked**, immediately.
- **Customer data is theirs.** Don't poke around tenant data without a support
  reason; respect privacy.

---

## 15. Turning automation on/off (quick reference)

You don't need to code — these are settings (env vars) an operator/engineer sets.
Full detail in `docs/provisioning-go-live.md`. The big switches:

| Setting | Effect |
|---|---|
| `PROVISIONING_ENABLED=false` | Stop recording/notifying new orders (payments unaffected) |
| `PROVISIONING_RUNNER_ENABLED=true` | Turn on **automatic** building |
| `PROVISIONING_AUTOSCALE=false` | Never auto-create a new paid server (recommended default) |
| `ADMIN_EMAILS` | Who's an admin **and** who gets order/scale-out emails |

The readiness checklist in the panel tells you, at any moment, what's on and
what's missing.

---

## 16. Glossary

- **Tenant** — one customer's hosted system on our box.
- **Provisioning** — creating that hosted system after payment.
- **Lane** — the method used to build a service (`coolify`, `bench`, `manual`).
- **Capacity gate** — the safety rule that stops us overselling RAM.
- **Scale-out** — adding another server when the box is full.
- **needs_human** — a job that's waiting for you.
- **Volume / Premium / Dedicated** — light shared / heavy business-system /
  own-server classes of service.

---

## 17. Daily checklist (pin this)

- [ ] Skim **Admin → Inbox**; reply to anything "Waiting on admin".
- [ ] Open **Admin → Provisioning**; clear any `queued` (Stage 0) or
      `needs_human` jobs.
- [ ] Glance at the **Capacity** bars — anything near orange? Plan a box.
- [ ] Confirm new paid orders went live; spot-check a customer's "My Systems".
- [ ] Once a week: verify off-site backups exist and a restore works.
