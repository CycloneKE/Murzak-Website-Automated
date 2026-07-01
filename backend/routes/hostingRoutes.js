
const express = require('express');

module.exports = function(ctx) {
  const { 
    HOSTING_SERVICE_ID,
    buildHostingAbsolutePath,
    buildHostingRelativePath,
    buildHostingUploadDir,
    computeIncludedDomainEntitlement,
    ensureHostingSiteStorageAllocation,
    ensurePendingHostingSiteForRequest,
    ensureSafeFileName,
    ensureUserOwnsHostingService,
    fetchHostingActivity,
    fetchHostingDeployments,
    fetchHostingDomainPurchaseRequests,
    fetchHostingDomainRequests,
    fetchHostingDomains,
    fetchHostingExternalDomains,
    fetchHostingFiles,
    fetchHostingMurzakSubdomains,
    fetchHostingSite,
    fetchHostingSubdomains,
    fetchHostingSupportRequests,
    frappeClient,
    fsp,
    getActiveHostingServiceForUser,
    path,
    recalculateHostingStorageUsage,
    requireAuth,
    upload 
  } = ctx;

  const router = express.Router();

router.get("/api/hosting/dashboard", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    const site = await fetchHostingSite(client, webAccountName);
    const activeSite = await fetchHostingSite(client, webAccountName);
    const registerNewDomainRequests = await fetchHostingDomainPurchaseRequests(client, webAccountName);
    const murzakSubdomains = await fetchHostingMurzakSubdomains(client, webAccountName);
    const externalDomains = await fetchHostingExternalDomains(client, webAccountName);
    const requests = await fetchHostingSupportRequests(client, webAccountName);
    let files = [];
    let deployments = [];
    let activity = [];
    if (activeSite?.id) {
      await recalculateHostingStorageUsage(client, activeSite.id);
      await ensureHostingSiteStorageAllocation(client, activeSite.id, {
        tier: activeSite.tier || svc.tier || "",
        planName: activeSite.planName || svc.serviceName || ""
      });
      await recalculateHostingStorageUsage(client, activeSite.id);
      const refreshedSite = await fetchHostingSite(client, webAccountName);
      files = await fetchHostingFiles(client, webAccountName, activeSite.id);
      deployments = await fetchHostingDeployments(client, webAccountName, activeSite.id);
      activity = await fetchHostingActivity(client, webAccountName, activeSite.id);
      return res.json({
        ok: true,
        payload: {
          service: {
            serviceId: svc.serviceId,
            serviceName: svc.serviceName || "Website Hosting",
            tier: svc.tier || "Medium",
            status: "active",
            domainChoice: svc.domainChoice || null
          },
          hostingStatus: refreshedSite?.status || "pending",
          activeSite: refreshedSite,
          registerNewDomainRequests,
          murzakSubdomains: await fetchHostingSubdomains(client, webAccountName, activeSite.id),
          externalDomains,
          requests,
          files,
          deployments,
          activity
        }
      });
    }
    return res.json({
      ok: true,
      payload: {
        service: {
          serviceId: svc.serviceId,
          serviceName: svc.serviceName || "Website Hosting",
          tier: svc.tier || "Medium",
          status: "active",
          domainChoice: svc.domainChoice || null
        },
        hostingStatus: site?.status || "pending",
        activeSite: site,
        registerNewDomainRequests,
        murzakSubdomains,
        externalDomains,
        requests,
        files: [],
        deployments: [],
        activity: []
      }
    });
  } catch (err) {
    console.error("HOSTING DASHBOARD ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to load hosting dashboard."
    });
  }
});

router.post("/api/hosting/domain-purchase-requests", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      requestedName,
      requestedTld,
      notes
    } = req.body || {};
    const cleanName = String(requestedName || "").trim().toLowerCase();
    const cleanTld = String(requestedTld || "").trim().toLowerCase();
    const fullDomain = `${cleanName}${cleanTld}`;
    if (!cleanName) return res.status(400).json({
      error: "Domain name is required."
    });
    if (!cleanTld.startsWith(".")) return res.status(400).json({
      error: "Invalid TLD."
    });
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    if (String(svc.domainChoice || "").trim() !== "Register New Domain") {
      return res.status(400).json({
        error: "Your hosting service is not configured for Register New Domain."
      });
    }
    const created = await client.post("/api/resource/Hosting Domain Purchase Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_name: cleanName,
      requested_tld: cleanTld,
      full_domain: fullDomain,
      status: "pending",
      // White-label: never store/surface the upstream registrar name to customers.
      provider: "Murzak Cloud",
      notes: String(notes || "").trim(),
      is_primary: 1
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "domain",
      primaryHost: fullDomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for domain purchase request: ${fullDomain}`
    });
    return res.json({
      ok: true,
      request: created.data?.data || null
    });
  } catch (err) {
    console.error("DOMAIN PURCHASE REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit domain request."
    });
  }
});

router.post("/api/hosting/murzak-subdomains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      requestedLabel,
      targetType,
      targetValue,
      notes
    } = req.body || {};
    const cleanLabel = String(requestedLabel || "").trim().toLowerCase();
    if (!cleanLabel) return res.status(400).json({
      error: "Subdomain label is required."
    });
    const fullSubdomain = `${cleanLabel}.murzaktech.com`;
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    if (String(svc.domainChoice || "").trim() !== "Use Murzak Subdomain") {
      return res.status(400).json({
        error: "Your hosting service is not configured for Use Murzak Subdomain."
      });
    }
    const created = await client.post("/api/resource/Hosting Murzak Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_label: cleanLabel,
      full_subdomain: fullSubdomain,
      status: "pending",
      target_type: String(targetType || "folder").trim(),
      target_value: String(targetValue || "").trim(),
      notes: String(notes || "").trim(),
      is_primary: 1
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "murzak_subdomain",
      primaryHost: fullSubdomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for Murzak subdomain request: ${fullSubdomain}`
    });
    return res.json({
      ok: true,
      subdomain: created.data?.data || null
    });
  } catch (err) {
    console.error("MURZAK SUBDOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit subdomain request."
    });
  }
});

