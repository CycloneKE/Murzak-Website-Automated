# Traffic analytics (portal "Analytics" section)

The portal's **Analytics** section shows requests, unique visitors, bandwidth,
error rate, p95 latency, status codes, top paths, device types, browsers,
referrers and HTTP versions for a customer's own domains.

It is computed from the web proxy's **JSON access log**. Until the log is
connected, the section says "Traffic analytics aren't switched on yet". It never
shows zeros that could be mistaken for "no traffic".

## How it works

```
Traefik (Coolify proxy) --writes--> access.log (JSON, on the host)
                                        |  mounted read-only
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

These steps change the production proxy and the backend app. Do them on the
box, one at a time, and check each before moving on. Restarting the proxy
interrupts every site for a few seconds, so pick a quiet moment.

1. **Create a folder just for the log** (on the server, over SSH):

   ```bash
   sudo mkdir -p /data/coolify/proxy/logs
   ```

   Use a separate folder on purpose. `/data/coolify/proxy` also holds the
   Let's Encrypt certificate keys (`acme.json`), which must never be visible to
   the backend. Confirm the folder mapping first; the line for the proxy folder
   should read `/data/coolify/proxy -> /traefik`:

   ```bash
   docker inspect coolify-proxy --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
   ```

2. **Turn on JSON access logging in Traefik.** In Coolify open Servers, your
   server, Proxy, Configuration. Add these lines to the proxy `command:` list,
   save, then restart the proxy:

   ```
   --accesslog=true
   --accesslog.format=json
   --accesslog.filepath=/traefik/logs/access.log
   --accesslog.fields.headers.names.User-Agent=keep
   --accesslog.fields.headers.names.Referer=keep
   --accesslog.fields.headers.names.X-Real-Ip=keep
   --accesslog.fields.headers.names.X-Forwarded-For=keep
   ```

   The User-Agent and Referer lines are optional. Without them the Browsers,
   Operating systems, AI agents, Device type and Referrers panels stay empty.

3. **Check the log is being written:**

   ```bash
   ls -l /data/coolify/proxy/logs/access.log
   tail -n 2 /data/coolify/proxy/logs/access.log
   ```

   The file must be readable by everyone (`-rw-r--r--`), because the backend
   runs as a non-root user.

4. **Rotate the log.** Traefik never trims its own log. Create
   `/etc/logrotate.d/traefik-access` containing:

   ```
   /data/coolify/proxy/logs/access.log {
     weekly
     rotate 4
     compress
     missingok
     notifempty
     copytruncate
   }
   ```

   `copytruncate` empties the file in place, so Traefik needs no restart and
   the backend's view of the file stays valid.

5. **Give the backend the folder.** In Coolify open the backend app, Persistent
   Storage, add a directory mount: source `/data/coolify/proxy/logs`,
   destination `/var/log/traefik`. Under Environment Variables add:

   ```
   TRAEFIK_ACCESS_LOG_PATH=/var/log/traefik/access.log
   # optional, default 16777216 (16 MB). Only the newest bytes are read.
   TRAEFIK_ACCESS_LOG_MAX_BYTES=16777216
   ```

   Then redeploy. Environment changes do not reach a running container.

6. **Check it in the portal.** Open a customer service that has a domain,
   visit that domain a few times, then open Analytics and press Refresh.

If the path is set but the file can't be read, the section says "Traffic data is
temporarily unavailable" and the backend logs `ANALYTICS ERROR`.

## Known limits to check on the real server

- **Visitor addresses.** nginx sits in front of Traefik, so Traefik's own
  `ClientHost` is probably nginx's address, not the visitor's. Until the log is
  checked, "Unique visitors" may read as 1 or 2. Look at one log line: if
  `request_X-Real-Ip` (set by nginx from the real visitor address) is present,
  the aggregation should use it. Confirm the field name on the server before
  changing the code.
- **Long ranges.** Only the newest 16 MB of the log is read, and the log
  rotates weekly. The 7 and 30 day views will often be partial; the portal says
  so when that happens. Fixing that properly means storing daily totals.

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
