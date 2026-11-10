// What the storefront sells, in the buyer's words. One list feeds the Cloud
// page and the Pricing page, and every price is read from the service catalog
// (never typed here), so the two pages cannot disagree with checkout.

import { DOMAIN_CATALOG, formatKes, getService } from "./serviceCatalog";

export type StoreOffer = {
  key: string;
  name: string;
  /** One plain sentence: what the buyer gets. */
  what: string;
  /** Catalog ids this offer is sold as; the cheapest is the shown price. */
  priceIds: string[];
  /** Domains are billed per year, everything else per month. */
  yearly?: boolean;
  /** Page that explains and sells it. */
  path: string;
  /** Catalog id the Cloud launch flow opens on, when it can be launched directly. */
  launchId?: string;
};

export const BUSINESS_OFFERS: StoreOffer[] = [
  {
    key: "pos",
    name: "Murzak POS",
    what: "Sell at the counter, track stock and take M-Pesa. Sized for one shop up to many branches.",
    priceIds: ["biz-pos-duka", "biz-pos-inventory", "biz-pos-chain"],
    path: "/products/pos",
  },
  {
    key: "erp",
    name: "Murzak ERP",
    what: "Accounting, inventory and HR in one system, set up for how your business runs.",
    priceIds: ["biz-erp-light", "biz-erp-configured"],
    path: "/products/erp",
  },
  {
    key: "crm",
    name: "Murzak CRM & Helpdesk",
    what: "Keep track of leads, customers and support tickets in one place.",
    priceIds: ["biz-crm-helpdesk"],
    path: "/products/crm",
  },
  {
    key: "email",
    name: "Business email",
    what: "Mailboxes on your own domain, like you@yourcompany.com.",
    priceIds: ["mail-starter", "mail-business", "mail-pro"],
    path: "/cloud/email",
  },
];

export const CLOUD_OFFERS: StoreOffer[] = [
  {
    key: "website",
    name: "Website",
    what: "A WordPress site or online shop, installed and ready to edit.",
    priceIds: ["starter-wordpress", "starter-woocommerce"],
    path: "/cloud/wordpress",
    launchId: "starter-wordpress",
  },
  {
    key: "app",
    name: "App hosting",
    what: "Point us at your Git repository and we build and run your app.",
    priceIds: ["starter-app-hosting"],
    path: "/cloud?launch=starter-app-hosting",
    launchId: "starter-app-hosting",
  },
  {
    key: "database",
    name: "Database",
    what: "PostgreSQL, MySQL, MongoDB or Redis, created for you with connection details.",
    priceIds: ["db-postgres", "db-mysql", "db-mongo", "db-redis"],
    path: "/cloud/databases",
    launchId: "db-postgres",
  },
  {
    key: "domain",
    name: "Domain name",
    what: "Search for a name, pay, and it is registered to you.",
    priceIds: DOMAIN_CATALOG.map((d) => d.id),
    yearly: true,
    path: "/cloud/domains",
  },
  {
    key: "email",
    name: "Business email",
    what: "Mailboxes on your own domain, like you@yourcompany.com.",
    priceIds: ["mail-starter", "mail-business", "mail-pro"],
    path: "/cloud/email",
  },
  {
    key: "automation",
    name: "Automation (n8n)",
    what: "Your own n8n server for connecting payments, messages and your other tools.",
    priceIds: ["starter-n8n"],
    path: "/cloud/n8n",
    launchId: "starter-n8n",
  },
];

export type OfferPrice = {
  /** Cheapest price among the offer's ids, in KES. */
  kes: number;
  /** True when the offer's ids are not all the same price. */
  from: boolean;
  /** One-time setup fee of the cheapest id, when it has one. */
  setupKes: number;
  per: "mo" | "yr";
};

/** Price facts for an offer, or null if none of its ids are in the catalog. */
export function offerPrice(offer: StoreOffer): OfferPrice | null {
  const items = offer.priceIds
    .map((id) => getService(id))
    .filter((s): s is NonNullable<typeof s> => !!s && typeof s.pricing.monthlyKes === "number");
  if (!items.length) return null;
  const cheapest = items.reduce((a, b) => ((b.pricing.monthlyKes as number) < (a.pricing.monthlyKes as number) ? b : a));
  const kes = cheapest.pricing.monthlyKes as number;
  return {
    kes,
    from: items.some((s) => s.pricing.monthlyKes !== kes),
    setupKes: cheapest.pricing.setupKes || 0,
    per: offer.yearly ? "yr" : "mo",
  };
}

/** "from KES 2,500/mo" */
export function offerPriceLabel(offer: StoreOffer): string {
  const p = offerPrice(offer);
  if (!p) return "";
  return `${p.from ? "from " : ""}${formatKes(p.kes)}/${p.per}`;
}

/** "+ KES 1,000 one-time setup", or "" when there is no setup fee. */
export function offerSetupLabel(offer: StoreOffer): string {
  const p = offerPrice(offer);
  return p && p.setupKes > 0 ? `+ ${formatKes(p.setupKes)} one-time setup` : "";
}

/** Monthly price of one catalog id (0 if unknown), for adding up a setup. */
export function monthlyOf(id: string): number {
  return getService(id)?.pricing.monthlyKes || 0;
}
