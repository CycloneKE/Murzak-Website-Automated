const nodemailer = require("nodemailer");

function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP env vars missing: SMTP_HOST/SMTP_USER/SMTP_PASS");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false, // STARTTLS on 587
    auth: { user, pass },
  });
}

async function sendInvoiceDeletedEmail({ to, clientName, invoiceNo }) {
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
  const html = `<p>Hello ${clientName || "there"},</p>
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
  const html = `<p>Hello ${clientName || "there"},</p>
<p>Welcome to Murzak Technologies! Please confirm your email address:</p>
<p><a href="${verifyUrl}" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Confirm email</a></p>
<p>If the button does not work, paste this URL into your browser:<br>
<a href="${verifyUrl}">${verifyUrl}</a></p>
<p>— Murzak Technologies</p>`;
  await sendMail({ to, subject, text, html });
}

module.exports = {
  sendInvoiceDeletedEmail,
  sendMail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};
