/**
 * Validation for a Stalwart mail order. Pure: no I/O. The caller supplies the
 * set of domains already taken on the platform.
 *
 * Collects every field error at once (keyed by field) so the form can show them
 * together, instead of making the customer fix one field per submit.
 */
const { PLANS, isMailPlan } = require("../../config/emailPlans");
const { normalizeDomainName, isValidDomainName } = require("../customerDomains");

/**
 * Mailbox local part: lowercase letters, digits, dots and hyphens. Each
 * dot-separated part must start and end with a letter or digit, so there are
 * no leading, trailing or doubled dots. Stricter than mailboxPolicy's
 * LOCAL_PART_RE, which also allows underscores and is applied after lowercasing.
 */
const MAILBOX_LOCAL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const MAILBOX_MAX_LEN = 64;

const RESERVED_LOCAL_PARTS = new Set(["admin", "abuse", "noreply", "root", "postmaster"]);

const BUSINESS_NAME_MIN = 2;
const BUSINESS_NAME_MAX = 80;

const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function domainPartOf(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * @param {{planId?: unknown, businessName?: unknown, domain?: unknown,
 *          contactEmail?: unknown, mailboxes?: unknown}} input
 * @param {{takenDomains?: Set<string>}} [opts]
 * @returns {{ok: true, value: object} | {ok: false, errors: Record<string,string>}}
 */
function validateMailSetup(input, opts = {}) {
  const src = input && typeof input === "object" ? input : {};
  const takenDomains = opts.takenDomains instanceof Set ? opts.takenDomains : new Set();
  const errors = {};

  // Plan first: the mailbox cap depends on it.
  const planId = typeof src.planId === "string" ? src.planId.trim() : "";
  const plan = isMailPlan(planId) ? PLANS[planId] : null;
  if (!plan) errors.planId = "Choose a valid email plan.";

  // Business name.
  const businessName = String(src.businessName == null ? "" : src.businessName).trim();
  if (businessName.length < BUSINESS_NAME_MIN || businessName.length > BUSINESS_NAME_MAX) {
    errors.businessName = `Business name must be ${BUSINESS_NAME_MIN}-${BUSINESS_NAME_MAX} characters.`;
  }

  // Domain.
  const domain = normalizeDomainName(src.domain);
  if (!domain || !isValidDomainName(domain)) {
    errors.domain = "Enter a valid domain name, for example acme.com.";
  } else if (takenDomains.has(domain)) {
    errors.domain = "That domain already has email hosting.";
  }

  // Contact email: must be deliverable somewhere other than the mail domain
  // we are about to host, or the customer locks themselves out.
  const contactEmail = String(src.contactEmail == null ? "" : src.contactEmail).trim();
  if (!CONTACT_EMAIL_RE.test(contactEmail)) {
    errors.contactEmail = "Enter a valid contact email address.";
  } else if (domain && domainPartOf(contactEmail) === domain) {
    errors.contactEmail = "Use an email address outside the domain you are setting up.";
  }

  // Mailboxes.
  const rawList = Array.isArray(src.mailboxes) ? src.mailboxes : null;
  const names = rawList ? rawList.map((m) => String(m == null ? "" : m).trim()) : [];
  const mailboxProblems = [];
  if (!rawList || names.length === 0) {
    mailboxProblems.push("Add at least one mailbox.");
  }
  if (plan && names.length > plan.mailboxes) {
    mailboxProblems.push(`This plan includes ${plan.mailboxes} mailboxes.`);
  }
  const seen = new Set();
  let duplicateReported = false;
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!name || name.length > MAILBOX_MAX_LEN || !MAILBOX_LOCAL_RE.test(name)) {
      mailboxProblems.push(`"${name}" is not a valid mailbox name. Use lowercase letters, numbers, dots and hyphens.`);
    } else if (RESERVED_LOCAL_PARTS.has(name)) {
      mailboxProblems.push(`"${name}" is reserved.`);
    }
    if (name && seen.has(lower) && !duplicateReported) {
      mailboxProblems.push("Each mailbox name can only be used once.");
      duplicateReported = true;
    }
    seen.add(lower);
  }
  if (mailboxProblems.length) errors.mailboxes = mailboxProblems.join(" ");

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      planId,
      businessName,
      domain,
      contactEmail,
      mailboxes: names,
    },
  };
}

module.exports = { validateMailSetup, RESERVED_LOCAL_PARTS, MAILBOX_LOCAL_RE };
