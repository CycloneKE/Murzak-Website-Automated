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
const { isReservedDomain } = require("./mailReserved");
const { JOB_DOCTYPE } = require("../provisioning/constants");

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

/**
 * The account's already-active job for this plan, or null. Used to treat a
 * renewal job (no Checkout Order behind its invoice) as a no-op success.
 */
async function findActiveMailJob(client, job) {
  if (!job || !job.web_account || !job.service_id) return null;
  const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([["web_account", "=", job.web_account], ["service_id", "=", job.service_id], ["status", "=", "active"]]),
      fields: JSON.stringify(["name", "web_account", "service_id", "status", "external_ref", "access", "modified"]),
      order_by: "modified desc",
      limit_page_length: 20,
    },
  });
  const rows = res.data?.data || [];
  for (const r of rows) {
    if (r.name === job.name) continue;
    if (r.web_account !== job.web_account || r.service_id !== job.service_id) continue;
    if (String(r.status || "").toLowerCase() !== "active") continue;
    const ref = String(r.external_ref || "").trim();
    if (!ref) continue;
    let access = {};
    try { access = JSON.parse(r.access || "{}") || {}; } catch { access = {}; }
    return { externalRef: ref, access };
  }
  return null;
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
    // A renewal invoice has no Checkout Order. If this account already runs this
    // plan (an active job with a mail domain on it), there is nothing to build.
    const prior = await findActiveMailJob(client, job);
    if (prior) {
      return {
        externalRef: prior.externalRef,
        access: prior.access,
        log: `[renewal] ${prior.externalRef}: nothing to build, mail is already provisioned for this account`,
      };
    }
    throw permanent(
      `No mail setup found for invoice ${job.invoice || "(none)"}. The order has no mailSetup to build mailboxes from; ` +
        "check the Checkout Order's config, then requeue."
    );
  }
  const { orderName, setup } = found;

  // Once paid, the status page must never say "awaiting payment", whichever
  // guard below fails. A re-run never demotes an order that is further along.
  // The state is re-read here, not taken from the snapshot above: the sweep may
  // have set the order live since, and a stale write would demote it in the
  // customer's view (the hand-over itself is protected by handoverSentAt).
  async function currentState() {
    try {
      const fresh = await store.getMailSetup(client, job.invoice);
      return (fresh && fresh.setup && fresh.setup.state) || setup.state;
    } catch {
      return setup.state;
    }
  }
  {
    const st = await currentState();
    if (st !== "provisioned" && st !== "live") await store.setMailState(client, orderName, "paid");
    await store.setProgress(client, orderName, "payment", "done");
  }

  const domain = String(setup.domain || "").toLowerCase();
  const plan = PLANS[setup.planId];
  if (PLANS[job.service_id] && PLANS[job.service_id] !== plan) {
    throw permanent(`Order ${orderName} is for plan ${setup.planId || "(missing plan)"} but the job is for ${job.service_id}; refusing to guess. Fix and requeue.`);
  }
  if (!domain || !plan) {
    throw permanent(`Mail setup on ${orderName} is incomplete (domain or plan missing). Fix it and requeue.`);
  }
  const mailboxes = (Array.isArray(setup.mailboxes) ? setup.mailboxes : [])
    .map((m) => String(m && m.localPart ? m.localPart : m || "").toLowerCase())
    .filter(Boolean);

  if (isReservedDomain(domain)) {
    throw permanent(`${domain} is reserved for Murzak and cannot be provisioned as customer mail.`);
  }

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
    // Fail closed: an existing domain is ours only if it carries exactly our marker.
    // One with no accounts holds nothing, so it is safe to claim.
    // Ownership is the marker, or the Stalwart id we recorded on this order.
    const ours = d.created || d.description === marker || (setup.stalwartDomainId && setup.stalwartDomainId === d.id);
    if (!ours) {
      const existing = await stalwart.listAccounts(d.id);
      if (existing.length > 0) {
        throw permanent(`${domain} is already in use by another order. Staff must resolve the clash, then requeue.`);
      }
      // Empty, but another live order may have claimed it and not built accounts yet.
      const rival = await store.findOrderClaimingStalwartDomain(client, { stalwartDomainId: d.id, exceptOrderName: orderName });
      if (rival) {
        throw permanent(`${domain} is already in use by another order. Staff must resolve the clash, then requeue.`);
      }
    }
    // Record ownership BEFORE creating accounts, so a retry recognises its own domain.
    await store.mergeMailSetup(client, orderName, { stalwartDomainId: d.id });
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
    try {
      await ensureWebmailCname(domain);
    } catch (err) {
      // An own domain's DNS is usually not in the Murzak Hostinger account; the
      // customer adds the CNAME from the record list. A new domain must succeed.
      if (setup.domainMode !== "own") throw err;
      log.push(`[dns] webmail CNAME not written for own domain ${domain}: ${scrub(err && err.message)}`);
    }
    const dkim = await stalwart.getDkimRecord(domainId);
    records = [
      ...mailDns.requiredRecords(domain, { mailHost, webmailTarget }),
      { type: dkim.type, name: relName(dkim.name, domain), value: dkim.value },
    ];
    await store.mergeMailSetup(client, orderName, { dnsRecords: records });
    // A rerun of an order that already went live must not demote it (the customer would see
    // "provisioned" again until the next sweep). Re-read: the snapshot above may be stale.
    if ((await currentState()) !== "live") await store.setMailState(client, orderName, "provisioned");
    await enqueueDomain(client, { domain, title: setup.businessName, logoUrl: setup.logoUrl });
  });

  // (6) one DNS check; a later sweep flips the order live
  let dnsPending = true;
  let checkFailed = "";
  await store.setProgress(client, orderName, "dns", "running");
  try {
    const res = await mailDns.verifyRecords(domain, records, resolverOpt);
    dnsPending = !(res && res.ok);
  } catch (err) {
    dnsPending = true;
    checkFailed = scrub((err && err.code) || "unknown");
  }
  if (!dnsPending) await store.setProgress(client, orderName, "dns", "done");
  log.push(
    checkFailed
      ? `[dns] ${domain}: DNS check failed (${checkFailed})`
      : `[dns] ${domain}: ${dnsPending ? "records not published yet" : "records verified"}`
  );

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
