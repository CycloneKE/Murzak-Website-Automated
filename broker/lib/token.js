/**
 * Broker token verification.
 *
 * Two-key design (see how-does-one-create-deep-kazoo.md §Phase 5): the broker
 * signs its OWN connect tokens with BROKER_SIGNING_KEY — a secret distinct
 * from the backend's SESSION_SECRET — so a compromise of the payment backend
 * cannot forge a token that makes the broker exec into a container. The
 * backend asks the broker to mint (over the internal network + a shared
 * BROKER_API_KEY), the broker mints and later verifies.
 *
 * Token payload (HMAC-SHA256 over a compact JSON, base64url):
 *   { containerId, expectedName, webAccount, jobName, jti, exp }
 * Single-use is enforced by the caller consuming `jti` (in Redis or memory);
 * this module only does signing + signature/exp validation.
 */

const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64urlJson(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

function sign(payload, key) {
  if (!key) throw new Error("BROKER_SIGNING_KEY is not set.");
  const body = b64urlJson(payload);
  const mac = b64url(crypto.createHmac("sha256", key).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verify signature + expiry. Returns the payload on success, throws otherwise.
 * Uses timingSafeEqual to avoid leaking the MAC via comparison timing.
 * nowMs is injectable for tests.
 */
function verify(token, key, nowMs = Date.now()) {
  if (!key) throw new Error("BROKER_SIGNING_KEY is not set.");
  if (typeof token !== "string" || !token.includes(".")) {
    const e = new Error("Malformed token."); e.code = "MALFORMED"; throw e;
  }
  const [body, mac] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", key).update(body).digest());
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const e = new Error("Bad signature."); e.code = "BAD_SIG"; throw e;
  }
  let payload;
  try {
    payload = fromB64urlJson(body);
  } catch {
    const e = new Error("Undecodable payload."); e.code = "MALFORMED"; throw e;
  }
  if (!payload.exp || nowMs > Number(payload.exp)) {
    const e = new Error("Token expired."); e.code = "EXPIRED"; throw e;
  }
  return payload;
}

module.exports = { sign, verify, b64url };
