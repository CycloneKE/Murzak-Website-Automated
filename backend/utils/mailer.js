const nodemailer = require("nodemailer");

// Escape user-controlled values before interpolating into HTML email bodies.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Reject header-injection attempts in recipient addresses (CR/LF/newlines).
function assertCleanRecipient(to) {
  if (typeof to !== "string" || /[\r\n]/.test(to)) {
    throw new Error("Invalid email recipient.");
  }
  return to;
}

function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP env vars missing: SMTP_HOST/SMTP_USER/SMTP_PASS");
  }

  const secure = port === 465; // 465 = implicit TLS; 587/25 = STARTTLS
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // Force STARTTLS on non-implicit-TLS ports so credentials are never sent
    // over a plaintext (downgraded) connection.
    requireTLS: !secure,
    auth: { user, pass },
  });
}

async function sendInvoiceDeletedEmail({ to, clientName, invoiceNo }) {
  assertCleanRecipient(to);
  const transporter = makeTransporter();

  const fromName = process.env.SMTP_FROM_NAME || "Murzak Technologies";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const supportEmail = process.env.SUPPORT_EMAIL || fromEmail;

  const subject = `Subscription Deleted: ${invoiceNo}`;

  const text = `Hello ${clientName || "there"},

You have successfully deleted your subscription invoice ${invoiceNo}.

If this was a mistake, email us as soon as possible at ${supportEmail} and we will assist.

— Murzak Technologies`;

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
  });
}

async function sendMail({ to, subject, text, html }) {
  assertCleanRecipient(to);
  const transporter = makeTransporter();
  const fromName = process.env.SMTP_FROM_NAME || "Murzak Technologies";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  });
}

async function sendPasswordResetEmail({ to, clientName, resetUrl }) {
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const subject = "Reset your Murzak Technologies password";
  const text = `Hello ${clientName || "there"},

We received a request to reset the password for your Murzak Technologies account.

Reset your password using the link below (valid for 1 hour):
${resetUrl}

If you did not request this, you can safely ignore this email or contact us at ${supportEmail}.

— Murzak Technologies`;
  const html = `<p>Hello ${escapeHtml(clientName || "there")},</p>
<p>We received a request to reset the password for your Murzak Technologies account.</p>
<p><a href="${resetUrl}" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Reset password</a></p>
<p>This link is valid for 1 hour. If the button does not work, paste this URL into your browser:<br>
<a href="${resetUrl}">${resetUrl}</a></p>
<p>If you did not request this, you can safely ignore this email or contact us at ${supportEmail}.</p>
<p>— Murzak Technologies</p>`;
  await sendMail({ to, subject, text, html });
}

async function sendVerificationEmail({ to, clientName, verifyUrl }) {
  const subject = "Confirm your Murzak Technologies email";
  const text = `Hello ${clientName || "there"},

Welcome to Murzak Technologies! Please confirm your email address using the link below:
${verifyUrl}

— Murzak Technologies`;
  const html = `<p>Hello ${escapeHtml(clientName || "there")},</p>
<p>Welcome to Murzak Technologies! Please confirm your email address:</p>
<p><a href="${verifyUrl}" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Confirm email</a></p>
<p>If the button does not work, paste this URL into your browser:<br>
<a href="${verifyUrl}">${verifyUrl}</a></p>
<p>— Murzak Technologies</p>`;
  await sendMail({ to, subject, text, html });
}

function portalUrl() {
  const base = process.env.APP_BASE_URL;
  if (!base && process.env.NODE_ENV === "production") {
    console.error("APP_BASE_URL is not set in production — trial/lifecycle emails will link to the wrong domain.");
  }
  // Fallback only fires when APP_BASE_URL is unset (already logged above as a
  // misconfiguration). murzaktech.com has no DNS at all; website.murzaktech.tech
  // is where the app is actually served.
  return (base || "https://website.murzaktech.tech").replace(/\/$/, "") + "/portal";
}

/**
 * Alerts staff that a customer is waiting on a reply. Sent to every address in
 * ADMIN_EMAILS — the same allowlist requireAdmin enforces — so whoever can
 * answer the thread is the one who hears about it.
 *
 * Callers must treat this as best-effort: a customer's message must never fail
 * because SMTP is down (see the call sites in routes/portalRoutes.js).
 */
async function sendAdminSupportAlert({ to, customerName, customerEmail, companyName, subject, message }) {
  const who = customerName || customerEmail || "A customer";
  const alertSubject = `[Support] ${who}: ${subject || "New message"}`;
  const inboxUrl = `${portalUrl()}/admin`;

  const excerpt = String(message || "").slice(0, 500);
  const text = `${who}${companyName ? ` (${companyName})` : ""} sent a support message.

From:    ${customerEmail || "unknown"}
Subject: ${subject || "—"}

${excerpt}

Reply in the admin inbox: ${inboxUrl}

— Murzak Technologies`;

  const html = `<p><strong>${escapeHtml(who)}</strong>${companyName ? ` (${escapeHtml(companyName)})` : ""} sent a support message.</p>
<p><strong>From:</strong> ${escapeHtml(customerEmail || "unknown")}<br>
<strong>Subject:</strong> ${escapeHtml(subject || "—")}</p>
<blockquote style="border-left:3px solid #ddd;margin:0;padding:0 0 0 12px;white-space:pre-wrap">${escapeHtml(excerpt)}</blockquote>
<p><a href="${inboxUrl}" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open the admin inbox</a></p>
<p>— Murzak Technologies</p>`;

  const recipients = Array.isArray(to) ? to : [to];
  await Promise.all(
    recipients.filter(Boolean).map((addr) => sendMail({ to: addr, subject: alertSubject, text, html }))
  );
}

