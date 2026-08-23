# Production environment setup

How to actually get the ~139 env vars in `backend/.env.example` onto the live
server, in the right order, without a broken or half-configured boot. This is
the "how" — `backend/.env.example` remains the source of truth for what each
var does and its default; don't duplicate that commentary here, only the
sequence and the blast radius.

Companion docs: `docs/operations-manual.md` (the general handbook),
`docs/provisioning-go-live.md` (turning provisioning automation on stage by
stage — read that after this doc's Tier 1 is green), `docs/operations-workbook.md`
(per-product playbooks).

---

## 0. How env vars actually reach the container

`backend/.env` is gitignored and **never** committed (`.gitignore` covers
`.env`, `*.env`, `.env.*`) and the `Dockerfile` never `COPY`s one in — it's a
single-stage `node:22-alpine` image that reads `process.env` at runtime only.
That means:

- There is no `.env` file to edit on the server. Env vars are set in
  **Coolify's Environment Variables panel** for this application, and Coolify
  injects them into the container at start.
- A change to an env var requires a **redeploy** (Coolify restarts the
  container with the new environment) — editing the panel alone does not
  reach an already-running process.
- Never paste secrets into a build arg or anything that ends up in an image
  layer or build log. Runtime env vars only.
- `NODE_ENV=production` must be one of these vars. The Dockerfile does not set
  it — `ENV NODE_ENV=production` was removed from the runtime stage's
  responsibility and left to Coolify's panel, so **confirm it's actually set
  there**; nothing else in this doc's guards fire without it.

If you're setting this up somewhere other than Coolify (a bare VPS, a
different PaaS), the same variables apply — just substitute "restart the
process with these vars in its environment" for "Coolify redeploy."

---

## 1. Tier 0 — boot-blocking (the container will not start without these)

Checked in `server.js` at module load, before the port opens:

```
SESSION_SECRET=          # openssl rand -hex 32
FRAPPE_BASE_URL=
FRAPPE_API_KEY=
FRAPPE_API_SECRET=
```

Missing any of these in `NODE_ENV=production` → the process logs `FATAL:
missing required env vars in production: ...` and exits 1. Coolify will show
the container crash-looping; check the deployment logs for that exact line.

Also checked at the same point — these must be **absent or false**, not just
"not true":

```
DEV_AUTO_LOGIN=false   # or unset
MOCK_FRAPPE=false      # or unset
```

