// services/apps/tenantSlugStore.js
//
// Who holds which customer-chosen app address. The doctype is named by the
// slug itself (autoname field:slug), so the database — not this code — is
// what guarantees two buyers can never both own "mamanjeri".
//
// Lifecycle mirrors Checkout Order reservations (orderStore.js):
//   reserved  held by an unpaid order until expires_at (30 min, renewed by
//             the checkout page heartbeat; extended to 24h once an invoice
//             exists, so a slow M-Pesa confirmation can't lose the name).
//             `invoice` is a comma-separated history of every invoice raised
//             for the slug: a buyer who retries the pay step gets a new
//             invoice, and a late payment on the OLD one must still win.
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
// unique doc name (slug) protects ONLY the first insert across processes.
// Re-reserving or taking over an existing doc is a read-then-write that
// relies on this mutex; a second Node process would need an optimistic lock
// on the doc's `modified` timestamp.
//
// Every serialized operation is also time-boxed. One hung Frappe call (a socket
// that never answers) would otherwise hold the head of the chain forever and
// block every later slug operation for every buyer. On timeout the caller gets a
// coded 503 and the chain moves on. The abandoned call is not cancelled (there is
// no abort plumbed through the client), so it may still land its write late; that
// is the same race a second process would have, which the slug doc's unique name
// and the reserve/link re-reads already tolerate.
const SLUG_STORE_TIMEOUT_MS = 15000;
let opTimeoutMs = SLUG_STORE_TIMEOUT_MS;
/** Test hook: shorten (or, with no argument, restore) the per-operation timeout. */
function setSlugStoreTimeoutMsForTests(ms) {
  opTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : SLUG_STORE_TIMEOUT_MS;
}

function slugError(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function withTimeout(fn) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(slugError("slug_store_timeout", "The shop address service is taking too long — please try again.", 503)),
      opTimeoutMs
    );
    Promise.resolve()
      .then(fn)
      .then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
  });
}

