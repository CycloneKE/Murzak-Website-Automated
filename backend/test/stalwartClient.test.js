/**
 * Stalwart management client: idempotent domain/account ensure*, secret hygiene,
 * env config, and the STALWART_MOCK=1 in-memory mode.
 *   node test/stalwartClient.test.js   (or: npm test)
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

const client = require("../services/email/stalwartClient");
const { createStalwartClient } = client;

const FIX = path.join(__dirname, "fixtures", "stalwart");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));

const ENV_KEYS = ["STALWART_URL", "STALWART_API_KEY", "STALWART_DNS_SERVER_ID", "STALWART_MOCK"];
const API_KEY = "sk_live_TESTKEY_0123456789abcdef";

// Capture everything written to the console while fn runs.
async function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const sink = (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.log = console.error = console.warn = console.info = sink;
  try {
    const result = await fn();
    return { result, out: lines.join("\n") };
  } catch (err) {
    return { error: err, out: lines.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}

// A scripted Stalwart: records every call and answers from a small state.
function fakeStalwart({ domainExists = false, accountExists = false, failAccountWith } = {}) {
  const calls = [];
  const state = { domains: domainExists ? [fixture("domain-list-response.json")[0]] : [], accounts: accountExists ? fixture("account-list-response.json") : [] };
  async function http({ method, path: p, body, headers }) {
    calls.push({ method, path: p, body, headers });
    if (method === "GET" && p === "/api/domain") return { status: 200, body: state.domains };
    if (method === "POST" && p === "/api/domain") {
      if (domainExists) return { status: 409, body: fixture("domain-conflict-response.json") };
      state.domains = fixture("domain-list-response.json").slice(0, 1);
      return { status: 201, body: fixture("domain-create-response.json") };
    }
    if (method === "GET" && p === "/api/account") return { status: 200, body: state.accounts };
    if (method === "POST" && p === "/api/account") {
      if (failAccountWith) return failAccountWith;
      if (accountExists) return { status: 409, body: fixture("account-conflict-response.json") };
      return { status: 201, body: fixture("account-create-response.json") };
    }
    if (method === "GET" && p === "/api/domain/g4f2/dkim") return { status: 200, body: fixture("dkim-record-response.json") };
    if (method === "DELETE" && p.startsWith("/api/account/")) return { status: 204, body: null };
    return { status: 200, body: {} };
  }
  return { http, calls };
}

function liveClient(stub, extra = {}) {
  return createStalwartClient({
    http: stub.http,
    baseUrl: "https://mail.example.test",
    apiKey: API_KEY,
    dnsServerId: "srv-1",
    ...extra,
  });
}

(async () => {
  const savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const clearEnv = () => { for (const k of ENV_KEYS) delete process.env[k]; };
  const restoreEnv = () => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } };

  section("module surface");
  for (const name of ["isConfigured", "configError", "ensureDomain", "ensureAccount", "setPassword", "findAccount", "deleteAccount", "setOutboundLimit", "listAccounts", "getDkimRecord"]) {
    ok(typeof client[name] === "function", `exports ${name}`);
  }
  const src = fs.readFileSync(path.join(__dirname, "..", "services", "email", "stalwartClient.js"), "utf8");
  ok(/API_SHAPES/.test(src) && /UNVERIFIED-LIVE/.test(src), "API_SHAPES table is marked UNVERIFIED-LIVE in the source");

  section("config: env-driven isConfigured / configError");
  clearEnv();
  ok(client.isConfigured() === false, "unconfigured when no env is set");
  ok(client.configError().includes("STALWART_API_KEY"), "configError names STALWART_API_KEY when missing");
  ok(client.configError().includes("STALWART_URL"), "configError names STALWART_URL when missing");
  process.env.STALWART_URL = "https://mail.example.test";
  process.env.STALWART_API_KEY = API_KEY;
  process.env.STALWART_DNS_SERVER_ID = "srv-1";
  ok(client.isConfigured() === true, "configured when URL, API key and DNS server id are set");
  ok(client.configError() === "", "configError is empty when configured");
  clearEnv();

  section("ensureDomain: create, then idempotent");
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    const first = await c.ensureDomain({ name: "example.co.ke", description: "Example Ltd mail domain", dnsServerId: "srv-1" });
    ok(first.id === "g4f2" && first.created === true, "first ensureDomain creates and returns id g4f2");
    const post = stub.calls.find((x) => x.method === "POST" && x.path === "/api/domain");
    const want = fixture("domain-create-request.json");
    ok(JSON.stringify(post.body.dkimManagement) === JSON.stringify(want.dkimManagement), "domain body requests Automatic DKIM");
    ok(post.body.dnsManagement["@type"] === "Automatic" && post.body.dnsManagement.dnsServerId === "srv-1", "domain body requests Automatic DNS on srv-1");
    ok(post.body.name === "example.co.ke", "domain body carries the name");

    const again = await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(again.id === "g4f2" && again.created === false, "second ensureDomain returns same id, created:false");
    ok(stub.calls.filter((x) => x.method === "POST" && x.path === "/api/domain").length === 1, "second call does not POST again");
  }
  {
    const stub = fakeStalwart({ domainExists: true });
    const c = liveClient(stub);
    const r = await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(r.created === false && r.id === "g4f2", "server 409 alreadyExists resolves to created:false with the existing id");
  }

  section("ensureAccount: body shape and conflict handling");
  const SECRET_RE = /^[A-Za-z0-9_-]{24,}$/;
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    const quotaBytes = 5 * 1024 ** 3;
    const r = await c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes });
    ok(r.id === "a7m3" && r.created === true, "ensureAccount creates and returns id a7m3");
    ok(Object.keys(r).sort().join(",") === "created,id", "ensureAccount return value carries only id and created");
    const post = stub.calls.find((x) => x.method === "POST" && x.path === "/api/account");
    ok(post.body.name === "info" && post.body.domainId === "g4f2", "account body carries localPart and domainId");
    ok(post.body.quotas.maxDiskQuota === quotaBytes, "account body maxDiskQuota equals quotaBytes (5 GiB)");
    const pw = post.body.credentials && post.body.credentials["0"];
    ok(pw && pw["@type"] === "Password", "account body carries a Password credential");
    ok(pw && typeof pw.secret === "string" && SECRET_RE.test(pw.secret), "generated secret is 24+ url-safe chars");
    const sent = stub.calls.filter((x) => x.method === "POST" && x.path === "/api/account");
    ok(sent.length === 1, "one POST for a fresh account");
  }
  {
    const stub = fakeStalwart({ accountExists: true });
    const c = liveClient(stub);
    const r = await c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 5 * 1024 ** 3 });
    ok(r.created === false && r.id === "a7m3", "server 409 alreadyExists resolves to created:false with existing id");
  }

  section("secret hygiene: never returned, logged, or in errors");
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    const cap = await captureConsole(() => c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }));
    const sentSecret = stub.calls.find((x) => x.method === "POST" && x.path === "/api/account").body.credentials["0"].secret;
    ok(!cap.out.includes(sentSecret), "generated secret is absent from console output (success path)");
    ok(!JSON.stringify(cap.result).includes(sentSecret), "generated secret is absent from the return value");
  }
  {
    const stub = fakeStalwart({ failAccountWith: { status: 500, body: { message: "boom" } } });
    const c = liveClient(stub);
    let captured;
    const cap = await captureConsole(async () => {
      try { await c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); }
      catch (e) { captured = e; }
    });
    const sentSecret = stub.calls.find((x) => x.method === "POST" && x.path === "/api/account").body.credentials["0"].secret;
    ok(captured instanceof Error, "a 500 from the server throws");
    ok(!String(captured.message).includes(sentSecret), "thrown error message does not contain the secret");
    ok(!cap.out.includes(sentSecret), "console output on failure does not contain the secret");
  }
  {
    // Server echoes the secret back in an error body; the client must not surface it.
    const stub = { calls: [] };
    stub.http = async ({ method, path: p, body }) => {
      stub.calls.push({ method, path: p, body });
      if (method === "POST" && p === "/api/account") return { status: 400, body: { message: `bad credential ${body.credentials["0"].secret}` } };
      return { status: 200, body: [] };
    };
    const c = liveClient(stub);
    let thrown;
    const cap = await captureConsole(async () => {
      try { await c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); }
      catch (e) { thrown = e; }
    });
    const echoed = stub.calls.find((x) => x.method === "POST" && x.path === "/api/account").body.credentials["0"].secret;
    ok(thrown && !String(thrown.message).includes(echoed), "error echoing the secret is not re-thrown with the secret");
    ok(!cap.out.includes(echoed), "error echoing the secret is not logged");
  }

  section("API key is masked in log output");
  {
    const stub = { http: async () => ({ status: 401, body: { message: `invalid key ${API_KEY}` } }), calls: [] };
    const c = liveClient(stub);
    let thrown;
    const cap = await captureConsole(async () => {
      try { await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" }); }
      catch (e) { thrown = e; }
    });
    ok(thrown instanceof Error, "401 throws");
    ok(!cap.out.includes(API_KEY) && !String(thrown.message).includes(API_KEY), "full API key never appears in logs or the error");
    ok(!cap.out.includes(API_KEY.slice(4, 20)), "a long fragment of the API key is not logged either");
  }
  {
    // A logger handed the masked key must still not leak it.
    const cap = await captureConsole(() => {
      const lines = [];
      const c = createStalwartClient({ http: async () => ({ status: 200, body: [] }), baseUrl: "https://m.test", apiKey: API_KEY, dnsServerId: "srv-1", log: (m) => lines.push(m) });
      return c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" }).then(() => lines.join("\n"));
    });
    ok(!String(cap.result).includes(API_KEY), "custom log sink never receives the full API key");
  }

  section("setPassword / findAccount / deleteAccount / setOutboundLimit");
  {
    const stub = fakeStalwart({ accountExists: true });
    const c = liveClient(stub);
    const found = await c.findAccount("info@example.co.ke");
    ok(found && found.id === "a7m3", "findAccount finds the account by address");
    ok((await c.findAccount("nobody@example.co.ke")) === null, "findAccount returns null when absent");
    await c.setPassword("a7m3", "unused-test-password-value-123456");
    const pwCall = stub.calls.filter((x) => x.method === "PATCH" && x.path === "/api/account/a7m3").pop();
    ok(!!pwCall && pwCall.body.credentials["0"]["@type"] === "Password", "setPassword patches the account's Password credential");
    await c.setOutboundLimit("a7m3", 100);
    const lim = stub.calls.filter((x) => x.method === "PATCH" && x.path === "/api/account/a7m3").pop();
    ok(!!lim && JSON.stringify(lim.body).includes("100"), "setOutboundLimit sends the per-hour limit");
    await c.deleteAccount("a7m3");
    ok(stub.calls.some((x) => x.method === "DELETE" && x.path === "/api/account/a7m3"), "deleteAccount issues DELETE");
  }

  section("listAccounts / getDkimRecord parse the recorded shapes");
  {
    const stub = fakeStalwart({ accountExists: true });
    const c = liveClient(stub);
    const list = await c.listAccounts("g4f2");
    ok(Array.isArray(list) && list.length === 1, "listAccounts returns an array");
    ok(list[0].id === "a7m3" && list[0].address === "info@example.co.ke" && list[0].quotaBytes === 5368709120, "listAccounts maps id, address, quotaBytes");
    const dkim = await c.getDkimRecord("g4f2");
    ok(dkim.name === "default._domainkey.example.co.ke" && dkim.type === "TXT" && dkim.value.startsWith("v=DKIM1"), "getDkimRecord returns {name,type,value}");
  }

  section("mock mode: STALWART_MOCK=1, in-memory, no network");
  {
    clearEnv();
    process.env.STALWART_MOCK = "1";
    const boom = async () => { throw new Error("network must not be used in mock mode"); };
    const m = createStalwartClient({ http: boom, mock: true, dnsServerId: "srv-1" });
    ok(m.isConfigured() === true, "mock client is configured without URL or key");
    const d1 = await m.ensureDomain({ name: "mock.co.ke", description: "x", dnsServerId: "srv-1" });
    const d2 = await m.ensureDomain({ name: "mock.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(d1.created === true && d2.created === false && d1.id === d2.id, "mock ensureDomain is idempotent");
    const a1 = await m.ensureAccount({ domainId: d1.id, localPart: "hello", quotaBytes: 1024 ** 3 });
    const a2 = await m.ensureAccount({ domainId: d1.id, localPart: "hello", quotaBytes: 1024 ** 3 });
    ok(a1.created === true && a2.created === false && a1.id === a2.id, "mock ensureAccount is idempotent");
    const f = await m.findAccount("hello@mock.co.ke");
    ok(f && f.id === a1.id, "mock findAccount finds the account");
    const list = await m.listAccounts(d1.id);
    ok(list.length === 1 && list[0].quotaBytes === 1024 ** 3, "mock listAccounts reflects the store");
    await m.setPassword(a1.id, "unused-test-password-value-123456");
    await m.setOutboundLimit(a1.id, 50);
    await m.deleteAccount(a1.id);
    ok((await m.findAccount("hello@mock.co.ke")) === null, "mock deleteAccount removes the account");
    const dkim = await m.getDkimRecord(d1.id);
    ok(dkim && dkim.type === "TXT" && typeof dkim.name === "string", "mock getDkimRecord returns a TXT record");
    restoreEnv();
  }

  restoreEnv();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error("FAILED:\n- " + fails.join("\n- "));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
