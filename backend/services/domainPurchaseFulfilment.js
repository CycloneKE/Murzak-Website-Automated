/**
 * Turns a PAID domain purchase into the two records that make it real, and —
 * for the TLDs Hostinger actually sells — attempts to register it live.
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
 * REGISTRATION: see docs/domain-registration-automation.md for the full
 * research trail. In short — Hostinger's catalog only sells .com/.org/.net/.io
 * of Murzak's seven TLDs, so only those attempt live registration; everything
 * else (.co.ke/.ke/.africa, and any TLD where the live attempt fails for any
 * reason) falls through to exactly the pre-existing "pending" queue a human
 * already works from. Registration is best-effort and never blocks the
 * fulfilment records above from being created — a customer's purchase request
 * and ownership record exist regardless of whether automation could complete.
 *
 * Everything here is best-effort and never throws. The invoice is already paid
 * by the time this runs; a Frappe hiccup must not roll that back. Anything
 * missed is recoverable by re-running scripts/backfill-customer-domains.js.
 */

const customerDomains = require("./customerDomains");
const hostingerDomains = require("./hostingerDomains");
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
 * Attempt live registration for one domain. Returns {ok:true, registrar,
 * expiresOn} on success or {ok:false, reason} on anything short of that —
 * never throws, so a failure here is indistinguishable to the caller from
 * "this TLD was never automatable in the first place."
 *
 * Every step that CAN fail independently is allowed to: an unconfigured
 * token, a TLD Hostinger doesn't sell, no usable payment method, no WHOIS
 * profile and no way to create one, or the purchase call itself. Any of these
 * simply means the domain stays in the pre-existing manual queue — nothing
 * here is a customer-visible error.
 */
async function attemptLiveRegistration(fullDomain, requestedTld) {
  if (!hostingerDomains.isConfigured()) {
    return { ok: false, reason: hostingerDomains.configError() };
  }

  let catalogItem;
  try {
    catalogItem = await hostingerDomains.findDomainCatalogItem(requestedTld);
  } catch (e) {
    return { ok: false, reason: `catalog lookup failed: ${e.message}` };
  }
  if (!catalogItem) {
    // Not a bug: Hostinger's catalog doesn't sell every TLD Murzak resells
    // (.co.ke/.ke/.africa, confirmed absent entirely) — this is the expected,
    // silent outcome for those, not a retry-worthy failure.
    return { ok: false, reason: `Hostinger does not sell ${requestedTld} — stays on the manual queue` };
  }

  let hasPayment;
  try {
    hasPayment = await hostingerDomains.hasUsablePaymentMethod();
  } catch (e) {
    return { ok: false, reason: `payment method check failed: ${e.message}` };
  }
  if (!hasPayment) {
    return { ok: false, reason: "no usable payment method on the Hostinger account" };
  }

  let whoisProfileId;
  try {
    whoisProfileId = await hostingerDomains.ensureWhoisProfile(requestedTld);
  } catch (e) {
    return { ok: false, reason: `WHOIS profile: ${e.message}` };
  }
  if (!whoisProfileId) {
    return { ok: false, reason: "WHOIS profile creation returned no id" };
  }

  let purchased;
  try {
    purchased = await hostingerDomains.purchaseDomain({
      domain: fullDomain,
      itemId: catalogItem.itemId,
      whoisProfileId,
    });
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    return { ok: false, reason: `registration failed: ${detail}` };
  }

  // Privacy protection is best-effort and does NOT undo a successful
  // registration if it fails: an owned domain with a temporarily public
  // WHOIS record is a working product; a purchase we quietly discard is not.
  try {
    await hostingerDomains.enablePrivacyProtection(fullDomain);
  } catch (e) {
    console.warn(`DOMAIN PRIVACY PROTECTION WARN: ${fullDomain}:`, e.response?.data || e.message);
  }

  return {
    ok: true,
    // White-label: never surface "Hostinger" into a stored field a customer
    // sees on their Domains tab. The checkout/request-time DISCLOSURE (see
    // Checkout.tsx, AddDomainModal.tsx) is the one place that name appears —
    // required there, not appropriate here.
    registrar: "Murzak Cloud",
    expiresOn: purchased?.expires_at || purchased?.expires_on || null,
  };
}

