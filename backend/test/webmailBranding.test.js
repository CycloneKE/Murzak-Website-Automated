/**
 * Webmail (Bulwark) branding queue: buildBranding, loadActiveClients and the
 * locked, merged single-restart enqueueDomain. Everything external is injected.
 *   node test/webmailBranding.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

// Deterministic: the queue must not depend on a real BULWARK_* config.
delete process.env.BULWARK_SERVICE_UUID;
delete process.env.BULWARK_APP_UUID;
delete process.env.BULWARK_MERGE_MS;

const mod = require("../services/email/webmailBranding");
const { buildBranding, loadActiveClients, enqueueDomain, mergeWindowMs } = mod;
const { ORDER_DOCTYPE } = require("../services/checkout/orderStore");

const SERVICE = "svc-bulwark-uuid";
const BRANDING_KEY = "DOMAIN_BRANDING";

/** Fake clock + sleep: sleeping advances the clock, so no real waiting. */
function fakeTime() {
  let now = 1_000_000;
  const sleeps = [];
  return {
    clock: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    sleeps,
  };
}

/** Fake Coolify: an in-memory env list plus call recorders. */
function fakeCoolify(initialEnvs = []) {
  const state = {
    envs: initialEnvs.map((e, i) => ({ uuid: `env-${i}`, key: e.key, value: e.value })),
    created: [],
    updated: [],
    restarts: 0,
    addressWrites: [],
  };
  return {
    state,
    coolify: {
      async listEnvs(uuid) {
        if (uuid !== SERVICE) throw new Error("wrong uuid");
        return state.envs.map((e) => ({ ...e }));
      },
      async createEnv(uuid, { key, value }) {
        state.created.push(key);
        state.envs.push({ uuid: `env-${state.envs.length}`, key, value });
      },
      async updateEnv(uuid, { key, value }) {
        state.updated.push(key);
        const row = state.envs.find((e) => e.key === key);
        row.value = value;
      },
      async restart(uuid) {
        state.restarts++;
        return { ok: true };
      },
    },
    setBulwarkAddresses: async (uuid, addresses) => { state.addressWrites.push(addresses); },
  };
}

/** Fake fetch: first `failures` calls throw (cert not ready), then 200. */
function fakeFetch({ failures = 0, always = false } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (always || calls.length <= failures) throw new Error("TLS handshake failed");
    return { status: 200 };
  };
  return { fetch, calls };
}

/** Fake Frappe client for the Checkout Order doctype. */
function fakeFrappe(rows) {
  const calls = [];
  return {
    calls,
    async get(path, opts) {
      calls.push({ path, opts });
      if (path !== `/api/resource/${ORDER_DOCTYPE}`) throw new Error("unexpected path " + path);
      return { data: { data: rows } };
    },
  };
}

function order(name, mailSetup, extra = {}) {
  return { name, status: "Paid", config_json: JSON.stringify({ mailSetup, ...extra }) };
}

/** Builds deps for enqueueDomain; `activeClients` is what loadActiveClients returns. */
function makeDeps({ envs = [], activeClients = [], fetchOpts, extra = {} } = {}) {
  const t = fakeTime();
  const cool = fakeCoolify(envs);
  const f = fakeFetch(fetchOpts);
  const deps = {
    coolify: cool.coolify,
    setBulwarkAddresses: cool.setBulwarkAddresses,
    loadActiveClients: async () => activeClients.map((c) => ({ ...c })),
    fetch: f.fetch,
    clock: t.clock,
    sleep: t.sleep,
    serviceUuid: SERVICE,
    mergeMs: 20000,
    pollIntervalMs: 15000,
    ...extra,
  };
  return { deps, cool, fetchCalls: f.calls, sleeps: t.sleeps };
}

const storedBranding = (clients) => JSON.stringify(clients.map((c) => ({ domain: c.domain, title: c.title })));

