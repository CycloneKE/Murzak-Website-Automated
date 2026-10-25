// Storefront side of bundle pricing. The server owns every price, saving and
// rule (backend/services/checkout/bundles.js); this file only fetches what to
// display and shapes the `companions` list that POST /api/orders accepts.

import { domainCatalogIdForTld, getService } from "../config/serviceCatalog";
import { TLD_OPTIONS } from "./domains";
import { toUserMessage } from "./errors";

export const MAX_COMPANIONS = 3;

export interface Pairing {
  primaryIds: string[];
  companionId: string;
  savingKes: number | null;
  label: string;
}

export type HeadroomLevel = "ok" | "limited" | "full";

export interface Availability {
  enabled: boolean;
  pairings: Pairing[];
  allowedCompanionIds: string[];
  headroom: { benchSlotsLeft: number; level: HeadroomLevel };
}

export interface Offer {
  serviceId: string;
  name: string;
  monthlyKes: number;
  savingKes: number;
  windowEndsAtMs: number;
}

export interface CompanionInput {
  serviceId: string;
  config?: { domain: string };
}

// Availability is public and the server caches it for 30 s; several components
// on one page (picker + notice) share a single request. Failures are not cached.
const CACHE_MS = 30_000;
let cached: { at: number; promise: Promise<Availability> } | null = null;

async function getJson(url: string, fallback: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch (e) {
    throw new Error(toUserMessage(e, fallback));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage(data?.error, fallback));
  return data;
}

export function fetchAvailability(): Promise<Availability> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = getJson("/api/bundles/availability", "Bundle options are unavailable right now.").then(
    (d): Availability => ({
      enabled: d?.enabled === true,
      pairings: Array.isArray(d?.pairings) ? d.pairings : [],
      allowedCompanionIds: Array.isArray(d?.allowedCompanionIds) ? d.allowedCompanionIds : [],
      headroom: {
        benchSlotsLeft: Number(d?.headroom?.benchSlotsLeft) || 0,
        level: d?.headroom?.level === "full" || d?.headroom?.level === "limited" ? d.headroom.level : "ok",
      },
    })
  );
  cached = { at: Date.now(), promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

export async function fetchOffers(): Promise<Offer[]> {
  const d = await getJson("/api/bundles/offers", "Your add-on offers are unavailable right now.");
  if (d?.enabled !== true || !Array.isArray(d?.offers)) return [];
  return d.offers;
}

/**
 * Buy an offered domain from a "Complete your setup" card. A domain is a NAME,
 * so this always sends the chosen full domain (the server refuses an add-on
 * domain without one: 422 DOMAIN_NAME_REQUIRED). Same two calls the portal's
 * Add-ons flow makes: price/invoice (applies the open bundle-window saving),
 * then attach to the account. Returns the refreshed user, when sent.
 */
export async function purchaseOfferedDomain(serviceId: string, domain: string): Promise<any | null> {
  const svc = getService(serviceId);
  const services = [{ serviceId, serviceName: svc?.name || serviceId, tier: svc?.tier || "", domainChoice: domain }];
  const post = async (url: string, fallback: string) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ services }),
      });
    } catch (e) {
      throw new Error(toUserMessage(e, fallback));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(toUserMessage(data?.error, fallback));
    return data;
  };
  await post("/api/addons/invoice/create", "We couldn't add that domain. Please try again.");
  const attached = await post("/api/services/addons/add", "We couldn't add that domain to your account. Please try again.");
  return attached?.user ?? null;
}

// ---- Companion selection helpers ----

/** The TLD of a full domain ("acme.co.ke" -> ".co.ke"), longest match first. */
export function tldOfDomain(domain: string): string | null {
  const d = domain.toLowerCase();
  const hit = [...TLD_OPTIONS].sort((a, b) => b.tld.length - a.tld.length).find((t) => d.endsWith(t.tld));
  return hit ? hit.tld : null;
}

export function domainServiceIdFor(domain: string): string | null {
  const tld = tldOfDomain(domain);
  return tld ? domainCatalogIdForTld(tld) : null;
}

export const isDomainCompanionId = (id: string) => id.startsWith("domain-");

/** Order body `companions`: domains carry their chosen name, the rest only an id. */
export function toCompanionInputs(ids: string[], domain: string): CompanionInput[] {
  return ids.map((id) =>
    isDomainCompanionId(id) && domain ? { serviceId: id, config: { domain } } : { serviceId: id }
  );
}

export const isBusinessApp = (id: string) => id === "biz-crm-helpdesk" || id.startsWith("biz-erp-");

/** biz-erp-light and biz-erp-configured share the family "biz-erp". */
export function productFamily(serviceId: string): string {
  return serviceId.split("-").slice(0, 2).join("-");
}

/** Whether the picker would list this id for this primary (shared by picker and send-gate). */
export function isPickableCompanion(id: string, primaryId: string, allowedIds: string[]): boolean {
  if (!allowedIds.includes(id)) return false;
  if (productFamily(id) === productFamily(primaryId)) return false;
  if (isDomainCompanionId(id)) return true;
  const svc = getService(id);
  return !!svc && !svc.app;
}

/**
 * The single gate every order path uses before sending companions: only what the
 * loaded availability allows and the picker could show. No availability, a
 * disabled feature or a failed fetch yields none, so nothing hidden is ever sent.
 */
export async function gateCompanions(primaryId: string, ids: string[], domain: string): Promise<CompanionInput[]> {
  if (!ids.length) return [];
  let a: Availability;
  try {
    a = await fetchAvailability();
  } catch {
    return [];
  }
  if (!a.enabled) return [];
  const full = a.headroom.level === "full";
  const kept = [...new Set(ids)]
    .filter((id) => isPickableCompanion(id, primaryId, a.allowedCompanionIds))
    .filter((id) => !(full && isBusinessApp(id)))
    .filter((id) => !isDomainCompanionId(id) || (!!domain && domainServiceIdFor(domain) === id))
    .slice(0, MAX_COMPANIONS);
  return toCompanionInputs(kept, domain);
}

// ---- Product page -> checkout handoff (ERP / CRM) ----
// Those pages send people to /checkout/new?serviceId=<id>. A short-lived
// sessionStorage entry carries the picked companions across that navigation
// without touching the URL. It is only honoured for the same product family
// and expires after 30 minutes; the server re-validates everything anyway.

const HANDOFF_KEY = "murzak.companions.handoff";
const HANDOFF_TTL_MS = 30 * 60 * 1000;

interface Handoff {
  family: string;
  ids: string[];
  domain: string;
  at: number;
}

export function saveHandoff(primaryId: string, ids: string[], domain: string): void {
  try {
    if (!ids.length) sessionStorage.removeItem(HANDOFF_KEY);
    else sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ family: productFamily(primaryId), ids, domain, at: Date.now() } satisfies Handoff));
  } catch {
    /* storage blocked: the order simply proceeds without companions */
  }
}

export function readHandoff(primaryId: string): { ids: string[]; domain: string } | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Handoff;
    if (!h || h.family !== productFamily(primaryId) || Date.now() - h.at > HANDOFF_TTL_MS || !Array.isArray(h.ids) || !h.ids.length) return null;
    return { ids: h.ids.filter((x) => typeof x === "string"), domain: typeof h.domain === "string" ? h.domain : "" };
  } catch {
    return null;
  }
}

export function clearHandoff(): void {
  try {
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}
