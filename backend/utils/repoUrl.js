/**
 * Validates a BYOA git repository URL — https(s):// or git@, optional
 * "#branch" suffix. Shared by every place a repo URL is accepted or
 * consumed so they can't drift out of sync with each other:
 *   - PUT /api/portal/account/repo (portalRoutes.js) — the account settings field
 *   - POST /api/register (authRoutes.js) — sourceCode at signup
 *   - GitHub-wizard connect flow (byoaRoutes.js)
 *   - the provisioning job payload itself (provisioningService.js) — the
 *     last line of defense before a job is enqueued
 */
function isValidRepoUrl(raw) {
  return /^(https?:\/\/|git@)\S+$/i.test(String(raw || ""));
}

module.exports = { isValidRepoUrl };
