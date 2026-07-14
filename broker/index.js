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
const { verify } = require("./lib/token");
const docker = require("./lib/dockerClient");
const { resolveOwnedContainerId, containerMatchesOwner } = require("./lib/resolve");

const PORT = Number(process.env.BROKER_PORT || 4600);
const ENABLED = String(process.env.TERMINAL_ENABLED || "false").toLowerCase() === "true";
const API_KEY = process.env.BROKER_API_KEY || "";
const SIGNING_KEY = process.env.BROKER_SIGNING_KEY || "";

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

  return json(res, 404, { error: "Not found." });
});

// The exec WebSocket upgrade lands here in P5.2/P5.3. Scaffolded closed so the
// endpoint exists but never half-opens a shell before the jail/recording do.
server.on("upgrade", (req, socket) => {
  socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
  socket.destroy();
});

if (require.main === module) {
  if (!SIGNING_KEY && ENABLED) {
    console.error("[broker] TERMINAL_ENABLED=true but BROKER_SIGNING_KEY unset — refusing to start.");
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`[broker] listening on :${PORT} (terminal ${ENABLED ? "ENABLED" : "disabled"})`);
  });
}

module.exports = { server, resolveForToken };
