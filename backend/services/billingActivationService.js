
// services/billingActivationService.js
const { runProvisioningForInvoice } = require("./provisioning/provisioningService");
const { getServiceMeta } = require("./provisioning/catalog");
const { STATUS_SETTING_UP, STATUS_ACTIVE } = require("./provisioning/constants");

// Managed SaaS (premium: ERPNext/POS/CRM…) is configured by the team, so on
// payment it lands in "Setting up" until provisioning completes; light volume
// slices (hosting/email/storage) are effectively instant -> "Active".
function activatedStatusFor(serviceId) {
  return getServiceMeta(serviceId)?.capacityClass === "premium"
    ? STATUS_SETTING_UP
    : STATUS_ACTIVE;
}

function sqlNow(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// When a TRIAL verification invoice is paid, START the 36h trial: flip the
// linked Test Plan Invoice to Active and stamp trial_start / trial_end.
// Best-effort + idempotent (skips if already Active); never throws.
async function activateTrialIfApplicable(client, inv, webAccountName) {
  const isTrial =
    String(inv?.type || "").toLowerCase().includes("trial") || inv?.plan === "Test";
  if (!isTrial) return;
  try {
    const tp = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["status", "in", ["New", "Trial Pending", "Active"]],
        ]),
        fields: JSON.stringify(["name", "trial_hours", "status"]),
        limit_page_length: 1,
        order_by: "modified desc",
      },
    });
    const trial = tp.data?.data?.[0];
    if (!trial?.name) return;
    if (String(trial.status || "").toLowerCase() === "active") return; // idempotent
    const hours = Number(trial.trial_hours) > 0 ? Number(trial.trial_hours) : 36;
    const start = new Date();
    const end = new Date(start.getTime() + hours * 3600 * 1000);
    await client.put(`/api/resource/Test Plan Invoice/${encodeURIComponent(trial.name)}`, {
      status: "Active",
      trial_start: sqlNow(start),
      trial_end: sqlNow(end),
    });
  } catch (e) {
    console.warn("TRIAL ACTIVATION WARN:", e.response?.data || e.message);
  }
}

async function activateServicesForInvoice({
  req,
  frappeClient,
  invoiceDocName,
  // SECURITY GATE: only a server-side verified payment rail (PayPal capture,
  // M-Pesa STK callback) may pass paymentVerified:true. Any other caller — most
  // importantly the public POST /api/billing/activate-services endpoint — leaves
  // this false, in which case we REFUSE to transition an unpaid invoice to Paid.
  // Without this, any authenticated user could activate their own services for
  // free by calling activate-services on an unpaid invoice.
  paymentVerified = false,
  PORTAL_INVOICE_SERVICES_FIELD,
  CHILD_SERVICE_ID_FIELD,
  WEB_ACCOUNT_SERVICES_FIELD,
  CHILD_STATUS_FIELD,
  fetchInvoicesForUser,
  fetchSelectedServicesForUser,
  buildUserPayload,
}) {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  if (!webAccountName) {
    const err = new Error("No session account.");
    err.statusCode = 401;
    throw err;
  }

  if (!invoiceDocName) {
    const err = new Error("Missing invoiceDocName.");
    err.statusCode = 400;
    throw err;
  }

  const client = frappeClient();

  const invRes = await client.get(
    `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`
  );
  const inv = invRes.data?.data;
  if (!inv) {
    const err = new Error("Invoice not found.");
    err.statusCode = 404;
    throw err;
  }

  if (inv.web_account !== webAccountName) {
    const err = new Error("Invoice not yours user.");
    err.statusCode = 403;
    throw err;
  }

  const alreadyPaid = String(inv.status || "").trim().toLowerCase() === "paid";

  // Untrusted callers may only (re)sync services for an invoice a verified rail
  // has ALREADY marked Paid. They can never themselves flip Unpaid -> Paid.
  if (!paymentVerified && !alreadyPaid) {
    const err = new Error(
      "Invoice is not paid. Complete payment before activating services."
    );
    err.statusCode = 402;
    throw err;
  }

  // Only a verified rail transitions the invoice to Paid; if it's already Paid
  // this is a no-op resync, so skip the redundant write.
  if (!alreadyPaid) {
    await client.put(
      `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`,
      {
        status: "Paid",
      }
    );
  }

  const invServices = Array.isArray(inv?.[PORTAL_INVOICE_SERVICES_FIELD])
    ? inv[PORTAL_INVOICE_SERVICES_FIELD]
    : [];

  const invoiceServiceIds = invServices
    .map((s) => s?.[CHILD_SERVICE_ID_FIELD])
    .filter(Boolean);

  const accRes = await client.get(
    `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`
  );
  const account = accRes.data?.data || {};
  const rows = Array.isArray(account[WEB_ACCOUNT_SERVICES_FIELD])
    ? account[WEB_ACCOUNT_SERVICES_FIELD]
    : [];

  const updatedRows = rows.map((r) => {
    const sid = r[CHILD_SERVICE_ID_FIELD];
    if (invoiceServiceIds.includes(sid)) {
      return { ...r, [CHILD_STATUS_FIELD]: activatedStatusFor(sid) };
    }
    return r;
  });

  await client.put(
    `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`,
    {
      [WEB_ACCOUNT_SERVICES_FIELD]: updatedRows,
      account_status: "Active",
    }
  );

  // Provisioning (Phase 0): record a queued job per newly-active service and
  // notify staff. Best-effort — runProvisioningForInvoice never throws, so a
  // provisioning hiccup can never roll back an already-paid invoice.
  const provisioning = await runProvisioningForInvoice({
    client,
    webAccount: webAccountName,
    invoiceDocName,
    serviceIds: invoiceServiceIds,
  });
  if (provisioning && provisioning.ok === false) {
    console.error(
      `[provisioning] invoice ${invoiceDocName} provisioning step reported an error: ${provisioning.error}`
    );
  }

  // If this was the trial's KES-1 verification, start the 36h clock now.
  await activateTrialIfApplicable(client, inv, webAccountName);

  const invoices = await fetchInvoicesForUser(client, webAccountName);
  const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
  const rec = (
    await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`)
  ).data?.data;

  const userPayload = buildUserPayload({
    record: rec,
    invoices,
    selectedServices,
  });

  req.session.user = userPayload;

  return { ok: true, user: userPayload };
}

module.exports = { activateServicesForInvoice };
