/**
 * Hostinger Mail — API wrapper for email hosting provisioning.
 *
 * IMPORTANT: Hostinger ships TWO different mail APIs and only one of them is
 * useful here.
 *
 *   api.mail.hostinger.com          message-level only (read/send mail,
 *                                   folders, webhooks). Has NO mailbox
 *                                   creation, and REJECTS the main API token
 *                                   (401) — its tokens are per-order and
 *                                   minted by hand in hPanel.
 *   developers.hostinger.com
 *     /api/mail/v1/*                the provisioning API. Works with the same
 *                                   HOSTINGER_API_TOKEN we already use for
 *                                   domain availability and DNS.
 *
 * This module wraps the second. Note it is absent from Hostinger's published
 * endpoint listing — the paths below were confirmed by probing the live API
 * (GET /api/mail/v1/orders -> 200) and against the api-php-sdk docs, not
 * inferred from the public docs page.
 *
 * Base URL note: HOSTINGER_API_BASE is used inconsistently across this
 * codebase — server.js defaults to developers.hostinger.com/api while
 * aiService/scaling default to api.hostinger.com, which is NOT the API host
 * (it returns 530). We resolve to the developers host explicitly and tolerate
 * either form of the env var.
 */

const axios = require("axios");

const DEFAULT_HOST = "https://developers.hostinger.com";

/**
 * Normalize HOSTINGER_API_BASE into a bare host with no trailing /api, so
 * callers can always append the documented "/api/..." paths exactly as the
 * SDK spells them.
 */
function resolveHost() {
  const raw = String(process.env.HOSTINGER_API_BASE || "").trim();
  if (!raw) return DEFAULT_HOST;
  const noSlash = raw.replace(/\/+$/, "");
  // api.hostinger.com is not the API host; don't let a stale env var send
  // provisioning calls somewhere that 530s.
  if (/^https?:\/\/api\.hostinger\.com$/i.test(noSlash)) return DEFAULT_HOST;
  return noSlash.replace(/\/api$/i, "");
}

function token() {
  return process.env.HOSTINGER_API_TOKEN || "";
}

function isConfigured() {
  return !!token();
}

function configError() {
  return isConfigured() ? null : "Email hosting lane not configured (missing: HOSTINGER_API_TOKEN)";
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

/** Hostinger wraps list responses as {data:[...],meta:{...}}; single ones vary. */
function unwrap(resp) {
  const body = resp?.data;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return body?.data ?? body ?? null;
}

/**
 * Mail orders we hold. Optionally filtered by domain (exact match, per the
 * SDK's listOrdersV1 `domain` query param).
 *
 * An empty list is the normal state before anyone has bought email hosting —
 * it is NOT an error.
 */
async function listOrders({ domain, status } = {}) {
  const params = {};
  if (domain) params.domain = String(domain).toLowerCase();
  if (status) params.status = status;
  const resp = await http().get("/api/mail/v1/orders", { params });
  const rows = unwrap(resp);
  return Array.isArray(rows) ? rows : [];
}

/** The plan behind an order (mailbox allowance, storage). */
async function getOrderPlan(orderId) {
  const resp = await http().get(`/api/mail/v1/orders/${encodeURIComponent(orderId)}/plan`);
  return unwrap(resp);
}

/** Find the mail order serving a domain, or null. */
async function findOrderForDomain(domain) {
  const wanted = String(domain || "").trim().toLowerCase();
  if (!wanted) return null;
  const orders = await listOrders({ domain: wanted });
  // Trust the server-side filter but re-check: a filter that silently ignores
  // an unknown param would otherwise hand us somebody else's order.
  return (
    orders.find((o) => String(o?.domain || "").toLowerCase() === wanted) || null
  );
}

async function listMailboxes(orderId) {
  const resp = await http().get(`/api/mail/v1/orders/${encodeURIComponent(orderId)}/mailboxes`);
  const rows = unwrap(resp);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Create a mailbox on an order. The full address is composed by Hostinger from
 * `localPart` and the order's own domain — we cannot choose the domain here,
 * which is why the order must already be bound to the customer's domain.
 */
async function createMailbox(orderId, { localPart, password }) {
  const local = String(localPart || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(local)) {
    const err = new Error(`Invalid mailbox local part "${localPart}"`);
    err.permanent = true;
    throw err;
  }
  const resp = await http().post(`/api/mail/v1/orders/${encodeURIComponent(orderId)}/mailboxes`, {
    local_part: local,
    ...(password ? { password } : {}),
  });
  return unwrap(resp);
}

async function changeMailboxPassword(mailboxId, password) {
  const resp = await http().patch(
    `/api/mail/v1/mailboxes/${encodeURIComponent(mailboxId)}/password`,
    { password }
  );
  return unwrap(resp);
}

async function deleteMailbox(mailboxId) {
  const resp = await http().delete(`/api/mail/v1/mailboxes/${encodeURIComponent(mailboxId)}`);
  return unwrap(resp);
}

/**
 * Email plans available to buy, from the billing catalog (category EMAIL).
 * Surfaced so an escalation can name the exact item id and price a human
 * should purchase, rather than "go buy email hosting somewhere".
 *
 * Prices are Hostinger's own wholesale, in minor units (USD cents). We resell
 * at our KES retail from the service catalog — never pass these through.
 */
async function listEmailPlans() {
  const resp = await http().get("/api/billing/v1/catalog");
  const items = unwrap(resp);
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => String(i?.category || "").toUpperCase() === "EMAIL")
    .map((i) => ({
      id: i.id,
      name: i.name,
      prices: Array.isArray(i.prices)
        ? i.prices.map((p) => ({
            id: p.id,
            period: p.period,
            periodUnit: p.period_unit,
            currency: p.currency,
            amountMinor: p.price,
          }))
        : [],
    }));
}

module.exports = {
  resolveHost,
  isConfigured,
  configError,
  listOrders,
  getOrderPlan,
  findOrderForDomain,
  listMailboxes,
  createMailbox,
  changeMailboxPassword,
  deleteMailbox,
  listEmailPlans,
};
