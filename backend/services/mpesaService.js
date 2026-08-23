// services/mpesaService.js
//
// M-Pesa (Safaricom Daraja) reconciliation helpers.
//
// This is the primary money-in rail for a Kenyan business, and the pieces here
// exist because the rail had three ways to take a customer's money and lose it:
//
//  1. Portal Invoice carried ONE mpesa_checkout_request_id, overwritten on every
//     STK push. A customer who let the first prompt sit, tapped pay again, then
//     entered their PIN on the FIRST prompt produced a callback whose id no
//     invoice matched. Money gone, nothing recorded. Hence the id HISTORY and
//     the two-step lookup below.
//
//  2. Nothing ever asked Daraja what became of a push. Safaricom does not
//     guarantee callback delivery and the callback endpoint is public, so a
//     dropped callback meant a paid invoice that stayed Unpaid forever. Hence
//     queryStkStatus, which lets a sweep or an operator resolve a push directly.
//
//  3. Outbound Daraja calls had no timeout, so a stalled response pinned the
//     request indefinitely — while the customer's phone had already been
//     prompted. Hence DARAJA_TIMEOUT_MS.

const axios = require("axios");

/** Bounded timeout for every outbound Daraja call. */
const DARAJA_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MPESA_HTTP_TIMEOUT_MS || 20000)
);

/**
 * How many checkout ids to retain per invoice. A customer re-tapping "pay"
 * must not be able to grow this field without bound, but every id that could
 * still produce a callback has to remain findable. Safaricom expires an STK
 * prompt in about a minute, so a handful is generous.
 */
const CHECKOUT_ID_HISTORY_MAX = 10;

function splitHistory(history) {
  return String(history || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Append a CheckoutRequestID to an invoice's history, de-duplicated and capped.
 * Returns the new comma-separated history string.
 */
function appendCheckoutRequestId(history, id) {
  const wanted = String(id || "").trim();
  if (!wanted) return String(history || "");
  const ids = splitHistory(history).filter((x) => x !== wanted);
  ids.push(wanted);
  return ids.slice(-CHECKOUT_ID_HISTORY_MAX).join(",");
}

/**
 * Whole-token membership test. Deliberately not a substring check: Frappe's
 * `like` filter would match ws_CO_1 inside ws_CO_11 and resolve a callback to
 * the wrong invoice, which is a worse failure than not finding one at all.
 */
function checkoutIdHistoryHas(history, id) {
  const wanted = String(id || "").trim();
  if (!wanted) return false;
  return splitHistory(history).includes(wanted);
}

const INVOICE_FIELDS = [
  "name",
  "web_account",
  "status",
  "amount",
  "mpesa_checkout_request_id",
  "mpesa_checkout_request_ids",
];

/**
 * Resolve a callback's CheckoutRequestID to its Portal Invoice.
 *
 * Two steps, in this order:
 *   1. exact match on the CURRENT id — the common case, one query;
 *   2. `like` scan of the id history — catches a payment made against a push
 *      that a later push superseded.
 *
 * The `like` result is re-verified with checkoutIdHistoryHas so a substring
 * collision can never bind a payment to the wrong invoice.
 *
 * Returns the invoice, or null. Never throws on "not found".
 */
async function findInvoiceByCheckoutRequestId(client, checkoutRequestID) {
  const id = String(checkoutRequestID || "").trim();
  if (!id) return null;

  const exact = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([["mpesa_checkout_request_id", "=", id]]),
      fields: JSON.stringify(INVOICE_FIELDS),
      limit_page_length: 1,
    },
  });
  const hit = exact.data?.data?.[0];
  if (hit?.name) return hit;

  // Fall back to the history of superseded pushes.
  const scan = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([["mpesa_checkout_request_ids", "like", `%${id}%`]]),
      fields: JSON.stringify(INVOICE_FIELDS),
      limit_page_length: 5,
    },
  });
  const candidates = scan.data?.data || [];
  const confirmed = candidates.find((c) =>
    checkoutIdHistoryHas(c.mpesa_checkout_request_ids, id)
  );
  return confirmed || null;
}

function darajaBaseUrl() {
  const env = String(process.env.MPESA_ENV || "sandbox").toLowerCase();
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

/**
 * Ask Daraja what happened to a push, for callbacks that never arrived.
 *
 * Returns { resultCode, resultDesc, raw } — resultCode 0 means the customer
 * paid. A push still awaiting the customer's PIN answers with a pending code
 * rather than an error, so callers must treat "not 0" as "not yet paid",
 * never as "failed".
 *
 * `getAccessToken` is injected so this stays testable and so the token cache
 * in billingRoutes remains the single place tokens are fetched.
 */
async function queryStkStatus({ checkoutRequestID, getAccessToken }) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    throw new Error("M-Pesa is not configured (MPESA_SHORTCODE / MPESA_PASSKEY).");
  }
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const token = await getAccessToken();

  const res = await axios.post(
    `${darajaBaseUrl()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: String(checkoutRequestID || "").trim(),
    },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: DARAJA_TIMEOUT_MS,
    }
  );

  const data = res.data || {};
  return {
    resultCode: Number(data.ResultCode ?? data.ResponseCode ?? 1),
    resultDesc: data.ResultDesc || data.ResponseDescription || "",
    raw: data,
  };
}

module.exports = {
  DARAJA_TIMEOUT_MS,
  CHECKOUT_ID_HISTORY_MAX,
  appendCheckoutRequestId,
  checkoutIdHistoryHas,
  findInvoiceByCheckoutRequestId,
  queryStkStatus,
  darajaBaseUrl,
};
