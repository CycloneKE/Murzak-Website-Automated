// services/apps/welcomeEmail.js
//
// The "your shop is ready" email for app tiers (Murzak POS).
//
// WHY A SWEEP AND NOT A HOOK
//   A shop is finished by murzak-bench-runner on the VPS, which writes the
//   Provisioning Job to "active" straight into Frappe. This backend is never
//   told, so it finds finished shops by looking: active app-tier jobs changed
//   recently, whose Checkout Order has not been emailed yet.
//
// WHAT THE EMAIL SAYS, AND DELIBERATELY DOES NOT
//   The shop address, the sign-in email, and where to get started. It never
//   contains a password: the first password is shown once on the owner's
//   portal page (the welcome page), and the shop's own "Forgot password" sends
//   a code so the owner can set their own. Mail is not a safe place for a
//   password, and the design in docs says so too.
//
// DEDUPE WITHOUT A SCHEMA CHANGE
//   The marker lives in the Checkout Order's existing config_json
//   (config.welcomeEmail). A new Provisioning Job field would be silently
//   dropped by Frappe until the doctype is re-imported, which is exactly the
//   failure class that has bitten this project before.
//
//   {state:"sending", at}              claimed; stale after SENDING_STALE_MS
//   {state:"sent", at, to}             done, never sent again
//   {state:"failed", attempts, error}  retried until MAX_ATTEMPTS, then left
//
// Pure helpers are exported for tests; the sweep takes its collaborators
// (client, sendMail, clock) as arguments.

const { JOB_DOCTYPE } = require("../provisioning/constants");
const { getServiceMeta } = require("../provisioning/catalog");
const { APP_ADDRESS_SUFFIX } = require("./appOrder");

const ORDER_DOCTYPE = "Checkout Order";
const WEB_ACCOUNT_DOCTYPE = "Web Account";

const MAX_ATTEMPTS = 3;
const SENDING_STALE_MS = 15 * 60 * 1000;
const MAX_PER_SWEEP = 10;

const PRODUCT_NAMES = { pos: "Murzak POS" };

// First steps for a new owner. frontend/src/config/appCheckout.ts (nextSteps)
// carries the same list for the ready screen; test/welcomeEmail.test.js fails
// if the two copies differ.
const NEXT_STEPS = [
  "Sign in and set your own password. Open the account menu in your POS and choose to change it.",
  "Set up your shop. Add your branches and opening details the first time you sign in.",
  "Add your products, so you can start selling.",
  "Add your cashiers and staff from inside the POS. Each person gets their own login.",
];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Frappe Datetime string (UTC) for the given epoch ms. */
function sqlTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function looksLikeEmail(s) {
  return typeof s === "string" && /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(s);
}

/**
 * Only an https URL on the shop's own host suffix is ever put in the email.
 * The address comes from the job's `access` JSON, which the host script
 * writes; validating it here means a malformed value cannot become a link.
 */
function safeShopUrl(url, suffix) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    const want = String(suffix || "").toLowerCase();
    if (!want || host === want || !host.endsWith(`.${want}`)) return "";
    return `https://${host}`;
  } catch {
    return "";
  }
}

