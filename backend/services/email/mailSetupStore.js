// services/email/mailSetupStore.js
//
// The owner's Stalwart mail setup, kept on the Checkout Order's existing
// config_json under `mailSetup` (same no-schema-change reasoning as shopSetup
// and shopProgress). The mail provisioning job reads it back to build the
// mailboxes, and the portal reads its progress to show the checklist.
//
// Writes go through shopSetup.mergeOrderConfig, so each writer keeps the other
// keys on the order (shopProgress, welcomeEmail, ...). The window between the
// read and the write is a few milliseconds, as for every other config writer.
//
// The domain gate (waitForDomain) is what stops a mail job from building
// mailboxes on a domain the customer does not yet own. It retries while the
// domain is pending, and escalates when staff must register it by hand.

const { mergeOrderConfig } = require("../apps/shopSetup");
const { listCustomerDomains } = require("../customerDomains");
const { normalizeDomainName } = require("../customerDomains");
const { validateMailSetup } = require("./mailInput");

const ORDER_DOCTYPE = "Checkout Order";
const PROVIDER = "stalwart";
const DOMAIN_MODES = Object.freeze(["new", "own"]);
const PROGRESS_STAGES = Object.freeze(["payment", "domain", "mail", "webmail", "dns"]);
const PROGRESS_STATES = Object.freeze(["pending", "running", "done", "failed"]);
const MAIL_STATES = Object.freeze(["awaiting_payment", "paid", "provisioned", "live", "needs_attention"]);
const LOGO_MAX_LEN = 2048;

function coded(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/** A failure a retry cannot fix. Same shape as lanes/emailHosting.js's permanent(). */
function permanent(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

function parseJson(s) {
  try {
    const v = JSON.parse(s || "");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// Frappe DATETIME strings are naive UTC ("YYYY-MM-DD HH:MM:SS").
function parseMysqlUtc(s) {
  const t = Date.parse(String(s || "").replace(" ", "T") + "Z");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Whether an order still holds its domain. A Cancelled or Deleted order never
 * does. An unpaid Draft stops holding once its reservation has lapsed (the same
 * rule orderStore uses for RAM). A Paid order always holds.
 */
function holdsDomain(row, nowMs) {
  if (row.status === "Cancelled" || row.status === "Deleted") return false;
  if (row.status === "Draft" && parseMysqlUtc(row.reservation_expires_at) <= nowMs) return false;
  return true;
}

async function fetchOrder(client, orderName) {
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderName)}`);
    if (res.data?.data) return res.data.data;
  } catch (e) {
    if (e.response?.status !== 404) throw e;
  }
  throw coded("order_not_found", "Checkout order not found.", 404);
}

async function invoiceIsPaid(client, invoiceDocName) {
  try {
    const res = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`);
    return res.data?.data?.status === "Paid";
  } catch (e) {
    if (e.response?.status === 404) return false;
    throw e;
  }
}

/** Checkout Order rows read from the list endpoint. Filters are repeated in JS for safety. */
async function listOrderRows(client, extraFilters = []) {
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
    params: {
      fields: JSON.stringify(["name", "web_account", "status", "reservation_expires_at", "invoice_doc_name", "config_json"]),
      filters: JSON.stringify(extraFilters),
      limit_page_length: 0,
    },
  });
  return res.data?.data || [];
}

/** Clean an optional logo link. Only https is kept; anything else is dropped silently. */
function cleanLogoUrl(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > LOGO_MAX_LEN) return null;
  return /^https:\/\/[^\s]+$/i.test(s) ? s : null;
}

/**
 * Check a mail setup input without storing anything. Pure apart from the
 * takenDomains set the caller supplies.
 *
 * @param {object} input the browser's mailSetup payload
 * @param {Set<string>} takenDomains domains used by other orders
 * @param {{planId?: string}} [opts] the ordered plan; a different planId is refused
 * @returns {{ok: true, value: object} | {ok: false, errors: Record<string,string>}}
 */
