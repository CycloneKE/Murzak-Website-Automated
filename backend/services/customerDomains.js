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

/**
 * Statuses that mean a human still has to do something. Registration is
 * manual (the registrar's API terms blocked automating it), so "pending" is
 * not a transient state the system clears on its own — it is a work queue.
 */
const DOMAIN_ACTIONABLE_STATUSES = Object.freeze(["pending"]);

/**
 * Which status changes staff may make, and why the ones that are refused are
 * refused. Pure so the state machine is readable in one place instead of
 * inferred from a route handler's if-chain.
 *
 *   pending   -> active | failed | cancelled   (the fulfilment decision)
 *   failed    -> pending | active | cancelled  (retry after fixing something)
 *   active    -> expired | cancelled           (lapsed, or given up)
 *   expired   -> active | cancelled            (renewed)
 *   cancelled -> nothing                       (terminal)
 */
const DOMAIN_STATUS_TRANSITIONS = Object.freeze({
  pending: ["active", "failed", "cancelled"],
  failed: ["pending", "active", "cancelled"],
  active: ["expired", "cancelled"],
  expired: ["active", "cancelled"],
  cancelled: [],
});

function canTransitionDomainStatus(from, to) {
  const f = normalizeStatus(from);
  const t = String(to || "").trim().toLowerCase();
  if (!DOMAIN_STATUSES.includes(t)) {
    return { ok: false, reason: `"${to}" is not a domain status.` };
  }
  if (f === t) return { ok: false, reason: `This domain is already ${t}.` };
  const allowed = DOMAIN_STATUS_TRANSITIONS[f] || [];
  if (!allowed.includes(t)) {
    const article = /^[aeiou]/.test(f) ? "An" : "A";
    return {
      ok: false,
      reason: allowed.length
        ? `${article} ${f} domain can only become ${allowed.join(" or ")}.`
        : `${article} ${f} domain is final and cannot change.`,
    };
  }
  return { ok: true };
}

/**
 * The intakes' Select vocabularies, as they actually exist in Frappe.
 *
 * All three are different, and NONE of them uses the Customer Domain words.
 * A purchase request goes to "connected", not "active"; an external
 * connection fails to "failed" but a subdomain fails to "rejected"; none has
 * "cancelled" at all. Writing our own vocabulary across them — which is what
 * the first version of this did, and which the mock happily accepted because
 * it stores any string — would have quietly filled production with statuses
 * the doctype's own Select cannot display.
 */
const INTAKE_STATUS_MAPS = Object.freeze({
  // pending | quoted | awaiting_payment | purchased | connected | rejected
  "Hosting Domain Purchase Request": {
    pending: "pending",
    active: "connected",
    failed: "rejected",
    cancelled: "rejected",
  },
  // pending | awaiting_dns_update | verifying | connected | failed
  "Hosting External Domain Connection": {
    pending: "pending",
    active: "connected",
    failed: "failed",
    cancelled: "failed",
  },
  // pending | active | rejected | suspended
  "Hosting Murzak Subdomain": {
    pending: "pending",
    active: "active",
    failed: "rejected",
    cancelled: "rejected",
  },
});

/**
 * The status to push back onto the intake record a domain came from.
 *
 * The intakes are what the customer's hosting dashboard still reads, so
 * fulfilling a domain without syncing them leaves the customer staring at
 * "pending" forever while staff see it as done.
 *
 * Returns null when there is no safe equivalent — an unknown source doctype,
 * or "expired", which no intake vocabulary expresses because an intake
 * described a one-off request that completed, not the domain's ongoing life.
 * A null means leave the intake alone rather than write a value its Select
 * cannot hold.
 */
function intakeStatusForDomainStatus(domainStatus, sourceDoctype) {
  const map = INTAKE_STATUS_MAPS[sourceDoctype];
  if (!map) return null;
  return map[normalizeStatus(domainStatus)] || null;
}

/**
 * Can this domain be pointed at this service right now?
 *
 * The authorization boundary for attach, kept pure so every rule is visible
 * and testable in one place rather than scattered through a route handler.
 * `ownedServices` is the account's own selected_services rows.
 */
