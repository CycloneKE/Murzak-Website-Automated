// routes/ordersRoutes.js
//
// /api/orders — draft checkout orders: reserve capacity, prepare an invoice,
// cancel, or join the waitlist when the shared box has no room. Draft
// creation/reservation/renewal/cancellation lives in
// services/checkout/orderStore.js; invoice creation reuses
// services/addonInvoiceService.js (paid-plan add-on) or the same
// applyPlanAndCreateInvoice/updateWebAccountServices helpers billingRoutes
// uses (first purchase).

const express = require("express");

module.exports = function (ctx) {
  const {
    requireAuth,
    frappeClient,
    fetchWebAccount,
    applyPlanAndCreateInvoice,
    updateWebAccountServices,
    fetchInvoicesForUser,
    asArray,
    hasPaidSubscriptionForPlan,
    normalizeSelectedServices,
    findOpenInvoice,
    normalizeInvoiceServiceRow,
    buildInvoiceServiceRows,
    PORTAL_INVOICE_SERVICES_FIELD,
    WEB_ACCOUNT_SERVICES_FIELD,
    mergeServicesById,
    buildWebAccountServiceRows,
    assertOrderWithinCapacity,
    CAPACITY_REQUEST_DOCTYPE,
    createAddonInvoice,
    getReservedRamMb,
    createOrder,
    getOrder,
    cancelOrder,
    linkInvoice,
  } = ctx;

  const router = express.Router();

  function webAccountOf(req) {
    return req.session?.webAccount || req.session?.user?.id;
  }

  // Error mapping matches the Task 1 wrapper: an err.statusCode set by a
  // service function is trusted verbatim (message + optional code); anything
  // without one is an unexpected failure — log it and return a generic 500 so
  // internals never leak to the client.
  function sendError(res, err, fallbackMessage, logLabel) {
    const status = err.statusCode || 500;
    const body = { error: err.statusCode ? (err.message || fallbackMessage) : fallbackMessage };
    if (err.code) body.code = err.code;
    if (err.code === "CAPACITY") body.waitlistAvailable = true;
    if (status >= 500) console.error(`${logLabel} ERROR:`, err.response?.data || err.message);
    return res.status(status).json(body);
  }

  router.post("/api/orders", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const { serviceId, config, planKey, source } = req.body || {};
      if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

      // Per-order cap (422) before touching fleet capacity/reservations.
      assertOrderWithinCapacity([{ serviceId }]);

      const client = frappeClient();
      const fleetReservedRamMb = (await getReservedRamMb(client)) || 0;

      const order = await createOrder({
        client,
        webAccountName,
        serviceId,
        config,
        planKey,
        source,
        fleetReservedRamMb,
        nowMs: Date.now(),
      });
      return res.json({ ok: true, order });
    } catch (err) {
      return sendError(res, err, "Failed to create order.", "CREATE ORDER");
    }
  });

  router.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      // renew:true — this GET is the checkout page's heartbeat, keeping the
      // reservation alive while the buyer is present.
      const order = await getOrder({
        client,
        webAccountName,
        orderId: req.params.id,
        nowMs: Date.now(),
        renew: true,
      });
      return res.json({ ok: true, order });
    } catch (err) {
      return sendError(res, err, "Failed to fetch order.", "GET ORDER");
    }
  });

  router.post("/api/orders/:id/cancel", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      const orderId = req.params.id;

      // cancelOrder itself does not guard against cancelling an already-Paid
      // order — check status here first so a paid order is never silently
      // flipped to Cancelled.
      const existing = await getOrder({ client, webAccountName, orderId, nowMs: Date.now(), renew: false });
      if (existing.status === "Paid") {
        return res.status(409).json({ error: "Cannot cancel a paid order." });
      }

      const result = await cancelOrder({ client, webAccountName, orderId });
      return res.json(result);
    } catch (err) {
      return sendError(res, err, "Failed to cancel order.", "CANCEL ORDER");
    }
  });

  router.post("/api/orders/:id/prepare-payment", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const client = frappeClient();
      const orderId = req.params.id;
      const nowMs = Date.now();

      const order = await getOrder({ client, webAccountName, orderId, nowMs, renew: false });

      // Idempotent: already prepared. getOrder above already reconciled
      // order.status against the linked invoice's paid state, so returning
      // the same invoiceDocName here is correct whether or not it has since
      // been paid.
      if (order.invoiceDocName) {
        return res.json({ ok: true, invoiceDocName: order.invoiceDocName });
      }

      if (order.status !== "Draft") {
        return res.status(409).json({ error: "This order can no longer be paid.", code: "ORDER_NOT_DRAFT" });
      }
      if (!(Date.parse(order.reservationExpiresAt) > nowMs)) {
        return res.status(409).json({
          error: "Your reservation has expired. Please refresh to reserve capacity again.",
          code: "RESERVATION_EXPIRED",
        });
      }

      const record = await fetchWebAccount(client, webAccountName);
      const planKey = record?.plan || "None";
      const hasPaidPlan = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);

      // Domain-registration purchases carry the purchased domain string in
      // config.domain (see frontend Products.tsx's handleSelectDomain), NOT
      // config.domainChoice — that key is a different, pre-existing concept
      // reused by the hosting flow for "Bring My Domain" / "Use Murzak
      // Subdomain" / "Register New Domain". Route the right value into the
      // domainChoice field so it flows into the invoice + Web Account service
      // rows (buildInvoiceServiceRows / buildWebAccountServiceRows already
      // persist it) and from there into the staff provisioning notification —
      // without this, the domain a customer paid for is dropped on the floor
      // and no human can tell what to register.
      const isDomainProduct = order.category === "Domain Registration";
      const serviceRow = {
        serviceId: order.serviceId,
        serviceName: order.serviceName,
        tier: order.tier,
        domainChoice: isDomainProduct
          ? String(order.config?.domain || "").trim()
          : (order.config?.domainChoice || ""),
      };

      let invoiceDocName;
      if (hasPaidPlan) {
        const result = await createAddonInvoice({
          client,
          webAccountName,
          services: [serviceRow],
          deps: {
            fetchWebAccount,
            hasPaidSubscriptionForPlan,
            normalizeSelectedServices,
            findOpenInvoice,
            normalizeInvoiceServiceRow,
            buildInvoiceServiceRows,
            PORTAL_INVOICE_SERVICES_FIELD,
          },
        });
        invoiceDocName = result.invoiceDocName;

        // createAddonInvoice deliberately only prices/invoices — attaching the
        // service to the Web Account is documented as "the caller's
        // responsibility" (see its module comment). Without this, the
        // customer pays, the invoice shows Paid, but the service never
        // appears on their account and nothing gets provisioned:
        // activateServicesForInvoiceLocked only flips the STATUS of rows
        // that already exist, it never appends a new one. Reproduced live
        // 2026-08-11 — an existing paying customer's Website Hosting
        // purchase paid clean but silently never activated. Mirrors the
        // first-purchase branch below, which already does this at the same
        // point in the flow.
        const acctForAddon = await fetchWebAccount(client, webAccountName);
        const existingForAddon = normalizeSelectedServices(asArray(acctForAddon?.[WEB_ACCOUNT_SERVICES_FIELD]));
        const mergedForAddon = mergeServicesById(existingForAddon, [serviceRow]);
        await updateWebAccountServices(client, webAccountName, buildWebAccountServiceRows(mergedForAddon));
      } else {
        // First purchase: apply the order's plan and bill it, then attach
        // the order's service to the account (mirrors mergeServicesById's
        // usage at server.js:1115-1145).
        //
        // The 4th arg MUST be an array of selected services — passing an
        // opts object here (as an earlier version of this call did) makes
        // applyPlanAndCreateInvoice default selectedServices to [], bill
        // KES 0, and skip invoice creation entirely (server.js's zero_amount
        // early-return), leaving prepare-payment with no invoice to link and
        // a guaranteed 500. Reuse serviceRow (built above) so there's always
        // something to bill on a brand-new account's first purchase.
        //
        // NOTE — a domain-only first purchase still defaults to planKey
        // "Starter" here, which flips the account to plan Starter and — once
        // that Subscription invoice is paid — makes
        // hasPaidSubscriptionForPlan(client, acct, "Starter") return true.
        // This is intentionally left as-is: hasPaidSubscriptionForPlan is
        // also what THIS function's routing (hasPaidPlan, above) and several
        // other shared billing primitives (findExistingUnpaidSubscriptionInvoice,
        // findLatestPaidSubscriptionInvoice, applyPlanAndCreateInvoice) rely
        // on — repurposing it to mean "owns real infrastructure" broke a
        // repeat domain purchase in a prior fix attempt (see
        // .superpowers/sdd/final-review-fix-report.md "Fix round 2" for the
        // trace). The actual billing-gate leak this caused — a domain-only
        // account unlocking real infrastructure add-ons — is fixed
        // separately and more narrowly at the add-on ELIGIBILITY gate
        // itself: addonEligibility.js's isAddonEligible() now requires
        // hasNonDomainPaidHistory (computed from the Web Account's own
        // service history, not from this Subscription-invoice check) for
        // any non-domain add-on, while still allowing domain-only accounts
        // to buy more domains through the exact same gate.
        await applyPlanAndCreateInvoice(client, webAccountName, order.planKey || "Starter", [serviceRow], {
          force: true,
          creditKes: 0,
        });

        const acct = await fetchWebAccount(client, webAccountName);
        const existingServices = normalizeSelectedServices(asArray(acct?.[WEB_ACCOUNT_SERVICES_FIELD]));
        const merged = mergeServicesById(existingServices, [serviceRow]);
        await updateWebAccountServices(client, webAccountName, buildWebAccountServiceRows(merged));

        const invoices = await fetchInvoicesForUser(client, webAccountName);
        const unpaid = invoices.find((inv) => inv.status === "Unpaid");
        if (!unpaid) {
          const err = new Error("Failed to create an invoice for this order.");
          err.statusCode = 500;
          throw err;
        }
        invoiceDocName = unpaid.docName;
      }

      await linkInvoice({ client, orderId, invoiceDocName });
      return res.json({ ok: true, invoiceDocName });
    } catch (err) {
      return sendError(res, err, "Failed to prepare payment.", "PREPARE PAYMENT");
    }
  });

  router.post("/api/orders/waitlist", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

      const { serviceId } = req.body || {};
      if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

      const client = frappeClient();
      await client.post(`/api/resource/${CAPACITY_REQUEST_DOCTYPE}`, {
        reason: "checkout-waitlist",
        service_id: serviceId,
        web_account: webAccountName,
        status: "Open",
      });
      return res.json({ ok: true });
    } catch (err) {
      return sendError(res, err, "Failed to join the waitlist.", "ORDERS WAITLIST");
    }
  });

  return router;
};
