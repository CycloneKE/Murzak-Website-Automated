// services/email/mailReserved.js
//
// Domains customers may not use for business email: Murzak's own domains, the
// registrable domain of MAIL_HOST, anything in MAIL_RESERVED_DOMAINS, and every
// subdomain of those. Checked at ORDER time (mailSetupStore.checkMailSetupInput)
// and again at provisioning (stalwartProvision), by this one function.

const HARD_RESERVED = ["murzaktech.tech", "murzaktech.com"];
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "or", "go", "ne"]);

/** Registrable domain of a host: last two labels, or three under co.ke style suffixes. */
function registrable(host) {
  const labels = String(host || "").toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const take = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function reservedDomains() {
  const extra = String(process.env.MAIL_RESERVED_DOMAINS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const set = new Set([...HARD_RESERVED, ...extra]);
  const host = registrable(process.env.MAIL_HOST);
  if (host) set.add(host);
  return set;
}

/** True for a reserved domain or any subdomain of one. */
function isReservedDomain(domain) {
  const d = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!d) return false;
  return [...reservedDomains()].some((r) => d === r || d.endsWith(`.${r}`));
}

const RESERVED_MESSAGE = "That domain can't be used for business email.";

module.exports = { HARD_RESERVED, registrable, reservedDomains, isReservedDomain, RESERVED_MESSAGE };
