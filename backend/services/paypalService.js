
// services/paypalService.js
const paypal = require("@paypal/paypal-server-sdk");
const { paypalConfig } = require("../config/paypal");
const { effectiveChargeKes } = require("../utils/billingAmount");

const {
  Client,
  Environment,
  LogLevel,
  OrdersController,
} = paypal;

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: paypalConfig.clientId,
    oAuthClientSecret: paypalConfig.clientSecret,
  },
  timeout: 0,
  environment: paypalConfig.isLive ? Environment.Production : Environment.Sandbox,
  // Full request/response bodies contain payer PII — only log them outside prod.
  logging: {
    logLevel: process.env.NODE_ENV === "production" ? LogLevel.Warn : LogLevel.Info,
    logRequest: { logBody: process.env.NODE_ENV !== "production" },
    logResponse: { logHeaders: process.env.NODE_ENV !== "production" },
  },
});

const ordersController = new OrdersController(client);


function normalizeInvoiceStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isInvoicePaidLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "paid";
}

function isInvoiceDeletedLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "deleted" || s === "cancelled" || s === "canceled";
}

function isInvoiceUnpaidLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "unpaid" || s === "awaiting payment" || s === "pending" || s === "draft";
}

function getInvoiceCurrency(invoice) {
  return "USD";
}

function convertKesToPaypalAmount(amountKes) {
  const rate = Number(process.env.KES_TO_USD_RATE || 0);
  const kes = Number(amountKes || 0);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid KES_TO_USD_RATE configuration.");
  }

  if (!Number.isFinite(kes) || kes <= 0) {
    throw new Error("Invalid invoice amount.");
  }

  return (kes * rate).toFixed(2);
}

function formatAmount(amount) {
  const num = Number(amount || 0);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("Invalid invoice amount.");
  }
  return num.toFixed(2);
}

async function loadOwnedInvoiceForPayPal({
  frappeClient,
  invoiceDocName,
  webAccountName,
  // When true, an already-Paid (owned) invoice is returned instead of throwing.
  // Used by capture, where a webhook may have reconciled the payment first.
  allowPaid = false,
}) {
  if (!invoiceDocName) {
    const err = new Error("Missing invoiceDocName.");
    err.statusCode = 400;
    throw err;
  }

  if (!webAccountName) {
    const err = new Error("No session account.");
    err.statusCode = 401;
    throw err;
  }

  const invRes = await frappeClient.get(
    `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`
  );

  const invoice = invRes.data?.data;
  if (!invoice) {
    const err = new Error("Invoice not found.");
    err.statusCode = 404;
    throw err;
  }

  if (invoice.web_account !== webAccountName) {
    const err = new Error("Invoice not yours.");
    err.statusCode = 403;
    throw err;
  }

  if (isInvoiceDeletedLike(invoice.status)) {
    const err = new Error("Invoice is deleted or cancelled.");
    err.statusCode = 400;
    throw err;
  }

  if (isInvoicePaidLike(invoice.status)) {
    if (allowPaid) return invoice;
    const err = new Error("Invoice is already paid.");
    err.statusCode = 400;
    throw err;
  }

  if (!isInvoiceUnpaidLike(invoice.status)) {
    const err = new Error(`Invoice status ${invoice.status} cannot be paid now.`);
    err.statusCode = 400;
    throw err;
  }

  return invoice;
}

// Shared, security-critical check: does a captured PayPal amount match what we
// billed for this invoice? Used by BOTH the browser capture flow and the
// out-of-band webhook so the two rails can never drift. Fails closed.
function capturedAmountMatches({ invoiceAmountKes, capturedValue, capturedCurrency, expectedUsd }) {
  // `expectedUsd` is the value snapshotted onto the invoice when the PayPal
  // order was created — i.e. the amount the buyer actually saw and approved.
  // Prefer it over recomputing: the live computation depends on both the
  // current invoice amount and the current KES_TO_USD_RATE, either of which
  // can change between approval and capture, and a mismatch here happens
  // AFTER the money has already moved.
  const expected = Number.isFinite(Number(expectedUsd)) && Number(expectedUsd) > 0
    ? Number(expectedUsd)
    : Number(convertKesToPaypalAmount(effectiveChargeKes(invoiceAmountKes)));
  const value = Number(capturedValue);
  if (!Number.isFinite(value)) return false;
  if (Math.abs(value - expected) > 0.01) return false;
  if (capturedCurrency && capturedCurrency !== "USD") return false;
  return true;
}

