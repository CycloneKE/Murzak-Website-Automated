
const express = require('express');

module.exports = function(ctx) {
  const { 
    CHILD_DOMAIN_CHOICE_FIELD,
    CHILD_SERVICE_ID_FIELD,
    CHILD_SERVICE_NAME_FIELD,
    CHILD_STATUS_FIELD,
    CHILD_TIER_FIELD,
    PORTAL_INVOICE_SERVICES_FIELD,
    SERVICE_STATUS_AWAITING,
    WEB_ACCOUNT_SERVICES_FIELD,
    WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
    activateServicesForInvoice,
    applyPlanAndCreateInvoice,
    archiver,
    asArray,
    assertWithinPlanLimit,
    axios,
    buildUserPayload,
    computeProratedCreditKes,
    convertKesToPaypalAmount,
    effectiveChargeKes,
    fetchInvoicesForUser,
    fetchSelectedServicesForUser,
    fetchWebAccount,
    findLatestPaidSubscriptionInvoice,
    frappeClient,
    getMpesaAccessToken,
    logPortalUpdate,
    mpesaMetaValue,
    normalizeChildRow,
    normalizeMpesaPhone,
    reconcileServiceDeletionAgainstInvoices,
    requireAuth,
    sendInvoiceDeletedEmail,
    updateWebAccountServices 
  } = ctx;

  const router = express.Router();

router.post("/api/subscription/upgrade", requireAuth, async (req, res) => {
  try {
    const {
      newPlan
    } = req.body || {};
    if (!newPlan) return res.status(400).json({
      error: "Missing newPlan."
    });
    const client = frappeClient();
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Missing web account in session."
    });
    const record = await fetchWebAccount(client, webAccountName);
    const currentPlan = record?.plan || "None";
    if (currentPlan === "None") {
      // no plan yet → treat as apply plan normally
      await applyPlanAndCreateInvoice(client, webAccountName, newPlan, {
        force: true,
        creditKes: 0
      });
      const invoices = await fetchInvoicesForUser(client, webAccountName);
      const fresh = await fetchWebAccount(client, webAccountName);
      return res.json({
        ok: true,
        user: buildUserPayload({
          record: fresh,
          invoices
        })
      });
    }
    if (currentPlan === newPlan) {
      return res.status(400).json({
        error: `You are already on ${newPlan}. Add services instead.`
      });
    }

    // Optional: credit based on latest paid subscription invoice
    const latestPaid = await findLatestPaidSubscriptionInvoice(client, webAccountName);
    const creditKes = latestPaid ? computeProratedCreditKes(latestPaid) : 0;

    // Upgrade: set plan to newPlan and create invoice (minus credit)
    await applyPlanAndCreateInvoice(client, webAccountName, newPlan, {
      force: true,
      creditKes
    });

    // IMPORTANT: keep services, but set them Awaiting Payment until new plan paid
    // (You can decide to wipe or keep; you wanted keep files + likely reset services)
    // Here we keep services but mark them awaiting unless you want to clear them:
    const refreshed = await fetchWebAccount(client, webAccountName);
    const rows = asArray(refreshed?.[WEB_ACCOUNT_SERVICES_FIELD]).map(r => normalizeChildRow({
      ...r,
      status: SERVICE_STATUS_AWAITING
    }));
    await updateWebAccountServices(client, webAccountName, rows);
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const user = buildUserPayload({
      record: fresh,
      invoices,
      selectedServices
    });
    req.session.user = user;
    return res.json({
      ok: true,
      creditKes,
      user
    });
  } catch (err) {
    console.error("UPGRADE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to upgrade subscription."
    });
  }
});

