
const express = require('express');
// Not destructured at import time — test/routesContext.test.js's static guard
// greedily matches the first destructuring-brace pattern through to the ctx
// destructure below (see portalRoutes.js for the same convention).
const terminalConstants = require('../services/terminal/constants');
const accessControlLib = require('../services/terminal/accessControl');
const s3ClientLib = require('../services/terminal/s3Client');
const supportUnread = require('../services/supportUnread');
const customerDomains = require('../services/customerDomains');

module.exports = function(ctx) {
  const {
    CAPACITY_REQUEST_DOCTYPE,
    PROVISIONING_JOB_DOCTYPE,
    axios,
    frappeClient,
    logPortalUpdate,
    mysqlDatetimeUTC,
    provisioningQueue,
    provisioningRunner,
    provisioningTargets,
    requireAdmin,
    requireAuth
  } = ctx;

  const router = express.Router();

// The projection MUST carry every field the inbox renders. It previously
// fetched only name/email/full_name/status while the UI displayed
// company_name and last_message_at, so every row showed "—" and a blank
// timestamp and the inbox looked dead even when it held threads.
const THREAD_LIST_FIELDS = [
  "name",
  "email",
  "full_name",
  "company_name",
  "subject",
  "status",
  "last_message_at",
  "last_admin_seen_at",
  "modified"
];

router.get("/api/admin/threads", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const resp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(THREAD_LIST_FIELDS),
        order_by: "last_message_at desc",
        limit_page_length: 100
      }
    });
    const rows = resp.data?.data || [];
    return res.json({
      ok: true,
      data: rows.map(r => ({ ...r, unread: supportUnread.isUnreadForAdmin(r) })),
      unreadCount: supportUnread.countAdminUnread(rows)
    });
  } catch (err) {
    console.error("ADMIN THREADS ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load threads."
    });
  }
});

// Unread support badge for staff — the mirror of the customer's
// /api/portal/requests/unread-count. Its absence is why an admin never learned
// a customer was waiting unless they happened to open the inbox.
router.get("/api/admin/threads/unread-count", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const resp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name", "status", "last_message_at", "last_admin_seen_at"]),
        order_by: "last_message_at desc",
        limit_page_length: 200
      }
    });
    return res.json({
      ok: true,
      count: supportUnread.countAdminUnread(resp.data?.data)
    });
  } catch (err) {
    console.error("ADMIN UNREAD COUNT ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to fetch unread count."
    });
  }
});

// --- DOMAIN FULFILMENT QUEUE ---
// Registering a domain is a manual job (the registrar's API terms blocked
// automating it), so "pending" is a work queue, not a transient state. Before
// this, that queue existed only as rows in three intake doctypes with no
// cross-account view — staff had to already know a request had been made.

router.get("/api/admin/domains", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    // Unfiltered so the summary counts every status; the caller filters the
    // list client-side from the same payload.
    const all = await customerDomains.listAllCustomerDomains(client);
    const status = String(req.query?.status || "").trim().toLowerCase();
    const filtered = status ? all.filter((d) => d.status === status) : all;
    return res.json({
      ok: true,
      domains: filtered,
      summary: customerDomains.summarizeByStatus(all),
      actionableCount: all.filter((d) =>
        customerDomains.DOMAIN_ACTIONABLE_STATUSES.includes(d.status)
      ).length,
    });
  } catch (err) {
    console.error("ADMIN DOMAINS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load domains." });
  }
});

router.get("/api/admin/domains/actionable-count", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const all = await customerDomains.listAllCustomerDomains(client);
    return res.json({
      ok: true,
      count: all.filter((d) => customerDomains.DOMAIN_ACTIONABLE_STATUSES.includes(d.status)).length,
    });
  } catch (err) {
    console.error("ADMIN DOMAIN COUNT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch domain count." });
  }
});

/**
 * Record the outcome of a manual fulfilment.
 *
 * Also pushes the result back onto the intake record the domain came from —
 * that is what the customer's hosting dashboard still reads, so skipping it
 * would leave the customer on "pending" forever while staff see it as done.
 * The intake sync is best-effort: the domain is the authority, and a stale
 * intake must not fail the staff action.
 */
