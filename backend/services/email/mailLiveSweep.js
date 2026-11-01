// services/email/mailLiveSweep.js
//
// The go-live sweep for Stalwart business mail. Each run looks at the orders
// whose mail setup is `provisioned` and decides, from live DNS and the webmail
// page, whether the mail is ready. When it is, the order goes `live` and the
// customer gets one hand-over email.
//
//   provisioned --(DNS complete, webmail answers with the client's title)--> live
//   live + no handoverSentAt --(email sent)--> handoverSentAt set
//
// Waiting over HANDOVER_WAIT_MS raises ONE staff ticket and the order keeps
// waiting. Every outside call is injected (see runMailLiveSweep), so the sweep
// needs no network in tests. Logs never carry passwords, tokens or message bodies.
//   node test/mailLiveSweep.test.js   (or: npm test)

const dns = require("dns");
const mailDns = require("./mailDns");
const store = require("./mailSetupStore");
const { WEB_ACCOUNT_DOCTYPE } = require("../provisioning/constants");

const HANDOVER_WAIT_MS = 72 * 3600 * 1000;
const WEBMAIL_TIMEOUT_MS = 15000;
const WEBMAIL_BODY_MAX = 65536;
const TICKET_DOCTYPE = "Portal Users Requests";

const iso = (ms) => new Date(ms).toISOString();

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The hand-over email. Returns the subject, text and html only; the caller adds
 * `to` and sends it (see makeSendMailReadyEmail).
 */
function renderMailReadyEmail({ businessName, webmailUrl, addresses = [], statusUrl, supportContact }) {
  const list = addresses.map((a) => `  - ${a}`).join("\n");
  const support = supportContact ? `\n\nNeed help? Reply to this email or write to ${supportContact}.` : "";
  const text =
    `Hello ${businessName || "there"},\n\n` +
    `Your business email is ready. Your mailboxes:\n${list}\n\n` +
    `Open webmail at ${webmailUrl}\n` +
    `Setup status: ${statusUrl}` +
    `${support}\n\n- Murzak Technologies`;
  const items = addresses.map((a) => `<li>${escapeHtml(a)}</li>`).join("");
  const html =
    `<p>Hello ${escapeHtml(businessName || "there")},</p>` +
    `<p>Your business email is ready. Your mailboxes:</p><ul>${items}</ul>` +
    `<p>Open webmail at <a href="${escapeHtml(webmailUrl)}">${escapeHtml(webmailUrl)}</a>.</p>` +
    `<p>Setup status: <a href="${escapeHtml(statusUrl)}">${escapeHtml(statusUrl)}</a></p>` +
    (supportContact ? `<p>Need help? Write to ${escapeHtml(supportContact)}.</p>` : "") +
    `<p>- Murzak Technologies</p>`;
  return { subject: `Your business email is ready, ${businessName || ""}`.trim(), text, html };
}

/** Adapter for utils/mailer's sendMail: `sendMailReadyEmail(args)` with `args.to`. */
function makeSendMailReadyEmail(sendMail) {
  return (args) => sendMail({ to: args.to, ...renderMailReadyEmail(args) });
}

// Stored records relax DMARC to `v=DMARC1` only. A later policy tightening
// (p=quarantine, p=reject) must not fail verification, so only the version tag is checked.
function relaxDmarc(rec) {
  if (rec && rec.type === "TXT" && rec.name === "_dmarc") return { ...rec, value: "v=DMARC1" };
  return rec;
}

function titleOf(body) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(body || ""));
  return m ? m[1].trim() : "";
}

/**
 * Webmail is ready when it answers https with any 2xx. That is the gate. The
 * page title is advisory only: a mismatch is logged once (no business name, no
 * page content) and the order still goes live. Any error or non-2xx means not ready.
 */
async function webmailReady(fetchFn, domain, businessName, orderName, log) {
  let res;
  try {
    res = await fetchFn(`https://webmail.${domain}`);
  } catch {
    return false;
  }
  if (!res || res.status < 200 || res.status > 299) return false;
  const want = String(businessName || "").trim().toLowerCase();
  if (!want || !titleOf(res.body).toLowerCase().includes(want)) {
    log.warn(`[mail-live] advisory for ${orderName}: webmail.${domain} answered 2xx but its title does not match the business name; going live anyway`);
  }
  return true;
}

