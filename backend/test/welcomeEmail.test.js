/**
 * Welcome email for new app shops - node test/welcomeEmail.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const we = require("../services/apps/welcomeEmail");

const NOW = Date.parse("2026-10-19T10:00:00Z");
const POS_SUFFIX = "pos.murzaktech.tech";

// Minimal Frappe double: Provisioning Jobs and Checkout Orders (lists filtered
// by = and >=, written back by name) plus Web Accounts (read by name).
function makeClient({ jobs = [], orders = [], accounts = {} } = {}) {
  const orderByName = Object.fromEntries(orders.map((o) => [o.name, o]));
  const decode = (u) => decodeURIComponent(u);
  const matches = (row, filters) =>
    filters.every(([f, op, v]) => (op === "=" ? row[f] === v : op === ">=" ? String(row[f]) >= String(v) : true));
  return {
    orders: orderByName,
    get: async (url, opts) => {
      const u = decode(url);
      const filters = JSON.parse(opts?.params?.filters || "[]");
      if (u.endsWith("/Provisioning Job")) return { data: { data: jobs.filter((j) => matches(j, filters)) } };
      if (u.endsWith("/Checkout Order")) return { data: { data: orders.filter((o) => matches(o, filters)) } };
      const one = u.match(/\/Checkout Order\/(.+)$/);
      if (one) return { data: { data: orderByName[one[1]] } };
      const m = u.match(/\/Web Account\/(.+)$/);
      if (m) {
        if (!accounts[m[1]]) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
        return { data: { data: accounts[m[1]] } };
      }
      throw new Error(`unexpected GET ${u}`);
    },
    put: async (url, body) => {
      const m = decode(url).match(/\/Checkout Order\/(.+)$/);
      if (!m || !orderByName[m[1]]) throw new Error(`unexpected PUT ${url}`);
      Object.assign(orderByName[m[1]], body);
      return { data: { data: orderByName[m[1]] } };
    },
  };
}

const modifiedNow = "2026-10-19 09:30:00";
const access = (extra = {}) =>
  JSON.stringify({ site: "x.erp.murzaktech.tech", url: `https://x.${POS_SUFFIX}`, product: "pos", posUser: "owner@example.com", posPassword: "Sup3r-Secret-Pw!", admin: "AdminPw123", ...extra });
const posJob = (o = {}) => ({ name: "PRV-1", web_account: "ACC-1", invoice: "INV-1", service_id: "biz-pos-duka", status: "active", access: access(), modified: modifiedNow, ...o });
const paidOrder = (o = {}) => ({ name: "CHK-1", status: "Paid", invoice_doc_name: "INV-1", service_id: "biz-pos-duka", web_account: "ACC-1", config_json: JSON.stringify({ app: "pos", slug: "x", shopName: "Mama Mueni Duka" }), ...o });
const account = { work_email: "holder@example.com", account_holder_name: "Mueni Kioko" };

function recorder() {
  const sent = [];
  return { sent, sendMail: async (m) => { sent.push(m); } };
}

(async () => {
  section("buildWelcomeEmail: content");
  {
    const m = we.buildWelcomeEmail({
      productName: "Murzak POS", shopName: "Mama Mueni Duka", shopUrl: "https://x.pos.murzaktech.tech",
      ownerEmail: "owner@example.com", holderName: "Mueni Kioko",
      welcomeUrl: "https://murzaktech.tech/welcome/CHK-1", portalSupportUrl: "https://murzaktech.tech/portal/support",
      supportEmail: "help@example.com",
    });
    ok(m.subject === 'Your Murzak POS shop "Mama Mueni Duka" is ready', "subject names the product and shop");
    ok(m.text.includes("https://x.pos.murzaktech.tech") && m.text.includes("owner@example.com"), "text carries the shop address and sign-in email");
    ok(m.text.includes("https://murzaktech.tech/welcome/CHK-1"), "text points to the portal page where the first password is shown");
    ok(/never send passwords by email/i.test(m.text), "text says passwords are never emailed");
    ok(m.text.includes("help@example.com") && m.text.includes("/portal/support"), "text offers both ways to reach support");
    ok(/Forgot password/.test(m.text), "text tells the owner how to choose their own password");
    ok(m.html.includes('href="https://x.pos.murzaktech.tech"'), "html links the shop address");
  }

  section("buildWelcomeEmail: user-controlled text cannot inject markup or headers");
  {
    const m = we.buildWelcomeEmail({
      productName: "Murzak POS", shopName: '<script>alert(1)</script>\r\nBcc: evil@example.com', shopUrl: "https://x.pos.murzaktech.tech",
      ownerEmail: "o@example.com", holderName: '"><img src=x onerror=1>',
      welcomeUrl: "https://murzaktech.tech/welcome/CHK-1", portalSupportUrl: "https://murzaktech.tech/portal/support", supportEmail: "h@example.com",
    });
    ok(!m.html.includes("<script>") && !m.html.includes("<img"), "html escapes a hostile shop and holder name");
    ok(!/[\r\n]/.test(m.subject), "subject has no line breaks (no header injection)");
  }

  section("the page and the email give the same first steps");
  {
    const ts = require("fs").readFileSync(require("path").join(__dirname, "../../frontend/src/config/appCheckout.ts"), "utf8");
    const block = ts.match(/nextSteps:\s*\[([\s\S]*?)\]/);
    const pageSteps = block ? [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : [];
    ok(pageSteps.length > 0, "found nextSteps in frontend/src/config/appCheckout.ts");
    ok(JSON.stringify(pageSteps) === JSON.stringify(we.NEXT_STEPS), "the ready screen and the email list identical steps");
  }

  section("safeShopUrl");
  {
    ok(we.safeShopUrl("https://x.pos.murzaktech.tech", POS_SUFFIX) === "https://x.pos.murzaktech.tech", "accepts a shop address");
    ok(we.safeShopUrl("https://x.pos.murzaktech.tech/path?q=1", POS_SUFFIX) === "https://x.pos.murzaktech.tech", "drops path and query");
    ok(we.safeShopUrl("http://x.pos.murzaktech.tech", POS_SUFFIX) === "", "rejects http");
    ok(we.safeShopUrl("https://evil.example.com", POS_SUFFIX) === "", "rejects another host");
    ok(we.safeShopUrl("https://pos.murzaktech.tech.evil.com", POS_SUFFIX) === "", "rejects a look-alike host");
    ok(we.safeShopUrl("https://pos.murzaktech.tech", POS_SUFFIX) === "", "rejects the bare suffix (not a shop)");
    ok(we.safeShopUrl("javascript:alert(1)", POS_SUFFIX) === "" && we.safeShopUrl("", POS_SUFFIX) === "", "rejects junk");
  }

  section("welcomeDecision");
  {
    ok(we.welcomeDecision({}, NOW).send === true, "no marker: send");
    ok(we.welcomeDecision({ welcomeEmail: { state: "sent" } }, NOW).send === false, "sent: never again");
    ok(we.welcomeDecision({ welcomeEmail: { state: "sending", at: new Date(NOW - 60000).toISOString() } }, NOW).send === false, "fresh sending: leave it");
    ok(we.welcomeDecision({ welcomeEmail: { state: "sending", at: new Date(NOW - 2 * we.SENDING_STALE_MS).toISOString() } }, NOW).send === true, "stale sending: retry");
    ok(we.welcomeDecision({ welcomeEmail: { state: "failed", attempts: 1 } }, NOW).send === true, "failed once: retry");
    ok(we.welcomeDecision({ welcomeEmail: { state: "failed", attempts: we.MAX_ATTEMPTS } }, NOW).send === false, "failed MAX times: give up");
  }

  section("sweep: sends once, to the owner, with no password");
  {
    const client = makeClient({ jobs: [posJob()], orders: [paidOrder()], accounts: { "ACC-1": account } });
    const r = recorder();
    const out = await we.sweepWelcomeEmails(client, { sendMail: r.sendMail, nowMs: NOW, appBaseUrl: "https://murzaktech.tech", supportEmail: "help@example.com" });
    ok(out.sent === 1 && r.sent.length === 1, "one email sent");
    ok(r.sent[0].to === "owner@example.com", "addressed to the shop owner's sign-in email");
    ok(r.sent[0].text.includes("Mama Mueni Duka") && r.sent[0].text.includes("Mueni Kioko"), "uses the shop name and the account holder's name");
    ok(r.sent[0].text.includes("/welcome/CHK-1"), "links the order's welcome page");
    const everything = JSON.stringify(r.sent[0]);
    ok(!everything.includes("Sup3r-Secret-Pw!") && !everything.includes("AdminPw123"), "neither the owner password nor the admin password is in the email");
    const marker = JSON.parse(client.orders["CHK-1"].config_json);
    ok(marker.welcomeEmail.state === "sent" && marker.app === "pos" && marker.shopName === "Mama Mueni Duka", "marker saved and the rest of the order config preserved");

    const again = await we.sweepWelcomeEmails(client, { sendMail: r.sendMail, nowMs: NOW + 120000 });
    ok(again.sent === 0 && r.sent.length === 1, "a second sweep sends nothing");
  }

  section("sweep: who is skipped");
  {
    const cases = [
      ["a non-app active job", { jobs: [posJob({ service_id: "biz-web-hosting" })], orders: [paidOrder()] }],
      ["a job with no app order (portal add-on)", { jobs: [posJob()], orders: [] }],
      ["an order that is not Paid", { jobs: [posJob()], orders: [paidOrder({ status: "Draft" })] }],
      ["an order that is not an app order", { jobs: [posJob()], orders: [paidOrder({ config_json: "{}" })] }],
      ["a job that is not active yet", { jobs: [posJob({ status: "needs_human" })], orders: [paidOrder()] }],
      ["a job older than the lookback window", { jobs: [posJob({ modified: "2026-10-01 00:00:00" })], orders: [paidOrder()] }],
      ["an address that is not on the shop host", { jobs: [posJob({ access: access({ url: "https://evil.example.com" }) })], orders: [paidOrder()] }],
      ["unparseable access", { jobs: [posJob({ access: '{"url":"https://x.pos' })], orders: [paidOrder()] }],
    ];
    for (const [label, data] of cases) {
      const r = recorder();
      const out = await we.sweepWelcomeEmails(makeClient({ ...data, accounts: { "ACC-1": account } }), { sendMail: r.sendMail, nowMs: NOW });
      ok(out.sent === 0 && r.sent.length === 0, `skips ${label}`);
    }
  }

  section("sweep: recipient fallback");
  {
    const client = makeClient({ jobs: [posJob({ access: access({ posUser: "" }) })], orders: [paidOrder()], accounts: { "ACC-1": account } });
    const r = recorder();
    await we.sweepWelcomeEmails(client, { sendMail: r.sendMail, nowMs: NOW });
    ok(r.sent[0]?.to === "holder@example.com", "no owner email on the job: falls back to the account's work email");

    const none = makeClient({ jobs: [posJob({ access: access({ posUser: "" }) })], orders: [paidOrder()], accounts: {} });
    const r2 = recorder();
    const o2 = await we.sweepWelcomeEmails(none, { sendMail: r2.sendMail, nowMs: NOW });
    ok(r2.sent.length === 0 && o2.skipped === 1, "no usable address anywhere: skipped, not guessed");
  }

  section("sweep: failures retry a few times, then stop");
  {
    const client = makeClient({ jobs: [posJob()], orders: [paidOrder()], accounts: { "ACC-1": account } });
    let calls = 0;
    const failing = async () => { calls++; throw new Error("550 mailbox unavailable"); };
    for (let i = 0; i < 6; i++) await we.sweepWelcomeEmails(client, { sendMail: failing, nowMs: NOW + i * 60000 });
    ok(calls === we.MAX_ATTEMPTS, `gave up after ${we.MAX_ATTEMPTS} attempts (made ${calls})`);
    const m = JSON.parse(client.orders["CHK-1"].config_json).welcomeEmail;
    ok(m.state === "failed" && m.attempts === we.MAX_ATTEMPTS && /550/.test(m.error), "marker records the attempts and the reason");
  }

  section("sweep: a platform-wide SMTP gap does not burn the shop's attempts");
  {
    const client = makeClient({ jobs: [posJob()], orders: [paidOrder()], accounts: { "ACC-1": account } });
    const noSmtp = async () => { throw new Error("SMTP env vars missing: SMTP_HOST/SMTP_USER/SMTP_PASS"); };
    for (let i = 0; i < 5; i++) await we.sweepWelcomeEmails(client, { sendMail: noSmtp, nowMs: NOW + i * 60000 });
    const cfg = JSON.parse(client.orders["CHK-1"].config_json);
    ok(cfg.welcomeEmail === undefined, "marker cleared again, so nothing is lost");
    const r = recorder();
    const out = await we.sweepWelcomeEmails(client, { sendMail: r.sendMail, nowMs: NOW + 400000 });
    ok(out.sent === 1, "once SMTP is configured, the shop still gets its welcome email");
  }

  section("sweep: a stuck 'sending' claim is retried; a fresh one is respected");
  {
    const stale = paidOrder({ config_json: JSON.stringify({ app: "pos", shopName: "S", welcomeEmail: { state: "sending", at: new Date(NOW - 3600000).toISOString() } }) });
    const r = recorder();
    await we.sweepWelcomeEmails(makeClient({ jobs: [posJob()], orders: [stale], accounts: { "ACC-1": account } }), { sendMail: r.sendMail, nowMs: NOW });
    ok(r.sent.length === 1, "stale claim (a sweep that died) is retried");

    const fresh = paidOrder({ config_json: JSON.stringify({ app: "pos", shopName: "S", welcomeEmail: { state: "sending", at: new Date(NOW - 30000).toISOString() } }) });
    const r2 = recorder();
    await we.sweepWelcomeEmails(makeClient({ jobs: [posJob()], orders: [fresh], accounts: { "ACC-1": account } }), { sendMail: r2.sendMail, nowMs: NOW });
    ok(r2.sent.length === 0, "fresh claim (another sweep is sending) is left alone");
  }

  section("sweep: one bad job does not stop the rest, and Frappe errors never throw");
  {
    const j2 = posJob({ name: "PRV-2", invoice: "INV-2", access: access({ posUser: "second@example.com", url: `https://y.${POS_SUFFIX}` }) });
    const o2 = paidOrder({ name: "CHK-2", invoice_doc_name: "INV-2" });
    const base = makeClient({ jobs: [posJob(), j2], orders: [paidOrder(), o2], accounts: { "ACC-1": account } });
    const flaky = { ...base, put: async (url, body) => { if (url.includes("CHK-1")) throw new Error("frappe down"); return base.put(url, body); } };
    const r = recorder();
    const out = await we.sweepWelcomeEmails(flaky, { sendMail: r.sendMail, nowMs: NOW });
    ok(out.failed === 1 && r.sent.some((m) => m.to === "second@example.com"), "the second shop is still emailed");

    const broken = { get: async () => { throw new Error("connection refused"); } };
    const out2 = await we.sweepWelcomeEmails(broken, { sendMail: async () => {}, nowMs: NOW });
    ok(out2.error === "connection refused" && out2.sent === 0, "a failed job query is reported, not thrown");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
