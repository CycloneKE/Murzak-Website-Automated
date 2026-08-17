/**
 * Hostinger Domains — registration automation.
 *
 * See docs/domain-registration-automation.md for the full research trail:
 * TLD coverage, the WHOIS field schema (reverse-engineered from live
 * validation errors, not guessed), the entity_type finding, and the Section 7
 * disclosure requirement this module exists partly to satisfy.
 *
 * COVERAGE: Hostinger's own catalog only sells .com/.org/.net/.io of Murzak's
 * seven TLDs — confirmed by searching the full ~900-item catalog, not a
 * missed lookup. .co.ke/.ke/.africa are not in it at all and stay on the
 * existing manual fulfilment queue regardless of anything here.
 *
 * REGISTRANT IDENTITY: reuses the individual-type WHOIS profile already live
 * on the account (created 2026-05-13, backing the real murzaktech.tech
 * registration) rather than inventing new contact data. One profile per TLD
 * is required — Hostinger's create-profile request takes `tld` as a required
 * field, so a profile created for .com cannot register a .net domain.
 * ensureWhoisProfile() clones the existing profile's real whois_details onto
 * whichever TLD is missing one.
 */

const axios = require("axios");
const { resolveHost } = require("./hostingerApi");

function token() {
  return process.env.HOSTINGER_API_TOKEN || "";
}

function isConfigured() {
  return !!token();
}

function configError() {
  return isConfigured() ? null : "Domain registration lane not configured (missing: HOSTINGER_API_TOKEN)";
}

function http() {
  return axios.create({
    baseURL: resolveHost(),
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: Number(process.env.HOSTINGER_TIMEOUT_MS || 30000),
  });
}

function unwrap(resp) {
  const body = resp?.data;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return body?.data ?? body ?? null;
}

/**
 * The catalog item for registering this TLD, or null if Hostinger doesn't
 * sell it. Looked up live rather than hardcoded: itemIds have no obvious
 * stability guarantee, and a live 404-shaped "not found" is a safer failure
 * mode than a stale id silently 404ing mid-purchase.
 */
async function findDomainCatalogItem(tld) {
  const bareTld = String(tld || "").replace(/^\./, "").toUpperCase();
  if (!bareTld) return null;
  const resp = await http().get("/api/billing/v1/catalog");
  const items = unwrap(resp);
  if (!Array.isArray(items)) return null;
  const item = items.find(
    (i) => String(i?.category || "").toUpperCase() === "DOMAIN" && String(i?.name || "").toUpperCase() === `.${bareTld} DOMAIN`
  );
  if (!item) return null;
  const yearly = (item.prices || []).find((p) => p.period === 1 && p.period_unit === "year");
  return { itemId: item.id, priceUsdCents: yearly?.price ?? null };
}

/** Every existing WHOIS profile on the account. */
async function listWhoisProfiles() {
  const resp = await http().get("/api/domains/v1/whois");
  const rows = unwrap(resp);
  return Array.isArray(rows) ? rows : [];
}

/** The profile already scoped to this TLD, or null. Profiles are per-TLD. */
async function findWhoisProfileForTld(tld) {
  const bareTld = String(tld || "").replace(/^\./, "").toLowerCase();
  const profiles = await listWhoisProfiles();
  return profiles.find((p) => String(p?.tld || "").toLowerCase() === bareTld) || null;
}

/**
 * Create a WHOIS profile for a TLD by cloning `whoisDetails` from an existing
 * profile. The wire format is snake_case (entity_type, whois_details) —
 * confirmed against live validation errors; the SDK's own docs describe the
 * PHP client's camelCase property names, not the actual JSON shape, and would
 * silently 422 every field as "required" if trusted literally.
 */
async function createWhoisProfile({ tld, country, entityType, whoisDetails }) {
  const bareTld = String(tld || "").replace(/^\./, "").toLowerCase();
  if (!bareTld) throw new Error("createWhoisProfile: tld is required");
  const resp = await http().post("/api/domains/v1/whois", {
    tld: bareTld,
    country,
    entity_type: entityType,
    whois_details: whoisDetails,
  });
  return unwrap(resp);
}

/**
 * The profile id to use for `tld`, creating one from the account's existing
 * reference profile if none exists yet for that TLD. Never invents contact
 * data — every field comes from a profile already live on the account.
 */
async function ensureWhoisProfile(tld) {
  const existing = await findWhoisProfileForTld(tld);
  if (existing) return existing.id;

  const profiles = await listWhoisProfiles();
  const reference = profiles[0];
  if (!reference) {
    throw new Error(
      "No WHOIS profile exists on this Hostinger account to clone from. " +
        "Create one by hand in hPanel first (Domains → WHOIS profiles)."
    );
  }
  const created = await createWhoisProfile({
    tld,
    country: reference.country,
    entityType: reference.entity_type,
    whoisDetails: reference.whois_details,
  });
  return created?.id;
}

/**
 * Register a domain: POST /api/domains/v1/portfolio ("Purchase new domain").
 * Owner/admin/billing/tech contacts are all the same profile — the standard
 * shape for a reseller registering under one identity rather than four
 * distinct roles.
 */
async function purchaseDomain({ domain, itemId, whoisProfileId, paymentMethodId }) {
  const resp = await http().post("/api/domains/v1/portfolio", {
    domain,
    item_id: itemId,
    domain_contacts: {
      owner_id: whoisProfileId,
      admin_id: whoisProfileId,
      billing_id: whoisProfileId,
      tech_id: whoisProfileId,
    },
    ...(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
  });
  return unwrap(resp);
}

/**
 * Enable WHOIS privacy protection on a newly registered domain. Best-effort
 * by design in the caller: a domain that registered successfully but whose
 * privacy call failed is still a working, owned domain — just with the
 * registrant's real contact info temporarily public until retried, not a
 * failed purchase.
 */
async function enablePrivacyProtection(domain) {
  const resp = await http().put(`/api/domains/v1/portfolio/${encodeURIComponent(domain)}/privacy-protection`);
  return unwrap(resp);
}

/** Whether the account has a usable (non-expired, non-suspended) payment method. */
async function hasUsablePaymentMethod() {
  const resp = await http().get("/api/billing/v1/payment-methods");
  const methods = unwrap(resp);
  if (!Array.isArray(methods)) return false;
  const now = Date.now();
  return methods.some((m) => {
    if (m?.is_suspended) return false;
    if (m?.is_expired) return false;
    if (m?.expires_at && new Date(m.expires_at).getTime() <= now) return false;
    return true;
  });
}

module.exports = {
  isConfigured,
  configError,
  findDomainCatalogItem,
  listWhoisProfiles,
  findWhoisProfileForTld,
  createWhoisProfile,
  ensureWhoisProfile,
  purchaseDomain,
  enablePrivacyProtection,
  hasUsablePaymentMethod,
};
