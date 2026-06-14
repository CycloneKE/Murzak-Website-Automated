# Murzak Technologies — Application Overview

Technical/structural documentation of the platform: what it's built from, how the
pieces fit, the repo layout, and the key flows. For the operator's runbook see
`docs/operations-manual.md`.

---

## 1. What it is

A white-label managed-hosting storefront + customer portal for **Murzak
Technologies**. It sells slices of one Hostinger KVM 4 server as KES-priced plans
(web hosting, email, ERPNext/POS/CRM business systems, domains), takes **M-Pesa**
and **card** payments, and (optionally) **provisions** the hosting automatically.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 6 + TypeScript, Tailwind CSS (dark mode), React Router |
| Backend | Node.js + Express |
| Data / record of truth | Frappe / ERPNext (via REST, one privileged service token) |
| Sessions | express-session + Redis (`connect-redis`), env-guarded |
| Payments | PayPal (card) + M-Pesa Daraja (STK push + callback) |
| Email | Nodemailer (SMTP) |
| Auth extras | Firebase (GA4 analytics + Google sign-in), per-account brute-force lockout |
| Job queue (optional) | BullMQ + ioredis (provisioning dispatch) |

---

## 3. Repo layout

> The **real application lives in `frontend/` and `backend/`**. Files at the repo
> root are stale and not used.

```
frontend/                  React SPA
  src/
    pages/                 Home, Pricing, Products, About, Solutions, Login,
                           Payment, Portal, TestRequest (36hr trial), SLA,
                           Privacy/Terms, admin/ (AdminInbox, AdminProvisioning,
                           AdminTabs)
    components/            Header, Footer, PlanServicesModal (configurator),
                           DomainSearch, PayPal*Section, RequireAuth, …
    services/              Typed API clients: auth, account, invoices, paypal,
                           testPlan, domains, portalChat, adminChat,
                           adminProvisioning, firebase, …
    config/serviceCatalog.ts   THE catalog: plans, services, prices, capacity
    App.tsx, main.tsx
  vite.config.ts           dev server + /api proxy to backend
  .env.example             VITE_FIREBASE_* (public client config)

backend/                   Express API + serves the built SPA
  server.js                app, routes, auth, payments, Frappe glue (large)
  routes/paypalRoutes.js   PayPal capture → activation
  services/
    billingActivationService.js   paid invoice → mark Active → enqueue provisioning
    provisioning/          the provisioning subsystem (see §6)
    firebaseAdmin.js       verifies Google sign-in tokens (env-guarded)
    paypalService.js
  utils/                   mailer.js (SMTP), loginThrottle.js (brute-force lockout)
  config/paypal.js
  data/                    serviceCatalogSnapshot.json (generated),
                           doctype-*.json (Frappe doctypes to import)
  scripts/generate-catalog-snapshot.js
  test/provisioning.test.js   40-case provisioning suite (npm test)
  .env.example             ALL backend settings, documented

docs/                      this overview, operations-manual, provisioning-* docs
```

---

## 4. The service catalog (single source of truth)

`frontend/src/config/serviceCatalog.ts` defines every plan archetype
(Test/Starter/Business/Enterprise), every service (id, name, category, price,
**RAM/disk footprint**, **capacity class**), and the universal add-ons.

- **Capacity class** drives both economics and provisioning:
  - `volume` — light shared slices (web/email/storage/db). High density.
  - `premium` — managed Frappe apps (ERP/POS/CRM). ~1–2 GB each, low density.
  - `dedicated` — too big for the shared box; quote-only, own server.
- The backend reads a **generated snapshot** of this file
  (`backend/data/serviceCatalogSnapshot.json`) so the frontend stays the single
  source of truth. **After editing the catalog, regenerate:**
  `npm run gen:catalog` (in `backend/`).

---

## 5. Key flows

### Authentication
- Email/password (bcrypt) or **Google sign-in** (Firebase client → backend
  verifies the token → finds/creates a Frappe Web Account → Express session).
- **Brute-force lockout**: after repeated failures per account, login is blocked
  for a window (Redis-backed, in-memory fallback).

### Buying & payment
1. Customer configures a plan in the **configurator** (`PlanServicesModal`),
   optionally adds a domain.
2. An **invoice** is created in Frappe.
3. They pay via **M-Pesa** (STK push → Safaricom posts to a secret callback URL)
   or **PayPal/card**.
4. On success the payment path calls **`activateServicesForInvoice`**:
   marks the invoice **Paid**, flips the purchased services **Active**, and
   **enqueues provisioning** + emails staff.