router.post("/api/admin/domains/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    const { status, registrar, expiresOn, notes } = req.body || {};

    const current = await client
      .get(`/api/resource/${encodeURIComponent(customerDomains.CUSTOMER_DOMAIN_DOCTYPE)}/${encodeURIComponent(id)}`)
      .catch((e) => {
        if (e.response?.status === 404) return null;
        throw e;
      });
    const row = current?.data?.data;
    if (!row) return res.status(404).json({ error: "Domain not found." });

    const verdict = customerDomains.canTransitionDomainStatus(row.status, status);
    if (!verdict.ok) return res.status(400).json({ error: verdict.reason });

    const nextStatus = String(status).trim().toLowerCase();
    const patch = { status: nextStatus };
    if (registrar !== undefined) patch.registrar = String(registrar || "").trim();
    if (expiresOn !== undefined) patch.expires_on = expiresOn || null;
    if (notes !== undefined) patch.notes = String(notes || "").trim();
    // A domain that is live has a working certificate or is about to; either
    // way "none" stops being true the moment it resolves.
    if (nextStatus === "active" && String(row.ssl_status || "none") === "none") {
      patch.ssl_status = "pending";
    }
    await customerDomains.updateCustomerDomain(client, id, patch);

    let intakeSynced = false;
    const intakeStatus = customerDomains.intakeStatusForDomainStatus(nextStatus, row.source_doctype);
    if (row.source_doctype && row.source_name && intakeStatus) {
      try {
        await client.put(
          `/api/resource/${encodeURIComponent(row.source_doctype)}/${encodeURIComponent(row.source_name)}`,
          { status: intakeStatus }
        );
        intakeSynced = true;
      } catch (e) {
        console.warn("DOMAIN INTAKE SYNC WARN:", e.response?.data || e.message);
      }
    }

    return res.json({ ok: true, status: nextStatus, intakeSynced });
  } catch (err) {
    console.error("ADMIN DOMAIN STATUS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to update domain." });
  }
});

router.post("/api/admin/threads/:id/mark-read", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      last_admin_seen_at: mysqlDatetimeUTC()
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN MARK READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to mark read."
    });
  }
});

router.get("/api/admin/threads/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      id
    } = req.params;
    const resp = await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`);
    return res.json({
      ok: true,
      data: resp.data?.data
    });
  } catch (err) {
    console.error("ADMIN THREAD READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load thread."
    });
  }
});

router.post("/api/admin/threads/:id/reply", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      id
    } = req.params;
    const {
      message,
      attachments
    } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required."
      });
    }
    await client.post("/api/method/frappe.client.insert", {
      doc: {
        doctype: "Portal Users Request Messages",
        parent: id,
        parenttype: "Portal Users Requests",
        parentfield: "messages",
        sender_type: "Admin",
        sender: req.session.user.email,
        message: message.trim(),
        attachments: attachments || "",
        sent_at: mysqlDatetimeUTC()
      }
    });
    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      last_message_at: mysqlDatetimeUTC(),
      status: "Waiting on User"
    });
    const thread = (await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`)).data?.data;
    if (thread?.portal_user) {
      await logPortalUpdate(client, thread.portal_user, {
        type: "info",
        engineer: "Murzak Tech",
        content: "New message from Murzak Tech.",
        is_chat: true
      });
    }
    return res.json({
      ok: true
    });
  } catch (err) {
    console.error("ADMIN REPLY ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to send reply."
    });
  }
});

// --- DEVELOPER TERMINAL ACCESS: staff approval ---
// Stamps the Web Account fields the mint endpoint's gate checks
// (routes/portalRoutes.js) require. Frappe's own document version history
// on Web Account is the audit trail for who/when — no separate log field.
router.post("/api/admin/web-accounts/:webAccount/terminal-access/approve", requireAuth, requireAdmin, async (req, res) => {
  const { webAccount } = req.params;
  if (!webAccount) return res.status(400).json({ error: "Missing webAccount." });
  const approvedBy = String(req.session?.user?.email || "").trim();
  if (!approvedBy) return res.status(401).json({ error: "No session account." });
  try {
    const client = frappeClient();
    const approvedAt = mysqlDatetimeUTC();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`, {
      terminal_access_approved_at: approvedAt,
      terminal_access_approved_by: approvedBy,
    });
    return res.json({ ok: true, approvedAt, approvedBy });
  } catch (err) {
    console.error("TERMINAL ACCESS APPROVE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to approve developer access." });
  }
});

// --- RESOURCE ADMIN ACCESS: staff approval ---
// Stamps the Web Account fields requireResourceAdmin (routes/portalRoutes.js)
// checks before letting a customer edit their own environment variables or
// read runtime logs. Separate from terminal access on purpose: this grants
// configuration control, that one grants a shell — an account can hold either
// without the other. Frappe's document version history is the audit trail.
router.post("/api/admin/web-accounts/:webAccount/resource-admin/approve", requireAuth, requireAdmin, async (req, res) => {
  const { webAccount } = req.params;
  if (!webAccount) return res.status(400).json({ error: "Missing webAccount." });
  const approvedBy = String(req.session?.user?.email || "").trim();
  if (!approvedBy) return res.status(401).json({ error: "No session account." });
  try {
    const client = frappeClient();
    const approvedAt = mysqlDatetimeUTC();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`, {
      resource_admin_approved_at: approvedAt,
      resource_admin_approved_by: approvedBy,
    });
    return res.json({ ok: true, approvedAt, approvedBy });
  } catch (err) {
    console.error("RESOURCE ADMIN APPROVE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to approve advanced controls." });
  }
});

