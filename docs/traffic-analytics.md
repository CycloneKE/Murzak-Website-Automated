# Traffic analytics (portal "Analytics" section)

The portal's **Analytics** section shows requests, unique visitors, bandwidth,
error rate, p95 latency, status codes, top paths, device types, browsers,
referrers and HTTP versions for a customer's own domains.

It is computed from the web proxy's **JSON access log**. Until the log is
connected, the section says "Traffic analytics aren't switched on yet". It never
shows zeros that could be mistaken for "no traffic".

## How it works

```
Traefik (Coolify proxy) --writes--> /data/coolify/proxy/access.log (JSON)
                                        |  copied each minute (cron, newest 8 MB)
                                        v  /data/coolify/proxy/logs/access.log
                                        |  mounted into the backend
                                        v
Backend  GET /api/portal/services/:serviceId/analytics?range=24h|7d|30d
   1. checks the caller owns the service
   2. reads the service's own domains from Coolify
   3. reads the tail of access.log (default last 16 MB)
   4. counts ONLY lines whose host exactly matches those domains
   5. caches the answer for 60 seconds per service and range
```

Tenant isolation is by exact hostname match, so one customer can never see
another customer's traffic on the shared proxy. Visitor addresses are used only
to count unique visitors in memory; they are never stored or returned.

## Switching it on

Coolify 4.5.x already writes a JSON access log of its own, so the proxy needs
**no change**. It writes `/data/coolify/proxy/access.log`, keeps the User-Agent,
Referer, X-Forwarded-For and Cf-* headers, and its `coolify-proxy-logrotate`
container trims the file at 20 MB and keeps five compressed copies.

Do not edit the proxy configuration for this. A malformed `command:` list can
stop the proxy and take every site down.

That folder also holds the Let's Encrypt certificate keys (`acme.json`), which
must never be visible to the backend. So a small job copies the newest part of
the log into a folder of its own, and only that folder is given to the backend.

1. **Create the copy folder** on the server:

   ```bash
   mkdir -p /data/coolify/proxy/logs
   ```

2. **Add the copy job.** Run this as one paste, from `tee` to the final `EOF`.
   The quotes around `'EOF'` matter: without them the shell treats each `*` as
   "all files in this folder" and runs something else entirely.

   ```bash
   tee /etc/cron.d/murzak-proxy-log > /dev/null <<'EOF'
   * * * * * root tail -c 8388608 /data/coolify/proxy/access.log > /data/coolify/proxy/logs/access.log.tmp && chmod 644 /data/coolify/proxy/logs/access.log.tmp && mv -f /data/coolify/proxy/logs/access.log.tmp /data/coolify/proxy/logs/access.log
   EOF
   ```

   Once a minute it copies the last 8 MB of the log into the new folder, and
   swaps the copy in whole so the backend never reads a half-written file. It
   keeps working through Coolify's rotation.

3. **Check it** (after a minute):

   ```bash
   systemctl is-active cron
   ls -l /data/coolify/proxy/logs/access.log
   ```

   The service should say `active` and the file should be `-rw-r--r--` with a
   size above 0. The backend runs as a non-root user and needs to read it.

4. **Give the backend the folder.** In Coolify open the backend app, Persistent
   Storage, add a directory mount: source `/data/coolify/proxy/logs`,
   destination `/var/log/traefik`. Under Environment Variables add:

   ```
   TRAEFIK_ACCESS_LOG_PATH=/var/log/traefik/access.log
   # optional, default 16777216 (16 MB). Only the newest bytes are read.
   TRAEFIK_ACCESS_LOG_MAX_BYTES=16777216
   ```

   Then redeploy. Environment changes do not reach a running container.

5. **Log the real visitor address** (needed for "Unique visitors"). In Coolify
   open Servers, your server, Proxy, Configuration. In the `command:` list, find
   the line for `Referer=keep` and add ONE new line directly under it, with the
   same indentation, the leading dash and the quotes:

   ```
         - '--accesslog.fields.headers.names.X-Real-Ip=keep'
   ```

   Every other line in that list looks the same, so copy the shape of the
   `Referer` line and change only the name. Do not paste anything else. Save and
   restart the proxy, which interrupts every site for a few seconds. Afterwards
   run `tail -n 1 /data/coolify/proxy/access.log` and confirm the new line has a
   `"request_X-Real-Ip"` entry, then open a few of your sites to check they load.
   If the proxy fails to start, delete the line and restart.

6. **Check it in the portal.** Open a customer service that has a domain,
   visit that domain a few times, then open Analytics and press Refresh.

If the path is set but the file can't be read, the section says "Traffic data is
temporarily unavailable" and the backend logs `ANALYTICS ERROR`.

## Known limits to check on the real server

- **Visitor addresses.** Confirmed on the real server: every logged request
  has `ClientHost` 10.0.1.1, the server's internal Docker address, because nginx
  sits in front of Traefik. Without the next step every service shows 1 unique
  visitor. nginx sends the real address in `X-Real-IP`, and the aggregation uses
  it once the proxy logs it.

- **Long ranges.** The copy holds the newest 8 MB and the log itself is trimmed
  at 20 MB. At low traffic that is days of history; at high traffic the 7 and 30
  day views will be partial, and the portal says so. Fixing that properly means
  storing daily totals.

## What is deliberately not there

- **Locations.** Country and city need a GeoIP database (MaxMind GeoLite2),
  which is not part of an access log. The panel says it isn't enabled. If one is
  added later, MaxMind's licence requires the attribution line, which the portal
  already shows whenever location rows exist.
- **Cache statuses.** Shown only if the proxy logs a cache status header
  (`X-Cache-Status` or `Cf-Cache-Status`). Otherwise "No data".

## Privacy note

Access logs contain visitor IP addresses. They stay on the proxy host and in the
backend's memory only, and customers see counts, not addresses. Mention
access-log retention in the privacy policy if it isn't already covered.

## Code

- `backend/services/analytics/trafficAggregate.js`: pure aggregation (tested)
- `backend/services/analytics/accessLogSource.js`: bounded tail reader
- `backend/test/trafficAnalytics.test.js`
- `frontend/src/components/portal/cloud/AnalyticsPanel.tsx`
- `frontend/e2e/portal-analytics-deployments.spec.ts`
