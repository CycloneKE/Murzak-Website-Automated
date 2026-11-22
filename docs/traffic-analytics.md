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

These steps change the production proxy and the backend container. Do them on
the box, and verify each one before moving on.

1. **Turn on JSON access logging in Traefik.** In Coolify, open the server's
   proxy configuration and add these flags to the proxy `command:` list, then
   restart the proxy:

   ```
   --accesslog=true
   --accesslog.format=json
   --accesslog.filepath=/traefik/access.log
   --accesslog.fields.headers.names.User-Agent=keep
   --accesslog.fields.headers.names.Referer=keep
   ```

   The last two are optional. Without them the Browsers, Device type and
   Referrers panels stay empty ("No data").

2. **Rotate the log.** Traefik does not rotate its own log. Add a `logrotate`
   rule for `/data/coolify/proxy/access.log` (weekly, keep 4, compress), or the
   file will grow without limit.

3. **Mount the log into the backend container**, read-only, and point the
   backend at it:

   ```
   volumes:
     - /data/coolify/proxy/access.log:/var/log/traefik/access.log:ro
   environment:
     TRAEFIK_ACCESS_LOG_PATH: /var/log/traefik/access.log
     # optional, default 16777216 (16 MB). Only the newest bytes are read.
     TRAEFIK_ACCESS_LOG_MAX_BYTES: "16777216"
   ```

4. **Check it.** Open a customer service in the portal, then Analytics. If the
   log only reaches back part of the chosen range, a notice says so.

If the path is set but the file can't be read, the section says "Traffic data is
temporarily unavailable" and the backend logs `ANALYTICS ERROR`.

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
