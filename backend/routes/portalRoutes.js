
const express = require('express');
const coolifyLane = require('../services/provisioning/lanes/coolify');

module.exports = function(ctx) {
  const {
    frappeClient,
    getWebAccountByEmail,
    mysqlDatetimeUTC,
    requireAuth,
    upload,
    userOwnsPrivateFile,
    PROVISIONING_JOB_DOCTYPE,
    rateLimit,
  } = ctx;

  const router = express.Router();

  // Tighter than the global apiLimiter (120/min/IP) — these actions hit real
  // customer infrastructure, not just Frappe reads. stop gets a stricter cap
  // than restart/start since it causes an outage until manually reversed.
  const serviceActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment and try again." },
  });
  const serviceStopLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment and try again." },
  });

  // In-flight guard: blunts (not perfectly prevents) a double-click firing two
  // concurrent actions on the same job. Best-effort, single-process — matches
  // this app's existing single-runner assumption (see provisioning/README.md).
  const actionInFlight = new Set();

// --- PORTAL USER CHAT: create thread ---
router.post("/api/portal/requests", requireAuth, async (req, res) => {
  try {
    const {
      message,
      pageUrl,
      attachments
    } = req.body;

    // Identity comes from the session, never the request body.
    const email = String(req.session?.user?.email || "").trim();
    if (!email || !message) {
      return res.status(400).json({
        error: "Missing required fields."
      });
    }
    const client = frappeClient();
    const webAcc = await getWebAccountByEmail(client, email);
    const portalUserId = webAcc?.name || null;
    const payload = {
      portal_user: portalUserId,
      email: email,
      full_name: webAcc?.account_holder_name || email,
      company_name: webAcc?.entity_name || "",
      subject: "Technical Sync Request",
      status: "New",
      source: "Portal",
      last_message_at: mysqlDatetimeUTC(),
      page_url: pageUrl || "",
      messages: [{
        sender_type: "User",
        sender: email,
        message: message,
        attachments: attachments || ""
      }]
    };
    const createResp = await client.post("/api/resource/Portal Users Requests", payload);
    return res.json({
      ok: true,
      id: createResp.data?.data?.name
    });
  } catch (err) {
    console.error("PORTAL REQUEST CREATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create request."
    });
  }
});

router.get("/api/portal/requests/my-thread", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    // Always the session user's own thread — ignore any query email.
    const email = String(req.session?.user?.email || "").trim();
    if (!email) return res.status(400).json({
      error: "Missing email."
    });

    // find newest thread for user
    const listResp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([["email", "=", email]]),
        order_by: "modified desc",
        limit_page_length: 1
      }
    });
    const rows = listResp.data?.data || [];
    if (rows.length) {
      return res.json({
        ok: true,
        id: rows[0].name,
        existed: true
      });
    }

    // no thread yet
    return res.json({
      ok: true,
      id: null,
      existed: false
    });
  } catch (err) {
    console.error("MY THREAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to get thread."
    });
  }
});

// Unread chat badge for portal user

// Unread chat badge for portal user
router.get("/api/portal/requests/unread-count", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    const client = frappeClient();

    // Find user's email (from session user is easiest)
    const email = String(req.session?.user?.email || "").trim();
    if (!email) return res.json({
      ok: true,
      count: 0
    });

    // Pull threads for this email; only those waiting on user
    const r = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name", "status", "last_message_at", "user_last_read_at"]),
        filters: JSON.stringify([["email", "=", email], ["status", "=", "Waiting on User"]]),
        order_by: "last_message_at desc",
        limit_page_length: 200
      }
    });
    const rows = Array.isArray(r.data?.data) ? r.data.data : [];
    const count = rows.filter(t => {
      const last = t.last_message_at ? new Date(t.last_message_at) : null;
      const read = t.user_last_read_at ? new Date(t.user_last_read_at) : null;
      if (!last) return false;
      if (!read) return true;
      return last.getTime() > read.getTime();
    }).length;
    return res.json({
      ok: true,
      count
    });
  } catch (err) {
    console.error("UNREAD COUNT ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to fetch unread count."
    });
  }
});

