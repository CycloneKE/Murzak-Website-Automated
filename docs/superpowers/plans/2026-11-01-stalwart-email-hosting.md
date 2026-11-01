# Murzak Business Email (Stalwart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client orders business email, pays by M-Pesa, and gets working mailboxes on their own or a newly registered domain, branded webmail and a hand-over, with no staff step.

**Architecture:** Stalwart becomes a second provider inside the existing `emailHosting` lane (Hostinger stays as fallback). Per-order inputs and progress live in the Checkout Order's `config_json` under a `mailSetup` key (same no-schema-change pattern as `shopSetup`/`shopProgress`). Domain purchase reuses `domainPurchaseFulfilment`; payment, jobs and retries reuse the existing checkout and runner.

**Tech Stack:** Node/Express backend (plain `node test/x.test.js` scripts with the local `ok()/section()` harness, Frappe via `client`), React + TypeScript frontend, Coolify API, Hostinger API, Stalwart management API.

**Spec:** `docs/superpowers/specs/2026-11-01-stalwart-email-hosting-design.md` (source PDF: "Murzak Email Hosting: Website Integration Spec")

## Global Constraints

- Plans (KES, annual = 10 × monthly): Starter 3 mailboxes × 5 GB, 450/mo, 4,500/yr; Business 10 × 10 GB, 1,200/mo, 12,000/yr; Pro 30 × 15 GB, 2,900/mo, 29,000/yr. Prices live in config/catalog only.
- Domain price = Hostinger wholesale + 25%, rounded up to nearest KES 50, floor KES 1,200/yr; domains non-refundable.
- Mailbox local parts: lowercase letters, digits, dots, hyphens; reserved: admin, abuse, noreply, root, postmaster (system-created only, not counted toward limit).
- Provisioning only after the server has verified payment; never buy a domain before that.
- No password is ever stored, logged or emailed. Clients set their own.
- Secrets (Stalwart key, Coolify token, Hostinger token, Daraja keys) env-only, masked in logs.
- Every step idempotent; "already exists" on retry counts as success.
- Bulwark `DOMAIN_BRANDING` is always rebuilt from every active client; never write a shorter/empty list.
- Do not add Frappe doctype fields; use `config_json`. Verify any new Frappe field against the live doctype first (see memory: MOCK_FRAPPE accepts anything).
- Customer-facing copy never names Hostinger/Stalwart/Bulwark/Coolify except the existing domain-registration disclosure.
- New backend tests are appended to the `npm test` script in `backend/package.json`.

## Review Focus

- Mailbox names with uppercase, leading/trailing dot, double dot, unicode or 64+ chars are rejected server-side (Task 2).
- A domain already attached to another client's mail setup is refused, not shared (Task 2).
- Contact email on the same domain as the new mail domain is rejected: hand-over would go to the mailbox that doesn't exist yet (Task 2).
- Re-running a job after Stalwart already created the domain/accounts creates no duplicates and still ends active (Tasks 3, 8).
- A Bulwark branding write with an empty or shrunk client list is refused so one failure cannot erase other clients' branding (Task 6).

## File Structure

- `backend/config/emailPlans.js` — plan table, pricing helpers (Task 1)
- `backend/services/email/mailInput.js` — validation (Task 2)
- `backend/services/email/stalwartClient.js` — Stalwart management API wrapper (Task 3)
- `backend/services/email/mailProvider.js` — provider facade used by lane and portal routes (Task 4)
- `backend/services/email/mailDns.js` — required records, verification, webmail CNAME (Task 5)
- `backend/services/email/webmailBranding.js` — Bulwark list builder and locked restart queue (Task 6)
- `backend/services/email/mailSetupStore.js` — read/write `mailSetup` in order config (Task 7)
- `backend/services/provisioning/lanes/emailHosting.js` — Stalwart path added (Task 8)
- `backend/services/email/mailLiveSweep.js` — BYO DNS watcher, go-live, hand-over (Task 9)
- `backend/services/email/mailAccess.js`, `backend/routes/mailRoutes.js` — magic link, status, set-password (Task 10)
- `backend/utils/mailer.js` — hand-over email (Task 11)
- `backend/services/email/mailCapacity.js` + `deploy/vps/` backup unit (Task 12)
- Frontend: `pages/cloud/CloudEmail.tsx`, `components/mail/*`, `MailboxManager.tsx` (Tasks 13–14)

---

### Task 1: Plans, pricing and catalog entries

