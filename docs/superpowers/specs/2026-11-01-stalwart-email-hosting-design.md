# Murzak Business Email (Stalwart) — Design

Date: 2026-11-01 · Status: draft for owner approval
Source: "Murzak Email Hosting: Website Integration Spec" (owner PDF), reviewed against the repo.

## Intent

A client orders business email on the Murzak site, pays by M-Pesa, and within minutes has a
working mailbox on their own domain, a branded webmail address and a phone-setup guide, with no
staff step. Today the email lane resells Hostinger mailboxes and cannot attach a domain to a mail
order, so every order ends in a manual hPanel step. Self-hosting on Stalwart (mail server) and
Bulwark (webmail) removes that step and keeps the margin.

## Goals

- Zero-touch happy path for: (a) the client's own domain, (b) a newly registered generic domain
  (.com/.net/.org/.io), both through the Hostinger API.
- One checkout, one job runner, one portal. No parallel order/payment/status system.
- Prices clearly below Google Workspace and Microsoft 365 and in line with Zoho; flat per-plan, KES, M-Pesa.
- Clients set their own passwords; Murzak never stores or emails one.
- Every failure ends in a plain, honest state and a staff retry, never silence.

## Non-goals (release 1)

- Mailbox migration from another provider; plan changes; mailbox removal by clients.
- Automatic `.co.ke`/`.ke` registration (see Domain handling).
- Calendar/contacts/office suite. We sell mail, not a Workspace clone.
- Zero-downtime webmail branding (queued restarts accepted at launch; see Open items).

## Anti-goals

- A paid client with a half-built or duplicated mailbox.
- A domain bought before payment is verified by the server.
- One abusive mailbox getting the shared sending IP blocklisted for every client.
- Marketing claims we cannot back ("99.9% inbox placement" is removed from the page).

## Existing code this builds on (do not rebuild)

- Lane interface: `backend/services/provisioning/lanes/emailHosting.js` (today: Hostinger reconciler).
  Stalwart becomes a second provider inside this lane; Hostinger stays as fallback when Stalwart is
  not configured. Provider is chosen by env, not by code edits.
- Job runner: `backend/services/provisioning/runner.js`, queue, retry and `needs_human` handling.
- Domains: `customerDomains.js`, `hostingerDomains.js`, `domainPurchaseFulfilment.js`, Hostinger DNS.
- Checkout: shared `/checkout/:orderId`, the existing M-Pesa flow (callback idempotency, amount check).
- Portal: `components/portal/cloud/MailboxManager.tsx`, `mailboxEntitlement.js`, `mailboxPolicy.js`.
- Catalog: `starter-email` and `biz-email` in `frontend/src/config/serviceCatalog.ts`.

The source spec's own order table, STK flow, queue and status page are **replaced** by the above.
Its step table, idempotency rules, retry schedule and security rules are **kept** and become lane steps.

## Plans and pricing (my call — owner to confirm)

Market check (Nov 2026, third-party sources, verify before publishing):
Truehost entry plan ≈ KES 56/mo billed annually (3 GB, flat); local shared-host email KES 130–400/mo;
Zoho Mail Lite US$1/user/mo (≈ KES 130); Microsoft 365 Business Basic ≈ KES 700/user/mo;
Google Workspace Starter ≈ KES 900–1,070/user/mo. Murzak's current KES 1,500 for 5 mailboxes
(KES 300 each) is dearer than Zoho and the local hosts, and our marginal cost on Stalwart is disk only.

| Plan | Mailboxes | Quota each | Monthly | Annual (2 months free) | Effective per mailbox |
|------|-----------|-----------|---------|------------------------|-----------------------|
| Starter | 3 | 5 GB | KES 450 | KES 4,500 | KES 150 |
| Business | 10 | 10 GB | KES 1,200 | KES 12,000 | KES 120 |
| Pro | 30 | 15 GB | KES 2,900 | KES 29,000 | ~KES 97 |

