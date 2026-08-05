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
// NOTE: deliberately a plain-assignment require, not brace destructuring —
// test/routesContext.test.js's static wiring check greps this file for its
// FIRST curly-brace destructuring assignment to find the ctx keys it wires;
// an earlier destructured require would make its lazy regex swallow
// everything up to the real ctx destructure below and misreport bogus
// "missing" keys. A plain assignment sidesteps that collision.
const accountBillingTerm = require("../services/billingTerm").accountBillingTerm;
// Same plain-assignment rationale as accountBillingTerm above — kept as a
// second statement (not merged into one destructure) so the static wiring
// check's regex still finds its target unambiguously.
const annualPrepayKes = require("../services/billingTerm").annualPrepayKes;

// Shared by POST /api/orders (order-creation) and POST
// /api/orders/:id/prepare-payment (payment-prep, which now also accepts a
// billingTerm so the checkout page's term selector — which only renders
// AFTER the order already exists — can still reach the account). Normalized
// here, never trusted raw: anything that isn't exactly "annual"
// (case-insensitively) resolves to "monthly", mirroring
// accountBillingTerm's fail-safe rule so an unknown/garbage value can never
// become an accidental "annual".
function normalizeBillingTerm(value) {
  return String(value || "").toLowerCase() === "annual" ? "annual" : "monthly";
}

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
    sumSelectedServicesMonthlyKes,
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

      const { serviceId, config, planKey, source, billingTerm } = req.body || {};
      if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

      // Per-order cap (422) before touching fleet capacity/reservations.
      assertOrderWithinCapacity([{ serviceId }]);

      const client = frappeClient();
      const fleetReservedRamMb = (await getReservedRamMb(client)) || 0;

      const normalizedTerm = normalizeBillingTerm(billingTerm);

      const order = await createOrder({
        client,
        webAccountName,
        serviceId,
        config: { ...(config || {}), billingTerm: normalizedTerm },
        planKey,
        source,
        fleetReservedRamMb,
        nowMs: Date.now(),
      });
      return res.json({ ok: true, order: { ...order, billingTerm: normalizedTerm } });
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

      // billingTerm in the request body — from the checkout page's term
      // selector, which only renders AFTER the order already exists as a
      // Draft — takes priority over the order's own stored config for this
      // call. Normalized (never trusted raw) via the shared helper above.
      // Omitting the field entirely (every caller before this fix, and the
      // domain flow, which never offers a term choice) falls back to the
      // order's stored config exactly as before this fix.
      const bodyBillingTerm = (req.body || {}).billingTerm;
      const effectiveBillingTerm =
        bodyBillingTerm === undefined
          ? normalizeBillingTerm(order.config?.billingTerm)
          : normalizeBillingTerm(bodyBillingTerm);

      // Persist the chosen term on the account so the renewal sweep bills on
      // the right cadence from here on. Only ever writes "annual" — an
      // account is never silently downgraded to monthly by an order.
      //
      // `term_started_on` anchors pro-rata for mid-term add-ons. It is
      // written ONLY when the account is not already annual, so a repeat
      // annual write never resets an in-flight term (which would hand the
      // customer a fresh 365 days they did not pay for).
      async function writeAnnualBillingTermIfNeeded(currentRecord) {
        if (effectiveBillingTerm !== "annual") return;
        const alreadyAnnual = accountBillingTerm(currentRecord) === "annual";
        await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
          billing_term: "annual",
          ...(alreadyAnnual ? {} : { term_started_on: new Date().toISOString().slice(0, 10) }),
        });
      }

      // Idempotent: already prepared. getOrder above already reconciled
      // order.status against the linked invoice's paid state, so returning
      // the same invoiceDocName here is correct whether or not it has since
      // been paid.
      //
      // The customer may have changed their billing-term selection AFTER
      // this endpoint already ran once — the checkout page auto-calls
      // prepare-payment on load, using whatever term was selected (or the
      // default) at that moment, before the customer has necessarily
      // touched the selector. Re-applying the annual-term account write here
      // (guarded by the same no-downgrade / no-reset rules as the
      // first-time write below) means a later term change delivered via a
      // repeat call to this endpoint still reaches the account, instead of
      // being silently dropped by this idempotency short-circuit.
      if (order.invoiceDocName) {
        if (effectiveBillingTerm === "annual") {
          const record = await fetchWebAccount(client, webAccountName);
          await writeAnnualBillingTermIfNeeded(record);
        }
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

      // Persist the chosen term on the account (see writeAnnualBillingTermIfNeeded
      // above for the no-downgrade / no-reset rules). `record` here is the
      // same fetchWebAccount result used for planKey/hasPaidPlan just above —
      // reused rather than re-fetched.
      await writeAnnualBillingTermIfNeeded(record);

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

        // applyPlanAndCreateInvoice above has NO billing-term awareness — it
        // always bills the plain monthly sum (sumSelectedServicesMonthlyKes).
        // For a first-time annual purchase that undercharges by ~5x (monthly
        // instead of annual-prepay), so correct the just-created invoice's
        // amount here rather than teaching the shared primitive about terms
        // (applyPlanAndCreateInvoice is reused by upgrade/configurator/add-on
        // flows this task has no coverage for — see the note above this
        // branch). Deliberately scoped to ONLY this first-purchase branch:
        // the hasPaidPlan branch above already bills the correct annual
        // amount via createAddonInvoice's own pro-ration, and re-applying
        // annualPrepayKes there would 12x-overcharge an add-on.
        if (effectiveBillingTerm === "annual") {
          const monthlySumKes = sumSelectedServicesMonthlyKes([serviceRow]);
          const annualAmountKes = annualPrepayKes(monthlySumKes);
          await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
            amount: annualAmountKes,
          });
        }
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
