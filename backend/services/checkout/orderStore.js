// services/checkout/orderStore.js
//
// Checkout Order store — a draft purchase intent that reserves RAM on the
// shared box for RESERVATION_TTL_MS so two simultaneous buyers can't both be
// sold capacity that only exists once.
//
// Lifecycle: configure -> createOrder (reserves RAM) -> checkout page renews
// the reservation via a heartbeat GET (getOrder renew:true) -> pay within the
// window and the order flips to "Paid" (reservation stops counting, no
// cleanup job needed) -> or don't pay and the reservation silently expires.
//
// Reservation semantics:
//  - Reserved = sum of ram_mb over orders with status = "Draft" AND
//    reservation_expires_at > now. Expiry needs no sweeper — expired drafts
//    simply stop counting once "now" passes their reservation_expires_at.
//  - createOrder refuses (409 CAPACITY) when
//    fleetReservedRamMb + reservedDraftRamMb(now) + newRamMb > thresholdMb().
//    The read-then-write is serialized through a module-level promise-chain
//    mutex so two concurrent createOrder calls in this process can't both
//    read a stale "reserved" figure and double-book the last slot — the same
//    single-process assumption the provisioning capacity gate makes.
//  - getOrder(renew: true) on an unexpired, unpaid Draft bumps
//    reservation_expires_at to now + RESERVATION_TTL_MS — this is the
//    checkout page's heartbeat, keeping the reservation alive while the buyer
//    is present. If the order has an invoice_doc_name, the linked invoice is
//    always checked (regardless of renew): once it's Paid, the order flips to
//    "Paid" and its RAM stops counting toward the reservation total for good.

const { getServiceMeta } = require("../provisioning/catalog");
const { thresholdMb } = require("../provisioning/capacity");

const ORDER_DOCTYPE = "Checkout Order";
const RESERVATION_TTL_MS = 30 * 60 * 1000;

const INVOICE_DOCTYPE = "Portal Invoice";

// Frappe's MySQL DATETIME column rejects a raw `Date#toISOString()` value
// ("2026-08-11T08:01:35.546Z" — 'T' separator, milliseconds, 'Z' suffix) with
// a 1292 "Incorrect datetime value" error, failing every createOrder() call
// with a generic 500 — caught live 2026-08-11. Format as the naive
// "YYYY-MM-DD HH:MM:SS" (UTC) MySQL expects instead, same convention
// services/provisioning/runner.js's sqlTime()/parseSqlTime() already use for
// this exact class of field.
function mysqlDatetime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}
// Parses a naive "YYYY-MM-DD HH:MM:SS" string as UTC — without the explicit
// "Z", Date.parse() would interpret it in the Node process's local timezone,
// silently corrupting the comparison against Date.now() on any server not
// running in UTC.
function parseMysqlDatetime(s) {
  const t = Date.parse(String(s).replace(" ", "T") + "Z");
  return Number.isNaN(t) ? 0 : t;
}

// --- module-level promise-chain mutex --------------------------------------
// Single Node process — same assumption services/provisioning/capacity.js's
// gate makes. Serializes createOrder's read-reserved-then-write so two
// concurrent requests can't both pass the capacity check for the last slot.
let createChain = Promise.resolve();
function serialize(fn) {
  const p = createChain.then(fn, fn);
  createChain = p.catch(() => {});
  return p;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}
function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}
function forbidden(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}
function checkoutNotConfigured() {
  const err = new Error("Checkout is not configured.");
  err.statusCode = 503;
  return err;
}

// Mirrors frontend/src/config/serviceCatalog.ts's domainCatalogIdForTld() and
// backend/server.js's DOMAIN_TLD_PRICES — all three must stay in sync (see
// that file's DOMAIN_CATALOG comment). Kept local (not required from
// server.js) to avoid a require cycle between orderStore -> server.js.
const DOMAIN_PRODUCT_TLDS = {
  "domain-coke": ".co.ke",
  "domain-com": ".com",
  "domain-ke": ".ke",
  "domain-org": ".org",
  "domain-net": ".net",
  "domain-africa": ".africa",
  "domain-io": ".io",
};

