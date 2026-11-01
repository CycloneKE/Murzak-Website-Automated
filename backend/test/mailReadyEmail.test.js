/**
 * Hand-over email and confirmation-code email for Stalwart business mail.
 *   node test/mailReadyEmail.test.js   (or: npm test)
 *
 * The SMTP transport is stubbed at nodemailer.createTransport, so the real
 * sendMail path (from, to, subject, text, html) runs and is captured.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

process.env.SMTP_HOST = "smtp.test.invalid";
process.env.SMTP_USER = "noreply@murzaktech.tech";
process.env.SMTP_PASS = "transport-test-pass";
process.env.SMTP_FROM_EMAIL = "noreply@murzaktech.tech";
process.env.SUPPORT_EMAIL = "support@murzaktech.tech";

const sent = [];
const nodemailer = require("nodemailer");
nodemailer.createTransport = () => ({
  sendMail: async (m) => { sent.push(m); },
});

const mailer = require("../utils/mailer");

const VENDOR = /hostinger|stalwart|bulwark|coolify/i;
const STATUS = "https://portal.example.com/mail/status/TOKEN123";
const WEBMAIL = "https://webmail.acme.com";
const ADDRESSES = ["info@acme.com", "sales@acme.com"];

async function captured(fn) {
  const before = sent.length;
  await fn();
  return sent[before];
}

(async () => {
  section("sendMailReadyEmail: hand-over content");
  {
    const m = await captured(() => mailer.sendMailReadyEmail({
      to: "owner@gmail.com",
      businessName: "Acme Ltd",
      webmailUrl: WEBMAIL,
      addresses: ADDRESSES,
      statusUrl: STATUS,
      supportContact: "support@murzaktech.tech",
    }));
    ok(m && m.to === "owner@gmail.com", "sent to the contact address");
    ok(m.subject === "Your business email is ready — Acme Ltd", "subject names the business, no vendor names");
    ok(!VENDOR.test(m.subject), "subject carries no vendor name");
    ok(!VENDOR.test(m.text), "body carries no vendor name");
    ok(m.text.includes("Acme Ltd"), "body contains the business name");
    ok(m.text.includes(WEBMAIL), "body contains the webmail URL");
    ok(ADDRESSES.every((a) => m.text.includes(a)), "body lists every mailbox address");
    ok(m.text.includes(STATUS), "body contains the status-page link");
    ok(/Add to my phone/.test(m.text), "body points to the 'Add to my phone' section of the status page");
    ok(/detected automatically/i.test(m.text), "body says the account is detected automatically");
    ok(!/imap\.|smtp\.|pop\.|mx\./i.test(m.text), "body needs no technical hostnames");
    ok(/password/i.test(m.text) && /status page/i.test(m.text), "body says mailboxes need a password set from the status page first");
    ok(/not spam/i.test(m.text) && /spam/i.test(m.text), "body carries the deliverability / not-spam note");
    ok(/build trust/i.test(m.text), "deliverability note explains new domains build trust over days");
    ok(m.text.includes("support@murzaktech.tech"), "body carries the support contact");
    ok(typeof m.html === "string" && m.html.includes(STATUS), "html part carries the status link too");
  }

  section("sendMailReadyEmail: never carries a password");
  {
    const m = await captured(() => mailer.sendMailReadyEmail({
      to: "owner@gmail.com",
      businessName: "Acme Ltd",
      webmailUrl: WEBMAIL,
      addresses: ADDRESSES,
      statusUrl: STATUS,
      supportContact: "support@murzaktech.tech",
      password: "Hunter2-Secret!",
      mailboxPassword: "Hunter2-Secret!",
    }));
    ok(!m.text.includes("Hunter2-Secret!") && !m.html.includes("Hunter2-Secret!"), "an extra password argument never appears in the output");
    ok(!/password\s*:\s*\S/i.test(m.text) && !/password\s*:\s*\S/i.test(m.html), "no 'password: <value>' pair in the body");
  }

  section("sendMailReadyEmail: HTML escaping");
  {
    const m = await captured(() => mailer.sendMailReadyEmail({
      to: "owner@gmail.com",
      businessName: "Acme <b>&</b> Ltd",
      webmailUrl: WEBMAIL,
      addresses: ADDRESSES,
      statusUrl: STATUS,
      supportContact: "support@murzaktech.tech",
    }));
    ok(!m.html.includes("<b>&</b>"), "a raw businessName is not injected into html");
    ok(m.html.includes("Acme &lt;b&gt;&amp;&lt;/b&gt; Ltd"), "businessName is HTML-escaped in html");
  }

  section("sendMailCodeEmail: confirmation code");
  {
    const m = await captured(() => mailer.sendMailCodeEmail({
      to: "owner@gmail.com",
      code: "482913",
      purpose: "reset",
      businessName: "Acme Ltd",
    }));
    ok(m && m.to === "owner@gmail.com", "sent to the contact address");
    ok(m.subject === "Your confirmation code", "subject is 'Your confirmation code'");
    ok(m.text.includes("482913"), "body contains the 6-digit code");
    ok(m.html.includes("482913"), "html part contains the code");
    ok(m.text.includes("reset a mailbox password"), "a reset code says it is to reset a mailbox password");
    ok(/10 minutes/.test(m.text), "says the code expires in 10 minutes");
    ok(/ignore/i.test(m.text), "says it can be ignored if the customer did not ask for it");
    ok(!/https?:\/\//.test(m.text) && !/https?:\/\//.test(m.html), "no link in the code email");
    ok(!/href=/i.test(m.html), "no href in the html part");
    ok(!m.text.includes("/mail/status/"), "no status link in the code email");
  }

  section("sendMailCodeEmail: add purpose");
  {
    const m = await captured(() => mailer.sendMailCodeEmail({
      to: "owner@gmail.com",
      code: "000123",
      purpose: "add",
      businessName: "Acme Ltd",
    }));
    ok(m.text.includes("add a mailbox"), "an add code says it is to add a mailbox");
    ok(!m.text.includes("reset a mailbox password"), "and does not mention a reset");
    ok(m.text.includes("000123"), "leading zeros in the code are kept");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e.message); process.exit(1); });
