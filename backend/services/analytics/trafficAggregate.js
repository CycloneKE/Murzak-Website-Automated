"use strict";
/**
 * Traffic analytics from Traefik JSON access-log lines.
 *
 * Pure: lines in, a normalized summary out. No file or network access, so it is
 * fully unit-tested (test/trafficAnalytics.test.js).
 *
 * Input format is Traefik's documented JSON access log (`accessLog.format:
 * json`). Fields read: StartUTC/time, RequestHost, RequestPath, RequestProtocol,
 * DownstreamStatus, DownstreamContentSize, Duration (nanoseconds), ClientHost.
 * Two optional fields only exist when Traefik is told to keep those headers
 * (`accessLog.fields.headers.names`): `request_User-Agent` and `request_Referer`.
 * A panel whose field is absent comes back as an empty list, never a guess.
 *
 * TENANT ISOLATION: a line counts only when its RequestHost exactly equals one
 * of the `hosts` the caller passes (the service owner's own domains). Nothing
 * else on the shared proxy is ever visible to a customer.
 */

const RANGES = {
  "24h": { windowMs: 24 * 3600 * 1000, bucketMs: 3600 * 1000 },
  "7d": { windowMs: 7 * 24 * 3600 * 1000, bucketMs: 6 * 3600 * 1000 },
  "30d": { windowMs: 30 * 24 * 3600 * 1000, bucketMs: 24 * 3600 * 1000 },
};
const DEFAULT_RANGE = "24h";
const TOP_N = 20;

function normalizeRange(range) {
  return RANGES[range] ? range : DEFAULT_RANGE;
}

/** "Shop.Example.com:443" -> "shop.example.com". */
function cleanHost(h) {
  return String(h || "").trim().toLowerCase().replace(/:\d+$/, "");
}

/** One log line to a plain record, or null when it isn't a usable access entry. */
function parseLine(line) {
  const s = String(line || "").trim();
  if (!s || s[0] !== "{") return null;
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return null;
  }
  const ts = Date.parse(o.StartUTC || o.time || "");
  const status = Number(o.DownstreamStatus ?? o.OriginStatus);
  const host = cleanHost(o.RequestHost);
  if (!Number.isFinite(ts) || !Number.isFinite(status) || !host) return null;
  const rawPath = String(o.RequestPath || "/");
  return {
    ts,
    host,
    path: rawPath.split("?")[0] || "/",
    status,
    bytes: Math.max(0, Number(o.DownstreamContentSize) || 0),
    ms: Math.max(0, (Number(o.Duration) || 0) / 1e6),
    protocol: String(o.RequestProtocol || "").trim(),
    client: String(o.ClientHost || "").trim(),
    ua: String(o["request_User-Agent"] || ""),
    referer: String(o.request_Referer || ""),
    cache: String(o["downstream_X-Cache-Status"] || o["downstream_Cf-Cache-Status"] || "").trim(),
  };
}

/** Nearest-rank percentile of a numeric array (mutates order). 0 for empty. */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

