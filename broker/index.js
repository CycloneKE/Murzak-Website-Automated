/**
 * Terminal broker — a deliberately tiny, single-purpose service that is the
 * ONLY thing on the box permitted to reach the docker-socket-proxy. It is
 * NOT internet-facing: only the payment backend reaches it over the internal
 * docker network. Keeping it separate from the backend converts "one backend
 * RCE = full host + payments compromise" into "need two independent
 * compromises" (see how-does-one-create-deep-kazoo.md §Phase 5).
 *
 * It holds NO Frappe / PayPal creds and only the BROKER_SIGNING_KEY. Its whole
 * job: given a broker-signed token, resolve the token's container by EXACT
 * ownership label, TOCTOU-recheck it, and (from P5.3) open a jailed exec
 * stream. This file is the P5.1 scaffold: HTTP surface + resolution wiring +
 * the exec seam, all inert unless TERMINAL_ENABLED=true.
 */

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { verify } = require("./lib/token");
const docker = require("./lib/dockerClient");
const { resolveOwnedContainerId, containerMatchesOwner } = require("./lib/resolve");
const { buildExecCreatePayload, SessionManager } = require("./lib/exec");
const reaper = require("./lib/reaper");
const s3Upload = require("./lib/s3Upload");
const backendReport = require("./lib/backendReport");

const PORT = Number(process.env.BROKER_PORT || 4600);
const ENABLED = String(process.env.TERMINAL_ENABLED || "false").toLowerCase() === "true";
const API_KEY = process.env.BROKER_API_KEY || "";
const SIGNING_KEY = process.env.BROKER_SIGNING_KEY || "";
const EXEC_WS_PATH = "/exec";

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Shared-secret gate for the internal backend→broker calls. Constant-time-ish;
// the real defense is the internal-only network, this is defense in depth.
function backendAuthed(req) {
  const got = req.headers["x-broker-key"];
  return API_KEY && got === API_KEY;
}

/**
 * Resolve + TOCTOU-recheck a token's container. Pure of transport so P5.2's WS
 * upgrade handler and any test can drive it. Throws on any ownership doubt.
 */
async function resolveForToken(token) {
  const payload = verify(token, SIGNING_KEY);
  const expectedName = payload.expectedName;
  if (!expectedName) {
    const e = new Error("Token missing expectedName."); e.code = "MALFORMED"; throw e;
  }

  // 1) Resolve by exact ownership among running containers.
  const containers = await docker.listContainers();
  const { id } = resolveOwnedContainerId(containers, expectedName);

  // 2) TOCTOU recheck: re-inspect the concrete id and confirm it STILL owns
  //    the expected name (a container could be recreated between list & exec).
  const inspected = await docker.inspectContainer(id);
  const asContainer = inspected && {
    Id: inspected.Id,
    Names: inspected.Name ? [inspected.Name] : [],
    Labels: (inspected.Config && inspected.Config.Labels) || {},
  };
  if (!asContainer || !containerMatchesOwner(asContainer, expectedName)) {
    const e = new Error("Container ownership changed between resolve and exec."); e.code = "TOCTOU"; throw e;
  }

  return { containerId: id, payload };
}

const server = http.createServer(async (req, res) => {
  // Health — always available so compose/monitoring can probe the broker even
  // when the terminal feature is disabled.
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, enabled: ENABLED });
  }

  if (!ENABLED) return json(res, 503, { error: "Terminal feature disabled." });
  if (!backendAuthed(req)) return json(res, 401, { error: "Unauthorized." });

  // Diagnostic-only resolve endpoint (no exec) — lets P5.1 verification confirm
  // the resolve+recheck path against a real proxy from inside the VPS without
  // opening a shell. Body: { token }.
  if (req.method === "POST" && req.url === "/resolve") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on("end", async () => {
      try {
        const { token } = JSON.parse(raw || "{}");
        const { containerId } = await resolveForToken(token);
        return json(res, 200, { ok: true, containerId });
      } catch (e) {
        return json(res, 400, { error: e.message, code: e.code || null });
      }
    });
    return;
  }

  // Admin kill-switch (P5.4) — backend calls this after verifying the
  // requester is an admin AND the session belongs to a live Terminal Session
  // row; the broker itself does no further authorization, only the shared
  // internal-key gate already checked above.
  const killMatch = req.method === "POST" && req.url.match(/^\/sessions\/([a-f0-9]+)\/kill$/);
  if (killMatch) {
    const sessionId = killMatch[1];
    if (!liveSockets.has(sessionId)) {
      return json(res, 404, { error: "No live session with that id." });
    }
    teardown(sessionId, "admin_killed");
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found." });
});

