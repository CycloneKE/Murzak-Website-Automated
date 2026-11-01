// routes/mailRoutes.js
//
// /api/mail/status/:token - the customer's no-login view of their business
// email setup. The token (services/email/mailAccess.js) names one order. Reads
// need only the token. A mailbox's FIRST password needs nothing else; later
// password resets and adding a mailbox also need a 6-digit code emailed to the
// order's contact address (purpose-bound: 'reset' or 'add').
//
// Rules this file keeps:
//  - A bad, tampered, expired or unknown token all return the same 404 body.
//  - No endpoint takes a mailbox or account id: only a local part, which must
//    already be one of THIS order's mailboxes, resolved here to an account on
//    THIS order's domain (the facade re-checks that the account is on the domain).
//  - Responses never carry Stalwart ids, hashes, secrets or the code, and a
//    failed stage never shows technical detail.
//  - Passwords are passed straight to the provider: never stored, never logged.
//  - Every write decides on a fresh read taken inside the per-order lock.

const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const mailAccess = require("../services/email/mailAccess");
const mailInput = require("../services/email/mailInput");
const mailProvider = require("../services/email/mailProvider");
const stalwart = require("../services/email/stalwartClient");
const mailSetupStore = require("../services/email/mailSetupStore");
const mailboxPolicy = require("../services/mailboxPolicy");
const emailPlans = require("../config/emailPlans");

const WRITABLE_STATES = new Set(["provisioned", "live"]);
const NEEDS_ATTENTION_MESSAGE = "Your setup needs a quick check by our team. We will email you within one working day.";
const NOT_VALID = Object.freeze({ error: "This link is not valid." });
const BAD_CODE = "That code is not valid. Request a new one and try again.";
const NOT_READY = Object.freeze({ error: "Your email is not ready for changes yet." });

const STAGES = Object.freeze([
  { id: "payment", label: "Payment confirmed" },
  { id: "domain", label: "Your domain" },
  { id: "mail", label: "Mail is ready" },
  { id: "webmail", label: "Webmail is ready" },
]);

function limiter(max, windowMs, message) {
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });
}

/** Stage list and overall state, derived from mailSetup. Failure detail is never exposed. */
function viewStages(setup) {
  const progress = setup.progress || {};
  const stages = STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    state: ["pending", "running", "done", "failed"].includes(progress[s.id]) ? progress[s.id] : "pending",
  }));
  const failed = stages.some((s) => s.state === "failed") || setup.state === "needs_attention";
  return { stages, state: failed ? "needs_attention" : setup.state };
}

function planInfo(setup) {
  const plan = emailPlans.isMailPlan(setup.planId) ? emailPlans.PLANS[setup.planId] : null;
  return {
    planId: plan ? plan.id : null,
    mailboxLimit: plan ? plan.mailboxes : 0,
    mailboxCount: Array.isArray(setup.mailboxes) ? setup.mailboxes.length : 0,
  };
}

function publicStatus(setup) {
  const { stages, state } = viewStages(setup);
  const out = {
    state,
    stages,
    mailboxes: (setup.mailboxes || []).map((m) => ({ address: `${m.localPart}@${setup.domain}`, passwordSet: m.passwordSet === true })),
    webmailUrl: `https://webmail.${setup.domain}`,
    plan: planInfo(setup),
  };
  if (state === "needs_attention") out.message = NEEDS_ATTENTION_MESSAGE;
  // DNS records only while the customer still has to publish them at their own registrar.
  if (setup.state === "provisioned" && state !== "needs_attention" && setup.domainMode === "own" && Array.isArray(setup.dnsRecords)) {
    out.dnsRecords = setup.dnsRecords.map((r) => {
      const rec = { type: r.type, name: r.name, value: r.value };
      if (r.priority != null) rec.priority = r.priority;
      return rec;
    });
  }
  return out;
}