function canAttachDomain({ domain, serviceId, ownedServices }) {
  if (!domain) return { ok: false, reason: "Domain not found." };
  const id = String(serviceId || "").trim();
  if (!id) return { ok: false, reason: "A service is required." };

  const svc = (Array.isArray(ownedServices) ? ownedServices : []).find(
    (s) => String(s?.serviceId || "").trim() === id
  );
  // Not owning the service is indistinguishable from it not existing, on
  // purpose: this endpoint must not confirm which service ids are real.
  if (!svc) return { ok: false, reason: "That service is not on your account." };
  if (String(svc.status || "").trim() !== "Active") {
    return { ok: false, reason: "That service is not active yet." };
  }
  if (domain.status === "cancelled" || domain.status === "expired") {
    return { ok: false, reason: `This domain is ${domain.status} and cannot be attached.` };
  }
  if (domain.attachedToService === id) {
    return { ok: false, reason: "This domain is already pointed at that service." };
  }
  return { ok: true };
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

/**
 * Every account's domains, for the staff fulfilment queue. Carries
 * web_account (the per-account list deliberately does not) so staff can see
 * whose domain they are working on.
 */
async function listAllCustomerDomains(client, { status } = {}) {
  const filters = [];
  const wanted = String(status || "").trim().toLowerCase();
  if (wanted && DOMAIN_STATUSES.includes(wanted)) filters.push(["status", "=", wanted]);

  const res = await client.get(`/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}`, {
    params: {
      ...(filters.length ? { filters: JSON.stringify(filters) } : {}),
      fields: JSON.stringify([...LIST_FIELDS, "web_account"]),
      // Oldest first: the queue should surface whoever has been waiting
      // longest, not whoever asked most recently.
      order_by: "creation asc",
      limit_page_length: 500,
    },
  });
  return (res.data?.data || []).map((row) => ({
    ...mapCustomerDomainRow(row),
    webAccount: row.web_account,
  }));
}

/** Count domains by status, for the queue's badge and filter chips. */
function summarizeByStatus(domains) {
  const out = {};
  for (const s of DOMAIN_STATUSES) out[s] = 0;
  for (const d of Array.isArray(domains) ? domains : []) {
    const s = normalizeStatus(d?.status);
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

/**
 * Fetch one domain, but only if this account owns it.
 *
 * Ownership is checked here rather than trusted from the caller so no route
 * can accidentally expose another account's domain by id.
 */
async function getOwnedCustomerDomain(client, webAccount, domainId) {
  if (!domainId) return null;
  let res;
  try {
    res = await client.get(
      `/api/resource/${encodeURIComponent(CUSTOMER_DOMAIN_DOCTYPE)}/${encodeURIComponent(domainId)}`
    );
  } catch (e) {
    // Frappe 404s an unknown name. That is "not found", not a server fault —
    // letting it propagate turned a guessed id into a 500.
    if (e.response?.status === 404) return null;
    throw e;
  }
  const row = res.data?.data;
  if (!row) return null;
  if (String(row.web_account || "").trim() !== String(webAccount || "").trim()) return null;
  return mapCustomerDomainRow(row);
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
  DOMAIN_ACTIONABLE_STATUSES,
  DOMAIN_KINDS,
  DOMAIN_KIND_VALUES,
  DOMAIN_STATUSES,
  DOMAIN_STATUS_TRANSITIONS,
  INTAKE_DOCTYPE_KINDS,
  INTAKE_STATUS_MAPS,
  LIST_FIELDS,
  buildCustomerDomainPayload,
  canAttachDomain,
  canTransitionDomainStatus,
  domainKindForIntake,
  ensureCustomerDomain,
  findCustomerDomainByName,
  getOwnedCustomerDomain,
  intakeStatusForDomainStatus,
  isValidDomainName,
  listAllCustomerDomains,
  listCustomerDomains,
  mapCustomerDomainRow,
  normalizeDomainName,
  normalizeStatus,
  setDomainAttachment,
  summarizeByStatus,
  updateCustomerDomain,
};
