// backend/services/checkoutBillingTerm.js
//
// The single source of truth for "what term is this account on, and since
// when." Every consumer — the renewal sweep, add-on pro-rata, and checkout
// eligibility — goes through one of the functions here, backed by the same
// underlying query: the account's last PAID Subscription invoice. There is
// no term field on Web Account at all; an account's term is whatever its
// most recently paid Subscription invoice says it is, which is also why a
// renewal invoice automatically becomes next year's anchor with no separate
// "advance the anchor" step required.
//
// SAFETY: `billing_term` must never appear in a list query's `fields` — an
// unrecognized column fails the entire query in Frappe, which for the
// renewal sweep's bulk scan means zero renewals for every customer, not
// just annual ones. findLastPaidSubscriptionInvoice deliberately omits it;
// readInvoiceBillingTerm reads it via a single-document GET instead, which
// simply returns the field as undefined when not yet imported.

async function findLastPaidSubscriptionInvoice(client, webAccountName) {
  const res = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["type", "=", "Subscription"],
        ["status", "=", "Paid"],
      ]),
      fields: JSON.stringify(["name", "invoice_date"]),
      limit_page_length: 1,
      order_by: "invoice_date desc",
    },
  });
  return res.data?.data?.[0] || null;
}

async function readInvoiceBillingTerm(client, invoiceName) {
  const res = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`);
  const doc = res.data?.data;
  return doc?.billing_term === "annual" ? "annual" : "monthly";
}

async function getCurrentBillingTerm(client, webAccountName) {
  const lastPaid = await findLastPaidSubscriptionInvoice(client, webAccountName);
  if (!lastPaid) return { term: "monthly", anchorDate: null, lastPaidInvoiceName: null };
  const term = await readInvoiceBillingTerm(client, lastPaid.name);
  return { term, anchorDate: lastPaid.invoice_date, lastPaidInvoiceName: lastPaid.name };
}

// Domain-registration products bill yearly at a fixed price, never offer a
// term choice, and are excluded regardless of purchase history. Otherwise,
// eligible only for a genuinely new customer's first monthly-billed
// purchase — this is what makes mid-relationship term switching (C5)
// structurally unreachable: nothing on the add-on/returning-customer path
// ever returns true here.
async function isEligibleForTermChoice(client, webAccountName, category) {
  if (category === "Domain Registration") return false;
  const lastPaid = await findLastPaidSubscriptionInvoice(client, webAccountName);
  return !lastPaid;
}

module.exports = {
  findLastPaidSubscriptionInvoice,
  readInvoiceBillingTerm,
  getCurrentBillingTerm,
  isEligibleForTermChoice,
};
