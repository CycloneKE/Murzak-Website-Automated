// services/email/stalwartProvision.js
//
// The Stalwart path of the email lane. Each step is idempotent, so a retry
// after any failure picks up where the last run stopped:
//
//   domain gate -> Stalwart domain -> accounts -> DNS records -> webmail -> DNS check
//
// It never waits for customer DNS and never sets the order live. A later sweep
// flips the order live once the records verify.
//
// Failure rules: a failing step marks its progress stage "failed" and rethrows.
// Errors are retryable unless marked `.permanent`. No secret appears in a
// thrown message (the API key is scrubbed from every message).

const { PLANS } = require("../../config/emailPlans");
const store = require("./mailSetupStore");
const mailDns = require("./mailDns");
const webmailBranding = require("./webmailBranding");
const stalwartClient = require("./stalwartClient");

const POSTMASTER = "postmaster";
const ORDER_MARKER = "murzak-order:";
const DEFAULT_OUTBOUND_PER_HOUR = 100;

function permanent(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

/** Remove the Stalwart API key from a message, whatever produced it. */
function scrub(message) {
  let text = String(message == null ? "" : message);
  const key = process.env.STALWART_API_KEY;
  if (key) text = text.split(key).join("[redacted]");
  return text;
}

function clean(err) {
  const msg = scrub(err && err.message);
  if (err && err.message === msg) return err;
  const out = new Error(msg);
  if (err && err.permanent) out.permanent = true;
  return out;
}

function outboundLimit() {
  const n = Number.parseInt(process.env.MAIL_OUTBOUND_PER_HOUR || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OUTBOUND_PER_HOUR;
}

/** Relative record name for display and verification ("default._domainkey", "@"). */
function relName(name, zone) {
  const n = String(name || "").toLowerCase().replace(/\.$/, "");
  if (!n || n === "@" || n === zone) return "@";
  return n.endsWith(`.${zone}`) ? n.slice(0, -(zone.length + 1)) : n;
}

async function provision(job, opts = {}) {
  const client = opts.client;
  if (!client) throw new Error("emailHosting lane requires a Frappe client to read the mail setup");
  const deps = opts.deps || {};
  const stalwart = deps.stalwart || stalwartClient;
  const ensureWebmailCname = deps.ensureWebmailCname || mailDns.ensureWebmailCname;
  const enqueueDomain = deps.enqueueDomain || webmailBranding.enqueueDomain;
  const resolverOpt = deps.resolver ? { resolver: deps.resolver } : {};
  const log = [];

  // (0) load the setup
  const found = await store.getMailSetup(client, job.invoice);
  if (!found) {
    throw permanent(
      `No mail setup found for invoice ${job.invoice || "(none)"}. The order has no mailSetup to build mailboxes from; ` +
        "check the Checkout Order's config, then requeue."
    );
  }
  const { orderName, setup } = found;
  const domain = String(setup.domain || "").toLowerCase();
  const plan = PLANS[setup.planId] || PLANS[job.service_id];
  if (!domain || !plan) {
    throw permanent(`Mail setup on ${orderName} is incomplete (domain or plan missing). Fix it and requeue.`);
  }
  const mailboxes = (Array.isArray(setup.mailboxes) ? setup.mailboxes : [])
    .map((m) => String(m && m.localPart ? m.localPart : m || "").toLowerCase())
    .filter(Boolean);

  // Do not demote an order that already got past "paid" (a re-run).
  if (setup.state !== "provisioned" && setup.state !== "live") {
    await store.setMailState(client, orderName, "paid");
  }
  await store.setProgress(client, orderName, "payment", "done");

  async function stage(name, fn) {
    await store.setProgress(client, orderName, name, "running");
    try {
      const value = await fn();
      await store.setProgress(client, orderName, name, "done");
      return value;
    } catch (err) {
      try { await store.setProgress(client, orderName, name, "failed"); } catch { /* keep the original error */ }
      throw clean(err);
    }
  }

  // (1) domain gate
  await stage("domain", () =>
    store.waitForDomain(client, { webAccount: job.web_account, domain, domainMode: setup.domainMode })
  );

  // (2) + (3) Stalwart domain and accounts
  const domainId = await stage("mail", async () => {
    const marker = `${ORDER_MARKER}${orderName}`;
    const d = await stalwart.ensureDomain({ name: domain, description: marker });
    if (!d.created && d.description && d.description !== marker) {
      throw permanent(`${domain} is already in use by another order. Staff must resolve the clash, then requeue.`);
    }
    const quotaBytes = plan.quotaGb * 1024 ** 3;
    const names = [...new Set([...mailboxes, POSTMASTER])];
    const perHour = outboundLimit();
    for (const localPart of names) {
      const acct = await stalwart.ensureAccount({ domainId: d.id, localPart, quotaBytes });
      await stalwart.setOutboundLimit(acct.id, perHour);
    }
    log.push(`[stalwart] ${domain}: ${mailboxes.length} mailbox(es) + postmaster ready`);
    return d.id;
  });

  // (4) DNS records, webmail CNAME, then branding. Provisioned must be set before enqueueDomain.
  let records;
  await stage("webmail", async () => {
    const mailHost = process.env.MAIL_HOST;
    if (!mailHost) throw permanent("MAIL_HOST is not set; cannot build the MX record. Set it and requeue.");
    const webmailTarget = process.env.WEBMAIL_TARGET || mailDns.DEFAULT_WEBMAIL_TARGET;
    await ensureWebmailCname(domain);
    const dkim = await stalwart.getDkimRecord(domainId);
    records = [
      ...mailDns.requiredRecords(domain, { mailHost, webmailTarget }),
      { type: dkim.type, name: relName(dkim.name, domain), value: dkim.value },
    ];
    await store.mergeMailSetup(client, orderName, { dnsRecords: records });
    await store.setMailState(client, orderName, "provisioned");
    await enqueueDomain(client, { domain, title: setup.businessName, logoUrl: setup.logoUrl });
  });

  // (6) one DNS check; a later sweep flips the order live
  let dnsPending = true;
  await store.setProgress(client, orderName, "dns", "running");
  try {
    const res = await mailDns.verifyRecords(domain, records, resolverOpt);
    dnsPending = !(res && res.ok);
  } catch {
    dnsPending = true;
  }
  if (!dnsPending) await store.setProgress(client, orderName, "dns", "done");
  log.push(`[dns] ${domain}: ${dnsPending ? "records not published yet" : "records verified"}`);

  return {
    externalRef: domain,
    access: {
      lane: "emailHosting",
      provider: "stalwart",
      domain,
      webmail: `https://webmail.${domain}`,
      mailboxes: mailboxes.length,
      dnsPending,
    },
    log: log.join("\n"),
  };
}

module.exports = { provision, ORDER_MARKER, POSTMASTER };
