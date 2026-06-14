
// services/billingActivationService.js
const { runProvisioningForInvoice } = require("./provisioning/provisioningService");

async function activateServicesForInvoice({
  req,
  frappeClient,
  invoiceDocName,
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

  await client.put(
    `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`,
    {
      status: "Paid",
    }
  );

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
      return { ...r, [CHILD_STATUS_FIELD]: "Active" };
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
