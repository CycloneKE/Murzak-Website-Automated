/**
 * Go-live sweep and hand-over trigger for Stalwart mail.
 *   node test/mailLiveSweep.test.js   (or: npm test)
 *
 * Every external dependency is injected: DNS resolver, webmail fetch, test
 * message, hand-over email, staff ticket, clock and logger. The Frappe client is
 * the shared in-memory mock. These tests pin: DNS and webmail gating, exactly
 * one hand-over email, retry after a failed send, the 72-hour staff ticket, and
 * per-order error isolation.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { makeMockFrappe } = require("./helpers/mockFrappe");
const { runMailLiveSweep, renderMailReadyEmail, HANDOVER_WAIT_MS } = require("../services/email/mailLiveSweep");

const HOUR = 3600 * 1000;
const T0 = Date.parse("2026-11-01T08:00:00Z");
const LIVE = "2099-01-01 00:00:00";
const DOMAIN = "acme.com";
const MAIL_HOST = "mail.cloud.murzaktech.tech";
const WEBMAIL_TARGET = "webmail.cloud.murzaktech.tech";

// Records as the provisioning lane stores them (stalwartProvision writes dnsRecords).
const DNS_RECORDS = Object.freeze([
  { type: "MX", name: "@", value: MAIL_HOST, priority: 10 },
  { type: "TXT", name: "@", value: "v=spf1 mx ~all" },
  { type: "TXT", name: "_dmarc", value: `v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}` },
  { type: "TXT", name: "stalwart._domainkey", value: "v=DKIM1; k=rsa; p=MIIBIJANBGKQ" },
  { type: "CNAME", name: "webmail", value: WEBMAIL_TARGET },
]);

// Fake node dns.promises-style resolver. Unknown names behave like ENODATA.
function fakeResolver({ mx = {}, txt = {}, cname = {} } = {}) {
  const miss = () => { const e = new Error("ENODATA"); e.code = "ENODATA"; throw e; };
  const pick = (table, name) => {
    const key = Object.keys(table).find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (key === undefined) miss();
    return table[key];
  };
  return {
    resolveMx: async (n) => pick(mx, n),
    resolveTxt: async (n) => pick(txt, n),
    resolveCname: async (n) => pick(cname, n),
  };
}

function goodResolver(dmarc = `v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}`, { omitDkim = false } = {}) {
  const txt = {
    [DOMAIN]: [["v=spf1 mx ~all"]],
    [`_dmarc.${DOMAIN}`]: [[dmarc]],
  };
  if (!omitDkim) txt[`stalwart._domainkey.${DOMAIN}`] = [["v=DKIM1; k=rsa; p=MIIBIJANBGKQ"]];
  return fakeResolver({
    mx: { [DOMAIN]: [{ exchange: MAIL_HOST, priority: 10 }] },
    txt,
    cname: { [`webmail.${DOMAIN}`]: [WEBMAIL_TARGET] },
  });
}

function orderRow(name, { state = "provisioned", dnsRecords = DNS_RECORDS, extra = {} } = {}) {
  return {
    name,
    web_account: `WA-${name}`,
    status: "Paid",
    reservation_expires_at: LIVE,
    invoice_doc_name: `PINV-${name}`,
    config_json: JSON.stringify({
      shopProgress: { signedIn: true },
      mailSetup: {
        state,
        provider: "stalwart",
        domainMode: "new",
        planId: "mail-starter",
        domain: DOMAIN,
        businessName: "Acme Ltd",
        contactEmail: "owner@gmail.com",
        mailboxes: [{ localPart: "info", passwordSet: true }, { localPart: "sales", passwordSet: true }],
        dnsRecords,
        progress: { payment: "done", domain: "done", mail: "done", webmail: "done", dns: "pending" },
        ...extra,
      },
    }),
  };
}

function configOf(client, name) {
  return JSON.parse(client.store["Checkout Order"][name].config_json || "{}");
}
function setupOf(client, name) {
  return configOf(client, name).mailSetup;
}

// Deps with recording fakes. `over` replaces any of them. Use the key
// sendMailReadyEmail: undefined to model a missing sender.
function makeDeps(over = {}) {
  const calls = { email: [], test: [], tickets: [], fetch: [], warns: [] };
  const state = {
    web: { status: 200, body: "<html><head><title>Acme Ltd Webmail</title></head></html>" },
    clock: T0,
    failEmail: 0,
    failTest: false,
    failTicket: false,
  };
  const deps = {
    resolver: over.resolver || goodResolver(),
    fetch: over.fetch || (async (url) => {
      calls.fetch.push(url);
      return state.web;
    }),
    sendTestMessage: over.sendTestMessage || (async (args) => {
      calls.test.push(args);
      if (state.failTest) throw new Error("smtp refused");
    }),
    sendMailReadyEmail: "sendMailReadyEmail" in over ? over.sendMailReadyEmail : (async (args) => {
      calls.email.push(args);
      if (state.failEmail > 0) { state.failEmail--; throw new Error("smtp down"); }
    }),
    raiseStaffTicket: over.raiseStaffTicket || (async (client, args) => {
      calls.tickets.push(args);
      if (state.failTicket) throw new Error("frappe down");
    }),
    statusUrlFor: (orderName) => `https://status.example/mail/status/${orderName}`,
    now: () => state.clock,
    log: { warn: (m) => calls.warns.push(String(m)), info: () => {} },
  };
  return { deps, calls, state };
}

(async () => {
  section("DNS incomplete: stays provisioned, no email");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls } = makeDeps({ resolver: goodResolver(undefined, { omitDkim: true }) });
    const r = await runMailLiveSweep(client, deps);
    ok(r.checked === 1 && r.stillWaiting === 1 && r.wentLive === 0, "one order checked, still waiting, none live");
    ok(setupOf(client, "CHK-1").state === "provisioned", "state stays provisioned");
    ok(setupOf(client, "CHK-1").progress.dns === "running", "progress.dns is running while records are missing");
    ok(calls.email.length === 0 && calls.test.length === 0, "no hand-over email and no test message");
    ok(calls.fetch.length === 0, "webmail is not probed until DNS verifies");
    ok(!setupOf(client, "CHK-1").handoverSentAt, "no handover marker");
  }

  section("DNS complete and webmail ready: live with exactly one hand-over email");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls } = makeDeps();
    const r = await runMailLiveSweep(client, deps);
    ok(r.wentLive === 1 && r.stillWaiting === 0 && r.errored === 0, "order went live, nothing waiting or errored");
    const s = setupOf(client, "CHK-1");
    ok(s.state === "live", "state is live");
    ok(s.progress.dns === "done", "progress.dns is done");
    ok(calls.fetch.length === 1 && calls.fetch[0] === "https://webmail.acme.com", "webmail probed over https at webmail.<domain>");
    ok(calls.test.length === 1 && calls.test[0].to === "info@acme.com", "test message sent to the main mailbox");
    ok(calls.email.length === 1, "exactly one hand-over email");
    const e = calls.email[0] || {};
    ok(e.to === "owner@gmail.com" && e.businessName === "Acme Ltd", "email goes to the contact with the business name");
    ok(e.webmailUrl === "https://webmail.acme.com", "email carries the webmail URL");
    ok(JSON.stringify(e.addresses) === JSON.stringify(["info@acme.com", "sales@acme.com"]), "email lists the customer mailboxes");
    ok(e.statusUrl === "https://status.example/mail/status/CHK-1", "email carries the status URL");
    ok(typeof s.handoverSentAt === "string" && s.handoverSentAt.length > 0, "handoverSentAt marker is set");
  }

  section("second sweep sends no second email");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls } = makeDeps();
    await runMailLiveSweep(client, deps);
    const r2 = await runMailLiveSweep(client, deps);
    ok(calls.email.length === 1, "still exactly one hand-over email after two sweeps");
    ok(r2.wentLive === 0, "the second sweep does not flip the order again");
    ok(calls.test.length === 1, "the test message is not re-sent");
  }

  section("email send failure: live, marker unset, next sweep retries and succeeds");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls, state } = makeDeps();
    state.failEmail = 1;
    const r1 = await runMailLiveSweep(client, deps);
    const s1 = setupOf(client, "CHK-1");
    ok(r1.wentLive === 1 && r1.errored === 0, "the failed send does not count as an errored order");
    ok(s1.state === "live", "state is still live after the failed send");
    ok(!s1.handoverSentAt, "handover marker stays unset after the failed send");
    ok(calls.warns.some((w) => /hand-over/i.test(w)), "the failed send is logged as a warning");
    const r2 = await runMailLiveSweep(client, deps);
    ok(setupOf(client, "CHK-1").handoverSentAt, "the next sweep sets the marker after the retry succeeds");
    ok(calls.email.length === 2, "the next sweep retried the email (one failed attempt, one success)");
    ok(calls.test.length === 1, "the test message was not repeated for the retry");
    ok(r2.wentLive === 0, "the retry does not count as a new go-live");
    await runMailLiveSweep(client, deps);
    ok(calls.email.length === 2, "after the marker is set, no more emails");
  }

  section("missing sendMailReadyEmail: warning, no crash, state still live");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls } = makeDeps({ sendMailReadyEmail: undefined });
    const r = await runMailLiveSweep(client, deps);
    ok(r.wentLive === 1 && r.errored === 0, "sweep completes without crashing");
    ok(setupOf(client, "CHK-1").state === "live", "state is live");
    ok(!setupOf(client, "CHK-1").handoverSentAt, "no handover marker without a sender");
    ok(calls.warns.some((w) => /sendMailReadyEmail/.test(w)), "a warning names the missing sender");
  }

  section("webmail not ready: stays provisioned, retried next sweep");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls, state } = makeDeps();
    state.web = { status: 503, body: "" };
    const r1 = await runMailLiveSweep(client, deps);
    ok(r1.stillWaiting === 1 && r1.wentLive === 0, "a 503 keeps the order waiting");
    ok(setupOf(client, "CHK-1").state === "provisioned", "state stays provisioned");
    ok(calls.email.length === 0, "no email while webmail is not ready");
    state.web = { status: 200, body: "<title>Some other site</title>" };
    const r2 = await runMailLiveSweep(client, deps);
    ok(r2.stillWaiting === 1, "a page without the client's title keeps the order waiting");
    state.web = { status: 200, body: "<title>Acme Ltd Webmail</title>" };
    const r3 = await runMailLiveSweep(client, deps);
    ok(r3.wentLive === 1 && calls.email.length === 1, "once the certificate and title are right, it goes live and emails once");
  }

  section("webmail fetch throwing is fail-soft");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps } = makeDeps({ fetch: async () => { throw new Error("ECONNRESET"); } });
    const r = await runMailLiveSweep(client, deps);
    ok(r.stillWaiting === 1 && r.errored === 0, "a network error keeps the order waiting, not errored");
  }

  section("test message failure is recorded but does not block go-live");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls, state } = makeDeps();
    state.failTest = true;
    const r = await runMailLiveSweep(client, deps);
    ok(r.wentLive === 1, "order still goes live");
    ok(setupOf(client, "CHK-1").testMessageError, "the test-message failure is recorded on the setup");
    ok(calls.email.length === 1, "hand-over email still sent");
  }

  section("waiting over 72 hours raises exactly one staff ticket");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls, state } = makeDeps({ resolver: goodResolver(undefined, { omitDkim: true }) });
    await runMailLiveSweep(client, deps);
    ok(typeof setupOf(client, "CHK-1").provisionedAt === "string", "first sweep stamps provisionedAt lazily");
    ok(!setupOf(client, "CHK-1").staffTicketAt, "no ticket before 72 hours");
    state.clock = T0 + HANDOVER_WAIT_MS + HOUR;
    const r2 = await runMailLiveSweep(client, deps);
    ok(calls.tickets.length === 1, "one staff ticket after 72 hours");
    ok(calls.tickets[0].orderName === "CHK-1" && /DNS|record/i.test(calls.tickets[0].reason), "the ticket names the order and the reason");
    ok(!!setupOf(client, "CHK-1").staffTicketAt, "staffTicketAt marker is set");
    ok(r2.stillWaiting === 1, "the order keeps waiting after the ticket");
    state.clock = T0 + HANDOVER_WAIT_MS + 2 * HOUR;
    await runMailLiveSweep(client, deps);
    ok(calls.tickets.length === 1, "a later sweep does not raise a second ticket");
  }

  section("a failed staff ticket leaves the marker unset for the next sweep");
  {
    const old = new Date(T0 - 100 * HOUR).toISOString();
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1", { extra: { provisionedAt: old } }) } });
    const { deps, calls, state } = makeDeps({ resolver: goodResolver(undefined, { omitDkim: true }) });
    state.failTicket = true;
    const r1 = await runMailLiveSweep(client, deps);
    ok(!setupOf(client, "CHK-1").staffTicketAt, "marker unset when the ticket fails");
    ok(r1.errored === 0, "a failed ticket is not counted as an errored order");
    state.failTicket = false;
    await runMailLiveSweep(client, deps);
    ok(calls.tickets.length === 2 && !!setupOf(client, "CHK-1").staffTicketAt, "the next sweep raises it and sets the marker");
  }

  section("DMARC tightened to p=quarantine still verifies");
  {
    const client = makeMockFrappe({ "Checkout Order": { "CHK-1": orderRow("CHK-1") } });
    const { deps, calls } = makeDeps({ resolver: goodResolver("v=DMARC1; p=quarantine; rua=mailto:postmaster@acme.com; pct=50") });
    const r = await runMailLiveSweep(client, deps);
    ok(r.wentLive === 1 && setupOf(client, "CHK-1").state === "live", "a quarantine DMARC policy does not block go-live");
    ok(calls.email.length === 1, "and the hand-over email still goes out once");
  }

  section("one order throwing does not stop the sweep");
  {
    const bad = orderRow("CHK-A", { dnsRecords: [{ type: "SRV", name: "_x", value: "y" }] });
    const client = makeMockFrappe({ "Checkout Order": { "CHK-A": bad, "CHK-B": orderRow("CHK-B") } });
    const { deps, calls } = makeDeps();
    const r = await runMailLiveSweep(client, deps);
    ok(r.errored === 1, "the broken order is counted as errored");
    ok(r.wentLive === 1 && setupOf(client, "CHK-B").state === "live", "the other order still goes live");
    ok(setupOf(client, "CHK-A").state === "provisioned", "the broken order stays provisioned");
    ok(calls.email.length === 1 && calls.email[0].to === "owner@gmail.com", "only the healthy order is emailed");
    ok(r.checked === 2, "both orders were examined");
  }

  section("renderMailReadyEmail escapes the business name");
  {
    const m = renderMailReadyEmail({
      to: "o@x.com", businessName: "<script>Acme & Co</script>", webmailUrl: "https://webmail.a.com",
      addresses: ["info@a.com"], statusUrl: "https://s/x", supportContact: "help@murzaktech.tech",
    });
    ok(m.subject && typeof m.text === "string" && typeof m.html === "string", "subject, text and html are produced");
    ok(!m.html.includes("<script>") && m.html.includes("&lt;script&gt;"), "html escapes the business name");
    ok(m.text.includes("info@a.com") && m.text.includes("https://webmail.a.com"), "text lists the addresses and the webmail URL");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
