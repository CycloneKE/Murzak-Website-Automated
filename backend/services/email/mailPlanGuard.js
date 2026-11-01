// services/email/mailPlanGuard.js
//
// Business email (mail-* plans) is bought only from the email setup page, through
// POST /api/orders, because that is where the mailSetup (domain, mailboxes,
// contact) is collected and validated. The generic "add a service" and invoice
// routes must refuse a mail-* plan: paying for one without a mailSetup would
// charge the customer for something the provisioning lane can never build.

const { isMailPlan } = require("../../config/emailPlans");

const MAIL_PLAN_SETUP_REQUIRED = Object.freeze({
  error: "Business email is ordered from the email setup page.",
  code: "MAIL_PLAN_SETUP_REQUIRED",
});

function idOf(s) {
  if (typeof s === "string") return s.trim();
  return String((s && (s.serviceId || s.service_id)) || "").trim();
}

/** True when any entry of a services array is a mail-* plan. */
function containsMailPlan(services) {
  return Array.isArray(services) && services.some((s) => isMailPlan(idOf(s)));
}

/** The list without any mail-* entries. For client-supplied or session-parked selections. */
function stripMailPlans(services) {
  return Array.isArray(services) ? services.filter((s) => !isMailPlan(idOf(s))) : [];
}

/** Ids of mail-* plans in `services` that the account does not already hold (existingIds: Set of ids). */
function newMailPlanIds(services, existingIds) {
  const have = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  return (Array.isArray(services) ? services : []).map(idOf).filter((id) => isMailPlan(id) && !have.has(id));
}

/** Express middleware: 400 MAIL_PLAN_SETUP_REQUIRED when req.body[field] holds a mail-* plan. */
function rejectMailPlans(field) {
  return (req, res, next) => {
    if (containsMailPlan(req.body && req.body[field])) return res.status(400).json(MAIL_PLAN_SETUP_REQUIRED);
    return next();
  };
}

module.exports = { MAIL_PLAN_SETUP_REQUIRED, containsMailPlan, stripMailPlans, newMailPlanIds, rejectMailPlans };
