/**
 * Pure builder for the Portal Users Requests doc payload. Extracted from
 * routes/portalRoutes.js's POST /api/portal/requests so the subject-
 * passthrough logic is unit-testable without an Express harness (which
 * this codebase doesn't have). `nowUTC` is passed in (from the caller's
 * mysqlDatetimeUTC(), a ctx-injected function) rather than computed here,
 * so this module stays a pure function of its inputs.
 */
function buildPortalRequestPayload({ portalUserId, email, webAcc, subject, message, pageUrl, attachments, nowUTC }) {
  const cleanSubject = (subject && String(subject).trim()) || "";
  return {
    portal_user: portalUserId,
    email,
    full_name: webAcc?.account_holder_name || email,
    company_name: webAcc?.entity_name || "",
    subject: cleanSubject || "Technical Sync Request",
    status: "New",
    source: "Portal",
    last_message_at: nowUTC,
    page_url: pageUrl || "",
    messages: [{
      sender_type: "User",
      sender: email,
      message,
      attachments: attachments || "",
    }],
  };
}

module.exports = { buildPortalRequestPayload };