function checkMailSetupInput(input, takenDomains, opts = {}) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const checked = validateMailSetup(src, { takenDomains });
  const errors = checked.ok ? {} : { ...checked.errors };

  if (!DOMAIN_MODES.includes(src.domainMode)) {
    errors.domainMode = "Choose whether to register a new domain or use one you already own.";
  }
  if (opts.planId && checked.ok && checked.value.planId !== opts.planId) {
    errors.planId = "This order is for a different email plan.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...checked.value,
      domainMode: src.domainMode,
      logoUrl: cleanLogoUrl(src.logoUrl),
    },
  };
}

/**
 * Domains held by other orders' mail setups. An order does not hold its domain
 * once it is Cancelled, or an unpaid Draft whose reservation has lapsed. Orders
 * of `webAccount` (the requesting account) never block it: a retry is the same
 * customer, so it gets no error. `exceptOrderName` leaves out the order being saved.
 */
async function listTakenMailDomains(client, { exceptOrderName, webAccount, nowMs = Date.now() } = {}) {
  const rows = await listOrderRows(client, [["config_json", "like", '%"mailSetup"%']]);
  const taken = new Set();
  for (const row of rows) {
    if (exceptOrderName && row.name === exceptOrderName) continue;
    if (webAccount && row.web_account === webAccount) continue;
    if (!holdsDomain(row, nowMs)) continue;
    const domain = parseJson(row.config_json).mailSetup?.domain;
    if (typeof domain === "string" && domain) taken.add(domain);
  }
  return taken;
}

/**
 * Save the owner's mail setup on a Checkout Order. Rejects invalid input and
 * stores nothing. The state always starts awaiting_payment, and a setup that
 * has already moved past that cannot be overwritten.
 *
 * @returns {Promise<object>} the stored setup
 */
async function saveMailSetup(client, orderName, input, { nowMs = Date.now() } = {}) {
  // Only an open Draft can take a mail setup. A Paid order, or a Draft whose
  // invoice is already paid, is past the point where its mailboxes can change.
  const doc = await fetchOrder(client, orderName);
  if (doc.status !== "Draft") {
    throw coded("mail_order_closed", "This order has already been paid, so its mail setup cannot change.", 409);
  }
  if (doc.invoice_doc_name && (await invoiceIsPaid(client, doc.invoice_doc_name))) {
    throw coded("mail_order_closed", "This order has already been paid, so its mail setup cannot change.", 409);
  }

  // Known limit: the domain check and the write are not one atomic step, so two
  // concurrent saves for the same domain can both pass. Accepted. The mail
  // provisioning step (Task 8) also refuses a domain that already exists in
  // Stalwart under a different order.
  const taken = await listTakenMailDomains(client, { exceptOrderName: orderName, webAccount: doc.web_account, nowMs });
  const checked = checkMailSetupInput(input, taken);
  if (!checked.ok) {
    const err = coded("mail_setup_invalid", "Please fix the highlighted fields.", 400);
    err.errors = checked.errors;
    throw err;
  }
  const v = checked.value;

  const setup = {
    state: "awaiting_payment",
    provider: PROVIDER,
    domainMode: v.domainMode,
    planId: v.planId,
    domain: v.domain,
    businessName: v.businessName,
    contactEmail: v.contactEmail,
    mailboxes: v.mailboxes.map((localPart) => ({ localPart, passwordSet: false })),
    progress: { payment: "pending", domain: "pending", mail: "pending", webmail: "pending", dns: "pending" },
  };
  if (v.logoUrl) setup.logoUrl = v.logoUrl;

  await mergeOrderConfig(client, orderName, (cfg) => {
    const existing = cfg.mailSetup;
    if (existing && existing.state && existing.state !== "awaiting_payment") {
      throw coded("mail_setup_locked", "Your mail setup has already started and cannot be changed here.", 409);
    }
    cfg.mailSetup = setup;
    return cfg;
  });
  return setup;
}

