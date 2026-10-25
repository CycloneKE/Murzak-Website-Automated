/**
 * The Murzak marketplace: the things a Murzak POS owner can buy for their shop from inside the POS.
 *
 * The POS shows these (with its own wording, in English and Swahili); this list only decides WHICH products are on
 * offer and tells the POS the real price. Names and prices come from the same catalogue snapshot the checkout and the
 * invoices use, so the POS can never show a price the checkout will not charge. A product that is not in the snapshot,
 * has no price, or is quote-only is left out rather than shown half-broken.
 *
 * Buying always happens on the website's existing checkout (/checkout/new?serviceId=<id>): the order, the M-Pesa or
 * PayPal payment, the invoice and the start of provisioning are the same code every other purchase uses.
 */

const { getServiceMeta } = require("./provisioning/catalog");

/** Groups in the order the POS shows them. Edit here to put a product on, or take it off, the marketplace. */
const GROUPS = [
  { key: "online", ids: ["starter-storefront", "starter-woocommerce", "starter-wordpress"] },
  { key: "protect", ids: ["addon-backup-plus"] },
];

/** A product someone can pay for on their own: priced, and not a custom quote. */
function isSelfServe(meta) {
  return !!meta && Number(meta.monthlyKes) > 0 && meta.capacityClass !== "dedicated";
}

function itemFor(id) {
  const meta = getServiceMeta(id);
  if (!isSelfServe(meta)) return null;
  return {
    id,
    name: String(meta.name || id),
    monthlyKes: Number(meta.monthlyKes) || 0,
    setupKes: Number(meta.setupKes) || 0,
  };
}

/** The marketplace as the POS reads it. Empty groups are dropped. */
function buildCatalog() {
  const groups = GROUPS.map((g) => ({ key: g.key, items: g.ids.map(itemFor).filter(Boolean) })).filter((g) => g.items.length);
  return { groups };
}

module.exports = { GROUPS, isSelfServe, buildCatalog };
