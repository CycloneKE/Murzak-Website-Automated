/**
 * Stalwart path in the email lane.
 *   node test/stalwartProvision.test.js   (or: npm test)
 */
process.env.STALWART_MOCK = "1";
delete process.env.STALWART_API_KEY;
process.env.MAIL_HOST = "mail.murzak.test";

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { makeMockFrappe } = require("./helpers/mockFrappe");
const stalwart = require("../services/email/stalwartClient");
const customerDomains = require("../services/customerDomains");
const hostingerMail = require("../services/hostingerMail");
const lane = require("../services/provisioning/lanes/emailHosting");
const { requiredRecords } = require("../services/email/mailDns");

const LIVE = "2099-01-01 00:00:00";
const SECRET = "sk-SUPERSECRETKEY123";

function seed({ domain = "acme.com", domainMode = "own", mailboxes = ["info", "sales"], noSetup = false, state = "paid" } = {}) {
  const cfg = noSetup ? {} : {
    mailSetup: {
      state, provider: "stalwart", domainMode, planId: "mail-starter", domain,
      businessName: "Acme Ltd", contactEmail: "o@gmail.com", logoUrl: "https://acme.com/logo.png",
      mailboxes: mailboxes.map((localPart) => ({ localPart, passwordSet: false })),
      progress: { payment: "done", domain: "pending", mail: "pending", webmail: "pending", dns: "pending" },
    },
  };
  return makeMockFrappe({
    "Checkout Order": {
      "CHK-1": { name: "CHK-1", web_account: "WA-1", status: "Paid", reservation_expires_at: LIVE, invoice_doc_name: "PINV-1", config_json: JSON.stringify(cfg) },
    },
  });
}
function withDomains(client, rows) {
  client.store["Customer Domain"] = {};
  rows.forEach((r, i) => { client.store["Customer Domain"][`CD-${i}`] = { name: `CD-${i}`, web_account: "WA-1", domain_name: r.domain, status: r.status, kind: "registered" }; });
  return client;
}
const cfgOf = (c) => JSON.parse(c.store["Checkout Order"]["CHK-1"].config_json);
const job = { name: "JOB-1", web_account: "WA-1", service_id: "mail-starter", invoice: "PINV-1" };

function stubs(client, over = {}) {
  const calls = [];
  const deps = {
    ensureWebmailCname: async (d) => { calls.push(["cname", d]); },
    enqueueDomain: async (c, rec) => {
      calls.push(["enqueue", rec.domain, cfgOf(client).mailSetup.state, rec.title, rec.logoUrl]);
      return { restarted: true, certReady: true };
    },
    resolver: emptyResolver(),
    ...over,
  };
  return { deps, calls };
}
// A resolver that serves exactly the records the lane should have required.
function fullResolver(domain) {
  const recs = requiredRecords(domain, { mailHost: process.env.MAIL_HOST });
  const dkim = "v=DKIM1; k=ed25519; p=MOCK";
  return {
    resolveMx: async () => [{ exchange: process.env.MAIL_HOST, priority: 10 }],
    resolveTxt: async (n) => {
      if (n.startsWith("_dmarc.")) return [[recs[2].value]];
      if (n.includes("_domainkey")) return [[dkim]];
      return [[recs[1].value]];
    },
    resolveCname: async () => [recs[3].value],
  };
}
function emptyResolver() {
  const e = async () => { const x = new Error("nodata"); x.code = "ENODATA"; throw x; };
  return { resolveMx: e, resolveTxt: e, resolveCname: e };
}
async function rejects(p) { try { await p; return null; } catch (e) { return e; } }

