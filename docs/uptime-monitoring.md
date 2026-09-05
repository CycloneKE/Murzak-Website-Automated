# Uptime monitoring

## Why this document exists

The public apex was unreachable from roughly 2026-07-03 to 2026-09-04 and
nobody noticed for two months. That was not a monitoring *failure* — it was a
monitoring *absence*. Everything watching the platform ran on the VPS itself
(Coolify, Coolify Sentinel), so none of it could report that the box, its
certificate, or its DNS was the broken thing.

The rule this doc encodes: **a monitor that shares a failure domain with the
thing it monitors is not a monitor.** Anything that can be taken out by the
same outage it is supposed to report does not count.

## The three layers

| Layer | Runs on | Catches | Wakes someone? |
|---|---|---|---|
| 1. GitHub Actions watchdog | GitHub | DNS, TLS, HTTP, wrong-content | Email only, best-effort |
| 2. Hosted monitor | Third party | Same, faster, every 5 min | Yes — push/SMS |
| 3. Coolify notifications | The VPS | Container crash, failed deploy | Only if the box is alive |

Layers 1 and 2 are **running**: the watchdog is in this repo, and UptimeRobot
has keyword monitors on the apex and the health endpoint. Layer 3 is not
configured, and **no alert path has been tested end to end yet** — see
*Prove it works before trusting it*.

---

## Layer 1 — the GitHub Actions watchdog (done)

[`.github/workflows/uptime-watchdog.yml`](../.github/workflows/uptime-watchdog.yml),
every 10 minutes. Five checks:

1. **`murzaktech.tech` resolves to `187.124.217.78`** — asserts the *address*,
   not merely that it resolves. A lapsed domain on a parking IP resolves fine.
2. **apex, `www` and `website` return HTTP 200.**
3. **The response body contains `Murzak Technologies`.** A parking page returns
   200 too; status alone would have called the broken apex healthy. This is the
   check that distinguishes "reachable" from "actually our site".
4. **`/api/health` returns `ok:true`.**
5. **The TLS certificate has more than 7 days left**, with a warning under 21.
   Renewal attempts at 30 days, so crossing 7 means renewal has been failing
   silently for three weeks.

Failures open a **single** issue titled `🔴 Uptime watchdog: murzaktech.tech is
failing checks` and comment on it thereafter, so a day-long outage produces one
issue rather than 144.

### Known limits — do not treat this as a pager

- **GitHub cron is best-effort.** Runs are routinely 5–15 minutes late and are
  dropped under platform load.
- **GitHub disables scheduled workflows after 60 days of repo inactivity.** On
  a quiet repo this watchdog turns itself off *silently*. Use the
  `workflow_dispatch` button periodically to confirm it still runs.
- **Notification is an email**, to whoever receives Actions failure mail. No
  SMS, no push, nothing at 3am.
- **`/api/health` is a liveness probe only** (`res.json({ok:true})`). Green
  means Node is up and routing — not that Frappe, Redis, the database or
  checkout work. A deeper readiness endpoint is worth adding; until it exists,
  do not read a green run as "payments work".

---

## Layer 2 — a hosted monitor (partly done)

This is the layer that actually wakes someone. **UptimeRobot** is set up, with
keyword monitors live on the apex and on `/api/health`, and mail delivery
confirmed. One gap remains: the older `website.murzaktech.tech` monitor is
still a plain HTTP/S check and should be converted to keyword.

### Use keyword checks, not plain HTTP — this is measured, not theoretical

A plain HTTP/S monitor asks "did I get a 200?". Hostinger's parked-domain page
answers **yes**. Verified 2026-09-04 against the parking IP the apex used to
point at, with the apex Host header:

```console
$ curl -o /dev/null -w '%{http_code}\n' --resolve murzaktech.tech:443:2.57.91.91 https://murzaktech.tech
200
$ curl -o /dev/null -w '%{http_code}\n' --resolve murzaktech.tech:80:2.57.91.91 http://murzaktech.tech
200
```