// A reasonably strict domain-label shape: one or more dot-separated labels,
// each alphanumeric with internal hyphens only (no leading/trailing hyphen).
const DOMAIN_SHAPE_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Important 5 (final-review-fix-report.md): without this, a crafted request
 * like { serviceId: "domain-coke", config: { domain: "acme.io" } } would be
 * charged the domain-coke price (KES 1,200) for what is actually a KES 4,500
 * .io domain — the price and the TLD were never cross-checked. For a "Domain
 * Registration" catalog product, require config.domain to be present,
 * well-formed, and to end with the exact TLD the charged serviceId prices.
 */
function assertDomainConfigMatchesService(serviceId, meta, config) {
  if (meta?.category !== "Domain Registration") return;

  const expectedTld = DOMAIN_PRODUCT_TLDS[serviceId];
  const domain = String(config?.domain || "").trim().toLowerCase();

  if (!expectedTld || !domain || !DOMAIN_SHAPE_RE.test(domain) || !domain.endsWith(expectedTld)) {
    throw badRequest(
      expectedTld
        ? `config.domain must be a valid domain ending in ${expectedTld} for ${serviceId}.`
        : `Unknown domain product: ${serviceId}.`
    );
  }
}

/**
 * List Draft order rows (fresh read, no caching). A 404 here means the
 * "Checkout Order" doctype itself hasn't been created in this environment
 * yet — mirrors the doctypeMissing tolerance used by
 * services/provisioning/provisioningService.js, surfaced as a 503 so callers
 * can show "checkout isn't set up here" instead of a raw Frappe error.
 */
async function listDraftRows(client) {
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
      params: {
        fields: JSON.stringify(["name", "web_account", "status", "ram_mb", "reservation_expires_at"]),
        filters: JSON.stringify([["status", "=", "Draft"]]),
        limit_page_length: 0,
      },
    });
    return res.data?.data || [];
  } catch (e) {
    if (e.__doctypeMissing || e.response?.status === 404 || e.response?.status === 417) {
      throw checkoutNotConfigured();
    }
    throw e;
  }
}

/** Sum ram_mb over live (unexpired, unpaid) Draft orders. */
async function reservedDraftRamMb(client, nowMs) {
  const rows = await listDraftRows(client);
  return rows
    // Re-filter in JS: the mock (and a misconfigured server-side filter)
    // may return more than just Draft rows, so behavior must not depend on
    // the backend actually honoring the filters param.
    .filter((r) => r.status === "Draft" && parseMysqlDatetime(r.reservation_expires_at) > nowMs)
    .reduce((sum, r) => sum + (Number(r.ram_mb) || 0), 0);
}