async function defaultFetch(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(WEBMAIL_TIMEOUT_MS) });
  const body = (await res.text()).slice(0, WEBMAIL_BODY_MAX);
  return { status: res.status, body };
}

// Production test message: a plain note to the main mailbox through utils/mailer.
// If the mailer cannot be loaded, the caller records the failure and goes live anyway.
async function defaultSendTestMessage({ to, domain }) {
  const mailer = require("../../utils/mailer");
  if (typeof mailer.sendMail !== "function") throw new Error("mailer unavailable");
  await mailer.sendMail({
    to,
    subject: `Your mailbox at ${domain} is working`,
    text: `This is a test message confirming ${to} receives mail.`,
  });
}

// Same shape as the runner's escalation ticket: a Portal Users Request on the customer's account.
async function defaultRaiseStaffTicket(client, { orderName, reason, webAccount, businessName }) {
  let email = webAccount;
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(WEB_ACCOUNT_DOCTYPE)}/${encodeURIComponent(webAccount)}`);
    if (res.data?.data?.user_email) email = res.data.data.user_email;
  } catch {
    // best effort: the ticket still goes to the account name
  }
  await client.post(`/api/resource/${TICKET_DOCTYPE}`, {
    portal_user: webAccount,
    email,
    subject: `Mail setup waiting: ${businessName || orderName}`,
    status: "Waiting on Admin",
    source: "Portal",
    messages: [{
      sender_type: "Admin",
      sender: "System Automation",
      message: `Mail setup for ${orderName} has waited more than 72 hours without going live.\n\nInternal diagnostic: ${reason}`,
    }],
  });
}

function defaultStatusUrlFor() {
  const base = String(process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/mail/status`;
}

/**
 * One sweep over the Stalwart setups. Each order is handled on its own: a throw
 * is counted as `errored` and the sweep moves on.
 *
 * @param {object} client Frappe REST client
 * @param {object} [deps]
 * @param {object} [deps.resolver]   dns.promises-style resolver (default node dns)
 * @param {Function} [deps.fetch]    (url) => {status, body} for the webmail check
 * @param {Function} [deps.sendTestMessage] ({to, domain, businessName}) => Promise
 * @param {Function} [deps.sendMailReadyEmail] (args) => Promise. Missing means warn and skip.
 * @param {Function} [deps.raiseStaffTicket] (client, {orderName, reason, webAccount, businessName}) => Promise
 * @param {Function} [deps.statusUrlFor] (orderName) => url
 * @param {string}   [deps.supportContact]
 * @param {Function} [deps.now]      () => epoch ms
 * @param {object}   [deps.log]      {warn, info}
 * @returns {Promise<{checked:number, wentLive:number, stillWaiting:number, errored:number}>}
 */