/**
 * Post-capture verification, as a pure function.
 *
 * Extracted so the failure paths are testable without moving real money: the
 * checks below run AFTER ordersController.captureOrder has already debited the
 * buyer, so getting them wrong is not recoverable by retrying.
 *
 * Returns {ok:true} or {ok:false, code, reason} — never throws. The caller
 * decides what to do with a failure, and must record it before surfacing it.
 */
function verifyCapture({ invoice, jsonResponse }) {
  const purchaseUnit = jsonResponse?.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const captureStatus = capture?.status || jsonResponse?.status;

  if (captureStatus !== "COMPLETED") {
    return {
      ok: false,
      code: "NOT_COMPLETED",
      reason: `PayPal capture not completed. Status: ${captureStatus || "UNKNOWN"}`,
    };
  }

  // PayPal echoes back the referenceId/customId set at order creation. FAIL
  // CLOSED on a missing reference — otherwise a captured order with the right
  // amount could be applied to somebody else's invoice.
  const orderRef = purchaseUnit?.reference_id || purchaseUnit?.custom_id || capture?.custom_id;
  if (!orderRef || orderRef !== invoice.name) {
    return {
      ok: false,
      code: "REFERENCE_MISMATCH",
      reason: `PayPal order reference ${orderRef || "(missing)"} does not match invoice ${invoice.name}.`,
    };
  }

  const captured = capture?.amount || purchaseUnit?.amount;
  if (!capturedAmountMatches({
    invoiceAmountKes: invoice.amount,
    capturedValue: Number(captured?.value),
    capturedCurrency: captured?.currency_code,
    expectedUsd: invoice.paypal_expected_usd,
  })) {
    const expectedValue = Number(invoice.paypal_expected_usd) > 0
      ? invoice.paypal_expected_usd
      : convertKesToPaypalAmount(effectiveChargeKes(invoice.amount));
    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      reason: `PayPal amount mismatch. Expected ${expectedValue} USD, captured ${captured?.value} ${captured?.currency_code || "?"}.`,
    };
  }

  return { ok: true };
}

/**
 * Record a capture that could not be applied to its invoice.
 *
 * The money has already left the buyer's account by the time any of this runs.
 * Previously the caller simply threw: the invoice stayed Unpaid, no capture id
 * was stored anywhere, and the webhook independently failed the same check and
 * told PayPal to stop retrying — so nothing in the system knew the customer had
 * paid. This writes the identifiers needed to find and refund (or apply) the
 * payment by hand, and logs loudly enough to be picked up by alerting.
 *
 * Best-effort and never throws: paypal_capture_id / paypal_order_id /
 * payment_exception are optional Portal Invoice custom fields
 * (backend/data/custom-fields-portal-invoice.json). If they are not installed
 * the write 417s — losing the audit trail must not also destroy the caller's
 * own error path, which is what surfaces the failure to the buyer.
 */