// ---- Exec WebSocket: the jailed shell bridge (P5.3) ----
// The backend (already having authenticated the customer + minted the token)
// connects here with the broker token. We: verify → resolve+TOCTOU-recheck the
// container → create a NON-ROOT exec → hijack the Docker stream → bridge it to
// this WS, under session caps (idle/absolute/concurrency). Session recording
// (P5.4) taps the same byte streams; a `record` hook is left where it attaches.
const sessions = new SessionManager({
  onExpire: (sid, reason) => {
    const s = liveSockets.get(sid);
    if (s) {
      try { s.ws.send(JSON.stringify({ type: "notice", message: `Session ended: ${reason.replace("_", " ")}.` })); } catch {}
      teardown(sid, reason);
    }
  },
});
// sessionId -> { ws, dockerStream, execId, containerId, meta, recordChunks,
// recordBytes } so the SessionManager's expiry can reach the live transport
// to kill it, resize can target the right exec, and teardown has what it
// needs to report the outcome + flush the recording.
const liveSockets = new Map();

// Containers this broker process has exec'd into at least once — the
// orphan reaper's sweep universe (see lib/reaper.js). Only covers containers
// touched since this process started.
const containersEverUsed = new Set();

// Recordings are capped in memory to stay bounded regardless of session
// length — past this, further bytes are dropped from the recording (the
// live stream itself is never truncated, only what gets persisted).
const RECORDING_MAX_BYTES = Number(process.env.TERMINAL_RECORDING_MAX_BYTES || 2 * 1024 * 1024);

function recordChunk(sessionId, direction, chunk) {
  const live = liveSockets.get(sessionId);
  if (!live || !live.recordChunks) return;
  if (live.recordBytes >= RECORDING_MAX_BYTES) return;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  live.recordChunks.push({ t: Date.now(), d: direction, b: buf.toString("base64") });
  live.recordBytes += buf.length;
}

async function flushRecordingAndReport(sessionId, meta, recordChunks, byteCount, exitReason) {
  let recordingKey = "";
  try {
    if (recordChunks.length && s3Upload.isConfigured()) {
      recordingKey = `sessions/${meta.jobName}/${sessionId}.ndjson`;
      const body = recordChunks.map((c) => JSON.stringify(c)).join("\n");
      await s3Upload.putObject(recordingKey, body);
    }
  } catch (e) {
    console.error(`[broker] recording upload failed for ${sessionId}:`, e.message);
    recordingKey = ""; // don't report a key that doesn't actually exist in the bucket
  }

  const endedAt = Date.now();
  await backendReport.reportSessionEnd({
    sessionId,
    exitReason,
    endedAt: new Date(endedAt).toISOString(),
    durationSeconds: Math.max(0, Math.round((endedAt - meta.startedAt) / 1000)),
    byteCount,
    recordingKey,
  });
}

