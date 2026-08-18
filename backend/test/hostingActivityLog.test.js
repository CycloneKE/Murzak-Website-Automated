/**
 * Tests for services/hostingActivityLog.js — Hosting Site lifecycle + its
 * activity log, extracted from server.js so they're importable without
 * booting Express.
 *   node test/hostingActivityLog.test.js   (or: npm test)
 *
 * Two failure modes this guards against, both of which shipped to
 * production undetected because MOCK_FRAPPE accepts any string for
 * event_type: (1) a hand-typed literal that isn't in the doctype's live
 * Select vocabulary — "site_initialized", "site_activated", and
 * "subdomain_requested" all 417'd every request that hit them — and (2) the
 * extracted functions silently emitting the wrong event_type after a future
 * edit. The static scans below cover every file that writes event_type, not
 * just the three functions extracted here.
 */
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  EVENT_TYPES,
  EVENT_TYPE_VALUES,
  createHostingActivityLog,
  findExistingHostingSiteByHost,
  ensurePendingHostingSiteForRequest,
  activateHostingSite,
} = require("../services/hostingActivityLog");

// Minimal mock frappe client: GET returns a queued fixture, POST/PUT capture
// exactly what was sent so tests can assert on the real event_type that
// would have gone over the wire.
function makeClient({ getResult = { data: { data: [] } } } = {}) {
  const gets = [];
  const posts = [];
  const puts = [];
  return {
    gets, posts, puts,
    get: async (url, opts) => { gets.push({ url, opts }); return getResult; },
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: { name: "HSITE-NEW-1", ...body } } }; },
    put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
  };
}

function walkJsFiles(dir, { exclude = [] } = {}) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkJsFiles(full, { exclude }));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