async function recordPaymentException({ frappeClient, invoice, jsonResponse, reason, code }) {
  const purchaseUnit = jsonResponse?.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const paypalOrderId = jsonResponse?.id || null;
  const paypalCaptureId = capture?.id || null;

  // Loud and structured — this line is the alerting hook until real error
  // tracking is wired up. A captured-but-unapplied payment is money owed.
  console.error(
    "PAYPAL PAYMENT EXCEPTION — money captured but NOT applied:",
    JSON.stringify({
      invoice: invoice?.name,
      code,
      reason,
      paypalOrderId,
      paypalCaptureId,
      capturedValue: capture?.amount?.value ?? purchaseUnit?.amount?.value ?? null,
      capturedCurrency: capture?.amount?.currency_code ?? purchaseUnit?.amount?.currency_code ?? null,
    })
  );

  try {
    await frappeClient.put(
      `/api/resource/Portal Invoice/${encodeURIComponent(invoice.name)}`,
      {
        payment_gateway: "PayPal",
        paypal_order_id: paypalOrderId,
        paypal_capture_id: paypalCaptureId,
        payment_exception: `${code}: ${reason}`,
      }
    );
  } catch (e) {
    console.error(
      `PAYPAL PAYMENT EXCEPTION — could not persist the exception on ${invoice?.name} ` +
      `(are the Portal Invoice custom fields installed?): ${e.message}`
    );
  }
}

async function createPayPalOrderForInvoice({
  frappeClient,
  invoiceDocName,
  webAccountName,
}) {
  const invoice = await loadOwnedInvoiceForPayPal({
    frappeClient,
    invoiceDocName,
    webAccountName,
  });

  const currencyCode = "USD";
  // Free / zero-amount invoices collect the small verification charge instead.
  const value = convertKesToPaypalAmount(effectiveChargeKes(invoice.amount));

  const collect = {
    body: {
      intent: "CAPTURE",
      purchaseUnits: [
        {
          referenceId: invoice.name,
          description: `Portal Invoice ${invoice.invoice_no || invoice.name}`,
          customId: invoice.name,
          amount: {
            currencyCode,
            value,
          },
        },
      ],
      applicationContext: {
        shippingPreference: "NO_SHIPPING",
        userAction: "PAY_NOW",
      },
    },
    prefer: "return=representation",
  };

  const { body, ...httpResponse } = await ordersController.createOrder(collect);
  const jsonResponse = JSON.parse(body);

  // Snapshot what the buyer is being asked to approve, so the capture can be
  // verified against THIS number rather than recomputed later from the live
  // invoice amount and the live KES_TO_USD_RATE. Without it, an FX update or
  // an invoice edited mid-checkout makes every in-flight capture fail its
  // amount check — after the money has already moved.
  //
  // Best-effort: these are optional Portal Invoice custom fields
  // (backend/data/custom-fields-portal-invoice.json). If they're absent the
  // write 417s and verifyCapture falls back to the live computation, i.e.
  // exactly the old behaviour — never worse.
  try {
    await frappeClient.put(
      `/api/resource/Portal Invoice/${encodeURIComponent(invoice.name)}`,
      {
        payment_gateway: "PayPal",
        paypal_order_id: jsonResponse.id,
        paypal_expected_usd: value,
      }
    );
  } catch (e) {
    console.warn(
      `PAYPAL: could not snapshot expected amount on ${invoice.name} ` +
      `(are the Portal Invoice custom fields installed?): ${e.message}`
    );
  }

  return {
    invoice,
    jsonResponse,
    httpStatusCode: httpResponse.statusCode,
  };
}