> The activation hook is the single integration point between payments and
> provisioning. It's called from PayPal capture, the M-Pesa callback, and a
> manual admin activation path.

### Provisioning
See §6 — turns a paid order into real hosting.

### Portal
Authenticated SPA: Overview, Updates & support, My Systems, Billing, My Account,
plus a one-time onboarding wizard. Admins additionally get the **admin area**
(Inbox + Provisioning).

---

## 6. The provisioning subsystem (`backend/services/provisioning/`)

Built in phases; all **off by default** (gated by env flags), so the app behaves
normally until you turn it on. Full detail: `provisioning/README.md` and
`docs/provisioning-go-live.md`.

| File | Role |
|---|---|
| `provisioningService.js` | Enqueue a job per paid service (idempotent); notify staff; capacity gate at payment time |
| `catalog.js` | Backend view of the catalog (from the snapshot): footprint, lane routing |
| `capacity.js` | RAM threshold math (don't oversell) |
| `targets.js` | Multi-box placement (box-1 + extras), per-box reserved RAM + premium cap |
| `scaling.js` | Scale-out: Capacity Request + notify + optional Hostinger auto-create |
| `runner.js` | The worker: claim → build by lane → active / retry+backoff / escalate |
| `lanes/coolify.js` | Build lane for volume services (Coolify API) |
| `lanes/bench.js` | Build lane for premium services (Frappe `bench` script) |
| `backups.js`, `edge.js` | Off-site backup + per-tenant WAF, wired at create-time |
| `queue.js` | Dispatch layer: `poll` (default) or `bullmq` (Redis, atomic locking) |
| `readiness.js` | Go-live checklist powering the admin panel |

**Design guarantees:** never blocks/rolls back a payment; never marks a job
`active` unless a lane truly succeeded (unconfigured/manual lanes escalate to a
human); idempotent; the Frappe doctype is always the source of truth (BullMQ only
dispatches).

**Admin endpoints** (all require an admin session):
`GET /api/admin/provisioning/{readiness,queue,capacity,jobs}`,
`POST /api/admin/provisioning/run`, `POST /api/admin/provisioning/jobs/:id/retry`.

---

## 7. Running it locally

**Prerequisites:** Node.js, npm. (Redis/Frappe/payment creds are optional — features
that need them are env-guarded and stay inert when unset.)

```bash
# Backend (terminal 1) — serves API on :3001
cd backend
npm install
# set at least NODE_ENV=development PORT=3001 SESSION_SECRET=… in the shell or .env
npm run dev

# Frontend (terminal 2) — Vite dev server on :3000, proxies /api → :3001
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The Vite dev server proxies `/api/*` to the backend.

- `npm test` (in `backend/`) runs the provisioning test suite (no Redis/Frappe
  needed — everything mocked).
- `npm run build` (in `frontend/`) produces the production SPA in `frontend/dist`,
  which the backend serves in production.

---

## 8. Configuration & secrets

- All backend settings are documented in **`backend/.env.example`** (core,
  Frappe, SMTP, admin, M-Pesa, PayPal, Firebase, provisioning, queue, scaling,
  backups, edge).
- **`.env` is gitignored and must never be committed.** It holds payment keys,
  the Frappe token, SMTP, Firebase service account, and session secret.
- Frontend `VITE_FIREBASE_*` values are **public client config** (safe in the
  browser); the Firebase **service account** is a backend-only secret.
- Production must set a strong `SESSION_SECRET` and `MPESA_CALLBACK_SECRET`.
- The backend holds **one privileged Frappe token**, so all authorization is
  enforced server-side — never trust the client for permissions.

---

## 9. Deployment notes

- Build the SPA (`frontend/dist`) and serve it from the backend (Express serves
  static + an SPA fallback; API routes are registered before the fallback).
- Run the backend behind HTTPS; set `ALLOWED_ORIGINS`, `APP_BASE_URL`.
- Point the M-Pesa callback at `…/api/billing/mpesa/callback?token=<secret>`.
- For provisioning automation, follow `docs/provisioning-go-live.md` and import
  the Frappe doctypes in `backend/data/`.
- Run a **single backend instance** with the `poll` dispatcher, or multiple with
  the `bullmq` dispatcher + a dedicated persistent Redis.

---

## 10. Where to read next

- **Operators / staff:** `docs/operations-manual.md` (the human runbook).
- **Turning on automation:** `docs/provisioning-go-live.md`.
- **Provisioning internals:** `backend/services/provisioning/README.md`.
- **Strategy/architecture:** `docs/provisioning-automation-plan.md`.