router.delete("/api/account/services/:serviceId", requireAuth, async (req, res) => {
  try {
    const serviceId = String(req.params.serviceId || "").trim();
    const {
      confirmText
    } = req.body || {};
    if (!serviceId) return res.status(400).json({
      error: "Missing serviceId."
    });
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const client = frappeClient();
    const record = await fetchWebAccount(client, webAccountName);
    const existingRows = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);
    const row = existingRows.find(r => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim() === serviceId);
    if (!row) return res.status(404).json({
      error: "Service not found on your account."
    });
    const status = String(row?.[CHILD_STATUS_FIELD] || "").toLowerCase();
    const isPaid = status.includes("active") || status.includes("paid");
    if (isPaid && String(confirmText || "").trim() !== "DELETE") {
      return res.status(409).json({
        error: "This is a paid service. Type DELETE to confirm removal.",
        requiresConfirm: true
      });
    }

    // 1) Remove from Web Account selected services
    const filtered = existingRows.filter(r => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim() !== serviceId);
    await updateWebAccountServices(client, webAccountName, filtered);

    // 2) Remove from addon_service_ids on parent, if present
    let currentAddonIds = [];
    try {
      currentAddonIds = JSON.parse(record?.addon_service_ids || "[]");
    } catch {
      currentAddonIds = [];
    }
    const filteredAddonIds = (Array.isArray(currentAddonIds) ? currentAddonIds : []).map(id => String(id || "").trim()).filter(id => !!id && id !== serviceId);
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
      addon_service_ids: JSON.stringify(filteredAddonIds)
    });

    // 3) Remove from unpaid invoices and recalculate add-on totals
    await reconcileServiceDeletionAgainstInvoices(client, webAccountName, serviceId);
    const svcName = row?.[CHILD_SERVICE_NAME_FIELD] || serviceId;
    const svcTier = row?.[CHILD_TIER_FIELD] || "";
    await logPortalUpdate(client, webAccountName, {
      type: "info",
      engineer: "Murzak System",
      content: `Service removed: ${svcName}${svcTier ? ` (${svcTier})` : ""}.`
    });

    // 4) Refresh session payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);
    const user = buildUserPayload({
      record: fresh,
      invoices,
      selectedServices
    });
    req.session.user = user;
    return res.json({
      ok: true,
      user
    });
  } catch (err) {
    console.error("DELETE SERVICE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to delete service."
    });
  }
});

router.post("/api/account/services/update", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    const {
      plan,
      selectedServices
    } = req.body;
    if (!plan) return res.status(400).json({
      error: "Missing plan."
    });
    if (!Array.isArray(selectedServices)) return res.status(400).json({
      error: "selectedServices must be an array."
    });
    assertWithinPlanLimit(plan, selectedServices);
    const client = frappeClient();

    // Read parent doc so we can update its child table safely
    const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const account = accRes.data?.data || {};

    // Build child rows (status default Awaiting Payment)
    const childRows = selectedServices.map(s => ({
      doctype: WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
      [CHILD_SERVICE_ID_FIELD]: s.serviceId,
      [CHILD_SERVICE_NAME_FIELD]: s.serviceName || "",
      [CHILD_TIER_FIELD]: s.tier || "",
      [CHILD_DOMAIN_CHOICE_FIELD]: s.domainChoice || "",
      [CHILD_STATUS_FIELD]: s.status || "Awaiting Payment"
    }));

    // Update Web Account: plan + services table
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
      plan,
      [WEB_ACCOUNT_SERVICES_FIELD]: childRows
    });
    const ids = selectedServices.map(s => s.serviceId).filter(Boolean);
    await logPortalUpdate(client, webAccountName, {
      type: "technical",
      engineer: "Murzak System",
      content: `Services updated (${ids.length}): ${ids.join(", ")}`
    });

    // Upsert invoice snapshot (and amount)
    await applyPlanAndCreateInvoice(client, webAccountName, plan, selectedServices);

    // Return fresh payload bits
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selected = await fetchSelectedServicesForUser(client, webAccountName);

    // refresh session user (so portal updates without reload)
    const userRec = (await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`)).data?.data;
    const userPayload = buildUserPayload({
      record: userRec,
      invoices,
      selectedServices: selected
    });
    req.session.user = userPayload;
    return res.json({
      ok: true,
      selectedServices: selected,
      invoices,
      user: userPayload
    });
  } catch (err) {
    console.error("SERVICES UPDATE ERROR:", err.response?.data || err.message);
    const code = err.statusCode || 500;
    return res.status(code).json({
      error: err.message || "Failed to update services."
    });
  }
});

router.post("/api/billing/activate-services", requireAuth, async (req, res) => {
  try {
    const {
      invoiceDocName
    } = req.body;
    const result = await activateServicesForInvoice({
      req,
      invoiceDocName,
      frappeClient,
      PORTAL_INVOICE_SERVICES_FIELD,
      CHILD_SERVICE_ID_FIELD,
      WEB_ACCOUNT_SERVICES_FIELD,
      CHILD_STATUS_FIELD,
      fetchInvoicesForUser,
      fetchSelectedServicesForUser,
      buildUserPayload
    });
    return res.json(result);
  } catch (err) {
    console.error("ACTIVATE SERVICES ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: "Failed to activate services."
    });
  }
});

router.get("/api/billing/invoice/:docName", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    const {
      docName
    } = req.params;
    if (!docName) return res.status(400).json({
      error: "Missing docName."
    });
    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(docName)}`);
    const inv = invRes.data?.data;
    if (!inv) return res.status(404).json({
      error: "Invoice not found."
    });
    if (inv.web_account !== webAccountName) {
      return res.status(403).json({
        error: "Invoice not yours."
      });
    }
    return res.json({
      ok: true,
      invoice: {
        docName: inv.name,
        invoiceNo: inv.invoice_no || inv.name,
        amount: Number(inv.amount || 0),
        paypalAmountUsd: convertKesToPaypalAmount(inv.amount),
        status: inv.status,
        type: inv.type,
        plan: inv.plan,
        date: inv.invoice_date
      }
    });
  } catch (err) {
    console.error("GET INVOICE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to fetch invoice."
    });
  }
});