module.exports = function (ctx) {
  const { frappeClient } = ctx;
  // Fail closed if a caller forgot to wire the session guard.
  const requireAuth = ctx.requireAuth || ((req, res) => res.status(401).json({ error: "Not authenticated." }));
  const deps = ctx.mailDeps || {};
  const router = express.Router();

  const writeLimiter = limiter(12, 60 * 1000, "Too many changes. Please wait a moment and try again.");
  const codeLimiter = limiter(5, 10 * 60 * 1000, "Too many code requests. Please try again later.");

  /** Token -> { orderName, setup }, or sends the shared 404 and returns null. */
  async function resolve(req, res) {
    const v = mailAccess.verifyOrderToken(req.params.token);
    if (!v.ok) { res.status(404).json(NOT_VALID); return null; }
    let setup = null;
    try {
      setup = await mailAccess.loadMailSetup(frappeClient(), v.orderName);
    } catch (e) {
      console.error(`[mail] could not load setup for ${v.orderName}: ${e.name}`);
      res.status(500).json({ error: "Something went wrong. Please try again." });
      return null;
    }
    if (!setup || !setup.domain) { res.status(404).json(NOT_VALID); return null; }
    return { orderName: v.orderName, setup };
  }

  /** resolve() plus the write gate. This snapshot is only a fast refusal; writes re-read inside the lock. */
  async function resolveForWrite(req, res) {
    const hit = await resolve(req, res);
    if (!hit) return null;
    if (!WRITABLE_STATES.has(hit.setup.state)) {
      res.status(409).json(NOT_READY);
      return null;
    }
    return hit;
  }

  const providerCtx = (setup) => ({
    provider: "stalwart",
    orderId: setup.domain,
    serviceId: setup.planId,
    job: { service_id: setup.planId },
  });

  function sendFailure(res, err, what) {
    if (err instanceof mailProvider.MailError) return res.status(err.status).json({ error: err.message });
    console.error(`[mail] ${what} failed: ${err.name}${err.status ? ` (${err.status})` : ""}`);
    return res.status(502).json({ error: "We couldn't complete that just now. Please try again shortly." });
  }

  // The Stalwart domain for this order, or null when it is not the one recorded.
  async function domainFor(setup) {
    const dom = await stalwart.findDomain(setup.domain);
    if (!dom) return null;
    if (setup.stalwartDomainId && String(dom.id) !== String(setup.stalwartDomainId)) return null;
    return dom;
  }

  // Resolve a local part to an account on THIS order's domain. null = not ours.
  async function accountFor(setup, local) {
    if (typeof local !== "string" || mailInput.RESERVED_LOCAL_PARTS.has(local)) return null;
    if (!(setup.mailboxes || []).some((m) => m.localPart === local)) return null;
    if (!(await domainFor(setup))) return null;
    const acct = await stalwart.findAccount(`${local}@${setup.domain}`);
    return acct ? acct.id : null;
  }

  // Must run inside mailAccess.withOrderLock(orderName). The list is rebuilt from a fresh
  // read under the store's own per-order lock, so a lane or sweep write at the same time
  // cannot revert it (and this cannot revert theirs). A missing order throws.
  async function persistMailboxes(orderName, mutate) {
    await mailSetupStore.updateMailboxes(frappeClient(), orderName, mutate);
  }

  const setFlag = (orderName, local, value) =>
    persistMailboxes(orderName, (list) => list.map((m) => (m.localPart === local ? { ...m, passwordSet: value } : m)));

  // The signed-in owner's way to their no-login status link (the post-payment page
  // polls through it). Anything that is not "your own mail order" is the same 404.
  router.get("/api/mail/my/:orderName/link", requireAuth, async (req, res) => {
    const account = req.session && (req.session.webAccount || (req.session.user && req.session.user.id));
    if (!account) return res.status(401).json({ error: "Not authenticated." });
    const orderName = String(req.params.orderName || "");
    try {
      const r = await frappeClient().get(`/api/resource/Checkout Order/${encodeURIComponent(orderName)}`);
      const doc = r.data && r.data.data;
      let cfg = {};
      try { cfg = JSON.parse((doc && doc.config_json) || "{}") || {}; } catch { cfg = {}; }
      if (!doc || doc.web_account !== account || !cfg.mailSetup || typeof cfg.mailSetup !== "object") {
        return res.status(404).json(NOT_VALID);
      }
      res.set("Cache-Control", "no-store");
      return res.json({ statusUrl: mailAccess.statusUrlFor(orderName), token: mailAccess.signOrderToken(orderName) });
    } catch (e) {
      if (e.response && e.response.status === 404) return res.status(404).json(NOT_VALID);
      console.error(`[mail] could not build a status link: ${e.name}`);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  router.get("/api/mail/status/:token", async (req, res) => {
    const hit = await resolve(req, res);
    if (!hit) return;
    res.set("Cache-Control", "no-store");
    res.json(publicStatus(hit.setup));
  });

  router.post("/api/mail/status/:token/code", codeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    const purpose = req.body && req.body.purpose !== undefined ? req.body.purpose : "reset";
    if (!mailAccess.PURPOSES.includes(purpose)) return res.status(400).json({ error: "Unknown code purpose." });
    try {
      await mailAccess.issueCode(frappeClient(), hit.orderName, { ...deps, purpose });
    } catch (e) {
      if (e.code === "code_rate_limited" || e.code === "code_locked") return res.status(429).json({ error: e.message });
      console.error(`[mail] could not send a code for ${hit.orderName}: ${e.name}`);
      return res.status(502).json({ error: "We couldn't send the code just now. Please try again shortly." });
    }
    res.status(202).json({ sent: true });
  });

  router.post("/api/mail/status/:token/mailboxes/:local/password", writeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    const { orderName } = hit;
    const local = req.params.local;
    if (typeof local !== "string" || mailInput.RESERVED_LOCAL_PARTS.has(local) ||
        !(hit.setup.mailboxes || []).some((m) => m.localPart === local)) {
      return res.status(404).json({ error: "Mailbox not found." });
    }
    const body = req.body || {};
    const pwError = mailboxPolicy.validatePassword(body.password);
    if (pwError) return res.status(400).json({ error: pwError });

    // One critical section: re-read, decide first-set vs reset, spend the code,
    // flag, change. passwordSet is written BEFORE the provider call and rolled back
    // only if the provider fails, so any ambiguity leaves the mailbox needing a code.
    let out;
    try {
      out = await mailAccess.withOrderLock(orderName, async () => {
        const setup = await mailAccess.loadMailSetup(frappeClient(), orderName);
        if (!setup || !setup.domain) return { status: 404, body: NOT_VALID };
        if (!WRITABLE_STATES.has(setup.state)) return { status: 409, body: NOT_READY };
        const box = (setup.mailboxes || []).find((m) => m.localPart === local);
        if (!box) return { status: 404, body: { error: "Mailbox not found." } };
        const wasSet = box.passwordSet === true;
        if (wasSet) {
          if (!mailAccess.hasCode(body.code)) return { status: 403, body: { error: "A code is required." } };
          if (!(await mailAccess.verifyCodeInLock(frappeClient(), orderName, body.code, { purpose: "reset" }))) {
            return { status: 403, body: { error: BAD_CODE } };
          }
        } else {
          await setFlag(orderName, local, true);
        }
        try {
          const accountId = await accountFor(setup, local);
          if (!accountId) {
            if (!wasSet) await setFlag(orderName, local, false);
            return { status: 404, body: { error: "Mailbox not found." } };
          }
          await mailProvider.changePassword(providerCtx(setup), accountId, body.password);
        } catch (e) {
          if (!wasSet) {
            try {
              await setFlag(orderName, local, false);
            } catch { /* the flag stays true: later requests need a code (fail closed) */ }
          }
          throw e;
        }
        return { status: 200, body: { address: `${local}@${setup.domain}`, passwordSet: true } };
      });
    } catch (e) {
      return sendFailure(res, e, "password change");
    }
    res.status(out.status).json(out.body);
  });

  router.post("/api/mail/status/:token/mailboxes", writeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    const { orderName } = hit;
    const body = req.body || {};
    const local = typeof body.localPart === "string" ? body.localPart.trim() : "";
    if (mailInput.RESERVED_LOCAL_PARTS.has(local)) return res.status(400).json({ error: "That mailbox name is reserved." });
    if (!mailInput.isValidMailboxLocalPart(local)) {
      return res.status(400).json({ error: "Use lowercase letters, numbers, dots and hyphens, and don't start or end with a symbol." });
    }

    let out;
    try {
      out = await mailAccess.withOrderLock(orderName, async () => {
        // Everything is decided on a fresh read taken inside the lock.
        const setup = await mailAccess.loadMailSetup(frappeClient(), orderName);
        if (!setup || !setup.domain) return { status: 404, body: NOT_VALID };
        if (!WRITABLE_STATES.has(setup.state)) return { status: 409, body: NOT_READY };
        if ((setup.mailboxes || []).some((m) => m.localPart === local)) {
          return { status: 409, body: { error: `${local}@ already exists.` } };
        }
        const plan = planInfo(setup);
        if (plan.mailboxCount >= plan.mailboxLimit) {
          return { status: 409, body: { error: `Your email plan includes ${plan.mailboxLimit} mailboxes and all are in use.` } };
        }
        if (!mailAccess.hasCode(body.code)) return { status: 403, body: { error: "A code is required." } };
        if (!(await mailAccess.verifyCodeInLock(frappeClient(), orderName, body.code, { purpose: "add" }))) {
          return { status: 403, body: { error: BAD_CODE } };
        }
        const address = `${local}@${setup.domain}`;
        const append = () =>
          persistMailboxes(orderName, (list) => (list.some((m) => m.localPart === local) ? list : [...list, { localPart: local, passwordSet: false }]));
        // A previous attempt may have created the account and then failed to save it: adopt it.
        if (await domainFor(setup)) {
          const existing = await stalwart.findAccount(address);
          if (existing) {
            await append();
            return { status: 201, body: { address, passwordSet: false } };
          }
        }
        // An unknown random secret: the customer sets the real password through the first-set route.
        const secret = crypto.randomBytes(24).toString("base64url");
        await mailProvider.createMailbox(providerCtx(setup), { localPart: local, password: secret });
        await append();
        return { status: 201, body: { address, passwordSet: false } };
      });
    } catch (e) {
      return sendFailure(res, e, "mailbox creation");
    }
    res.status(out.status).json(out.body);
  });

  router.limiters = { writeLimiter, codeLimiter };
  return router;
};