// --- PORTAL USER CHAT: get thread (with messages) ---

// --- PORTAL USER CHAT: get thread (with messages) ---
router.get("/api/portal/requests/:id", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      id
    } = req.params;
    const resp = await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`);
    const doc = resp.data?.data;
    if (!doc) return res.status(404).json({
      error: "Thread not found."
    });

    // Authorization: only the thread owner may read it.
    const email = String(req.session?.user?.email || "").trim().toLowerCase();
    if (!email || String(doc.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({
        error: "Not allowed."
      });
    }
    return res.json({
      ok: true,
      data: doc
    });
  } catch (err) {
    console.error("PORTAL REQUEST READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load messages."
    });
  }
});

// --- PORTAL USER CHAT: append message (RELIABLE) ---

// --- PORTAL USER CHAT: append message (RELIABLE) ---
router.post("/api/portal/requests/:id/messages", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    const {
      id
    } = req.params;
    const {
      message,
      attachments
    } = req.body;
    if (!message) {
      return res.status(400).json({
        error: "Missing required fields."
      });
    }

    // 1) confirm thread exists
    const current = await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`);
    const doc = current.data?.data;
    if (!doc) return res.status(404).json({
      error: "Thread not found."
    });

    // Authorization: only the thread owner may post to it.
    const email = String(req.session?.user?.email || "").trim().toLowerCase();
    if (!email || String(doc.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({
        error: "Not allowed."
      });
    }

    // 2) insert child row — sender identity is derived from the session,
    //    NEVER from the request body (prevents Admin impersonation).
    await client.post("/api/method/frappe.client.insert", {
      doc: {
        doctype: "Portal Users Request Messages",
        parent: id,
        parenttype: "Portal Users Requests",
        parentfield: "messages",
        sender_type: "User",
        sender: req.session.user.email,
        message,
        attachments: attachments || "",
        sent_at: mysqlDatetimeUTC()
      }
    });

    // 3) update parent “last_message_at” safely (MySQL format)
    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      last_message_at: mysqlDatetimeUTC(),
      status: "Waiting on Admin"
    });
    return res.json({
      ok: true,
      id
    });
  } catch (err) {
    console.error("PORTAL REQUEST MSG ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to send message."
    });
  }
});

