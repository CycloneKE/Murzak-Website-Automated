/**
 * Recording-access authorization — deliberately NARROWER than general admin.
 * See how-does-one-create-deep-kazoo.md §Phase 5.4: a support agent handling
 * a "my site is slow" ticket has no reason to ever see a shell transcript,
 * so this reads a SEPARATE env var from ADMIN_EMAILS, not a subset check.
 */

function parseEmailList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Is this email allowed to view recording CONTENT (not just metadata)? */
function isRecordingAccessAuthorized(email, envValue = process.env.TERMINAL_RECORDING_ACCESS_EMAILS) {
  const list = parseEmailList(envValue);
  const e = String(email || "").trim().toLowerCase();
  return !!e && list.includes(e);
}

/**
 * Build an access-log entry. Pure — the caller persists it. `granted` is
 * always recorded, including denials: a pattern of denied attempts against a
 * given session is itself a signal worth being able to see later, so a
 * refusal is logged exactly like a successful access, never silently dropped.
 */
function buildAccessLogEntry({ sessionName, accessedBy, reason, granted, nowIso }) {
  if (!sessionName) throw new Error("buildAccessLogEntry requires sessionName.");
  if (!accessedBy) throw new Error("buildAccessLogEntry requires accessedBy.");
  if (!reason || !String(reason).trim()) {
    const e = new Error("A reason is required to access a recording.");
    e.code = "REASON_REQUIRED";
    throw e;
  }
  return {
    session: sessionName,
    accessed_by: String(accessedBy).trim().toLowerCase(),
    accessed_at: nowIso || new Date().toISOString(),
    reason: String(reason).trim(),
    granted: granted ? 1 : 0,
  };
}

module.exports = { parseEmailList, isRecordingAccessAuthorized, buildAccessLogEntry };