function classifyBrowser(ua) {
  if (!ua) return null;
  if (/bot|crawl|spider|slurp|curl|wget|python-requests|go-http-client|uptime|monitor/i.test(ua)) return "Bot";
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

function classifyDevice(ua) {
  if (!ua) return null;
  if (/bot|crawl|spider|slurp|curl|wget|python-requests|go-http-client|uptime|monitor/i.test(ua)) return "Bot";
  if (/mobi|android|iphone|ipad|ipod/i.test(ua)) return "Mobile";
  if (/mozilla|windows|macintosh|linux|x11|cros/i.test(ua)) return "Desktop";
  return "Misc";
}

function referrerHost(ref) {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

function tally(map, key, bytes) {
  if (!key) return;
  const e = map.get(key) || { name: key, requests: 0, bytes: 0 };
  e.requests += 1;
  e.bytes += bytes;
  map.set(key, e);
}

function top(map, n = TOP_N) {
  return [...map.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)).slice(0, n);
}

const statusClass = (s) => (s >= 200 && s < 300 ? "2xx" : s >= 300 && s < 400 ? "3xx" : s >= 400 && s < 500 ? "4xx" : s >= 500 && s < 600 ? "5xx" : "other");

/**
 * @param {Iterable<string>} lines  Raw access-log lines.
 * @param {{hosts: string[], range?: string, now?: number}} opts
 */
function aggregate(lines, { hosts, range, now = Date.now() }) {
  const key = normalizeRange(range);
  const { windowMs, bucketMs } = RANGES[key];
  const owned = new Set((hosts || []).map(cleanHost).filter(Boolean));
  const to = now;
  const from = to - windowMs;
  // Buckets are aligned to the bucket size so a refresh doesn't shift the axis.
  const firstBucket = Math.floor(from / bucketMs) * bucketMs;
  const bucketCount = Math.floor(to / bucketMs) - Math.floor(from / bucketMs) + 1;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    t: firstBucket + i * bucketMs, requests: 0, bytes: 0, errors: 0, clients: new Set(), ms: [],
  }));

  const classes = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  const statusCodes = new Map();
  const paths = new Map();
  const devices = new Map();
  const browsers = new Map();
  const referrers = new Map();
  const versions = new Map();
  const caches = new Map();
  const clients = new Set();
  const allMs = [];
  let requests = 0;
  let bytes = 0;
  let errors = 0;
  let earliest = Infinity;

  for (const line of lines) {
    const r = parseLine(line);
    if (!r) continue;
    // Coverage is judged on the whole log, any host, so a quiet site isn't
    // mistaken for a short log. Only this one timestamp leaves the loop.
    if (r.ts < earliest) earliest = r.ts;
    if (!owned.has(r.host)) continue;
    if (r.ts < from || r.ts > to) continue;

    requests += 1;
    bytes += r.bytes;
    allMs.push(r.ms);
    const isErr = r.status >= 400 && r.status < 600;
    if (isErr) errors += 1;
    classes[statusClass(r.status)] += 1;
    if (r.client) clients.add(r.client);

    const b = buckets[Math.min(buckets.length - 1, Math.max(0, Math.floor((r.ts - firstBucket) / bucketMs)))];
    b.requests += 1;
    b.bytes += r.bytes;
    if (isErr) b.errors += 1;
    if (r.client) b.clients.add(r.client);
    b.ms.push(r.ms);

    tally(statusCodes, String(r.status), r.bytes);
    tally(versions, r.protocol, r.bytes);
    tally(caches, r.cache, r.bytes);
    tally(devices, classifyDevice(r.ua), r.bytes);
    tally(browsers, classifyBrowser(r.ua), r.bytes);
    tally(referrers, referrerHost(r.referer), r.bytes);

    const pk = `${r.host}\u0000${r.path}`;
    const p = paths.get(pk) || { path: r.path, host: r.host, requests: 0, clientErrors: 0, serverErrors: 0, bytes: 0, ms: [] };
    p.requests += 1;
    p.bytes += r.bytes;
    if (r.status >= 400 && r.status < 500) p.clientErrors += 1;
    if (r.status >= 500 && r.status < 600) p.serverErrors += 1;
    p.ms.push(r.ms);
    paths.set(pk, p);
  }

  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    range: key,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    // True when the log we were given starts after the window opens, so the
    // numbers cover less than the full range and the UI says so.
    partial: Number.isFinite(earliest) ? earliest > from : false,
    totals: {
      requests,
      uniqueVisitors: clients.size,
      bandwidthBytes: bytes,
      errorRate: requests ? errors / requests : 0,
      p95Ms: round1(percentile(allMs, 95)),
    },
    timeline: buckets.map((b) => ({
      t: new Date(b.t).toISOString(),
      requests: b.requests,
      visitors: b.clients.size,
      bytes: b.bytes,
      errorRate: b.requests ? b.errors / b.requests : 0,
      p95Ms: round1(percentile(b.ms, 95)),
    })),
    statusClasses: classes,
    statusCodes: top(statusCodes),
    topPaths: [...paths.values()]
      .sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))
      .slice(0, TOP_N)
      .map(({ ms, ...p }) => ({
        ...p,
        errorRate: p.requests ? (p.clientErrors + p.serverErrors) / p.requests : 0,
        p95Ms: round1(percentile(ms, 95)),
      })),
    devices: top(devices),
    browsers: top(browsers),
    referrers: top(referrers),
    httpVersions: top(versions),
    cacheStatuses: top(caches),
    // Needs a GeoIP database; not part of access logs. Left empty, never guessed.
    countries: [],
  };
}

module.exports = { aggregate, parseLine, percentile, normalizeRange, cleanHost, classifyBrowser, classifyDevice, RANGES, DEFAULT_RANGE };
