
const express = require('express');

module.exports = function(ctx) {
  const { 
    CAPACITY_REQUEST_DOCTYPE,
    PROVISIONING_JOB_DOCTYPE,
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

router.get("/api/admin/threads", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const resp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name", "email", "full_name", "status"]),
        order_by: "modified desc",
        limit_page_length: 100
      }
    });
    return res.json({
      ok: true,
      data: resp.data?.data || []
    });
  } catch (err) {
    console.error("ADMIN THREADS ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load threads."
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
        fields: JSON.stringify(["name", "web_account", "invoice", "service_id", "service_name", "category", "lane", "status", "attempts", "ram_mb", "gated", "external_ref", "error", "next_run_at", "modified"]),
        order_by: "modified desc",
        limit_page_length: 200
      }
    });
    return res.json({
      ok: true,
      data: resp.data?.data || []
    });
  } catch (err) {
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

// ---- Frontend Routes (SPA fallback) ----
// Important: This must be AFTER API routes.
// Any route not matched above will return the React app.

  return router;
};
