# Customer Lifecycle Communications — Design

## Context

The trial lifecycle already has a complete, working email sequence — `sendTrialStartedEmail` →
`sendTrialEndingSoonEmail` → `sendTrialExpiredEmail` in `utils/mailer.js`, all wired to real state
transitions. Nothing else in the customer lifecycle gets the same treatment: signup gets only an
email-verification link (not a welcome), a paying customer's first renewal signal is the day the
invoice already exists (no advance notice), the grace window between "invoice ready" and "suspended"
has silence in the middle, domain purchases and their eventual expiry send nothing at all, and
cancelling a service produces no confirmation. This spec closes those gaps, reusing the exact
`sendMail` pattern already proven by the trial sequence rather than inventing a new one.

This is a sibling to [the platform maintenance automation spec](2026-08-15-platform-maintenance-automation-design.md)
— it shares that spec's `setTimeout`+`setInterval(...).unref()` scheduling mechanism in `server.js`,
but is a separate document because the audience and concern are different: that spec is admin-only
infra health; this one is customer-facing copy and per-customer send-once tracking.

## The problem every reminder in this spec has to solve: deduplication

The trial emails fire on one-time state transitions (trial started, trial ending, trial expired) —
each condition is true exactly once, so nothing needs to remember it already sent. Everything in this
spec is different: "expires in 30 days" or "renews in 7 days" stays true across many sweep runs. Every
reminder below gets its own persisted marker so a hypothetical hourly sweep doesn't re-email the same
customer a dozen times while they sit inside the window. Two exceptions are naturally one-time by
construction and need no marker: the welcome email (fires once, on email verification) and the exit
email (fires once, on the delete action itself) — both are HTTP-request-triggered, not sweep-triggered.

## 1. Domain reminders

### 1a. Pending-fulfilment digest (staff-facing)

Not a per-request reminder — a recurring digest of everything still sitting in
`Hosting Domain Purchase Request` with `status = "pending"` past a configurable age, emailed to
`ADMIN_EMAILS`. No dedup marker needed: this is deliberately a repeating digest (staff should keep
seeing a stuck request until they act on it), so the "don't repeat too often" control is just the
sweep interval itself (default 24h) — same shape as `sendAdminSupportAlert`, reusing
`adminRecipients()`.

Env: `DOMAIN_PENDING_REMINDER_SWEEP_ENABLED` (default `true`), `_INTERVAL_MS` (default 24h),
`DOMAIN_PENDING_REMINDER_AGE_HOURS` (default 24 — how stale before it's digest-worthy).

### 1b. Expiry reminder (customer-facing, tiered)

Reads `Customer Domain.expires_on` (already exists, unused). Tiered at 30/14/7 days out. New field:
`last_expiry_reminder_days` (Int) on `Customer Domain` — stores which milestone was last sent; the
sweep only fires when days-until-expiry has crossed a *new*, smaller milestone than what's recorded.
Reset to null whenever `expires_on` moves later (a renewal) — one line inside whatever in
`customerDomains.js` updates `expires_on`, so a renewed domain's next cycle starts clean.

A domain that actually lapses (`status` flips to `expired` — already a valid enum value on this
doctype) gets its own one-time email fired from wherever that transition happens today (currently
the "Mark expired" admin action in `AdminDomains.tsx`) rather than from the sweep — that's a discrete
event, not a threshold crossing, so it doesn't need sweep polling.

Env: `DOMAIN_EXPIRY_REMINDER_SWEEP_ENABLED` (default `true`), `_INTERVAL_MS` (default 24h — a date
threshold doesn't need checking more than once a day).

## 2. Renewal reminders — extend `sweepRenewals`, don't duplicate it

Both of these read data `renewalService.js::sweepRenewals` already computes (the account's next
renewal date, the open invoice's grace-window position) — adding two new phases to that existing
function, rather than standing up parallel sweeps that re-query the same accounts and invoices.

### 2a. Advance renewal reminder

Fires N days (default 7, `RENEWAL_ADVANCE_REMINDER_DAYS`) *before* the renewal invoice would be
created — before today, a customer's first signal was the day the charge already existed. New field:
`last_renewal_reminder_for` (Data, stores the cycle-anchor date it was sent for) on `Web Account` —
naturally resets each cycle since the anchor moves once a new invoice is paid.

### 2b. Mid-grace reminder

Fires partway through the grace window (default `graceDays / 2`,
`RENEWAL_MID_GRACE_REMINDER_DAYS_OVERRIDE` to set explicitly) — between "invoice ready" (day 0) and
"suspended" (day `graceDays`), which currently has nothing in between. New field:
`mid_grace_reminder_sent` (Check) on `Portal Invoice` itself — naturally scoped per-invoice, resets
for free every cycle since it's a new document each time.

## 3. Welcome email

Fires once, on email-verification completion (the route in `authRoutes.js` that confirms the
verification link) — distinct from `sendVerificationEmail`, which only confirms the address. New
field: `welcome_email_sent` (Check) on `Web Account`, guarding against a double-send if the
verification link is opened twice. No sweep, no env flag — same unconditional pattern as
`sendVerificationEmail` itself.

## 4. Exit / cancellation confirmation

Fires once, from `DELETE /api/account/services/:serviceId` in `billingRoutes.js` — **after**
`destroyServiceInfrastructure` succeeds, never before (mirrors that route's existing safety property:
nothing customer-facing should confirm an action until the underlying teardown is actually done).
Scoped to per-service cancellation, matching what that route actually does — there is no
distinct "close my whole account" action in this codebase to hook a broader version onto. No dedup
marker needed: it's a direct response to one HTTP request, same shape as the existing
`sendInvoiceDeletedEmail` call site.

## New `utils/mailer.js` functions

`sendDomainPendingDigest`, `sendDomainExpiryReminder`, `sendDomainExpiredEmail`,
`sendRenewalAdvanceReminder`, `sendMidGraceReminder`, `sendWelcomeEmail`,
`sendServiceCancelledEmail` — each following the existing `sendTrialStartedEmail`-style shape
(subject + plain text, HTML only where the existing pattern already uses it).

## Explicitly out of scope

- Account-level closure emails — no such action exists in the codebase today; only per-service
  cancellation does.
- A tiered advance-renewal sequence (e.g. 14-day *and* 7-day) — matching the domain expiry tiering
  would be easy to add later, but the single 7-day reminder is the actual gap being closed here.
- Any change to the trial sequence — it already works, untouched.
- SMS/WhatsApp — email only, matching every other channel already in `utils/mailer.js`.

## Testing

Same house style as the platform maintenance spec: hand-rolled harness, scripted Frappe clients, no
real SMTP. Coverage needed: each dedup marker's exact boundary (crossing 31→30 days fires, sitting at
25 days does not re-fire; a renewal resets the domain's marker), the mid-grace reminder firing exactly
once per invoice, and the exit email never firing when `destroyServiceInfrastructure` returns
`{ok: false}`.
