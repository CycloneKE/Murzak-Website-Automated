/**
 * WebSocket connect tickets — the browser<->backend auth layer for the
 * terminal feature, distinct from the backend<->broker token
 * (utils/brokerToken.js). A raw cookie-authed WebSocket is NOT enough here:
 * `express` middleware (including session parsing) doesn't run on the raw
 * 'upgrade' event, so the upgrade handler needs its own signed, single-use,
 * short-lived credential — then ALSO re-checks the session cookie once it
 * manually loads it (see server.js terminal upgrade handler), so a leaked
 * ticket alone is not sufficient without also holding the live session.
 *
 * Signed with SESSION_SECRET (the same trust boundary as the session itself
 * — this ticket only ever authorizes talking to OUR OWN backend, never the
 * broker). Single-use tracking is in-memory (documented single-instance
 * limitation, same as the restart/stop/start in-flight guard in
 * routes/portalRoutes.js) — a multi-instance deployment would need this in
 * Redis instead.
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

// jti -> payload, for single-use consumption. Expired entries are swept
// lazily (checked on every mint/consume) rather than via a timer.
const pending = new Map();

function sweep(now = Date.now()) {
  for (const [jti, entry] of pending) {
    if (entry.exp < now) pending.delete(jti);
  }
}

/** Mint a single-use ticket good for `ttlMs` (default 45s). */
function mintWsTicket(payload, key, ttlMs = 45000) {
  if (!key) throw new Error("SESSION_SECRET is not set.");
  sweep();
  const jti = crypto.randomBytes(16).toString("hex");
  const exp = Date.now() + ttlMs;
  const full = { ...payload, jti, exp };
  const body = b64urlJson(full);
  const mac = b64url(crypto.createHmac("sha256", key).update(body).digest());
  pending.set(jti, full);
  return `${body}.${mac}`;
}

/**
 * Verify signature + expiry + single-use (consumes on success — a second
 * call with the same ticket fails with ALREADY_USED). Returns the payload.
 */
function consumeWsTicket(ticket, key) {
  if (!key) throw new Error("SESSION_SECRET is not set.");
  if (typeof ticket !== "string" || !ticket.includes(".")) {
    const e = new Error("Malformed ticket."); e.code = "MALFORMED"; throw e;
  }
  const [body, mac] = ticket.split(".");
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
  if (!payload.exp || Date.now() > Number(payload.exp)) {
    const e = new Error("Ticket expired."); e.code = "EXPIRED"; throw e;
  }
  if (!pending.has(payload.jti)) {
    const e = new Error("Ticket already used or unknown."); e.code = "ALREADY_USED"; throw e;
  }
  pending.delete(payload.jti);
  return payload;
}

module.exports = { mintWsTicket, consumeWsTicket, _pendingSizeForTest: () => pending.size };
