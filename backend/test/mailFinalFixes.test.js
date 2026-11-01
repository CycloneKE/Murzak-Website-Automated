/**
 * Final fix wave for Stalwart business mail: one test per finding.
 *   node test/mailFinalFixes.test.js   (or: npm run test:email)
 *
 * C1 renewal job is a no-op, I2 reserved domains at order time and paid-before-guards,
 * I3/I4 no Hostinger fall-through and no mock in production, I5 per-order write lock,
 * M1 order API whitelist, M2 wrong-code budget, M3 entitlement, M-sweep missing dnsRecords,
 * T-4 hand-over guards pinned alone.
 * (I1, the mail-plan guard on generic paid routes, is in mailPlanRoutes.test.js.)
 */
process.env.STALWART_MOCK = "1";
process.env.MAIL_LINK_SECRET = "final-fixes-secret";
process.env.MAIL_HOST = "mail.final-host.test";
delete process.env.STALWART_API_KEY;
delete process.env.MAIL_RESERVED_DOMAINS;

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }
async function rejects(p) { try { await p; return null; } catch (e) { return e; } }

const { makeMockFrappe } = require("./helpers/mockFrappe");
const store = require("../services/email/mailSetupStore");
const stalwart = require("../services/email/stalwartClient");
const lane = require("../services/provisioning/lanes/emailHosting");
const access = require("../services/email/mailAccess");
const { toApiOrder } = require("../services/checkout/orderStore");
const ent = require("../services/mailboxEntitlement");
const { getServiceMeta } = require("../services/provisioning/catalog");
const { runMailLiveSweep } = require("../services/email/mailLiveSweep");

const LIVE = "2099-01-01 00:00:00";
const VALID = { planId: "mail-starter", domainMode: "own", businessName: "Acme Ltd", domain: "acme.com", contactEmail: "o@gmail.com", mailboxes: ["info"] };
const cfgOf = (c, n) => JSON.parse(c.store["Checkout Order"][n].config_json);
const setupOf = (c, n) => cfgOf(c, n).mailSetup;
function orderClient(setup, extra = {}) {
  return makeMockFrappe({
    "Checkout Order": {
      "CHK-1": { name: "CHK-1", web_account: "WA-1", status: "Paid", reservation_expires_at: LIVE, invoice_doc_name: "PINV-1", config_json: JSON.stringify({ mailSetup: setup }), ...extra },
    },
  });
}
const noData = () => { const e = new Error("nodata"); e.code = "ENODATA"; throw e; };
const emptyResolver = () => ({ resolveMx: async () => noData(), resolveTxt: async () => noData(), resolveCname: async () => noData() });
const job = { name: "JOB-1", web_account: "WA-1", service_id: "mail-starter", invoice: "PINV-1" };

