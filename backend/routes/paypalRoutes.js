
// routes/paypalRoutes.js
const express = require("express");
const {
  createPayPalOrderForInvoice,
  capturePayPalOrderForInvoice,
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

      if (orderID === 'MOCK_PAYPAL_SUCCESS' && process.env.NODE_ENV !== 'production') {
        if (req.session && req.session.user) {
          const newServices = [...(req.session.user.selectedServices || [])];
          newServices.push({
            serviceId: `srv-${Date.now()}`,
            name: "POS Base Package",
            status: "Setting up",
            tier: "Starter",
            billingCycle: "Monthly"
          });
          req.session.user.selectedServices = newServices;
          await new Promise((resolve) => req.session.save(resolve));
        }
        return res.status(200).json({
          ok: true,
          message: "MOCK PayPal payment captured successfully.",
          paypal: { status: "COMPLETED" },
          paypalMeta: {},
          invoice: {
            docName: invoiceDocName,
            invoiceNo: invoiceDocName,
            amount: 99,
            status: "Paid",
          },
          user: req.session?.user || null,
        });
      }

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
        // Trusted rail: the capture above verified amount, currency and that the
        // order belongs to this invoice, and marked it Paid.
        try {
          activationResult = await activateServicesForInvoice({
            req,
            invoiceDocName: invoice.name,
            paymentVerified: true,
          });
        } catch (activationErr) {
          // CRITICAL: the money is already captured and the invoice is Paid. A
          // failure to activate services here must NOT surface as a payment
          // failure — that would tell the customer their successful payment
          // failed. Log it; the PayPal webhook and the activate-services resync
          // will reconcile activation out-of-band.
          console.error(
            "PAYPAL CAPTURE: payment captured & invoice Paid, but service activation failed (will reconcile):",
            activationErr.response?.data || activationErr.message
          );
        }
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

  // NOTE: a raw GET /order/:orderID proxy was removed — it exposed any order's
  // payer email/amount to any authenticated user (IDOR) and was unused by the
  // client. Order status is surfaced only through the owned capture flow above.

  return router;
}

module.exports = createPaypalRouter;