If either is `true`, boot fails with `FATAL: dev-only flag(s) set to true in
production: ...`. This is deliberate — it exists so a dev `.env` accidentally
copied into Coolify's panel can't ship a fake-auth, fake-backend build to real
customers. If you hit this, the fix is to remove the var from Coolify's panel
entirely (don't set it to `false` if you can just delete it).

**Verify:** the container boots and stays up. `docker ps` / Coolify's health
indicator shows running, not restarting.

---

## 1a. Before you deploy this code at all: the admin email-verification prerequisite

Not an env var — a **Frappe schema + data step that must happen before this
build goes live**, or every admin is locked out with no self-service recovery.

`requireAdmin` (`server.js`) now requires the account's `email_verified`
field on `Web Account` to be truthy, in addition to the email matching
`ADMIN_EMAILS`. This closes a real hole (an unregistered `ADMIN_EMAILS`
address like `admin@` could previously be self-registered by a stranger and
used immediately), but it has two consequences that bite on the *first*
deploy of this change:

1. **Import the field before deploying:**
   ```bash
   bench --site <site> import-doc backend/data/custom-fields-web-account.json
   ```
   Without it, a `GET` on the account simply omits the key (Frappe doesn't
   error on a missing field at read time), which reads as `false` — every
   admin request 403s, immediately, for everyone.

2. **Importing the field is not enough by itself.** A newly added `Check`
   field defaults to unset (`0`) on every existing row — there is no
   automatic backfill, and no self-service "resend verification" flow for an
   account that predates this feature. **After importing, manually flip
   `email_verified` to checked, in Frappe Desk, for every real admin account**
   (Web Account list → open each `ADMIN_EMAILS` row → check *Email Verified*
   → save) **before or immediately at deploy time.** Do this for your own
   account first, so you aren't locked out of Desk-adjacent recovery either.

**Verify:** log in as each `ADMIN_EMAILS` account and confirm the admin panel
loads. If you get a 403 you weren't expecting, this is the first thing to
check.

---

## 2. Tier 0.5 — not boot-checked, but broken (and dangerous) until set

These don't stop the container from starting, but the first request that
needs them fails loudly rather than silently guessing — by design, so a
misconfiguration surfaces as an error instead of a working-looking bug:

```
APP_BASE_URL=https://<your-domain>
```
Every password-reset / verification-email link is built from this. Unset in
production → the request throws rather than falling back to the (attacker-
controlled) `Host` header. Set this before anyone can reset a password.

```
FREE_SUBDOMAIN_ROOT_DOMAIN=<your-domain>
```
Unset in production → free-subdomain issuance is refused outright (503) rather
than issuing a subdomain on a guessed/wrong root. Setting this alone does
**not** make subdomains resolve — you separately need a wildcard DNS record
for `*.<this domain>` and a matching wildcard vhost on the proxy in front of
the app (Coolify). See `docs/app-subdomain-routing.md` if that file exists, or
`deploy/vps/nginx/apps-wildcard` for the pattern this app already uses for
`*.apps.<domain>`.

```
REDIS_URL=redis://:password@host:6379/0
```
Not enforced by a guard, but the boot log prints a warning without it. Without
Redis, sessions live in in-memory `MemoryStore`: they vanish on every restart
and don't work if you ever run more than one backend instance. Set this before
launch even at one instance — restarts happen (deploys, crashes) and you don't
want every restart to silently log out every logged-in customer.

**Verify:** tail the boot log for the Redis warning (should be absent), then
do one password-reset request end to end and confirm the email link points at
the right domain.

---

## 3. Tier 1 — the money path (must be correct before taking a real payment)

Order matters here: import the Frappe fixtures *before* flipping the env vars
that assume they exist, or the first real payment on that rail hits a 417 from
a missing custom field.

### 3a. Frappe schema prerequisites (import once, before going further)

```bash
bench --site <site> import-doc backend/data/doctype-provisioning-job.json
bench --site <site> import-doc backend/data/custom-fields-portal-invoice.json
bench --site <site> import-doc backend/data/custom-fields-portal-invoice-mpesa.json
```

- `custom-fields-portal-invoice.json` adds `payment_gateway`, `paypal_order_id`,
  `paypal_capture_id`, `paypal_expected_usd`, `paypal_expected_usd` is what a
  PayPal capture is verified against (not a live recomputation — an FX-rate
  move between order-creation and capture must not fail a real payment), and
  `payment_exception`, which records a capture that could not be applied to
  its invoice so the money is traceable rather than silently lost.
- `custom-fields-portal-invoice-mpesa.json` adds `mpesa_checkout_request_id`,
  `mpesa_receipt_number`, and `mpesa_checkout_request_ids` — a bounded history
  of every STK push for an invoice, so a customer who pays a *superseded*
  prompt (they tapped "pay" twice) still resolves to the right invoice instead
  of the payment landing nowhere.

Also validate against the **live** Frappe instance, not `MOCK_FRAPPE` (which
accepts any shape): `Test Plan Invoice` needs `trial_start`/`trial_end`
(Datetime) and a `status` field accepting `Trial Pending`/`Active`/`Expired`;
`Portal Invoice.type` needs to accept `Trial Verification`. See the block at
the bottom of the `Free-trial verification` section in `.env.example`.

### 3b. PayPal

```
PAYPAL_ENV=live
PAYPAL_LIVE_CLIENT_ID=
PAYPAL_LIVE_CLIENT_SECRET=
PAYPAL_LIVE_WEBHOOK_ID=
KES_TO_USD_RATE=<current rate>
```

The webhook is not optional in production. In the PayPal dashboard, create a
webhook at `https://<your-domain>/api/paypal/webhook`, subscribe it to
`PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`,
`PAYMENT.CAPTURE.REVERSED`, `PAYMENT.CAPTURE.DENIED`, and paste its ID into
`PAYPAL_LIVE_WEBHOOK_ID`. Without it, a captured payment that the browser
round-trip never confirms (tab closed mid-flow, network drop after approval)
has no way to reconcile, and a refund/chargeback never suspends the service.

`KES_TO_USD_RATE` has no safe default — leaving it unset makes every PayPal
order creation throw (`Invalid KES_TO_USD_RATE configuration`). This is a
manual rate you update periodically, not a live feed; stale by a few percent
is fine, unset is not.

### 3c. M-Pesa

```
MPESA_ENV=production
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://<your-domain>/api/billing/mpesa/callback?token=<same value as below>
MPESA_CALLBACK_SECRET=   # openssl rand -hex 24
```

`MPESA_CALLBACK_SECRET` must be embedded as the `?token=` query param on the
URL you register with Safaricom **and** set as `MPESA_CALLBACK_SECRET` — they
must match. Safaricom does not sign callbacks; this token is the only thing
standing between the public callback endpoint and a forged "payment
succeeded" request. Generate it fresh for production — do not reuse a
sandbox value.

### 3d. Verify Tier 1 before moving on

Do one real, small purchase on **each** rail (PayPal and M-Pesa) against
production credentials before considering this tier done:

1. Buy something cheap end to end, pay for real.
2. Confirm the invoice flips to Paid and the service activates.
3. Issue a real refund and confirm `RENEWAL_SUSPEND_ENABLED`-style teardown
   actually stops the service (see Tier 2 — this needs the runner on to mean
   anything beyond a status flip).
4. Check the PayPal dashboard shows the webhook delivered successfully (not
   just the synchronous capture).

---

## 4. Tier 2 — provisioning and renewal (decide these deliberately, don't leave them at default)

These default OFF specifically so Tier 0/1 can ship safely first. Flipping
them is a deliberate decision, not an oversight to "get to eventually" —
follow `docs/provisioning-go-live.md` for the staged version of this with the
readiness-panel checklist; this is the short version:

```
PROVISIONING_RUNNER_ENABLED=true
```
**Without this, no paid job is ever built.** Every purchase sits at `queued`
forever, visible only to staff via the notify-only email. If launch day
arrives and this is still `false`, customers pay and get nothing until a human
notices.

```
RENEWAL_SUSPEND_ENABLED=true
```
**Without this, non-payment never suspends a service.** A lapsed renewal logs
an alert and emails the customer but the service keeps running for free
indefinitely. Flip this only once you've confirmed the renewal reminder email
flow actually reaches customers (test it first with this still `false`) — the
`.env.example` comment's advice to leave it false "until verified in
production" is the right sequencing, just don't stop at "verified," finish by
flipping it.

At least one build lane, matching what you actually run:

```
# Coolify lane (web/app/static/db):
COOLIFY_BASE_URL=
COOLIFY_TOKEN=
COOLIFY_PROJECT_UUID=
COOLIFY_SERVER_UUID=
COOLIFY_SERVER_IP=       # for domain-attach verification
APP_DOMAIN_BASE=apps.<your-domain>   # + a one-time wildcard DNS record

# Frappe bench lane (ERP/POS/CRM), if you sell those:
BENCH_PROVISION_CMD=/opt/murzak/provision-bench.sh
```

Before trusting the Coolify lane against the live API, run the smoke script
Coolify's own field names/status vocabulary drift on:
```bash
node backend/scripts/coolify-smoke.js --create
```

**Verify:** open **Portal → admin → Provisioning** as an `ADMIN_EMAILS`
account and confirm the readiness checklist is green. Run one real
provisioning job end to end (a cheap real purchase, not a mock) and confirm
the resulting container is reachable at its assigned URL.

---

## 5. Tier 3 — feature gates (each is a deliberate on/off, not tuning)

Every one of these defaults `false` and 503s cleanly when off — nothing
breaks by leaving them off, but each is a real customer-facing capability you
are choosing whether to ship:

```
RESOURCE_ADMIN_ENABLED=false     # customer self-service env vars + logs
STORAGE_BROWSER_ENABLED=false    # customer file browser (needs STORAGE_S3_*)
TERMINAL_ENABLED=false           # browser shell into a customer's container
```

`TERMINAL_ENABLED=true` has real prerequisites beyond the flag — a running
broker (`docker-compose.broker.yml`), `BROKER_URL`/`BROKER_API_KEY`/
`BROKER_SIGNING_KEY` (the signing key must differ from `SESSION_SECRET`), and
off-box recording storage (`TERMINAL_S3_*`). Don't flip this one without
reading `docs/superpowers/specs/2026-07-19-developer-terminal-access-design.md`
first — it's the highest-blast-radius gate in the list (a shell into a
customer container).