// ---- Trial lifecycle (started / ending soon / expired) ----

async function sendTrialStartedEmail({ to, clientName, hours, endsAt }) {
  const subject = `Your ${hours}h Murzak trial is live`;
  const text = `Hello ${clientName || "there"},

Your trial sandbox is live — you have ${hours} hours to explore, ending ${endsAt}.

Log in and start testing: ${portalUrl()}

Tip: anything you set up during the trial can be kept — pick a plan before it ends and we convert your sandbox, data and all.

— Murzak Technologies`;
  await sendMail({ to, subject, text });
}

async function sendTrialEndingSoonEmail({ to, clientName, endsAt }) {
  const subject = "Your Murzak trial ends soon — keep your work";
  const text = `Hello ${clientName || "there"},

Your trial sandbox ends ${endsAt}. After that it is paused.

To keep everything you've set up, choose a plan before it ends: ${portalUrl()}

Questions? Just reply to this email.

— Murzak Technologies`;
  await sendMail({ to, subject, text });
}

async function sendTrialExpiredEmail({ to, clientName }) {
  const subject = "Your Murzak trial has ended — your data is safe";
  const text = `Hello ${clientName || "there"},

Your trial sandbox has ended and is now paused. Your data is held for 7 days.

Pick a plan within that window and we restore your sandbox exactly as you left it: ${portalUrl()}

— Murzak Technologies`;
  await sendMail({ to, subject, text });
}

// ---- Stalwart business mail ----

/**
 * The hand-over email, sent once a business mail setup goes live. Carries the
 * webmail address, every mailbox, the status page (where passwords are set and
 * the phone/Outlook setup lives). It never carries a password: the arguments
 * are destructured, so any extra property is dropped.
 */
async function sendMailReadyEmail({ to, businessName, webmailUrl, addresses, statusUrl, supportContact }) {
  const name = String(businessName || "").trim();
  const list = (Array.isArray(addresses) ? addresses : []).filter(Boolean);
  const support = supportContact || process.env.SUPPORT_EMAIL || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "";
  const subject = name ? `Your business email is ready — ${name}` : "Your business email is ready";

  const supportLine = support ? `\n\nNeed help? Write to ${support}.` : "";
  const text = `Hello ${name || "there"},

Your business email${name ? ` for ${name}` : ""} is ready.

Open webmail: ${webmailUrl}

Your mailboxes:
${list.map((a) => `  - ${a}`).join("\n")}

Set up on your phone or Outlook
Open your status page and use the "Add to my phone" section. Your account is detected automatically, so there are no server settings to type in.
${statusUrl}

Before you can sign in, each mailbox needs a password. Set it on your status page first.

A note on delivery: new domains build trust over days. If your first messages land in spam, ask recipients to mark them as not spam.${supportLine}

— Murzak Technologies`;

  const items = list.map((a) => `<li>${escapeHtml(a)}</li>`).join("");
  const html = `<p>Hello ${escapeHtml(name || "there")},</p>
<p>Your business email${name ? ` for ${escapeHtml(name)}` : ""} is ready.</p>
<p>Open webmail: <a href="${escapeHtml(webmailUrl)}">${escapeHtml(webmailUrl)}</a></p>
<p>Your mailboxes:</p><ul>${items}</ul>
<p><strong>Set up on your phone or Outlook</strong><br>
Open your status page and use the "Add to my phone" section. Your account is detected automatically, so there are no server settings to type in.</p>
<p><a href="${escapeHtml(statusUrl)}" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open your status page</a></p>
<p>Before you can sign in, each mailbox needs a password. Set it on your status page first.</p>
<p>A note on delivery: new domains build trust over days. If your first messages land in spam, ask recipients to mark them as not spam.</p>
${support ? `<p>Need help? Write to ${escapeHtml(support)}.</p>` : ""}
<p>— Murzak Technologies</p>`;

  await sendMail({ to, subject, text, html });
}

const CODE_PURPOSE_TEXT = Object.freeze({
  reset: "reset a mailbox password",
  add: "add a mailbox",
});

/** A 6-digit confirmation code for a sensitive mailbox change. Contains no link. */
async function sendMailCodeEmail({ to, code, purpose, businessName }) {
  const purposeText = CODE_PURPOSE_TEXT[purpose];
  if (!purposeText) throw new Error("Unknown code purpose.");
  if (!/^\d{6}$/.test(String(code))) throw new Error("Invalid confirmation code.");
  const name = String(businessName || "").trim();
  const subject = "Your confirmation code";
  const text = `Hello ${name || "there"},

Your confirmation code is: ${code}

Use it to ${purposeText}. The code expires in 10 minutes.

If you did not ask for this, you can ignore this email and nothing will change.

— Murzak Technologies`;
  const html = `<p>Hello ${escapeHtml(name || "there")},</p>
<p>Your confirmation code is:</p>
<p><strong style="font-size:24px;letter-spacing:4px">${escapeHtml(code)}</strong></p>
<p>Use it to ${purposeText}. The code expires in 10 minutes.</p>
<p>If you did not ask for this, you can ignore this email and nothing will change.</p>
<p>— Murzak Technologies</p>`;
  await sendMail({ to, subject, text, html });
}

module.exports = {
  sendAdminSupportAlert,
  sendInvoiceDeletedEmail,
  sendMail,
  sendMailCodeEmail,
  sendMailReadyEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendTrialStartedEmail,
  sendTrialEndingSoonEmail,
  sendTrialExpiredEmail,
};