// ---- Infrastructure quick-links (admin) ----
// Redirects for staff troubleshooting: Hostinger's own hPanel (which has a
// built-in browser SSH terminal — we don't run our own shell broker onto the
// shared box) and Frappe's Helpdesk ticketing module. URLs are configurable
// since we don't have the exact hPanel/VPS URL or confirmation the Helpdesk
// app is installed; sane defaults are used otherwise.
router.get("/api/admin/infra-links", requireAuth, requireAdmin, async (req, res) => {
  const frappeBase = (process.env.FRAPPE_BASE_URL || "").replace(/\/+$/, "");
  return res.json({
    ok: true,
    hostingerUrl: process.env.HOSTINGER_HPANEL_URL || "https://hpanel.hostinger.com",
    frappeTicketingUrl: process.env.FRAPPE_HELPDESK_URL || (frappeBase ? `${frappeBase}/helpdesk` : ""),
    frappeDeskUrl: frappeBase ? `${frappeBase}/app/hd-ticket` : "",
  });
});

// ---- Provisioning (admin) ----
// List provisioning jobs, optionally filtered by status.
router.get("/api/admin/provisioning/jobs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      status
    } = req.query;
    const filters = status ? [["status", "=", String(status)]] : [];
    const resp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify(filters),
        fields: JSON.stringify(["name", "web_account", "invoice", "service_id", "service_name", "category", "lane", "target", "status", "attempts", "ram_mb", "gated", "external_ref", "error", "next_run_at", "started_at", "runner_id", "log", "access", "backup_status", "edge_status", "modified"]),
        order_by: "modified desc",
        limit_page_length: 200
      }
    });
    return res.json({
      ok: true,
      data: resp.data?.data || []
    });
  } catch (err) {
    // Running without the Provisioning Job doctype is a supported degraded
    // state (notify-only; the readiness panel flags it) — report "no jobs",
    // not a 500. Same 404/417 convention as provisioningService/readiness.
    const code = err.response?.status;
    if (code === 404 || code === 417) {
      return res.json({ ok: true, data: [], doctypeMissing: true });
    }
    console.error("ADMIN PROVISIONING LIST ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load provisioning jobs."
    });
  }
});

// Trigger a single runner pass on demand (does nothing the loop wouldn't, but
// lets an admin push the queue without waiting for the interval).

// Trigger a single runner pass on demand (does nothing the loop wouldn't, but
// lets an admin push the queue without waiting for the interval).
router.post("/api/admin/provisioning/run", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await provisioningRunner.processQueue(frappeClient());
    return res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    console.error("ADMIN PROVISIONING RUN ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to run provisioning queue."
    });
  }
});

// Re-queue a failed / needs_human job for another runner attempt.

