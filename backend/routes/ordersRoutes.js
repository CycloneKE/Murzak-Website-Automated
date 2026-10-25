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
const annualPrepayKes = require("../services/billingTerm").annualPrepayKes;
// Same plain-assignment rationale as annualPrepayKes above — kept as a
// second statement (not merged into one destructure) so the static wiring
// check's regex still finds its target unambiguously.
const isEligibleForTermChoice = require("../services/checkoutBillingTerm").isEligibleForTermChoice;
// Plain-assignment requires again (same static-wiring-check rationale).
const validateAppOrder = require("../services/apps/appOrder").validateAppOrder;
const isAppService = require("../services/apps/appOrder").isAppService;
const tenantSlugs = require("../services/apps/tenantSlugStore");
const suggestSlugs = require("../services/apps/shopAddress").suggestSlugs;
const shopSetup = require("../services/apps/shopSetup");
const setCompanions = require("../services/checkout/orderStore").setCompanions;
const getServiceMeta = require("../services/provisioning/catalog").getServiceMeta;

// Shared by POST /api/orders (order-creation, purely informational — the
// order's own stored config.billingTerm is never read back by
// prepare-payment) and POST /api/orders/:id/prepare-payment (payment-prep,
// which is where a confirmed term actually affects the invoice). Normalized
// here, never trusted raw: anything that isn't exactly "annual"
// (case-insensitively) resolves to "monthly", so an unknown/garbage value can
// never become an accidental "annual".
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

  // Status-PRESERVING normalizer for rows already stored on the Web Account.
  //
  // ctx.normalizeSelectedServices sanitizes CLIENT-SUPPLIED selections and is
  // intentionally lossy: it collapses status to "Active" | "Awaiting Payment"
  // (see server.js — do not change that, it also sanitizes an unauthenticated
  // input path). Feeding it rows read back OUT of the Web Account and PUTting
  // the result silently demotes "Setting up"/"Suspended" to "Awaiting
  // Payment", which (1) permanently strips a real customer's add-on
  // eligibility (see addonEligibility.js's PAID_SERVICE_STATUSES) and (2)
  // permanently breaks provisioning completion, since runner.js's
  // markAccountServiceActive only flips rows that are exactly "Setting up".
  // Reproduced live: any prepare-payment call for a mid-provisioning or
  // lapsed-renewal customer silently and irreversibly demoted their row.
  // Mirrors renewalService.js's own care around not touching stored status.
  function normalizeExistingAccountServiceRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        serviceId: String(r?.service_id ?? r?.serviceId ?? "").trim(),
        serviceName: String(r?.service_name ?? r?.serviceName ?? "").trim(),
        tier: String(r?.tier ?? "").trim(),
        domainChoice: String(r?.domain_choice ?? r?.domainChoice ?? "").trim(),
        status: String(r?.status ?? "").trim() || "Awaiting Payment",
      }))
      .filter((s) => !!s.serviceId);
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

      const { serviceId, config, planKey, source, billingTerm, companions } = req.body || {};
      if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

      // Per-order cap (422) before touching fleet capacity/reservations.
      assertOrderWithinCapacity([{ serviceId }]);

      const client = frappeClient();

      // App orders (Murzak POS tiers): validate the shop address and enforce
      // one live shop per app before reserving anything.
      let app = null;
      try {
        // Only app tiers need the account's existing services, so every other
        // order skips this read and behaves exactly as before. A missing
        // account (404) just means no existing shop.
        let acct = null;
        if (isAppService(serviceId)) {
          try {
            acct = await fetchWebAccount(client, webAccountName);
          } catch (fe) {
            if (fe.response?.status !== 404) throw fe;
          }
        }
        app = validateAppOrder({
          serviceId,
          config,
          existingServiceRows: normalizeExistingAccountServiceRows(asArray(acct?.[WEB_ACCOUNT_SERVICES_FIELD])),
        });
      } catch (e) {
        if (e.code && e.statusCode) return res.status(e.statusCode).json({ error: e.message, code: e.code });
        throw e;
      }
      const nowMs = Date.now();
      if (app && !(await tenantSlugs.isSlugAvailableTo(client, app.slug, webAccountName, nowMs))) {
        return res.status(409).json({
          error: "That shop address was just taken.",
          code: "slug_taken",
          suggestions: suggestSlugs(app.slug),
        });
      }

      const fleetReservedRamMb = (await getReservedRamMb(client)) || 0;
      const normalizedTerm = normalizeBillingTerm(billingTerm);
      // app/slug/shopName are RESERVED: they decide who owns a shop address and
      // whether prepare-payment reserves/links a Tenant Slug. They are set only
      // from validateAppOrder's result (app tiers); whatever the client sent under
      // those names is dropped first, so a non-app order can never carry them.
      const { app: _clientApp, slug: _clientSlug, shopName: _clientShopName, bundle: _clientBundle, ...clientConfig } =
        config && typeof config === "object" ? config : {};
      const storedConfig = {
        ...clientConfig,
        billingTerm: normalizedTerm,
        ...(app ? { app: app.app, slug: app.slug, shopName: app.shopName } : {}),
      };

      // A companion list is only forwarded when non-empty, so an order without
      // companions behaves exactly as before (validateCompanions 422s whenever
      // bundles are disabled, even for an empty list).
      if (companions !== undefined && !Array.isArray(companions)) {
        return res.status(422).json({ error: "companions must be a list." });
      }
      const order = await createOrder({
        client,
        webAccountName,
        serviceId,
        config: storedConfig,
        planKey,
        source,
        fleetReservedRamMb,
        nowMs,
        ...(companions && companions.length ? { companions } : {}),
      });

      if (app) {
        try {
          await tenantSlugs.reserveSlug(client, {
            slug: app.slug, app: app.app, webAccount: webAccountName, orderId: order.id, nowMs,
          });
        } catch (e) {
          // Lost the race for the name after the order was minted — release the
          // order's RAM reservation too, so a failed attempt holds nothing.
          await cancelOrder({ client, webAccountName, orderId: order.id }).catch(() => {});
          if (e.code === "slug_taken") {
            return res.status(409).json({ error: e.message, code: e.code, suggestions: suggestSlugs(app.slug) });
          }
          throw e;
        }
      }

      return res.json({ ok: true, order: { ...order, billingTerm: normalizedTerm } });
    } catch (err) {
      return sendError(res, err, "Failed to create order.", "CREATE ORDER");
    }
  });

  // Replace the companion list on a Draft order that has no invoice yet.
  router.put("/api/orders/:id/companions", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const companions = (req.body || {}).companions;
      if (!Array.isArray(companions)) return res.status(422).json({ error: "companions must be a list." });

      const client = frappeClient();
      const fleetReservedRamMb = (await getReservedRamMb(client)) || 0;
      const order = await setCompanions({
        client,
        webAccountName,
        orderId: req.params.id,
        companions,
        nowMs: Date.now(),
        fleetReservedRamMb,
      });
      return res.json({ ok: true, order });
    } catch (err) {
      return sendError(res, err, "Failed to update companions.", "SET COMPANIONS");
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
      if (order.status === "Draft" && order.config?.app && order.config?.slug) {
        await tenantSlugs.touchSlug(client, { slug: order.config.slug, webAccount: webAccountName, nowMs: Date.now() });
      }

      // Fails safe to false (never true) on error — the risk direction here
      // is showing an inappropriate term choice to an existing customer
      // (C5), the opposite of the renewal sweep's fail-safe-to-monthly.
      let eligibleForTermChoice = false;
      try {
        eligibleForTermChoice = await isEligibleForTermChoice(client, webAccountName, order.category);
      } catch (e) {
        console.warn("GET ORDER eligibility check failed, defaulting to false:", e.response?.data || e.message);
      }

      return res.json({ ok: true, order: { ...order, eligibleForTermChoice } });
    } catch (err) {
      return sendError(res, err, "Failed to fetch order.", "GET ORDER");
    }
  });

  // The questionnaire a new shop owner answers while the shop builds, and
  // their saved answers. The host applies them once the shop exists
  // (deploy/vps/bin/murzak-shop-setup); until then they are only stored.
  router.get("/api/orders/:id/shop-setup", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const order = await getOrder({ client: frappeClient(), webAccountName, orderId: req.params.id, nowMs: Date.now(), renew: false });
      if (order.status !== "Paid" || !order.config?.app) return res.status(409).json({ error: "Shop setup is available once your shop order is paid." });
      return res.json({ ok: true, ...shopSetup.catalogForClient(), setup: shopSetup.publicSetup(order.config) });
    } catch (err) {
      return sendError(res, err, "Failed to load shop setup.", "GET SHOP SETUP");
    }
  });

  router.put("/api/orders/:id/shop-setup", requireAuth, async (req, res) => {
    try {
      const webAccountName = webAccountOf(req);
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const client = frappeClient();
      const order = await getOrder({ client, webAccountName, orderId: req.params.id, nowMs: Date.now(), renew: false });
      const result = await shopSetup.saveShopSetup({ client, order, body: req.body, nowMs: Date.now() });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true, setup: result.setup });
    } catch (err) {
      return sendError(res, err, "Failed to save shop setup.", "SAVE SHOP SETUP");
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

      // Idempotent: already prepared. There is exactly one prepare-payment
      // call per order under this design — the checkout page defers this
      // call until any term choice is confirmed (see Checkout.tsx) — so a
      // repeat call here only ever happens on a retry/refresh, never a term
      // change. There is nothing left to re-apply; just return the invoice.
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

      // App orders: re-assert the shop-address hold BEFORE anything is
      // created. Idempotent for the same account (keeps invoice history,
      // renews expiry); if the name was lost meanwhile this fails 409 here,
      // not after a payable invoice already exists with no slug attached.
      if (order.config?.app && order.config?.slug) {
        try {
          await tenantSlugs.reserveSlug(client, {
            slug: order.config.slug, app: order.config.app, webAccount: webAccountName, orderId, nowMs,
          });
        } catch (e) {
          if (e.code && e.statusCode) {
            return res.status(e.statusCode).json({
              error: e.message,
              code: e.code,
              ...(e.code === "slug_taken" ? { suggestions: suggestSlugs(order.config.slug) } : {}),
            });
          }
          throw e;
        }
      }
      const planKey = record?.plan || "None";
      const hasPaidPlan = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);

      // Re-verify eligibility server-side — never trust the client for
      // whether annual is even on offer. A crafted request sending
      // billingTerm: "annual" for an ineligible order (an add-on, a domain,
      // a returning customer's purchase) is silently normalized back to
      // monthly. A customer with any paid plan already has a paid
      // Subscription invoice on file (some plan), so isEligibleForTermChoice
      // would also return false for them — skip the extra query in that
      // case rather than proving it twice.
      const eligible = hasPaidPlan
        ? false
        : await isEligibleForTermChoice(client, webAccountName, order.category);
      const bodyBillingTerm = (req.body || {}).billingTerm;
      const effectiveBillingTerm = eligible ? normalizeBillingTerm(bodyBillingTerm) : "monthly";

      // Domain-registration purchases carry the purchased domain string in
      // config.domain (see frontend Products.tsx's handleSelectDomain), NOT
      // config.domainChoice — that key is a different, pre-existing concept
      // reused by the hosting flow for "Bring My Domain" / "Use Murzak
      // Subdomain" / "Register New Domain". Route the right value into the
      // domainChoice field so it flows into the invoice + Web Account service
      // rows (buildInvoiceServiceRows / buildWebAccountServiceRows already
      // persist it) and from there into the staff provisioning notification.
      const isDomainProduct = order.category === "Domain Registration";
      const serviceRow = {
        serviceId: order.serviceId,
        serviceName: order.serviceName,
        tier: order.tier,
        domainChoice: isDomainProduct
          ? String(order.config?.domain || "").trim()
          : (order.config?.domainChoice || ""),
      };

      // One row per line: the primary, then each bundled companion. A domain
      // companion carries the domain string from its own config.domain, the
      // same convention a domain primary uses above.
      const companionRows = (Array.isArray(order.config?.bundle?.companions) ? order.config.bundle.companions : [])
        .map((c) => {
          const m = getServiceMeta(c.serviceId) || {};
          return {
            serviceId: c.serviceId,
            serviceName: m.name || c.serviceId,
            tier: m.tier || "",
            domainChoice: m.category === "Domain Registration"
              ? String(c.config?.domain || "").trim()
              : (c.config?.domainChoice || ""),
          };
        });
      const serviceRows = [serviceRow, ...companionRows];
      const bundleSavingKes = companionRows.length ? Number(order.bundleSavingKes) || 0 : 0;

      let invoiceDocName;
      // The amount the branch itself settled on (never read back from Frappe).
      let branchAmountKes = null;
      if (hasPaidPlan) {
        // Never eligible for a term choice (eligible is false whenever
        // hasPaidPlan is true) — createAddonInvoice's own pro-rata (via
        // getCurrentBillingTerm) is the sole amount authority here,
        // unaffected by effectiveBillingTerm.
        const result = await createAddonInvoice({
          client,
          webAccountName,
          services: serviceRows,
          // This order already quoted the buyer one specific total
          // (order.totalDueKes, shown on the checkout page). Adopting an
          // existing open invoice would recompute the amount across every row
          // on it — including services from checkouts this customer abandoned
          // — charging them a number they were never shown and activating the
          // abandoned service alongside. One order, one invoice.
          mergeIntoOpenInvoice: false,
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
        branchAmountKes = result.amountKes;

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
        const existingForAddon = normalizeExistingAccountServiceRows(asArray(acctForAddon?.[WEB_ACCOUNT_SERVICES_FIELD]));
        const mergedForAddon = mergeServicesById(existingForAddon, serviceRows);
        await updateWebAccountServices(client, webAccountName, buildWebAccountServiceRows(mergedForAddon));
      } else {
        // First purchase: apply the order's plan and bill it, then attach
        // the order's service to the account.
        //
        // The 4th arg MUST be an array of selected services — passing an
        // opts object here makes applyPlanAndCreateInvoice default
        // selectedServices to [], bill KES 0, and skip invoice creation
        // entirely (server.js's zero_amount early-return).
        const result = await applyPlanAndCreateInvoice(client, webAccountName, order.planKey || "Starter", serviceRows, {
          force: true,
          creditKes: 0,
        });
        if (!result?.invoice?.name) {
          const err = new Error("Failed to create an invoice for this order.");
          err.statusCode = 500;
          throw err;
        }
        invoiceDocName = result.invoice.name;
        branchAmountKes = result.invoice.amount;

        const acct = await fetchWebAccount(client, webAccountName);
        const existingServices = normalizeExistingAccountServiceRows(asArray(acct?.[WEB_ACCOUNT_SERVICES_FIELD]));
        const merged = mergeServicesById(existingServices, serviceRows);
        await updateWebAccountServices(client, webAccountName, buildWebAccountServiceRows(merged));

        // applyPlanAndCreateInvoice has no billing-term awareness — it
        // always bills the plain monthly sum. For a confirmed annual choice
        // on this first purchase, immediately correct the invoice it just
        // created to the annual-prepay amount and stamp its own
        // billing_term, within this same request — there is no later
        // correction step anywhere else in this design. Deliberately scoped
        // to ONLY this first-purchase branch: the hasPaidPlan branch above
        // already bills the correct annual amount via createAddonInvoice's
        // own pro-ration, and re-applying annualPrepayKes there would
        // 12x-overcharge an add-on.
        if (effectiveBillingTerm === "annual") {
          const monthlySumKes = sumSelectedServicesMonthlyKes(serviceRows);
          const annualAmountKes = annualPrepayKes(monthlySumKes);
          await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
            amount: annualAmountKes,
            billing_term: "annual",
          });
          branchAmountKes = annualAmountKes;
        }
      }

      // Bundle saving: applied last, after any annual correction, so both
      // compose. Reduces the amount the branch above already knows; it is never
      // read back, so a missing/partial read can never write a free invoice.
      if (bundleSavingKes > 0) {
        const known = Number(branchAmountKes);
        if (!Number.isFinite(known) || known <= 0) {
          const e = new Error("Could not determine the invoice amount for this bundle.");
          e.statusCode = 500;
          throw e;
        }
        await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
          amount: Math.max(0, known - bundleSavingKes),
        });
      }

      // Slug BEFORE order: once the order carries invoice_doc_name the early
      // "already prepared" return above skips this whole block on every retry, so
      // a failure between the two writes must never leave an invoiced order whose
      // slug was not linked (the paid job would then lose the buyer's address).
      // The reverse failure (slug linked, order not) is safe: a retry re-enters,
      // raises another invoice and appends it to the slug's history.
      if (order.config?.app && order.config?.slug) {
        await tenantSlugs.linkSlugInvoice(client, {
          slug: order.config.slug, webAccount: webAccountName, invoiceDocName, nowMs,
        });
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