(async () => {
  section("I2a reserved domains are refused at ORDER time (check function)");
  {
    for (const d of ["murzaktech.tech", "shop.murzaktech.tech", "murzaktech.com", "final-host.test", "x.final-host.test"]) {
      const r = store.checkMailSetupInput({ ...VALID, domain: d }, new Set());
      ok(r.ok === false && r.code === "MAIL_DOMAIN_RESERVED", `${d} -> MAIL_DOMAIN_RESERVED`);
      ok(r.errors && r.errors.domain === "That domain can't be used for business email.", `${d} -> customer-safe message`);
    }
    process.env.MAIL_RESERVED_DOMAINS = "blocked.org";
    ok(store.checkMailSetupInput({ ...VALID, domain: "blocked.org" }, new Set()).code === "MAIL_DOMAIN_RESERVED", "MAIL_RESERVED_DOMAINS entries are refused too");
    delete process.env.MAIL_RESERVED_DOMAINS;
    ok(store.checkMailSetupInput(VALID, new Set()).ok === true, "an ordinary domain is still accepted");
  }

  section("I2b paid state is recorded BEFORE the guards that can refuse");
  {
    stalwart.__resetMockForTests();
    const c = orderClient({ state: "awaiting_payment", provider: "stalwart", domainMode: "own", planId: "mail-starter", domain: "murzaktech.tech", businessName: "X", contactEmail: "o@gmail.com", mailboxes: [{ localPart: "info", passwordSet: false }], progress: { payment: "pending" } });
    const e = await rejects(lane.provision(job, { client: c, deps: { resolver: emptyResolver() } }));
    ok(e && e.permanent === true && /reserved/.test(e.message), "reserved domain is refused permanently");
    ok(setupOf(c, "CHK-1").state === "paid" && setupOf(c, "CHK-1").progress.payment === "done", "state is paid and payment done, not 'awaiting payment'");
    const c2 = orderClient({ state: "awaiting_payment", provider: "stalwart", domainMode: "own", planId: "mail-pro", domain: "x.com", mailboxes: [], progress: {} });
    const e2 = await rejects(lane.provision(job, { client: c2, deps: { resolver: emptyResolver() } }));
    ok(e2 && e2.permanent === true && setupOf(c2, "CHK-1").state === "paid", "a plan mismatch also leaves the order paid");
  }

  section("snapshot race: a sweep that set the order live mid-run is not demoted");
  {
    stalwart.__resetMockForTests();
    const c = orderClient({ state: "provisioned", provider: "stalwart", domainMode: "own", planId: "mail-starter", domain: "race.com", businessName: "Race", contactEmail: "o@gmail.com", mailboxes: [{ localPart: "info", passwordSet: false }], progress: {} });
    const deps = {
      ensureWebmailCname: async () => { await store.setMailState(c, "CHK-1", "live"); },
      enqueueDomain: async () => ({ restarted: false }),
      resolver: emptyResolver(),
    };
    await lane.provision(job, { client: c, deps });
    ok(setupOf(c, "CHK-1").state === "live", "state stays live");
  }

  section("C1 a renewal job (no Checkout Order) is a no-op success");
  {
    stalwart.__resetMockForTests();
    const c = makeMockFrappe({
      "Checkout Order": {},
      "Provisioning Job": {
        "J-OTHER": { name: "J-OTHER", web_account: "WA-9", service_id: "mail-starter", status: "active", external_ref: "other.com", access: "{}" },
        "J-FAILED": { name: "J-FAILED", web_account: "WA-1", service_id: "mail-starter", status: "needs_human", external_ref: "", access: "{}" },
        "J-OK": { name: "J-OK", web_account: "WA-1", service_id: "mail-starter", status: "active", external_ref: "acme.com", access: JSON.stringify({ provider: "stalwart", domain: "acme.com" }) },
      },
    });
    const renewal = { name: "REN-1::mail-starter", web_account: "WA-1", service_id: "mail-starter", invoice: "REN-1" };
    const out = await lane.provision(renewal, { client: c, deps: {} });
    ok(out.externalRef === "acme.com" && out.access.domain === "acme.com", "returns the active job's externalRef and access");
    ok(/\[renewal\].*nothing to build/.test(out.log), "log says there is nothing to build");
    const c2 = makeMockFrappe({ "Checkout Order": {}, "Provisioning Job": { "J-OTHER": { name: "J-OTHER", web_account: "WA-9", service_id: "mail-starter", status: "active", external_ref: "other.com", access: "{}" } } });
    const e = await rejects(lane.provision(renewal, { client: c2, deps: {} }));
    ok(e && e.permanent === true && /No mail setup found/.test(e.message), "with no active job of this account it is still the permanent 'no mail setup' failure");
  }

  section("I3/I4 the in-memory Stalwart is refused in production");
  {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    stalwart.__resetMockForTests();
    ok(stalwart.isConfigured() === false, "not configured with STALWART_MOCK=1 in production");
    ok(/STALWART_MOCK/.test(stalwart.configError()) && /production/.test(stalwart.configError()), "configError names STALWART_MOCK and production");
    const e = await rejects(stalwart.ensureDomain({ name: "p.com" }));
    ok(e && /not configured/i.test(e.message), "calls fail instead of using the fake");
    const e2 = await rejects(lane.provision(job, { client: orderClient({ state: "paid" }), deps: {} }));
    ok(e2 && !e2.permanent && /^Stalwart not configured: /.test(e2.message), "the mail lane fails retryably, never falling to Hostinger");
    process.env.NODE_ENV = prev === undefined ? "test" : prev;
    stalwart.__resetMockForTests();
    ok(stalwart.isConfigured() === true, "outside production the mock still works");
  }

  section("I5 slow lane write and a passwordSet write cannot revert each other");
  {
    const base = orderClient({ state: "provisioned", domain: "a.com", mailboxes: [{ localPart: "info", passwordSet: false }], progress: {} });
    let delayed = false;
    const slow = { store: base.store, get: base.get, post: base.post, put: async (u, b) => { if (!delayed) { delayed = true; await new Promise((r) => setTimeout(r, 40)); } return base.put(u, b); } };
    await Promise.all([
      store.setProgress(slow, "CHK-1", "mail", "done"),
      store.mergeMailSetup(slow, "CHK-1", { mailboxes: [{ localPart: "info", passwordSet: true }] }),
    ]);
    const s = setupOf(base, "CHK-1");
    ok(s.mailboxes[0].passwordSet === true, "passwordSet stays true");
    ok(s.progress.mail === "done", "and the lane's progress write is kept too");
    delayed = false;
    await Promise.all([
      store.setProgress(slow, "CHK-1", "dns", "done"),
      store.updateMailboxes(slow, "CHK-1", (l) => [...l, { localPart: "sales", passwordSet: false }]),
    ]);
    const s2 = setupOf(base, "CHK-1");
    ok(s2.mailboxes.length === 2 && s2.progress.dns === "done", "updateMailboxes rebuilds from a fresh read under the lock");
  }

  section("M1 the order API shows only whitelisted mailSetup keys");
  {
    const doc = { name: "CHK-1", status: "Paid", service_id: "mail-starter", config_json: JSON.stringify({
      other: "kept",
      mailSetup: { state: "live", progress: { mail: "done" }, domain: "a.com", planId: "mail-starter", domainMode: "own", businessName: "A",
        mailboxes: [{ localPart: "info", passwordSet: true, extra: "x" }],
        codeChallenge: { hash: "h" }, codeIssuedAt: 1, codeFailures: { count: 1 }, stalwartDomainId: "d1", dnsRecords: [{}], handoverSentAt: "t", staffTicketAt: "t", contactEmail: "o@gmail.com" } }) };
    const m = toApiOrder(doc).config.mailSetup;
    ok(Object.keys(m).sort().join() === "businessName,domain,domainMode,mailboxes,planId,progress,state", "only the whitelisted keys");
    ok(JSON.stringify(m.mailboxes) === JSON.stringify([{ localPart: "info", passwordSet: true }]), "mailboxes carry only localPart and passwordSet");
    ok(toApiOrder(doc).config.other === "kept", "other config keys are untouched");
  }

  section("M2 twenty wrong codes in 24 hours lock code checks and issuing");
  {
    const c = orderClient({ state: "live", domain: "a.com", contactEmail: "o@gmail.com", businessName: "A", mailboxes: [{ localPart: "info", passwordSet: true }] });
    let now = Date.parse("2026-11-02T08:00:00Z");
    let lastCode = null;
    const deps = () => ({ now: () => now, sendCodeEmail: async (a) => { lastCode = a.code; } });
    const wrongOf = (code) => (code === "000000" ? "111111" : "000000");
    const wrong = async (n) => { for (let i = 0; i < n; i++) await access.verifyCode(c, "CHK-1", wrongOf(lastCode), deps()); };
    for (let k = 0; k < 3; k++) { now += 61000; await access.issueCode(c, "CHK-1", deps()); await wrong(5); }
    now += 61000; await access.issueCode(c, "CHK-1", deps()); await wrong(4);
    ok((await access.verifyCode(c, "CHK-1", lastCode, deps())) === true, "19 wrong codes: the right one still works");
    now += 61000; await access.issueCode(c, "CHK-1", deps());
    await wrong(1);
    ok(setupOf(c, "CHK-1").codeFailures.count === 20, "the budget is spent at 20");
    ok((await access.verifyCode(c, "CHK-1", lastCode, deps())) === false, "even the right code now returns false immediately");
    now += 61000;
    const e = await rejects(access.issueCode(c, "CHK-1", deps()));
    ok(e && e.code === "code_locked" && e.statusCode === 429, "issuing a new code is refused with 429 'locked'");
    now += 24 * 3600 * 1000 + 1000;
    ok((await rejects(access.issueCode(c, "CHK-1", deps()))) === null, "after the 24 h window a code can be issued again");
    ok((await access.verifyCode(c, "CHK-1", lastCode, deps())) === true, "and verified");
  }

  section("M3 mail-* plans do not add to the Hostinger entitlement");
  {
    const only = ent.entitlementFor([{ serviceId: "starter-email", status: "Active" }], getServiceMeta);
    const both = ent.entitlementFor([{ serviceId: "starter-email", status: "Active" }, { serviceId: "mail-starter", status: "Active" }], getServiceMeta);
    ok(only.limit > 0, "starter-email grants mailboxes");
    ok(both.limit === only.limit && both.unlimited === only.unlimited, "starter-email + mail-starter does not add up");
    const onlyMail = ent.entitlementFor([{ serviceId: "mail-pro", status: "Active" }], (id) => ({ id, category: "Email Hosting", mailboxes: 30 }));
    ok(onlyMail.limit === 0, "a mail plan alone grants nothing here, even if the meta lacks flags");
  }

  section("M-sweep an order with no stored dnsRecords raises ONE staff ticket");
  {
    const c = orderClient({ state: "provisioned", provider: "stalwart", domain: "nodns.com", businessName: "N", contactEmail: "o@gmail.com", mailboxes: [{ localPart: "info", passwordSet: false }], progress: {} });
    const tickets = [];
    const t0 = Date.parse("2026-11-02T08:00:00Z");
    const sweep = () => runMailLiveSweep(c, { resolver: emptyResolver(), fetch: async () => ({ status: 200, body: "" }), raiseStaffTicket: async (cl, a) => { tickets.push(a); }, sendTestMessage: async () => {}, sendMailReadyEmail: async () => {}, now: () => t0, log: { warn() {}, info() {} } });
    const r1 = await sweep();
    const r2 = await sweep();
    ok(r1.errored === 0 && r2.errored === 0, "no longer an error on every pass");
    ok(tickets.length === 1 && /no DNS records/.test(tickets[0].reason), "one ticket, naming the cause");
    ok(!!setupOf(c, "CHK-1").staffTicketAt, "the marker is stored");
  }

  section("T-4 each hand-over guard pinned on its own");
  {
    const records = [{ type: "MX", name: "@", value: "mail.final-host.test", priority: 10 }];
    const resolver = {
      resolveMx: async (n) => (n === "guard.com" ? [{ exchange: "mail.final-host.test", priority: 10 }] : noData()),
      resolveTxt: async () => noData(),
      resolveCname: async () => noData(),
    };
    const mk = (state, extra) => orderClient({ state, provider: "stalwart", domain: "guard.com", businessName: "G", contactEmail: "o@gmail.com", mailboxes: [{ localPart: "info", passwordSet: false }], progress: {}, dnsRecords: records, provisionedAt: "2026-11-02T08:00:00.000Z", ...extra });
    const mails = [];
    const run = (c) => runMailLiveSweep(c, { resolver, fetch: async () => ({ status: 200, body: "" }), sendTestMessage: async () => {}, sendMailReadyEmail: async (a) => { mails.push(a.to); }, raiseStaffTicket: async () => {}, now: () => Date.parse("2026-11-02T09:00:00Z"), log: { warn() {}, info() {} } });
    const a = mk("provisioned", { handoverSentAt: "2026-11-01T00:00:00.000Z" });
    const ra = await run(a);
    ok(ra.wentLive === 1 && mails.length === 0, "provisioned + marker: goes live, no email (the guard inside sendHandover)");
    const b = mk("live", { handoverSentAt: "2026-11-01T00:00:00.000Z" });
    const rb = await run(b);
    ok(rb.checked === 0 && mails.length === 0, "live + marker: skipped by the live loop");
    const c = mk("live", {});
    await run(c);
    await run(c);
    ok(mails.length === 1, "live without marker: exactly one send, then the marker stops it");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