(async () => {
  section("EVENT_TYPES — the live Frappe Select vocabulary, exactly");
  ok(EVENT_TYPE_VALUES.length === 7, `has exactly 7 members (got ${EVENT_TYPE_VALUES.length})`);
  ok(
    [
      "domain_connected",
      "subdomain_created",
      "file_uploaded",
      "deployment_requested",
      "deployment_completed",
      "ssl_enabled",
      "support_request_opened",
    ].every((v) => EVENT_TYPE_VALUES.includes(v)),
    "contains exactly the 7 confirmed live values"
  );
  ok(Object.isFrozen(EVENT_TYPES), "EVENT_TYPES is frozen (can't be mutated at runtime)");

  section("static scan — no raw event_type/eventType string literal in backend production code escapes EVENT_TYPES");
  {
    const backendRoot = path.join(__dirname, "..");
    const files = walkJsFiles(backendRoot, { exclude: ["node_modules", "test", ".git"] });
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const pattern = /\b(?:event_type|eventType)\s*:\s*(["'])((?:(?!\1).)*)\1/g;
      let m;
      while ((m = pattern.exec(src))) {
        const value = m[2];
        if (!EVENT_TYPE_VALUES.includes(value)) {
          offenders.push(`${path.relative(backendRoot, file)}: "${value}"`);
        }
      }
    }
    ok(
      offenders.length === 0,
      offenders.length
        ? `found event_type literals not in EVENT_TYPES: ${offenders.join(", ")}`
        : "every raw event_type/eventType literal in backend production code is a member of EVENT_TYPES"
    );
  }

  section("static scan — every EVENT_TYPES.<KEY> reference in backend production code resolves to a real member");
  {
    const backendRoot = path.join(__dirname, "..");
    const files = walkJsFiles(backendRoot, { exclude: ["node_modules", "test", ".git"] });
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Matches both `EVENT_TYPES.KEY` and any local alias (e.g.
      // `HOSTING_EVENT_TYPES.KEY` in routes/hostingRoutes.js).
      const pattern = /(?:\bEVENT_TYPES|\bHOSTING_EVENT_TYPES)\.([A-Z_]+)\b/g;
      let m;
      while ((m = pattern.exec(src))) {
        const key = m[1];
        if (!(key in EVENT_TYPES)) {
          offenders.push(`${path.relative(backendRoot, file)}: EVENT_TYPES.${key}`);
        }
      }
    }
    ok(
      offenders.length === 0,
      offenders.length
        ? `found dangling EVENT_TYPES key references: ${offenders.join(", ")}`
        : "every EVENT_TYPES.<KEY> reference resolves to a real member"
    );
  }

  section("createHostingActivityLog");
  {
    const client = makeClient();
    const result = await createHostingActivityLog(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      hostingSiteName: "HSITE-1",
      eventType: EVENT_TYPES.SSL_ENABLED,
      title: "SSL enabled",
      description: "desc",
    });
    ok(client.posts.length === 1, "posts once");
    ok(client.posts[0].url === "/api/resource/Hosting Activity Log", "posts to the activity log doctype");
    ok(client.posts[0].body.event_type === "ssl_enabled", "sends the given event_type verbatim");
    ok(client.posts[0].body.web_account === "ACC-1", "sends web_account");
    ok(client.posts[0].body.service_id === "biz-web-hosting", "sends service_id");
    ok(result != null, "returns the post response");
  }
  {
    const client = makeClient();
    const result = await createHostingActivityLog(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      hostingSiteName: "",
      eventType: EVENT_TYPES.SSL_ENABLED,
      title: "SSL enabled",
    });
    ok(result === null, "returns null and does not post without a hostingSiteName");
    ok(client.posts.length === 0, "no post issued");
  }

  section("findExistingHostingSiteByHost");
  {
    const client = makeClient({
      getResult: { data: { data: [{ name: "HSITE-1", primary_host: "shop.example.com" }] } },
    });
    const site = await findExistingHostingSiteByHost(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      primaryHost: "shop.example.com",
    });
    ok(site?.name === "HSITE-1", "returns the first matching row");
    ok(client.gets[0].url === "/api/resource/Hosting Site", "queries the Hosting Site doctype");
    const filters = client.gets[0].opts.params.filters;
    ok(filters.includes("biz-web-hosting") && filters.includes("shop.example.com"), "filters by service_id and primary_host");
  }
  {
    const client = makeClient({ getResult: { data: { data: [] } } });
    const site = await findExistingHostingSiteByHost(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      primaryHost: "nowhere.example.com",
    });
    ok(site === null, "returns null when nothing matches");
  }

  section("ensurePendingHostingSiteForRequest — new site logs deployment_requested, not a hand-typed literal");
  {
    const client = makeClient({ getResult: { data: { data: [] } } }); // no existing site
    const result = await ensurePendingHostingSiteForRequest(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      siteType: "domain",
      primaryHost: "shop.example.com",
      serviceTier: "Starter",
      planName: "Website Hosting",
      customerDomainId: "CDOM-1",
      getStorageAllocationMb: () => 1024,
    });
    const siteCreatePost = client.posts.find((p) => p.url === "/api/resource/Hosting Site");
    ok(!!siteCreatePost, "creates a Hosting Site");
    ok(siteCreatePost.body.storage_limit_mb === 1024, "uses the injected storage allocation");
    const logPost = client.posts.find((p) => p.url === "/api/resource/Hosting Activity Log");
    ok(!!logPost, "logs activity for the new site");
    ok(
      logPost.body.event_type === EVENT_TYPES.DEPLOYMENT_REQUESTED,
      `logs deployment_requested (got "${logPost && logPost.body.event_type}")`
    );
    ok(logPost.body.event_type !== "site_initialized", "does not regress to the invalid site_initialized literal that 417'd in production");
    ok(EVENT_TYPE_VALUES.includes(logPost.body.event_type), "the logged event_type is a member of EVENT_TYPES");
    ok(result != null, "returns the created site");
  }

  section("ensurePendingHostingSiteForRequest — existing site is returned and backfilled, no duplicate created");
  {
    const client = makeClient({
      getResult: { data: { data: [{ name: "HSITE-1", primary_host: "shop.example.com", customer_domain: "" }] } },
    });
    const result = await ensurePendingHostingSiteForRequest(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      siteType: "domain",
      primaryHost: "shop.example.com",
      customerDomainId: "CDOM-1",
      getStorageAllocationMb: () => 1024,
    });
    ok(result?.name === "HSITE-1", "returns the existing site");
    ok(client.posts.length === 0, "does not create a second Hosting Site");
    ok(client.puts.length === 1, "backfills the customer_domain link");
    ok(client.puts[0].body.customer_domain === "CDOM-1", "backfill PUT carries the new customer_domain");
  }

  section("ensurePendingHostingSiteForRequest — existing site with an already-linked domain is not re-PUT");
  {
    const client = makeClient({
      getResult: { data: { data: [{ name: "HSITE-1", primary_host: "shop.example.com", customer_domain: "CDOM-EXISTING" }] } },
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      siteType: "domain",
      primaryHost: "shop.example.com",
      customerDomainId: "CDOM-1",
      getStorageAllocationMb: () => 1024,
    });
    ok(client.puts.length === 0, "does not overwrite an already-linked customer_domain");
  }

  section("activateHostingSite — logs deployment_completed, not a hand-typed literal");
  {
    const client = makeClient();
    const result = await activateHostingSite(client, {
      webAccountName: "ACC-1",
      serviceId: "biz-web-hosting",
      hostingSiteName: "HSITE-1",
      primaryHost: "Shop.Example.com",
      documentRoot: "/var/www/shop",
    });
    ok(result === true, "returns true");
    const putCall = client.puts.find((p) => p.url === "/api/resource/Hosting Site/HSITE-1");
    ok(!!putCall, "PUTs the Hosting Site");
    ok(putCall.body.status === "active", "sets status active");
    ok(putCall.body.primary_host === "shop.example.com", "lowercases the primary host");
    const logPost = client.posts.find((p) => p.url === "/api/resource/Hosting Activity Log");
    ok(!!logPost, "logs activity");
    ok(
      logPost.body.event_type === EVENT_TYPES.DEPLOYMENT_COMPLETED,
      `logs deployment_completed (got "${logPost && logPost.body.event_type}")`
    );
    ok(logPost.body.event_type !== "site_activated", "does not regress to the invalid site_activated literal that 417'd in production");
    ok(EVENT_TYPE_VALUES.includes(logPost.body.event_type), "the logged event_type is a member of EVENT_TYPES");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:\n" + fails.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
})();