router.post("/api/hosting/external-domains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      domainName,
      registrar,
      notes
    } = req.body || {};
    const cleanDomain = String(domainName || "").trim().toLowerCase();
    if (!cleanDomain) return res.status(400).json({
      error: "Domain name is required."
    });
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    if (String(svc.domainChoice || "").trim() !== "Bring My Domain") {
      return res.status(400).json({
        error: "Your hosting service is not configured for Bring My Domain."
      });
    }
    const created = await client.post("/api/resource/Hosting External Domain Connection", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      domain_name: cleanDomain,
      registrar: String(registrar || "").trim(),
      status: "pending",
      verification_notes: String(notes || "").trim(),
      is_primary: 1
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "external_domain",
      primaryHost: cleanDomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for external domain connection: ${cleanDomain}`
    });
    return res.json({
      ok: true,
      externalDomain: created.data?.data || null
    });
  } catch (err) {
    console.error("EXTERNAL DOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit domain connection request."
    });
  }
});

router.post("/api/hosting/subdomains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      subdomainLabel,
      parentHost,
      targetType,
      targetValue,
      notes
    } = req.body || {};
    const cleanLabel = String(subdomainLabel || "").trim().toLowerCase();
    const cleanParent = String(parentHost || "").trim().toLowerCase();
    if (!cleanLabel) return res.status(400).json({
      error: "Subdomain label is required."
    });
    if (!cleanParent) return res.status(400).json({
      error: "Parent host is required."
    });
    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);
    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({
        error: "Hosting site is not active yet."
      });
    }
    const fullSubdomain = `${cleanLabel}.${cleanParent}`;
    const created = await client.post("/api/resource/Hosting Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      parent_host: cleanParent,
      subdomain_label: cleanLabel,
      full_subdomain: fullSubdomain,
      target_type: String(targetType || "folder").trim(),
      target_value: String(targetValue || "").trim(),
      status: "pending",
      notes: String(notes || "").trim()
    });
    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "subdomain_requested",
      title: "Subdomain request submitted",
      description: fullSubdomain
    });
    return res.json({
      ok: true,
      subdomain: created.data?.data || null
    });
  } catch (err) {
    console.error("HOSTING SUBDOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to create subdomain request."
    });
  }
});

router.post("/api/hosting/domains/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      requestedName,
      requestedTld,
      requestType,
      notes
    } = req.body || {};
    const cleanName = String(requestedName || "").trim().toLowerCase();
    const cleanTld = String(requestedTld || "").trim().toLowerCase();
    const cleanType = String(requestType || "register").trim();
    if (!cleanName) return res.status(400).json({
      error: "Domain name is required."
    });
    if (!cleanTld.startsWith(".")) return res.status(400).json({
      error: "Invalid domain extension."
    });
    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);
    const domains = await fetchHostingDomains(client, webAccountName);
    const domainRequests = await fetchHostingDomainRequests(client, webAccountName);
    const entitlement = computeIncludedDomainEntitlement(domains, domainRequests);
    const fullDomain = `${cleanName}${cleanTld}`;
    const isIncluded = entitlement.canRequestIncludedDomain;
    const requiresPayment = !isIncluded;
    const created = await client.post("/api/resource/Hosting Domain Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_name: cleanName,
      requested_tld: cleanTld,
      full_domain: fullDomain,
      request_type: cleanType,
      is_included: isIncluded ? 1 : 0,
      requires_payment: requiresPayment ? 1 : 0,
      status: requiresPayment ? "awaiting_payment" : "pending",
      notes: String(notes || "").trim()
    });
    return res.json({
      ok: true,
      request: created.data?.data || null,
      message: isIncluded ? "Included domain request submitted." : "Additional domain request submitted. Payment may be required before activation."
    });
  } catch (err) {
    console.error("DOMAIN REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit domain request."
    });
  }
});

router.post("/api/hosting/subdomains/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      parentDomain,
      subdomainPrefix,
      targetType,
      targetValue
    } = req.body || {};
    const cleanParent = String(parentDomain || "").trim().toLowerCase();
    const cleanPrefix = String(subdomainPrefix || "").trim().toLowerCase();
    const cleanTargetType = String(targetType || "folder").trim().toLowerCase();
    const cleanTargetValue = String(targetValue || "").trim();
    if (!cleanParent) return res.status(400).json({
      error: "Parent domain is required."
    });
    if (!cleanPrefix) return res.status(400).json({
      error: "Subdomain prefix is required."
    });
    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);
    const fullSubdomain = `${cleanPrefix}.${cleanParent}`;
    const created = await client.post("/api/resource/Hosting Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      parent_domain: cleanParent,
      subdomain_prefix: cleanPrefix,
      full_subdomain: fullSubdomain,
      target_type: cleanTargetType,
      target_value: cleanTargetValue,
      status: "pending"
    });
    return res.json({
      ok: true,
      subdomain: created.data?.data || null,
      message: "Subdomain request submitted."
    });
  } catch (err) {
    console.error("SUBDOMAIN REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit subdomain request."
    });
  }
});

router.post("/api/hosting/requests", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      category,
      title,
      description
    } = req.body || {};
    const cleanCategory = String(category || "support").trim();
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();
    if (!cleanTitle) return res.status(400).json({
      error: "Title is required."
    });
    if (!cleanDescription) return res.status(400).json({
      error: "Description is required."
    });
    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);
    const created = await client.post("/api/resource/Hosting Support Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      category: cleanCategory,
      title: cleanTitle,
      description: cleanDescription,
      status: "open"
    });
    return res.json({
      ok: true,
      request: created.data?.data || null,
      message: "Support request submitted."
    });
  } catch (err) {
    console.error("HOSTING REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to submit request."
    });
  }
});

router.post("/api/hosting/files/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded."
      });
    }
    const {
      uploadCategory = "deployment",
      notes = ""
    } = req.body || {};
    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);
    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({
        error: "Hosting site is not active yet."
      });
    }
    const fileSizeMb = Number((req.file.size / (1024 * 1024)).toFixed(2));
    const currentUsed = Number(activeSite.storageUsedMb || 0);
    const limit = Number(activeSite.storageLimitMb || 0);
    if (limit > 0 && currentUsed + fileSizeMb > limit) {
      return res.status(400).json({
        error: "Storage full. Upload exceeds your hosting allocation."
      });
    }
    const dir = buildHostingUploadDir(webAccountName, activeSite.id);
    await fsp.mkdir(dir, {
      recursive: true
    });
    const safeName = `${Date.now()}_${ensureSafeFileName(req.file.originalname)}`;
    const relativePath = buildHostingRelativePath(webAccountName, activeSite.id, safeName);
    const absPath = buildHostingAbsolutePath(relativePath);
    await fsp.mkdir(path.dirname(absPath), {
      recursive: true
    });
    await fsp.writeFile(absPath, req.file.buffer);
    const created = await client.post("/api/resource/Hosting File", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      file_name: req.file.originalname,
      file_path: relativePath,
      file_size_mb: fileSizeMb,
      file_type: req.file.mimetype || "",
      upload_category: String(uploadCategory || "deployment").trim(),
      status: "uploaded",
      is_active_build: 0,
      notes: String(notes || "").trim()
    });
    const updatedUsage = await recalculateHostingStorageUsage(client, activeSite.id);
    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "file_uploaded",
      title: "File uploaded",
      description: `${req.file.originalname} uploaded successfully.`
    });
    return res.json({
      ok: true,
      file: created.data?.data || null,
      storageUsedMb: updatedUsage
    });
  } catch (err) {
    console.error("HOSTING FILE UPLOAD ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to upload file."
    });
  }
});

router.post("/api/hosting/deployments/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "Not authenticated."
    });
    const {
      sourceFile = "",
      deploymentType = "manual",
      notes = ""
    } = req.body || {};
    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);
    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({
        error: "Hosting site is not active yet."
      });
    }
    const created = await client.post("/api/resource/Hosting Deployment", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      source_file: String(sourceFile || "").trim(),
      deployment_type: String(deploymentType || "manual").trim(),
      status: "pending",
      target_path: activeSite.documentRoot || "",
      notes: String(notes || "").trim()
    });
    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "deployment_requested",
      title: "Deployment requested",
      description: sourceFile ? `Deployment requested using ${sourceFile}` : "Deployment requested."
    });
    return res.json({
      ok: true,
      deployment: created.data?.data || null
    });
  } catch (err) {
    console.error("HOSTING DEPLOYMENT ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to request deployment."
    });
  }
});

// --- LOGOUT ---

  return router;
};
