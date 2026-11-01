// services/email/mailAccess.js
//
// How a business-email customer reaches their own setup without a portal login:
//
//   1. A signed "magic link" token (HMAC-SHA256 over the order name + expiry,
//      keyed by MAIL_LINK_SECRET, 30 days). It identifies one order and nothing else.
//   2. A 6-digit confirmation code, emailed to the order's contact address, that
//      guards sensitive changes (password resets, adding a mailbox). Only the
//      HMAC of the code, its expiry and an attempt counter are stored on
//      mailSetup.codeChallenge. The code itself is never stored or logged.
//
// Without MAIL_LINK_SECRET, signing throws and verification refuses everything.

const crypto = require("crypto");
const { mergeMailSetup } = require("./mailSetupStore");

const TOKEN_LIFE_MS = 30 * 24 * 3600 * 1000;
const CODE_LIFE_MS = 10 * 60 * 1000;
const CODE_ISSUE_GAP_MS = 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const ORDER_DOCTYPE = "Checkout Order";

function secret() {
  const s = process.env.MAIL_LINK_SECRET;
  return typeof s === "string" && s.length > 0 ? s : null;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function coded(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/** A url-safe token for one order, valid for 30 days from `now`. Throws if MAIL_LINK_SECRET is unset. */
function signOrderToken(orderName, now = Date.now()) {
  const key = secret();
  if (!key) throw new Error("MAIL_LINK_SECRET is not configured");
  if (typeof orderName !== "string" || !orderName) throw new Error("orderName is required");
  const payload = b64u(JSON.stringify({ o: orderName, e: now + TOKEN_LIFE_MS }));
  return `${payload}.${b64u(hmac(key, payload))}`;
}

/** @returns {{ok: true, orderName: string} | {ok: false}} Never throws. */
function verifyOrderToken(token, now = Date.now()) {
  try {
    const key = secret();
    if (!key || typeof token !== "string" || token.length > 1024) return { ok: false };
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false };
    const [payload, sig] = parts;
    if (!safeEqual(b64u(hmac(key, payload)), sig)) return { ok: false };
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data.o !== "string" || !data.o || typeof data.e !== "number") return { ok: false };
    if (!(now < data.e)) return { ok: false };
    return { ok: true, orderName: data.o };
  } catch {
    return { ok: false };
  }
}

/** The customer's status page link. Throws if MAIL_LINK_SECRET is unset. */
function statusUrlFor(orderName) {
  const base = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/mail/status/${signOrderToken(orderName)}`;
}

/** The order's mailSetup, or null when the order (or its mail setup) does not exist. */
async function loadMailSetup(client, orderName) {
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderName)}`);
    const doc = res.data && res.data.data;
    if (!doc) return null;
    let cfg = {};
    try { cfg = JSON.parse(doc.config_json || "{}") || {}; } catch { cfg = {}; }
    return cfg.mailSetup && typeof cfg.mailSetup === "object" ? cfg.mailSetup : null;
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    throw e;
  }
}

// Serialises read-modify-write on one order inside this process, so two requests
// cannot both spend the same single-use code or overwrite each other's mailbox list.
const locks = new Map();
function withOrderLock(orderName, fn) {
  const prev = locks.get(orderName) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(orderName, tail);
  tail.then(() => { if (locks.get(orderName) === tail) locks.delete(orderName); });
  return run;
}

const PURPOSES = Object.freeze(["reset", "add"]);

function codeHash(orderName, purpose, code) {
  const key = secret();
  if (!key) throw new Error("MAIL_LINK_SECRET is not configured");
  return hmac(key, `code:${orderName}:${purpose}:${code}`).toString("hex");
}

async function defaultSendCodeEmail(args) {
  const mailer = require("../../utils/mailer");
  if (typeof mailer.sendMailCodeEmail !== "function") {
    console.warn("[mail-access] sendMailCodeEmail is not configured; confirmation code not sent");
    return;
  }
  await mailer.sendMailCodeEmail(args);
}

/**
 * Create and email a fresh 6-digit code. One issue per order per 60 seconds.
 * @param {object} deps {sendCodeEmail({to, code, businessName}), now() -> ms}
 */
function issueCode(client, orderName, deps = {}) {
  return withOrderLock(orderName, async () => {
    const now = deps.now ? deps.now() : Date.now();
    const send = deps.sendCodeEmail || defaultSendCodeEmail;
    const setup = await loadMailSetup(client, orderName);
    if (!setup) throw coded("mail_setup_missing", "This order has no mail setup.", 404);
    if (setup.codeIssuedAt && now - setup.codeIssuedAt < CODE_ISSUE_GAP_MS) {
      throw coded("code_rate_limited", "A code was just sent. Please wait a minute before asking for another.", 429);
    }
    const purpose = deps.purpose || "reset";
    if (!PURPOSES.includes(purpose)) throw coded("bad_code_purpose", "Unknown code purpose.", 400);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    await mergeMailSetup(client, orderName, {
      codeIssuedAt: now,
      codeChallenge: { hash: codeHash(orderName, purpose, code), expiresAt: now + CODE_LIFE_MS, attempts: 0 },
    });
    try {
      await send({ to: setup.contactEmail, code, purpose, businessName: setup.businessName });
    } catch (e) {
      // Nothing was delivered: drop the challenge and the gap so the customer can retry.
      await mergeMailSetup(client, orderName, { codeIssuedAt: null, codeChallenge: null });
      throw e;
    }
  });
}

/** True for a code field that was actually supplied (not missing or blank). */
function hasCode(code) {
  return (typeof code === "string" || typeof code === "number") && String(code).trim() !== "";
}

/**
 * verifyCode for a caller that ALREADY holds withOrderLock(orderName). A missing
 * or blank code returns false without touching the challenge. `deps.purpose`
 * ('reset' default, or 'add') must match the purpose the code was issued for.
 */
async function verifyCodeInLock(client, orderName, code, deps = {}) {
  if (!hasCode(code)) return false;
  const now = deps.now ? deps.now() : Date.now();
  const purpose = deps.purpose || "reset";
  const setup = await loadMailSetup(client, orderName);
  const ch = setup && setup.codeChallenge;
  if (!ch || typeof ch.hash !== "string") return false;
  if (now >= ch.expiresAt || (ch.attempts || 0) >= CODE_MAX_ATTEMPTS) {
    await mergeMailSetup(client, orderName, { codeChallenge: null });
    return false;
  }
  const attempts = (ch.attempts || 0) + 1;
  const given = String(code).trim();
  const match = PURPOSES.includes(purpose) && /^\d{6}$/.test(given) && safeEqual(codeHash(orderName, purpose, given), ch.hash);
  if (match) {
    await mergeMailSetup(client, orderName, { codeChallenge: null });
    return true;
  }
  await mergeMailSetup(client, orderName, {
    codeChallenge: attempts >= CODE_MAX_ATTEMPTS ? null : { ...ch, attempts },
  });
  return false;
}

/** True when `code` matches the live challenge. Single use; 5 wrong tries invalidate it. Never throws on bad input. */
function verifyCode(client, orderName, code, deps = {}) {
  return withOrderLock(orderName, () => verifyCodeInLock(client, orderName, code, deps));
}

module.exports = {
  TOKEN_LIFE_MS,
  CODE_LIFE_MS,
  CODE_ISSUE_GAP_MS,
  CODE_MAX_ATTEMPTS,
  signOrderToken,
  verifyOrderToken,
  statusUrlFor,
  loadMailSetup,
  withOrderLock,
  issueCode,
  hasCode,
  PURPOSES,
  verifyCode,
  verifyCodeInLock,
};