router.post("/api/portal/requests/:id/mark-read", requireAuth, async (req, res) => {
  try {
    const {
      id
    } = req.params;
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    const client = frappeClient();
    const doc = (await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`)).data?.data;
    if (!doc) return res.status(404).json({
      error: "Thread not found."
    });

    // Safety: only allow marking own thread read
    const email = String(req.session?.user?.email || "").trim();
    if (!email || String(doc.email || "").trim() !== email) {
      return res.status(403).json({
        error: "Not allowed."
      });
    }
    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      user_last_read_at: mysqlDatetimeUTC() // your mysql datetime helper
    });
    return res.json({
      ok: true
    });
  } catch (err) {
    console.error("MARK READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to mark read."
    });
  }
});

// Upload files

// Upload files
router.post("/api/portal/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    console.log("UPLOAD HIT:", {
      hasFile: !!req.file,
      name: req.file?.originalname,
      size: req.file?.size,
      mimetype: req.file?.mimetype,
      user: req.session?.user?.email
    });
    if (!req.file) return res.status(400).json({
      error: "No file uploaded."
    });
    const FormData = require("form-data");
    const client = frappeClient();
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    form.append("is_private", "1");
    const up = await client.post("/api/method/upload_file", form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    const raw = up.data?.message?.file_url || "";
    const fileUrl = raw.startsWith("http") ? raw : `${process.env.FRAPPE_BASE_URL}${raw}`;
    if (!fileUrl) return res.status(500).json({
      error: "Upload succeeded but no file_url returned."
    });
    return res.json({
      ok: true,
      file_url: fileUrl
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Upload failed."
    });
  }
});

// Object-level authorization for a private Frappe file. We look the File doc up
// by its url and confirm it is attached to a record the session user owns.
// Fail closed: unknown files / unrecognised attachment types are denied.

router.get("/api/portal/files", requireAuth, async (req, res) => {
  try {
    const fileUrl = (req.query.url || "").toString();
    if (!fileUrl) return res.status(400).send("Missing url");

    // SSRF guard: only allow relative Frappe file paths — never arbitrary
    // absolute URLs (which would let the privileged token hit internal/external
    // hosts) and never path-traversal. Files live under /files or /private/files.
    let pathOnly = fileUrl;
    try {
      // If a full URL slipped in, keep only its path and validate the host.
      if (/^https?:\/\//i.test(fileUrl)) {
        const u = new URL(fileUrl);
        const baseHost = new URL(process.env.FRAPPE_BASE_URL).host;
        if (u.host !== baseHost) return res.status(400).send("Invalid file url");
        pathOnly = u.pathname;
      }
    } catch {
      return res.status(400).send("Invalid file url");
    }
    if (!/^\/(private\/files|files)\//.test(pathOnly) || pathOnly.includes("..")) {
      return res.status(400).send("Invalid file path");
    }
    const client = frappeClient();

    // Object-level authz: private files must belong to the session user.
    // Public /files/ are world-readable in Frappe, so no check is needed there.
    if (pathOnly.startsWith("/private/files/")) {
      const allowed = await userOwnsPrivateFile(client, pathOnly, req.session);
      if (!allowed) return res.status(403).send("Not allowed");
    }
    const target = `${process.env.FRAPPE_BASE_URL}${pathOnly}`;
    const r = await client.get(target, {
      responseType: "stream"
    });

    // pass through content type + force download if you want
    res.setHeader("Content-Type", r.headers["content-type"] || "application/octet-stream");
    if (r.headers["content-disposition"]) res.setHeader("Content-Disposition", r.headers["content-disposition"]);
    r.data.pipe(res);
  } catch (e) {
    console.error("FILE PROXY ERROR:", e.response?.data || e.message);
    res.status(500).send("Failed to fetch file");
  }
});

// --- PORTAL UPDATES (notifications) ---

router.get("/api/portal/updates", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    const client = frappeClient();
    const r = await client.get("/api/resource/Portal Update", {
      params: {
        filters: JSON.stringify([["web_account", "=", webAccountName], ["is_deleted", "=", 0] // ✅ requires custom field
        ]),
        fields: JSON.stringify(["name", "type", "engineer", "content", "acknowledged", "created_at", "is_chat"]),
        order_by: "created_at desc",
        limit_page_length: 200
      }
    });
    const rows = Array.isArray(r.data?.data) ? r.data.data : [];
    const updates = rows.map(u => ({
      id: u.name,
      type: u.type || "info",
      engineer: u.engineer || "Murzak Tech",
      content: u.content || "",
      acknowledged: !!u.acknowledged,
      timestamp: u.creation || u.created_at || mysqlDatetimeUTC(),
      is_chat: !!u.is_chat
    }));
    return res.json({
      ok: true,
      updates
    });
  } catch (err) {
    console.error("FETCH UPDATES ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to load updates."
    });
  }
});

router.post("/api/portal/updates/ack", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const {
      id
    } = req.body || {};
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    if (!id) return res.status(400).json({
      error: "Missing id."
    });
    const client = frappeClient();
    const doc = (await client.get(`/api/resource/Portal Update/${encodeURIComponent(id)}`)).data?.data;
    if (!doc || doc.web_account !== webAccountName) return res.status(403).json({
      error: "Not allowed."
    });
    await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, {
      acknowledged: 1
    });
    return res.json({
      ok: true
    });
  } catch (err) {
    console.error("ACK UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to acknowledge update."
    });
  }
});

router.post("/api/portal/updates/delete", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const {
      id
    } = req.body || {};
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    if (!id) return res.status(400).json({
      error: "Missing id."
    });
    const client = frappeClient();
    const doc = (await client.get(`/api/resource/Portal Update/${encodeURIComponent(id)}`)).data?.data;
    if (!doc || doc.web_account !== webAccountName) return res.status(403).json({
      error: "Not allowed."
    });
    await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, {
      is_deleted: 1,
      status: "Deleted"
    });
    return res.json({
      ok: true
    });
  } catch (err) {
    console.error("DELETE UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to delete update."
    });
  }
});

router.post("/api/portal/updates/bulk-delete", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const {
      ids
    } = req.body || {};
    if (!webAccountName) return res.status(401).json({
      error: "No session account."
    });
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: "Missing ids."
      });
    }
    const client = frappeClient();
    let deleted = 0;
    let skipped = 0;
    for (const idRaw of ids) {
      const id = String(idRaw || "").trim();
      if (!id) continue;

      // Safety: ensure update belongs to this user before mutating
      const docRes = await client.get(`/api/resource/Portal Update/${encodeURIComponent(id)}`);
      const doc = docRes.data?.data;
      if (!doc || doc.web_account !== webAccountName) {
        skipped++;
        continue;
      }
      await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, {
        is_deleted: 1,
        status: "Deleted"
      });
      deleted++;
    }
    return res.json({
      ok: true,
      deleted,
      skipped
    });
  } catch (err) {
    console.error("BULK DELETE UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to bulk delete updates."
    });
  }
});

// --- SERVICE PROVISIONING ACTIVITY (real status/log, no fabricated telemetry) ---

router.get("/api/portal/services/:serviceId/activity", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const { serviceId } = req.params;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });
    if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

    const client = frappeClient();
    // Scoped to the caller's own account server-side — a customer can only ever
    // see provisioning jobs for their own web_account, never another tenant's.
    const resp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["service_id", "=", serviceId],
        ]),
        fields: JSON.stringify([
          "name", "status", "log", "backup_status", "edge_status", "error",
          "attempts", "access", "creation", "modified",
        ]),
        order_by: "modified desc",
        limit_page_length: 20,
      },
    });

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const jobs = rows.map((j) => {
      // access is a JSON string (see doctype-provisioning-job.json) written by
      // whichever lane provisioned the service — coolify writes manageUrl+uuid,
      // bench/mock write url. Normalize to one field so the frontend doesn't
      // need to know the lane-specific shape. Only meaningful once the job is
      // actually active — a queued/failed job has nothing real to link to.
      let accessUrl = "";
      if (j.status === "active" && j.access) {
        try {
          const parsed = JSON.parse(j.access);
          accessUrl = parsed?.url || parsed?.manageUrl || "";
        } catch {
          // malformed/truncated access JSON — degrade to no link, not a crash.
        }
      }
      return {
        id: j.name,
        status: j.status || "",
        log: j.log || "",
        backupStatus: j.backup_status || "",
        edgeStatus: j.edge_status || "",
        error: j.error || "",
        attempts: Number(j.attempts || 0),
        accessUrl,
        createdAt: j.creation || "",
        updatedAt: j.modified || "",
      };
    });

    return res.json({ ok: true, jobs });
  } catch (err) {
    // The Provisioning Job doctype may not be imported yet (see
    // services/provisioning/README.md) — degrade to an empty, honest result
    // rather than a 500.
    if (err?.response?.status === 404 || /doctype/i.test(err?.response?.data?.exception || "")) {
      return res.json({ ok: true, jobs: [] });
    }
    console.error("FETCH SERVICE ACTIVITY ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load service activity." });
  }
});

// --- SERVICE LIFECYCLE ACTIONS (restart / stop / start via Coolify) ---
// Phase 2 of the resource-management dashboard. Scoped to a customer's own
// coolify-lane service. Deliberately does NOT touch the Provisioning Job's
// `status` field (that's provisioning-lifecycle state, not runtime up/down —
// see the plan doc) and does NOT claim to update any "online/offline"
// indicator elsewhere in the portal — success just means the action was
// accepted, not that the service is verified healthy afterward.

// Fetch the most recent Provisioning Job for this account+service and verify
// ownership explicitly (defense in depth beyond the query filter — a write
// action gets a real check, not just a hope the filter returns zero rows).
async function loadOwnedJob(client, webAccountName, serviceId) {
  const resp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", serviceId],
      ]),
      fields: JSON.stringify(["name", "web_account", "service_id", "lane", "status", "external_ref", "log"]),
      order_by: "modified desc",
      limit_page_length: 1,
    },
  });
  const job = resp.data?.data?.[0] || null;
  if (job && job.web_account !== webAccountName) return null; // never trust the filter alone
  return job;
}

async function runServiceAction(req, res, action, laneFn) {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  const { serviceId } = req.params;
  if (!webAccountName) return res.status(401).json({ error: "No session account." });
  if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

  const client = frappeClient();
  let job;
  try {
    job = await loadOwnedJob(client, webAccountName, serviceId);
  } catch (err) {
    if (err?.response?.status === 404 || /doctype/i.test(err?.response?.data?.exception || "")) {
      return res.status(404).json({ error: "This service has no provisioning record yet." });
    }
    console.error(`SERVICE ${action.toUpperCase()} LOOKUP ERROR:`, err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to look up this service." });
  }

  if (!job) {
    return res.status(404).json({ error: "Service not found on your account." });
  }
  if (job.lane !== "coolify") {
    return res.status(422).json({ error: "This service isn't managed through an automated lane yet — contact support." });
  }
  if (!job.external_ref) {
    return res.status(409).json({ error: "This service has no live infrastructure to act on yet." });
  }
  if (job.status !== "active") {
    return res.status(409).json({ error: `Can't ${action} a service that isn't active (current: ${job.status || "unknown"}).` });
  }

  const guardKey = `${job.name}:${action}`;
  if (actionInFlight.has(job.name)) {
    return res.status(429).json({ error: "An action is already in progress for this service." });
  }
  actionInFlight.add(job.name);

  try {
    await laneFn(job.external_ref);

    // Audit trail — required for a customer-initiated action against
    // production infra, not optional. Best-effort: the Coolify call is the
    // source of truth for the action itself, so a failed audit write here
    // shouldn't turn a real success into a customer-facing error — but it
    // must never fail silently server-side.
    const ts = new Date().toISOString();
    const auditLine = `[${ts}] [ACTION] ${action} requested by ${webAccountName}`;
    client
      .put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(job.name)}`, {
        log: job.log ? `${job.log}\n${auditLine}` : auditLine,
      })
      .catch((e) => console.error(`SERVICE ${action.toUpperCase()} AUDIT LOG WRITE FAILED:`, e.response?.data || e.message));

    return res.json({ ok: true, message: `${action[0].toUpperCase()}${action.slice(1)} requested — check back shortly.` });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      console.error(`SERVICE ${action.toUpperCase()} STALE REF:`, job.name, job.external_ref);
      return res.status(409).json({ error: "This service's infrastructure record is out of sync — contact support." });
    }
    console.error(`SERVICE ${action.toUpperCase()} ERROR:`, err.response?.data || err.message);
    return res.status(502).json({ error: `Failed to ${action} this service. Please try again or contact support.` });
  } finally {
    actionInFlight.delete(job.name);
  }
}

