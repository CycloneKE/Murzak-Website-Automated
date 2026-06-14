
// services/paypalService.js
const paypal = require("@paypal/paypal-server-sdk");
const { paypalConfig } = require("../config/paypal");

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
  logging: {
    logLevel: LogLevel.Info,
    logRequest: { logBody: true },
    logResponse: { logHeaders: true },
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
  const value = convertKesToPaypalAmount(invoice.amount);

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
  });

  if (!orderID) {
    const err = new Error("Missing orderID.");
    err.statusCode = 400;
    throw err;
  }

  const collect = {
    id: orderID,
    prefer: "return=representation",
  };

  const { body, ...httpResponse } = await ordersController.captureOrder(collect);
  const jsonResponse = JSON.parse(body);

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
  const expectedValue = convertKesToPaypalAmount(invoice.amount); // string, 2dp
  const captured = capture?.amount || purchaseUnit?.amount;
  const capturedValue = Number(captured?.value);
  const capturedCurrency = captured?.currency_code;

  if (
    !Number.isFinite(capturedValue) ||
    Math.abs(capturedValue - Number(expectedValue)) > 0.01 ||
    (capturedCurrency && capturedCurrency !== "USD")
  ) {
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

async function getPayPalOrder(orderID) {
  const collect = { id: orderID };
  const { body, ...httpResponse } = await ordersController.getOrder(collect);
  return {
    jsonResponse: JSON.parse(body),
    httpStatusCode: httpResponse.statusCode,
  };
}

module.exports = {
  loadOwnedInvoiceForPayPal,
  createPayPalOrderForInvoice,
  capturePayPalOrderForInvoice,
  getPayPalOrder,
};
