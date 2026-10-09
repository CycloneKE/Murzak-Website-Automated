import { AppId } from "./serviceCatalog";

// Business apps sold through their own checkout (/get/:app) instead of the
// hosting configurator. Tier data lives in serviceCatalog.ts (one catalog
// item per tier, grouped by `app`); this file holds what the checkout says
// about the app itself.

export interface AppCheckoutInfo {
  id: AppId;
  productName: string;
  /** Host suffix the shop's own address lives under. */
  addressSuffix: string;
  /** Marketing page the tiers are shown on. */
  productPath: string;
  /** One line on the welcome screen once the app is ready. */
  afterPayment: string;
}

export const APP_CHECKOUT: Record<AppId, AppCheckoutInfo> = {
  pos: {
    id: "pos",
    productName: "Murzak POS",
    addressSuffix: "pos.murzaktech.tech",
    productPath: "/products/pos",
    afterPayment: "You'll add your branches, staff and products the first time you sign in.",
  },
};

/** /get/:app route segment → known app, or null. */
export function appIdFromRoute(param: string | undefined): AppId | null {
  return param && param in APP_CHECKOUT ? (param as AppId) : null;
}

/**
 * Annual prepay price. MUST mirror backend/services/billingTerm.js
 * annualPrepayKes (12 months less ANNUAL_DISCOUNT_PCT = 20) — the server
 * bills that function, this only displays it.
 */
export const ANNUAL_DISCOUNT_PCT = 20;
export function annualKes(monthlyKes: number): number {
  return Math.round(monthlyKes * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}
