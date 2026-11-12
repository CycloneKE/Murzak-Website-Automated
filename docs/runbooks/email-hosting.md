# Business email (Stalwart) - launch runbook

For the owner/operator. Written 2026-11-01 against branch `feat/stalwart-email`.
Design: `docs/superpowers/specs/2026-11-01-stalwart-email-hosting-design.md`.
Plan: `docs/superpowers/plans/2026-11-01-stalwart-email-hosting.md`.

Everything in the code is tested against a fake Stalwart (`STALWART_MOCK=1`).
**Nothing has been run against the real Stalwart, the real Hostinger DNS API or
the real Coolify yet.** Section 3 is the list of things only a live run can prove.

---

## 1. What this feature is and how an order flows

Murzak sells business email (plans `mail-starter`, `mail-business`, `mail-pro`;
prices and mailbox counts in `backend/config/emailPlans.js`) on a mail server
Murzak runs itself: Stalwart for the mailboxes and Bulwark for webmail, both on
the VPS. The customer brings a domain they own (release 1 is own-domain only).
Webmail is branded per customer at `https://webmail.<their domain>`. After
payment the system builds everything, then tells the customer by email.

1. **Order form** (`/email/setup`). The customer enters plan, domain, business
   name, contact email and mailbox names. `POST /api/orders` checks the input,
   the disk capacity gate and domain uniqueness, then saves a `mailSetup`
   (state `awaiting_payment`) on the Checkout Order. Nothing is reserved if
   anything is refused.
2. **Payment** through the normal checkout (M-Pesa or PayPal). The paid order
   produces a provisioning job for the `emailHosting` lane.
3. **Provisioning job** (`backend/services/email/stalwartProvision.js`, state
   `paid`). Steps, each safe to repeat: domain gate, create the Stalwart domain,
   create the mailboxes plus `postmaster` with the plan quota and the hourly send
   limit, write the `webmail` CNAME (own domains: failure is tolerated, the
   customer adds it), store the DNS record list (MX, SPF, DMARC, DKIM, webmail),
   set state `provisioned`, queue the webmail branding (one Bulwark restart shared
   by orders that arrive together), run one DNS check.
4. **Go-live sweep** (`backend/services/email/mailLiveSweep.js`, every
   `MAIL_LIVE_SWEEP_MS`). When the customer's DNS records resolve and
   `https://webmail.<domain>` answers, the order becomes `live` and a hand-over
   email goes out. It is sent once in normal running; if the server crashes between
   sending it and recording that it was sent, the next sweep can send it a second
   time. The email never contains a password.
5. **Status page** (`/mail/status/<token>`, no login). The customer sets each
   mailbox's first password, adds the phone/Outlook setup (QR code), and later
   resets passwords or adds mailboxes using a 6-digit code emailed to the
   contact address.

---

## 2. Environment variables

Backend variables go in the backend environment (`backend/.env.example` has a
commented block for them). Secrets are marked; never commit real values.

