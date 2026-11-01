/**
 * /api/mail/status/:token - magic-link status, set-password and add-mailbox API.
 *   node test/mailRoutes.test.js   (or: npm test)
 *
 * Handlers are called directly (as in mailOrderRoute.test.js) against the shared
 * mock Frappe and STALWART_MOCK=1. Pinned: identical 404 for any bad token,
 * no secrets/ids in responses, first-set needs no code, resets and adds need a
 * single-use code, brute force is capped, crafted :local values change nothing,
 * state gating, plan limit, and that no password reaches console or a response.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

process.env.STALWART_MOCK = "1";
process.env.MAIL_LINK_SECRET = "routes-test-secret";
delete process.env.STALWART_URL;
delete process.env.STALWART_API_KEY;

const createMailRouter = require("../routes/mailRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const stalwart = require("../services/email/stalwartClient");
const access = require("../services/email/mailAccess");

const GB = 1024 ** 3;
const PW = "Sup3rSecretPw";
const PW2 = "An0therSecretPw";

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.setHeader = r.set;
  return r;
}
function route(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`No route ${method} ${path}`);
  return layer.route.stack;
}
async function call(router, method, path, { params = {}, body = {} } = {}) {
  const stack = route(router, method, path);
  const res = makeRes();
  await stack[stack.length - 1].handle({ params, body, headers: {}, ip: "127.0.0.1" }, res);
  return res;
}

const DNS = [
  { type: "MX", name: "@", value: "mail.cloud.murzaktech.tech", priority: 10 },
  { type: "TXT", name: "@", value: "v=spf1 mx ~all" },
];

function setupFor(over = {}) {
  return {
    state: "live",
    provider: "stalwart",
    domainMode: "new",
    planId: "mail-starter",
    domain: "acme.com",
    businessName: "Acme Ltd",
    contactEmail: "owner@gmail.com",
    mailboxes: [{ localPart: "info", passwordSet: false }, { localPart: "sales", passwordSet: true }],
    progress: { payment: "done", domain: "done", mail: "done", webmail: "done", dns: "done" },
    stalwartDomainId: null, // filled by world()
    dnsRecords: DNS,
    codeChallenge: null,
    ...over,
  };
}

async function world(orders) {
  stalwart.__resetMockForTests();
  const client = makeMockFrappe({ "Checkout Order": {} });
  const sent = [];
  const router = createMailRouter({ frappeClient: () => client, mailDeps: { sendCodeEmail: async (a) => { sent.push(a); } } });
  for (const [name, spec] of Object.entries(orders)) {
    const setup = setupFor(spec.setup || {});
    const dom = await stalwart.ensureDomain({ name: setup.domain });
    setup.stalwartDomainId = dom.id;
    await stalwart.ensureAccount({ domainId: dom.id, localPart: "postmaster", quotaBytes: GB });
    for (const m of setup.mailboxes) await stalwart.ensureAccount({ domainId: dom.id, localPart: m.localPart, quotaBytes: GB });
    client.store["Checkout Order"][name] = { name, status: "Paid", config_json: JSON.stringify({ mailSetup: setup, other: "keep" }) };
  }
  return { client, router, sent };
}
const setupOf = (client, name) => JSON.parse(client.store["Checkout Order"][name].config_json).mailSetup;
const tokenFor = (name) => access.signOrderToken(name);

// Spy on password writes (the facade calls stalwart.setPassword).
const pwCalls = [];
const realSetPassword = stalwart.setPassword;
stalwart.setPassword = async (id, pw) => { pwCalls.push({ id, pw }); return realSetPassword(id, pw); };

// Capture all console output.
const captured = [];
for (const k of ["log", "info", "warn", "error"]) {
  const orig = console[k];
  console[k] = (...a) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    captured.push(line);
    // Test progress lines start with "  ok:" / "  FAIL:" / "#": keep showing them.
    if (/^(\s*(ok|FAIL):|\n?#|\n?\d+ passed|\nFailures)/.test(line) || k === "log") orig(...a);
  };
}

const P = "/api/mail/status/:token";
const PW_PATH = "/api/mail/status/:token/mailboxes/:local/password";
const ADD_PATH = "/api/mail/status/:token/mailboxes";
const CODE_PATH = "/api/mail/status/:token/code";

(async () => {
  section("invalid tokens all look the same");
  {
    const { router } = await world({ "CHK-1": {} });
    const good = tokenFor("CHK-1");
    const [p, s] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "CHK-1", e: Date.now() + 1e9 })).toString("base64url");
    const expired = access.signOrderToken("CHK-1", Date.now() - 31 * 24 * 3600 * 1000);
    const unknown = tokenFor("CHK-999");
    const variants = { tampered: `${p}.${s.slice(0, -3)}AAA`, forged, expired, unknown, garbage: "nope" };
    const bodies = [];
    for (const [label, token] of Object.entries(variants)) {
      for (const [m, path, body] of [["get", P], ["post", CODE_PATH], ["post", PW_PATH, { password: PW }], ["post", ADD_PATH, { localPart: "x", code: "1" }]]) {
        const r = await call(router, m, path, { params: { token, local: "info" }, body: body || {} });
        ok(r.statusCode === 404, `${label} token -> 404 on ${m.toUpperCase()} ${path.replace("/api/mail/status/:token", "")}`);
        bodies.push(JSON.stringify(r.body));
      }
    }
    ok(new Set(bodies).size === 1, "every 404 body is byte-identical");
    const noSecret = await call(router, "get", P, { params: { token: good } });
    ok(noSecret.statusCode === 200, "the valid token works");
    delete process.env.MAIL_LINK_SECRET;
    const r = await call(router, "get", P, { params: { token: good } });
    process.env.MAIL_LINK_SECRET = "routes-test-secret";
    ok(r.statusCode === 404 && JSON.stringify(r.body) === bodies[0], "without a server secret everything is the same 404");
  }

  section("status view");
  {
    const { router } = await world({ "CHK-1": {} });
    const r = await call(router, "get", P, { params: { token: tokenFor("CHK-1") } });
    const b = r.body;
    ok(r.statusCode === 200 && b.state === "live", "state is live");
    ok(JSON.stringify(b.stages.map((s) => [s.id, s.label, s.state])) === JSON.stringify([
      ["payment", "Payment confirmed", "done"], ["domain", "Your domain", "done"],
      ["mail", "Mail is ready", "done"], ["webmail", "Webmail is ready", "done"],
    ]), "four customer stages with the fixed labels");
    ok(JSON.stringify(b.mailboxes) === JSON.stringify([{ address: "info@acme.com", passwordSet: false }, { address: "sales@acme.com", passwordSet: true }]), "mailboxes list address and passwordSet only, no postmaster");
    ok(b.webmailUrl === "https://webmail.acme.com", "webmail URL");
    ok(b.plan.mailboxLimit === 3 && b.plan.mailboxCount === 2 && b.plan.planId === "mail-starter", "plan limit info");
    ok(!("dnsRecords" in b), "no DNS records once live");
    const text = JSON.stringify(b);
    ok(!/mock-domain|mock-account|stalwartDomainId|codeChallenge|hash|secret|contactEmail|owner@gmail/.test(text), "no Stalwart ids, hashes, secrets or contact email");
    ok(r.headers["cache-control"] === "no-store", "not cacheable");
  }

  section("DNS records only while awaiting DNS on an own domain");
  {
    const w = await world({
      "CHK-OWN": { setup: { state: "provisioned", domainMode: "own", progress: { payment: "done", domain: "done", mail: "done", webmail: "done", dns: "pending" } } },
      "CHK-NEW": { setup: { state: "provisioned", domainMode: "new" } },
    });
    const own = (await call(w.router, "get", P, { params: { token: tokenFor("CHK-OWN") } })).body;
    ok(Array.isArray(own.dnsRecords) && own.dnsRecords.length === 2 && own.dnsRecords[0].priority === 10, "own domain, provisioned: records shown");
    ok(!("dnsRecords" in (await call(w.router, "get", P, { params: { token: tokenFor("CHK-NEW") } })).body), "bought domain: no records");
  }

  section("failed stage reports needs_attention with the fixed sentence only");
  {
    const w = await world({ "CHK-F": { setup: { state: "provisioned", domainMode: "own", failureReason: "Stalwart 500 at 10.0.0.5", progress: { payment: "done", domain: "failed", mail: "pending", webmail: "pending", dns: "pending" } } } });
    const r = await call(w.router, "get", P, { params: { token: tokenFor("CHK-F") } });
    ok(r.body.state === "needs_attention", "state is needs_attention");
    ok(r.body.message === "Your setup needs a quick check by our team. We will email you within one working day.", "the fixed sentence");
    ok(!JSON.stringify(r.body).includes("Stalwart 500") && !("dnsRecords" in r.body), "no technical detail, no records");
  }

  section("first password set needs no code");
  {
    const w = await world({ "CHK-1": {} });
    pwCalls.length = 0;
    const r = await call(w.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "info" }, body: { password: PW } });
    ok(r.statusCode === 200 && r.body.passwordSet === true && r.body.address === "info@acme.com", "first set succeeds");
    ok(pwCalls.length === 1, "the provider was called once");
    ok(setupOf(w.client, "CHK-1").mailboxes.find((m) => m.localPart === "info").passwordSet === true, "passwordSet flipped in mailSetup");
    ok(!JSON.stringify(setupOf(w.client, "CHK-1")).includes(PW) && !JSON.stringify(r.body).includes(PW), "password is neither stored nor returned");
    ok(JSON.parse(w.client.store["Checkout Order"]["CHK-1"].config_json).other === "keep", "other config keys survive");
    // Second set without a code
    pwCalls.length = 0;
    const again = await call(w.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "info" }, body: { password: PW2 } });
    ok(again.statusCode === 403 && pwCalls.length === 0, "second set without a code -> 403, nothing changes");
  }

  section("weak password -> 400");
  {
    const w = await world({ "CHK-1": {} });
    pwCalls.length = 0;
    for (const bad of ["short1A", "alllowercase1", "NOLOWER123", "NoDigitsHere", "", undefined, 12345678, { a: 1 }]) {
      const r = await call(w.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "info" }, body: { password: bad } });
      ok(r.statusCode === 400, `weak password ${JSON.stringify(bad)} -> 400`);
    }
    ok(pwCalls.length === 0 && setupOf(w.client, "CHK-1").mailboxes[0].passwordSet === false, "nothing was changed");
    // weak password with a valid code must not burn the code
    await call(w.router, "post", CODE_PATH, { params: { token: tokenFor("CHK-1") } });
    const before = setupOf(w.client, "CHK-1").codeChallenge;
    await call(w.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "sales" }, body: { password: "weak", code: w.sent[0].code } });
    ok(setupOf(w.client, "CHK-1").codeChallenge.hash === before.hash && setupOf(w.client, "CHK-1").codeChallenge.attempts === 0, "a weak password does not spend the code");
  }

  section("reset with a code, single use");
  {
    const w = await world({ "CHK-1": {} });
    const token = tokenFor("CHK-1");
    const c = await call(w.router, "post", CODE_PATH, { params: { token } });
    ok(c.statusCode === 202 && JSON.stringify(c.body) === '{"sent":true}', "code request accepted and answers nothing sensitive");
    ok(w.sent.length === 1 && w.sent[0].to === "owner@gmail.com" && /^\d{6}$/.test(w.sent[0].code), "code emailed to the contact address");
    ok(!JSON.stringify(c.body).includes(w.sent[0].code), "response does not carry the code");
    pwCalls.length = 0;
    const wrong = w.sent[0].code === "000000" ? "111111" : "000000";
    const bad = await call(w.router, "post", PW_PATH, { params: { token, local: "sales" }, body: { password: PW2, code: wrong } });
    ok(bad.statusCode === 403 && pwCalls.length === 0, "wrong code -> 403, nothing changes");
    const good = await call(w.router, "post", PW_PATH, { params: { token, local: "sales" }, body: { password: PW2, code: w.sent[0].code } });
    ok(good.statusCode === 200 && pwCalls.length === 1, "valid code -> 200 and the password is changed");
    const reuse = await call(w.router, "post", PW_PATH, { params: { token, local: "sales" }, body: { password: PW, code: w.sent[0].code } });
    ok(reuse.statusCode === 403 && pwCalls.length === 1, "reusing the code -> 403");
    const addReuse = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "orders", code: w.sent[0].code } });
    ok(addReuse.statusCode === 403, "and the spent code does not work to add a mailbox either");
  }

  section("wrong code 5 times invalidates the challenge");
  {
    const w = await world({ "CHK-1": {} });
    const token = tokenFor("CHK-1");
    await call(w.router, "post", CODE_PATH, { params: { token } });
    const real = w.sent[0].code;
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await call(w.router, "post", PW_PATH, { params: { token, local: "sales" }, body: { password: PW2, code: wrong } });
      ok(r.statusCode === 403, `attempt ${i + 1} -> 403`);
    }
    ok(setupOf(w.client, "CHK-1").codeChallenge == null, "challenge is gone");
    pwCalls.length = 0;
    const r = await call(w.router, "post", PW_PATH, { params: { token, local: "sales" }, body: { password: PW2, code: real } });
    ok(r.statusCode === 403 && pwCalls.length === 0, "even the right code is now refused");
  }

  section("a code can be requested only once a minute");
  {
    const w = await world({ "CHK-1": {} });
    const token = tokenFor("CHK-1");
    const a = await call(w.router, "post", CODE_PATH, { params: { token } });
    const b = await call(w.router, "post", CODE_PATH, { params: { token } });
    ok(a.statusCode === 202 && b.statusCode === 429, "second request within 60 s -> 429");
    ok(w.sent.length === 1, "only one email went out");
  }

  section("crafted :local values change nothing");
  {
    const w = await world({ "CHK-1": {}, "CHK-2": { setup: { domain: "other.org", mailboxes: [{ localPart: "secret", passwordSet: false }] } } });
    const token = tokenFor("CHK-1");
    const stateBefore = JSON.stringify(setupOf(w.client, "CHK-1"));
    const other = setupOf(w.client, "CHK-2");
    pwCalls.length = 0;
    const crafted = ["postmaster", "secret", "secret@other.org", "info@other.org", "../CHK-2", "info@acme.com", "INFO", "info ", "%2e%2e", "mock-account-1", "", "admin", "__proto__", "constructor"];
    for (const local of crafted) {
      const r = await call(w.router, "post", PW_PATH, { params: { token, local }, body: { password: PW } });
      ok(r.statusCode === 404, `:local ${JSON.stringify(local)} -> 404`);
    }
    ok(pwCalls.length === 0, "the provider was never called");
    ok(JSON.stringify(setupOf(w.client, "CHK-1")) === stateBefore, "this order's setup is unchanged");
    ok(JSON.stringify(setupOf(w.client, "CHK-2")) === JSON.stringify(other), "the other order's setup is unchanged");
    // The facade also protects a mailbox that exists in setup but whose Stalwart account sits on another domain.
    const w2 = await world({ "CHK-1": { setup: { mailboxes: [{ localPart: "ghost", passwordSet: false }] } } });
    const acc = await stalwart.findAccount("ghost@acme.com");
    await stalwart.deleteAccount(acc.id);
    const r = await call(w2.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "ghost" }, body: { password: PW } });
    ok(r.statusCode === 404 && pwCalls.length === 0, "a mailbox with no account on this domain -> 404");
    // A token for an order whose recorded domain id does not match Stalwart's refuses too.
    const w3 = await world({ "CHK-1": {} });
    const cfg = JSON.parse(w3.client.store["Checkout Order"]["CHK-1"].config_json);
    cfg.mailSetup.stalwartDomainId = "mock-domain-other";
    w3.client.store["Checkout Order"]["CHK-1"].config_json = JSON.stringify(cfg);
    const r3 = await call(w3.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "info" }, body: { password: PW } });
    ok(r3.statusCode === 404 && pwCalls.length === 0, "a domain id that does not match the order's record -> 404");
  }

  section("adding a mailbox");
  {
    const w = await world({ "CHK-1": {} });
    const token = tokenFor("CHK-1");
    await call(w.router, "post", CODE_PATH, { params: { token } });
    const code = w.sent[0].code;
    const noCode = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "orders" } });
    ok(noCode.statusCode === 403, "no code -> 403");
    const bad = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "orders", code: code === "000000" ? "111111" : "000000" } });
    ok(bad.statusCode === 403, "wrong code -> 403");
    ok((await stalwart.findAccount("orders@acme.com")) === null, "and no account was created");
    const made = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "orders", code } });
    ok(made.statusCode === 201 && made.body.address === "orders@acme.com" && made.body.passwordSet === false, "valid code -> 201, passwordSet false");
    ok((await stalwart.findAccount("orders@acme.com")) !== null, "the account exists");
    ok(JSON.stringify(setupOf(w.client, "CHK-1").mailboxes.at(-1)) === '{"localPart":"orders","passwordSet":false}', "appended to mailSetup");
    ok(!JSON.stringify(made.body).includes("mock-account"), "no Stalwart id in the response");
    const used = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "extra", code } });
    ok(used.statusCode === 409 || used.statusCode === 403, "the plan is now full (3 of 3) and the code is spent");
    // The new mailbox gets its first password with no code.
    pwCalls.length = 0;
    const first = await call(w.router, "post", PW_PATH, { params: { token, local: "orders" }, body: { password: PW } });
    ok(first.statusCode === 200 && pwCalls.length === 1, "the customer sets its first password without a code");
  }

  section("adding past the plan limit -> 409; bad names -> 400");
  {
    const w = await world({ "CHK-1": { setup: { mailboxes: [{ localPart: "a", passwordSet: true }, { localPart: "b", passwordSet: true }, { localPart: "c", passwordSet: true }] } } });
    const token = tokenFor("CHK-1");
    await call(w.router, "post", CODE_PATH, { params: { token } });
    const r = await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "d", code: w.sent[0].code } });
    ok(r.statusCode === 409, "4th mailbox on a 3-mailbox plan -> 409");
    ok(setupOf(w.client, "CHK-1").mailboxes.length === 3 && (await stalwart.findAccount("d@acme.com")) === null, "nothing was created");
    ok(setupOf(w.client, "CHK-1").codeChallenge != null, "the code was not spent by a refused add");

    const w2 = await world({ "CHK-1": {} });
    const t2 = tokenFor("CHK-1");
    await call(w2.router, "post", CODE_PATH, { params: { token: t2 } });
    // free a slot so only the name can be the problem
    const cfg = JSON.parse(w2.client.store["Checkout Order"]["CHK-1"].config_json);
    cfg.mailSetup.mailboxes = [{ localPart: "info", passwordSet: false }];
    w2.client.store["Checkout Order"]["CHK-1"].config_json = JSON.stringify(cfg);
    for (const name of ["postmaster", "admin", "abuse", "noreply", "root", "Sales", "has space", "-lead", "trail-", "a..b", "x@y.com", "../x", "a".repeat(65), "", undefined, 5, null, ["a"]]) {
      const r2 = await call(w2.router, "post", ADD_PATH, { params: { token: t2 }, body: { localPart: name, code: w2.sent[0].code } });
      ok(r2.statusCode === 400, `local part ${String(JSON.stringify(name)).slice(0, 20)} -> 400`);
    }
    const dup = await call(w2.router, "post", ADD_PATH, { params: { token: t2 }, body: { localPart: "info", code: w2.sent[0].code } });
    ok(dup.statusCode === 409, "an existing mailbox -> 409");
    ok((await stalwart.listAccounts((await stalwart.findDomain("acme.com")).id)).length === 3, "no account was created by any refused add (info, sales, postmaster as seeded)");
  }

  section("write routes need a provisioned or live order");
  {
    for (const state of ["awaiting_payment", "paid", "needs_attention"]) {
      const w = await world({ "CHK-1": { setup: { state } } });
      const token = tokenFor("CHK-1");
      const rs = [
        await call(w.router, "post", CODE_PATH, { params: { token } }),
        await call(w.router, "post", PW_PATH, { params: { token, local: "info" }, body: { password: PW } }),
        await call(w.router, "post", ADD_PATH, { params: { token }, body: { localPart: "x", code: "123456" } }),
      ];
      ok(rs.every((r) => r.statusCode === 409), `${state}: code, password and add all -> 409`);
      ok(w.sent.length === 0 && (await call(w.router, "get", P, { params: { token } })).statusCode === 200, `${state}: nothing sent, status still readable`);
    }
    const w = await world({ "CHK-1": { setup: { state: "provisioned" } } });
    const r = await call(w.router, "post", PW_PATH, { params: { token: tokenFor("CHK-1"), local: "info" }, body: { password: PW } });
    ok(r.statusCode === 200, "provisioned orders can set a password");
  }

  section("rate limiters are attached to the write routes");
  {
    const { router } = await world({ "CHK-1": {} });
    for (const [path, name] of [[CODE_PATH, "code"], [PW_PATH, "password"], [ADD_PATH, "add"]]) {
      ok(route(router, "post", path).length >= 2, `${name} route has middleware before its handler`);
    }
    ok(route(router, "post", CODE_PATH)[0].handle === router.limiters.codeLimiter, "the code route uses the stricter code limiter");
    ok(route(router, "post", PW_PATH)[0].handle === router.limiters.writeLimiter && route(router, "post", ADD_PATH)[0].handle === router.limiters.writeLimiter, "password and add share the write limiter");
    ok(route(router, "get", P).length === 1, "reads are not write-limited");
  }

  section("server.js mounts the router");
  {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
    ok(/app\.use\(require\('\.\/routes\/mailRoutes'\)\(routeContext\)\)/.test(src), "mailRoutes is mounted with routeContext");
  }

  section("no password or code in console output");
  {
    const joined = captured.join("\n");
    ok(!joined.includes(PW) && !joined.includes(PW2), "neither test password appears in any captured console line");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
