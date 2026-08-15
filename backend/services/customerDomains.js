/**
 * Customer Domain — the account's canonical record of a domain it owns.
 *
 * Before this, a domain was not a thing you owned; it was a side effect of
 * buying website hosting. Three separate intake doctypes (Hosting Domain
 * Purchase Request / Hosting Murzak Subdomain / Hosting External Domain
 * Connection) each stored their own half-shaped idea of a domain, all scoped
 * to one hardcoded service id, and each gated on the parent service's
 * `domainChoice` string. A customer could not hold an unattached domain, move
 * one between services, or point a second domain at an existing site.
 *
 * Those three stay, demoted to what they always were — intake/workflow
 * records. This is the row that says "this account owns this name", and it is
 * the only place that answers that question.
 *
 * `attached_to_service` is a plain serviceId string, not a Link: services are
 * child rows on Web Account.selected_services, not a doctype of their own.
 * Null means owned but not pointed at anything, which is a legitimate state.
 */

const CUSTOMER_DOMAIN_DOCTYPE = "Customer Domain";

/** How the account came to hold this name. Drives fulfillment, not billing. */
const DOMAIN_KINDS = Object.freeze({
  REGISTERED: "registered", // we register it on their behalf (manual, paid)
  EXTERNAL: "external", // they already own it elsewhere; we point it here
  MURZAK_SUBDOMAIN: "murzak_subdomain", // free *.murzaktech.com label
});

const DOMAIN_KIND_VALUES = Object.freeze(Object.values(DOMAIN_KINDS));

/**
 * pending  — intake submitted, not usable yet
 * active   — resolving and serving
 * failed   — registration/verification did not succeed
 * expired  — was active, lapsed
 * cancelled— withdrawn before completion
 */
const DOMAIN_STATUSES = Object.freeze(["pending", "active", "failed", "expired", "cancelled"]);

const SSL_STATUSES = Object.freeze(["none", "pending", "active"]);

/** Which intake doctype produced a domain → the kind it becomes. */
const INTAKE_DOCTYPE_KINDS = Object.freeze({
  "Hosting Domain Purchase Request": DOMAIN_KINDS.REGISTERED,
  "Hosting External Domain Connection": DOMAIN_KINDS.EXTERNAL,
  "Hosting Murzak Subdomain": DOMAIN_KINDS.MURZAK_SUBDOMAIN,
});

/**
 * Reduce user input to the bare hostname so the same domain typed three
 * different ways is one record. Deliberately does NOT strip "www." —
 * www.example.com and example.com are different hosts and may point
 * different places.
 */
function normalizeDomainName(raw) {
  let s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.split("/")[0]; // path
  s = s.split("?")[0].split("#")[0];
  s = s.split("@").pop(); // stray userinfo / pasted email
  s = s.split(":")[0]; // port
  s = s.replace(/\.+$/, ""); // trailing root dot
  return s.trim();
}

/**
 * Shape check only — says nothing about whether the name is registrable or
 * available. Mirrors the isValidDomain regex already used for the domain
 * search endpoint so the two can't disagree about what a domain looks like.
 */
function isValidDomainName(raw) {
  const d = normalizeDomainName(raw);
  if (!d || d.length > 253) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(d);
}

function domainKindForIntake(intakeDoctype) {
  return INTAKE_DOCTYPE_KINDS[intakeDoctype] || null;
}

function normalizeKind(kind) {
  const k = String(kind || "").trim().toLowerCase();
  return DOMAIN_KIND_VALUES.includes(k) ? k : null;
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return DOMAIN_STATUSES.includes(s) ? s : "pending";
}

function normalizeSslStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return SSL_STATUSES.includes(s) ? s : "none";
}