async function fetchOrderDoc(client, orderId) {
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`);
    const doc = res.data?.data;
    if (!doc) throw notFound("Checkout order not found.");
    return doc;
  } catch (e) {
    if (e.statusCode) throw e;
    if (e.response?.status === 404) throw notFound("Checkout order not found.");
    throw e;
  }
}

async function fetchInvoice(client, invoiceDocName) {
  try {
    const res = await client.get(`/api/resource/${INVOICE_DOCTYPE}/${encodeURIComponent(invoiceDocName)}`);
    return res.data?.data || null;
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

/**
 * Create a Draft Checkout Order, reserving its RAM footprint for
 * RESERVATION_TTL_MS. Throws 400 for an unknown/unpriced/quote-only service,
 * 409 (code "CAPACITY") when the shared box has no room right now.
 */
async function createOrder({
  client,
  webAccountName,
  serviceId,
  config,
  planKey,
  source,
  fleetReservedRamMb,
  nowMs,
}) {
  const meta = getServiceMeta(serviceId);
  if (!meta || !(Number(meta.monthlyKes) > 0) || meta.capacityClass === "dedicated") {
    throw badRequest(`Checkout is not available for service: ${serviceId}`);
  }
  assertDomainConfigMatchesService(serviceId, meta, config);

  return serialize(async () => {
    const ramMb = Number(meta.ramMb) || 0;
    const reserved = await reservedDraftRamMb(client, nowMs);
    if ((Number(fleetReservedRamMb) || 0) + reserved + ramMb > thresholdMb()) {
      const err = new Error(
        "Not enough shared capacity right now — please try again shortly or contact us for a dedicated quote."
      );
      err.statusCode = 409;
      err.code = "CAPACITY";
      throw err;
    }

    const payload = {
      web_account: webAccountName,
      status: "Draft",
      service_id: serviceId,
      service_name: meta.name || serviceId,
      tier: meta.tier || "",
      category: meta.category || "",
      monthly_kes: Number(meta.monthlyKes) || 0,
      setup_kes: Number(meta.setupKes) || 0,
      ram_mb: ramMb,
      disk_gb: Number(meta.diskGb) || 0,
      plan_key: planKey || "",
      config_json: JSON.stringify(config || {}),
      reservation_expires_at: mysqlDatetime(nowMs + RESERVATION_TTL_MS),
      invoice_doc_name: "",
      source: source || "",
    };

    const created = await client.post(`/api/resource/${ORDER_DOCTYPE}`, payload);
    return toApiOrder(created.data?.data || payload);
  });
}

/**
 * Fetch an order by id, scoped to its owner. `renew: true` is the checkout
 * page's heartbeat — extends the reservation while the buyer is present. If
 * the order carries a linked invoice, its paid status is always checked
 * (independent of renew) so an order that was paid while unattended still
 * flips to "Paid" the next time anyone looks at it.
 */
async function getOrder({ client, webAccountName, orderId, nowMs, renew }) {
  let doc = await fetchOrderDoc(client, orderId);
  if (doc.web_account !== webAccountName) throw forbidden("This checkout order belongs to another account.");

  if (renew && doc.status === "Draft" && parseMysqlDatetime(doc.reservation_expires_at) > nowMs) {
    const updated = await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, {
      reservation_expires_at: mysqlDatetime(nowMs + RESERVATION_TTL_MS),
    });
    doc = updated.data?.data || doc;
  }

  if (doc.invoice_doc_name && doc.status !== "Paid") {
    const invoice = await fetchInvoice(client, doc.invoice_doc_name);
    if (invoice && String(invoice.status || "").toLowerCase() === "paid") {
      const updated = await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, {
        status: "Paid",
      });
      doc = updated.data?.data || { ...doc, status: "Paid" };
    }
  }

  return toApiOrder(doc);
}

/** Cancel a Draft order, scoped to its owner. Releases the reservation. */
async function cancelOrder({ client, webAccountName, orderId }) {
  const doc = await fetchOrderDoc(client, orderId);
  if (doc.web_account !== webAccountName) throw forbidden("This checkout order belongs to another account.");

  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, { status: "Cancelled" });
  return { ok: true };
}

/** Link a Portal Invoice doc name to a Draft order (Task 3 calls this once the invoice is created). */
async function linkInvoice({ client, orderId, invoiceDocName }) {
  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, {
    invoice_doc_name: invoiceDocName,
  });
}

/** frappe snake_case doc -> camelCase API shape. */
function toApiOrder(doc) {
  const monthlyKes = Number(doc.monthly_kes) || 0;
  const setupKes = Number(doc.setup_kes) || 0;
  let config = {};
  try {
    config = doc.config_json ? JSON.parse(doc.config_json) : {};
  } catch {
    config = {};
  }
  return {
    id: doc.name,
    status: doc.status,
    serviceId: doc.service_id,
    serviceName: doc.service_name,
    tier: doc.tier,
    category: doc.category,
    monthlyKes,
    setupKes,
    totalDueKes: monthlyKes + setupKes,
    // Re-emit as an unambiguous ISO 8601 UTC string — the DB stores the
    // naive MySQL DATETIME format (no timezone marker), which every API
    // consumer (frontend, tests) would otherwise have to know to parse as
    // UTC specifically to avoid a local-timezone-dependent Date.parse().
    reservationExpiresAt: doc.reservation_expires_at
      ? new Date(parseMysqlDatetime(doc.reservation_expires_at)).toISOString()
      : doc.reservation_expires_at,
    invoiceDocName: doc.invoice_doc_name || null,
    config,
  };
}

module.exports = {
  ORDER_DOCTYPE,
  RESERVATION_TTL_MS,
  createOrder,
  getOrder,
  cancelOrder,
  linkInvoice,
  reservedDraftRamMb,
  toApiOrder,
};
