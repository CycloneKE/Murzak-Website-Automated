/**
 * Hostinger API — the single place that resolves the API host.
 *
 * HOSTINGER_API_BASE used to be read in three places that each appended paths
 * differently, so no single env value was correct for all of them:
 *
 *   server.js       `${base}/domains/v1/availability`   needed base WITH /api
 *   scaling.js      baseURL + "/api/vps/v1/..."         needed base WITHOUT /api
 *   aiService.js    `${base}/v1/vps`                    wrong path either way
 *
 * On top of that, scaling.js and aiService.js both DEFAULTED to
 * api.hostinger.com, which is not the API host at all — it answers HTTP 530 on
 * every path — so those two calls had never once succeeded. Their catch blocks
 * swallowed the failure and reported "API unavailable", which is why nobody
 * noticed. .env.example shipped the same bad value, which quietly sent domain
 * availability down its stubbed-data fallback for anyone who copied it.
 *
 * The contract now:
 *   - HOSTINGER_API_BASE is a BARE HOST (https://developers.hostinger.com).
 *   - Callers append the full documented path, "/api/<group>/v1/...", exactly as
 *     Hostinger's SDK spells it — /api/domains/v1/availability,
 *     /api/dns/v1/zones/{domain}, /api/mail/v1/orders, /api/billing/v1/catalog.
 *   - resolveHost() tolerates a base that still carries a trailing /api, and
 *     overrides the known-bad api.hostinger.com, so a stale env var in a
 *     deployed .env can't resurrect either bug.
 *
 * Host verified by probing the live API on 2026-08-17. New Hostinger callers
 * (e.g. the mail-provisioning wrapper on the email-hosting branch) should route
 * through apiUrl() rather than reading the env var again.
 */

const axios = require("axios");

const DEFAULT_HOST = "https://developers.hostinger.com";

// Documented paths, spelled once so a typo can't diverge between call sites.
const PATHS = {
  domainAvailability: "/api/domains/v1/availability",
  vpsVirtualMachines: "/api/vps/v1/virtual-machines",
};

/**
 * Normalize HOSTINGER_API_BASE into a bare host with no trailing /api.
 */
function resolveHost() {
  const raw = String(process.env.HOSTINGER_API_BASE || "").trim();
  if (!raw) return DEFAULT_HOST;
  const noSlash = raw.replace(/\/+$/, "");
  // api.hostinger.com is not the API host; don't let a stale env var send calls
  // somewhere that 530s.
  if (/^https?:\/\/api\.hostinger\.com(\/api)?$/i.test(noSlash)) return DEFAULT_HOST;
  return noSlash.replace(/\/api$/i, "");
}

/**
 * Absolute url for a documented path, e.g. apiUrl(PATHS.domainAvailability).
 */
function apiUrl(path) {
  const host = resolveHost();
  const p = String(path || "").trim();
  if (!p) return host;
  return `${host}/${p.replace(/^\/+/, "")}`;
}

function token() {
  return process.env.HOSTINGER_API_TOKEN || "";
}

function isConfigured() {
  return !!token();
}

function authHeaders() {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

/**
 * Ask Hostinger which of these full domains are available.
 * Returns a Map<fullDomain, boolean>, or null if the API isn't configured/failed
 * (caller then falls back to the local stub). Pricing is always OUR KES retail —
 * we resell, so we don't pass through Hostinger's wholesale price.
 */
async function checkDomainAvailability(label, tldsWithDot) {
  if (!isConfigured()) return null;

  try {
    const resp = await axios.post(
      apiUrl(PATHS.domainAvailability),
      // Hostinger expects TLDs without the leading dot (e.g. "com", "co.ke").
      { domain: label, tlds: tldsWithDot.map((t) => t.replace(/^\./, "")) },
      { headers: authHeaders(), timeout: 8000 }
    );

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    const map = new Map();
    for (const row of rows) {
      const dom = (row.domain || "").toLowerCase();
      if (!dom) continue;
      const available = row.is_available ?? row.available ?? row.is_free ?? false;
      map.set(dom, !!available);
    }
    return map.size ? map : null;
  } catch (err) {
    console.warn("HOSTINGER DOMAIN LOOKUP FAILED, using fallback:", err.message);
    return null;
  }
}

module.exports = {
  DEFAULT_HOST,
  PATHS,
  resolveHost,
  apiUrl,
  authHeaders,
  isConfigured,
  checkDomainAvailability,
};
