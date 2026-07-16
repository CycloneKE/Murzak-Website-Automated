/**
 * Retention-tier logic — pure functions, no Frappe/network/Date.now() side
 * effects (time is always passed in), so this is exhaustively unit-testable.
 * This is the code that decides how long a recording containing a customer's
 * own secrets sits in storage — get it wrong quietly and it either deletes
 * evidence you need or keeps liability you don't.
 */

const { RETENTION_DAYS_ROUTINE, RETENTION_DAYS_FLAGGED, AUTO_FLAG_EXIT_REASONS } = require("./constants");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide a session's retention tier at the moment it ends.
 *   - legalHold=true always wins (indefinite; requires legalHoldSetBy).
 *   - manuallyFlagged, or an exit reason in AUTO_FLAG_EXIT_REASONS, upgrades
 *     to "flagged" (90d default).
 *   - otherwise "routine" (30d default).
 * Never silently drops a reason: a legal hold without legalHoldSetBy throws —
 * this must always be attributable to a named person, not an anonymous flag.
 */
function computeRetentionTier({ exitReason, manuallyFlagged, manualFlagReason, legalHold, legalHoldSetBy } = {}) {
  if (legalHold) {
    if (!legalHoldSetBy) {
      const e = new Error("legalHold requires legalHoldSetBy (a named, accountable person).");
      e.code = "MISSING_LEGAL_HOLD_OWNER";
      throw e;
    }
    return { tier: "legal_hold", flaggedReason: manualFlagReason || null, legalHoldSetBy };
  }

  const autoFlagged = AUTO_FLAG_EXIT_REASONS.has(exitReason);
  if (manuallyFlagged || autoFlagged) {
    const flaggedReason =
      manualFlagReason || (autoFlagged ? `auto-flagged: exit_reason=${exitReason}` : "manually flagged");
    return { tier: "flagged", flaggedReason, legalHoldSetBy: null };
  }

  return { tier: "routine", flaggedReason: null, legalHoldSetBy: null };
}

/**
 * Expiry timestamp (ms epoch) for a tier, anchored to when the session
 * STARTED (not when it was flagged) — a session shouldn't get extra runway
 * just because it took a while to review. Returns null for legal_hold
 * (no automatic expiry; must be manually cleared).
 */
function computeExpiresAtMs(tier, startedAtMs) {
  if (tier === "legal_hold") return null;
  const days = tier === "flagged" ? RETENTION_DAYS_FLAGGED : RETENTION_DAYS_ROUTINE;
  return startedAtMs + days * DAY_MS;
}

/** Has this session's retention window passed? Never true for legal_hold or an already-purged session. */
function isExpired(session, nowMs) {
  if (!session || session.purged) return false;
  if (session.retention_tier === "legal_hold") return false;
  if (!session.expires_at) return false;
  return new Date(session.expires_at).getTime() <= nowMs;
}

/**
 * Recompute tier/expiry for an ALREADY-ENDED session being upgraded after the
 * fact (e.g. a support ticket surfaces days later). Expiry is still anchored
 * to the original startedAt, so upgrading a session doesn't reset its clock —
 * it only ever extends toward the flagged/legal_hold window, never shortens.
 */
function upgradeRetention(session, { manualFlagReason, legalHold, legalHoldSetBy } = {}) {
  if (!session || !session.started_at) {
    const e = new Error("upgradeRetention requires a session with started_at.");
    e.code = "MISSING_STARTED_AT";
    throw e;
  }
  const startedAtMs = new Date(session.started_at).getTime();
  const { tier, flaggedReason, legalHoldSetBy: setBy } = computeRetentionTier({
    exitReason: session.exit_reason,
    manuallyFlagged: true,
    manualFlagReason,
    legalHold,
    legalHoldSetBy,
  });
  const expiresAtMs = computeExpiresAtMs(tier, startedAtMs);
  return {
    retention_tier: tier,
    flagged_reason: flaggedReason,
    legal_hold_set_by: setBy,
    expires_at: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
  };
}

module.exports = { computeRetentionTier, computeExpiresAtMs, isExpired, upgradeRetention, DAY_MS };