// Re-queue a failed / needs_human job for another runner attempt.
router.post("/api/admin/provisioning/jobs/:id/retry", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      id
    } = req.params;
    await client.put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(id)}`, {
      status: "queued",
      attempts: 0,
      next_run_at: null,
      error: ""
    });
    return res.json({
      ok: true,
      name: id
    });
  } catch (err) {
    console.error("ADMIN PROVISIONING RETRY ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to re-queue job."
    });
  }
});

// Manually resolve a job (for manual lanes or unrecoverable errors)
router.post("/api/admin/provisioning/jobs/:id/resolve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    const { external_ref, access } = req.body;
    
    // Fetch the job first to get web_account and service_id
    const jobRes = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(id)}`);
    const job = jobRes.data?.data;
    if (!job) return res.status(404).json({ error: "Job not found." });

    // Update job to active
    await client.put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(id)}`, {
      status: "active",
      external_ref: external_ref || "",
      access: JSON.stringify(access || {}).slice(0, 1000),
      error: ""
    });

    // Flip the web account service from Setting up -> Active
    const { markAccountServiceActive } = require("../services/provisioning/runner");
    await markAccountServiceActive(client, job.web_account, job.service_id);

    return res.json({ ok: true, name: id });
  } catch (err) {
    console.error("ADMIN PROVISIONING RESOLVE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to resolve job." });
  }
});

// Capacity overview: targets + per-target reserved RAM + open scale-out requests.

// Capacity overview: targets + per-target reserved RAM + open scale-out requests.
router.get("/api/admin/provisioning/capacity", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const reserved = await provisioningTargets.reservedByTarget(client);
    const targetsView = provisioningTargets.listTargets().map(t => ({
      id: t.id,
      status: t.status,
      sellableRamMb: t.sellableRamMb,
      reservedRamMb: reserved[t.id] || 0,
      limitRamMb: provisioningTargets.targetLimitMb(t)
    }));
    let requests = [];
    try {
      const r = await client.get(`/api/resource/${encodeURIComponent(CAPACITY_REQUEST_DOCTYPE)}`, {
        params: {
          fields: JSON.stringify(["name", "status", "requested_ram_mb", "reason", "autoscale", "modified"]),
          order_by: "modified desc",
          limit_page_length: 50
        }
      });
      requests = r.data?.data || [];
    } catch {
      /* Capacity Request doctype may not be installed yet */
    }
    return res.json({
      ok: true,
      targets: targetsView,
      requests
    });
  } catch (err) {
    console.error("ADMIN CAPACITY ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load capacity overview."
    });
  }
});

// Go-live readiness checklist (what's configured after adding env vars).

// Go-live readiness checklist (what's configured after adding env vars).
router.get("/api/admin/provisioning/readiness", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      getReadiness
    } = require("../services/provisioning/readiness");
    const result = await getReadiness(frappeClient());
    return res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    console.error("ADMIN READINESS ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to compute readiness."
    });
  }
});

// Dispatcher health: mode (poll/bullmq/off) and, in bullmq mode, queue counts.

// Dispatcher health: mode (poll/bullmq/off) and, in bullmq mode, queue counts.
router.get("/api/admin/provisioning/queue", requireAuth, requireAdmin, async (req, res) => {
  try {
    const h = await provisioningQueue.health();
    return res.json({
      ok: true,
      ...h
    });
  } catch (err) {
    console.error("ADMIN QUEUE HEALTH ERROR:", err.message);
    return res.status(500).json({
      error: "Failed to read queue health."
    });
  }
});

// Orphan reconciliation: live Coolify applications/services with no owning
// Provisioning Job external_ref. SURFACE ONLY — never deletes anything;
// staff act on this from the Coolify UI/CLI themselves. See
// services/provisioning/orphans.js for why (the exact bug class this
// catches: a pre-fix run left a real Coolify service no job ever tracked).
router.get("/api/admin/provisioning/orphans", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { findOrphanedCoolifyResources } = require("../services/provisioning/orphans");
    const result = await findOrphanedCoolifyResources(frappeClient());
    return res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    console.error("ADMIN ORPHANS ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to check for orphaned resources."
    });
  }
});

// Platform health: last Platform Health Check row per job_type (orphan_check,
// capacity_snapshot, backup) — the scheduled sweeps and this route's own
// on-demand siblings (/orphans, /capacity above) both write to the same
// doctype, so a manual check between scheduled runs shows up here too.
router.get("/api/admin/platform-health", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { latestHealthChecks } = require("../services/provisioning/platformHealth");
    const checks = await latestHealthChecks(frappeClient());
    return res.json({ ok: true, checks });
  } catch (err) {
    console.error("ADMIN PLATFORM HEALTH ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load platform health." });
  }
});

// ---- Developer access terminal (admin) — P5.4 ----
// Metadata-only list: general admin access, broad requireAdmin gate — matches
// the brainstormed tiering (staff see WHAT happened, not the transcript).
// Recording CONTENT is a separate, narrower gate below.
router.get("/api/admin/terminal/sessions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const resp = await client.get(`/api/resource/${encodeURIComponent(terminalConstants.SESSION_DOCTYPE)}`, {
      params: {
        fields: JSON.stringify([
          "name", "session_id", "web_account", "provisioning_job", "service_id",
          "container_name", "started_at", "ended_at", "duration_seconds",
          "exit_reason", "byte_count", "retention_tier", "flagged_reason", "purged",
        ]),
        order_by: "started_at desc",
        limit_page_length: 200,
      },
    });
    return res.json({ ok: true, data: resp.data?.data || [] });
  } catch (err) {
    if (err?.response?.status === 404 || /doctype/i.test(err?.response?.data?.exception || "")) {
      return res.json({ ok: true, data: [] });
    }
    console.error("ADMIN TERMINAL SESSIONS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load terminal sessions." });
  }
});

// Kill-switch — an ACTION, not a content view, so it stays behind the broad
// requireAdmin gate (unlike recording access below). Only reaches a session
// the backend has a live Terminal Session row for (ended_at empty); the
// broker itself does not re-authorize this beyond the shared internal key.
router.post("/api/admin/terminal/:sessionId/kill", requireAuth, requireAdmin, async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId." });

  const brokerKey = process.env.BROKER_API_KEY;
  const brokerUrl = (process.env.BROKER_URL || "").replace(/\/+$/, "");
  if (!brokerKey || !brokerUrl) {
    console.error("ADMIN TERMINAL KILL ERROR: BROKER_API_KEY/BROKER_URL not set.");
    return res.status(503).json({ error: "Terminal broker isn't configured yet." });
  }

  try {
    const client = frappeClient();
    const resp = await client.get(`/api/resource/${encodeURIComponent(terminalConstants.SESSION_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["session_id", "=", sessionId]]),
        fields: JSON.stringify(["name", "ended_at"]),
        limit_page_length: 1,
      },
    });
    const row = resp.data?.data?.[0];
    if (!row) return res.status(404).json({ error: "No session with that id." });
    if (row.ended_at) return res.status(409).json({ error: "That session has already ended." });

    await axios.post(`${brokerUrl}/sessions/${encodeURIComponent(sessionId)}/kill`, {}, {
      headers: { "x-broker-key": brokerKey },
      timeout: 5000,
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err?.response?.status === 404) {
      return res.status(404).json({ error: "That session is no longer live on the broker." });
    }
    console.error("ADMIN TERMINAL KILL ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Failed to kill the session. Please try again." });
  }
});