router.post("/api/portal/services/:serviceId/restart", requireAuth, serviceActionLimiter, (req, res) =>
  runServiceAction(req, res, "restart", coolifyLane.restart)
);
router.post("/api/portal/services/:serviceId/start", requireAuth, serviceActionLimiter, (req, res) =>
  runServiceAction(req, res, "start", coolifyLane.start)
);
router.post("/api/portal/services/:serviceId/stop", requireAuth, serviceStopLimiter, (req, res) =>
  runServiceAction(req, res, "stop", coolifyLane.stop)
);

// --- REAL USAGE METRICS (Phase 3) ---
// Read-only, so filter-based scoping (web_account+service_id in the Frappe
// query) is sufficient here — no separate ownership check needed, unlike the
// action routes above (see activity endpoint above for the same reasoning).
router.get("/api/portal/services/:serviceId/usage", requireAuth, async (req, res) => {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  const { serviceId } = req.params;
  if (!webAccountName) return res.status(401).json({ error: "No session account." });
  if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

  const client = frappeClient();
  let job;
  try {
    job = await loadOwnedJob(client, webAccountName, serviceId);
  } catch (err) {
    if (err?.response?.status === 404 || /doctype/i.test(err?.response?.data?.exception || "")) {
      return res.json({ ok: true, available: false });
    }
    console.error("SERVICE USAGE LOOKUP ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to look up this service." });
  }

  // Not an error state — most services simply don't have real usage data
  // yet (wrong lane, not provisioned, or Coolify doesn't expose it). The
  // frontend's job is to render "not available," not to alarm the customer.
  if (!job || job.lane !== "coolify" || !job.external_ref || job.status !== "active") {
    return res.json({ ok: true, available: false });
  }

  try {
    const usage = await coolifyLane.getUsage(job.external_ref);
    const available = Object.values(usage).some((v) => v !== null);
    return res.json({ ok: true, available, ...usage });
  } catch (err) {
    // Coolify not exposing this, or a transient error — degrade to
    // "not available," don't surface a scary error for a nice-to-have widget.
    console.warn("SERVICE USAGE FETCH FAILED:", err.response?.data || err.message);
    return res.json({ ok: true, available: false });
  }
});