// ----------------------------------------
// --- M-PESA STK PUSH (Safaricom Daraja) ---
// ----------------------------------------

/**
 * Returns a Daraja OAuth access token.
 * Cached for 55 minutes to avoid hammering the auth endpoint.
 */

// Initiate STK Push
router.post("/api/billing/mpesa/stk-push", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      phoneNumber,
      invoiceDocName
    } = req.body || {};
    if (!phoneNumber || !invoiceDocName) {
      return res.status(400).json({
        error: "Missing phoneNumber or invoiceDocName."
      });
    }
    const phone = normalizeMpesaPhone(phoneNumber);
    if (!phone) {
      return res.status(400).json({
        error: "Invalid M-Pesa phone number. Use format 07xx or 01xx."
      });
    }
    if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET) {
      console.error("MPESA MISSING ENV: MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set.");
      return res.status(503).json({
        error: "M-Pesa payment is not configured. Please use PayPal or contact support."
      });
    }
    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`);
    const inv = invRes.data?.data;
    if (!inv) return res.status(404).json({
      error: "Invoice not found."
    });
    if (inv.web_account !== webAccountName) return res.status(403).json({
      error: "Invoice not yours."
    });
    if (String(inv.status || "").toLowerCase() === "paid") {
      return res.status(409).json({
        error: "Invoice is already paid."
      });
    }

    // Free / zero-amount invoices push the small verification charge so the
    // trial is activated against a real M-Pesa transaction ("for free").
    const amountKes = Math.ceil(effectiveChargeKes(inv.amount));
    if (amountKes <= 0) return res.status(400).json({
      error: "Invoice amount must be greater than 0."
    });
    const mpesaEnv = (process.env.MPESA_ENV || "sandbox").toLowerCase();
    const darajaBase = mpesaEnv === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;
    if (!shortcode || !passkey || !callbackUrl) {
      console.error("MPESA MISSING ENV: MPESA_SHORTCODE / MPESA_PASSKEY / MPESA_CALLBACK_URL");
      return res.status(503).json({
        error: "M-Pesa payment is not fully configured. Please contact support."
      });
    }
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const token = await getMpesaAccessToken();
    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amountKes,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: inv.invoice_no || invoiceDocName,
      TransactionDesc: `Murzak ${inv.invoice_no || invoiceDocName}`
    };
    const stkResp = await axios.post(`${darajaBase}/mpesa/stkpush/v1/processrequest`, stkPayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    const stkData = stkResp.data || {};
    if (stkData.ResponseCode !== "0") {
      console.error("STK PUSH FAILED:", stkData);
      return res.status(502).json({
        error: stkData.ResponseDescription || stkData.errorMessage || "STK push failed."
      });
    }

    // Persist checkoutRequestID so the callback can match it
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
      mpesa_checkout_request_id: stkData.CheckoutRequestID
    });
    return res.json({
      ok: true,
      checkoutRequestID: stkData.CheckoutRequestID,
      merchantRequestID: stkData.MerchantRequestID,
      message: "STK push sent. Please check your phone and enter your M-Pesa PIN."
    });
  } catch (err) {
    console.error("MPESA STK PUSH ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to initiate M-Pesa payment."
    });
  }
});

// Extract a named value from the M-Pesa CallbackMetadata.Item array.

// M-Pesa Daraja async callback (configure MPESA_CALLBACK_URL to point here publicly).
// Safaricom does not sign callbacks, so we defend the endpoint with an unguessable
// shared-secret token embedded in the callback URL (?token=...) and verify the
// amount paid against the invoice before activating anything.
router.post("/api/billing/mpesa/callback", async (req, res) => {
  try {
    // 1) Shared-secret check. FAIL CLOSED: in production an unconfigured secret
    //    would leave this endpoint open to forged payment confirmations.
    const expectedToken = process.env.MPESA_CALLBACK_SECRET;
    if (!expectedToken) {
      if (process.env.NODE_ENV === "production") {
        console.error("MPESA CALLBACK: rejected — MPESA_CALLBACK_SECRET not configured.");
        return res.status(503).json({
          ResultCode: 1,
          ResultDesc: "Callback not configured"
        });
      }
    } else {
      const provided = String(req.query.token || req.headers["x-callback-token"] || "");
      if (provided !== expectedToken) {
        console.warn("MPESA CALLBACK: rejected — bad/missing token from", req.ip);
        return res.status(401).json({
          ResultCode: 1,
          ResultDesc: "Unauthorized"
        });
      }
    }
    const body = req.body?.Body?.stkCallback || req.body;
    const resultCode = Number(body?.ResultCode ?? 1);
    const checkoutRequestID = String(body?.CheckoutRequestID || "").trim();

    // Always respond 200 immediately (Safaricom spec requirement)
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
    if (resultCode !== 0 || !checkoutRequestID) {
      console.warn("MPESA CALLBACK: payment not successful or missing ID", {
        resultCode,
        checkoutRequestID
      });
      return;
    }
    const client = frappeClient();
    const searchRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([["mpesa_checkout_request_id", "=", checkoutRequestID]]),
        fields: JSON.stringify(["name", "web_account", "status", "amount"]),
        limit_page_length: 1
      }
    });
    const inv = searchRes.data?.data?.[0];
    if (!inv?.name) {
      console.warn("MPESA CALLBACK: no invoice found for checkoutRequestID:", checkoutRequestID);
      return;
    }
    if (String(inv.status || "").toLowerCase() === "paid") {
      console.log("MPESA CALLBACK: invoice already paid:", inv.name);
      return;
    }

    // 2) Verify the amount actually paid matches what we billed.
    //    Reject if the amount is missing or below the billed amount (fail closed).
    const paidAmount = Number(mpesaMetaValue(body, "Amount") || 0);
    const expectedAmount = Math.ceil(effectiveChargeKes(inv.amount));
    if (expectedAmount > 0 && (!(paidAmount > 0) || paidAmount < expectedAmount)) {
      console.error("MPESA CALLBACK: amount missing or underpaid — rejected", {
        invoice: inv.name,
        paidAmount,
        expectedAmount
      });
      return;
    }

    // 3) Record the receipt number for reconciliation (best-effort).
    const receipt = mpesaMetaValue(body, "MpesaReceiptNumber");
    if (receipt) {
      try {
        await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(inv.name)}`, {
          mpesa_receipt_number: String(receipt)
        });
      } catch (e) {
        console.warn("MPESA CALLBACK: could not store receipt number:", e.response?.data || e.message);
      }
    }
    await activateServicesForInvoice({
      req: {
        session: {
          webAccount: inv.web_account,
          user: {
            id: inv.web_account
          }
        }
      },
      invoiceDocName: inv.name,
      // Trusted rail: the callback verified the shared secret and that the paid
      // amount meets the invoice's expected charge before reaching this point.
      paymentVerified: true,
      frappeClient,
      PORTAL_INVOICE_SERVICES_FIELD,
      CHILD_SERVICE_ID_FIELD,
      WEB_ACCOUNT_SERVICES_FIELD,
      CHILD_STATUS_FIELD,
      fetchInvoicesForUser,
      fetchSelectedServicesForUser,
      buildUserPayload
    });
    console.log("MPESA CALLBACK: services activated for invoice:", inv.name);
  } catch (err) {
    console.error("MPESA CALLBACK ERROR:", err.response?.data || err.message);
  }
});