| Variable | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `STALWART_URL` | Base URL of the Stalwart server; the management API is JMAP at `<URL>/jmap` | none | Yes (live) | No |
| `STALWART_API_KEY` | Stalwart management API key | none | Yes (live) | **Yes** |
| `STALWART_AUTH` | `bearer` or `basic` | `bearer` | No | No |
| `STALWART_API_USER` | User name when `STALWART_AUTH=basic` | none | Only for basic | No |
| `STALWART_DNS_SERVER_ID` | Id of the DNS server object new domains attach to | none | Yes (live). Without it the whole client reports "not configured", including read-only calls | No |
| `STALWART_MOCK` | `1` = in-memory fake Stalwart (tests, local dev). Refused when `NODE_ENV=production`: the client reports it as not configured | off | Never in production | No |
| `MAIL_HOST` | Public mail host: the MX target and the IMAP/SMTP name. Its registrable domain is also refused as a customer domain | none | Yes. Provisioning fails permanently without it | No |
| `WEBMAIL_TARGET` | Where each `webmail.<domain>` CNAME points. Always kept in the Bulwark address list | `webmail.cloud.murzaktech.tech` | No | No |
| `BULWARK_KEEP_ADDRESSES` | Extra comma-separated hostnames to keep on the Bulwark service when its address list is rewritten (the rewrite REPLACES the list). Example: `test.cloud.murzaktech.tech` | none | No | No |
| `MAIL_LINK_SECRET` | Signs the no-login status links and confirmation codes (30-day links) | none | Yes. Without it links and codes cannot be made | **Yes** |
| `APP_BASE_URL` | Public site URL used to build the status link in emails | none | Yes. Without it emailed links are relative | No |
| `SUPPORT_EMAIL` | Support address shown in the hand-over email | falls back to `SMTP_FROM_EMAIL` | No | No |
| `MAIL_LIVE_SWEEP_MS` | Go-live sweep interval in ms (minimum 30000). `0` disables. A non-numeric value silently disables it | **120000 (ON when unset)** | No | No |
| `BULWARK_SERVICE_UUID` | Coolify service uuid of the Bulwark webmail | none | Yes. Branding fails without it | No |
| `BULWARK_APP_UUID` | Coolify application uuid inside that service; selects the address-list PATCH form | none | No (live-verify which form works) | No |
| `BULWARK_MERGE_MS` | Window in which orders share one Bulwark restart | `20000` | No | No |
| `BULWARK_CONTAINER_NAME` | Name used in the fallback address-list PATCH | `bulwark` | No | No |
| `MAIL_OUTBOUND_PER_HOUR` | Outgoing messages per mailbox per hour | `100` | No | No |
| `MAIL_RESERVED_DOMAINS` | Extra comma-separated domains customers may not use (`murzaktech.tech`, `murzaktech.com` and the `MAIL_HOST` domain are always reserved) | none | No | No |
| `MAIL_DISK_GB` | Usable mail disk. **Unset or invalid DISABLES the disk gate** | none | Yes before real orders | No |
| `MAIL_OVERCOMMIT` | How many times the disk the quotas may be promised | `3` | No | No |
| `MAIL_STACK_RAM_MB` | RAM the mail stack uses; subtracted from sellable RAM | `0` | Yes before launch (measure it) | No |
| `MAIL_NEW_DOMAIN_ENABLED` | `1` allows "register a new domain" mail orders | off | Keep off (not billed yet) | No |
| `HOSTINGER_API_TOKEN` | Writes the webmail CNAME (existing variable) | none | Yes for CNAME writes | **Yes** |
| `HOSTINGER_API_BASE` | Hostinger API host (existing) | `https://developers.hostinger.com` | No | No |
| `COOLIFY_BASE_URL`, `COOLIFY_TOKEN` | Used to edit Bulwark env vars and restart it (existing) | none | Yes for webmail | `COOLIFY_TOKEN` **Yes** |
| `COOLIFY_TIMEOUT_MS` | Coolify call timeout (existing) | `30000` | No | No |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Sends the hand-over and confirmation-code emails (existing) | port 587, name "Murzak Technologies" | Yes. Without it no code or hand-over email is sent | `SMTP_PASS` **Yes** |

Frontend (build-time, public, in `frontend/.env.example`):

| Variable | Purpose | Default |
|---|---|---|
| `VITE_MAIL_HOSTNAME` | Mail server name shown for phone/Outlook setup. Must equal `MAIL_HOST` | `stalwart.cloud.murzaktech.tech` |
| `VITE_MAIL_NEW_DOMAIN_ENABLED` | `1` lets the order form offer a new domain. Keep blank | off |

VPS backup script (`/etc/murzak/stalwart-backup.env`, not the backend; see
`deploy/vps/README.md`): `STALWART_DATA_DIR` (default `/var/lib/stalwart`, a
placeholder), `BACKUP_DEST` (required), `BACKUP_RETENTION_DAYS` (14),
`STALWART_QUIESCE_CMD`, `STALWART_RESUME_CMD`, `RCLONE_CONFIG`.

---

## 3. Launch checklist

### BEFORE ENABLING

- [ ] **FIRST: `MAIL_LIVE_SWEEP_MS` is ON by default (120000) when the variable is
      missing.** Set `MAIL_LIVE_SWEEP_MS=0` in the production env now, and only remove
      it (or set `120000`) after the live dry run below has passed.
- [ ] **Stalwart is 0.16 or newer.** Management is JMAP (`POST /jmap`, `x:Domain`,
      `x:Account`). On an older Stalwart, `API_SHAPES` in
      `backend/services/email/stalwartClient.js` needs a REST adapter first.
- [ ] `STALWART_URL`, `STALWART_API_KEY` set. Create the key in Stalwart with only
      the rights this feature needs.