/** The mail setup of the order that was invoiced as `invoiceDocName`, or null. */
async function getMailSetup(client, invoiceDocName) {
  if (!invoiceDocName) return null;
  const rows = await listOrderRows(client, [["invoice_doc_name", "=", invoiceDocName]]);
  for (const row of rows) {
    if (row.invoice_doc_name !== invoiceDocName) continue;
    const setup = parseJson(row.config_json).mailSetup;
    if (setup) return { orderName: row.name, setup };
  }
  return null;
}

async function updateMailSetup(client, orderName, mutate) {
  return mergeOrderConfig(client, orderName, (cfg) => {
    if (!cfg.mailSetup) throw coded("mail_setup_missing", "This order has no mail setup.", 404);
    mutate(cfg.mailSetup);
    return cfg;
  });
}

/** Merge plain fields into the stored setup (e.g. the DNS record list). Repeating the same patch leaves the same result. */
async function mergeMailSetup(client, orderName, patch) {
  await updateMailSetup(client, orderName, (setup) => {
    Object.assign(setup, patch);
  });
}

/** Record one stage's progress. Repeating the same write leaves the same result. */
async function setProgress(client, orderName, stage, state) {
  if (!PROGRESS_STAGES.includes(stage)) throw coded("bad_progress_stage", `Unknown progress stage: ${stage}`, 400);
  if (!PROGRESS_STATES.includes(state)) throw coded("bad_progress_state", `Unknown progress state: ${state}`, 400);
  await updateMailSetup(client, orderName, (setup) => {
    setup.progress = { ...(setup.progress || {}), [stage]: state };
  });
}

/** Move the whole setup to a new state. Repeating the same state leaves the same result. */
async function setMailState(client, orderName, state) {
  if (!MAIL_STATES.includes(state)) throw coded("bad_mail_state", `Unknown mail state: ${state}`, 400);
  await updateMailSetup(client, orderName, (setup) => {
    setup.state = state;
  });
}

/**
 * Check the customer's domain is ready before mailboxes are built on it.
 *
 *  - domainMode "own": nothing to wait for.
 *  - a .ke name (including .co.ke) with no active row: permanent, because Hostinger's catalogue
 *    does not carry these. Staff register it by hand.
 *  - no row yet, or a row that is still pending: retryable.
 *  - a row that is failed or cancelled: permanent, since neither can become
 *    active on its own.
 *  - active: resolves.
 *
 * @throws {Error} retryable (no .permanent) while the domain is not ready yet,
 *   or an Error with .permanent === true when staff must act.
 */
async function waitForDomain(client, { webAccount, domain, domainMode }) {
  if (domainMode === "own") return;

  const name = normalizeDomainName(domain);
  const rows = await listCustomerDomains(client, webAccount);
  const row = rows.find((r) => normalizeDomainName(r.domainName) === name);
  // An active row passes even for a .ke name: staff registered it and activated it, then requeued.
  if (row && row.status === "active") return;
  if (/\.ke$/.test(name)) {
    throw permanent(
      `${name} is a Kenyan (.ke or .co.ke) domain that cannot be registered automatically. ` +
        "Register it for the customer, mark it active on their account, then requeue this order."
    );
  }
  if (!row) throw new Error(`Waiting for ${name} to be registered.`);
  if (row.status === "failed" || row.status === "cancelled" || row.status === "unsupported") {
    throw permanent(
      `${name} could not be registered (status: ${row.status}). ` +
        "Register it for the customer, mark it active, then requeue this order."
    );
  }
  throw new Error(`Waiting for ${name} (status: ${row.status}).`);
}

module.exports = {
  MAIL_STATES,
  PROGRESS_STAGES,
  PROGRESS_STATES,
  checkMailSetupInput,
  getMailSetup,
  listTakenMailDomains,
  mergeMailSetup,
  saveMailSetup,
  setMailState,
  setProgress,
  waitForDomain,
};