// Poll payment status — frontend polls this after sending STK push

// Poll payment status — frontend polls this after sending STK push
router.get("/api/billing/mpesa/status/:invoiceDocName", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      invoiceDocName
    } = req.params;
    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`);
    const inv = invRes.data?.data;
    if (!inv) return res.status(404).json({
      error: "Invoice not found."
    });
    if (inv.web_account !== webAccountName) return res.status(403).json({
      error: "Invoice not yours."
    });
    return res.json({
      ok: true,
      status: inv.status,
      paid: String(inv.status || "").toLowerCase() === "paid"
    });
  } catch (err) {
    console.error("MPESA STATUS ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to check payment status."
    });
  }
});

// ----------------------------------------
// --- PAYPAL WEBHOOK (out-of-band truth) ---
// ----------------------------------------
// Authoritative, browser-independent payment reconciliation. Reconciles a paid
// capture even if the buyer closed the tab before /capture-order returned, and
// reverses activation on refund/chargeback. Signature is verified server-side
// via PayPal's API; FAILS CLOSED (rejects unverified / unconfigured in prod).

router.post("/api/invoices/:invoiceNo/delete", requireAuth, async (req, res) => {
  try {
    const {
      invoiceNo
    } = req.params;
    const webAccountName = req.session?.user?.id || req.session?.webAccountName;
    if (!webAccountName) {
      return res.status(401).json({
        error: "Not authenticated"
      });
    }
    const client = frappeClient();

    // Helper function to lookup in a doctype
    async function lookupDoc(doctype) {
      const response = await client.get(`/api/resource/${doctype}`, {
        params: {
          filters: JSON.stringify([["web_account", "=", webAccountName]]),
          or_filters: JSON.stringify([["name", "=", invoiceNo], ["invoice_no", "=", invoiceNo]]),
          fields: JSON.stringify(["name", "invoice_no", "web_account_email", "client_name", "status"]),
          limit_page_length: 1
        }
      });
      return response.data?.data?.[0] || null;
    }

    // Try first doctype
    let doc = await lookupDoc("Portal Invoice");
    let doctypeUsed = "Portal Invoice";

    // If not found → try second doctype
    if (!doc) {
      doc = await lookupDoc("Test Plan Invoice");
      doctypeUsed = "Test Plan Invoice";
    }
    if (!doc) {
      return res.status(404).json({
        error: "Invoice not found in any doctype."
      });
    }
    // A Paid invoice is an accounting record (and the proof behind
    // hasPaidSubscriptionForPlan) — customers may only remove unpaid ones.
    if (String(doc.status || "").trim().toLowerCase() === "paid") {
      return res.status(409).json({
        error: "Paid invoices cannot be deleted. Contact support if you need a correction."
      });
    }
    const now = new Date();
    const mysqlDatetime = now.toISOString().slice(0, 19).replace("T", " ");

    // Soft delete
    await client.put(`/api/resource/${doctypeUsed}/${encodeURIComponent(doc.name)}`, {
      status: "Deleted",
      deleted_at: mysqlDatetime,
      deleted_by: webAccountName
    });
    if (doc.web_account_email) {
      await sendInvoiceDeletedEmail({
        to: doc.web_account_email,
        clientName: doc.client_name || "",
        invoiceNo: doc.invoice_no || doc.name
      });
      console.log("DELETE INVOICE:", doc.invoice_no || doc.name);
    }
    return res.json({
      ok: true,
      deleted: doc.invoice_no || doc.name,
      doctype: doctypeUsed
    });
  } catch (err) {
    console.error("INVOICE DELETE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to delete invoice."
    });
  }
});

// -----------------------------
// DOWNLOAD SINGLE INVOICE (PDF)
// -----------------------------

// -----------------------------
// DOWNLOAD SINGLE INVOICE (PDF)
// -----------------------------
router.get("/api/invoices/:docName/download", async (req, res) => {
  try {
    const {
      docName
    } = req.params;
    const webAccountName = req.session?.webAccount || req.session?.user?.id || req.session?.user?.name;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated"
    });
    const client = frappeClient();

    // 1) Load the exact invoice doc by docName
    const invResp = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(docName)}`);
    const inv = invResp.data?.data;
    if (!inv) return res.status(404).json({
      error: "Invoice not found."
    });

    // 2) Ownership check
    if (inv.web_account !== webAccountName || inv.status === "Deleted") {
      return res.status(404).json({
        error: "Invoice not found."
      });
    }

    // 3) Render PDF using the same docName
    const pdfResp = await client.get("/api/method/frappe.utils.print_format.download_pdf", {
      params: {
        doctype: "Portal Invoice",
        name: docName,
        format: "Murzak Portal Invoice",
        no_letterhead: 0
      },
      responseType: "arraybuffer"
    });
    const filename = `${inv.invoice_no || docName}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(Buffer.from(pdfResp.data));
  } catch (err) {
    console.error("INVOICE DOWNLOAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to download invoice."
    });
  }
});

// ------------------------------------
// DOWNLOAD ALL INVOICES (ZIP OF PDFs)
// ------------------------------------
router.get("/api/invoices/download-all", async (req, res) => {
  try {
    const webAccountName = req.session?.user?.id || req.session?.user?.name || req.session?.webAccountName;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated"
    });
    const client = frappeClient();

    // 1) Fetch all invoices for this user (exclude deleted)
    const invoicesRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([["web_account", "=", webAccountName], ["status", "!=", "Deleted"]]),
        fields: JSON.stringify(["name", "invoice_no"]),
        limit_page_length: 200,
        order_by: "creation desc"
      }
    });
    const rows = invoicesRes.data?.data || [];
    if (!rows.length) return res.status(404).json({
      error: "No invoices found."
    });

    // 2) Prepare ZIP stream
    const zipName = `invoices-${webAccountName}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    const archive = archiver("zip", {
      zlib: {
        level: 9
      }
    });
    archive.on("error", e => {
      console.error("ZIP ERROR:", e);
      // if headers already sent, just end
      try {
        res.status(500).end();
      } catch {}
    });
    archive.pipe(res);

    // 3) For each invoice, fetch PDF and append into ZIP
    for (const r of rows) {
      const docName = r.name;
      const invoiceNo = r.invoice_no || docName;
      const pdfResp = await client.get("/api/method/frappe.utils.print_format.download_pdf", {
        params: {
          doctype: "Portal Invoice",
          name: docName,
          format: "Murzak Portal Invoice",
          no_letterhead: 0
        },
        responseType: "arraybuffer"
      });
      archive.append(Buffer.from(pdfResp.data), {
        name: `${invoiceNo}.pdf`
      });
    }
    await archive.finalize();
  } catch (err) {
    console.error("DOWNLOAD ALL ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to download invoices."
    });
  }
});

// --- CLIENT MESSAGES / REQUESTS ---

  return router;
};
