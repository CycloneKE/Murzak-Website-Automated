/**
 * Mail provider facade: one set of mailbox operations, routed to Stalwart (the
 * new business-email plans) or Hostinger (legacy email orders).
 *
 * Every method takes a `ctx` built by the portal route. `ctx.orderId` is the
 * job's external_ref: the Hostinger order id for Hostinger jobs, or the mail
 * DOMAIN for Stalwart jobs. Stalwart mailboxes are scoped by domain, so every
 * Stalwart write first confirms the target account sits on that domain. A
 * foreign account id is refused here, not only by the route.
 *
 * Mailbox rows returned are mailboxPolicy.publicMailbox shaped for both providers.
 */
const hostingerMail = require("../hostingerMail");
const mailboxPolicy = require("../mailboxPolicy");
const mailboxEntitlement = require("../mailboxEntitlement");
const stalwart = require("./stalwartClient");
const { PLANS, isMailPlan } = require("../../config/emailPlans");
const mailInput = require("./mailInput");

const GB = 1024 ** 3;
const POSTMASTER = "postmaster";

/** A refusal with a status and a message that is safe to show the customer. */
class MailError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "MailError";
    this.status = status;
  }
}

function accessOf(job) {
  const a = job ? job.access : null;
  if (!a) return {};
  if (typeof a === "object") return a;
  try {
    const parsed = JSON.parse(a);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** "stalwart" for mail-* plan jobs or access.provider === "stalwart"; otherwise "hostinger". */
function providerFor(job) {
  if (job && isMailPlan(job.service_id)) return "stalwart";
  return accessOf(job).provider === "stalwart" ? "stalwart" : "hostinger";
}

/** Mailbox allowance for a Stalwart mail plan. Unknown plans get 0, so they fail closed. */
function stalwartPlanLimit(serviceId) {
  return isMailPlan(serviceId) ? PLANS[serviceId].mailboxes : 0;
}

function isConfigured(provider) {
  return provider === "stalwart" ? stalwart.isConfigured() : hostingerMail.isConfigured();
}

function localPartOf(address) {
  const s = String(address || "").toLowerCase();
  const at = s.lastIndexOf("@");
  return at === -1 ? s : s.slice(0, at);
}

// Usage is not tracked for Stalwart accounts yet, so it is null (unknown), not a fake zero.
function toPublic(account) {
  return {
    ...mailboxPolicy.publicMailbox({
      id: account.id,
      email: account.address,
      local_part: localPartOf(account.address),
      quota_bytes: account.quotaBytes,
    }),
    usedBytes: null,
  };
}

/** Stalwart accounts on the domain, with the system postmaster@ removed. */
async function domainAccounts(ctx) {
  const domain = await stalwart.findDomain(ctx.orderId);
  if (!domain) throw new Error(`Stalwart domain not found for ${ctx.orderId}`);
  const rows = await stalwart.listAccounts(domain.id);
  return { domainId: domain.id, accounts: rows.filter((a) => localPartOf(a.address) !== POSTMASTER) };
}

/**
 * The account must be on this domain and not system-owned. Anything else is
 * reported as not found, so another tenant's id is never confirmed to exist.
 */
async function ownAccount(ctx, accountId) {
  const wanted = String(accountId == null ? "" : accountId).trim();
  const domain = await stalwart.findDomain(ctx.orderId);
  if (!domain) throw new Error(`Stalwart domain not found for ${ctx.orderId}`);
  const rows = await stalwart.listAccounts(domain.id);
  const hit = rows.find((a) => String(a.id) === wanted);
  if (!hit) throw new MailError(404, "Mailbox not found.");
  if (localPartOf(hit.address) === POSTMASTER) throw new MailError(403, "That mailbox is managed by Murzak.");
  return hit;
}

const hostinger = {
  async listMailboxes(ctx) {
    const rows = await hostingerMail.listMailboxes(ctx.orderId);
    return rows.map(mailboxPolicy.publicMailbox);
  },
  async createMailbox(ctx, { localPart, password }) {
    const created = await hostingerMail.createMailbox(ctx.orderId, { localPart, password });
    return mailboxPolicy.publicMailbox(created || { local_part: localPart });
  },
  changePassword(ctx, mailboxId, password) {
    return hostingerMail.changeMailboxPassword(mailboxId, password);
  },
  deleteMailbox(ctx, mailboxId) {
    return hostingerMail.deleteMailbox(mailboxId);
  },
};

const stalwartProvider = {
  async listMailboxes(ctx) {
    const { accounts } = await domainAccounts(ctx);
    return accounts.map(toPublic);
  },
  async createMailbox(ctx, { localPart, password }) {
    // Strict and case-sensitive: "Sales" is refused, not silently lowercased.
    const local = String(localPart == null ? "" : localPart).trim();
    if (mailInput.RESERVED_LOCAL_PARTS.has(local)) throw new MailError(400, "That mailbox name is reserved.");
    if (!mailInput.isValidMailboxLocalPart(local)) {
      throw new MailError(400, "Use lowercase letters, numbers, dots and hyphens, and don't start or end with a symbol.");
    }
    if (!password) throw new MailError(400, "A password is required.");
    const plan = isMailPlan(ctx.serviceId) ? PLANS[ctx.serviceId] : null;
    if (!plan) throw new MailError(409, "Your email plan couldn't be determined. Please contact support.");

    const { domainId, accounts } = await domainAccounts(ctx);
    if (accounts.some((a) => localPartOf(a.address) === local)) {
      throw new MailError(409, `${local}@ already exists.`);
    }
    const verdict = mailboxEntitlement.canCreate({
      used: accounts.length,
      effective: { limit: plan.mailboxes, unlimited: false, source: "plan" },
    });
    if (!verdict.ok) throw new MailError(409, `Your email plan includes ${plan.mailboxes} mailboxes and all are in use.`);

    const quotaBytes = plan.quotaGb * GB;
    const made = await stalwart.ensureAccount({ domainId, localPart: local, quotaBytes });
    if (!made.created) throw new MailError(409, `${local}@ already exists.`);
    try {
      await stalwart.setPassword(made.id, password);
    } catch (err) {
      // Never leave an account behind with a random, unknown password.
      try { await stalwart.deleteAccount(made.id); } catch { /* reported by the original error */ }
      throw err;
    }
    return toPublic({ id: made.id, address: `${local}@${ctx.orderId}`, quotaBytes });
  },
  async changePassword(ctx, accountId, password) {
    if (!password) throw new MailError(400, "A password is required.");
    const acct = await ownAccount(ctx, accountId);
    await stalwart.setPassword(acct.id, password);
  },
  async deleteMailbox(ctx, accountId) {
    const acct = await ownAccount(ctx, accountId);
    await stalwart.deleteAccount(acct.id);
  },
};

// The provider is derived from the job here, never taken from a caller field.
function providerImpl(ctx) {
  return providerFor(ctx && ctx.job) === "stalwart" ? stalwartProvider : hostinger;
}

/** Each operation routes by providerFor(ctx.job). */
const listMailboxes = (ctx) => providerImpl(ctx).listMailboxes(ctx);
const createMailbox = (ctx, input) => providerImpl(ctx).createMailbox(ctx, input);
const changePassword = (ctx, mailboxId, password) => providerImpl(ctx).changePassword(ctx, mailboxId, password);
const deleteMailbox = (ctx, mailboxId) => providerImpl(ctx).deleteMailbox(ctx, mailboxId);

module.exports = {
  MailError,
  providerFor,
  stalwartPlanLimit,
  isConfigured,
  listMailboxes,
  createMailbox,
  changePassword,
  deleteMailbox,
};