(async () => {
  section("buildBranding: addresses and branding for two clients");
  {
    const b = buildBranding([
      { domain: "beta.co.ke", title: "Beta Ltd", logoUrl: "https://beta.co.ke/logo.png" },
      { domain: "alpha.co.ke", title: "Alpha Ltd" },
    ]);
    ok(b.addresses === "webmail.alpha.co.ke,webmail.beta.co.ke", "addresses are webmail.<domain>, sorted by domain");
    const parsed = JSON.parse(b.brandingJson);
    ok(Array.isArray(parsed) && parsed.length === 2, "brandingJson holds both clients");
    ok(parsed.some((c) => c.domain === "beta.co.ke" && c.title === "Beta Ltd" && c.logoUrl), "brandingJson keeps title and logoUrl");
    ok(!parsed.some((c) => c.logoUrl === undefined && "logoUrl" in c), "absent logoUrl is omitted, not null");
  }

  section("buildBranding: stable regardless of input order, deduped");
  {
    const a = buildBranding([{ domain: "a.co.ke", title: "A" }, { domain: "b.co.ke", title: "B" }]);
    const r = buildBranding([{ domain: "b.co.ke", title: "B" }, { domain: "a.co.ke", title: "A" }]);
    ok(a.addresses === r.addresses && a.brandingJson === r.brandingJson, "reversed input gives identical output");
    const d = buildBranding([{ domain: "a.co.ke", title: "A" }, { domain: "A.co.ke", title: "A again" }]);
    ok(d.addresses === "webmail.a.co.ke", "same domain (case-insensitive) appears once");
    ok(JSON.parse(d.brandingJson).length === 1, "branding has one entry per domain");
  }

  section("buildBranding: empty list");
  {
    const e = buildBranding([]);
    ok(e.addresses === "" && e.brandingJson === "[]", "no clients gives empty addresses and []");
  }

  section("mergeWindowMs defaults to 20 seconds");
  ok(mergeWindowMs() === 20000, "BULWARK_MERGE_MS unset gives 20000");

  section("loadActiveClients: only provisioned, live and active mail setups");
  {
    const frappe = fakeFrappe([
      order("O-1", { state: "provisioned", domain: "one.co.ke", businessName: "One" }),
      order("O-2", { state: "live", domain: "two.co.ke", businessName: "Two", logoUrl: "https://two.co.ke/l.png" }),
      order("O-3", { state: "active", domain: "three.co.ke", businessName: "Three" }),
      order("O-4", { state: "paid", domain: "four.co.ke", businessName: "Four" }),
      order("O-5", { state: "awaiting_payment", domain: "five.co.ke", businessName: "Five" }),
      { name: "O-6", status: "Paid", config_json: "{not json" },
      { name: "O-7", status: "Paid", config_json: JSON.stringify({ noMailSetup: true }) },
    ]);
    const active = await loadActiveClients(frappe);
    const domains = active.map((c) => c.domain).sort();
    ok(JSON.stringify(domains) === JSON.stringify(["one.co.ke", "three.co.ke", "two.co.ke"]), "returns provisioned, live and active only");
    const two = active.find((c) => c.domain === "two.co.ke");
    ok(two && two.title === "Two" && two.logoUrl === "https://two.co.ke/l.png", "carries title and logoUrl");
    const one = active.find((c) => c.domain === "one.co.ke");
    ok(one && one.logoUrl === undefined, "no logoUrl stays absent");
    ok(frappe.calls[0]?.path === `/api/resource/${ORDER_DOCTYPE}`, "reads the Checkout Order doctype");
  }

  section("enqueueDomain: concurrent A and B make exactly one restart");
  {
    const pre = { domain: "pre.co.ke", title: "Pre" };
    const { deps, cool } = makeDeps({
      envs: [{ key: BRANDING_KEY, value: storedBranding([pre]) }],
      activeClients: [pre],
    });
    const [ra, rb] = await Promise.all([
      enqueueDomain(null, { domain: "a.co.ke", title: "A" }, deps),
      enqueueDomain(null, { domain: "b.co.ke", title: "B" }, deps),
    ]);
    ok(cool.state.restarts === 1, "one restart for two concurrent orders");
    ok(ra.restarted === true && rb.restarted === true, "both callers report restarted");
    const written = cool.state.envs.find((e) => e.key === BRANDING_KEY).value;
    ok(written.includes("a.co.ke") && written.includes("b.co.ke") && written.includes("pre.co.ke"), "written branding has A, B and the pre-existing client");
    const addr = cool.state.addressWrites;
    ok(addr.length === 1 && addr[0].includes("webmail.a.co.ke") && addr[0].includes("webmail.b.co.ke") && addr[0].includes("webmail.pre.co.ke"), "address list written once, complete");
  }

  section("enqueueDomain: refuses to shrink when loadActiveClients returns [] but env has entries");
  {
    const stored = [{ domain: "keep.co.ke", title: "Keep" }, { domain: "also.co.ke", title: "Also" }];
    const { deps, cool } = makeDeps({
      envs: [{ key: BRANDING_KEY, value: storedBranding(stored) }],
      activeClients: [],
    });
    let err = null;
    try { await enqueueDomain(null, { domain: "new.co.ke", title: "New" }, deps); } catch (e) { err = e; }
    ok(err && /refusing to shrink branding/.test(err.message), "rejects with 'refusing to shrink branding'");
    ok(cool.state.restarts === 0 && cool.state.addressWrites.length === 0, "no restart and no address write");
    ok(cool.state.created.length === 0 && cool.state.updated.length === 0, "no env write");
  }

  section("enqueueDomain: refuses when the resulting list is shorter than stored");
  {
    const stored = [{ domain: "a.co.ke", title: "A" }, { domain: "b.co.ke", title: "B" }, { domain: "c.co.ke", title: "C" }];
    const { deps, cool } = makeDeps({
      envs: [{ key: BRANDING_KEY, value: storedBranding(stored) }],
      activeClients: [{ domain: "a.co.ke", title: "A" }],
    });
    let err = null;
    try { await enqueueDomain(null, { domain: "d.co.ke", title: "D" }, deps); } catch (e) { err = e; }
    ok(err && /refusing to shrink branding/.test(err.message), "shorter list is refused");
    ok(cool.state.restarts === 0 && cool.state.addressWrites.length === 0 && cool.state.updated.length === 0 && cool.state.created.length === 0, "nothing written");
  }

  section("enqueueDomain: refuses when a stored domain would be dropped");
  {
    const stored = [{ domain: "a.co.ke", title: "A" }, { domain: "b.co.ke", title: "B" }];
    const { deps, cool } = makeDeps({
      envs: [{ key: BRANDING_KEY, value: storedBranding(stored) }],
      activeClients: [{ domain: "a.co.ke", title: "A" }],
    });
    let err = null;
    try { await enqueueDomain(null, { domain: "c.co.ke", title: "C" }, deps); } catch (e) { err = e; }
    ok(err && /refusing to shrink branding/.test(err.message), "same-length swap that drops B is refused");
    ok(cool.state.restarts === 0, "no restart");
  }

  section("enqueueDomain: unreadable stored branding is never overwritten");
  {
    const { deps, cool } = makeDeps({
      envs: [{ key: BRANDING_KEY, value: "{not json" }],
      activeClients: [],
    });
    let err = null;
    try { await enqueueDomain(null, { domain: "x.co.ke", title: "X" }, deps); } catch (e) { err = e; }
    ok(err && /refusing to shrink branding/.test(err.message), "unparseable stored value is refused");
    ok(cool.state.restarts === 0 && cool.state.updated.length === 0, "nothing written");
  }

  section("enqueueDomain: same domain twice does not duplicate");
  {
    // Once the first order is provisioned it shows up as an active client.
    const active = [];
    const { deps, cool } = makeDeps({ envs: [], activeClients: active });
    const first = await enqueueDomain(null, { domain: "dup.co.ke", title: "Dup" }, deps);
    ok(first.restarted === true && cool.state.restarts === 1, "first order restarts once");
    active.push({ domain: "dup.co.ke", title: "Dup" });
    const second = await enqueueDomain(null, { domain: "dup.co.ke", title: "Dup" }, deps);
    ok(second.restarted === false, "repeat with unchanged branding does not restart");
    ok(cool.state.restarts === 1, "still one restart in total");
    const value = cool.state.envs.find((e) => e.key === BRANDING_KEY).value;
    ok(JSON.parse(value).length === 1, "env holds the domain once");
    ok(cool.state.updated.length === 0, "unchanged branding is not rewritten");
  }

  section("enqueueDomain: rejects an invalid domain before writing");
  {
    const { deps, cool } = makeDeps({});
    let err = null;
    try { await enqueueDomain(null, { domain: "not a domain,evil.com", title: "X" }, deps); } catch (e) { err = e; }
    ok(!!err, "invalid domain rejects");
    ok(cool.state.restarts === 0 && cool.state.addressWrites.length === 0, "nothing written");
  }

  section("enqueueDomain: missing BULWARK_SERVICE_UUID rejects before writing");
  {
    const { deps, cool } = makeDeps({});
    deps.serviceUuid = undefined;
    let err = null;
    try { await enqueueDomain(null, { domain: "ok.co.ke", title: "OK" }, deps); } catch (e) { err = e; }
    ok(err && /BULWARK_SERVICE_UUID/.test(err.message), "rejects naming BULWARK_SERVICE_UUID");
    ok(cool.state.restarts === 0, "no restart");
  }

  section("enqueueDomain: polls webmail after restart and reports cert ready");
  {
    const { deps, fetchCalls, sleeps } = makeDeps({ fetchOpts: { failures: 2 } });
    const res = await enqueueDomain(null, { domain: "poll.co.ke", title: "Poll" }, deps);
    ok(res.restarted === true && res.certReady === true, "cert ready after retries");
    ok(fetchCalls.length === 3 && fetchCalls.every((u) => u === "https://webmail.poll.co.ke"), "polls https://webmail.<domain> until it answers");
    ok(sleeps.filter((ms) => ms === 15000).length === 2, "waits between attempts");
  }

  section("enqueueDomain: cert never ready is fail-soft after 5 minutes");
  {
    const { deps, fetchCalls, sleeps } = makeDeps({ fetchOpts: { always: true } });
    let res = null;
    let threw = false;
    try { res = await enqueueDomain(null, { domain: "slow.co.ke", title: "Slow" }, deps); } catch (e) { threw = true; }
    ok(!threw, "does not throw when the cert is still not ready");
    ok(res && res.restarted === true && res.certReady === false, "reports certReady false");
    const waited = sleeps.filter((ms) => ms === 15000).length * 15000;
    ok(waited >= 300000 && waited <= 330000, "gives up after about 5 minutes");
    ok(fetchCalls.length > 1, "kept polling before giving up");
  }

  section("enqueueDomain: merge window is respected");
  {
    const { deps, sleeps } = makeDeps({ fetchOpts: {} });
    deps.mergeMs = 20000;
    await enqueueDomain(null, { domain: "win.co.ke", title: "Win" }, deps);
    ok(sleeps[0] === 20000, "first sleep is the merge window");
  }

  section("the Bulwark address helper is isolated and marked unverified");
  {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "services", "email", "webmailBranding.js"), "utf8");
    ok(/UNVERIFIED-LIVE/.test(src), "module marks the address call UNVERIFIED-LIVE");
    ok(!/console\.(log|warn|error)\([^)]*(password|token|secret)/i.test(src), "no logging of secrets");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
