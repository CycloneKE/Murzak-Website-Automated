/**
 * End-to-end mock run of the Stalwart business-email order flow.
 *   node test/emailEndToEnd.test.js   (or: npm run test:email)
 *
 * Real modules: the orders route, mailSetupStore, the emailHosting lane and
 * stalwartProvision, mailDns, the webmail branding queue, mailLiveSweep,
 * mailAccess, the mail status routes, mailProvider and utils/mailer (its SMTP
 * transport is stubbed). Stubbed at the edge: the Stalwart server (STALWART_MOCK=1),
 * the Hostinger DNS HTTP calls, Coolify/Bulwark (env list + restart counter),
 * the DNS resolver, the webmail fetch and the clock.
 *
 * One Frappe mock and one Bulwark fake are shared by every scenario, because
 * the branding queue refuses to write a list that would drop an active client.
 *
 * DNS record CONTENT (what MX/SPF/DMARC/DKIM/CNAME must be) is covered by mailDns.test.js: the
 * resolver here serves back whatever the lane stored, so it proves the flow, not the record values.
 * The sweep's two hand-over guards are pinned individually in mailFinalFixes.test.js.
 *
 * The mail status routes are exercised by calling the router's handlers
 * directly (the same way mailRoutes.test.js does), so the express rate
 * limiters and body parsing are NOT part of this run.
 */
process.env.STALWART_MOCK = "1";
const STALWART_KEY = "sk-E2E-STALWART-KEY-do-not-log-7731";
const LINK_SECRET = "e2e-link-secret-VALUE-5c1d9a";
const HOSTINGER_TOKEN = "hostinger-e2e-token-4417";
const SMTP_PASS = "smtp-e2e-pass-9902";
process.env.STALWART_API_KEY = STALWART_KEY;
delete process.env.STALWART_URL;
process.env.MAIL_LINK_SECRET = LINK_SECRET;
process.env.HOSTINGER_API_TOKEN = HOSTINGER_TOKEN;
process.env.COOLIFY_TOKEN = "coolify-e2e-canary-6620";
process.env.MAIL_HOST = "mail.murzak.test";
process.env.APP_BASE_URL = "https://portal.murzak.test";
process.env.BULWARK_SERVICE_UUID = "svc-bulwark-uuid";
process.env.SMTP_HOST = "smtp.test.invalid";
process.env.SMTP_USER = "noreply@murzaktech.tech";
process.env.SMTP_PASS = SMTP_PASS;
process.env.SMTP_FROM_EMAIL = "noreply@murzaktech.tech";
process.env.SUPPORT_EMAIL = "support@murzaktech.tech";
process.env.BUNDLES_ENABLED = "true";
delete process.env.MAIL_NEW_DOMAIN_ENABLED;
delete process.env.MAIL_RESERVED_DOMAINS;
delete process.env.WEBMAIL_TARGET;
delete process.env.BULWARK_APP_UUID;

const realLog = console.log.bind(console);
const realError = console.error.bind(console);
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; realLog("  ok:", msg); }
  else { failed++; fails.push(msg); realError("  FAIL:", msg); }
}
function section(name) { realLog(`\n# ${name}`); }

// Everything the modules print, for the "no secret in the logs" check.
const captured = [];
for (const k of ["log", "info", "warn", "error", "debug", "trace", "dir"]) {
  console[k] = (...a) => {
    captured.push(a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" "));
  };
}

// SMTP transport stub: the real mailer code runs and its messages are captured.
const sent = [];
const nodemailer = require("nodemailer");
const transportOpts = [];
nodemailer.createTransport = (opts) => { transportOpts.push(opts); return { sendMail: async (m) => { sent.push(m); } }; };

