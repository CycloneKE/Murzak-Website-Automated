/**
 * File Storage browser — master kill switch, mirroring RESOURCE_ADMIN_ENABLED
 * and TERMINAL_ENABLED. Defaults to OFF so the feature stays hidden until the
 * shared MinIO bucket and STORAGE_S3_* credentials are actually live.
 */
function isStorageBrowserEnabled() {
  return String(process.env.STORAGE_BROWSER_ENABLED || "false").toLowerCase() === "true";
}

module.exports = { isStorageBrowserEnabled };
