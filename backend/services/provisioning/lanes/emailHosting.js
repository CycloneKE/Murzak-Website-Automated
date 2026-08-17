/**
 * Lane — Email Hosting.
 *
 * Email hosting runs on HOSTINGER's infrastructure, not our VPS. That is the
 * whole point of this lane existing: before it, every volume-class Email
 * Hosting product fell through to the coolify lane, which built a meaningless
 * container AND reserved 256-384MB on our RAM-capped box for a product that
 * consumes none of it — while provisioning no email whatsoever. Same bug class
 * the catalog already documents for Domain Registration; email slipped past
 * that guard because it declares a non-zero ramMb.
 *
 * What this lane can and cannot do, established by probing the live API:
 *
 *   automatable   look up plans/prices, list mail orders, create mailboxes,
 *                 set mailbox passwords, delete mailboxes, aliases/forwarders,
 *                 and the MX/SPF/DKIM records (via the DNS API we already use)
 *   NOT available binding a domain to a mail order. Purchase items are
 *                 {itemId, quantity} only — no domain field — and the mail
 *                 Orders API is read-only (no create, no attach-domain).
 *                 Mailbox addresses derive from "the domain of the order", so
 *                 that binding has to happen in hPanel by hand.
 *
 * So provision() is a reconciler, not a builder: if a mail order already
 * serves the customer's domain, the service goes active and mailbox management
 * is available. If not, it escalates to a human with the exact plan id to buy
 * and the manual step to perform — rather than reporting success for a mailbox
 * the customer cannot actually use.
 *
 * Deliberately does NOT auto-purchase. POST /api/billing/v1/orders spends real
 * money on the payment method on file, and buys nothing usable on its own
 * because the domain binding still needs a human. Automating the spend would
 * add risk for zero workflow gain.
 *
 * Required env: HOSTINGER_API_TOKEN (needs email/billing scope, same token the
 * DNS and domain-availability paths use).
 */

const hostingerMail = require("../../hostingerMail");
const customerDomains = require("../../customerDomains");

const lane = "emailHosting";

function isConfigured() {
  return hostingerMail.isConfigured();
}

function configError() {
  return hostingerMail.configError();
}

function permanent(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

/**
 * The domain this mailbox service should live on. Email is meaningless without
 * one, so a missing domain is a permanent failure (a retry cannot conjure one)
 * that tells staff exactly what to collect from the customer.
 *
 * Prefers a domain already attached to this service, then any active domain on
 * the account — matching how the portal treats domain ownership.
 */
async function resolveDomain(client, job) {
  let rows = [];
  try {
    rows = await customerDomains.listCustomerDomains(client, job.web_account);
  } catch (e) {
    throw new Error(`Could not read domains for ${job.web_account}: ${e.message}`);
  }
  const domains = Array.isArray(rows) ? rows : [];

  const attached = domains.find(
    (d) => d?.attachedServiceId === job.service_id && d?.name
  );
  if (attached) return String(attached.name).toLowerCase();

  const active = domains.find(
    (d) => d?.name && String(d?.status || "").toLowerCase() === "active"
  );
  if (active) return String(active.name).toLowerCase();

  const any = domains.find((d) => d?.name);
  if (any) return String(any.name).toLowerCase();

  throw permanent(
    `Email hosting needs a domain but ${job.web_account} has none on file. ` +
      `Collect the customer's domain (or sell them one) and attach it to this service, then requeue.`
  );
}

/** Human-readable "buy this" hint, best-effort — never fails the escalation. */
async function purchaseHint() {
  try {
    const plans = await hostingerMail.listEmailPlans();
    if (!plans.length) return "";
    const lines = plans.map((p) => {
      const price = p.prices[0];
      const cost = price
        ? ` (${price.currency} ${(Number(price.amountMinor) / 100).toFixed(2)} / ${price.period} ${price.periodUnit || "period"})`
        : "";
      return `${p.id}${cost}`;
    });
    return ` Available Hostinger plans: ${lines.join("; ")}.`;
  } catch (e) {
    return "";
  }
}

/**
 * Reconcile the customer's email hosting against Hostinger.
 *
 * Returns active only when a real mail order is bound to their domain — the
 * one condition under which mailboxes can actually be created.
 */
async function provision(job, opts = {}) {
  const client = opts.client;
  if (!client) {
    // The runner owns the Frappe client; without it we cannot resolve the
    // customer's domain, and guessing one would provision email on the wrong
    // address. Fail loudly rather than silently mis-provision.
    throw new Error("emailHosting lane requires a Frappe client to resolve the customer domain");
  }

  const domain = await resolveDomain(client, job);
  const order = await hostingerMail.findOrderForDomain(domain);

  if (!order) {
    const hint = await purchaseHint();
    throw permanent(
      `No Hostinger mail order is bound to ${domain}. Two manual steps are needed, ` +
        `because Hostinger exposes no API for either: (1) purchase an email plan, ` +
        `(2) bind ${domain} to that order in hPanel's email provisioning tab. ` +
        `Once done, requeue this job and mailbox provisioning becomes automatic.${hint}`
    );
  }

  const orderId = order.id || order.order_id || order.resource_id;
  if (!orderId) {
    throw permanent(
      `Hostinger returned a mail order for ${domain} with no usable id (keys: ${Object.keys(order).join(", ")}).`
    );
  }

  // Plan + existing mailboxes are informational: they make the portal useful
  // immediately and prove the token really can read this order.
  let plan = null;
  try {
    plan = await hostingerMail.getOrderPlan(orderId);
  } catch (e) {
    plan = null;
  }

  let mailboxes = [];
  try {
    mailboxes = await hostingerMail.listMailboxes(orderId);
  } catch (e) {
    mailboxes = [];
  }

  // Mailbox creation is deliberately NOT done here: we do not know which
  // addresses the customer wants, and inventing them (info@, admin@) would
  // burn their mailbox allowance on names they never asked for. The portal
  // drives creation, using this order id.
  return {
    externalRef: String(orderId),
    access: {
      lane,
      provider: "hostinger",
      domain,
      orderId: String(orderId),
      status: order.status || "",
      isTrial: order.is_trial ?? null,
      mailboxCount: mailboxes.length,
      mailboxLimit: plan?.mailbox_limit ?? plan?.mailboxes ?? null,
      webmail: "https://mail.hostinger.com",
      imap: { host: "imap.hostinger.com", port: 993, tls: true },
      smtp: { host: "smtp.hostinger.com", port: 465, tls: true },
    },
    log:
      `[emailHosting] bound to Hostinger mail order ${orderId} for ${domain} ` +
      `(${mailboxes.length} mailbox(es) exist). No VPS resources used — email runs on Hostinger.`,
  };
}

module.exports = { lane, isConfigured, configError, provision };