**Files:**
- Create: `backend/config/emailPlans.js`
- Modify: `frontend/src/config/serviceCatalog.ts` (add `mail-starter`, `mail-business`, `mail-pro` beside `starter-email`; leave old ids for existing customers), then run `npm run gen:catalog` in `backend/`
- Modify: `backend/services/provisioning/catalog.js` (`laneFor` already routes category "Email Hosting" to `emailHosting`; no change expected, test proves it)
- Test: `backend/test/emailPlans.test.js`

**Interfaces:**
- Produces: `PLANS` (frozen map keyed `mail-starter|mail-business|mail-pro` → `{ id, mailboxes, quotaGb, monthlyKes, annualKes }`), `isMailPlan(serviceId): boolean`, `domainPriceKes(wholesaleUsdCents: number, usdToKes: number): number`.

- [ ] **Step 1: Write failing tests.** `plans match spec` (starter 3/5/450/4500, business 10/10/1200/12000, pro 30/15/2900/29000); `annual is 10x monthly for every plan`; `domainPriceKes(1099, 129)` → wholesale 1099¢ × 129 × 1.25 / 100 = 1772.1 → `1800`; `domainPriceKes(100, 129)` → `1200` (floor); `isMailPlan('starter-email')` false, `isMailPlan('mail-pro')` true; `catalog.laneFor(getServiceMeta('mail-pro')) === 'emailHosting'` and `meta.ramMb === 0`.
- [ ] **Step 2:** Run `node test/emailPlans.test.js` — expect FAIL (module missing).
- [ ] **Step 3:** Implement `config/emailPlans.js` per interfaces; add the three catalog entries (category "Email Hosting", `mailboxes` set from PLANS, `pricing` model addon with `monthlyKes`, annual term following how `billingTerm.js` expresses annual discounts); regenerate snapshot.
- [ ] **Step 4:** Run test — PASS; run `node test/catalogSnapshot.test.js` — PASS.
- [ ] **Step 5:** Add `node test/emailPlans.test.js` to the `npm test` script; commit `feat(email): plans and pricing`.

### Task 2: Order input validation

**Files:**
- Create: `backend/services/email/mailInput.js`
- Test: `backend/test/mailInput.test.js`

**Interfaces:**
- Consumes: `mailboxPolicy.isValidLocalPart`, `customerDomains.normalizeDomainName/isValidDomainName`, `PLANS`.
- Produces: `validateMailSetup(input, { takenDomains: Set<string> }): { ok: true, value } | { ok: false, errors: Record<string,string> }` where input is `{ planId, businessName, domain, contactEmail, mailboxes: string[] }`; `RESERVED_LOCAL_PARTS: Set<string>`.

- [ ] **Step 1: Write failing tests** (each asserts `ok:false` and the errors key): `Sales`, `.sales`, `sales.`, `a..b`, `sàles`, 65-char name → `mailboxes`; `admin`, `abuse`, `noreply`, `root`, `postmaster` → `mailboxes`; 4 mailboxes on `mail-starter` → `mailboxes`; zero mailboxes → `mailboxes`; duplicate names → `mailboxes`; businessName `"A"` and 81 chars → `businessName`; domain in `takenDomains` → `domain`; `contactEmail` `me@acme.com` with domain `acme.com` → `contactEmail`; unknown planId → `planId`. Happy path returns lowercase domain and trimmed names.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `validateMailSetup`; collect all errors, don't stop at first.
- [ ] **Step 4:** Run — PASS. **Step 5:** Register in `npm test`; commit.

### Task 3: Stalwart client

**Files:**
- Create: `backend/services/email/stalwartClient.js`, `backend/test/fixtures/stalwart/` (recorded request/response shapes)
- Test: `backend/test/stalwartClient.test.js`

**Interfaces:**
- Produces: `isConfigured(): boolean`, `configError(): string`, `ensureDomain({ name, description, dnsServerId }): Promise<{ id: string, created: boolean }>`, `ensureAccount({ domainId, localPart, quotaBytes }): Promise<{ id: string, created: boolean }>` (secret is random and never returned or logged), `setPassword(accountId, password): Promise<void>`, `findAccount(address): Promise<{ id } | null>`, `deleteAccount(accountId)`, `setOutboundLimit(accountId, perHour)`. Env: `STALWART_URL`, `STALWART_API_KEY`, `STALWART_DNS_SERVER_ID`.

