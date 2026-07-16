/**
 * Shared terminal (Phase 5.4) constants — doctype names + retention windows.
 * Kept in its own module, mirroring services/provisioning/constants.js, so
 * leaf modules can reference these without a require cycle.
 */
module.exports = {
  SESSION_DOCTYPE: "Terminal Session",
  ACCESS_LOG_DOCTYPE: "Terminal Recording Access Log",

  // Retention windows in days, per tier. See how-does-one-create-deep-kazoo.md
  // §Phase 5.4 for the reasoning: routine sessions default to 30 days (long
  // enough to cover most dispute/chargeback windows without keeping secrets
  // around indefinitely); flagged sessions (hit a resource cap, ended
  // abnormally, or manually flagged) get 90; legal_hold is indefinite and
  // requires an explicit, logged, named staff member to set.
  RETENTION_DAYS_ROUTINE: Number(process.env.TERMINAL_RETENTION_DAYS_ROUTINE || 30),
  RETENTION_DAYS_FLAGGED: Number(process.env.TERMINAL_RETENTION_DAYS_FLAGGED || 90),

  // Exit reasons that automatically upgrade a session to the "flagged" tier —
  // anything other than a clean client-initiated close is worth a longer
  // retention window in case it needs investigating later.
  AUTO_FLAG_EXIT_REASONS: new Set([
    "stream_error",
    "exec_failed",
    "admin_killed",
    "account_suspended",
  ]),
};
