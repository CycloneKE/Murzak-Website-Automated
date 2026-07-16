/**
 * Docker Engine API client — talks ONLY to the docker-socket-proxy, never to
 * /var/run/docker.sock directly. The proxy (Tecnativa-style) is configured to
 * allow only the verbs this broker needs (containers list/inspect, exec
 * create/start) and to reject container CREATE, image/volume/network ops, and
 * privileged/bind-mount payloads — so even a full broker compromise can't spin
 * up a `-v /:/host --privileged` escape container.
 *
 * ⚠️ UNVERIFIED AGAINST A LIVE DOCKER HOST. These are the documented Docker
 * Engine API v1.4x shapes, but the exec *stream* (a hijacked bidirectional
 * connection) cannot be exercised from a dev machine — same VPS-only
 * constraint as the rest of the Coolify integration. The stream code below is
 * real (raw http upgrade, not a stub), but its first live run is on the VPS;
 * treat any exec failure as real, never as success.
 */

const axios = require("axios");
const nodeHttp = require("http");
const { URL } = require("url");

function base() {
  // e.g. http://docker-socket-proxy:2375 (internal network only)
  const url = process.env.DOCKER_PROXY_URL;
  if (!url) throw new Error("DOCKER_PROXY_URL is not set (docker-socket-proxy endpoint).");
  return url.replace(/\/+$/, "");
}

function http() {
  return axios.create({
    baseURL: base(),
    timeout: Number(process.env.DOCKER_PROXY_TIMEOUT_MS || 15000),
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /containers/json — running containers (used for ownership resolution). */
async function listContainers() {
  const res = await http().get("/containers/json", { params: { all: false } });
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * GET /containers/{id}/json — single-container inspect. Used for the TOCTOU
 * recheck: between resolving an id from the list and exec'ing into it, the
 * container could have been recreated/renamed, so we re-confirm the ownership
 * label on the concrete id immediately before exec.
 */
async function inspectContainer(id) {
  const res = await http().get(`/containers/${encodeURIComponent(id)}/json`);
  return res.data || null;
}

/** POST /containers/{id}/exec — create an exec instance, returns its id. */
async function createExec(containerId, payload) {
  const res = await http().post(`/containers/${encodeURIComponent(containerId)}/exec`, payload);
  const id = res.data && (res.data.Id || res.data.id);
  if (!id) throw new Error("exec create returned no id");
  return String(id);
}

/**
 * POST /exec/{execId}/start with Tty:true — HIJACKS the HTTP connection into a
 * raw bidirectional stream (the shell's stdin/stdout). Resolves with the raw
 * duplex socket; the caller (broker WS handler) bridges it to the browser and
 * is responsible for destroying it. Uses the node http module (not axios,
 * which can't surface the hijacked socket) against the proxy.
 *
 * ⚠️ First live exercise is on the VPS (see file header). If the proxy or path
 * is wrong this rejects/emits 'error' — the caller must treat that as a real
 * failure and close the browser side, never pretend a shell opened.
 */
function startExecStream(execId) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(`${base()}/exec/${encodeURIComponent(execId)}/start`);
    } catch (e) {
      return reject(e);
    }
    const body = JSON.stringify({ Detach: false, Tty: true });
    const req = nodeHttp.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Ask Docker to hijack this connection into a raw stream.
        Connection: "Upgrade",
        Upgrade: "tcp",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: Number(process.env.DOCKER_EXEC_TIMEOUT_MS || 0) || 0,
    });
    // Docker responds to a hijack with a 101/'upgrade' OR just streams on the
    // socket after a 200 — handle both.
    req.on("upgrade", (_res, socket) => resolve(socket));
    req.on("connect", (_res, socket) => resolve(socket));
    req.on("response", (res) => {
      // Non-hijack response (e.g. 404/409/500) — collect and reject.
      if (res.statusCode >= 400) {
        let d = "";
        res.on("data", (c) => { if (d.length < 2048) d += c; });
        res.on("end", () => reject(new Error(`exec start failed: ${res.statusCode} ${d}`)));
        return;
      }
      // 200 with a streaming body (older behaviour) — the response socket is
      // the duplex stream.
      resolve(res.socket);
    });
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * POST /exec/{execId}/resize?h=&w= — resize a live exec's TTY. Plain
 * request/response (no hijack) — the exec is already streaming via its own
 * startExecStream() socket; this just tells Docker the new terminal size.
 */
async function resizeExec(execId, cols, rows) {
  await http().post(`/exec/${encodeURIComponent(execId)}/resize`, null, {
    params: { h: rows, w: cols },
  });
}

/**
 * Create + start a SHORT-LIVED, non-interactive exec, collect its output
 * until the stream ends, then resolve with the collected text. For
 * housekeeping commands (the P5.4 orphan reaper) — NOT for the interactive
 * shell path, which stays open for the session's lifetime via
 * startExecStream() directly.
 */
async function runExecAndCollect(containerId, payload, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10000;
  const execId = await createExec(containerId, payload);
  const stream = await startExecStream(execId);
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { stream.destroy(); } catch {}
      reject(new Error("exec collect timed out"));
    }, timeoutMs);
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(out);
    };
    stream.on("data", (c) => { if (out.length < 8192) out += c.toString("utf8"); });
    stream.on("close", () => finish());
    stream.on("end", () => finish());
    stream.on("error", (e) => finish(e));
  });
}

module.exports = { listContainers, inspectContainer, createExec, startExecStream, resizeExec, runExecAndCollect, base };