// --- DOMAIN SELF-SERVICE (Phase 4) ---
// Self-service domain attach for coolify-lane services: the customer already
// owns the domain and has pointed it at our IP; we verify that (a real DNS
// check, not a client-supplied claim) then hand it to Coolify, which
// auto-issues SSL. We never touch DNS ourselves — no registrar API, no
// automated record creation.
const dns = require("dns").promises;

const domainAttachLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

function isValidDomain(domain) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

router.post("/api/portal/services/:serviceId/domain", requireAuth, domainAttachLimiter, async (req, res) => {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  const { serviceId } = req.params;
  const domain = String(req.body?.domain || "").trim().toLowerCase();
  if (!webAccountName) return res.status(401).json({ error: "No session account." });
  if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });
  if (!domain || !isValidDomain(domain)) {
    return res.status(400).json({ error: "Enter a valid domain (e.g. shop.yourbusiness.co.ke)." });
  }

  const serverIp = process.env.COOLIFY_SERVER_IP;
  if (!serverIp) {
    return res.status(503).json({ error: "Domain self-service isn't configured yet — contact support." });
  }

  const client = frappeClient();
  let job;
  try {
    job = await loadOwnedJob(client, webAccountName, serviceId);
  } catch (err) {
    if (err?.response?.status === 404 || /doctype/i.test(err?.response?.data?.exception || "")) {
      return res.status(404).json({ error: "This service has no provisioning record yet." });
    }
    console.error("DOMAIN ATTACH LOOKUP ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to look up this service." });
  }
  if (!job) return res.status(404).json({ error: "Service not found on your account." });
  if (job.lane !== "coolify") {
    return res.status(422).json({ error: "This service isn't managed through an automated lane yet — contact support." });
  }
  if (!job.external_ref || job.status !== "active") {
    return res.status(409).json({ error: "This service isn't live yet — connect your domain once it's active." });
  }

  // Real check, not a client-supplied claim: resolve the domain and confirm
  // it points at our server before ever touching Coolify.
  try {
    const addresses = await dns.resolve4(domain).catch(() => []);
    if (!addresses.includes(serverIp)) {
      return res.status(422).json({
        error: `${domain} doesn't point here yet. Add an A record for ${domain} → ${serverIp}, then try again (DNS can take a few minutes to propagate).`,
      });
    }
  } catch (err) {
    return res.status(422).json({ error: `Couldn't resolve ${domain}. Double-check the domain and try again.` });
  }

  try {
    await coolifyLane.attachDomain(job.external_ref, domain);
    const ts = new Date().toISOString();
    const auditLine = `[${ts}] [DOMAIN] ${domain} attached by ${webAccountName}`;
    client
      .put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(job.name)}`, {
        log: job.log ? `${job.log}\n${auditLine}` : auditLine,
      })
      .catch((e) => console.error("DOMAIN ATTACH AUDIT LOG WRITE FAILED:", e.response?.data || e.message));
    return res.json({ ok: true, message: `${domain} connected — SSL is issuing automatically, usually live within a few minutes.` });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      return res.status(409).json({ error: "This service's infrastructure record is out of sync — contact support." });
    }
    console.error("DOMAIN ATTACH ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Failed to connect this domain. Please try again or contact support." });
  }
});

// --- WEBSITE HOSTING ---

  return router;
};