/**
 * Create the fulfilment record + ownership record for every domain on a paid
 * invoice, then attempt live registration for whichever TLDs Hostinger
 * actually sells. Returns a summary for logging; never throws.
 */
async function fulfilPurchasedDomains(client, webAccount, serviceRows) {
  const purchases = purchasedDomainsFrom(serviceRows);
  const summary = {
    considered: purchases.length,
    requests: 0,
    domains: 0,
    skipped: 0,
    registered: 0,
    errors: [],
  };
  if (!purchases.length) return summary;

  for (const p of purchases) {
    let domainRecordId = "";
    let needsRegistration = false;
    let request = null;
    try {
      request = await findExistingPurchaseRequest(client, webAccount, p.fullDomain);
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

      const ensured = await customerDomains.ensureCustomerDomain(client, {
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
      domainRecordId = ensured.domain?.id || "";
      // Only a genuinely fresh "pending" record needs registering. A re-sync
      // (e.g. billingActivationService re-running for the same invoice) finds
      // this same domain already active/failed/etc — attempting registration
      // again would either waste a Hostinger call on an already-owned domain
      // or, worse, blindly overwrite a status it has no business overwriting.
      needsRegistration = ensured.domain?.status === "pending";
      summary.domains++;
    } catch (e) {
      const msg = e.response?.data?.exception || e.message;
      summary.errors.push(`${p.fullDomain}: ${msg}`);
      console.error("DOMAIN PURCHASE FULFILMENT ERROR:", p.fullDomain, msg);
      continue; // no fulfilment record exists to register against
    }

    if (!domainRecordId || !needsRegistration) continue;

    // Registration is a second, independent best-effort step: a failure here
    // must not undo the fulfilment records just created above, and must not
    // be reported as a fulfilment error — "stays pending for a human" is the
    // correct, unremarkable outcome for most of these attempts.
    try {
      const reg = await attemptLiveRegistration(p.fullDomain, p.requestedTld);
      if (reg.ok) {
        await customerDomains.updateCustomerDomain(client, domainRecordId, {
          status: "active",
          registrar: reg.registrar,
          ...(reg.expiresOn ? { expires_on: reg.expiresOn } : {}),
        });
        // Same status-sync this record would get from a human marking it
        // fulfilled via /api/admin/domains/:id/status — see adminRoutes.js.
        const intakeStatus = customerDomains.intakeStatusForDomainStatus(
          "active",
          PURCHASE_REQUEST_DOCTYPE
        );
        if (intakeStatus && request?.name) {
          try {
            await client.put(
              `/api/resource/${encodeURIComponent(PURCHASE_REQUEST_DOCTYPE)}/${encodeURIComponent(request.name)}`,
              { status: intakeStatus }
            );
          } catch (e) {
            console.warn("DOMAIN INTAKE SYNC WARN:", p.fullDomain, e.response?.data || e.message);
          }
        }
        summary.registered++;
      } else {
        console.log(`DOMAIN AUTO-REGISTER SKIPPED: ${p.fullDomain}: ${reg.reason}`);
      }
    } catch (e) {
      // attemptLiveRegistration is written to never throw; this is a backstop
      // in case a future edit breaks that contract. Either way, the domain
      // stays "pending" — exactly the pre-automation default.
      console.error("DOMAIN AUTO-REGISTER UNEXPECTED ERROR:", p.fullDomain, e.message);
    }
  }
  return summary;
}

module.exports = {
  PURCHASE_REQUEST_DOCTYPE,
  attemptLiveRegistration,
  fulfilPurchasedDomains,
  isDomainProductId,
  purchasedDomainsFrom,
};
