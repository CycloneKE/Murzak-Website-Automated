
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
function capturedAmountMatches({ invoiceAmountKes, capturedValue, capturedCurrency }) {
  const expected = Number(convertKesToPaypalAmount(effectiveChargeKes(invoiceAmountKes)));
  const value = Number(capturedValue);
  if (!Number.isFinite(value)) return false;
  if (Math.abs(value - expected) > 0.01) return false;
  if (capturedCurrency && capturedCurrency !== "USD") return false;
  return true;
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

  // Optional: if you add custom fields to Portal Invoice later, save pending PayPal order ID here.
  // Example custom fields:
  // custom_paypal_order_id, custom_paypal_status, custom_payment_gateway
  //
  // await frappeClient.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoice.name)}`, {
  //   custom_paypal_order_id: jsonResponse.id,
  //   custom_paypal_status: jsonResponse.status,
  //   custom_payment_gateway: "PayPal",
  // });

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

  if (captureStatus !== "COMPLETED") {
    const err = new Error(
      `PayPal capture not completed. Status: ${captureStatus || "UNKNOWN"}`
    );
    err.statusCode = 400;
    err.paypal = jsonResponse;
    throw err;
  }

  // --- Verify the captured order actually belongs to THIS invoice ---
  // PayPal echoes back the referenceId/customId we set at order creation
  // (paypalService createPayPalOrderForInvoice sets both to invoice.name).
  // FAIL CLOSED: a missing reference must be rejected, not trusted — otherwise a
  // captured order with the right amount could be applied to a different invoice.
  const orderRef = purchaseUnit?.reference_id || purchaseUnit?.custom_id || capture?.custom_id;
  if (!orderRef || orderRef !== invoice.name) {
    const err = new Error("PayPal order does not match this invoice.");
    err.statusCode = 400;
    err.paypal = jsonResponse;
    throw err;
  }

  // --- Verify the captured amount and currency match what we billed ---
  // Shared with the webhook via capturedAmountMatches so the two rails agree.
  const captured = capture?.amount || purchaseUnit?.amount;
  const capturedValue = Number(captured?.value);
  const capturedCurrency = captured?.currency_code;

  if (!capturedAmountMatches({
    invoiceAmountKes: invoice.amount,
    capturedValue,
    capturedCurrency,
  })) {
    const expectedValue = convertKesToPaypalAmount(effectiveChargeKes(invoice.amount));
    const err = new Error(
      `PayPal amount mismatch. Expected ${expectedValue} USD, captured ${captured?.value} ${capturedCurrency || "?"}.`
    );
    err.statusCode = 400;
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
  capturePayPalOrderForInvoice,
  convertKesToPaypalAmount,
  capturedAmountMatches,
};