---

## 6. Tier 4 — everything else

The remaining ~90 vars (SMTP, Firebase, Hostinger domain automation, backup/
edge hooks, trial tuning, sweep intervals, timeouts) all ship with safe
defaults or fail closed when unset — none of them block boot or silently lose
money. Set what your feature set needs; `.env.example` documents each one
inline, grouped by section, with its default. Two worth calling out because
they're easy to forget and have no code-level guard:

```
ADMIN_EMAILS=you@murzaktech.com,ops@murzaktech.com
```
Whoever is in this list is who `requireAdmin` will admit *if their email is
also verified* — an address with no registered, verified account can't
self-claim admin (see the `requireAdmin` hardening in this branch), but an
address that never registers also never gets an admin panel. Register and
verify each admin account before relying on this list.

```
SMTP_HOST= SMTP_USER= SMTP_PASS= SMTP_FROM_EMAIL= SUPPORT_EMAIL=
```
Without these, every transactional email (password reset, admin alerts,
renewal reminders, trial-ending notices) silently no-ops. Nothing errors —
mailer calls are all best-effort try/catch — so this is easy to leave broken
without noticing until a customer asks why their reset email never arrived.

---

## 7. What to never set in production, ever

```
E2E_TEST=true
```
CI-only. Disables every rate limiter and the RAM capacity oversell gate.
`NODE_ENV=production` now overrides it regardless of value (fixed on this
branch), but don't rely on that — just never set it outside the CI pipeline.

