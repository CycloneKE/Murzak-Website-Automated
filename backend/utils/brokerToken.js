/**
 * Broker token signing (backend side) — MUST stay byte-for-byte compatible
 * with broker/lib/token.js's verify(). Duplicated rather than shared via a
 * relative require because backend/ and broker/ are separate deploy images
 * (the repo-root Dockerfile only COPYs backend/); a shared npm workspace is
 * more machinery than one ~30-line crypto utility warrants.
 *
 * Signed with BROKER_SIGNING_KEY — a secret distinct from SESSION_SECRET,
 * shared only between backend and broker (not the browser). This is the
 * token the broker's resolveForToken() verifies to authorize which
 * container an exec session may reach; see lib/resolve.js on the broker
 * side for the actual per-container authorization enforcement.
 */

const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function signBrokerToken(payload, key) {
  if (!key) throw new Error("BROKER_SIGNING_KEY is not set.");
  const body = b64urlJson(payload);
  const mac = b64url(crypto.createHmac("sha256", key).update(body).digest());
  return `${body}.${mac}`;
}

module.exports = { signBrokerToken };