function teardown(sessionId, reason) {
  const live = liveSockets.get(sessionId);
  if (live) {
    try { live.dockerStream && live.dockerStream.destroy(); } catch {}
    try { live.ws && live.ws.close(1000, "session_end"); } catch {}
    liveSockets.delete(sessionId);
    // Best-effort, fire-and-forget — must never block or throw into the
    // synchronous teardown path (called from WS/stream event handlers).
    flushRecordingAndReport(sessionId, live.meta, live.recordChunks || [], live.recordBytes || 0, reason || "unknown").catch(() => {});
  }
  sessions.close(sessionId);
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { socket.destroy(); return; }
  if (url.pathname !== EXEC_WS_PATH) { socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return; }
  if (!ENABLED) { socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"); socket.destroy(); return; }

  // Auth: broker token (query param) + the internal shared key (header).
  if (!API_KEY || req.headers["x-broker-key"] !== API_KEY) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return;
  }
  const token = url.searchParams.get("token");

  let containerId, payload;
  try {
    const r = await resolveForToken(token);
    containerId = r.containerId;
    payload = r.payload;
  } catch (e) {
    console.warn("[broker] exec auth/resolve rejected:", e.code || e.message);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
  }

  // Concurrency caps BEFORE we spend a Docker exec.
  const sessionId = crypto.randomBytes(12).toString("hex");
  try {
    sessions.open(sessionId, payload.webAccount);
  } catch (e) {
    console.warn("[broker] session cap:", e.code);
    socket.write(`HTTP/1.1 429 Too Many Requests\r\n\r\n`); socket.destroy(); return;
  }

  wss.handleUpgrade(req, socket, head, async (ws) => {
    let dockerStream, execId;
    try {
      execId = await docker.createExec(containerId, buildExecCreatePayload({ sessionId }));
      dockerStream = await docker.startExecStream(execId);
    } catch (e) {
      console.error("[broker] exec open failed:", e.message);
      try { ws.send(JSON.stringify({ type: "error", message: "Could not open a shell for this service. Contact support." })); } catch {}
      ws.close(1011, "exec_failed");
      sessions.close(sessionId);
      return;
    }

    const startedAt = Date.now();
    const meta = { webAccount: payload.webAccount, jobName: payload.jobName, containerName: payload.expectedName, startedAt };
    liveSockets.set(sessionId, { ws, dockerStream, execId, containerId, meta, recordChunks: [], recordBytes: 0 });
    // Tracked so the orphan reaper knows which containers to sweep — only
    // covers containers touched since this broker process started (a fresh
    // deploy/restart resets the set; a documented, not hidden, limitation).
    containersEverUsed.add(containerId);
    backendReport.reportSessionStart({
      sessionId,
      webAccount: meta.webAccount,
      jobName: meta.jobName,
      containerName: meta.containerName,
      startedAt: new Date(startedAt).toISOString(),
    }).catch(() => {});

    // Docker stdout/stderr -> browser (binary frames pass through untouched).
    dockerStream.on("data", (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
      recordChunk(sessionId, "out", chunk);
    });
    dockerStream.on("close", () => teardown(sessionId, "shell_exited"));
    dockerStream.on("error", () => teardown(sessionId, "stream_error"));

    // Browser stdin -> Docker; control frames (resize) handled as JSON.
    ws.on("message", (data, isBinary) => {
      sessions.touch(sessionId);
      if (!isBinary) {
        // A small JSON control channel for terminal resize; anything else is
        // treated as raw keystrokes.
        try {
          const msg = JSON.parse(data.toString());
          if (msg && msg.type === "resize") {
            // Clamp to sane bounds — this is untrusted client input reaching
            // a real Docker API call.
            const cols = Math.min(Math.max(parseInt(msg.cols, 10) || 0, 1), 500);
            const rows = Math.min(Math.max(parseInt(msg.rows, 10) || 0, 1), 500);
            docker.resizeExec(execId, cols, rows).catch((e) => console.warn("[broker] resize failed:", e.message));
            return;
          }
        } catch { /* not JSON -> raw input */ }
      }
      try { dockerStream.write(data); } catch {}
      recordChunk(sessionId, "in", data);
    });
    ws.on("close", () => teardown(sessionId, "client_closed"));
    ws.on("error", () => teardown(sessionId, "client_error"));

    ws.send(JSON.stringify({ type: "ready" }));
  });
});

if (require.main === module) {
  if (!SIGNING_KEY && ENABLED) {
    console.error("[broker] TERMINAL_ENABLED=true but BROKER_SIGNING_KEY unset — refusing to start.");
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`[broker] listening on :${PORT} (terminal ${ENABLED ? "ENABLED" : "disabled"})`);
  });

  // Orphan-process reaper (P5.4 gap-close, see lib/reaper.js). Only runs
  // when the terminal feature is enabled; harmless no-op sweeps once no
  // container has ever had a session.
  if (ENABLED) {
    const REAPER_INTERVAL_MS = Math.max(60000, Number(process.env.TERMINAL_REAPER_INTERVAL_MS || 5 * 60 * 1000));
    setInterval(() => {
      const containerIds = Array.from(containersEverUsed);
      if (!containerIds.length) return;
      const liveSessionIds = Array.from(liveSockets.keys());
      reaper
        .sweepAll(containerIds, liveSessionIds, docker)
        .then((s) => {
          if (s.errors > 0) console.warn(`[broker] reaper sweep: ${s.swept} ok, ${s.errors} errors`);
        })
        .catch((e) => console.error("[broker] reaper sweep crashed:", e.message));
    }, REAPER_INTERVAL_MS).unref();
  }
}

module.exports = { server, resolveForToken };