- [ ] **Step 1: Discovery (no code).** On the live server, with the dedicated API key, record the real HTTP shape for: create/list Domain (`dkimManagement {"@type":"Automatic"}`, `dnsManagement {"@type":"Automatic","dnsServerId":…}`), create/list Account/User (`credentials {"0":{"@type":"Password","secret":…}}`, `quotas {"maxDiskQuota":bytes}`), password change. Save sanitized samples as fixtures; fall back to `stalwart-cli` field names from the spec if the HTTP route differs. Do not proceed to Step 2 until fixtures exist.
- [ ] **Step 2: Write failing tests** against an injected http stub: `ensureDomain` twice → second returns `created:false` with same id; `ensureAccount` when the server answers "already exists" → `created:false`; request body for the account contains `maxDiskQuota` = `quotaGb * 1024^3` and a `secret` of 24+ chars; the secret string never appears in `console` output captured during the call and never in the return value; missing env → `isConfigured() === false` and `configError()` names `STALWART_API_KEY`.
- [ ] **Step 3:** Implement, with a `STALWART_MOCK=1` in-memory mode used by later task tests.
- [ ] **Step 4:** Run — PASS. **Step 5:** Register in `npm test`; commit.

### Task 4: Mail provider facade and portal routes

**Files:**
- Create: `backend/services/email/mailProvider.js`
- Modify: `backend/routes/portalRoutes.js:1837-2060` (mailbox routes call the facade instead of `hostingerMailLib`)
- Test: `backend/test/mailProvider.test.js`; existing `backend/test/mailboxSelfService.test.js` must still pass

