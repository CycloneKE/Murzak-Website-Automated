/**
 * Docker Engine API client — talks ONLY to the docker-socket-proxy, never to
 * /var/run/docker.sock directly. The proxy (Tecnativa-style) is configured to
 * allow only the verbs this broker needs (containers list/inspect, exec
 * create/start) and to reject container CREATE, image/volume/network ops, and
 * privileged/bind-mount payloads — so even a full broker compromise can't spin
 * up a `-v /:/host --privileged` escape container.
 *
 * ⚠️ SCAFFOLDING / UNVERIFIED AGAINST A LIVE DOCKER HOST. These are the
 * documented Docker Engine API v1.4x shapes, but nothing here has run against
 * the real proxy yet — the exec *stream* (hijacked bidirectional connection)
 * is stubbed for P5.3, where node-pty / a raw upgraded socket replaces the
 * placeholder. This phase implements list + inspect (enough to prove the
 * resolve → TOCTOU-recheck path) and leaves a clearly-marked exec seam.
 */

const axios = require("axios");

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

/**
 * P5.3 SEAM — not implemented in scaffolding. The real exec is:
 *   POST /containers/{id}/exec  { AttachStdin/out/err, Tty, User, Cmd }
 *   POST /exec/{execId}/start   { Tty: true }  -> HIJACKED bidirectional stream
 * bridged to the browser WebSocket. Left as an explicit throw so nothing
 * silently half-works before the jail/caps/recording of P5.3–P5.4 exist.
 */
async function execStream() {
  throw new Error("exec stream not implemented until P5.3 (jail + PTY + recording).");
}

module.exports = { listContainers, inspectContainer, execStream, base };
