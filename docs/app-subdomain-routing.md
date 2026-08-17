# App subdomain routing (`*.apps.murzaktech.tech`)

How a Coolify-provisioned customer app becomes reachable on the public
internet. Written 2026-08-17, after every provisioned subdomain was found to
be returning 404.

## The topology, and why it bites

On `srv1657915` (187.124.217.78) the host ports are split:

| Port | Owner |
|------|-------|
| 80, 443 | plain `nginx/1.24.0 (Ubuntu)` |
| 7080, 7443 | Coolify's Traefik (`coolify-proxy`) |
| 8010 | Coolify UI |

Coolify assumes *it* owns 80/443. Here it does not — nginx got there first and
also serves unrelated live customer sites (`mystylecarhire.com`,
`pos.murzaktech.tech`, the Frappe bench sites, …). So attaching a domain in
Coolify is necessary but **not sufficient**: Traefik will route the host
correctly on 7080/7443 while the public internet still never reaches it.

That was the whole bug. Traefik was healthy the entire time — it answered
`200` on 7443 for a real customer host — but nginx had no vhost for
`*.apps.murzaktech.tech`, so:

- `:80` fell through to the first `listen 80` block, which comes from
  `conf.d/frappe-bench.conf` (`conf.d/*` is included *before* `sites-enabled/*`),
  producing Frappe's `"<host> does not exist"` 404.
- `:443` fell through to the box's only `default_server`,
  `sites-enabled/mystylecarhire.com`, so probes got a `CN=mystylecarhire.com`
  certificate — a white-label leak as well as a break.

Because challenges never reached Traefik, its `acme.json` held **zero**
certificates.

## The design

nginx stays the public front door and owns TLS. Traefik keeps doing what it is
good at — per-app routing — behind it.

```
client ──► nginx :80  ──► /.well-known/acme-challenge/ ──► /var/www/certbot   (certbot answers)
                     └──► everything else ─────────────► Traefik :7080
client ──► nginx :443 ──► per-host vhost, LE cert ─────► Traefik :7443 (SNI = $host)
```

Pieces on the VPS:

| Path | Role |
|------|------|
| `/etc/nginx/conf.d/00-murzak-apps-map.conf` | websocket upgrade map; `00-` so it loads before its consumers |
| `/etc/nginx/sites-available/apps.murzaktech.tech` | wildcard vhost: `:80` ACME webroot + proxy to Traefik, `:443` catch-all |
| `/etc/nginx/snippets/murzak-app-proxy.conf` | shared `:443` proxy body, host-agnostic (`proxy_ssl_name $host`) |
| `/etc/nginx/sites-available/app-<fqdn>` | one per published app, generated |
| `/etc/ssl/murzak/apps-fallback.{crt,key}` | self-signed cert for the `:443` catch-all |
| `/usr/local/bin/murzak-app-vhost` | publish a host (cert + vhost + validate + reload) |
| `/usr/local/bin/murzak-app-vhost-remove` | unpublish a host |
| `/usr/local/bin/murzak-app-sync` | reconcile nginx against Traefik; publishes anything missing |
| `murzak-app-sync.{service,timer}` | runs the reconciler every 2 minutes |

### How a new app gets published

Nothing in the backend calls out to the box. `murzak-app-sync` reads the
Traefik router labels Coolify stamps on every container
(``Host(`<fqdn>`)``), diffs them against the `app-*` vhosts in
`sites-enabled/`, and publishes the difference.

That is deliberate. The host already holds the full truth, so this needs no
callback from the app, no SSH credential inside the app container, and has no
failure mode where a provisioning job succeeds but its publish step is lost.
It is also self-healing: it picks up apps created by *any* path — checkout
flow, GitHub wizard, or someone clicking around the Coolify UI — and
re-publishes anything that gets removed.

A new app is therefore reachable over `http://` immediately and over
`https://` within ~2 minutes, showing the catch-all's "not published yet"
404 in between rather than another tenant's certificate.

`--prune` also unpublishes vhosts whose app is gone; it is **not** on by
default, since a container being briefly absent (restart, redeploy) would
otherwise tear down a live customer's TLS.

### Why nginx owns ACME, not Traefik

nginx terminates TLS for these hosts, so *nginx* needs the certificate. The
`:80` vhost therefore serves `/.well-known/acme-challenge/` from a local
webroot instead of proxying it through. If challenges were proxied to Traefik,
Traefik would answer them and take the cert for itself, leaving nginx with
nothing to present. Only one of the two may own ACME for a given hostname.

Coolify still stamps `tls.certresolver=letsencrypt` on its routers, so Traefik
keeps attempting (and failing) its own issuance. That is harmless — failed
authorizations don't consume the certificate rate limit — but it is log noise.
See "Known gaps".

## Publishing a host

```bash
sudo /usr/local/bin/murzak-app-vhost my-shop.apps.murzaktech.tech
```

Idempotent. It obtains the certificate first (the vhost references the cert
paths, so writing the vhost first would fail `nginx -t`), writes the vhost,
runs `nginx -t`, and **rolls that host back if the test fails** rather than
leaving the box unable to reload. It refuses any hostname outside
`.apps.murzaktech.tech`, so a buggy or compromised caller cannot mint a vhost
or request a certificate for an unrelated domain on this shared box.

Teardown:

```bash
sudo /usr/local/bin/murzak-app-vhost-remove my-shop.apps.murzaktech.tech
```

## Gotchas worth remembering