**A plain HTTP monitor on the apex would have reported "up" for the entire
two-month outage.** Status codes cannot distinguish "our app" from "someone
else's placeholder holding our domain" — only content can. Every monitor below
that fronts a customer-facing URL is therefore a *keyword* monitor.

Configure three monitors — all keyword, all free tier:

| Monitor | Type | Target | Alert when | Status |
|---|---|---|---|---|
| Apex | HTTPS **keyword** | `https://murzaktech.tech` | keyword `Murzak Technologies` absent, or non-200 | ✅ live |
| Health | HTTPS **keyword** | `https://murzaktech.tech/api/health` | keyword `"ok":true` absent | ✅ live |
| Portal host | HTTPS **keyword** | `https://website.murzaktech.tech` | keyword `Murzak Technologies` absent, or non-200 | exists, but as plain HTTP/S — convert it |
| Certificate | — | — | — | **don't add** — Layer 1 covers expiry free, see below |

> **Get the alert condition the right way round.** UptimeRobot's dropdown
> defaults to *"Start incident when keyword exists"*, which is backwards for
> this purpose: it would page you while the site is healthy and stay silent
> while it is parked or broken. You want **"when keyword does not exist"**.
> Sanity check after saving — with the site healthy, the monitor must read
> **Up**. If a fresh monitor immediately reads Down, the condition is inverted.
>
> Keyword matching is literal: `/api/health` returns exactly `{"ok":true}` with
> no whitespace, so `"ok": true` (with a space) would never match.

Set alert contacts to a channel someone reads outside work hours, and set
"alert after 2 consecutive failures" to avoid paging on a single blip — the
free tier checks from **one region only** (North America), so a regional
network blip is otherwise indistinguishable from an outage.

### Don't pay for the SSL/domain expiry add-on

UptimeRobot's free plan shows "Domain valid until" and "SSL certificate valid
until" as locked upsells. **Layer 1 already covers certificate expiry** — it
reads the live certificate every 10 minutes, warns under 21 days and fails
under 7. The two layers are deliberately complementary: the hosted monitor
pages fast, the watchdog checks the things the free tier withholds.

## Layer 3 — Coolify notifications (TODO: needs dashboard access)

Coolify can notify on container status and failed deploys, via email, Discord,
Telegram or Slack, under **Settings → Notifications**. It runs on the VPS, so
it cannot report that the VPS is gone — it is the layer that catches "the app
crash-looped while everything else stayed up". Enable it, but never rely on it
alone.

---

## Prove it works before trusting it

An untested alert path is an assumption, not a safety net. Once layers 2 and 3
are configured, deliberately break something and time the alert:

```bash
# On the VPS. Stop the app, confirm the alert arrives, then bring it back.
sudo docker stop $(sudo docker ps --filter "name=m97a6sejlizhpmvk5b77dhib" --format "{{.Names}}" | head -1)
# ...wait for the alert, note how long it took...
sudo docker start <the same container name>
```

Record who got the alert and how long it took. If nobody got one, the
monitoring is decorative. This is the Week 4 go/no-go item — do it before
launch, not after the first real outage.

## Recovering from a watchdog alert

1. Is it real? `curl -sSI https://murzaktech.tech` from your own machine.
2. **DNS wrong** → check the apex A record is still `187.124.217.78`; restore
   from `/root/dns-backup/` on the VPS if the zone was edited.
3. **Cert expired** → `sudo certbot renew --cert-name murzaktech.tech`, then
   `sudo nginx -t && sudo systemctl reload nginx`. Renewal needs the `:80` ACME
   location in `sites-available/murzaktech.tech` to stay reachable.
4. **502/503 with a valid cert** → Traefik has no route. Check the app is
   running and that its domains still include the apex (see
   `deploy/vps/README.md`, step 4).
5. **200 but the marker is missing** → something else is answering for the
   hostname. Check `nginx -t`, the enabled vhosts, and that the apex vhost has
   not been shadowed.
