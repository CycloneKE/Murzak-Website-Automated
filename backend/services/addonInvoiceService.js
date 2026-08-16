// services/addonInvoiceService.js
//
// Add-on invoice creation, extracted from the /api/addons/invoice/create
// handler so order prepare-payment (ordersRoutes) can reuse it. All pricing
// comes from the catalog snapshot; PLAN_NOT_PAID / eligibility / capacity
// gates are preserved exactly.

const { getServiceMeta, sumSelectedServicesMonthlyKes } = require("./provisioning/catalog");
const {
  isAddonEligible,
  accountHasNonDomainPaidService,
  invoiceRowsIncludeNonDomainService,
} = require("./addonEligibility");
const { assertOrderWithinCapacity } = require("./orderCapacity");
const { daysRemainingInTerm, proRatedAddonKes } = require("./billingTerm");
const { getCurrentBillingTerm } = require("./checkoutBillingTerm");

// Web Account child-table field names, used only to read the tenant's
// EXISTING services for the capacity guard below. Copied from their
// server.js values — attaching the new add-on to the Web Account itself
// stays the caller's responsibility (it's an HTTP-session-adjacent concern,
// not part of pricing/invoicing).
const WEB_ACCOUNT_SERVICES_FIELD = "selected_services";
const CHILD_SERVICE_ID_FIELD = "service_id";
const CHILD_STATUS_FIELD = "status";

// Portal Invoice types that represent REAL money paid for something — used
// by the FIX ROUND 3 invoice-line fallback below. Deliberately excludes
// "Trial Verification": TRIAL_SANDBOX_SERVICE_ID defaults to
// test-erpnext-demo (category "ERP Hosting"), and a paid KES-1 trial
// verification is not evidence the customer owns real infrastructure.
const PAID_BILLING_INVOICE_TYPES = ["Subscription", "Add-on"];
// How many of the account's most-recent Paid invoices to scan before giving
// up. Running out of budget is NOT evidence of absence — see
// accountHasPaidNonDomainInvoiceLine's null return.
const PAID_INVOICE_SCAN_LIMIT = 12;

const asArray = (v) => (Array.isArray(v) ? v : []);

// Mirrors ONLY the "is this parseable at all" half of billingTerm.js's
// daysRemainingInTerm — used to tell "the account's anchor date (the last
// paid annual invoice's invoice_date) is missing/garbage" (corrupted invoice
// data) apart from "the anchor date is a valid date that simply lands on or
// past the term's last day" (a legitimate, if unusual, zero). Does NOT
// duplicate the days-remaining math itself, and does not change
// daysRemainingInTerm's own fail-safe contract — see FIX ROUND 1.
function hasParsableTermStart(anchorDate) {
  if (!anchorDate) return false;
  const iso = String(anchorDate).slice(0, 10);
  return Number.isFinite(Date.parse(`${iso}T00:00:00Z`));
}

// A corrupted annual account (billing_term: "annual" but a missing or
// unparseable last paid invoice's invoice_date (anchorDate)) makes
// daysRemainingInTerm fail safe to 0 (its documented, deliberate behavior —
// see billingTerm.js), which pro-rates every add-on down to KES 0 regardless
// of its real catalog price. Nothing downstream of this call site was
// catching that free invoice, so guard it HERE rather than loosening the
// helper's contract (other callers, e.g. the renewal sweep, may depend on
// the 0 fail-safe as-is).
//
// Fires ONLY when: the account is on an annual term, EVERY service being
// billed is a real catalog item with a positive monthly price (so this is
// never mistaken for a legitimately-unpriced/unknown service), the computed
// total is exactly 0, AND the last paid invoice's invoice_date (anchorDate)
// itself is missing/unparseable — genuinely anomalous invoice data.
// Deliberately does NOT fire when the last paid invoice's invoice_date
// (anchorDate) is a valid date that just happens to put daysRemainingInTerm
// at 0 (term's last day, or an already-elapsed term awaiting renewal) —
// that 0 is a real, legitimate amount.
function assertNotFreeAnnualAddonInvoice({ term, amount, anchorDate, serviceRows }) {
  if (term !== "annual" || amount !== 0) return;
  if (hasParsableTermStart(anchorDate)) return;

  const rows = asArray(serviceRows).filter((s) => s?.serviceId);
  const allRowsArePriced =
    rows.length > 0 &&
    rows.every((s) => Number(getServiceMeta(s.serviceId)?.monthlyKes) > 0);
  if (!allRowsArePriced) return;

  const err = new Error(
    "Cannot invoice add-on(s): the account's last paid annual invoice has a missing or invalid invoice_date, which would otherwise produce a KES 0 invoice for a real service."
  );
  err.statusCode = 422;
  err.code = "CORRUPTED_ANNUAL_TERM";
  throw err;
}

