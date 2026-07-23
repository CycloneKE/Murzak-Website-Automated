// services/addonInvoiceService.js
//
// Add-on invoice creation, extracted from the /api/addons/invoice/create
// handler so order prepare-payment (ordersRoutes) can reuse it. All pricing
// comes from the catalog snapshot; PLAN_NOT_PAID / eligibility / capacity
// gates are preserved exactly.

const { getServiceMeta, sumSelectedServicesMonthlyKes } = require("./provisioning/catalog");
const { isAddonEligible } = require("./addonEligibility");
const { assertOrderWithinCapacity } = require("./orderCapacity");

// Web Account child-table field names, used only to read the tenant's
// EXISTING services for the capacity guard below. Copied from their
// server.js values — attaching the new add-on to the Web Account itself
// stays the caller's responsibility (it's an HTTP-session-adjacent concern,
// not part of pricing/invoicing).
const WEB_ACCOUNT_SERVICES_FIELD = "selected_services";
const CHILD_SERVICE_ID_FIELD = "service_id";

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Creates or merges an unpaid Add-on Portal Invoice. Throws err.statusCode
 * (400/403/422) on validation failure. `deps` carries the server.js helpers:
 * { fetchWebAccount, hasPaidSubscriptionForPlan, normalizeSelectedServices,
 *   findOpenInvoice, normalizeInvoiceServiceRow, buildInvoiceServiceRows,
 *   PORTAL_INVOICE_SERVICES_FIELD }
 *
 * @returns {Promise<{invoiceDocName: string, amountKes: number}>}
 */
async function createAddonInvoice({ client, webAccountName, services, deps }) {
  const {
    fetchWebAccount, hasPaidSubscriptionForPlan, normalizeSelectedServices,
    findOpenInvoice, normalizeInvoiceServiceRow, buildInvoiceServiceRows,
    PORTAL_INVOICE_SERVICES_FIELD,
  } = deps;

  if (!Array.isArray(services) || services.length === 0) {
    const err = new Error("No add-on services selected.");
    err.statusCode = 400;
    throw err;
  }

  const record = await fetchWebAccount(client, webAccountName);
  const planKey = record?.plan || "None";

  // Block add-ons if plan not paid
  const paid = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);
  if (!paid) {
    const err = new Error("Pay your subscription plan first before purchasing add-ons.");
    err.statusCode = 403;
    err.code = "PLAN_NOT_PAID";
    throw err;
  }

  const norm = normalizeSelectedServices(services);
  if (norm.length === 0) {
    const err = new Error("No add-on services selected.");
    err.statusCode = 400;
    throw err;
  }

  // Every add-on must be a real, priced catalog service — no fabricated
  // pricing for something not in the catalog snapshot. Also enforce
  // eligibility per-service (volume-class is plan-agnostic; premium-class
  // must match the customer's plan tier).
  for (const s of norm) {
    const meta = getServiceMeta(s.serviceId);
    if (!meta || !(Number(meta.monthlyKes) > 0)) {
      const err = new Error(`Add-on pricing not configured for service: ${s.serviceId}`);
      err.statusCode = 400;
      throw err;
    }
    const elig = isAddonEligible({ planKey, service: meta });
    if (!elig.ok) {
      const err = new Error(elig.error);
      err.statusCode = 400;
      throw err;
    }
  }

  // Capacity guard: an add-on adds to what the tenant already runs, so check
  // the EXISTING active services + the new order — not the order alone — or a
  // tenant could split an over-capacity build across two requests.
  const existingSelection = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD])
    .map((r) => ({ serviceId: r?.[CHILD_SERVICE_ID_FIELD] }))
    .filter((s) => s.serviceId);
  assertOrderWithinCapacity([...existingSelection, ...norm]);

  // Add-ons are always priced à la carte — there are no free plan-included
  // slots (matches the configurator/checkout, which never offers a free
  // service). The per-service pricing check above guarantees this is > 0.
  const amount = sumSelectedServicesMonthlyKes(norm);

  const today = new Date().toISOString().slice(0, 10);

  // Find any open unpaid add-on invoice
  const open = await findOpenInvoice(client, webAccountName, "Add-on");

  let createdInvoiceId = null;
  let invoiceAmountKes = amount;

  if (open?.name && String(open.status || "").toLowerCase() !== "paid") {
    // Read the full current invoice and merge, not replace
    const openRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`);
    const openInvoice = openRes.data?.data || {};

    const existingInvoiceRows = Array.isArray(openInvoice?.[PORTAL_INVOICE_SERVICES_FIELD])
      ? openInvoice[PORTAL_INVOICE_SERVICES_FIELD]
      : [];

    const existingServices = existingInvoiceRows
      .map(normalizeInvoiceServiceRow)
      .filter((s) => !!s.serviceId)
      .filter((s) => String(s.status || "").toLowerCase() !== "paid");

    // Merge old unpaid invoice services with new selections
    const mergedMap = new Map();

    existingServices.forEach((s) => {
      mergedMap.set(s.serviceId, {
        ...s,
        status: s.status || "Awaiting Payment",
      });
    });

    norm.forEach((s) => {
      if (!s.serviceId) return;

      // preserve existing row if already there; otherwise add new one
      if (!mergedMap.has(s.serviceId)) {
        mergedMap.set(s.serviceId, {
          serviceId: s.serviceId,
          serviceName: s.serviceName || "",
          tier: s.tier || "",
          domainChoice: s.domainChoice || "",
          status: "Awaiting Payment",
        });
      }
    });

    const mergedServices = Array.from(mergedMap.values());

    // For open unpaid add-on invoice, all rows are chargeable add-ons
    const mergedAmount = sumSelectedServicesMonthlyKes(mergedServices);

    const mergedRows = buildInvoiceServiceRows(
      mergedServices.map((s) => ({
        ...s,
        status: "Awaiting Payment",
      }))
    );

    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`, {
      type: "Add-on",
      plan: planKey,
      amount: mergedAmount,
      invoice_date: today,
      status: open.status || "Unpaid",
      [PORTAL_INVOICE_SERVICES_FIELD]: mergedRows,
    });
    createdInvoiceId = open.name;
    invoiceAmountKes = mergedAmount;
  } else {
    const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const clientName = accRes.data?.data?.account_holder_name || "";

    const rows = buildInvoiceServiceRows(
      norm.map((s) => ({
        ...s,
        status: "Awaiting Payment",
      }))
    );

    const created = await client.post("/api/resource/Portal Invoice", {
      web_account: webAccountName,
      client_name: clientName,
      invoice_no: `ADD-${Date.now()}`,
      type: "Add-on",
      plan: planKey,
      amount,
      status: "Unpaid",
      invoice_date: today,
      [PORTAL_INVOICE_SERVICES_FIELD]: rows,
    });
    createdInvoiceId = created.data?.data?.name || null;
    invoiceAmountKes = amount;
  }

  return { invoiceDocName: createdInvoiceId, amountKes: invoiceAmountKes };
}

module.exports = { createAddonInvoice };