- Positioning: "Half the price of Google and Microsoft, same inbox on your own domain, paid by M-Pesa."
  We deliberately do not chase Truehost's KES 56 (3 GB, shared pool); we win on setup, support and branding.
- Quotas are limits, not reservations (thin provisioning). Pro lowered from the source spec's 20 GB:
  30 × 20 GB would promise 600 GB against a VPS that cannot hold it. Disk alert thresholds are required.
- Domain (new registration): Hostinger wholesale price read live from the catalog, plus 25%, rounded up
  to the nearest KES 50, floor KES 1,200/yr, billed yearly. Shown as its own line at checkout.
  Domains are non-refundable once bought (stated before payment).
- All prices live in the catalog/config (single source), never hard-coded in components.
- Annual billing is offered at checkout as a toggle with the saving shown in KES.

## Client experience

1. **Start on a domain box.** One field: "Your domain". We check it live (rate-limited, debounced).
   Three outcomes, each with a clear next step:
   - *Available generic name* → "Register it for KES X/yr and add email."
   - *Already registered* → "Use this domain" (bring-your-own flow below).
   - *.co.ke / .ke* → "We'll register this for you within one working day" (manual lane, see below).
2. **Plan and mailboxes.** Plan cards with the per-mailbox price; mailbox names as chips with live
   validation (lowercase, digits, dot, hyphen; reserved names blocked). First is the main mailbox;
   `postmaster@` is added automatically and not counted.
3. **Contact and pay.** Prefilled from the account; M-Pesa number validated as 2547XXXXXXXX. The total
   (plan + domain) is shown once. Waiting state: "Check your phone", resend after 30 s, Paybill fallback.
   Business name and logo are asked on the next screen, after payment, not before.
4. **Progress page** (inside `/checkout/:orderId`, then the portal). Four stages in plain words:
   Payment confirmed → Your domain → Mail is ready → Webmail is ready. Copy says it is safe to close the tab;
   an email (and SMS) follows. Domain pending shows an honest "registries can take up to 15 minutes".
5. **Set your password.** Each mailbox has "Set password" (client chooses; strength hint). This calls Stalwart
   directly; we store nothing. Reset and "add a mailbox up to plan limit" use the same step, confirmed by a
   code sent to the contact email.
6. **Add to my phone.** Per mailbox: QR code, iPhone profile, Android steps, Outlook steps; autoconfig records
   are already published by Stalwart.
7. **Hand-over email.** Webmail address, mailbox addresses (no passwords), portal link, phone guide link,
   support contact, and a short, plain warning that a brand-new domain's first mails may land in spam.
8. **Failure copy.** `needs_attention` says "our team is checking this, we will email you within one working
   day". A taken domain says "That name was just taken: pick another or get a refund" with both as buttons.

### Bring-your-own domain (included in release 1)

Most Kenyan SMBs already own a domain, and `.co.ke` cannot be bought through Hostinger, so this flow is core.
- If the domain's DNS is on Hostinger in the Murzak account: fully automatic (existing DNS automation).
- Otherwise: show the exact records (MX, SPF, DKIM, DMARC, autoconfig, webmail CNAME) with copy buttons and a
  live "checking…" indicator that rechecks every 30 s. Mail is activated when records verify. Orders wait in
  state `awaiting_dns` (client is told they can leave; we email when live). Alternative offered: "point your
  nameservers to us and we do the rest."

## Domain handling

- Adapter interface: `check(name)`, `purchase(name, registrant)`, `status(orderRef)`. Hostinger implementation
  first; swapping registrars must not touch the order flow.
- Owner has confirmed Hostinger's API can purchase. Build step 0 still verifies the exact call, extensions and
  payment method (card on file) in the live OpenAPI reference and logs the result, since a purchase spends money.
- Rules: check availability at entry and again right before purchase; never purchase before the server has
  verified payment; client is the registrant (collect legal contact fields only in the register-new-domain path);
  202/pending is stored as `domain_pending` and polled every 30 s for up to 15 min; taken-in-between stops the
  order as `needs_attention` and offers another name or refund; set nameservers to Hostinger defaults after purchase.
