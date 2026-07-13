
const express = require('express');

module.exports = function(ctx) {
  const {
    frappeClient,
    getWebAccountByEmail,
    mysqlDatetimeUTC,
    requireAuth,
    upload,
    userOwnsPrivateFile,
    PROVISIONING_JOB_DOCTYPE
  } = ctx;

  const router = express.Router();

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
          "attempts", "creation", "modified",
        ]),
        order_by: "modified desc",
        limit_page_length: 20,
      },
    });

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const jobs = rows.map((j) => ({
      id: j.name,
      status: j.status || "",
      log: j.log || "",
      backupStatus: j.backup_status || "",
      edgeStatus: j.edge_status || "",
      error: j.error || "",
      attempts: Number(j.attempts || 0),
      createdAt: j.creation || "",
      updatedAt: j.modified || "",
    }));

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

// --- WEBSITE HOSTING ---

  return router;
};