/** The Frappe doc body for a new Customer Domain. Pure — no IO. */
function buildCustomerDomainPayload({
  webAccount,
  domainName,
  kind,
  status,
  registrar,
  sourceDoctype,
  sourceName,
  attachedToService,
  expiresOn,
  notes,
}) {
  const domain_name = normalizeDomainName(domainName);
  const resolvedKind = normalizeKind(kind) || domainKindForIntake(sourceDoctype);
  if (!webAccount) throw new Error("Customer Domain requires a web account.");
  if (!domain_name) throw new Error("Customer Domain requires a domain name.");
  if (!resolvedKind) throw new Error(`Customer Domain requires a valid kind (got ${JSON.stringify(kind)}).`);

  return {
    web_account: webAccount,
    domain_name,
    kind: resolvedKind,
    status: normalizeStatus(status),
    registrar: String(registrar || "").trim(),
    // Provenance: which intake record produced this, so an admin looking at a
    // domain can find the request it came from without guessing.
    source_doctype: String(sourceDoctype || "").trim(),
    source_name: String(sourceName || "").trim(),
    attached_to_service: String(attachedToService || "").trim(),
    expires_on: expiresOn || null,
    auto_renew: 0,
    ssl_status: "none",
    notes: String(notes || "").trim(),
  };
}

/** Frappe row → the shape the portal API returns. Pure — no IO. */
function mapCustomerDomainRow(row) {
  return {
    id: row.name,
    domainName: row.domain_name,
    kind: row.kind,
    status: normalizeStatus(row.status),
    registrar: row.registrar || "",
    sslStatus: normalizeSslStatus(row.ssl_status),
    expiresOn: row.expires_on || null,
    autoRenew: !!row.auto_renew,
    attachedToService: row.attached_to_service || null,
    sourceDoctype: row.source_doctype || "",
    sourceName: row.source_name || "",
    notes: row.notes || "",
    createdAt: row.creation,
  };
}

const LIST_FIELDS = [
  "name",
  "domain_name",
  "kind",
  "status",
  "registrar",
  "ssl_status",
  "expires_on",
  "auto_renew",
  "attached_to_service",
  "source_doctype",
  "source_name",
  "notes",
  "creation",
];

// ---- IO ----

async function listCustomerDomains(client, webAccount) {
  const res = await client.get(`/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([["web_account", "=", webAccount]]),
      fields: JSON.stringify(LIST_FIELDS),
      order_by: "creation desc",
      limit_page_length: 200,
    },
  });
  return (res.data?.data || []).map(mapCustomerDomainRow);
}

async function findCustomerDomainByName(client, webAccount, domainName) {
  const name = normalizeDomainName(domainName);
  if (!name) return null;
  const res = await client.get(`/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccount],
        ["domain_name", "=", name],
      ]),
      fields: JSON.stringify(LIST_FIELDS),
      limit_page_length: 1,
    },
  });
  const row = res.data?.data?.[0];
  return row ? mapCustomerDomainRow(row) : null;
}

/**
 * Create the account's record of a domain, unless it already holds that name.
 *
 * Idempotent on (web_account, domain_name) so replaying the backfill, or a
 * customer double-submitting an intake form, cannot produce two records for
 * one name. Returns { domain, created } so callers can tell which happened.
 */
async function ensureCustomerDomain(client, payloadInput) {
  const payload = buildCustomerDomainPayload(payloadInput);
  const existing = await findCustomerDomainByName(client, payload.web_account, payload.domain_name);
  if (existing) return { domain: existing, created: false };

  const res = await client.post(`/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}`, payload);
  const row = res.data?.data;
  return { domain: row ? mapCustomerDomainRow(row) : null, created: true };
}

/**
 * Point a domain at a service, or (serviceId = null) leave it unattached.
 *
 * This is the call that replaces the old domainChoice gate: attaching is a
 * thing the customer does to a domain they own, not a decision frozen at
 * purchase time.
 */
async function setDomainAttachment(client, domainId, serviceId) {
  await client.put(
    `/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}/${encodeURIComponent(domainId)}`,
    { attached_to_service: serviceId ? String(serviceId).trim() : "" }
  );
}

async function updateCustomerDomain(client, domainId, patch) {
  await client.put(
    `/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}/${encodeURIComponent(domainId)}`,
    patch
  );
}

module.exports = {
  CUSTOMER_DOMAIN_DOCTYPE,
  DOMAIN_KINDS,
  DOMAIN_KIND_VALUES,
  DOMAIN_STATUSES,
  INTAKE_DOCTYPE_KINDS,
  LIST_FIELDS,
  buildCustomerDomainPayload,
  domainKindForIntake,
  ensureCustomerDomain,
  findCustomerDomainByName,
  isValidDomainName,
  listCustomerDomains,
  mapCustomerDomainRow,
  normalizeDomainName,
  normalizeStatus,
  setDomainAttachment,
  updateCustomerDomain,
};