```
MOCK_PROVISIONING=true
```
Simulates every build as succeeding without touching real infrastructure.
Boot-blocked from combining with `DEV_AUTO_LOGIN`/`MOCK_FRAPPE`, but this one
is **not** in the hard-fail list — nothing stops you from accidentally
shipping it. Grep your Coolify env panel for it before every production
deploy if you ever use it for a staging environment on the same
infrastructure.

---

## 8. Full pre-launch verification sequence

1. Container boots, stays up, `/api/health` returns 200.
2. No Redis warning in the boot log.
3. Password reset email arrives with a link pointing at the real domain.
4. Admin panel readiness checklist (Portal → admin → Provisioning) is green.
5. One real PayPal purchase, captured, webhook confirmed delivered.
6. One real M-Pesa purchase via STK, confirmed via the callback (check
   `mpesa_receipt_number` landed on the invoice).
7. One real refund on each rail, confirmed the underlying service actually
   stops (not just a status string) — this needs `PROVISIONING_RUNNER_ENABLED`
   and the corresponding teardown path both working.
8. One real provisioning job, container reachable at its URL.
9. `custom-fields-web-account.json` imported, and every `ADMIN_EMAILS`
   account manually flipped to `email_verified` in Frappe Desk (§1a) —
   confirm by logging in as one and reaching the admin panel.
10. Grep the Coolify env panel one more time for `E2E_TEST`, `MOCK_FRAPPE`,
    `MOCK_PROVISIONING`, `DEV_AUTO_LOGIN` — all should be absent.

If all ten hold, you're live.