/**
 * FIX ROUND 3, second signal: does this account have a PAID invoice
 * (Subscription or Add-on, never Trial Verification) carrying a non-domain
 * service line? Independent of both `hasPaidSubscriptionForPlan` (order-
 * routing — must never be repurposed, see addonEligibility.js's module
 * docblock) and of the Web Account's `selected_services` statuses (which a
 * lossy client-input round-trip, or a service id that later drifted out of
 * the catalog snapshot, can silently misrepresent).
 *
 * Scans the account's most recent Paid invoices, newest first, stopping at
 * the first non-domain line. Only fetches invoice line items — never
 * touches or trusts the invoice's OWN service-row status, since add-on
 * lines are written "Awaiting Payment" and never flipped; it's the invoice
 * being Paid that is the fact of record.
 *
 * @returns {Promise<boolean|null>} true = found real paid infra; false =
 *   scanned every paid invoice and found none; null = COULD NOT DETERMINE
 *   (scan budget exhausted, or a Frappe call failed) — the caller MUST
 *   treat null as fail-open, never as false.
 */
async function accountHasPaidNonDomainInvoiceLine({
  client,
  webAccountName,
  invoiceServicesField = "selected_services",
  childServiceIdField = CHILD_SERVICE_ID_FIELD,
  scanLimit = PAID_INVOICE_SCAN_LIMIT,
}) {
  let names;
  try {
    const listRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["status", "=", "Paid"],
          ["type", "in", PAID_BILLING_INVOICE_TYPES],
        ]),
        fields: JSON.stringify(["name"]),
        order_by: "creation desc",
        limit_page_length: scanLimit,
      },
    });
    names = asArray(listRes.data?.data).map((r) => r?.name).filter(Boolean);
  } catch (e) {
    console.warn(`[addon-gate] paid-invoice list scan failed for ${webAccountName}: ${e.message}`);
    return null;
  }

  for (const name of names) {
    try {
      const docRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(name)}`);
      const rows = asArray(docRes.data?.data?.[invoiceServicesField]);
      if (invoiceRowsIncludeNonDomainService(rows, childServiceIdField)) return true;
    } catch (e) {
      console.warn(`[addon-gate] paid-invoice line fetch failed for ${webAccountName}/${name}: ${e.message}`);
      return null;
    }
  }

  // Exhausted the scan budget without a hit — undetermined, not "no history".
  if (names.length >= scanLimit) return null;
  return false;
}

/**
 * The single "does this account own real (non-domain) infrastructure?"
 * answer the add-on gate needs. Union of the free account-row check and the
 * paid-invoice fallback; fails OPEN on any undetermined result.
 *
 * @returns {Promise<boolean>}
 */
async function resolveNonDomainPaidHistory({ client, webAccountName, accountServiceRows, ...rest }) {
  if (accountHasNonDomainPaidService(accountServiceRows)) return true; // free — no query
  const fromInvoices = await accountHasPaidNonDomainInvoiceLine({ client, webAccountName, ...rest });
  if (fromInvoices === null) {
    console.warn(`[addon-gate] could not verify paid non-domain history for ${webAccountName} — failing open`);
    return true;
  }
  return fromInvoices;
}

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

  // Does this account own any actually-paid NON-domain service already?
  // First check is free (reuses the Web Account record already fetched
  // above); the paid-invoice fallback below only ever runs if that comes up
  // empty AND a non-domain add-on is actually in this order — see
  // resolveNonDomainPaidHistory / accountHasPaidNonDomainInvoiceLine above,
  // and addonEligibility.js's module docblock ("Fix round 2" / "Fix round
  // 3") for why neither signal may be conflated with
  // `hasPaidSubscriptionForPlan`'s Subscription-invoice-existence check.
  const existingServiceRows = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD]).map((r) => ({
    serviceId: r?.[CHILD_SERVICE_ID_FIELD],
    status: r?.[CHILD_STATUS_FIELD],
  }));
  // Resolved at most once, and only if actually needed — a domain-only
  // account buying another domain must keep its exact current Frappe call
  // count (FIX ROUND 2 Requirement 2), and a real hosting customer never
  // triggers the fallback at all (Requirement 3).
  let cachedNonDomainHistory;
  const nonDomainPaidHistory = async () => {
    if (cachedNonDomainHistory === undefined) {
      cachedNonDomainHistory = await resolveNonDomainPaidHistory({
        client,
        webAccountName,
        accountServiceRows: existingServiceRows,
        invoiceServicesField: PORTAL_INVOICE_SERVICES_FIELD,
        childServiceIdField: CHILD_SERVICE_ID_FIELD,
      });
    }
    return cachedNonDomainHistory;
  };

  // Every add-on must be a real, priced catalog service — no fabricated
  // pricing for something not in the catalog snapshot. Also enforce
  // eligibility per-service (volume-class is plan-agnostic; premium-class
  // must match the customer's plan tier; non-domain add-ons additionally
  // require hasNonDomainPaidHistory — see isAddonEligible).
  for (const s of norm) {
    const meta = getServiceMeta(s.serviceId);
    if (!meta || !(Number(meta.monthlyKes) > 0)) {
      const err = new Error(`Add-on pricing not configured for service: ${s.serviceId}`);
      err.statusCode = 400;
      throw err;
    }
    // A domain add-on never needs the history flag (isAddonEligible
    // short-circuits on category before reading it) — pass true explicitly
    // so buying a domain never triggers the paid-invoice scan.
    const hasNonDomainPaidHistory =
      meta.category === "Domain Registration" ? true : await nonDomainPaidHistory();
    const elig = isAddonEligible({ planKey, service: meta, hasNonDomainPaidHistory });
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
  //
  // Annual-term accounts pay each add-on's ANNUAL price pro-rated to the days
  // left in their current term, so the whole account keeps renewing on one
  // anniversary. Monthly-term accounts — and every legacy account with no
  // billing_term — are billed the monthly sum exactly as before.
  const monthlySum = sumSelectedServicesMonthlyKes(norm);
  const { term, anchorDate } = await getCurrentBillingTerm(client, webAccountName);
  const amount =
    term === "annual"
      ? norm.reduce((total, s) => {
          const meta = getServiceMeta(s.serviceId);
          return (
            total +
            proRatedAddonKes(Number(meta?.monthlyKes) || 0, daysRemainingInTerm(anchorDate))
          );
        }, 0)
      : monthlySum;

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

    // For open unpaid add-on invoice, all rows are chargeable add-ons.
    // Same annual pro-ration as the fresh-invoice path above — otherwise an
    // annual account whose second add-on merges into an open invoice would
    // silently revert to monthly pricing.
    const mergedAmount =
      term === "annual"
        ? mergedServices.reduce((total, s) => {
            const meta = getServiceMeta(s.serviceId);
            return (
              total +
              proRatedAddonKes(Number(meta?.monthlyKes) || 0, daysRemainingInTerm(anchorDate))
            );
          }, 0)
        : sumSelectedServicesMonthlyKes(mergedServices);

    assertNotFreeAnnualAddonInvoice({ term, amount: mergedAmount, anchorDate, serviceRows: mergedServices });

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
    assertNotFreeAnnualAddonInvoice({ term, amount, anchorDate, serviceRows: norm });

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

module.exports = {
  createAddonInvoice,
  resolveNonDomainPaidHistory,
  accountHasPaidNonDomainInvoiceLine,
  PAID_BILLING_INVOICE_TYPES,
  PAID_INVOICE_SCAN_LIMIT,
};
