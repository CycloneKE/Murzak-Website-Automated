// services/apps/shopAddress.js
//
// Rules for the address a customer picks for their own app instance
// (<slug>.pos.murzaktech.tech, backed by <slug>.erp.murzaktech.tech). Pure
// functions — availability is tenantSlugStore.js's job.
//
// The shape must stay inside what the tenant front door accepts
// (deploy/vps/nginx/pos-tenants-wildcard: [a-z0-9][a-z0-9-]{0,39}) and what
// Frappe accepts as a site directory name.

const MAX_LEN = 40;
const MIN_LEN = 3;
const SHAPE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const RESERVED_SLUGS = new Set([
  "api", "www", "admin", "pos", "erp", "mail", "apps", "murzak", "support",
  "billing", "status", "app", "portal", "help", "test", "demo", "staging",
]);

function trimHyphens(s) {
  return s.replace(/^-+/, "").replace(/-+$/, "");
}

/** Turn a shop name into a candidate address. May return "" when nothing is usable. */
function slugFromName(name) {
  const ascii = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hyphenated = trimHyphens(ascii.replace(/[^a-z0-9]+/g, "-"));
  return trimHyphens(hyphenated.slice(0, MAX_LEN));
}

function checkSlug(slug) {
  const s = String(slug || "");
  if (s.length < MIN_LEN) return { ok: false, reason: "too_short" };
  if (s.length > MAX_LEN) return { ok: false, reason: "too_long" };
  if (!SHAPE_RE.test(s)) return { ok: false, reason: "invalid" };
  // user-<digit>… is the shape murzak-bench-provision derives from account
  // ids; prov-check is its wildcard DNS probe. Either would collide.
  if (RESERVED_SLUGS.has(s) || /^user-\d/.test(s) || s.startsWith("prov-check")) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true };
}

/** Up to three valid alternatives to a taken address. */
function suggestSlugs(slug) {
  const base = trimHyphens(String(slug || "").slice(0, MAX_LEN - 5));
  const out = [];
  for (const suffix of ["shop", "ke", "2", "store", "3"]) {
    const candidate = `${base}-${suffix}`;
    if (candidate !== slug && checkSlug(candidate).ok && !out.includes(candidate)) out.push(candidate);
    if (out.length === 3) break;
  }
  return out;
}

module.exports = { RESERVED_SLUGS, slugFromName, checkSlug, suggestSlugs };
