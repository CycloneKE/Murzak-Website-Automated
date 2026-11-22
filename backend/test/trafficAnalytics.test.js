/**
 * Traffic analytics: Traefik JSON access-log lines -> the portal's Analytics summary.
 * Pure aggregation + the bounded log-tail reader. node test/trafficAnalytics.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ok:", msg); } else { failed++; console.error("  FAIL:", msg); } }
function section(n) { console.log(`\n# ${n}`); }

const fs = require("fs");
const os = require("os");
const path = require("path");
const agg = require("../services/analytics/trafficAggregate");
const source = require("../services/analytics/accessLogSource");

const NOW = Date.parse("2026-11-22T18:30:00Z");
const MIN = 60 * 1000;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function line(over = {}) {
  return JSON.stringify({
    StartUTC: new Date(NOW - 10 * MIN).toISOString(),
    RequestHost: "health.murzaktech.tech",
    RequestPath: "/api/heartbeat",
    RequestProtocol: "HTTP/1.1",
    DownstreamStatus: 200,
    DownstreamContentSize: 100,
    Duration: 50e6,
    ClientHost: "10.0.0.1",
    "request_User-Agent": CHROME,
    ...over,
  });
}

section("parseLine");
{
  const r = agg.parseLine(line({ RequestPath: "/a?x=1&y=2", RequestHost: "Shop.Example.com:443" }));
  ok(r && r.path === "/a" && r.host === "shop.example.com", "query string stripped, host lower-cased and port removed");
  ok(r.ms === 50 && r.bytes === 100, "Duration nanoseconds become milliseconds");
  ok(agg.parseLine("not json") === null && agg.parseLine("") === null && agg.parseLine("{") === null, "garbage and blank lines are skipped, never thrown");
  ok(agg.parseLine(JSON.stringify({ RequestHost: "a.com" })) === null, "a line with no time or status is not an access entry");
}

section("tenant isolation: only the owner's hosts are counted");
{
  const lines = [
    line(), line(),
    line({ RequestHost: "other-customer.com" }),
    line({ RequestHost: "evil.health.murzaktech.tech" }),
    line({ RequestHost: "health.murzaktech.tech.evil.com" }),
  ];
  const a = agg.aggregate(lines, { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(a.totals.requests === 2, "other hosts, sub-domains and look-alike suffixes are excluded (exact match only)");
  ok(agg.aggregate(lines, { hosts: [], now: NOW }).totals.requests === 0, "no domains means no traffic is visible");
}

section("totals, error rate and latency");
{
  const lines = [];
  for (let i = 0; i < 90; i++) lines.push(line({ ClientHost: `10.0.0.${i % 3}`, Duration: (i + 1) * 1e6 }));
  for (let i = 0; i < 8; i++) lines.push(line({ DownstreamStatus: 404, RequestPath: "/missing" }));
  for (let i = 0; i < 2; i++) lines.push(line({ DownstreamStatus: 500, RequestPath: "/boom" }));
  const a = agg.aggregate(lines, { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(a.totals.requests === 100, "100 requests counted");
  ok(a.totals.uniqueVisitors === 3, "unique visitors are distinct client addresses");
  ok(Math.abs(a.totals.errorRate - 0.1) < 1e-9, "error rate is (4xx + 5xx) / requests");
  ok(a.totals.bandwidthBytes === 10000, "bandwidth sums response bytes");
  ok(a.statusClasses["2xx"] === 90 && a.statusClasses["4xx"] === 8 && a.statusClasses["5xx"] === 2, "status classes tallied");
  ok(a.totals.p95Ms === 85, "p95 uses nearest-rank over durations (95th of 100 values)");
  const missing = a.topPaths.find((p) => p.path === "/missing");
  ok(missing && missing.clientErrors === 8 && missing.serverErrors === 0 && missing.errorRate === 1, "per-path error counts and rate");
  ok(a.topPaths[0].path === "/api/heartbeat", "top paths sorted by request count");
  ok(a.statusCodes[0].name === "200" && a.statusCodes[0].requests === 90, "top status codes");
}

section("window and timeline");
{
  const old = line({ StartUTC: new Date(NOW - 3 * 24 * 3600 * 1000).toISOString() });
  const a = agg.aggregate([old, line()], { hosts: ["health.murzaktech.tech"], range: "24h", now: NOW });
  ok(a.totals.requests === 1, "a request older than the window is not counted");
  ok(agg.aggregate([old, line()], { hosts: ["health.murzaktech.tech"], range: "7d", now: NOW }).totals.requests === 2, "the 7 day range includes it");
  ok(a.timeline.length === 25 || a.timeline.length === 24, "24h range is hourly buckets");
  ok(a.timeline.reduce((n, b) => n + b.requests, 0) === 1, "every counted request lands in exactly one bucket");
  ok(agg.normalizeRange("bogus") === "24h", "an unknown range falls back to 24h");
  ok(a.partial === false, "a log reaching back past the window start is not partial");
  const recentOnly = agg.aggregate([line()], { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(recentOnly.partial === true, "a log that starts after the window opens is flagged partial");
  const otherHostOld = agg.aggregate([line({ RequestHost: "x.com", StartUTC: new Date(NOW - 30 * 3600 * 1000).toISOString() }), line()], { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(otherHostOld.partial === false, "coverage is judged on the whole log, so a quiet site isn't called partial");
}

section("breakdowns: device, browser, referrer, protocol, cache");
{
  const lines = [
    line({ "request_User-Agent": CHROME, request_Referer: "https://trading.murzaktech.tech/x" }),
    line({ "request_User-Agent": IPHONE }),
    line({ "request_User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
    line({ "request_User-Agent": "Mozilla/5.0 Firefox/120.0", RequestProtocol: "HTTP/2.0", "downstream_X-Cache-Status": "HIT" }),
  ];
  const a = agg.aggregate(lines, { hosts: ["health.murzaktech.tech"], now: NOW });
  const names = (xs) => xs.map((x) => x.name).sort().join(",");
  ok(names(a.devices) === "Bot,Desktop,Mobile", "devices classified from the user agent");
  ok(a.browsers.some((b) => b.name === "Chrome") && a.browsers.some((b) => b.name === "Firefox") && a.browsers.some((b) => b.name === "Safari"), "browsers classified");
  ok(a.referrers.length === 1 && a.referrers[0].name === "trading.murzaktech.tech", "referrers reduced to the host");
  ok(a.httpVersions.find((v) => v.name === "HTTP/2.0").requests === 1, "HTTP versions tallied");
  ok(a.cacheStatuses.length === 1 && a.cacheStatuses[0].name === "HIT", "cache status read only when the proxy logs it");
}

section("missing fields stay empty, never invented");
{
  const bare = JSON.stringify({ StartUTC: new Date(NOW - MIN).toISOString(), RequestHost: "health.murzaktech.tech", RequestPath: "/", DownstreamStatus: 200 });
  const a = agg.aggregate([bare], { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(a.totals.requests === 1, "the request still counts");
  ok(a.devices.length === 0 && a.browsers.length === 0 && a.referrers.length === 0 && a.cacheStatuses.length === 0 && a.httpVersions.length === 0, "no user agent, referrer, cache or protocol fields means empty panels");
  ok(Array.isArray(a.countries) && a.countries.length === 0, "locations stay empty without a GeoIP database");
  const none = agg.aggregate([], { hosts: ["health.murzaktech.tech"], now: NOW });
  ok(none.totals.requests === 0 && none.totals.errorRate === 0 && none.partial === false, "an empty log summarises to zeros without NaN");
}

section("accessLogSource: bounded tail read");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alog-"));
  const file = path.join(dir, "access.log");
  const rows = Array.from({ length: 200 }, (_, i) => line({ RequestPath: `/p${i}` }));
  fs.writeFileSync(file, rows.join("\n") + "\n");

  const all = (await source.readTailLines(file, 10 * 1024 * 1024)).filter(Boolean);
  ok(all.length === 200, "a small log is read whole");
  const size = fs.statSync(file).size;
  const tail = (await source.readTailLines(file, Math.floor(size / 2))).filter(Boolean);
  ok(tail.length > 0 && tail.length < 200, "a big log is read from the tail only");
  ok(tail.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), "the cut-off first line is dropped, so every line parses");
  ok(JSON.parse(tail[tail.length - 1]).RequestPath === "/p199", "the newest line is kept");
  let code = "";
  try { await source.readTailLines(path.join(dir, "nope.log"), 1024); } catch (e) { code = e.code; }
  ok(code === "ENOENT", "a missing log surfaces ENOENT (the route reports source_unavailable)");
  delete process.env.TRAEFIK_ACCESS_LOG_PATH;
  ok(source.isConfigured() === false, "unset TRAEFIK_ACCESS_LOG_PATH means not configured");
  process.env.TRAEFIK_ACCESS_LOG_PATH = file;
  ok(source.isConfigured() === true, "set path means configured");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})().catch((e) => { console.error(e); process.exit(1); });