function parseJson(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Pure: the subject, text and HTML bodies.
 * @param {{productName:string, shopName:string, shopUrl:string, ownerEmail:string,
 *          welcomeUrl:string, portalSupportUrl:string, supportEmail:string,
 *          holderName?:string}} p
 */
function buildWelcomeEmail(p) {
  const name = String(p.holderName || "").trim() || "there";
  const shop = String(p.shopName || "").trim() || "your shop";
  const subject = `Your ${p.productName} shop "${shop}" is ready`.replace(/[\r\n]+/g, " ");

  const steps = NEXT_STEPS;

  const text = `Hello ${name},

Your ${p.productName} shop "${shop}" is ready to use.

Your shop address:   ${p.shopUrl}
Sign in with email:  ${p.ownerEmail}

YOUR FIRST PASSWORD
For your security we never send passwords by email. Sign in to your Murzak portal to see it:
${p.welcomeUrl}

Rather choose your own? On your shop's sign-in page, choose "Forgot password" and we will email you a 6-digit code.

GETTING STARTED
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

NEED A HAND?
Message us from your portal: ${p.portalSupportUrl}
Or email ${p.supportEmail} and tell us your shop address (${p.shopUrl}). We would rather help you start well than have you work it out alone.

Murzak Technologies`;

  const li = steps.map((s) => `<li style="margin:0 0 6px">${escapeHtml(s)}</li>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1b2430;max-width:560px">
<p>Hello ${escapeHtml(name)},</p>
<p>Your ${escapeHtml(p.productName)} shop <strong>${escapeHtml(shop)}</strong> is ready to use.</p>
<table style="border-collapse:collapse;margin:12px 0">
<tr><td style="padding:4px 12px 4px 0;color:#5b6676">Your shop address</td><td><a href="${escapeHtml(p.shopUrl)}">${escapeHtml(p.shopUrl)}</a></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#5b6676">Sign in with email</td><td>${escapeHtml(p.ownerEmail)}</td></tr>
</table>
<p><strong>Your first password.</strong> For your security we never send passwords by email. <a href="${escapeHtml(p.welcomeUrl)}">Sign in to your Murzak portal</a> to see it.</p>
<p>Rather choose your own? On your shop's sign-in page, choose <em>Forgot password</em> and we will email you a 6-digit code.</p>
<p><strong>Getting started</strong></p>
<ol style="padding-left:20px">${li}</ol>
<p><strong>Need a hand?</strong> <a href="${escapeHtml(p.portalSupportUrl)}">Message us from your portal</a>, or email <a href="mailto:${escapeHtml(p.supportEmail)}">${escapeHtml(p.supportEmail)}</a> and tell us your shop address. We would rather help you start well than have you work it out alone.</p>
<p style="color:#5b6676">Murzak Technologies</p>
</div>`;

  return { subject, text, html };
}

/** Pure: the marker's current verdict for an order's config. */
function welcomeDecision(config, nowMs) {
  const w = config?.welcomeEmail;
  if (!w) return { send: true, attempts: 0 };
  if (w.state === "sent") return { send: false, reason: "already sent" };
  if (w.state === "sending") {
    const at = Date.parse(w.at || "");
    if (Number.isFinite(at) && nowMs - at < SENDING_STALE_MS) return { send: false, reason: "another sweep is sending" };
    return { send: true, attempts: Number(w.attempts || 0) };
  }
  const attempts = Number(w.attempts || 0);
  if (w.state === "failed" && attempts >= MAX_ATTEMPTS) return { send: false, reason: "gave up" };
  return { send: true, attempts };
}

function isSmtpNotConfigured(err) {
  return /SMTP env vars missing/i.test(String(err?.message || ""));
}

async function writeMarker(client, order, config, marker) {
  const next = { ...config, welcomeEmail: marker };
  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(order.name)}`, {
    config_json: JSON.stringify(next),
  });
  return next;
}

async function findAppOrder(client, invoice) {
  if (!invoice) return null;
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
    params: {
      fields: JSON.stringify(["name", "status", "service_id", "web_account", "config_json", "invoice_doc_name"]),
      filters: JSON.stringify([["invoice_doc_name", "=", invoice]]),
      limit_page_length: 5,
    },
  });
  // Re-filter in JS: never trust a server-side filter to be exact.
  const rows = (res.data?.data || []).filter((r) => r?.invoice_doc_name === invoice);
  for (const r of rows) {
    const config = parseJson(r.config_json, {});
    if (r.status === "Paid" && config.app) return { order: r, config };
  }
  return null;
}

async function accountRecipient(client, webAccount) {
  if (!webAccount) return { email: "", name: "" };
  try {
    const res = await client.get(`/api/resource/${WEB_ACCOUNT_DOCTYPE}/${encodeURIComponent(webAccount)}`);
    const d = res.data?.data || {};
    return { email: d.work_email || "", name: d.account_holder_name || "" };
  } catch {
    return { email: "", name: "" };
  }
}

/**
 * One pass: email every finished, not-yet-welcomed app shop. Never throws.
 *
 * @param {object} client  Frappe client (get/put)
 * @param {object} opts
 * @param {Function} opts.sendMail      ({to, subject, text, html}) => Promise
 * @param {number}   [opts.nowMs]
 * @param {number}   [opts.lookbackMs]  how far back to look for finished jobs
 * @param {string}   [opts.appBaseUrl]
 * @param {string}   [opts.supportEmail]
 * @returns {Promise<{checked:number, sent:number, failed:number, skipped:number, error?:string}>}
 */
async function sweepWelcomeEmails(client, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const lookbackMs = opts.lookbackMs ?? 12 * 60 * 60 * 1000;
  const appBaseUrl = String(opts.appBaseUrl || process.env.APP_BASE_URL || "https://murzaktech.tech").replace(/\/+$/, "");
  const supportEmail = opts.supportEmail || process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL || "murzaktechnologies@gmail.com";
  const out = { checked: 0, sent: 0, failed: 0, skipped: 0 };

  let jobs;
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        fields: JSON.stringify(["name", "web_account", "invoice", "service_id", "status", "access", "modified"]),
        filters: JSON.stringify([
          ["status", "=", "active"],
          ["modified", ">=", sqlTime(nowMs - lookbackMs)],
        ]),
        order_by: "modified asc",
        limit_page_length: 50,
      },
    });
    jobs = res.data?.data || [];
  } catch (e) {
    return { ...out, error: e.message };
  }

  for (const job of jobs) {
    if (out.sent + out.failed >= MAX_PER_SWEEP) break;
    const meta = getServiceMeta(String(job.service_id || ""));
    if (!meta?.app) continue; // not an app tier
    out.checked++;

    try {
      const found = await findAppOrder(client, job.invoice);
      if (!found) { out.skipped++; continue; } // not from the app checkout
      const { order, config } = found;

      const decision = welcomeDecision(config, nowMs);
      if (!decision.send) { out.skipped++; continue; }

      const access = parseJson(job.access, {});
      const shopUrl = safeShopUrl(access.url, APP_ADDRESS_SUFFIX[meta.app]);
      if (!shopUrl) { out.skipped++; continue; }

      const account = await accountRecipient(client, job.web_account);
      const to = [access.posUser, account.email].map((s) => String(s || "").trim().toLowerCase()).find(looksLikeEmail);
      if (!to) { out.skipped++; continue; }

      const mail = buildWelcomeEmail({
        productName: PRODUCT_NAMES[meta.app] || meta.name || "Murzak",
        shopName: config.shopName,
        shopUrl,
        ownerEmail: String(access.posUser || to),
        holderName: account.name,
        welcomeUrl: `${appBaseUrl}/welcome/${encodeURIComponent(order.name)}`,
        portalSupportUrl: `${appBaseUrl}/portal/support`,
        supportEmail,
      });

      // Claim first, so an overlapping sweep sees "sending" and leaves it.
      const claimed = await writeMarker(client, order, config, {
        state: "sending", at: new Date(nowMs).toISOString(), attempts: decision.attempts,
      });

      try {
        await opts.sendMail({ to, ...mail });
        await writeMarker(client, order, claimed, { state: "sent", at: new Date(nowMs).toISOString(), to });
        out.sent++;
      } catch (sendErr) {
        if (isSmtpNotConfigured(sendErr)) {
          // A platform setting, not this shop's fault: do not spend its attempts.
          await writeMarker(client, order, claimed, config.welcomeEmail ?? undefined).catch(() => {});
          out.skipped++;
          out.error = "SMTP is not configured; no welcome emails can be sent";
        } else {
          await writeMarker(client, order, claimed, {
            state: "failed",
            attempts: decision.attempts + 1,
            at: new Date(nowMs).toISOString(),
            error: String(sendErr.message || sendErr).slice(0, 200),
          });
          out.failed++;
        }
      }
    } catch (e) {
      // One bad job never stops the rest.
      out.failed++;
      console.warn(`[welcome-email] ${job.name}: ${e.message}`);
    }
  }
  return out;
}

module.exports = {
  NEXT_STEPS,
  MAX_ATTEMPTS,
  SENDING_STALE_MS,
  buildWelcomeEmail,
  welcomeDecision,
  safeShopUrl,
  sweepWelcomeEmails,
};
