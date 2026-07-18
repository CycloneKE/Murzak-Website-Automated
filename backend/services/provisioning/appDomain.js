/**
 * appDomain — deterministic customer-facing hostnames for BYOA apps.
 *
 * Every deployed app gets `{slug}.{APP_DOMAIN_BASE}` (e.g.
 * my-shop.apps.murzaktech.tech). DNS is a ONE-TIME wildcard record the
 * operator creates manually (`*.apps.murzaktech.tech` A → the box's IP) —
 * this module never calls a DNS API, so the deploy hot path has zero
 * registrar dependencies. Coolify then issues per-hostname Let's Encrypt
 * certs via HTTP-01, which works fine under a wildcard A record.
 *
 * Honest degradation: with APP_DOMAIN_BASE unset, isConfigured() is false and
 * the lane skips domain assignment — the app still deploys, and the portal
 * shows "URL pending" rather than a fabricated link (and NEVER the Coolify
 * admin panel).
 */

const crypto = require("crypto");

function domainBase() {
  return String(process.env.APP_DOMAIN_BASE || "")
    .trim()
    .toLowerCase()
    // tolerate operators pasting a scheme or trailing dot/slash
    .replace(/^https?:\/\//, "")
    .replace(/[/.]+$/, "");
}

function isConfigured() {
  return !!domainBase();
}

/**
 * 4-char stable suffix from the job name — used to de-collide two accounts
 * whose (web_account, service_id) slugs normalize to the same string.
 * Deterministic so retries of the same job always produce the same fqdn.
 */
function slugSuffix(jobName) {
  return crypto.createHash("sha256").update(String(jobName || "")).digest("hex").slice(0, 4);
}

/** Append the job-hash suffix, keeping the whole label DNS-valid (≤63 chars). */
function slugWithSuffix(slug, jobName) {
  const base = String(slug || "app").slice(0, 58).replace(/-+$/, "");
  return `${base}-${slugSuffix(jobName)}`;
}

/** Full customer URL for a slug. Empty string when unconfigured (degrade, don't guess). */
function fqdnFor(slug) {
  const base = domainBase();
  if (!base || !slug) return "";
  return `https://${slug}.${base}`;
}

module.exports = { isConfigured, domainBase, slugWithSuffix, slugSuffix, fqdnFor };