async function capturePayPalOrderForInvoice({
  frappeClient,
  invoiceDocName,
  webAccountName,
  orderID,
}) {
  const invoice = await loadOwnedInvoiceForPayPal({
    frappeClient,
    invoiceDocName,
    webAccountName,
    allowPaid: true,
  });

  // The webhook (or a prior capture) may have already marked this Paid. The
  // payment succeeded — return success rather than erroring the buyer; the
  // caller's activation step is idempotent.
  if (isInvoicePaidLike(invoice.status)) {
    return {
      invoice,
      jsonResponse: { status: "COMPLETED", alreadyReconciled: true },
      httpStatusCode: 200,
      paypalMeta: { captureStatus: "COMPLETED", alreadyReconciled: true },
    };
  }

  if (!orderID) {
    const err = new Error("Missing orderID.");
    err.statusCode = 400;
    throw err;
  }

  let jsonResponse;
  let httpResponse = { statusCode: 200 };

  if (orderID === "MOCK_PAYPAL_SUCCESS" && process.env.NODE_ENV !== "production") {
    console.warn("⚠️ PAYPAL MOCK: Bypassing capture for test orderID");
    jsonResponse = {
      status: "COMPLETED",
      id: "MOCK_PAYPAL_SUCCESS",
      purchase_units: [{
        reference_id: invoice.name,
        amount: {
          value: convertKesToPaypalAmount(effectiveChargeKes(invoice.amount)),
          currency_code: getInvoiceCurrency(invoice),
        },
        payments: {
          captures: [{
            id: "MOCK_CAPTURE",
            status: "COMPLETED",
            custom_id: invoice.name,
          }]
        }
      }]
    };
  } else {
    const collect = {
      id: orderID,
      prefer: "return=representation",
    };

    const captureRes = await ordersController.captureOrder(collect);
    httpResponse = captureRes;
    delete httpResponse.body;
    jsonResponse = JSON.parse(captureRes.body);
  }

  const purchaseUnit = jsonResponse?.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];

  const captureStatus = capture?.status || jsonResponse?.status;
  const payerEmail = jsonResponse?.payer?.email_address || null;
  const paypalOrderId = jsonResponse?.id || orderID;
  const paypalCaptureId = capture?.id || null;

  // --- Verify the capture (status, ownership, amount) ---
  // Everything below runs AFTER ordersController.captureOrder has already
  // debited the buyer, so a rejection here is not a "declined payment" — it is
  // money that has moved and cannot be applied. Record it before throwing:
  // previously each of these paths threw bare, leaving the invoice Unpaid with
  // no capture id stored anywhere, while the webhook failed the identical check
  // and answered {ignored:true} so PayPal stopped retrying. Nothing in the
  // system then knew the customer had paid.
  const verdict = verifyCapture({ invoice, jsonResponse });
  if (!verdict.ok) {
    // NOT_COMPLETED is the one case where no money moved — nothing to record.
    if (verdict.code !== "NOT_COMPLETED") {
      await recordPaymentException({
        frappeClient,
        invoice,
        jsonResponse,
        reason: verdict.reason,
        code: verdict.code,
      });
    }
    const err = new Error(verdict.reason);
    err.statusCode = 400;
    err.code = verdict.code;
    err.paypal = jsonResponse;
    throw err;
  }

  await frappeClient.put(
    `/api/resource/Portal Invoice/${encodeURIComponent(invoice.name)}`,
    {
      status: "Paid",
    }
  );

  // Best-effort: persist the capture/order IDs for audit, reconciliation and
  // webhook idempotency. Done as a SEPARATE write wrapped in try/catch so that,
  // if these custom fields aren't yet on the Portal Invoice doctype, the failure
  // can never roll back the already-recorded "Paid" status above.
  try {
    await frappeClient.put(
      `/api/resource/Portal Invoice/${encodeURIComponent(invoice.name)}`,
      {
        paypal_order_id: paypalOrderId,
        paypal_capture_id: paypalCaptureId,
        payment_gateway: "PayPal",
      }
    );
  } catch (e) {
    console.warn(
      "PAYPAL CAPTURE: could not persist capture metadata (add paypal_order_id/paypal_capture_id/payment_gateway custom fields to Portal Invoice for full audit):",
      e.response?.data || e.message
    );
  }

  return {
    invoice,
    jsonResponse,
    httpStatusCode: httpResponse.statusCode,
    paypalMeta: {
      paypalOrderId,
      paypalCaptureId,
      payerEmail,
      captureStatus,
    },
  };
}

module.exports = {
  loadOwnedInvoiceForPayPal,
  createPayPalOrderForInvoice,
  verifyCapture,
  recordPaymentException,
  capturePayPalOrderForInvoice,
  convertKesToPaypalAmount,
  capturedAmountMatches,
};