(async () => {
  const origList = customerDomains.listCustomerDomains;

  section("happy path: new domain");
  {
    stalwart.__resetMockForTests();
    const client = withDomains(seed({ domainMode: "new" }), [{ domain: "acme.com", status: "active" }]);
    const { deps, calls } = stubs(client, { resolver: fullResolver("acme.com") });
    const out = await lane.provision(job, { client, deps });
    ok(out.externalRef === "acme.com", "external_ref equals the mail domain");
    ok(out.access.provider === "stalwart" && out.access.lane === "emailHosting", "access provider/lane");
    ok(out.access.webmail === "https://webmail.acme.com", "webmail URL");
    ok(out.access.mailboxes === 2, "mailbox count excludes postmaster");
    ok(out.access.dnsPending === false, "dnsPending false when all records resolve");
    ok(JSON.stringify(out.access).length < 1000, "access JSON short");
    const d = await stalwart.findDomain("acme.com");
    ok(!!d, "stalwart domain exists");
    const accts = await stalwart.listAccounts(d.id);
    ok(accts.length === 3, "2 mailboxes + postmaster created");
    ok(accts.every((a) => a.quotaBytes === 5 * 1024 ** 3), "quota from plan");
    ok(!!(await stalwart.findAccount("postmaster@acme.com")), "postmaster exists");
    const enq = calls.find((c) => c[0] === "enqueue");
    ok(enq && enq[2] === "provisioned", "state provisioned BEFORE enqueueDomain");
    ok(enq && enq[3] === "Acme Ltd" && enq[4] === "https://acme.com/logo.png", "branding title and logo passed");
    ok(calls.findIndex((c) => c[0] === "cname") < calls.findIndex((c) => c[0] === "enqueue"), "cname before enqueue");
    const cfg = cfgOf(client).mailSetup;
    ok(cfg.state === "provisioned", "state ends provisioned (not live)");
    ok(["payment", "domain", "mail", "webmail", "dns"].every((k) => cfg.progress[k] === "done"), "all progress stages done");
    ok(Array.isArray(cfg.dnsRecords) && cfg.dnsRecords.some((r) => r.type === "MX") && cfg.dnsRecords.some((r) => /domainkey/.test(r.name)), "dns records (with DKIM) persisted");
    ok(cfg.dnsRecords.every((r) => !r.name.endsWith(".acme.com")), "record names are relative");

    section("re-run is idempotent");
    const out2 = await lane.provision(job, { client, deps });
    ok(JSON.stringify(out2.access) === JSON.stringify(out.access) && out2.externalRef === out.externalRef, "same result");
    ok((await stalwart.listAccounts(d.id)).length === 3, "no duplicate accounts");
  }

  section("own domain, DNS not published");
  {
    stalwart.__resetMockForTests();
    const client = seed({ domainMode: "own", domain: "own.co.ke" });
    const { deps } = stubs(client, { resolver: emptyResolver() });
    const out = await lane.provision(job, { client, deps });
    ok(out.access.dnsPending === true, "dnsPending true");
    const cfg = cfgOf(client).mailSetup;
    ok(cfg.progress.dns === "running", "progress.dns running");
    ok(cfg.state === "provisioned", "state not live");
  }

  section("domain gate");
  {
    stalwart.__resetMockForTests();
    let client = withDomains(seed({ domainMode: "new" }), [{ domain: "acme.com", status: "pending" }]);
    let e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && !e.permanent, "pending domain -> retryable");
    ok(cfgOf(client).mailSetup.progress.domain === "failed", "domain stage failed");
    client = withDomains(seed({ domainMode: "new", domain: "shop.co.ke" }), []);
    e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true, ".co.ke without active row -> permanent");
  }

  section("permanent failures");
  {
    stalwart.__resetMockForTests();
    let client = seed({ noSetup: true });
    let e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true && /mail setup/i.test(e.message), "missing mailSetup -> permanent, clear message");

    const td = stalwart.ensureDomain({ name: "taken.com", description: "murzak-order:CHK-99" });
    await stalwart.ensureAccount({ domainId: td.id, localPart: "x", quotaBytes: 1 });
    client = seed({ domain: "taken.com" });
    e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true && /already in use/.test(e.message), "domain owned by another order -> permanent");
    ok(cfgOf(client).mailSetup.progress.mail === "failed", "mail stage failed");

    const prev = process.env.MAIL_HOST;
    delete process.env.MAIL_HOST;
    client = seed({ domain: "nohost.com" });
    e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true && /MAIL_HOST/.test(e.message), "MAIL_HOST unset -> permanent");
    process.env.MAIL_HOST = prev;
  }

  section("domain ownership fails closed");
  {
    stalwart.__resetMockForTests();
    let d = await stalwart.ensureDomain({ name: "legacy.com", description: "" });
    await stalwart.ensureAccount({ domainId: d.id, localPart: "boss", quotaBytes: 1 });
    let client = seed({ domain: "legacy.com" });
    let e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true && /already in use/.test(e.message), "empty description + accounts -> permanent");
    ok((await stalwart.listAccounts(d.id)).length === 1, "no accounts created on the foreign domain");

    d = await stalwart.ensureDomain({ name: "empty.com" });
    client = seed({ domain: "empty.com" });
    e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e === null, "pre-existing domain with no accounts is claimed");
    ok((await stalwart.listAccounts(d.id)).length === 3, "accounts built on the claimed domain");

    d = await stalwart.ensureDomain({ name: "mine.com", description: "murzak-order:CHK-1" });
    await stalwart.ensureAccount({ domainId: d.id, localPart: "info", quotaBytes: 1 });
    client = seed({ domain: "mine.com" });
    e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    ok(e === null, "our own marker on re-run is fine");
  }

  section("reserved domains");
  {
    stalwart.__resetMockForTests();
    for (const dom of ["murzaktech.tech", "murzaktech.com", "murzak.test"]) {
      const client = seed({ domain: dom });
      const e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
      ok(e && e.permanent === true && /reserved/.test(e.message), dom + " refused as reserved");
      ok((await stalwart.findDomain(dom)) === null, dom + " never reached Stalwart");
    }
    process.env.MAIL_RESERVED_DOMAINS = "bank.com, other.org";
    const client = seed({ domain: "other.org" });
    const e = await rejects(lane.provision(job, { client, deps: stubs(client).deps }));
    delete process.env.MAIL_RESERVED_DOMAINS;
    ok(e && e.permanent === true, "MAIL_RESERVED_DOMAINS honoured");
  }

  section("own-domain CNAME failure is tolerated");
  {
    stalwart.__resetMockForTests();
    const boom = async () => { throw new Error("Hostinger DNS read failed for own2.com: 404"); };
    let client = seed({ domainMode: "own", domain: "own2.com" });
    const out = await lane.provision(job, { client, deps: stubs(client, { ensureWebmailCname: boom }).deps });
    const cfg = cfgOf(client).mailSetup;
    ok(out.access.dnsPending === true && cfg.state === "provisioned", "own domain still provisions, dnsPending");
    ok(cfg.dnsRecords.some((r) => r.type === "CNAME" && r.name === "webmail"), "records incl. webmail CNAME persisted");
    client = withDomains(seed({ domainMode: "new", domain: "new2.com" }), [{ domain: "new2.com", status: "active" }]);
    const e = await rejects(lane.provision(job, { client, deps: stubs(client, { ensureWebmailCname: boom }).deps }));
    ok(e && !e.permanent, "new domain CNAME failure still throws (retryable)");
  }

  section("plan mismatch and DNS check errors");
  {
    stalwart.__resetMockForTests();
    const client = seed({ domain: "plan.com" });
    const e = await rejects(lane.provision({ ...job, service_id: "mail-pro" }, { client, deps: stubs(client).deps }));
    ok(e && e.permanent === true && /plan/.test(e.message), "plan disagreement -> permanent");
    const c2 = seed({ domain: "chk.com" });
    const bad = async () => { const x = new Error("secret detail"); x.code = "ESERVFAIL"; throw x; };
    const { deps } = stubs(c2, { resolver: { resolveMx: bad, resolveTxt: bad, resolveCname: bad } });
    const out = await lane.provision(job, { client: c2, deps });
    ok(out.access.dnsPending === true && !/secret detail/.test(out.log), "resolver failure keeps pending without leaking detail");
  }

  section("Stalwart unreachable / no secrets leak");
  {
    stalwart.__resetMockForTests();
    process.env.STALWART_API_KEY = SECRET;
    let client = seed({ domain: "down.com" });
    let { deps } = stubs(client, { stalwart: { ...stalwart, ensureDomain: async () => { throw new Error("Stalwart ensureDomain transport error"); } } });
    let e = await rejects(lane.provision(job, { client, deps }));
    ok(e && !e.permanent, "unreachable -> non-permanent Error");
    ok(cfgOf(client).mailSetup.progress.mail === "failed", "progress.mail failed");

    client = seed({ domain: "leak.com" });
    ({ deps } = stubs(client, { stalwart: { ...stalwart, ensureDomain: async () => { throw new Error(`boom ${SECRET}`); } } }));
    e = await rejects(lane.provision(job, { client, deps }));
    delete process.env.STALWART_API_KEY;
    ok(e && !e.message.includes(SECRET), "key echoed by a client error is redacted");
  }

  section("provider choice");
  {
    stalwart.__resetMockForTests();
    process.env.STALWART_MOCK = "0";
    delete process.env.STALWART_API_KEY;
    const saved = process.env.HOSTINGER_API_TOKEN;
    process.env.HOSTINGER_API_TOKEN = "tok";
    ok(lane.isConfigured() === true, "lane configured via Hostinger alone");
    customerDomains.listCustomerDomains = async () => [{ name: "acme.co.ke", status: "active" }];
    const origFind = hostingerMail.findOrderForDomain;
    hostingerMail.findOrderForDomain = async () => ({ id: "ord_42", status: "active" });
    hostingerMail.getOrderPlan = async () => ({});
    hostingerMail.listMailboxes = async () => [];
    const out = await lane.provision(job, { client: {} });
    ok(out.access.provider === "hostinger", "mail plan with Stalwart unconfigured -> Hostinger path");
    hostingerMail.findOrderForDomain = origFind;
    customerDomains.listCustomerDomains = origList;
    process.env.HOSTINGER_API_TOKEN = "";
    ok(lane.isConfigured() === false, "neither provider configured -> not configured");
    process.env.STALWART_MOCK = "1";
    ok(lane.isConfigured() === true, "Stalwart alone configures the lane");
    if (saved === undefined) delete process.env.HOSTINGER_API_TOKEN; else process.env.HOSTINGER_API_TOKEN = saved;
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