let chain = Promise.resolve();
function serialize(fn) {
  const run = () => withTimeout(fn);
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function isLive(doc, nowMs) {
  if (!doc) return false;
  if (doc.status === "active") return true;
  return doc.status === "reserved" && parseMysqlDatetime(doc.expires_at) > nowMs;
}

function invoiceNames(list) {
  return String(list || "").split(",").map((s) => s.trim()).filter(Boolean);
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

// Like isSlugAvailable, but a buyer's OWN reservation (live or lapsed) counts as
// free for them: reserveSlug lets the same account re-reserve, so an
// availability check must not lock them out of their own address on a retry.
// An `active` (paid) slug is never available to anyone.
async function isSlugAvailableTo(client, slug, webAccount, nowMs) {
  const doc = await getSlugDoc(client, slug);
  if (!isLive(doc, nowMs)) return true;
  return doc.status === "reserved" && !!webAccount && doc.web_account === webAccount;
}

async function reserveSlug(client, { slug, app, webAccount, orderId, nowMs }) {
  if (!checkSlug(slug).ok) throw slugError("slug_invalid", "That shop address isn't allowed.", 400);
  return serialize(async () => {
    const doc = await getSlugDoc(client, slug);
    const heldByOther = isLive(doc, nowMs) && !(doc.status === "reserved" && doc.web_account === webAccount);
    if (heldByOther) throw slugError("slug_taken", "That shop address was just taken.", 409);

    const wanted = nowMs + SLUG_RESERVATION_TTL_MS;
    if (doc && doc.status === "reserved" && doc.web_account === webAccount) {
      // Same buyer retrying: keep the invoice history and never shorten an
      // existing (possibly 24h payment-grace) hold.
      await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
        checkout_order: orderId,
        expires_at: mysqlDatetime(Math.max(wanted, parseMysqlDatetime(doc.expires_at) || 0)),
      });
      return;
    }
    const fields = {
      app,
      web_account: webAccount,
      status: "reserved",
      checkout_order: orderId,
      invoice: "",
      expires_at: mysqlDatetime(wanted),
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
  // Best-effort heartbeat; the order's own heartbeat still runs if this fails.
  try {
    await serialize(async () => {
      const doc = await getSlugDoc(client, slug);
      if (!doc || doc.status !== "reserved" || doc.web_account !== webAccount || doc.invoice) return;
      if (parseMysqlDatetime(doc.expires_at) <= nowMs) return;
      await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
        expires_at: mysqlDatetime(nowMs + SLUG_RESERVATION_TTL_MS),
      });
    });
  } catch (e) {
    // swallowed on purpose
  }
}

async function linkSlugInvoice(client, { slug, webAccount, invoiceDocName, nowMs }) {
  return serialize(async () => {
    const doc = await getSlugDoc(client, slug);
    if (!doc || doc.web_account !== webAccount) {
      throw slugError("slug_taken", "That shop address is no longer reserved for you.", 409);
    }
    const names = invoiceNames(doc.invoice);
    if (!names.includes(invoiceDocName)) names.push(invoiceDocName);
    await client.put(`${BASE}/${encodeURIComponent(slug)}`, {
      invoice: names.join(","),
      expires_at: mysqlDatetime(Math.max(nowMs + SLUG_PAYMENT_GRACE_MS, parseMysqlDatetime(doc.expires_at) || 0)),
    });
  });
}

async function activateSlugForInvoice(client, invoiceDocName) {
  return serialize(async () => {
    const res = await client.get(BASE, {
      params: {
        // LIKE is only a prefilter (PINV-1 also matches PINV-10); the exact
        // membership test below is the authority.
        filters: JSON.stringify([["invoice", "like", "%" + invoiceDocName + "%"], ["status", "in", ["reserved", "active"]]]),
        fields: JSON.stringify(["name", "slug", "status", "invoice"]),
        limit_page_length: 100,
      },
    });
    const row = (res.data?.data || []).find((r) => invoiceNames(r.invoice).includes(invoiceDocName));
    if (!row) return null;
    if (row.status !== "active") {
      await client.put(`${BASE}/${encodeURIComponent(row.name)}`, { status: "active" });
    }
    return row.slug || row.name;
  });
}

/**
 * The slug of the account's own ACTIVE shop for `app`, or null.
 *
 * Renewal invoices (REN-...) re-bill the account's service rows but carry no
 * Tenant Slug link and no Checkout Order, so activateSlugForInvoice finds
 * nothing for them. Without this the provisioner would derive a fresh,
 * account-based name and build a SECOND, empty shop. Adopting the account's
 * existing slug lets the provisioner idempotently re-adopt the same site.
 *
 * Throws on a failed lookup on purpose: the caller must treat "couldn't ask" as
 * unresolved (and hold), never as "this account has no shop".
 */
async function findActiveSlugForAccount(client, { webAccount, app }) {
  if (!webAccount || !app) return null;
  const res = await client.get(BASE, {
    params: {
      filters: JSON.stringify([["web_account", "=", webAccount], ["app", "=", app], ["status", "=", "active"]]),
      fields: JSON.stringify(["name", "slug", "web_account", "app", "status"]),
      limit_page_length: 5,
    },
  });
  // Re-verify in JS: a mock (or a misconfigured server-side filter) may return
  // other accounts' rows, and leaking another buyer's address would be far worse
  // than finding nothing.
  const row = (res.data?.data || []).find(
    (r) => r && r.web_account === webAccount && r.app === app && r.status === "active"
  );
  return row ? row.slug || row.name || null : null;
}

module.exports = {
  TENANT_SLUG_DOCTYPE,
  SLUG_RESERVATION_TTL_MS,
  SLUG_PAYMENT_GRACE_MS,
  SLUG_STORE_TIMEOUT_MS,
  setSlugStoreTimeoutMsForTests,
  isSlugAvailable,
  isSlugAvailableTo,
  reserveSlug,
  touchSlug,
  linkSlugInvoice,
  activateSlugForInvoice,
  findActiveSlugForAccount,
};
