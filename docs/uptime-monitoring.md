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
| 2. Hosted monitor | Third party | Same, faster + from many regions | Yes — push/SMS |
| 3. Coolify notifications | The VPS | Container crash, failed deploy | Only if the box is alive |

Layer 1 is **in this repo and running**. Layers 2 and 3 need a human with
account access — see below.

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

## Layer 2 — a hosted monitor (TODO: needs an account)

This is the layer that actually wakes someone, and it needs a human to create
the account. Free tiers are sufficient; **UptimeRobot** (50 monitors, 5-minute
interval) or **Better Stack** (10 monitors, 3-minute, better alerting) both
cover this.

Configure four monitors:

| Monitor | Type | Target | Alert when |
|---|---|---|---|
| Apex | HTTPS keyword | `https://murzaktech.tech` | keyword `Murzak Technologies` **absent**, or non-200 |
| Health | HTTPS keyword | `https://murzaktech.tech/api/health` | keyword `"ok":true` absent |
| Portal host | HTTPS | `https://website.murzaktech.tech` | non-200 |
| Certificate | SSL expiry | `murzaktech.tech` | fewer than 21 days remain |

Use the **keyword** check type, not plain HTTP. A plain check would have
reported the parked apex as up.

Set alert contacts to a channel someone reads outside work hours, and set
"alert after 2 consecutive failures" to avoid paging on a single blip.

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
