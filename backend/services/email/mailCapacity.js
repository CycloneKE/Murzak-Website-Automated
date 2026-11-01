// services/email/mailCapacity.js
//
// Disk capacity gate for self-hosted business email (Stalwart + Bulwark).
//
// Mailbox quotas are LIMITS, not reservations: a 15GB mailbox uses only what
// its owner stores. The box is therefore sold on a thin-provisioning basis.
// A new mail order is refused when
//
//     (provisionedGb + plan.mailboxes x plan.quotaGb) / overcommit > diskGb
//
// where provisionedGb is what the live mail orders already allow.
//
// Configuration (env, read at call time):
//   MAIL_DISK_GB     usable disk for mail on the box. UNSET (or not > 0) DISABLES
//                    the gate: every mail plan is allowed and one warning is
//                    logged per process when Stalwart is configured. Set it
//                    before launch.
//   MAIL_OVERCOMMIT  how many times the disk the mail quotas may be promised.
//                    Default 3.
//
// The postmaster mailbox is system-created and is not counted against quota.

const { PLANS } = require("../../config/emailPlans");
const { holdsDomain, listOrderRows } = require("./mailSetupStore");
const stalwartClient = require("./stalwartClient");

const DEFAULT_OVERCOMMIT = 3;
const REFUSAL_REASON =
  "We don't have enough mail storage capacity for this plan right now. Please try again later or contact us.";

let warnedGateDisabled = false;

/** A positive finite number from env, or null when unset or invalid. */
function envPositive(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasPlan(planId) {
  return typeof planId === "string" && Object.prototype.hasOwnProperty.call(PLANS, planId);
}

/**
 * Can one more order of `planId` be sold without overcommitting the mail disk?
 *
 * @param {string} planId
 * @param {{provisionedGb?: number, diskGb?: number, overcommit?: number}} [opts]
 *   provisionedGb: quota already promised to live mail orders (see provisionedMailGb).
 *   diskGb / overcommit: default to MAIL_DISK_GB / MAIL_OVERCOMMIT.
 * @returns {{ok: boolean, reason?: string, note?: string}}
 */
function canSellMailPlan(planId, opts = {}) {
  if (!hasPlan(planId)) return { ok: false, reason: "Unknown email plan." };
  const plan = PLANS[planId];

  const diskGb = opts.diskGb !== undefined ? Number(opts.diskGb) : envPositive("MAIL_DISK_GB");
  if (diskGb === null) {
    return { ok: true, note: "Mail disk capacity gate is disabled because MAIL_DISK_GB is not set." };
  }
  if (!(diskGb > 0)) return { ok: false, reason: REFUSAL_REASON };

  const overcommit = opts.overcommit !== undefined ? Number(opts.overcommit) : envPositive("MAIL_OVERCOMMIT") ?? DEFAULT_OVERCOMMIT;
  if (!(overcommit > 0)) return { ok: false, reason: REFUSAL_REASON };

  const provisionedGb = Number(opts.provisionedGb || 0);
  const committedGb = (provisionedGb + plan.mailboxes * plan.quotaGb) / overcommit;
  if (committedGb > diskGb) return { ok: false, reason: REFUSAL_REASON };
  return { ok: true };
}

/**
 * Disk usage level for alerting: warn from 70% of the disk, critical from 85%.
 * Compared multiplied out (used x 100 against 70 x disk) so the boundaries
 * are exact. A disk that is not > 0 reads as critical, never as ok.
 *
 * @returns {'ok'|'warn'|'critical'}
 */
function diskAlertLevel(usedGb, diskGb) {
  const used = Number(usedGb);
  const disk = Number(diskGb);
  if (!(disk > 0) || !Number.isFinite(used)) return "critical";
  if (used * 100 >= 85 * disk) return "critical";
  if (used * 100 >= 70 * disk) return "warn";
  return "ok";
}

function parseConfig(s) {
  try {
    const v = JSON.parse(s || "");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Total quota (GB) promised to mail orders that still count: every order whose
 * mailSetup names a known plan and which still holds its place (not Cancelled,
 * Deleted, or a lapsed unpaid Draft). Each counts its plan's full mailbox allowance.
 *
 * @returns {Promise<number>}
 */
async function provisionedMailGb(client, { nowMs = Date.now() } = {}) {
  const rows = await listOrderRows(client, [["config_json", "like", '%"mailSetup"%']]);
  let total = 0;
  for (const row of rows) {
    if (!holdsDomain(row, nowMs)) continue;
    const planId = parseConfig(row.config_json).mailSetup?.planId;
    if (!hasPlan(planId)) continue;
    total += PLANS[planId].mailboxes * PLANS[planId].quotaGb;
  }
  return total;
}

/**
 * The gate as the order route calls it. Reads the live mail orders only when
 * the gate is enabled. A failure to read them fails CLOSED (503), never open.
 *
 * @returns {Promise<{ok: boolean, reason?: string, note?: string}>}
 */
async function checkMailCapacity(client, planId, { nowMs = Date.now() } = {}) {
  if (envPositive("MAIL_DISK_GB") === null) {
    if (!warnedGateDisabled && stalwartClient.isConfigured()) {
      warnedGateDisabled = true;
      console.warn("[mailCapacity] MAIL_DISK_GB is not set: the mail disk capacity gate is DISABLED and mail orders are sold without a disk check.");
    }
    return canSellMailPlan(planId);
  }

  let provisionedGb;
  try {
    provisionedGb = await provisionedMailGb(client, { nowMs });
  } catch {
    const err = new Error("We couldn't confirm mail capacity just now. Please try again in a moment.");
    err.statusCode = 503;
    err.code = "MAIL_CAPACITY_UNKNOWN";
    throw err;
  }
  return canSellMailPlan(planId, { provisionedGb });
}

module.exports = {
  canSellMailPlan,
  diskAlertLevel,
  provisionedMailGb,
  checkMailCapacity,
};
