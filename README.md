# Murzak Technologies

White-label managed-hosting storefront + customer portal. Sells KES-priced plans
(web hosting, email, ERPNext/POS/CRM, domains) off one Hostinger KVM 4 server,
takes **M-Pesa** and **card** payments, and optionally **provisions** the hosting
automatically.

> The application lives in **`frontend/`** (React + Vite SPA) and **`backend/`**
> (Express + Frappe/ERPNext). Files at the repo root are legacy and unused.

---

## 📚 Documentation

Start with the doc that matches who you are:

| You are… | Read | What it covers |
|---|---|---|
| **New here / engineer** | [docs/application-overview.md](docs/application-overview.md) | Tech stack, repo layout, key flows, how to run it locally |
| **Running the business (staff)** | [docs/operations-manual.md](docs/operations-manual.md) | The human runbook: orders, provisioning, support, billing, capacity, incidents |
| **Turning on provisioning automation** | [docs/provisioning-go-live.md](docs/provisioning-go-live.md) | Stage-by-stage go-live, env var by env var, kill switches |
| **Working on provisioning code** | [backend/services/provisioning/README.md](backend/services/provisioning/README.md) | Subsystem internals, lanes, runner, dispatch, tests |
| **Planning the architecture** | [docs/provisioning-automation-plan.md](docs/provisioning-automation-plan.md) | Strategy + design of the provisioning automation |

---

## 🚀 Quick start

```bash
# Backend — API on :3001 (serves the SPA in production)
cd backend && npm install && npm run dev

# Frontend — Vite dev server on :3000, proxies /api → :3001
cd frontend && npm install && npm run dev
```

Open http://localhost:3000. Features needing Redis / Frappe / payment creds are
env-guarded and stay inert until configured — see `backend/.env.example`.

**Useful commands** (in `backend/`):
- `npm test` — provisioning test suite (no Redis/Frappe needed; everything mocked)
- `npm run gen:catalog` — regenerate the backend catalog snapshot after editing
  `frontend/src/config/serviceCatalog.ts`

---

## 🧱 Stack

React 19 · Vite 6 · TypeScript · Tailwind · Express · Frappe/ERPNext · Redis ·
PayPal + M-Pesa (Daraja) · Firebase (analytics + Google sign-in) · BullMQ
(optional provisioning queue).

## 🔐 Configuration

All settings are documented in [`backend/.env.example`](backend/.env.example).
**`.env` is gitignored and must never be committed** — it holds payment keys, the
Frappe token, SMTP, the Firebase service account, and the session secret.
