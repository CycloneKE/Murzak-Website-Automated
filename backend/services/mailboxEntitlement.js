/**
 * Mailbox entitlement — how many mailboxes an account has actually paid for.
 *
 * Two independent ceilings apply and the effective limit is the LOWER one:
 *
 *   Murzak entitlement   what they bought. starter-email grants 5, each
 *                        addon-mailboxes-5 grants 5 more, biz-email is sold as
 *                        "unlimited" (catalog `mailboxes: 0`).
 *   Hostinger plan cap   what the underlying mail order actually supports.
 *
 * Both matter. Enforcing only Hostinger's cap is a revenue leak (a starter
 * customer could create every mailbox the plan allows without buying the
 * addon). Enforcing only ours under-delivers (someone who bought +5 couldn't
 * use them). And "unlimited" is only true up to Hostinger's ceiling, so the
 * portal must report that as the real number rather than promising infinity.
 *
 * Pure functions — no I/O, so the arithmetic is testable without a Frappe or
 * Hostinger round-trip.
 */

const UNLIMITED = 0;

/** Is this catalog item an Email Hosting product that grants mailboxes? */
function grantsMailboxes(meta) {
  return !!meta && meta.category === "Email Hosting" && meta.mailboxes !== undefined;
}

/**
 * Sum the account's Murzak-side mailbox entitlement.
 *
 * `ownedServices` is the account's selected_services rows (as
 * fetchSelectedServicesForUser returns them: `{serviceId, status}`), and
 * `getMeta` looks a service id up in the catalog snapshot.
 *
 * Only services the account actually holds count — a row still "Awaiting
 * Payment" has not been paid for and must not raise the allowance.
 *
 * Returns { limit, unlimited } where `limit` is meaningless if `unlimited`.
 */
function entitlementFor(ownedServices, getMeta, { countStatuses } = {}) {
  const allowed = countStatuses || ["active", "setting up"];
  const rows = Array.isArray(ownedServices) ? ownedServices : [];

  let total = 0;
  let unlimited = false;

  for (const row of rows) {
    const id = String(row?.serviceId || row?.service_id || "").trim();
    if (!id) continue;
    const status = String(row?.status || "").trim().toLowerCase();
    // An unpaid row grants nothing. Statuses vary in case across the codebase,
    // hence the normalize-and-compare.
    if (status && !allowed.includes(status)) continue;

    const meta = getMeta(id);
    if (!grantsMailboxes(meta)) continue;

    const grant = Number(meta.mailboxes);
    if (grant === UNLIMITED) unlimited = true;
    else if (Number.isFinite(grant) && grant > 0) total += grant;
  }

  return { limit: total, unlimited };
}

/**
 * Reconcile our entitlement against the Hostinger plan's own cap.
 *
 * `planLimit` is Hostinger's mailbox ceiling for the order, or null when we
 * could not read it. A null plan limit must NOT be read as "unlimited": we
 * fall back to our own entitlement, and if that is also unlimited we return
 * null to mean "unknown" so callers report honestly rather than inventing a
 * number.
 */
function effectiveLimit({ entitlement, planLimit }) {
  const ent = entitlement || { limit: 0, unlimited: false };
  const plan = Number.isFinite(Number(planLimit)) && Number(planLimit) > 0 ? Number(planLimit) : null;

  if (ent.unlimited) {
    // "Unlimited" is only ever true up to Hostinger's ceiling.
    return { limit: plan, unlimited: plan === null, source: plan === null ? "unknown" : "hostinger" };
  }
  if (plan === null) return { limit: ent.limit, unlimited: false, source: "murzak" };
  return plan < ent.limit
    ? { limit: plan, unlimited: false, source: "hostinger" }
    : { limit: ent.limit, unlimited: false, source: "murzak" };
}

/**
 * May the account create one more mailbox right now?
 * `used` is the count of mailboxes that already exist on the order.
 */
function canCreate({ used, effective }) {
  const e = effective || {};
  if (e.unlimited) return { ok: true };
  // Unknown ceiling — allow, and let Hostinger be the authority. Blocking here
  // would lock a paying customer out of a mailbox they may be owed.
  //
  // null/undefined are checked EXPLICITLY: Number(null) is 0, not NaN, so a
  // Number.isFinite() test alone reads an unknown limit as a hard zero and
  // refuses every mailbox.
  if (e.limit === null || e.limit === undefined) return { ok: true };
  if (!Number.isFinite(Number(e.limit))) return { ok: true };
  const limit = Number(e.limit);
  if (Number(used) >= limit) {
    return {
      ok: false,
      reason:
        e.source === "hostinger"
          ? `Your email plan supports ${limit} mailbox(es) and all are in use.`
          : `You've used all ${limit} mailbox(es) on your plan. Add "+5 Business Mailboxes" for more.`,
    };
  }
  return { ok: true };
}

module.exports = { UNLIMITED, grantsMailboxes, entitlementFor, effectiveLimit, canCreate };