- [ ] `STALWART_DNS_SERVER_ID` set (the client refuses to run without it).
- [ ] `MAIL_HOST` set, resolves to the VPS, and `VITE_MAIL_HOSTNAME` matches it.
- [ ] `MAIL_LINK_SECRET` set to a long random value (keep a copy in the password
      manager; changing it invalidates every emailed link and pending code).
- [ ] `APP_BASE_URL` set to the public site URL (status links are built from it).
- [ ] `BULWARK_SERVICE_UUID` set (and `BULWARK_APP_UUID` if the live check below
      says the application form of the PATCH is needed).
- [ ] `MAIL_DISK_GB` set to the real mail disk, and `MAIL_STACK_RAM_MB` set after
      measuring the running stack.
- [ ] `SMTP_*` and `HOSTINGER_API_TOKEN` and `COOLIFY_*` present in the backend env.
- [ ] **`MAIL_LIVE_SWEEP_MS`: the sweep is ON by default (120000) when the variable
      is unset.** Set `MAIL_LIVE_SWEEP_MS=0` until the live dry run below has
      passed, then remove it or set a real interval. The hand-over email points to
      the "Add to my phone" section; that section is deployed in this branch, but
      enable the sweep only after the dry run.
- [ ] `MAIL_NEW_DOMAIN_ENABLED` and `VITE_MAIL_NEW_DOMAIN_ENABLED` left off.

### PREFLIGHT FROM OUTSIDE (done 2026-11-01, public read-only probes, no credentials)

What the live mail host looks like from the internet. These facts settle some
settings above; they do NOT replace the dry run (no authenticated call was made).

- The MX of `murzaktech.tech` is `stalwart.cloud.murzaktech.tech` (187.124.217.78,
  the same IP as the site). **Use `MAIL_HOST=stalwart.cloud.murzaktech.tech` and
  `STALWART_URL=https://stalwart.cloud.murzaktech.tech`.** `mail.murzaktech.tech`
  does NOT exist in DNS: the earlier default for `VITE_MAIL_HOSTNAME` pointed at it
  and was corrected.
- `https://stalwart.cloud.murzaktech.tech/jmap/session` answers 200 with JMAP
  capabilities (core, mail, calendars, contacts, filenode, principals, submission,
  websocket...), consistent with a recent Stalwart (0.16 or newer). The
  `urn:stalwart:jmap` management capability only shows once authenticated, so the
  version check in BEFORE ENABLING is still open.
- SMTP answers on 25 and 465 with the `Stalwart ESMTP` banner. **Port 587 timed out
  from outside**, so phone setup must use SMTP 465 (implicit TLS) and IMAP 993; do
  not tell customers to use 587.
