// services/apps/tenantSlugStore.js
//
// Who holds which customer-chosen app address. The doctype is named by the
// slug itself (autoname field:slug), so the database — not this code — is
// what guarantees two buyers can never both own "mamanjeri".
//
// Lifecycle mirrors Checkout Order reservations (orderStore.js):
//   reserved  held by an unpaid order until expires_at (30 min, renewed by
//             the checkout page heartbeat; extended to 24h once an invoice
//             exists, so a slow M-Pesa confirmation can't lose the name)
//   active    paid — owned for good
//   released  free again (never written today: expiry alone frees a name,
//             no sweeper needed, same as RAM reservations)

const { checkSlug } = require("./shopAddress");
const { mysqlDatetime, parseMysqlDatetime } = require("../checkout/orderStore");

const TENANT_SLUG_DOCTYPE = "Tenant Slug";
const SLUG_RESERVATION_TTL_MS = 30 * 60 * 1000;
const SLUG_PAYMENT_GRACE_MS = 24 * 60 * 60 * 1000;
const BASE = `/api/resource/${encodeURIComponent(TENANT_SLUG_DOCTYPE)}`;

// Single Node process — same assumption orderStore.js's mutex makes. The
// unique doc name still protects against a second process.
let chain = Promise.resolve();
function serialize(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

function slugError(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function isLive(doc, nowMs) {
  if (!doc) return false;
  if (doc.status === "active") return true;
  return doc.status === "reserved" && parseMysqlDatetime(doc.expires_at) > nowMs;
}

async function getSlugDoc(client, slug) {
  try {
    const res = await client.get(`${BASE}/${encodeURIComponent(slug)}`);
    return res.data?.data || null;
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

async function isSlugAvailable(client, slug, nowMs) {
  return !isLive(await getSlugDoc(client, slug), nowMs);
}

async function reserveSlug(client, { slug, app, webAccount, orderId, nowMs }) {
  if (!checkSlug(slug).ok) throw slugError("slug_invalid", "That shop address isn't allowed.", 400);
  return serialize(async () => {
    const doc = await getSlugDoc(client, slug);
    const heldByOther = isLive(doc, nowMs) && !(doc.status === "reserved" && doc.web_account === webAccount);
    if (heldByOther) throw slugError("slug_taken", "That shop address was just taken.", 409);

    const fields = {
      app,
      web_account: webAccount,
      status: "reserved",
      checkout_order: orderId,
      invoice: "",
      expires_at: mysqlDatetime(nowMs + SLUG_RESERVATION_TTL_MS),
    };
    if (doc) {
      await client.put(`${BASE}/${encodeURIComponent(slug)}`, fields);
      return;
    }
    try {
      await client.post(BASE, { slug, ...fields });
    } catch (e) {
      // Another process won the insert between our read and write.
      if (e.response?.status === 409) throw slugError("slug_taken", "That shop address was just taken.", 409);
      throw e;
    }
  });
}

async function touchSlug(client, { slug, webAccount, nowMs }) {
  try {
    const doc = await getSlugDoc(client, slug);
    if (!doc || doc.status !== "reserved" || doc.web_account !== webAccount || doc.invoice) return;
    if (parseMysqlDatetime(doc.expires_at) <= nowMs) return;
    await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
      expires_at: mysqlDatetime(nowMs + SLUG_RESERVATION_TTL_MS),
    });
  } catch (e) {
    // Heartbeat is best-effort; the order's own heartbeat still runs.
  }
}

async function linkSlugInvoice(client, { slug, webAccount, invoiceDocName, nowMs }) {
  const doc = await getSlugDoc(client, slug);
  if (!doc || doc.web_account !== webAccount) {
    throw slugError("slug_taken", "That shop address is no longer reserved for you.", 409);
  }
  await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
    invoice: invoiceDocName,
    expires_at: mysqlDatetime(nowMs + SLUG_PAYMENT_GRACE_MS),
  });
}

async function activateSlugForInvoice(client, invoiceDocName) {
  const res = await client.get(BASE, {
    params: {
      filters: JSON.stringify([["invoice", "=", invoiceDocName], ["status", "in", ["reserved", "active"]]]),
      fields: JSON.stringify(["name", "slug", "status"]),
      limit_page_length: 1,
    },
  });
  const row = res.data?.data?.[0];
  if (!row) return null;
  if (row.status !== "active") {
    await client.put(`${BASE}/${encodeURIComponent(row.name)}`, { status: "active" });
  }
  return row.slug || row.name;
}

module.exports = {
  TENANT_SLUG_DOCTYPE,
  SLUG_RESERVATION_TTL_MS,
  SLUG_PAYMENT_GRACE_MS,
  isSlugAvailable,
  reserveSlug,
  touchSlug,
  linkSlugInvoice,
  activateSlugForInvoice,
};
