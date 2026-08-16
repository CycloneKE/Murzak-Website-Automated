/**
 * Turns a PAID domain purchase into the two records that make it real.
 *
 * There were two unreconciled ways to get a domain:
 *
 *   1. Buy one at checkout (DOMAIN_CATALOG, priced per TLD, billed yearly).
 *      This produced an invoice, a Web Account service row, and a provisioning
 *      job that immediately escalated to "manual". The domain string itself
 *      rode along in the service row's `domain_choice` field — a key borrowed
 *      from the unrelated hosting flow — and stopped there.
 *   2. Ask for one from inside website hosting, which created a Hosting Domain
 *      Purchase Request that staff actually work from.
 *
 * So a domain someone PAID for never reached the fulfilment queue and never
 * appeared on their Domains tab, while a free-form request did. This closes
 * that: a paid purchase now creates the same Hosting Domain Purchase Request
 * the hosting flow creates, plus the Customer Domain record of ownership.
 *
 * Everything here is best-effort and never throws. The invoice is already paid
 * by the time this runs; a Frappe hiccup must not roll that back. Anything
 * missed is recoverable by re-running scripts/backfill-customer-domains.js.
 */

const customerDomains = require("./customerDomains");
const { DOMAIN_PRODUCT_TLDS } = require("./checkout/orderStore");

const PURCHASE_REQUEST_DOCTYPE = "Hosting Domain Purchase Request";

/** Is this catalog id one of the per-TLD domain products? Pure. */
function isDomainProductId(serviceId) {
  return Object.prototype.hasOwnProperty.call(DOMAIN_PRODUCT_TLDS, String(serviceId || "").trim());
}

/**
 * The purchases worth fulfilling out of an invoice's service rows. Pure, so
 * the "which rows and what do they mean" decision is testable without Frappe.
 *
 * `domainChoice` is the field checkout stashes the bought domain in; for a
 * non-domain product it holds an unrelated hosting choice, which is exactly
 * why the serviceId has to gate this rather than the presence of a value.
 */
function purchasedDomainsFrom(serviceRows) {
  const out = [];
  for (const row of Array.isArray(serviceRows) ? serviceRows : []) {
    const serviceId = String(row?.serviceId || "").trim();
    if (!isDomainProductId(serviceId)) continue;
    const split = customerDomains.splitPurchasedDomain(row?.domainChoice, DOMAIN_PRODUCT_TLDS[serviceId]);
    if (!split) continue;
    out.push({ serviceId, ...split });
  }
  return out;
}

/**
 * Has this account already got a purchase request for this exact domain?
 * Checkout can be retried and activation can be re-synced, and neither should
 * put the same name in the queue twice.
 */
async function findExistingPurchaseRequest(client, webAccount, fullDomain) {
  const res = await client.get(`/api/resource/${encodeURIComponent(PURCHASE_REQUEST_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccount],
        ["full_domain", "=", fullDomain],
      ]),
      fields: JSON.stringify(["name", "status"]),
      limit_page_length: 1,
    },
  });
  return res.data?.data?.[0] || null;
}

/**
 * Create the fulfilment record + ownership record for every domain on a paid
 * invoice. Returns a summary for logging; never throws.
 */
async function fulfilPurchasedDomains(client, webAccount, serviceRows) {
  const purchases = purchasedDomainsFrom(serviceRows);
  const summary = { considered: purchases.length, requests: 0, domains: 0, skipped: 0, errors: [] };
  if (!purchases.length) return summary;

  for (const p of purchases) {
    try {
      let request = await findExistingPurchaseRequest(client, webAccount, p.fullDomain);
      if (!request) {
        const created = await client.post(`/api/resource/${encodeURIComponent(PURCHASE_REQUEST_DOCTYPE)}`, {
          web_account: webAccount,
          // Deliberately the domain PRODUCT's id, not the hosting service id:
          // this domain was bought on its own and may never be attached to
          // website hosting at all.
          service_id: p.serviceId,
          requested_name: p.requestedName,
          requested_tld: p.requestedTld,
          full_domain: p.fullDomain,
          status: "pending",
          // White-label: never surface the upstream registrar to customers.
          provider: "Murzak Cloud",
          notes: "Purchased at checkout — awaiting registration.",
        });
        request = created.data?.data || null;
        summary.requests++;
      } else {
        summary.skipped++;
      }

      await customerDomains.ensureCustomerDomain(client, {
        webAccount,
        domainName: p.fullDomain,
        kind: customerDomains.DOMAIN_KINDS.REGISTERED,
        status: "pending",
        sourceDoctype: PURCHASE_REQUEST_DOCTYPE,
        sourceName: request?.name || "",
        // Bought standalone: owned, but not pointed at anything until the
        // customer says so on their Domains tab.
        attachedToService: "",
        notes: "Purchased at checkout.",
      });
      summary.domains++;
    } catch (e) {
      const msg = e.response?.data?.exception || e.message;
      summary.errors.push(`${p.fullDomain}: ${msg}`);
      console.error("DOMAIN PURCHASE FULFILMENT ERROR:", p.fullDomain, msg);
    }
  }
  return summary;
}

module.exports = {
  PURCHASE_REQUEST_DOCTYPE,
  fulfilPurchasedDomains,
  isDomainProductId,
  purchasedDomainsFrom,
};