- `.co.ke`/`.ke`: launch as a staff task. The order is paid, the lane records `needs_human` with the domain and
  registrant details, and staff register it via a partner registrar, then resume the job. A resale partnership
  is the longer-term fix (business item, not code).

## Provisioning steps (lane steps, each idempotent)

1. Verify payment (server-side; existing M-Pesa handler).
2. Domain: purchase and wait active (or verify DNS for BYO).
3. Stalwart: create Domain (automatic DKIM, automatic DNS via Hostinger), create each Account with a random
   unusable-until-set secret and `maxDiskQuota`, create `postmaster@`.
4. DNS: Stalwart writes MX/SPF/DKIM/DMARC/autoconfig/SRV; Murzak adds `webmail.<domain>` CNAME.
5. Webmail: add the domain to Bulwark through Coolify (address list, `DOMAIN_BRANDING` built from every active
   client in the database, restart). One locked queue; orders arriving together share one restart.
6. Verify: poll MX/SPF up to 15 min; webmail answers over https with the client's title (allow 5 min for the
   certificate); send a test message to the main mailbox.
7. Hand-over: email plus status page.

Failure handling per the source spec: step rows with times and error text, three retries (30 s, 2 min, 10 min),
then `needs_attention` with email and push alert, finished steps kept, staff retry resumes at the failed step.
Refunds are a staff decision using the stored M-Pesa receipt.

## Capacity, safety and operations (added to the source spec)

- **Capacity gate.** Stalwart and Bulwark use VPS RAM and disk. Add a reservation for the mail stack (measure it
  first) and a per-mailbox disk accounting so the gate refuses sales it cannot host.
- **Backups.** Daily Stalwart data backup off the VPS, restore tested before launch. Not optional.
- **Sending reputation.** Per-mailbox outbound rate limits in Stalwart; auto-suspend sending on bounce/complaint
  spikes; confirm port 25 outbound and reverse DNS on the VPS before launch; DMARC starts at `p=none` and tightens
  per client after a clean period.
- **Secrets.** Separate least-privilege keys for Stalwart, Coolify, Hostinger and Daraja, env-only, masked in logs.
- **Abuse and names.** Reserved local parts (admin, abuse, noreply, root, etc.; `postmaster@` is system-created only); rate-limit and
  bot-check the order form and availability check.
- **Test switch.** Fake registrar and fake payment so the pipeline can be tested without spending money; one real
  run on a throwaway domain before launch.

## Renewals (my proposal)

Reminder email and SMS 5 days before due with an STK push on the due date; 7-day grace, then outbound sending
suspended (inbound continues); mailboxes deleted only after 30+ days unpaid with two warnings. Annual plans
remind 30 days before. Final policy is an owner decision.

## Marketing page alignment

Rewrite [CloudEmail.tsx](../../../frontend/src/pages/cloud/CloudEmail.tsx) FAQ and guides to the new tiers and
prices, remove the "99.9% inbox placement" claim, and correct the IMAP/SMTP hosts to the real mail hostnames.

## Release order

1. Own-domain flow end to end (payment, Stalwart, DNS check, webmail, hand-over, set-password, backups, capacity gate).
2. New generic-domain registration through the adapter.
3. Portal self-service polish, phone-setup card, renewals.
4. `.co.ke` via a partner registrar.

## Left to the builder

Table/column names and queue plumbing (follow the repo's existing patterns), exact component layout, QR/profile
generation library, Stalwart client structure, and test layout.

## Open items for the owner

1. Confirm plan prices and the domain markup above.
2. Approve BYO-domain in release 1 (recommended) and the staff-task route for `.co.ke`.
3. Bulwark restarts: accept queued restarts at launch, or fund database-driven branding before the client count grows.
4. Renewal and grace policy; refund terms for bought domains.
5. Data-protection wording, retention period and ODPC registration needs.