**Interfaces:**
- Produces: `providerFor(job): 'stalwart' | 'hostinger'` (stalwart when `job.access` or the order's `mailSetup.provider === 'stalwart'`), and `{ listMailboxes(ctx), createMailbox(ctx, { localPart }), changePassword(ctx, mailboxId, password), deleteMailbox(ctx, mailboxId) }` per provider, same return shape as today's `mailboxPolicy.publicMailbox`.

- [ ] **Step 1: Write failing tests:** facade routes a Hostinger job to `hostingerMail` stubs unchanged; a Stalwart job lists accounts for its domain only (an account on another domain is never returned or changeable — assert `changePassword` with a foreign id rejects); `createMailbox` refuses past the plan limit using `mailboxEntitlement.canCreate`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement facade; swap the route calls. Keep `assertMailboxBelongsToOrder` semantics for both providers.
- [ ] **Step 4:** Run `mailProvider.test.js` and `mailboxSelfService.test.js` — PASS. **Step 5:** Commit.

### Task 5: DNS records, verification and webmail CNAME

**Files:**
- Create: `backend/services/email/mailDns.js`
- Test: `backend/test/mailDns.test.js`

**Interfaces:**
- Produces: `requiredRecords(domain, { mailHost, webmailTarget }): Array<{ type, name, value, priority? }>` (MX, SPF TXT, DMARC TXT `p=none`, `webmail` CNAME → `webmail.cloud.murzaktech.tech`; DKIM value fetched from Stalwart and appended by caller), `verifyRecords(domain, records, { resolver }): Promise<{ ok: boolean, missing: string[] }>` (resolver injectable, default `dns.promises`), `ensureWebmailCname(domain): Promise<void>` via `/api/dns/v1/zones/{domain}` using `hostingerApi.apiUrl/authHeaders`, idempotent.

- [ ] **Step 1: Failing tests:** `requiredRecords` includes exactly one MX, one SPF, one DMARC and the `webmail` CNAME; `verifyRecords` with a stub resolver missing the MX → `ok:false, missing:['MX']`; SPF matching is order- and whitespace-insensitive; `ensureWebmailCname` twice posts once (second sees the record).
- [ ] **Step 2–4:** run FAIL → implement → PASS. **Step 5:** register, commit.

### Task 6: Webmail branding queue

**Files:**
- Create: `backend/services/email/webmailBranding.js`
- Test: `backend/test/webmailBranding.test.js`

**Interfaces:**
- Consumes: `lanes/coolify.createEnv/updateEnv/listEnvs/restart` (take the Bulwark service uuid from `BULWARK_SERVICE_UUID`), `Coolify PATCH /api/v1/services/{uuid}/applications/{app_uuid}` for the address list (add a small `patchServiceApplicationFqdns` helper in this module using the same axios config as the coolify lane).
- Produces: `buildBranding(clients: Array<{ domain, title, logoUrl? }>): { addresses: string, brandingJson: string }` (stable sort, deduped), `enqueueDomain(client, { domain }, deps): Promise<{ restarted: boolean }>`; `loadActiveClients(client): Promise<Array<…>>` reading Checkout Orders whose `mailSetup.state` is `active` or `live`.

- [ ] **Step 1: Failing tests:** `buildBranding` of two clients contains both domains; calling `enqueueDomain` for A and B concurrently performs exactly **one** restart and the written branding contains A, B and every pre-existing active client; `enqueueDomain` when `loadActiveClients` returns `[]` and the Bulwark env already has entries → rejects with a "refusing to shrink branding" error and writes nothing; running the same domain twice does not duplicate it.
- [ ] **Step 2–4:** FAIL → implement (in-process lock plus a short merge window, `BULWARK_MERGE_MS` default 20000) → PASS. After restart, poll `https://webmail.<domain>` up to 5 minutes (injectable fetch, injectable sleep).
- [ ] **Step 5:** register, commit.

### Task 7: mailSetup store and domain gate

**Files:**
- Create: `backend/services/email/mailSetupStore.js`
- Modify: the order-creation path in `backend/routes/ordersRoutes.js` (locate with `grep -n "config_json\|appOrder" backend/routes/ordersRoutes.js backend/services/apps/appOrder.js`) so a mail order saves validated `mailSetup` at order time
- Test: `backend/test/mailSetupStore.test.js`

**Interfaces:**
- Consumes: `shopSetup.mergeOrderConfig(client, orderName, mutate)`, `validateMailSetup`.
- Produces: `saveMailSetup(client, orderName, input): Promise<MailSetup>` (state `awaiting_payment`, `provider:'stalwart'`, `domainMode:'new'|'own'`), `getMailSetup(client, invoiceDocName): Promise<{ orderName, setup } | null>`, `setProgress(client, orderName, stage, state)` where stage ∈ `payment|domain|mail|webmail|dns` and state ∈ `pending|running|done|failed`, `waitForDomain(client, { webAccount, domain }): Promise<void>` (throws a retryable error while the domain is not `active` in `customerDomains`; throws `permanent()` if the domain request is marked failed/unsupported, e.g. `.ke` names, with the text staff need to register it and requeue).

- [ ] **Step 1: Failing tests:** `saveMailSetup` rejects invalid input and stores nothing; merge preserves other keys (`shopProgress`); `setProgress` is idempotent; `waitForDomain` with status `pending` throws retryable (no `.permanent`), with `.co.ke` unsupported throws `.permanent === true`; own-domain mode skips the wait.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** register, commit.

### Task 8: Stalwart path in the email lane

**Files:**
- Modify: `backend/services/provisioning/lanes/emailHosting.js` (`isConfigured`, `configError`, `provision`), `backend/services/provisioning/runner.js` (add `invoice` lookups only if the lane cannot already read `job.invoice`; `client` is already passed)
- Test: extend `backend/test/emailHostingProvisioning.test.js`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7. Produces: `provision(job, opts)` returns `{ externalRef: domain, access: { lane, provider:'stalwart', domain, webmail: 'https://webmail.<domain>', mailboxes: n, dnsPending: boolean }, log }`.
- Behaviour: choose Stalwart when `STALWART_API_KEY` is set and `job.service_id` is a mail plan; otherwise the existing Hostinger path is untouched.

- [ ] **Step 1: Failing tests** (using `STALWART_MOCK=1` and stubbed coolify/dns): happy path new domain → domain, N mailboxes plus `postmaster@` created, webmail queued, returns active with `dnsPending:false`; **re-run the same job → no duplicate accounts, same result**; own domain with DNS not yet published → active with `dnsPending:true` and `mailSetup` stage `dns` still `running`; domain not yet active → throws retryable; `.ke` → permanent; missing `mailSetup` → permanent with a clear message; Hostinger path tests still pass unchanged; Stalwart unreachable → plain Error (runner retries 3× then escalates).
- [ ] **Step 2–4:** FAIL → implement steps in order domain → Stalwart domain/accounts (quota from plan, outbound limit set) → webmail CNAME + branding → verify (Stalwart side only; DNS verification belongs to Task 9) → `setProgress` after each; PASS.
- [ ] **Step 5:** commit.

### Task 9: Go-live sweep and hand-over trigger

**Files:**
- Create: `backend/services/email/mailLiveSweep.js`; wire it where the other sweeps are scheduled (`grep -n "platformHealth\|orphans" backend/server.js`)
- Test: `backend/test/mailLiveSweep.test.js`

**Interfaces:**
- Produces: `runMailLiveSweep(client, deps): Promise<{ checked, wentLive, stillWaiting, errored }>`. For each order with `mailSetup.state === 'provisioned'`: verify DNS (`mailDns.verifyRecords`), webmail answers over https with the client's title, send the Stalwart test message; then set `state:'live'` and call `sendMailReadyEmail` exactly once (marker `handoverSentAt` in `mailSetup`).

- [ ] **Step 1: Failing tests:** DNS incomplete → stays `provisioned`, no email; DNS complete → `live` and **one** email; second sweep sends no second email; an order waiting longer than 72 h raises a staff ticket via the existing escalation helper rather than failing silently.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** register, commit.

### Task 10: Magic link, status and set-password API

**Files:**
- Create: `backend/services/email/mailAccess.js`, `backend/routes/mailRoutes.js`; mount in `server.js`
- Test: `backend/test/mailRoutes.test.js`

**Interfaces:**
- Produces: `signOrderToken(orderName, now?): string` / `verifyOrderToken(token): { ok, orderName }` (HMAC with `MAIL_LINK_SECRET`, 30-day life); `issueCode(orderName): Promise<void>` (6-digit, emailed, 10 min); `verifyCode(orderName, code): boolean`. Routes: `GET /api/mail/status/:token` → `{ stage list, mailboxes: [{ address, passwordSet }], webmailUrl, state }`; `POST /api/mail/status/:token/mailboxes/:local/password` (first set needs no code; later resets need `code`); `POST /api/mail/status/:token/code`; `POST /api/mail/status/:token/mailboxes` (add, within plan limit, needs `code`).

- [ ] **Step 1: Failing tests:** tampered or expired token → 404 (same body as unknown order); status never contains a secret or Stalwart ids; first password set succeeds and flips `passwordSet`; second set without code → 403; with a valid code → 200; weak password (reuse `mailboxPolicy.validatePassword`) → 400; adding past plan limit → 409; rate limiter present on the three write routes; changing another order's mailbox via a crafted `:local` → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** register, commit.

### Task 11: Hand-over email

**Files:**
- Modify: `backend/utils/mailer.js` (add `sendMailReadyEmail`; follow the existing `sendTrialStartedEmail` pattern)
- Test: `backend/test/mailReadyEmail.test.js`

**Interfaces:**
- Produces: `sendMailReadyEmail({ to, businessName, webmailUrl, addresses, statusUrl, supportContact }): Promise<void>`.

- [ ] **Step 1: Failing tests** with the repo's transport stub: body contains business name, webmail URL, every address, status link, phone-setup link and the new-domain spam note; body contains no password-like field; subject has no product vendor names.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** register, commit.

### Task 12: Capacity gate, backups and sending safety

**Files:**
- Create: `backend/services/email/mailCapacity.js`, `deploy/vps/bin/murzak-stalwart-backup` plus a systemd timer next to the existing `deploy/vps` units (mirror `murzak-bench-runner.timer`)
- Modify: `backend/services/provisioning/capacity.js` (reserve `MAIL_STACK_RAM_MB`; call the mail disk gate for mail plans)
- Test: `backend/test/mailCapacity.test.js`

**Interfaces:**
- Produces: `canSellMailPlan(planId, { provisionedGb, diskGb, overcommit }): { ok, reason? }` — refuses when `(provisionedGb + mailboxes × quotaGb) / overcommit > diskGb` (defaults from env `MAIL_DISK_GB`, `MAIL_OVERCOMMIT`, default 3); `diskAlertLevel(usedGb, diskGb): 'ok'|'warn'|'critical'` at 70% / 85%.

- [ ] **Step 1: Failing tests:** a Pro order that would exceed the cap → `ok:false` with a reason that mentions capacity, not vendor names; Starter fits when Pro does not; alert thresholds exact at 70/85.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Backup + restore drill (manual verification).** Install the timer, run once, copy off-VPS, restore into a scratch Stalwart and confirm a test mailbox reads back. Record the result in `docs/` runbook. Confirm outbound port 25 and reverse DNS from the VPS before launch.
- [ ] **Step 6:** commit.

### Task 13: Order experience (frontend)

**Files:**
- Create: `frontend/src/components/mail/MailSetupForm.tsx`, `frontend/src/components/mail/MailProgress.tsx`, `frontend/src/services/mail.ts`
- Modify: `frontend/src/pages/cloud/CloudEmail.tsx`, `frontend/src/components/CloudLaunchModal.tsx` (or the unified checkout entry; match the existing cloud launch flow), `frontend/src/pages/Checkout.tsx`/`ThankYou.tsx` where progress renders
- Modify: `frontend/src/types.ts` for the `MailSetup`/`MailStatus` types

**Interfaces:**
- Consumes: Task 10 API, `formatKes`, `serviceMonthlyKes`. Errors go through `toUserMessage()` (never render raw `err.message`).

- [ ] **Step 1:** `MailSetupForm`: domain box with debounced availability (three outcomes: new generic / already registered → own-domain / `.ke` → "we register within one working day"), plan cards showing per-mailbox price and monthly/annual toggle with KES saving, mailbox chips with live validation matching Task 2, total line (plan + domain), M-Pesa number field. Business name and logo are asked on the next screen.
- [ ] **Step 2:** `MailProgress`: four stages (Payment confirmed → Your domain → Mail is ready → Webmail is ready), polls `GET /api/mail/status/:token` every 10 s, "safe to close this tab" copy, `awaiting_dns` shows the records table with copy buttons and a live check, `needs_attention` shows the fixed support sentence only.
- [ ] **Step 3:** Rewrite `CloudEmail.tsx` guides and FAQ to the new tiers/prices, remove the "99.9% primary inbox placement" claim, replace the hard-coded IMAP/SMTP hosts with the real mail hostname from config.
- [ ] **Step 4: Verify.** From `frontend/` run `npx tsc --noEmit` and `npm run build` — both clean. Start the dev server via the project's `.claude/launch.json` entry, walk the form at desktop and 375 px width in light and dark mode, and confirm no horizontal scroll and no console errors.
- [ ] **Step 5:** commit.

### Task 14: Set password, add-to-phone and portal polish

**Files:**
- Modify: `frontend/src/components/portal/cloud/MailboxManager.tsx`
- Create: `frontend/src/components/mail/PhoneSetupCard.tsx`, `frontend/src/components/mail/SetPasswordDialog.tsx`

- [ ] **Step 1:** `SetPasswordDialog`: strength hint, confirm field, code step for resets; calls Task 10 routes.
- [ ] **Step 2:** `PhoneSetupCard`: per-mailbox QR (library of your choice, bundled not CDN) encoding the autoconfig/iPhone profile URL, plus iPhone, Android and Outlook steps in plain language.
- [ ] **Step 3: Verify.** `npx tsc --noEmit`, `npm run build`, then in the preview set a password for a mock mailbox, reload, and confirm "password set" persists and no secret appears in network responses (`read_network_requests`).
- [ ] **Step 4:** commit.

### Task 15: Test switch, end-to-end and launch checklist

**Files:**
- Modify: `backend/package.json` (all new tests in `test`), `docs/` runbook (create `docs/runbooks/email-hosting.md`)
- Test: `backend/test/emailEndToEnd.test.js`

- [ ] **Step 1: Failing end-to-end test** with `STALWART_MOCK=1`, mock lane dependencies and fake payment: order → job → provisioned → DNS verified (stub resolver) → `live` → one hand-over email; plus failure cases: Stalwart down 3× → job `needs_human` with step recorded; two orders paid together → one Bulwark restart, both domains branded; callback/job requeued twice → one set of accounts.
- [ ] **Step 2–3:** make it pass; run the entire `npm test` from `backend/` — expected all green.
- [ ] **Step 4: Live dry run (needs the owner).** One real small M-Pesa payment on a throwaway domain; confirm Gmail shows SPF, DKIM and DMARC PASS in the original headers; delete the test domain and mailboxes from Stalwart. Check the order pages and emails on a phone.
- [ ] **Step 5:** commit.

---

## Self-review

- **Spec coverage:** plans/pricing (1), validation (2), Stalwart steps (3, 8), DNS and BYO (5, 9), webmail queue (6), checkout reuse and domain purchase (7, 8), status/set-password/self-service (10), hand-over (11), capacity/backups/sending limits (12), UX (13–14), test switch and acceptance (15). Renewals, `.co.ke` partner registrar and database-driven branding are explicitly outside this plan (design "release order" steps 3–4 / open items).
- **Deviation to confirm:** the design says the client should be registrant; the existing fulfilment registers under Murzak's WHOIS profile. This plan keeps the existing behaviour (Task 7 reuses it). Changing it is a separate task.
- **Known unknowns:** the exact Stalwart HTTP shape (Task 3 Step 1 resolves it first) and where the order-time `mailSetup` hook goes (Task 7 locates it by grep).
