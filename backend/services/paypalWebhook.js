// services/paypalWebhook.js
//
// Out-of-band PayPal webhook handling: the authoritative, browser-independent
// source of truth for payment finality, refunds and reversals. The capture-order
// route only fires if the buyer's browser completes the round-trip; this webhook
// reconciles payments even if the tab is closed, and reverses activation if a
// capture is later refunded or charged back.
//
// Signature is verified server-side via PayPal's verify-webhook-signature API
// (no local crypto). FAILS CLOSED: an unverified or unconfigured webhook is
// rejected in production.

const axios = require("axios");
const { paypalConfig } = require("../config/paypal");

async function getAccessToken() {
  const auth = Buffer.from(
    `${paypalConfig.clientId}:${paypalConfig.clientSecret}`
  ).toString("base64");

  const res = await axios.post(
    `${paypalConfig.baseUrl}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    }
  );
  return res.data?.access_token;
}

// Returns { verified: boolean, reason?: string }.
async function verifyWebhookSignature({ headers, event }) {
  if (!paypalConfig.webhookId) {
    return { verified: false, reason: "no_webhook_id" };
  }

  const required = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ];
  for (const h of required) {
    if (!headers[h]) return { verified: false, reason: `missing_header:${h}` };
  }

  const token = await getAccessToken();
  if (!token) return { verified: false, reason: "no_access_token" };

  const body = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: paypalConfig.webhookId,
    webhook_event: event,
  };

  const res = await axios.post(
    `${paypalConfig.baseUrl}/v1/notifications/verify-webhook-signature`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return { verified: res.data?.verification_status === "SUCCESS" };
}

// Pull our Portal Invoice docname out of a capture/refund resource. We set
// customId === invoice.name at order creation (paypalService), and PayPal
// propagates it to the capture and to refund.custom_id.
function extractInvoiceName(resource) {
  if (!resource) return null;
  return (
    resource.custom_id ||
    resource.invoice_id ||
    resource?.supplementary_data?.related_ids?.invoice_id ||
    null
  );
}

module.exports = { verifyWebhookSignature, extractInvoiceName };