- The IMAP TLS certificate (Let's Encrypt, valid to 2027-01-29) covers
  `murzaktech.tech` and `stalwart.cloud.murzaktech.tech`, so phones connecting to
  `MAIL_HOST` get a valid certificate for any customer domain.
- `murzaktech.tech` already has `v=spf1 mx -all`, `_dmarc` `p=none` and an
  `autoconfig` CNAME to the mail host: Stalwart's automatic DNS did write records
  for the Murzak domain. (Customer domains get `~all`, which this feature publishes.)
- `webmail.cloud.murzaktech.tech` resolves (same IP) and serves the webmail over
  HTTPS (a 307 to `/en`), so it is a valid `WEBMAIL_TARGET`.
- `https://murzaktech.tech/api/health` returns 200.
- NOT checkable from outside: backend env values (a read of the env file was
  blocked), the Coolify API (VPS IP allowlist), the Stalwart management API
  (needs the key), outbound port 25 from the VPS, PTR, and the real M-Pesa payment.

### LIVE DRY RUN (needs the owner)

**Start with the read-only checker.** It makes only GET and JMAP `get` calls, sends
no mail, pays nothing, and never prints a secret (it prints only whether one is set):

```bash
cd backend
node scripts/mail-dryrun-check.js                  # on your laptop: settings, Stalwart, Hostinger, Frappe, SMTP
node scripts/mail-dryrun-check.js --only=coolify   # ON the VPS (Coolify allow-lists its IP)
node scripts/mail-dryrun-check.js --vps            # ON the VPS: also outbound port 25 and PTR
node scripts/mail-dryrun-check.js --zone=murzaktech.tech   # which Hostinger zone to read
```

It reads `backend/.env` from the current folder, so run it yourself rather than
pasting its environment anywhere. It exits 1 if anything FAILs. The Stalwart,
Hostinger and Coolify items below stay unchecked until it passes on the real
servers (a run on 2026-11-07 on a laptop without those credentials could only
verify the Frappe and SMTP parts). The payment, phone, Gmail, GA and nginx items
cannot be automated and still need you.

Use a throwaway domain you own. Make one real, small M-Pesa payment for it.
Everything below is currently UNVERIFIED-LIVE: it was written from documentation
and self-made samples, not from the real servers.

- [ ] **Stalwart JMAP shapes** (`API_SHAPES`, samples in `backend/test/fixtures/stalwart/`):
      method names, arguments and responses for `x:Domain/get|set` and
      `x:Account/get|set|query`; that `x:Domain/get` returns the domain
      `description` (the `murzak-order:<order>` marker); how a Password credential
      patch behaves when setting a password; the DKIM record call.
- [ ] **Hostinger DNS zone shapes** for the `webmail` CNAME: GET
      `/api/dns/v1/zones/<zone>` response and the PUT body (`mailDns.js`
      `DNS_SHAPES`). Confirm the CNAME really appears and nothing else changed.
      (For a domain not in the Murzak Hostinger account this write is expected to
      fail and be tolerated; the customer adds the record.)
- [ ] **Coolify address-list PATCH** for Bulwark (`webmailBranding.js`
      `setBulwarkAddresses`): which form works (`urls: [{name,url}]` on the service,
      or `fqdn` on the application with `BULWARK_APP_UUID`).
      *Read in the Coolify fork source (version 4.5.3, 2026-11-07):* both forms exist.
      `PATCH /services/{uuid}` takes `urls: [{name, url}]`; `name` must equal the
      service container name (`BULWARK_CONTAINER_NAME`, default `bulwark`) and a
      comma-separated list in one `url` is accepted and split. `PATCH
      /services/{uuid}/applications/{app_uuid}` also exists. Still confirm against the
      LIVE server's version (the checker prints it with `--only=coolify`).
- [x] **Coolify start/restart/stop verb.** Newer Coolify (4.5.x) only accepts POST for
      start, restart and stop (a GET answers 405 "This endpoint has changed to a POST
      request"); the 4.1.2 server verified in August only accepts GET. The lane now
      tries GET and repeats as POST on a 405 (`runResourceAction` in
      `lanes/coolify.js`, test `coolifyActionCompat.test.js`), so it works on both. The
      checker reports which style the live server uses.
- [ ] **Shared webmail address survives the first order.** The address-list PATCH
      replaces the whole list; since 2026-11-12 the code always sends
      `WEBMAIL_TARGET` (plus `BULWARK_KEEP_ADDRESSES`) along with the customer
      addresses. After the first real order, confirm in Coolify that
      `webmail.cloud.murzaktech.tech` is still on the Bulwark service and answers.
      Live Bulwark service uuid (2026-11-12): `o62w0u2qlcwbhtxfosd7kyf1`; the other
      Bulwark container (`3oh8nmakj09hjzvdmpqresgg`) has no domain and looks unused.
- [ ] **`DOMAIN_BRANDING` env format** that Bulwark actually reads, and that the
      restart brings up `webmail.<domain>` with the client's title and logo.
      Check Bulwark's real page title (the title check is advisory only).
- [x] **`Portal Users Requests` fields** used for staff tickets
      (`status: "Waiting on Admin"`, `source: "Portal"`, `messages[]`) against the
      live doctype, and **Portal Invoice `status: "Paid"`** (used by
      `mailSetupStore.saveMailSetup`). The mock Frappe accepts any field; the real
      one returns 417 on a wrong value.
      **VERIFIED 2026-11-07** by `mail-dryrun-check.js` against the live Frappe
      (`erp.murzaktech.tech`): the ticket fields and select values match, Portal
      Invoice has `Paid`, and Provisioning Job has every field the lane and portal
      read. (Field and option names only; no record was read or written.)
- [ ] **Gmail original headers** on a message sent from the new mailbox to Gmail:
      SPF PASS, DKIM PASS, DMARC PASS.
- [ ] **Google Analytics DebugView** while opening a status link: no hit contains
      `/mail/status/<token>` (the page tries to keep the token out of analytics).
- [ ] **nginx access logs**: check whether `/api/mail/status/<token>` is written to
      the log. Either stop logging that path or accept it knowingly; the token is a
      30-day credential for that order.
- [ ] **QR code scanned with a real phone** (the encoder is hand-written and only
      round-trip tested; `node frontend/scripts/qr.check.mjs`). Add the mailbox to
      a phone from the status page.
- [ ] A hand-over email arrives once, a first password can be set, and a reset
      needs the emailed code (try the phone, not only the desktop).
- [ ] **Mock Frappe ignores list filters.** The tests cannot prove that the real
      Frappe filters (`config_json like %"mailSetup"%`, `invoice_doc_name = ...`,
      Provisioning Job by account/service/status) return only the right rows. Check
      the job lookup, the taken-domain check and the renewal no-op against the live
      doctype during the dry run.
- [ ] **Renewal**: let a renewal invoice for the throwaway mail plan run once (or
      replay one) and confirm its job ends `active` with the same `external_ref`, no
      ticket, and the portal mailbox list still opens.
- [ ] **`DOMAIN_BRANDING_APPLIED`**: the code writes this extra Coolify env key on the
      Bulwark service (a hash of what is running). Confirm Coolify accepts it and
      Bulwark ignores it.
- [ ] **CR/LF in a business name** is not stripped before the email subject
      (nodemailer folds header lines). Try a name with a line break and check the
      hand-over email.
- [ ] **Hand-over test message**: the production test message is sent to the
      customer's own main mailbox through the normal mailer, not through Stalwart's
      SMTP. Decide that this is acceptable.
- [ ] **Clean up**: delete the test domain and mailboxes in Stalwart, remove the
      test client from Bulwark's `DOMAIN_BRANDING`, and cancel the test order.

### VPS (steps in `deploy/vps/README.md`, section "Stalwart mail: capacity, backups and sending safety")

- [ ] Confirm the real `STALWART_DATA_DIR` (the `/var/lib/stalwart` default is a
      placeholder).
- [ ] Install the backup timer (`murzak-stalwart-backup.timer`), run it once, read
      `journalctl -u murzak-stalwart-backup.service`.
- [ ] `BACKUP_DEST` is an rclone remote (a local folder is only staging). Rclone
      config path decided (`/root/.config/rclone/rclone.conf` or
      `RCLONE_CONFIG=/etc/murzak/rclone.conf`, root-owned, mode 0600).
- [ ] **Restore drill passed** and the result recorded. A failed drill blocks launch.
- [ ] `stat -c '%a %n'` on `BACKUP_DEST` and the archives shows `700` and `600`
      (could not be checked on the Windows development host).
- [ ] Quiesce/resume commands set, or the Stalwart-native export used, so the
      backup is consistent.
- [ ] **Outbound port 25** works from the VPS (`nc -vz -w 10 gmail-smtp-in.l.google.com 25`).
- [ ] **PTR (reverse DNS)** of the VPS IP points at `MAIL_HOST`, and `MAIL_HOST`
      resolves back to the same IP.

### KNOWN LIMITS (accepted for release 1)

- New-domain registration through the email order is **disabled** until the
  checkout bills the domain (`MAIL_NEW_DOMAIN_ENABLED`). Customers register the
  domain first in the portal, then add email.
- **Annual billing is not offered** (the checkout bills the 20% annual prepay, the
  plan config assumes 10 months; the toggle is hidden).
- **`.co.ke` and other `.ke` domains** cannot be registered automatically. The job
  escalates; staff register the domain, mark it active on the customer's account
  and requeue (section 4).
- **No logo/branding step after payment.** The customer cannot upload a logo yet;
  `logoUrl` is only taken from the order form.
- **In-process locks only.** The branding queue and the per-order locks assume ONE
  backend instance. Do not run two backend processes against the same Frappe.
- **Domain uniqueness is check-then-write**, not atomic. Two simultaneous orders
  for the same domain can both pass the order form; the provisioning step then
  refuses the second one permanently (tested), but both customers may have paid.
  An order form that has no invoice yet does not hold its domain against other
  accounts (only an invoiced or paid order does), which widens that window.
- **The webmail address list never shrinks automatically.** Removing a client from
  Bulwark is a manual edit in Coolify (see section 4).
- **Backup prune glob** `stalwart-*.tar.gz` is not anchored to the stamp format; a
  hand-placed file with that name older than the retention would be deleted.
- **No alerting** for a failed backup or a full disk. Watch the systemd unit and
  `df` yourself. No automatic send suspension on bounce/complaint spikes.
- The mail sweeps (`listOrdersByMailState`, taken-domain check, capacity) read
  **every Checkout Order** each pass. Fine at small scale; revisit past a few
  thousand orders.
- **`STALWART_DNS_SERVER_ID` is required even for read-only calls** (the client
  reports "not configured" without it). Decision: kept.
- **`logoUrl` accepts any https host.** Restrict it (allow-list or fetch through a
  proxy) before any server-side code fetches the image.
- **Orders that reach `provisioned` with no stored DNS records** now raise one staff
  ticket (marker `staffTicketAt`) instead of an error on every pass.
- **A failing mail sender logs a warning on every sweep** until it works again.
- **Rollback after an ambiguous provider failure** can reopen a free first password
  set for a mailbox (the status link already grants a first set without a code).
- **Sweep writes are not under the order lock across processes**: the per-order locks
  are in-process only, so a second backend instance could still overwrite a write.
- **Existing `BACKUP_DEST` permissions are not tightened**; only new directories and
  files are created 0700/0600.
- **Unexpired unpaid Drafts count toward the disk capacity gate** (conservative).
- **Status routes return 404, not 401,** for every bad, expired or unknown token.
- **Google Analytics caveat**: client-side navigation INTO a status path could send an
  enhanced-measurement hit before analytics is disabled; the emailed link is a cold
  load and is covered. Verify with DebugView.
- **Dialog accessibility deferrals**: the password/code countdown is not announced,
  tabs lack arrow-key navigation, a backdrop click closes the dialog and loses input,
  and a failed save keeps the typed password/code in the form.
- **`mail-business` and `mail-pro` are hidden from the Starter configurator** by the
  `mailPlan` flag, and since this wave the generic paid routes also refuse any `mail-*`
  plan server-side (`MAIL_PLAN_SETUP_REQUIRED`). Mail plans are bought only from the
  email setup page.
- **No consent checkbox or consent timestamp** on the order form. The design asked
  for one. NOT built.
- **Renewals, grace periods and suspension for non-payment are NOT built.** A renewal
  invoice for a mail plan is accepted as a no-op; a customer who stops paying keeps
  their mailboxes indefinitely until staff act.
- **No refund and no "domain taken" buttons**; both are manual staff work.
- **The only runtime test switch is `STALWART_MOCK`.** There is no fake registrar, so
  new-domain flows cannot be rehearsed end to end without real purchases.
- **An account with two mail orders on the same plan can manage only one** in the
  portal (the portal looks up the mail job by account and plan).
- **Wrong confirmation codes**: 20 per order per 24 hours, then no code is checked or
  sent until the window passes (customer sees "too many incorrect codes").
- Smaller items: the portal "add mailbox" helper text still mentions underscores
  (the strict rule bans them); `makeSendMailReadyEmail` in `mailLiveSweep.js` is
  dead code; `frontend/scripts/qr.check.mjs` and `safeUrl.check.mjs` are not in CI;
  the code email is not tied to a specific mailbox.

---

## 4. Operating notes

**Run the automated checks.** `cd backend && npm run test:email` runs the email
suites, including the end-to-end mock run `backend/test/emailEndToEnd.test.js`.
(`npm test` stops early at the pre-existing `benchLaneApps` failure on Windows.)

**Retry a stuck order.** Portal, admin, Provisioning, Jobs
(`docs/operations-manual.md` section 6). An email job in `needs_human` or
`failed` shows a reason. Fix the cause, then press **Retry**. The job is safe to
repeat: it reuses the same Stalwart domain and accounts and never makes
duplicates, and an order that is already `live` is not demoted. Typical reasons:
"MAIL_HOST is not set", "already in use by another order", "reserved for Murzak",
"is a Kenyan (.ke or .co.ke) domain" (register it, mark the Customer Domain row
active, Retry), or Stalwart unreachable (retries by itself a few times first).

**Where staff see escalations.** Three places: the Provisioning panel (job in
`needs_human`), a "Portal Users Requests" ticket on the customer's account created
when the job escalates, and a second ticket "Mail setup waiting: <business>" if an
order sits `provisioned` for more than 72 hours without going live (usually the
customer has not published the DNS records). The customer's own status page just
says the setup needs a quick check by the team.

**Order stuck "provisioned".** The sweep is waiting for DNS or webmail. Open the
order's `mailSetup.dnsRecords` (Checkout Order `config_json`) and compare with
`dig` on the customer's domain; the status page shows the customer the same list
for own domains. Check `https://webmail.<domain>` answers over https.

**Release a domain held by a cancelled order.** Two separate holds:
1. In the shop database: a Cancelled or Deleted order, or a Draft whose
   reservation has lapsed, no longer blocks the domain for new orders. Cancel the
   order to free it.
2. In Stalwart: the domain and its mailboxes still exist. A new order for that
   domain will be refused permanently ("already in use by another order") until
   you delete the domain's accounts and the domain in the Stalwart admin.
3. In Bulwark: the cancelled order still counts as an active webmail client while
   its `mailSetup.state` is `provisioned` or `live`, and the branding list never
   shrinks by itself. To really remove it, edit `DOMAIN_BRANDING` (and the address
   list) in Coolify by hand and set the order's `mailSetup.state` to something
   else. This path has not been exercised live.

**Domain dispute.** Own-domain ownership is NOT verified before payment. Someone who
pays first for a domain they do not own can block the real owner (the real owner's
order is refused as "already in use", and Stalwart refuses the clash). To resolve:
confirm the real owner (registrar record or DNS control), cancel the other order,
refund by hand, delete that Stalwart domain and its mailboxes (and its Bulwark
branding entry, see above), then Retry the real owner's job.

**Emails not arriving.** Check `SMTP_*`. If `sendMailCodeEmail` fails the route
answers an error and does not claim the code was sent. A failed hand-over email is
retried on the next sweep.

---

## 5. Merge note (read before merging this branch; written 2026-11-01)

This branch creates `frontend/src/pages/cloud/CloudEmail.tsx` as a **new file** and
adds **no route** for it. The owner's main checkout has an **uncommitted,
different** `CloudEmail.tsx` and a `/cloud/email` route. So merging needs a manual
reconcile of `CloudEmail.tsx` and `App.tsx`. Do not let git pick a side.

Files likely to conflict (from `git diff --stat origin/master...HEAD` on this
branch, compared with `git status` in the main checkout on 2026-11-01; both sides may
have moved since, so rerun both commands before merging):

- `frontend/src/pages/cloud/CloudEmail.tsx` - new here, untracked and different in
  the main checkout. Pick the better page, keep the catalog-driven prices and the
  copy rules from this branch (no vendor names, no 99.9% claim, no new-domain promise).
- `frontend/src/App.tsx` - changed in both (this branch adds `/email/setup`,
  `/mail/order/:orderId`, `/mail/status/:token` and the analytics redaction; the
  main checkout adds `/cloud/email`). Keep both sets of routes.
- `frontend/src/pages/Checkout.tsx` - changed in both.
- `frontend/src/types.ts` - changed in both.
- `docs/superpowers/plans/2026-11-01-stalwart-email-hosting.md` and
  `docs/superpowers/specs/2026-11-01-stalwart-email-hosting-design.md` - untracked in
  the main checkout, committed here. Git will refuse to overwrite them: delete or
  move the untracked copies first.
- Also changed on this branch and worth a glance if master moved:
  `frontend/src/config/serviceCatalog.ts` plus `backend/data/serviceCatalogSnapshot.json`
  (never hand-merge the JSON; regenerate with `cd backend && npm run gen:catalog`),
  `backend/server.js`, `backend/routes/ordersRoutes.js`, `backend/routes/portalRoutes.js`,
  `backend/package.json` (the `test` chain and the new `test:email`),
  `backend/services/provisioning/capacity.js`, `backend/services/provisioning/lanes/emailHosting.js`,
  `backend/services/checkout/orderStore.js`, `backend/utils/mailer.js`,
  `backend/.env.example`, `frontend/.env.example`, `deploy/vps/README.md`.
- The main checkout also modifies `Header.tsx`, `Cloud.tsx`, `ThankYou.tsx` and
  `portal/tabs/ResourceDetail.tsx`, which this branch does not touch. They will not
  conflict, but check that nothing there links to a `/cloud/email` that still needs
  its route after the merge.

After merging, rerun `cd backend && npm run test:email` and
`cd frontend && npm run build`.