// Recording CONTENT access — deliberately narrower than requireAdmin: gated
// on TERMINAL_RECORDING_ACCESS_EMAILS (a separate, smaller list), requires a
// stated reason, and every attempt (granted or denied) is logged to an
// immutable doctype. See services/terminal/accessControl.js.
router.post("/api/admin/terminal/:sessionId/recording-access", requireAuth, requireAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const reason = req.body?.reason;
  const email = req.session?.user?.email || "";
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId." });

  const client = frappeClient();
  let row;
  try {
    const resp = await client.get(`/api/resource/${encodeURIComponent(terminalConstants.SESSION_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["session_id", "=", sessionId]]),
        fields: JSON.stringify(["name", "recording_key", "purged"]),
        limit_page_length: 1,
      },
    });
    row = resp.data?.data?.[0];
  } catch (err) {
    console.error("ADMIN RECORDING ACCESS LOOKUP ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to look up this session." });
  }
  if (!row) return res.status(404).json({ error: "No session with that id." });

  const authorized = accessControlLib.isRecordingAccessAuthorized(email);

  let logEntry;
  try {
    logEntry = accessControlLib.buildAccessLogEntry({
      sessionName: row.name,
      accessedBy: email,
      reason,
      granted: authorized,
    });
  } catch (err) {
    if (err.code === "REASON_REQUIRED") {
      return res.status(400).json({ error: "A reason is required to access a recording." });
    }
    throw err;
  }

  client
    .post("/api/method/frappe.client.insert", { doc: { doctype: terminalConstants.ACCESS_LOG_DOCTYPE, ...logEntry } })
    .catch((e) => console.error("RECORDING ACCESS LOG WRITE FAILED:", e.response?.data || e.message));

  if (!authorized) {
    return res.status(403).json({ error: "You're not authorized to view recording content." });
  }
  if (row.purged || !row.recording_key) {
    return res.status(404).json({ error: "No recording available for this session." });
  }

  try {
    const url = s3ClientLib.presignGetUrl(row.recording_key, { expiresSeconds: 300 });
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("ADMIN RECORDING PRESIGN ERROR:", err.message);
    return res.status(503).json({ error: "Recording storage isn't configured." });
  }
});

// ---- Frontend Routes (SPA fallback) ----
// Important: This must be AFTER API routes.
// Any route not matched above will return the React app.

  return router;
};
