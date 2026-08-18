/**
 * Hosting Site lifecycle + its activity log — extracted from server.js so it
 * is importable (and testable) without booting Express.
 *
 * EVENT_TYPES is the live Select vocabulary of the "Hosting Activity Log"
 * doctype's `event_type` field, confirmed 2026-08-18 via
 * GET /api/resource/DocType/Hosting Activity Log against production Frappe.
 * It is exactly these seven values — nothing else. MOCK_FRAPPE accepts any
 * string, so a literal that drifts from this list passes locally and then
 * 417s in production the first time a real customer hits it (as
 * "site_initialized" and "site_activated" did here). Anywhere in the
 * codebase that writes event_type must use a member of EVENT_TYPES, not a
 * hand-typed string — see test/hostingActivityLog.test.js, which scans the
 * whole backend for event_type/eventType literals and fails the build if
 * one isn't in this list.
 */

const EVENT_TYPES = Object.freeze({
  DOMAIN_CONNECTED: "domain_connected",
  SUBDOMAIN_CREATED: "subdomain_created",
  FILE_UPLOADED: "file_uploaded",
  DEPLOYMENT_REQUESTED: "deployment_requested",
  DEPLOYMENT_COMPLETED: "deployment_completed",
  SSL_ENABLED: "ssl_enabled",
  SUPPORT_REQUEST_OPENED: "support_request_opened",
});

const EVENT_TYPE_VALUES = Object.freeze(Object.values(EVENT_TYPES));

async function createHostingActivityLog(client, {
  webAccountName,
  serviceId,
  hostingSiteName,
  eventType,
  title,
  description = "",
}) {
  if (!hostingSiteName) return null;

  return client.post("/api/resource/Hosting Activity Log", {
    web_account: webAccountName,
    service_id: serviceId,
    hosting_site: hostingSiteName,
    event_type: eventType,
    title,
    description,
  });
}

async function findExistingHostingSiteByHost(client, { webAccountName, serviceId, primaryHost }) {
  const res = await client.get("/api/resource/Hosting Site", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", serviceId],
        ["primary_host", "=", primaryHost],
      ]),
      fields: JSON.stringify([
        "name",
        "primary_host",
        "customer_domain",
        "status",
        "site_type",
      ]),
      limit_page_length: 1,
      order_by: "creation desc",
    },
  });

  return res.data?.data?.[0] || null;
}

async function ensurePendingHostingSiteForRequest(client, {
  webAccountName,
  serviceId,
  siteType,
  primaryHost,
  serviceTier,
  planName,
  // The Customer Domain this site serves. primary_host stays as a
  // denormalized copy so existing reads and provisioning are undisturbed, but
  // this link is what actually ties a site to a domain the account owns.
  customerDomainId = "",
  notes = "",
  // Storage allocation is a shared pricing/tier heuristic that also backs
  // ensureHostingSiteStorageAllocation elsewhere in server.js — injected
  // rather than duplicated here so the two can't drift.
  getStorageAllocationMb,
}) {
  const existing = await findExistingHostingSiteByHost(client, { webAccountName, serviceId, primaryHost });
  if (existing) {
    // Backfill the link on sites created before domains were account-owned,
    // so an existing customer's site picks it up on their next request
    // instead of staying orphaned forever.
    if (customerDomainId && !existing.customer_domain) {
      try {
        await client.put(`/api/resource/Hosting Site/${encodeURIComponent(existing.name)}`, {
          customer_domain: customerDomainId,
        });
      } catch (e) {
        console.warn("HOSTING SITE DOMAIN LINK WARN:", e.response?.data || e.message);
      }
    }
    return existing;
  }

  const resolvedStorageLimitMb = getStorageAllocationMb({
    tier: serviceTier || "",
    planName: planName || "",
  });

  const created = await client.post("/api/resource/Hosting Site", {
    web_account: webAccountName,
    service_id: serviceId,
    site_type: siteType,
    primary_host: primaryHost,
    customer_domain: customerDomainId || "",
    status: "pending",
    plan_name: planName || "Website Hosting",
    tier: serviceTier || "Starter",
    storage_limit_mb: resolvedStorageLimitMb,
    storage_used_mb: 0,
    ssl_status: "pending",
    document_root: "",
    notes: String(notes || "").trim(),
  });

  const siteName = created.data?.data?.name;

  await createHostingActivityLog(client, {
    webAccountName,
    serviceId,
    hostingSiteName: siteName,
    eventType: EVENT_TYPES.DEPLOYMENT_REQUESTED,
    title: "Hosting site initialized",
    description: `${primaryHost} created in pending state awaiting provisioning.`,
  });

  return created.data?.data || null;
}

async function activateHostingSite(client, {
  webAccountName,
  serviceId,
  hostingSiteName,
  primaryHost,
  documentRoot,
  sslStatus = "active",
  notes = "",
}) {
  await client.put(`/api/resource/Hosting Site/${encodeURIComponent(hostingSiteName)}`, {
    primary_host: String(primaryHost || "").trim().toLowerCase(),
    document_root: String(documentRoot || "").trim(),
    status: "active",
    ssl_status: String(sslStatus || "active").trim().toLowerCase(),
    notes: String(notes || "").trim(),
  });

  await createHostingActivityLog(client, {
    webAccountName,
    serviceId,
    hostingSiteName,
    eventType: EVENT_TYPES.DEPLOYMENT_COMPLETED,
    title: "Hosting site activated",
    description: `${primaryHost} is now live on hosting.`,
  });

  return true;
}

module.exports = {
  EVENT_TYPES,
  EVENT_TYPE_VALUES,
  createHostingActivityLog,
  findExistingHostingSiteByHost,
  ensurePendingHostingSiteForRequest,
  activateHostingSite,
};
