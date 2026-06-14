
// routes/paypalRoutes.js
const express = require("express");
const {
  createPayPalOrderForInvoice,
  capturePayPalOrderForInvoice,
  getPayPalOrder,
} = require("../services/paypalService.js");

function createPaypalRouter({
  requireAuth,
  frappeClient,
  activateServicesForInvoice, // optional helper hook, shown below
}) {
  const router = express.Router();
  router.get("/config", requireAuth, async (req, res) => {
    try {
      const clientId =
        process.env.PAYPAL_ENV === "live"
          ? process.env.PAYPAL_LIVE_CLIENT_ID
          : process.env.PAYPAL_SANDBOX_CLIENT_ID;

      res.json({
        clientId,
        currency: "USD",
        intent: "capture",
      });
    } catch (error) {
      console.error("PAYPAL CONFIG ERROR:", error.message);
      res.status(500).json({ error: "Failed to load PayPal config." });
    }
  });

  router.post("/create-order", requireAuth, async (req, res) => {
    try {
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      const { invoiceDocName } = req.body;

      const client = frappeClient();

      const { jsonResponse, httpStatusCode, invoice } =
        await createPayPalOrderForInvoice({
          frappeClient: client,
          invoiceDocName,
          webAccountName,
        });

      return res.status(httpStatusCode).json({
        ok: true,
        orderID: jsonResponse.id,
        paypal: jsonResponse,
        invoice: {
          docName: invoice.name,
          invoiceNo: invoice.invoice_no || invoice.name,
          amount: Number(invoice.amount || 0),
          status: invoice.status,
        },
      });
    } catch (err) {
      console.error("PAYPAL CREATE ORDER ERROR:", err.response?.data || err.message);
      return res.status(err.statusCode || 500).json({
        error: err.message || "Failed to create PayPal order.",
      });
    }
  });

  router.post("/capture-order", requireAuth, async (req, res) => {
    try {
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      const { invoiceDocName, orderID } = req.body;

      const client = frappeClient();

      const { jsonResponse, httpStatusCode, invoice, paypalMeta } =
        await capturePayPalOrderForInvoice({
          frappeClient: client,
          invoiceDocName,
          webAccountName,
          orderID,
        });

      let activationResult = null;

      if (typeof activateServicesForInvoice === "function") {
        activationResult = await activateServicesForInvoice({
          req,
          invoiceDocName: invoice.name,
        });
      }

      return res.status(httpStatusCode).json({
        ok: true,
        message: "PayPal payment captured successfully.",
        paypal: jsonResponse,
        paypalMeta,
        invoice: {
          docName: invoice.name,
          invoiceNo: invoice.invoice_no || invoice.name,
          amount: Number(invoice.amount || 0),
          status: "Paid",
        },
        user: activationResult?.user || null,
      });
    } catch (err) {
      console.error("PAYPAL CAPTURE ORDER ERROR:", err.response?.data || err.message);
      return res.status(err.statusCode || 500).json({
        error: err.message || "Failed to capture PayPal order.",
        paypal: err.paypal || null,
      });
    }
  });

  router.get("/order/:orderID", requireAuth, async (req, res) => {
    try {
      const { orderID } = req.params;
      const { jsonResponse, httpStatusCode } = await getPayPalOrder(orderID);
      return res.status(httpStatusCode).json(jsonResponse);
    } catch (err) {
      console.error("PAYPAL GET ORDER ERROR:", err.response?.data || err.message);
      return res.status(500).json({ error: "Failed to fetch PayPal order." });
    }
  });

  return router;
}

module.exports = createPaypalRouter;