async function runMailLiveSweep(client, deps = {}) {
  const now = deps.now || (() => Date.now());
  const fetchFn = deps.fetch || defaultFetch;
  const sendTestMessage = deps.sendTestMessage || defaultSendTestMessage;
  const sendMailReadyEmail = deps.sendMailReadyEmail;
  const raiseStaffTicket = deps.raiseStaffTicket || defaultRaiseStaffTicket;
  const statusUrlFor = deps.statusUrlFor || defaultStatusUrlFor;
  const supportContact = deps.supportContact != null ? deps.supportContact : process.env.SUPPORT_EMAIL || "";
  const log = deps.log || console;
  const result = { checked: 0, wentLive: 0, stillWaiting: 0, errored: 0 };

  // Both lists are read before any write, so an order that goes live in this run is not seen twice.
  const provisioned = await store.listOrdersByMailState(client, "provisioned");
  const live = await store.listOrdersByMailState(client, "live");

  async function sendHandover(orderName, s) {
    if (s.handoverSentAt) return false;
    if (typeof sendMailReadyEmail !== "function") {
      log.warn(`[mail-live] sendMailReadyEmail is not configured; hand-over for ${orderName} not sent`);
      return false;
    }
    const addresses = (s.mailboxes || []).map((m) => `${m.localPart}@${s.domain}`);
    try {
      await sendMailReadyEmail({
        to: s.contactEmail,
        businessName: s.businessName,
        webmailUrl: `https://webmail.${s.domain}`,
        addresses,
        statusUrl: statusUrlFor(orderName),
        supportContact,
      });
    } catch (e) {
      log.warn(`[mail-live] hand-over email for ${orderName} failed; will retry next sweep: ${e.message}`);
      return false;
    }
    await store.mergeMailSetup(client, orderName, { handoverSentAt: iso(now()) });
    return true;
  }

  // Copied, not imported: runner.js createEscalationTicket swallows its own errors,
  // so a failed ticket could not leave the staffTicketAt marker unset for a retry.
  // Raises one staff ticket after HANDOVER_WAIT_MS. A failed ticket leaves the marker unset for the next sweep.
  async function maybeRaiseStaffTicket(row, s, reason) {
    if (s.staffTicketAt) return;
    const waited = now() - Date.parse(s.provisionedAt);
    if (!(waited >= HANDOVER_WAIT_MS)) return;
    try {
      await raiseStaffTicket(client, { orderName: row.orderName, reason, webAccount: row.webAccount, businessName: s.businessName });
      await store.mergeMailSetup(client, row.orderName, { staffTicketAt: iso(now()) });
      log.warn(`[mail-live] ${row.orderName} has waited over 72 hours; staff ticket raised`);
    } catch (e) {
      log.warn(`[mail-live] staff ticket for ${row.orderName} failed; will retry next sweep: ${e.message}`);
    }
  }

  async function markDnsRunning(orderName, s) {
    if (s.progress && s.progress.dns === "running") return;
    await store.setProgress(client, orderName, "dns", "running");
  }

  // Returns true when the order went live this run.
  async function sweepProvisioned(row) {
    const { orderName } = row;
    let s = row.setup;
    if (!s.provisionedAt) {
      s = { ...s, provisionedAt: iso(now()) };
      await store.mergeMailSetup(client, orderName, { provisionedAt: s.provisionedAt });
    }

    const records = Array.isArray(s.dnsRecords) ? s.dnsRecords : [];
    if (!records.length) throw new Error(`${orderName} has no stored dnsRecords`);

    const dnsRes = await mailDns.verifyRecords(s.domain, records.map(relaxDmarc), { resolver: deps.resolver });
    if (!dnsRes.ok) {
      await markDnsRunning(orderName, s);
      await maybeRaiseStaffTicket(row, s, `DNS still missing: ${dnsRes.missing.join(", ")}`);
      return false;
    }

    if (!(await webmailReady(fetchFn, s.domain, s.businessName, orderName, log))) {
      await markDnsRunning(orderName, s);
      await maybeRaiseStaffTicket(row, s, "webmail is not answering with the business title yet");
      return false;
    }

    // The test message is recorded but never blocks go-live.
    const main = (s.mailboxes || [])[0];
    if (!main || !main.localPart) {
      await store.mergeMailSetup(client, orderName, { testMessageError: "no mailbox to test", testMessageErrorAt: iso(now()) });
    } else {
      const to = `${main.localPart}@${s.domain}`;
      try {
        await sendTestMessage({ to, domain: s.domain, businessName: s.businessName });
        await store.mergeMailSetup(client, orderName, { testMessageAt: iso(now()) });
      } catch (e) {
        log.warn(`[mail-live] test message for ${orderName} failed; going live anyway: ${e.message}`);
        await store.mergeMailSetup(client, orderName, { testMessageError: "send failed", testMessageErrorAt: iso(now()) });
      }
    }

    await store.setProgress(client, orderName, "dns", "done");
    await store.setMailState(client, orderName, "live");
    await sendHandover(orderName, { ...s, state: "live" });
    return true;
  }

  for (const row of provisioned) {
    result.checked++;
    try {
      if (await sweepProvisioned(row)) result.wentLive++;
      else result.stillWaiting++;
    } catch (e) {
      result.errored++;
      log.warn(`[mail-live] ${row.orderName} errored: ${e.message}`);
    }
  }

  // Live orders whose hand-over has not gone out yet: retry the email only.
  for (const row of live) {
    if (row.setup.handoverSentAt) continue;
    result.checked++;
    try {
      await sendHandover(row.orderName, row.setup);
    } catch (e) {
      result.errored++;
      log.warn(`[mail-live] ${row.orderName} errored: ${e.message}`);
    }
  }

  return result;
}

module.exports = {
  HANDOVER_WAIT_MS,
  makeSendMailReadyEmail,
  renderMailReadyEmail,
  runMailLiveSweep,
};
