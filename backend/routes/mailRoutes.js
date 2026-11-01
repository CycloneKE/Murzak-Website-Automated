// routes/mailRoutes.js
//
// /api/mail/status/:token - the customer's no-login view of their business
// email setup. The token (services/email/mailAccess.js) names one order. Reads
// need only the token. A mailbox's FIRST password needs nothing else; later
// password resets and adding a mailbox also need a 6-digit code emailed to the
// order's contact address.
//
// Rules this file keeps:
//  - A bad, tampered, expired or unknown token all return the same 404 body.
//  - No endpoint takes a mailbox or account id: only a local part, which must
//    already be one of THIS order's mailboxes, resolved here to an account on
//    THIS order's domain (the facade re-checks that the account is on the domain).
//  - Responses never carry Stalwart ids, hashes, secrets or the code, and a
//    failed stage never shows technical detail.
//  - Passwords are passed straight to the provider: never stored, never logged.

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

  /** resolve() plus the write gate. */
  async function resolveForWrite(req, res) {
    const hit = await resolve(req, res);
    if (!hit) return null;
    if (!WRITABLE_STATES.has(hit.setup.state)) {
      res.status(409).json({ error: "Your email is not ready for changes yet." });
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

  // Resolve a local part to an account on THIS order's domain. null = not ours.
  async function accountFor(setup, local) {
    if (typeof local !== "string" || mailInput.RESERVED_LOCAL_PARTS.has(local)) return null;
    if (!(setup.mailboxes || []).some((m) => m.localPart === local)) return null;
    const dom = await stalwart.findDomain(setup.domain);
    if (!dom) return null;
    if (setup.stalwartDomainId && String(dom.id) !== String(setup.stalwartDomainId)) return null;
    const acct = await stalwart.findAccount(`${local}@${setup.domain}`);
    return acct ? acct.id : null;
  }

  async function setMailboxes(orderName, mutate) {
    await mailAccess.withOrderLock(orderName, async () => {
      const fresh = await mailAccess.loadMailSetup(frappeClient(), orderName);
      if (!fresh) return;
      const next = mutate((fresh.mailboxes || []).map((m) => ({ ...m })));
      await mailSetupStore.mergeMailSetup(frappeClient(), orderName, { mailboxes: next });
    });
  }

  router.get("/api/mail/status/:token", async (req, res) => {
    const hit = await resolve(req, res);
    if (!hit) return;
    res.set("Cache-Control", "no-store");
    res.json(publicStatus(hit.setup));
  });

  router.post("/api/mail/status/:token/code", codeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    try {
      await mailAccess.issueCode(frappeClient(), hit.orderName, deps);
    } catch (e) {
      if (e.code === "code_rate_limited") return res.status(429).json({ error: e.message });
      console.error(`[mail] could not send a code for ${hit.orderName}: ${e.name}`);
      return res.status(502).json({ error: "We couldn't send the code just now. Please try again shortly." });
    }
    res.status(202).json({ sent: true });
  });

  router.post("/api/mail/status/:token/mailboxes/:local/password", writeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    const { orderName, setup } = hit;
    const local = req.params.local;
    const box = (setup.mailboxes || []).find((m) => m.localPart === local);
    if (!box || mailInput.RESERVED_LOCAL_PARTS.has(local)) return res.status(404).json({ error: "Mailbox not found." });

    const body = req.body || {};
    const pwError = mailboxPolicy.validatePassword(body.password);
    if (pwError) return res.status(400).json({ error: pwError });

    // The first password is free: the link itself is the proof. A reset needs the emailed code.
    if (box.passwordSet === true) {
      const okCode = await mailAccess.verifyCode(frappeClient(), orderName, body.code);
      if (!okCode) return res.status(403).json({ error: BAD_CODE });
    }

    try {
      const accountId = await accountFor(setup, local);
      if (!accountId) return res.status(404).json({ error: "Mailbox not found." });
      await mailProvider.changePassword(providerCtx(setup), accountId, body.password);
      await setMailboxes(orderName, (list) => list.map((m) => (m.localPart === local ? { ...m, passwordSet: true } : m)));
    } catch (e) {
      return sendFailure(res, e, "password change");
    }
    res.json({ address: `${local}@${setup.domain}`, passwordSet: true });
  });

  router.post("/api/mail/status/:token/mailboxes", writeLimiter, async (req, res) => {
    const hit = await resolveForWrite(req, res);
    if (!hit) return;
    const { orderName, setup } = hit;
    const body = req.body || {};
    const local = typeof body.localPart === "string" ? body.localPart.trim() : "";
    if (mailInput.RESERVED_LOCAL_PARTS.has(local)) return res.status(400).json({ error: "That mailbox name is reserved." });
    if (!mailInput.isValidMailboxLocalPart(local)) {
      return res.status(400).json({ error: "Use lowercase letters, numbers, dots and hyphens, and don't start or end with a symbol." });
    }
    if ((setup.mailboxes || []).some((m) => m.localPart === local)) {
      return res.status(409).json({ error: `${local}@ already exists.` });
    }
    const plan = planInfo(setup);
    if (plan.mailboxCount >= plan.mailboxLimit) {
      return res.status(409).json({ error: `Your email plan includes ${plan.mailboxLimit} mailboxes and all are in use.` });
    }
    if (!(await mailAccess.verifyCode(frappeClient(), orderName, body.code))) {
      return res.status(403).json({ error: BAD_CODE });
    }
    try {
      // An unknown random secret: the customer sets the real password through the first-set route.
      const secret = crypto.randomBytes(24).toString("base64url");
      await mailProvider.createMailbox(providerCtx(setup), { localPart: local, password: secret });
      await setMailboxes(orderName, (list) => (list.some((m) => m.localPart === local) ? list : [...list, { localPart: local, passwordSet: false }]));
    } catch (e) {
      return sendFailure(res, e, "mailbox creation");
    }
    res.status(201).json({ address: `${local}@${setup.domain}`, passwordSet: false });
  });

  router.limiters = { writeLimiter, codeLimiter };
  return router;
};