- **`server_names_hash_bucket_size`.** Generated hostnames run ~64 characters
  (`user-26-08-12-0001-starter-app-hosting-3bb6.apps.murzaktech.tech` is exactly
  64), which overflows nginx's 64-byte default and makes *every* per-host vhost
  fail with `could not build server_names_hash`. Raised to `128` in
  `nginx.conf`. If hostnames ever get longer, raise it again.
- **Don't put the `map` in `sites-enabled/`.** The glob orders `app-<host>`
  before `apps.murzaktech.tech`, i.e. consumers before the definition. It lives
  in `conf.d/` with a `00-` prefix.
- **Never move nginx off 443 casually.** Six of the fourteen `listen 443` lines
  live in `conf.d/frappe-bench.conf`, which is a symlink to
  `~murzakerp/frappe-bench/config/nginx.conf` and is **regenerated by
  `bench setup nginx`**. Any hand edit there reverts silently and, if the
  replacement conflicts with another listener, nginx fails to start and takes
  every site on the box down with it. This is why the SNI-passthrough design
  (nginx `stream` + `ssl_preread` splitting 443) was rejected.
- Rollback: `/root/nginx-backup-pre-apps-vhost.tar.gz` is a full `/etc/nginx`
  snapshot from before this work.

## Certificate rate limiting

Let's Encrypt allows **50 new certificates per registered domain per week**.
Every app host counts against `murzaktech.tech`, shared with
`pos.`/`erp.`/`website.`/`matatuke.`. Renewals are exempt — only new names
count.

`murzak-app-vhost` counts certificates issued in the last 7 days (from each
live cert's `notBefore`, not file mtime, which renewals would skew) and
**refuses with exit 3** at `MURZAK_CERT_BUDGET` (default 45) rather than
spending a request it cannot afford. The reconciler treats exit 3 as
"deferred", not a crash, and retries on the next tick; the app stays reachable
over `http://` meanwhile.

If you are sustainably provisioning more than ~45 apps/week, the budget is not
the problem — the architecture is. The fix is the wildcard below.

## The DNS-01 wildcard

One certificate for `*.apps.murzaktech.tech` replaces all per-host certs and
vhosts. It removes the publish step entirely: a new app is reachable over
`https://` the moment Traefik routes it — no 2-minute wait, no rate limit, no
`murzak-app-sync`.

Hostinger hosts this zone (`nova.dns-parking.com`) and has no official certbot
DNS plugin, so `certbot-hostinger-dns` drives their API directly as a
`--manual-auth-hook`. Hooks are recorded in the renewal config, so this renews
unattended under the existing `certbot.timer` — non-negotiable, since a
wildcard expiring takes down every customer app at once where a per-host cert
takes down one, and this box already carries five expired certificates.

### API contract

Verified against [hostinger/api-php-sdk](https://github.com/hostinger/api-php-sdk/blob/main/docs/Api/DNSZoneApi.md):

```
PUT    /api/dns/v1/zones/{zone}
       {"overwrite":false,"zone":[{"name","type","ttl","records":[{"content"}]}]}
DELETE /api/dns/v1/zones/{zone}
       {"filters":[{"name","type"}]}
```

**`overwrite` must always be sent as `false`.** It *defaults to true*, and the
Hostinger docs describe its blast radius inconsistently — one page says it
replaces only records matching name+type, another says it replaces the supplied
zone wholesale. This zone carries `pos`/`erp`/`website`/`matatuke` and
`murzaktech.tech` itself, so the hook never relies on the default.

### Rollout

```bash
# 1. Token, root-only. Never paste it into a shell that logs history.
install -m600 -o root -g root /dev/null /etc/letsencrypt/hostinger.ini
printf 'HOSTINGER_API_TOKEN=%s\n' 'REDACTED' > /etc/letsencrypt/hostinger.ini

# 2. Prove the whole DNS path WITHOUT spending an ACME request.
install -m0755 -o root -g root /tmp/certbot-hostinger-dns /usr/local/bin/
certbot-hostinger-dns selftest

# 3. Only if selftest passes.
certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook    '/usr/local/bin/certbot-hostinger-dns auth' \
  --manual-cleanup-hook '/usr/local/bin/certbot-hostinger-dns cleanup' \
  -d '*.apps.murzaktech.tech' --cert-name apps-wildcard \
  --non-interactive --agree-tos

# 4. Enable the wildcard vhost, then verify a renewal actually works.
ln -sfn /etc/nginx/sites-available/apps-wildcard /etc/nginx/sites-enabled/apps-wildcard
nginx -t && systemctl reload nginx
certbot renew --cert-name apps-wildcard --dry-run
```

Only `-d '*.apps.murzaktech.tech'` is requested, deliberately — adding the bare
`apps.murzaktech.tech` puts two challenges on the same `_acme-challenge.apps`
TXT name, and the second can clobber the first.

Per-host vhosts carry an exact `server_name`, which nginx prefers over a
wildcard, so enabling the wildcard cannot disturb an already-published host.
Keep both until the wildcard has survived one real renewal, then retire
`murzak-app-sync`, its timer, and the per-host certs.

## Known gaps

1. **Frappe's generated config is a landmine.** See the `bench setup nginx`
   note above. Nothing here depends on it today, but any future work touching
   port 443 must account for it.
2. **Pre-existing expired certs**, untouched by this work:
   `murzaktech.com`, `llm.murzaktech.com`, `digipos.murzaktech.com`,
   `erp.murzaktech.com`, `testing.murzaktech.com`.
3. **Traefik still attempts its own ACME.** Coolify stamps
   `tls.certresolver=letsencrypt` on every router, and those challenges now hit
   nginx's local webroot and 404. Harmless — failed authorizations don't
   consume the certificate limit — but it is recurring noise in
   `docker logs coolify-proxy`.
