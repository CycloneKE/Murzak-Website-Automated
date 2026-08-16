
const express = require('express');
const customerDomains = require('../services/customerDomains');

module.exports = function(ctx) {
  const { 
    HOSTING_SERVICE_ID,
    buildHostingAbsolutePath,
    buildHostingRelativePath,
    buildHostingUploadDir,
    ensureHostingSiteStorageAllocation,
    ensurePendingHostingSiteForRequest,
    ensureSafeFileName,
    ensureUserOwnsHostingService,
    fetchHostingActivity,
    fetchHostingDeployments,
    fetchHostingDomainPurchaseRequests,
    fetchHostingExternalDomains,
    fetchHostingFiles,
    fetchHostingMurzakSubdomains,
    fetchHostingSite,
    fetchHostingSubdomains,
    fetchHostingSupportRequests,
    fetchSelectedServicesForUser,
    frappeClient,
    fsp,
    getActiveHostingServiceForUser,
    path,
    recalculateHostingStorageUsage,
    requireAuth,
    upload 
  } = ctx;

  const router = express.Router();

  /**
   * Mirror an accepted intake into the account's Customer Domain record.
   *
   * Best-effort on purpose: the intake record is what staff fulfil, so a
   * failure to write the ownership row must not reject the customer's
   * request. The backfill script reconciles anything that slips through.
   */
  async function recordCustomerDomain(client, webAccountName, opts) {
    try {
      const { domain } = await customerDomains.ensureCustomerDomain(client, {
        webAccount: webAccountName,
        ...opts,
      });
      return domain?.id || "";
    } catch (e) {
      console.error("CUSTOMER DOMAIN RECORD ERROR:", e.response?.data || e.message);
      return "";
    }
  }

  /** Every domain the account owns, whatever service (if any) it points at. */
  router.get("/api/portal/domains", requireAuth, async (req, res) => {
    try {
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const client = frappeClient();
      return res.json({ ok: true, domains: await customerDomains.listCustomerDomains(client, webAccountName) });
    } catch (err) {
      console.error("LIST CUSTOMER DOMAINS ERROR:", err.response?.data || err.message);
      return res.status(500).json({ error: "Failed to load domains." });
    }
  });

  /**
   * Point a domain the account owns at a service the account owns.
   *
   * This is the replacement for the purchase-time domainChoice: which domain
   * serves which service is now a decision the customer can revisit, not one
   * frozen at checkout. Attaching is a move, not an add — a domain resolves to
   * one place, so this overwrites any previous attachment.
   */
  router.post("/api/portal/domains/:id/attach", requireAuth, async (req, res) => {
    try {
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const serviceId = String(req.body?.serviceId || "").trim();
      const client = frappeClient();

      const domain = await customerDomains.getOwnedCustomerDomain(client, webAccountName, req.params.id);
      if (!domain) return res.status(404).json({ error: "Domain not found." });

      const ownedServices = await fetchSelectedServicesForUser(client, webAccountName);
      const verdict = customerDomains.canAttachDomain({ domain, serviceId, ownedServices });
      if (!verdict.ok) return res.status(400).json({ error: verdict.reason });

      await customerDomains.setDomainAttachment(client, domain.id, serviceId);
      return res.json({
        ok: true,
        domain: { ...domain, attachedToService: serviceId },
      });
    } catch (err) {
      console.error("ATTACH DOMAIN ERROR:", err.response?.data || err.message);
      return res.status(500).json({ error: "Failed to attach domain." });
    }
  });

  /**
   * Stop pointing a domain at anything. The account keeps it — owned and
   * unattached is a legitimate state, and the whole reason domains stopped
   * being a property of a service.
   */
  router.post("/api/portal/domains/:id/detach", requireAuth, async (req, res) => {
    try {
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });
      const client = frappeClient();

      const domain = await customerDomains.getOwnedCustomerDomain(client, webAccountName, req.params.id);
      if (!domain) return res.status(404).json({ error: "Domain not found." });
      if (!domain.attachedToService) {
        return res.status(400).json({ error: "This domain is not attached to anything." });
      }

      await customerDomains.setDomainAttachment(client, domain.id, null);
      return res.json({ ok: true, domain: { ...domain, attachedToService: null } });
    } catch (err) {
      console.error("DETACH DOMAIN ERROR:", err.response?.data || err.message);
      return res.status(500).json({ error: "Failed to detach domain." });
    }
  });

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
    // The old gate here rejected the request unless the service had been
    // configured for "Register New Domain" at purchase time — which is why a
    // customer could never register a second domain, or one for a service
    // they set up differently. Domains are account-owned now; owning the
    // hosting service is the only thing that has to be true.
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
    // Domain first, so the site can be linked to it as it is created.
    const customerDomainId = await recordCustomerDomain(client, webAccountName, {
      domainName: fullDomain,
      kind: customerDomains.DOMAIN_KINDS.REGISTERED,
      status: "pending",
      sourceDoctype: "Hosting Domain Purchase Request",
      sourceName: created.data?.data?.name,
      attachedToService: HOSTING_SERVICE_ID,
      notes: String(notes || "").trim(),
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "domain",
      primaryHost: fullDomain,
      customerDomainId,
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
    const subdomainRoot = customerDomains.resolveFreeSubdomainRoot({
      envValue: process.env.FREE_SUBDOMAIN_ROOT_DOMAIN,
      nodeEnv: process.env.NODE_ENV,
    });
    if (!subdomainRoot.ok) {
      console.error("MURZAK SUBDOMAIN ERROR:", subdomainRoot.reason);
      return res.status(503).json({
        error: "Free subdomains aren't available right now — message support and we'll set one up for you."
      });
    }
    const fullSubdomain = `${cleanLabel}.${subdomainRoot.root}`;
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    // Purchase-time domainChoice gate removed — see the note on the domain
    // purchase route above.
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
    const customerDomainId = await recordCustomerDomain(client, webAccountName, {
      domainName: fullSubdomain,
      kind: customerDomains.DOMAIN_KINDS.MURZAK_SUBDOMAIN,
      status: "pending",
      sourceDoctype: "Hosting Murzak Subdomain",
      sourceName: created.data?.data?.name,
      attachedToService: HOSTING_SERVICE_ID,
      notes: String(notes || "").trim(),
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "murzak_subdomain",
      primaryHost: fullSubdomain,
      customerDomainId,
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
    // Normalize before storing: a customer pasting "https://Shop.Example.com/"
    // previously landed in the intake record verbatim, so staff fulfilled
    // against a URL rather than a hostname.
    const cleanDomain = customerDomains.normalizeDomainName(domainName);
    if (!cleanDomain) return res.status(400).json({
      error: "Domain name is required."
    });
    if (!customerDomains.isValidDomainName(cleanDomain)) return res.status(400).json({
      error: "That does not look like a valid domain name."
    });
    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);
    // Purchase-time domainChoice gate removed — see the note on the domain
    // purchase route above.
    const created = await client.post("/api/resource/Hosting External Domain Connection", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      domain_name: cleanDomain,
      registrar: String(registrar || "").trim(),
      status: "pending",
      verification_notes: String(notes || "").trim(),
      is_primary: 1
    });
    const customerDomainId = await recordCustomerDomain(client, webAccountName, {
      domainName: cleanDomain,
      kind: customerDomains.DOMAIN_KINDS.EXTERNAL,
      status: "pending",
      registrar: String(registrar || "").trim(),
      sourceDoctype: "Hosting External Domain Connection",
      sourceName: created.data?.data?.name,
      attachedToService: HOSTING_SERVICE_ID,
      notes: String(notes || "").trim(),
    });
    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "external_domain",
      primaryHost: cleanDomain,
      customerDomainId,
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