const createOrdersRouter = require("../routes/ordersRoutes");
const createMailRouter = require("../routes/mailRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const { createOrder, getOrder, cancelOrder, linkInvoice } = require("../services/checkout/orderStore");
const { assertOrderWithinCapacity } = require("../services/orderCapacity");
const { sumSelectedServicesMonthlyKes } = require("../services/provisioning/catalog");
const lane = require("../services/provisioning/lanes/emailHosting");
const stalwart = require("../services/email/stalwartClient");
const store = require("../services/email/mailSetupStore");
const mailDns = require("../services/email/mailDns");
const webmailBranding = require("../services/email/webmailBranding");
const { runMailLiveSweep } = require("../services/email/mailLiveSweep");
const access = require("../services/email/mailAccess");
const mailer = require("../utils/mailer");

const GB = 1024 ** 3;
const PW = "Sup3rSecretPw-E2E";
const PW2 = "An0therSecretPw-E2E";
const T0 = Date.parse("2026-11-02T08:00:00Z");

/* ---------------------------- shared fakes ---------------------------- */

const client = makeMockFrappe({ "Checkout Order": {}, "Portal Invoice": {}, "Customer Domain": {} });

/** Fake Coolify service for Bulwark: an env list, a restart counter, address writes. */
const bulwark = {
  envs: [],
  restarts: 0,
  addressWrites: [],
  coolify: {
    async listEnvs() { return bulwark.envs.map((e) => ({ ...e })); },
    async createEnv(_u, { key, value }) { bulwark.envs.push({ uuid: `env-${bulwark.envs.length}`, key, value }); },
    async updateEnv(_u, { key, value }) { bulwark.envs.find((e) => e.key === key).value = value; },
    async restart() { bulwark.restarts++; return { ok: true }; },
  },
  setBulwarkAddresses: async (_u, addresses) => { bulwark.addressWrites.push(addresses); },
};
const brandingDomains = () => {
  const row = bulwark.envs.find((e) => e.key === "DOMAIN_BRANDING");
  return row ? JSON.parse(row.value) : [];
};
// The merge window is a gate the test opens, not a timer. Default: already open.
const openGate = Promise.resolve();
let mergeGate = openGate;
const brandDeps = {
  coolify: bulwark.coolify,
  setBulwarkAddresses: bulwark.setBulwarkAddresses,
  fetch: async () => ({ status: 200 }),
  sleep: (ms) => (ms === brandDeps.mergeMs ? mergeGate : Promise.resolve()),
  mergeMs: 150,
  pollIntervalMs: 1,
};

/** Fake Hostinger DNS HTTP: a zone per domain; records the CNAME writes. */
const dnsWrites = [];
const zones = new Map();
const hostingerAuthSeen = [];
const hostingerHttp = {
  async get(url, opts) {
    hostingerAuthSeen.push(String((opts && opts.headers && opts.headers.Authorization) || ""));
    const zone = decodeURIComponent(url.split("/").pop());
    return { data: zones.get(zone) || [] };
  },
  async put(url, body, opts) {
    hostingerAuthSeen.push(String((opts && opts.headers && opts.headers.Authorization) || ""));
    const zone = decodeURIComponent(url.split("/").pop());
    dnsWrites.push({ zone, body });
    const list = zones.get(zone) || [];
    for (const e of body.zone) list.push({ name: e.name, type: e.type, records: e.records });
    zones.set(zone, list);
    return {};
  },
};

/** A DNS resolver that serves exactly what the order stored as required records, once published. */
function storedResolver(orderName, published) {
  const setup = () => JSON.parse(client.store["Checkout Order"][orderName].config_json).mailSetup;
  const miss = () => { const e = new Error("ENODATA"); e.code = "ENODATA"; throw e; };
  const fq = (r, d) => (r.name === "@" ? d : `${r.name}.${d}`);
  return {
    resolveMx: async (n) => {
      const s = setup();
      if (!published.on || n !== s.domain) miss();
      const r = s.dnsRecords.find((x) => x.type === "MX");
      return [{ exchange: r.value, priority: r.priority }];
    },
    resolveTxt: async (n) => {
      const s = setup();
      const hits = published.on ? s.dnsRecords.filter((r) => r.type === "TXT" && fq(r, s.domain) === n).map((r) => [r.value]) : [];
      if (!hits.length) miss();
      return hits;
    },
    resolveCname: async (n) => {
      const s = setup();
      const hits = published.on ? s.dnsRecords.filter((r) => r.type === "CNAME" && fq(r, s.domain) === n).map((r) => r.value) : [];
      if (!hits.length) miss();
      return hits;
    },
  };
}

/* ------------------------------ helpers ------------------------------- */

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.setHeader = r.set;
  return r;
}
function findHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`No route ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function orderCtx() {
  return {
    requireAuth: (req, res, next) => next(),
    frappeClient: () => client,
    assertOrderWithinCapacity,
    getReservedRamMb: async () => 0,
    createOrder, getOrder, cancelOrder, linkInvoice,
    createAddonInvoice: async () => { throw new Error("not used"); },
    hasPaidSubscriptionForPlan: async () => false,
    fetchWebAccount: async () => ({}),
    applyPlanAndCreateInvoice: async () => ({ ok: true, skipped: true }),
    updateWebAccountServices: async () => ({}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    normalizeSelectedServices: (v) => (Array.isArray(v) ? v : []),
    findOpenInvoice: async () => null,
    normalizeInvoiceServiceRow: (r) => r,
    buildInvoiceServiceRows: (rows) => rows,
    PORTAL_INVOICE_SERVICES_FIELD: "services",
    WEB_ACCOUNT_SERVICES_FIELD: "selected_services",
    mergeServicesById: (a, b) => [...a, ...b],
    buildWebAccountServiceRows: (rows) => rows,
    CAPACITY_REQUEST_DOCTYPE: "Capacity Request",
    sumSelectedServicesMonthlyKes,
  };
}
const ordersHandler = findHandler(createOrdersRouter(orderCtx()), "post", "/api/orders");
const orderNames = () => Object.keys(client.store["Checkout Order"]);

const mailInputFor = (domain, over = {}) => ({
  planId: "mail-starter",
  domainMode: "own",
  businessName: "Acme Ltd",
  domain,
  contactEmail: "owner@gmail.com",
  mailboxes: ["info", "sales"],
  ...over,
});

let invoiceSeq = 0;
/** Place an order through the real POST /api/orders. Returns { res, orderName }. */
async function placeOrder(webAccount, mailSetup) {
  const before = new Set(orderNames());
  const res = makeRes();
  await ordersHandler({ session: { webAccount }, body: { serviceId: "mail-starter", config: {}, mailSetup } }, res);
  const orderName = orderNames().find((n) => !before.has(n)) || null;
  return { res, orderName };
}
/** The fake payment: the order and its invoice are Paid. Returns the provisioning job. */
function pay(orderName) {
  const invoice = `PINV-E2E-${++invoiceSeq}`;
  const row = client.store["Checkout Order"][orderName];
  row.status = "Paid";
  row.invoice_doc_name = invoice;
  client.store["Portal Invoice"][invoice] = { name: invoice, status: "Paid" };
  return { name: `JOB-${orderName}`, web_account: row.web_account, service_id: "mail-starter", invoice };
}
const setupOf = (orderName) => JSON.parse(client.store["Checkout Order"][orderName].config_json).mailSetup;
/** An order that exists in the store without going through the route (a lost race, a hand-edited row). */
function seedPaidOrder(name, webAccount, mailSetup) {
  const invoice = `PINV-E2E-${++invoiceSeq}`;
  client.store["Checkout Order"][name] = {
    name, web_account: webAccount, status: "Paid", reservation_expires_at: "2099-01-01 00:00:00",
    invoice_doc_name: invoice,
    config_json: JSON.stringify({ mailSetup: { state: "awaiting_payment", provider: "stalwart", mailboxes: [], progress: {}, ...mailSetup } }),
  };
  client.store["Portal Invoice"][invoice] = { name: invoice, status: "Paid" };
  return { name: `JOB-${name}`, web_account: webAccount, service_id: "mail-starter", invoice };
}
function addDomainRow(webAccount, domain, status) {
  const key = `CD-${Object.keys(client.store["Customer Domain"]).length}`;
  client.store["Customer Domain"][key] = { name: key, web_account: webAccount, domain_name: domain, status, kind: "registered" };
}
async function rejects(p) { try { await p; return null; } catch (e) { return e; } }

const dnsHttpDeps = () => ({ ensureWebmailCname: (d) => mailDns.ensureWebmailCname(d, { http: hostingerHttp }) });
const enqueue = (c, rec) => webmailBranding.enqueueDomain(c, rec, brandDeps);
const laneDeps = (resolver, extra = {}) => ({ ...dnsHttpDeps(), enqueueDomain: enqueue, resolver, ...extra });

let clockNow = T0;
const sweepStubs = {
  tests: [],
  tickets: [],
};
function sweep(resolver, over = {}) {
  return runMailLiveSweep(client, {
    resolver,
    fetch: async (url) => ({ status: 200, body: `<html><title>Acme Ltd webmail</title></html> ${url}` }),
    sendTestMessage: async (a) => { sweepStubs.tests.push(a.to); },
    sendMailReadyEmail: mailer.sendMailReadyEmail,
    raiseStaffTicket: async (c, a) => { sweepStubs.tickets.push(a.orderName); },
    now: () => clockNow,
    ...over,
  });
}
const handovers = () => sent.filter((m) => /business email is ready/i.test(m.subject || ""));
const handoversTo = (to) => handovers().filter((m) => m.to === to);
const codeMails = () => sent.filter((m) => m.subject === "Your confirmation code");

(async () => {
  stalwart.__resetMockForTests();

  /* ------------------------------------------------------------------ */
  section("1. happy path, own domain: order -> paid -> provision -> sweep live -> ONE hand-over email");
  const live1 = { domain: "acme-happy.com", orderName: null, contact: "happy@gmail.com" };
  {
    const { res, orderName } = await placeOrder("WA-HAPPY", mailInputFor(live1.domain, { contactEmail: live1.contact }));
    live1.orderName = orderName;
    ok(res.statusCode === 200 && !!orderName, "the orders route accepts the own-domain mail order");
    ok(setupOf(orderName).state === "awaiting_payment", "mailSetup is saved awaiting_payment");
    ok(setupOf(orderName).mailboxes.length === 2, "both requested mailboxes are recorded");

    const job = pay(orderName);
    const restartsBefore = bulwark.restarts;
    const published = { on: true };
    const resolver = storedResolver(orderName, published);
    const out = await lane.provision(job, { client, deps: laneDeps(resolver) });

    const s = setupOf(orderName);
    ok(s.state === "provisioned", "after the lane the order is provisioned, not yet live");
    ok(out.externalRef === live1.domain && out.access.provider === "stalwart", "external_ref is the mail domain, provider stalwart");
    ok(out.access.dnsPending === false, "DNS stub is complete, so no pending DNS");
    const dom = await stalwart.findDomain(live1.domain);
    ok(!!dom, "the domain exists in (mock) Stalwart");
    const accts = dom ? await stalwart.listAccounts(dom.id) : [];
    const addrs = accts.map((a) => a.address).sort();
    ok(addrs.join(",") === `info@${live1.domain},postmaster@${live1.domain},sales@${live1.domain}`, "2 mailboxes plus postmaster exist, nothing else");
    ok(accts.every((a) => a.quotaBytes === 5 * GB), "every account has the plan quota");
    ok(s.stalwartDomainId === (dom && dom.id), "the Stalwart domain id is recorded on the order");
    ok(["payment", "domain", "mail", "webmail", "dns"].every((k) => s.progress[k] === "done"), "all five progress stages are done");
    ok(bulwark.restarts - restartsBefore === 1, "exactly one Bulwark restart");
    ok(brandingDomains().some((d) => d.domain === live1.domain && d.title === "Acme Ltd"), "Bulwark branding carries the domain and business name");
    ok(bulwark.addressWrites.length > 0 && bulwark.addressWrites[bulwark.addressWrites.length - 1].includes(`webmail.${live1.domain}`), "the webmail address was added to Bulwark");
    const w = dnsWrites.filter((x) => x.zone === live1.domain);
    ok(w.length === 1 && w[0].body.zone[0].name === "webmail" && w[0].body.zone[0].type === "CNAME", "one webmail CNAME write went to the DNS stub");
    ok(w[0] && w[0].body.overwrite === false, "the DNS write never overwrites");
    ok(s.dnsRecords.some((r) => r.type === "MX") && s.dnsRecords.some((r) => /domainkey/.test(r.name)), "required DNS records, DKIM included, are stored");
    ok(handovers().length === 0, "no hand-over email before the sweep");

    const r1 = await sweep(resolver);
    ok(r1.wentLive === 1 && setupOf(orderName).state === "live", "the first sweep sets the order live");
    const mails = handoversTo(live1.contact);
    ok(mails.length === 1, "exactly one hand-over email, to the contact address");
    const body = `${mails[0].subject}\n${mails[0].text}\n${mails[0].html}`;
    ok(body.includes(`info@${live1.domain}`) && body.includes(`webmail.${live1.domain}`), "the email lists the mailboxes and the webmail address");
    ok(body.includes("/mail/status/"), "the email links to the status page");
    ok(!body.includes(PW) && !body.includes(STALWART_KEY) && !body.includes(LINK_SECRET) && !body.includes(SMTP_PASS), "the email carries no password or secret");
    ok(!/password\s*(is|:|=)/i.test(body), "the email never states a password");
    ok(!!setupOf(orderName).handoverSentAt, "handoverSentAt is recorded");
    const r2 = await sweep(resolver);
    ok(r2.wentLive === 0 && handoversTo(live1.contact).length === 1, "a second sweep sends nothing more");
  }

  /* ------------------------------------------------------------------ */
  section("2. own domain, DNS not published yet: dnsPending, no email; later sweep goes live with ONE email");
  const live2 = { domain: "late-dns.com", orderName: null, contact: "late@gmail.com", published: { on: false } };
  {
    const { orderName } = await placeOrder("WA-LATE", mailInputFor(live2.domain, { contactEmail: live2.contact, businessName: "Late Dns Ltd" }));
    live2.orderName = orderName;
    const job = pay(orderName);
    live2.resolver = storedResolver(orderName, live2.published);
    const out = await lane.provision(job, { client, deps: laneDeps(live2.resolver) });
    ok(out.access.dnsPending === true, "dnsPending is true while the records are missing");
    ok(setupOf(orderName).state === "provisioned" && setupOf(orderName).progress.dns === "running", "state provisioned, dns stage running");
    const r = await sweep(live2.resolver);
    ok(r.wentLive === 0 && r.stillWaiting >= 1, "the sweep keeps it waiting");
    ok(setupOf(orderName).state === "provisioned", "still provisioned after the sweep");
    ok(handoversTo(live2.contact).length === 0, "no email while DNS is missing");
    live2.published.on = true;
    const r2 = await sweep(live2.resolver);
    ok(r2.wentLive === 1 && setupOf(orderName).state === "live", "once the records exist the sweep goes live");
    ok(handoversTo(live2.contact).length === 1, "exactly one hand-over email");
    await sweep(live2.resolver);
    ok(handoversTo(live2.contact).length === 1, "still one after another sweep");
  }

  /* ------------------------------------------------------------------ */
  section("3. Stalwart down for three attempts: retryable errors, stage failed, recovery resumes without duplicates");
  {
    const domain = "flaky-host.com";
    const { orderName } = await placeOrder("WA-FLAKY", mailInputFor(domain, { contactEmail: "flaky@gmail.com" }));
    const job = pay(orderName);
    let failures = 3;
    const down = { ...stalwart, ensureDomain: async (a) => {
      if (failures-- > 0) throw new Error(`connect ECONNREFUSED stalwart (auth ${STALWART_KEY})`);
      return stalwart.ensureDomain(a);
    } };
    const published = { on: true };
    const resolver = storedResolver(orderName, published);
    for (let i = 1; i <= 3; i++) {
      const e = await rejects(lane.provision(job, { client, deps: laneDeps(resolver, { stalwart: down }) }));
      ok(e && !e.permanent, `attempt ${i}: a retryable error is thrown`);
      ok(e && !String(e.message).includes(STALWART_KEY), `attempt ${i}: the API key is scrubbed from the message`);
      ok(setupOf(orderName).progress.mail === "failed", `attempt ${i}: progress.mail is failed`);
    }
    ok(setupOf(orderName).state === "paid", "the order stays paid (not provisioned) while Stalwart is down");
    ok(!(await stalwart.findDomain(domain)), "nothing was created in Stalwart yet");
    const restartsBefore = bulwark.restarts;
    const out = await lane.provision(job, { client, deps: laneDeps(resolver, { stalwart: down }) });
    ok(out.access.dnsPending === false, "attempt 4 recovers");
    const s = setupOf(orderName);
    ok(s.state === "provisioned" && s.progress.mail === "done" && s.progress.webmail === "done", "state provisioned, failed stage now done");
    const dom = await stalwart.findDomain(domain);
    ok((await stalwart.listAccounts(dom.id)).length === 3, "exactly info, sales and postmaster, no duplicates");
    ok(bulwark.restarts - restartsBefore === 1, "one Bulwark restart for the recovered order");
    ok(dnsWrites.filter((x) => x.zone === domain).length === 1, "one webmail CNAME write");
  }

  /* ------------------------------------------------------------------ */
  section("4. job requeued after success: same result, no duplicate accounts, nothing demoted or re-sent");
  {
    const orderName = live2.orderName;
    const job = { name: "JOB-requeue", web_account: "WA-LATE", service_id: "mail-starter", invoice: client.store["Checkout Order"][orderName].invoice_doc_name };
    const before = JSON.stringify(setupOf(orderName).dnsRecords);
    const restartsBefore = bulwark.restarts;
    const dom = await stalwart.findDomain(live2.domain);
    const accountsBefore = (await stalwart.listAccounts(dom.id)).map((a) => a.id).sort().join(",");
    const o1 = await lane.provision(job, { client, deps: laneDeps(live2.resolver) });
    const o2 = await lane.provision(job, { client, deps: laneDeps(live2.resolver) });
    ok(JSON.stringify(o1.access) === JSON.stringify(o2.access) && o1.externalRef === o2.externalRef, "two further runs return the same result");
    ok((await stalwart.listAccounts(dom.id)).map((a) => a.id).sort().join(",") === accountsBefore, "the same three accounts, none added");
    ok(setupOf(orderName).state === "live", "a live order is not demoted by a rerun");
    ok(JSON.stringify(setupOf(orderName).dnsRecords) === before, "stored DNS records are unchanged");
    ok(bulwark.restarts === restartsBefore, "no extra Bulwark restart");
    ok(dnsWrites.filter((x) => x.zone === live2.domain).length === 1, "no second DNS write");
    await sweep(live2.resolver);
    ok(handoversTo(live2.contact).length === 1, "no second hand-over email");
  }

  /* ------------------------------------------------------------------ */
  section("4b. renewal: a renewal invoice for the same mail plan is a no-op and the portal still resolves");
  {
    const prevTickets = sweepStubs.tickets.length;
    const domain = live2.domain;
    const dom = await stalwart.findDomain(domain);
    const accountsBefore = (await stalwart.listAccounts(dom.id)).length;
    // The job that built the mailboxes, plus a NEWER failed job listed first (what the old lookup picked).
    client.store["Provisioning Job"] = {
      "J-FAILED": { name: "J-FAILED", web_account: "WA-LATE", service_id: "mail-starter", category: "Email Hosting", status: "needs_human", external_ref: "", access: "{}" },
      "J-BUILT": { name: "J-BUILT", web_account: "WA-LATE", service_id: "mail-starter", category: "Email Hosting", status: "active", external_ref: domain, access: JSON.stringify({ provider: "stalwart", domain }) },
    };
    const renewal = { name: "REN-77::mail-starter", web_account: "WA-LATE", service_id: "mail-starter", invoice: "REN-77" };
    const out = await lane.provision(renewal, { client, deps: laneDeps(live2.resolver) });
    ok(out.externalRef === domain && out.access.provider === "stalwart", "the renewal job returns the same externalRef and access (active, nothing built)");
    ok((await stalwart.listAccounts(dom.id)).length === accountsBefore, "no accounts were created or changed");
    ok(sweepStubs.tickets.length === prevTickets, "no staff ticket was raised");
    ok(setupOf(live2.orderName).state === "live", "the original order is untouched");

    const express = require("express");
    const createPortalRouter = require("../routes/portalRoutes");
    const rateLimit = require("express-rate-limit");
    const app = express();
    app.use((req, _res, next) => { req.session = { webAccount: "WA-LATE" }; next(); });
    app.use(createPortalRouter({
      frappeClient: () => client, requireAuth: (_q, _r, n) => n(), rateLimit, PROVISIONING_JOB_DOCTYPE: "Provisioning Job",
      getWebAccountByEmail: async () => null, mysqlDatetimeUTC: () => "", upload: { single: () => (_q, _r, n) => n() }, userOwnsPrivateFile: async () => false, SESSION_SECRET: "x",
    }));
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/portal/services/mail-starter/mailboxes`);
      const body = await res.json().catch(() => ({}));
      ok(res.status === 200 && body.ok === true, `portal mailbox list resolves to the working job, not the failed one (status ${res.status})`);
      ok(Array.isArray(body.mailboxes) && body.mailboxes.length >= 2, "and lists the mailboxes");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  /* ------------------------------------------------------------------ */
  section("4c. a payment callback delivered twice: one job, one set of accounts");
  {
    const domain = "twice-paid.com";
    const { orderName } = await placeOrder("WA-TWICE", mailInputFor(domain, { contactEmail: "twice@gmail.com" }));
    const { markOrderPaid } = require("../services/checkout/orderStore");
    const { enqueueProvisioningForInvoice } = require("../services/provisioning/provisioningService");
    const job = pay(orderName);
    await markOrderPaid({ client, orderId: orderName, nowMs: T0 });
    await markOrderPaid({ client, orderId: orderName, nowMs: T0 + 1000 });
    ok(client.store["Checkout Order"][orderName].status === "Paid", "marking the order paid twice leaves it Paid");
    // The mock Frappe ignores list filters; this wrapper applies them so the idempotency lookup is real.
    const filtering = {
      ...client,
      get: async (url, cfg) => {
        const r = await client.get(url, cfg);
        const f = cfg && cfg.params && cfg.params.filters;
        if (f && /Provisioning Job$/.test(decodeURIComponent(url))) {
          const fl = JSON.parse(f);
          r.data.data = r.data.data.filter((row) => fl.every(([k, , v]) => row[k] === v));
        }
        return r;
      },
    };
    const args = { client: filtering, webAccount: "WA-TWICE", invoiceDocName: job.invoice, serviceIds: ["mail-starter"] };
    await enqueueProvisioningForInvoice(args);
    await enqueueProvisioningForInvoice(args);
    const jobs = Object.values(client.store["Provisioning Job"] || {}).filter((j) => j.invoice === job.invoice && j.service_id === "mail-starter");
    ok(jobs.length === 1, `one provisioning job for the invoice (got ${jobs.length})`);
    const published = { on: true };
    const resolver = storedResolver(orderName, published);
    await lane.provision(job, { client, deps: laneDeps(resolver) });
    await lane.provision(job, { client, deps: laneDeps(resolver) });
    const dom = await stalwart.findDomain(domain);
    ok((await stalwart.listAccounts(dom.id)).length === 3, "one set of accounts (info, sales, postmaster)");
    ok(dnsWrites.filter((x) => x.zone === domain).length === 1, "one DNS write");
  }

  /* ------------------------------------------------------------------ */
  section("5. two orders paid at the same time: one Bulwark restart, both branded, existing client preserved");
  {
    // A client that was already live before this batch, with its own title and logo in Bulwark.
    seedPaidOrder("CHK-OLD", "WA-OLD", {
      state: "live", domainMode: "own", planId: "mail-starter", domain: "old-client.com",
      businessName: "Old Client Co", logoUrl: "https://old-client.com/logo.png",
      mailboxes: [{ localPart: "hello", passwordSet: true }],
    });
    const brandingRow = bulwark.envs.find((e) => e.key === "DOMAIN_BRANDING");
    const list = JSON.parse(brandingRow.value);
    list.push({ domain: "old-client.com", title: "Old Client Co", logoUrl: "https://old-client.com/logo.png" });
    brandingRow.value = JSON.stringify(list);

    const a = await placeOrder("WA-PAIR-A", mailInputFor("pair-a.com", { contactEmail: "a@gmail.com", businessName: "Pair A Ltd" }));
    const b = await placeOrder("WA-PAIR-B", mailInputFor("pair-b.com", { contactEmail: "b@gmail.com", businessName: "Pair B Ltd" }));
    const jobA = pay(a.orderName);
    const jobB = pay(b.orderName);
    const restartsBefore = bulwark.restarts;
    const published = { on: true };
    // Deterministic merge window: hold it shut until BOTH orders have queued, then open it.
    let release;
    mergeGate = new Promise((r) => { release = r; });
    let queued = 0;
    const countingEnqueue = (c, rec) => { queued++; return enqueue(c, rec); };
    const pa = lane.provision(jobA, { client, deps: laneDeps(storedResolver(a.orderName, published), { enqueueDomain: countingEnqueue }) });
    const pb = lane.provision(jobB, { client, deps: laneDeps(storedResolver(b.orderName, published), { enqueueDomain: countingEnqueue }) });
    while (queued < 2) await new Promise((r) => setImmediate(r));
    release();
    mergeGate = openGate;
    const [oa, ob] = await Promise.all([pa, pb]);
    ok(oa.externalRef === "pair-a.com" && ob.externalRef === "pair-b.com", "both orders provision");
    ok(bulwark.restarts - restartsBefore === 1, "one shared Bulwark restart for both");
    const doms = brandingDomains();
    ok(doms.some((d) => d.domain === "pair-a.com" && d.title === "Pair A Ltd"), "pair-a is branded");
    ok(doms.some((d) => d.domain === "pair-b.com" && d.title === "Pair B Ltd"), "pair-b is branded");
    const old = doms.find((d) => d.domain === "old-client.com");
    ok(!!old && old.title === "Old Client Co" && old.logoUrl === "https://old-client.com/logo.png", "the earlier client keeps its title and logo");
    ok([live1.domain, live2.domain].every((d) => doms.some((x) => x.domain === d)), "clients from earlier scenarios are still branded");
    const lastAddrs = bulwark.addressWrites[bulwark.addressWrites.length - 1];
    ok(["pair-a.com", "pair-b.com", "old-client.com", live1.domain].every((d) => lastAddrs.includes(`webmail.${d}`)), "the address list written holds every client");
    ok(setupOf(a.orderName).state === "provisioned" && setupOf(b.orderName).state === "provisioned", "both orders end provisioned");
  }

  /* ------------------------------------------------------------------ */
  section("6. first password needs no code; a reset needs a single-use emailed code (through the mail routes)");
  {
    const pwCalls = [];
    const realSetPassword = stalwart.setPassword;
    stalwart.setPassword = async (id, pw) => { pwCalls.push({ id, pw }); return realSetPassword(id, pw); };
    let routeNow = T0;
    const router = createMailRouter({
      frappeClient: () => client,
      mailDeps: { sendCodeEmail: mailer.sendMailCodeEmail, now: () => routeNow },
    });
    const token = access.signOrderToken(live1.orderName);
    const call = async (method, path, { body = {}, params = {} } = {}) => {
      const res = makeRes();
      await findHandler(router, method, path)({ params: { token, ...params }, body, headers: {}, ip: "127.0.0.1" }, res);
      return res;
    };
    const P = "/api/mail/status/:token";
    const PWP = "/api/mail/status/:token/mailboxes/:local/password";
    try {
      const st = await call("get", P);
      ok(st.statusCode === 200 && st.body.state === "live", "status page reads the live order");
      ok(st.body.mailboxes.every((m) => m.passwordSet === false), "no mailbox has a password yet");
      const first = await call("post", PWP, { params: { local: "info" }, body: { password: PW } });
      ok(first.statusCode === 200 && first.body.passwordSet === true, "first password set without any code");
      ok(pwCalls.length === 1 && pwCalls[0].pw === PW, "the password reached the provider once");
      ok(!JSON.stringify(first.body).includes(PW), "the response does not echo the password");

      const noCode = await call("post", PWP, { params: { local: "info" }, body: { password: PW2 } });
      ok(noCode.statusCode === 403, "a reset without a code is refused");
      ok(pwCalls.length === 1, "and changed nothing");

      const issued = await call("post", "/api/mail/status/:token/code", { body: { purpose: "reset" } });
      ok(issued.statusCode === 202 && issued.body.sent === true, "a code is requested");
      ok(codeMails().length === 1 && codeMails()[0].to === "happy@gmail.com", "one code email goes to the contact address");
      const code = (/\b(\d{6})\b/.exec(codeMails()[0].text) || [])[1];
      ok(!!code, "the email carries a 6-digit code");
      const wrong = code === "000000" ? "111111" : "000000";
      const bad = await call("post", PWP, { params: { local: "info" }, body: { password: PW2, code: wrong } });
      ok(bad.statusCode === 403 && pwCalls.length === 1, "a wrong code is refused");
      const good = await call("post", PWP, { params: { local: "info" }, body: { password: PW2, code } });
      ok(good.statusCode === 200 && pwCalls.length === 2 && pwCalls[1].pw === PW2, "the right code allows the reset");
      const again = await call("post", PWP, { params: { local: "info" }, body: { password: PW, code } });
      ok(again.statusCode === 403 && pwCalls.length === 2, "the same code cannot be used twice");
      sweepStubs.code = code;
      sweepStubs.wrong = wrong;

      // Adding a mailbox needs its own code and sets a random unknown password.
      routeNow += 120000;
      const issuedAdd = await call("post", "/api/mail/status/:token/code", { body: { purpose: "add" } });
      ok(issuedAdd.statusCode === 202 && codeMails().length === 2, "a second code is emailed for adding a mailbox");
      const addCode = (/\b(\d{6})\b/.exec(codeMails()[1].text) || [])[1];
      const noCodeAdd = await call("post", "/api/mail/status/:token/mailboxes", { body: { localPart: "billing" } });
      ok(noCodeAdd.statusCode === 403, "adding a mailbox without a code is refused");
      const added = await call("post", "/api/mail/status/:token/mailboxes", { body: { localPart: "billing", code: addCode } });
      ok(added.statusCode === 201 && added.body.address === `billing@${live1.domain}`, "adding a mailbox with the code works");
      sweepStubs.addCode = addCode;

      // T-1: every password the run used or generated must be absent from EVERY email body.
      // Generated secrets are the ones the mailbox facade handed to Stalwart (read from the spy).
      const used = new Set([PW, PW2, ...pwCalls.map((c) => c.pw)]);
      ok(used.size >= 3 && pwCalls.some((c) => c.pw !== PW && c.pw !== PW2), `collected ${used.size} distinct passwords, including a generated one`);
      ok(sent.length >= 3, `checked against ${sent.length} captured emails`);
      ok(![...used].some((pw) => sent.some((m) => `${m.subject}${m.text}${m.html}`.includes(pw))), "no password typed or generated appears in any email body");
      const firstHandover = handoversTo(live1.contact)[0];
      ok(!!firstHandover && !/password\s*(is|:|=)/i.test(firstHandover.text), "the hand-over email never states a password");
    } finally {
      stalwart.setPassword = realSetPassword;
    }
  }

  /* ------------------------------------------------------------------ */
  section("7. staff-facing safety: held domain, reserved domain and .co.ke are refused permanently");
  {
    // (a) the same domain through the route is refused for a second account...
    const dup = await placeOrder("WA-DUP", mailInputFor(live1.domain, { contactEmail: "dup@gmail.com" }));
    ok(dup.res.statusCode === 400 && dup.res.body.errors && dup.res.body.errors.domain, "a domain held by another order is refused at order time");
    // ...and if a row slips through (lost race), the lane refuses it permanently.
    const dom = await stalwart.findDomain(live1.domain);
    const accountsBefore = (await stalwart.listAccounts(dom.id)).length;
    const jobDup = seedPaidOrder("CHK-DUP", "WA-DUP", {
      domainMode: "own", planId: "mail-starter", domain: live1.domain, businessName: "Dup Ltd", contactEmail: "dup@gmail.com",
      mailboxes: [{ localPart: "info", passwordSet: false }],
    });
    const e = await rejects(lane.provision(jobDup, { client, deps: laneDeps(emptyResolver()) }));
    ok(e && e.permanent === true && /already in use by another order/.test(e.message), "the lane refuses a domain that another order's Stalwart domain holds, permanently");
    ok((await stalwart.listAccounts(dom.id)).length === accountsBefore, "the first customer's accounts are untouched");
    ok(setupOf(live1.orderName).state === "live", "the first customer's order is unaffected");

    // (b0) reserved domains are refused at ORDER time, before any payment
    for (const reserved of ["murzaktech.tech", "shop.murzaktech.tech"]) {
      const r = await placeOrder("WA-RES0", mailInputFor(reserved));
      ok(r.res.statusCode === 400 && r.res.body.code === "MAIL_DOMAIN_RESERVED" && r.res.body.error === "That domain can't be used for business email.", `${reserved} is refused at order time with MAIL_DOMAIN_RESERVED`);
      ok(!r.orderName, `${reserved}: no order is created`);
    }
    // (b) reserved domains
    for (const reserved of ["murzaktech.tech", "mail.murzaktech.tech"]) {
      const job = seedPaidOrder(`CHK-RES-${reserved.length}`, "WA-RES", {
        domainMode: "own", planId: "mail-starter", domain: reserved, businessName: "Res Ltd", contactEmail: "res@gmail.com",
        mailboxes: [{ localPart: "info", passwordSet: false }],
      });
      const er = await rejects(lane.provision(job, { client, deps: laneDeps(emptyResolver()) }));
      ok(er && er.permanent === true && /reserved/.test(er.message), `${reserved} is refused permanently as reserved`);
      ok(!(await stalwart.findDomain(reserved)), `${reserved} was never created in Stalwart`);
    }

    // (c) .co.ke with no active domain row
    const ke = seedPaidOrder("CHK-KE", "WA-KE", {
      domainMode: "new", planId: "mail-starter", domain: "kenya-shop.co.ke", businessName: "Kenya Shop", contactEmail: "ke@gmail.com",
      mailboxes: [{ localPart: "info", passwordSet: false }],
    });
    const ek = await rejects(lane.provision(ke, { client, deps: laneDeps(emptyResolver()) }));
    ok(ek && ek.permanent === true && /\.ke/.test(ek.message), "a .co.ke domain with no active row escalates permanently");
    ok(setupOf("CHK-KE").progress.domain === "failed", "the domain stage is marked failed");
    ok(!(await stalwart.findDomain("kenya-shop.co.ke")), "no Stalwart domain was created for it");
    addDomainRow("WA-KE", "kenya-shop.co.ke", "active");
    const okKe = await lane.provision(ke, { client, deps: laneDeps(emptyResolver()) });
    ok(okKe.externalRef === "kenya-shop.co.ke" && setupOf("CHK-KE").state === "provisioned", "once staff mark the domain active and requeue, it provisions");
  }

  /* ------------------------------------------------------------------ */
  section("8. a new-domain mail order is rejected unless MAIL_NEW_DOMAIN_ENABLED=1");
  {
    delete process.env.MAIL_NEW_DOMAIN_ENABLED;
    const before = orderNames().length;
    const { res } = await placeOrder("WA-NEW", mailInputFor("brand-new-shop.com", { domainMode: "new" }));
    ok(res.statusCode === 400 && res.body.code === "MAIL_NEW_DOMAIN_DISABLED", "400 with MAIL_NEW_DOMAIN_DISABLED");
    ok(orderNames().length === before, "no order is created");
    process.env.MAIL_NEW_DOMAIN_ENABLED = "1";
    const on = await placeOrder("WA-NEW", mailInputFor("brand-new-shop.com", { domainMode: "new" }));
    ok(on.res.statusCode === 200 && !!on.orderName, "with the flag on the order goes through");
    delete process.env.MAIL_NEW_DOMAIN_ENABLED;
    if (on.orderName) delete client.store["Checkout Order"][on.orderName];
  }

  /* ------------------------------------------------------------------ */
  section("no secret appears in anything the modules printed");
  {
    const text = captured.join("\n");
    ok(captured.length > 0 && /\[webmail\] restarted Bulwark/.test(text), `console capture works (${captured.length} lines)`);
    // The token that was actually EMAILED, parsed out of the hand-over email, not a freshly minted one.
    const emailedToken = (/\/mail\/status\/([A-Za-z0-9_.-]+)/.exec(handoversTo(live1.contact)[0].text) || [])[1];
    ok(!!emailedToken && access.verifyOrderToken(emailedToken).ok, "the emailed status link carries a valid token");
    // Entries must be in play: prove the code really received them before scanning for them.
    ok(hostingerAuthSeen.length > 0 && hostingerAuthSeen.every((h) => h.includes(HOSTINGER_TOKEN)), "the Hostinger token went through the real auth-header code");
    ok(transportOpts.length > 0 && transportOpts.every((o) => o && o.auth && o.auth.pass === SMTP_PASS), "the SMTP password went to the mail transport");
    const secrets = {
      STALWART_API_KEY: STALWART_KEY,
      MAIL_LINK_SECRET: LINK_SECRET,
      "Hostinger token": HOSTINGER_TOKEN,
      "SMTP password": SMTP_PASS,
      "customer password 1": PW,
      "customer password 2": PW2,
      "issued reset code": sweepStubs.code,
      "wrong code": sweepStubs.wrong,
      "issued add-mailbox code": sweepStubs.addCode,
      "emailed status token": emailedToken,
    };
    for (const [label, value] of Object.entries(secrets)) {
      ok(!!value && !text.includes(value), `${label} is not in the console output`);
    }
    ok(!codeMails().some((m) => text.includes(m.text)), "no email body is printed");
    ok(!/\b\d{6}\b/.test(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")), "no 6-digit number at all appears in the console output");
  }

  realLog(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    realError("\nFailures:");
    for (const f of fails) realError(" -", f);
    process.exit(1);
  }
})().catch((e) => {
  realError("E2E crashed:", e && e.stack ? e.stack : e);
  process.exit(1);
});

function emptyResolver() {
  const e = async () => { const x = new Error("nodata"); x.code = "ENODATA"; throw x; };
  return { resolveMx: e, resolveTxt: e, resolveCname: e };
}
