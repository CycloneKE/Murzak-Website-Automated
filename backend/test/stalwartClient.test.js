/**
 * Stalwart management client (JMAP transport): idempotent domain/account
 * ensure*, secret hygiene, auth modes, env config, and the STALWART_MOCK=1 mode.
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
const { createStalwartClient, API_SHAPES } = client;

const FIX = path.join(__dirname, "fixtures", "stalwart");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
// The [methodName, result, tag] triple from a recorded JMAP response.
const methodResponseOf = (name) => fixture(name).methodResponses[0];
const resultOf = (name) => methodResponseOf(name)[1];

const ENV_KEYS = ["STALWART_URL", "STALWART_API_KEY", "STALWART_DNS_SERVER_ID", "STALWART_MOCK", "STALWART_AUTH", "STALWART_API_USER"];
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

const envelope = (name, result) => ({ status: 200, body: { methodResponses: [[name, result, "c0"]] } });
const callsNamed = (stub, name) => stub.calls.filter((c) => c.body.methodCalls[0][0] === name);
const argsOf = (c) => c.body.methodCalls[0][1];

// A scripted JMAP Stalwart. Records every call; answers from a small state.
//  initialDomains / initialAccounts: seed objects
//  domainCreate / accountCreate: "ok" | "conflict" (notCreated alreadyExists)
//  hideFirstDomainList / hideFirstAccountList: first /get returns empty (conflict-then-listed race)
//  override(name, args): optional full HTTP response, to script errors
function fakeStalwart(opts = {}) {
  const {
    initialDomains = [], initialAccounts = [],
    domainCreate = "ok", accountCreate = "ok",
    hideFirstDomainList = false, hideFirstAccountList = false,
    override,
  } = opts;
  const calls = [];
  const state = { domains: initialDomains.map((d) => ({ ...d })), accounts: initialAccounts.map((a) => ({ ...a })) };
  let domainGets = 0;
  let accountGets = 0;
  async function http(req) {
    calls.push(req);
    const [name, args] = req.body.methodCalls[0];
    if (override) {
      const r = override(name, args);
      if (r) return r;
    }
    if (name === "x:Domain/get") {
      domainGets++;
      if (hideFirstDomainList && domainGets === 1) return envelope(name, { list: [] });
      const list = args.ids === null ? state.domains : state.domains.filter((d) => args.ids.includes(d.id));
      return envelope(name, { list });
    }
    if (name === "x:Domain/set" && args.create) {
      if (domainCreate === "conflict") return envelope(name, { notCreated: { k1: { type: "alreadyExists", description: "Domain already exists" } } });
      const id = "g4f2";
      state.domains.push({ id, name: args.create.k1.name, dkimRecord: resultOf("dkim-record-response.json").list[0].dkimRecord });
      return envelope(name, { created: { k1: { id } } });
    }
    if (name === "x:Account/get") {
      accountGets++;
      if (hideFirstAccountList && accountGets === 1) return envelope(name, { list: [] });
      return envelope(name, { list: state.accounts });
    }
    if (name === "x:Account/set" && args.create) {
      if (accountCreate === "conflict") return envelope(name, { notCreated: { k1: { type: "alreadyExists", description: "Account already exists" } } });
      const a = args.create.k1;
      const id = "a7m3";
      state.accounts.push({ id, name: a.name, domainId: a.domainId, emailAddress: `${a.name}@example.co.ke`, quotas: a.quotas });
      return envelope(name, { created: { k1: { id } } });
    }
    if (name === "x:Account/set" && args.update) {
      return envelope(name, { updated: Object.fromEntries(Object.keys(args.update).map((k) => [k, null])) });
    }
    if (name === "x:Account/set" && args.destroy) {
      state.accounts = state.accounts.filter((a) => !args.destroy.includes(a.id));
      return envelope(name, { destroyed: args.destroy });
    }
    return envelope(name, {});
  }
  return { http, calls };
}

// The secret the client generated for the account create call.
function createdSecret(stub) {
  const c = callsNamed(stub, "x:Account/set").find((x) => argsOf(x).create);
  return argsOf(c).create.k1.credentials["0"].secret;
}

const existingDomain = () => resultOf("domain-list-response.json").list[0];
const existingAccount = () => resultOf("account-list-response.json").list[0];

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

  section("module surface and JMAP envelope");
  for (const name of ["isConfigured", "configError", "ensureDomain", "ensureAccount", "setPassword", "findAccount", "deleteAccount", "setOutboundLimit", "listAccounts", "getDkimRecord"]) {
    ok(typeof client[name] === "function", `exports ${name}`);
  }
  const src = fs.readFileSync(path.join(__dirname, "..", "services", "email", "stalwartClient.js"), "utf8");
  ok(/API_SHAPES/.test(src) && /UNVERIFIED-LIVE/.test(src), "API_SHAPES table is marked UNVERIFIED-LIVE in the source");
  ok(API_SHAPES.endpoint === "/jmap", "JMAP endpoint is /jmap");
  ok(API_SHAPES.using.includes("urn:stalwart:jmap") && API_SHAPES.using.includes("urn:ietf:params:jmap:core"), "using lists core and urn:stalwart:jmap");
  ok(API_SHAPES.domainCreate.method === "x:Domain/set" && API_SHAPES.accountGet.method === "x:Account/get", "server methods carry the x: prefix");

  section("config: env-driven isConfigured / configError");
  clearEnv();
  ok(client.isConfigured() === false, "unconfigured when no env is set");
  ok(client.configError().includes("STALWART_API_KEY"), "configError names STALWART_API_KEY when missing");
  ok(client.configError().includes("STALWART_URL"), "configError names STALWART_URL when missing");
  process.env.STALWART_URL = "https://mail.example.test";
  process.env.STALWART_API_KEY = API_KEY;
  process.env.STALWART_DNS_SERVER_ID = "srv-1";
  ok(client.isConfigured() === true, "configured when URL, API key and DNS server id are set (bearer default)");
  ok(client.configError() === "", "configError is empty when configured");
  process.env.STALWART_AUTH = "basic";
  ok(client.configError().includes("STALWART_API_USER"), "basic auth without STALWART_API_USER is reported");
  process.env.STALWART_AUTH = "digest";
  ok(client.configError().includes("STALWART_AUTH"), "unknown STALWART_AUTH value is reported");
  clearEnv();

  section("auth modes");
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(stub.calls[0].headers.Authorization === `Bearer ${API_KEY}`, "default auth sends Bearer API key");
  }
  {
    const stub = fakeStalwart();
    const c = liveClient(stub, { authMode: "basic", apiUser: "admin" });
    await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    const want = `Basic ${Buffer.from(`admin:${API_KEY}`).toString("base64")}`;
    ok(stub.calls[0].headers.Authorization === want, "basic auth sends base64(user:key)");
  }

  section("ensureDomain: JMAP create, then idempotent");
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    const first = await c.ensureDomain({ name: "example.co.ke", description: "Example Ltd mail domain", dnsServerId: "srv-1" });
    ok(first.id === "g4f2" && first.created === true, "first ensureDomain creates and returns id g4f2");
    ok(stub.calls.every((x) => x.method === "POST" && x.path === "/jmap" && x.url === "https://mail.example.test/jmap"), "every call is POST to /jmap");
    ok(stub.calls[0].body.using.includes("urn:stalwart:jmap"), "envelope declares urn:stalwart:jmap");
    const set = callsNamed(stub, "x:Domain/set")[0];
    const wantK1 = fixture("domain-create-request.json").methodCalls[0][1].create.k1;
    ok(set && JSON.stringify(argsOf(set).create.k1.dkimManagement) === JSON.stringify(wantK1.dkimManagement), "domain create requests Automatic DKIM (matches recorded request)");
    ok(argsOf(set).create.k1.dnsManagement["@type"] === "Automatic" && argsOf(set).create.k1.dnsManagement.dnsServerId === "srv-1", "domain create requests Automatic DNS on srv-1");
    ok(argsOf(set).create.k1.name === "example.co.ke", "domain create carries the name");

    const again = await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(again.id === "g4f2" && again.created === false, "second ensureDomain returns same id, created:false");
    ok(callsNamed(stub, "x:Domain/set").length === 1, "second call does not create again");
  }
  {
    const stub = fakeStalwart({ initialDomains: [existingDomain()] });
    const r = await liveClient(stub).ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(r.created === false && r.id === "g4f2", "domain already listed resolves to created:false with the existing id");
    ok(callsNamed(stub, "x:Domain/set").length === 0, "no create when the domain is already listed");
  }
  {
    // Create reports alreadyExists after a list that did not show the domain; the relist finds it.
    const stub = fakeStalwart({ initialDomains: [existingDomain()], hideFirstDomainList: true, domainCreate: "conflict" });
    const r = await liveClient(stub).ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(r.created === false && r.id === "g4f2", "notCreated alreadyExists resolves to created:false via relist");
    ok(callsNamed(stub, "x:Domain/set").length === 1, "exactly one create attempt on the conflict path");
  }

  section("ensureAccount: body shape and conflict handling");
  {
    const stub = fakeStalwart();
    const c = liveClient(stub);
    const quotaBytes = 5 * 1024 ** 3;
    const r = await c.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes });
    ok(r.id === "a7m3" && r.created === true, "ensureAccount creates and returns id a7m3");
    ok(Object.keys(r).sort().join(",") === "created,id", "ensureAccount return value carries only id and created");
    const set = callsNamed(stub, "x:Account/set").find((x) => argsOf(x).create);
    const k1 = argsOf(set).create.k1;
    ok(k1.name === "info" && k1.domainId === "g4f2", "account create carries localPart and domainId");
    ok(k1.quotas.maxDiskQuota === quotaBytes, "account create maxDiskQuota equals quotaBytes (5 GiB)");
    ok(k1.credentials["0"]["@type"] === "Password", "account create carries a Password credential");
    const secret = createdSecret(stub);
    ok(typeof secret === "string" && /^[A-Za-z0-9_-]{24,}$/.test(secret), "generated secret is 24+ url-safe chars");
    ok(callsNamed(stub, "x:Account/set").filter((x) => argsOf(x).create).length === 1, "one create for a fresh account");
  }
  {
    const stub = fakeStalwart({ initialAccounts: [existingAccount()] });
    const r = await liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 5 * 1024 ** 3 });
    ok(r.created === false && r.id === "a7m3", "account already listed resolves to created:false with existing id");
  }
  {
    const stub = fakeStalwart({ initialAccounts: [existingAccount()], hideFirstAccountList: true, accountCreate: "conflict" });
    const r = await liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 5 * 1024 ** 3 });
    ok(r.created === false && r.id === "a7m3", "notCreated alreadyExists resolves to created:false via relist");
  }

  section("secret hygiene: never returned, logged, or in errors");
  {
    const stub = fakeStalwart();
    const cap = await captureConsole(() => liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }));
    const sentSecret = createdSecret(stub);
    ok(!cap.out.includes(sentSecret), "generated secret is absent from console output (success path)");
    ok(!JSON.stringify(cap.result).includes(sentSecret), "generated secret is absent from the return value");
  }
  {
    const stub = fakeStalwart({ override: (name, args) => (name === "x:Account/set" && args.create ? { status: 500, body: { message: "boom" } } : undefined) });
    let captured;
    const cap = await captureConsole(async () => {
      try { await liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); }
      catch (e) { captured = e; }
    });
    const sentSecret = createdSecret(stub);
    ok(captured instanceof Error, "a 500 from the server throws");
    ok(!String(captured.message).includes(sentSecret), "thrown error message does not contain the secret (HTTP 500)");
    ok(!cap.out.includes(sentSecret), "console output on HTTP 500 does not contain the secret");
  }
  {
    // A JMAP method-level error whose description echoes the secret: only the type may surface.
    let echoed;
    const stub = fakeStalwart({
      override: (name, args) => {
        if (name === "x:Account/set" && args.create) {
          echoed = args.create.k1.credentials["0"].secret;
          return { status: 200, body: { methodResponses: [["error", { type: "invalidProperties", description: `bad credential ${echoed}` }, "c0"]] } };
        }
        return undefined;
      },
    });
    let thrown;
    const cap = await captureConsole(async () => {
      try { await liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); }
      catch (e) { thrown = e; }
    });
    ok(thrown && /invalidProperties/.test(thrown.message), "method error surfaces its type");
    ok(thrown && !String(thrown.message).includes(echoed), "method error description echoing the secret is not thrown");
    ok(!cap.out.includes(echoed), "method error description echoing the secret is not logged");
  }
  {
    // notCreated with an echoing description must also be stripped.
    let echoed;
    const stub = fakeStalwart({
      override: (name, args) => {
        if (name === "x:Account/set" && args.create) {
          echoed = args.create.k1.credentials["0"].secret;
          return { status: 200, body: { methodResponses: [[name, { notCreated: { k1: { type: "invalidProperties", description: `echo ${echoed}` } } }, "c0"]] } };
        }
        return undefined;
      },
    });
    let thrown;
    const cap = await captureConsole(async () => {
      try { await liveClient(stub).ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); }
      catch (e) { thrown = e; }
    });
    ok(thrown && !String(thrown.message).includes(echoed) && !cap.out.includes(echoed), "notCreated description echoing the secret is neither thrown nor logged");
  }

  section("API key is masked in log output");
  {
    const stub = { calls: [], http: async () => ({ status: 401, body: { message: `invalid key ${API_KEY}` } }) };
    let thrown;
    const cap = await captureConsole(async () => {
      try { await liveClient(stub).ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" }); }
      catch (e) { thrown = e; }
    });
    ok(thrown instanceof Error, "401 throws");
    ok(!cap.out.includes(API_KEY) && !String(thrown.message).includes(API_KEY), "full API key never appears in logs or the error");
    ok(!cap.out.includes(API_KEY.slice(4, 20)), "a long fragment of the API key is not logged either");
  }
  {
    const lines = [];
    const c = createStalwartClient({
      http: async () => ({ status: 403, body: null }),
      baseUrl: "https://m.test", apiKey: API_KEY, dnsServerId: "srv-1",
      log: (m) => lines.push(m),
    });
    await c.ensureDomain({ name: "example.co.ke", description: "x", dnsServerId: "srv-1" }).catch(() => {});
    ok(lines.length > 0 && !lines.join("\n").includes(API_KEY), "custom log sink receives a line and never the full API key");
  }

  section("findDomain: read-only lookup, never creates");
  {
    const stub = fakeStalwart({ initialDomains: [existingDomain()] });
    const c = liveClient(stub);
    const hit = await c.findDomain("example.co.ke");
    ok(hit && hit.id === "g4f2", "findDomain returns { id } for a domain that exists");
    ok((await c.findDomain("EXAMPLE.co.ke")) && (await c.findDomain("EXAMPLE.co.ke")).id === "g4f2", "findDomain is case-insensitive on the name");
    ok((await c.findDomain("missing.co.ke")) === null, "findDomain returns null when the domain is absent");
    ok(callsNamed(stub, "x:Domain/set").length === 0, "findDomain never sends a Domain/set (no creation)");
    const withMissingFirst = fakeStalwart({ initialDomains: [] });
    const c2 = liveClient(withMissingFirst);
    ok((await c2.findDomain("example.co.ke")) === null, "findDomain on an empty server returns null");
    ok(callsNamed(withMissingFirst, "x:Domain/set").length === 0, "findDomain on an empty server still creates nothing");
  }
  {
    clearEnv();
    process.env.STALWART_MOCK = "1";
    client.__resetMockForTests();
    ok((await client.findDomain("mockfind.co.ke")) === null, "mock findDomain: null before any domain exists");
    const made = await client.ensureDomain({ name: "mockfind.co.ke", description: "x", dnsServerId: "srv-1" });
    const found = await client.findDomain("MockFind.co.ke");
    ok(found && found.id === made.id, "mock findDomain finds the domain ensureDomain created (case-insensitive)");
    ok(!!(await client.findDomain("mockfind.co.ke")) && (await client.listAccounts(made.id)).length === 0, "mock findDomain does not create accounts or other domains");
    client.__resetMockForTests();
    clearEnv();
  }

  section("setPassword / findAccount / deleteAccount / setOutboundLimit");
  {
    const stub = fakeStalwart({ initialAccounts: [existingAccount()] });
    const c = liveClient(stub);
    const found = await c.findAccount("info@example.co.ke");
    ok(found && found.id === "a7m3", "findAccount finds the account by address");
    ok((await c.findAccount("nobody@example.co.ke")) === null, "findAccount returns null when absent");
    await c.setPassword("a7m3", "unused-test-password-value-123456");
    const pw = callsNamed(stub, "x:Account/set").find((x) => argsOf(x).update);
    ok(!!pw && argsOf(pw).update.a7m3.credentials["0"]["@type"] === "Password", "setPassword sends an x:Account/set update of the Password credential");
    await c.setOutboundLimit("a7m3", 100);
    const lim = callsNamed(stub, "x:Account/set").filter((x) => argsOf(x).update).pop();
    ok(!!lim && argsOf(lim).update.a7m3.outboundRateLimit.perHour === 100, "setOutboundLimit sends perHour=100");
    await c.deleteAccount("a7m3");
    const del = callsNamed(stub, "x:Account/set").find((x) => argsOf(x).destroy);
    ok(!!del && argsOf(del).destroy[0] === "a7m3", "deleteAccount sends x:Account/set destroy");
  }
  {
    // A notUpdated from the server must throw, with no secret in the message.
    const stub = fakeStalwart({
      initialAccounts: [existingAccount()],
      override: (name, args) => (name === "x:Account/set" && args.update
        ? { status: 200, body: { methodResponses: [[name, { notUpdated: { a7m3: { type: "forbidden" } } }, "c0"]] } }
        : undefined),
    });
    let thrown;
    await captureConsole(async () => {
      try { await liveClient(stub).setPassword("a7m3", "unused-test-password-value-123456"); }
      catch (e) { thrown = e; }
    });
    ok(thrown && /forbidden/.test(thrown.message) && !thrown.message.includes("unused-test-password"), "notUpdated throws with the type only");
  }

  section("listAccounts / getDkimRecord parse the recorded shapes");
  {
    const stub = fakeStalwart({ initialAccounts: [existingAccount()], initialDomains: resultOf("dkim-record-response.json").list });
    const c = liveClient(stub);
    const list = await c.listAccounts("g4f2");
    ok(Array.isArray(list) && list.length === 1, "listAccounts returns an array");
    ok(list[0].id === "a7m3" && list[0].address === "info@example.co.ke" && list[0].quotaBytes === 5368709120, "listAccounts maps id, address, quotaBytes");
    const dkim = await c.getDkimRecord("g4f2");
    ok(dkim.name === "default._domainkey.example.co.ke" && dkim.type === "TXT" && dkim.value.startsWith("v=DKIM1"), "getDkimRecord returns {name,type,value}");
    ok(callsNamed(stub, "x:Domain/get").some((x) => JSON.stringify(argsOf(x).ids) === '["g4f2"]'), "getDkimRecord asks x:Domain/get for the domain id");
  }
  {
    // A JMAP method-level error on a read must throw, not return empty.
    const stub = { calls: [], http: async () => ({ status: 200, body: fixture("method-error-response.json") }) };
    let thrown;
    await captureConsole(async () => {
      try { await liveClient(stub).listAccounts("g4f2"); }
      catch (e) { thrown = e; }
    });
    ok(thrown && /forbidden/.test(thrown.message), "method error on a read throws with its type");
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
  }

  section("module-level mock state persists across calls (one default client)");
  try {
    clearEnv();
    process.env.STALWART_MOCK = "1";
    client.__resetMockForTests();
    const d1 = await client.ensureDomain({ name: "module.co.ke", description: "x", dnsServerId: "srv-1" });
    const d2 = await client.ensureDomain({ name: "module.co.ke", description: "x", dnsServerId: "srv-1" });
    ok(d1.created === true, "module ensureDomain creates on first call");
    ok(d2.created === false && d2.id === d1.id, "module ensureDomain second call: same id, created:false");
    const a1 = await client.ensureAccount({ domainId: d1.id, localPart: "info", quotaBytes: 1024 ** 3 });
    const a2 = await client.ensureAccount({ domainId: d1.id, localPart: "info", quotaBytes: 1024 ** 3 });
    ok(a1.created === true, "module ensureAccount creates on first call (no unknown-domain error)");
    ok(a2.created === false && a2.id === a1.id, "module ensureAccount second call is idempotent");
    const found = await client.findAccount("info@module.co.ke");
    ok(found && found.id === a1.id, "module findAccount sees the account created via module ensureAccount");
    const list = await client.listAccounts(d1.id);
    ok(list.length === 1 && list[0].id === a1.id, "module listAccounts shows exactly one account");
    client.__resetMockForTests();
    ok((await client.listAccounts(d1.id)).length === 0, "__resetMockForTests clears the default mock store");
  } catch (e) {
    ok(false, `module-level mock flow threw: ${e.message}`);
  }
  clearEnv();

  section("live mode refuses to run unconfigured (clear error, no network)");
  try {
    clearEnv();
    client.__resetMockForTests();
    let err;
    try { await client.ensureDomain({ name: "x.co.ke", description: "x", dnsServerId: "srv-1" }); } catch (e) { err = e; }
    ok(err instanceof Error && err.message.includes("STALWART_URL") && err.message.includes("STALWART_API_KEY"), "module ensureDomain rejects naming the missing URL and key");
    process.env.STALWART_URL = "https://mail.example.test";
    err = undefined;
    try { await client.ensureAccount({ domainId: "g4f2", localPart: "info", quotaBytes: 1024 ** 3 }); } catch (e) { err = e; }
    ok(err instanceof Error && err.message.includes("STALWART_API_KEY") && !err.message.includes("STALWART_URL"), "module ensureAccount with URL set rejects naming only the missing key");
    clearEnv();
    let calls = 0;
    const stub = { calls: [], http: async () => { calls++; return { status: 200, body: {} }; } };
    const bare = createStalwartClient({ http: stub.http, baseUrl: "", apiKey: "", dnsServerId: "" });
    err = undefined;
    try { await bare.setPassword("a7m3", "unused-test-password-value-123456"); } catch (e) { err = e; }
    ok(err instanceof Error && err.message.includes("STALWART_URL"), "factory client with no config rejects before any request");
    ok(calls === 0, "unconfigured client never calls the transport");
  } catch (e) {
    ok(false, `live guard test threw: ${e.message}`);
  }
  clearEnv();

  restoreEnv();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error("FAILED:\n- " + fails.join("\n- "));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
