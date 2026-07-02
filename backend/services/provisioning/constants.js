/**
 * Shared provisioning constants. Kept in its own module so leaf modules
 * (targets, etc.) can reference the doctype name without a require cycle back
 * through provisioningService.
 */
module.exports = {
  JOB_DOCTYPE: "Provisioning Job",
  // Web Account doctype + child-table field names (mirror server.js defaults) so
  // the runner can flip a managed service row to "Active" when provisioning
  // completes. Override via env if server.js ever does.
  WEB_ACCOUNT_DOCTYPE: process.env.WEB_ACCOUNT_DOCTYPE || "Web Account",
  WEB_ACCOUNT_SERVICES_FIELD: process.env.WEB_ACCOUNT_SERVICES_FIELD || "selected_services",
  CHILD_SERVICE_ID_FIELD: process.env.CHILD_SERVICE_ID_FIELD || "service_id",
  CHILD_STATUS_FIELD: process.env.CHILD_STATUS_FIELD || "status",
  // Managed-setup (premium SaaS) service status; flipped to "Active" on completion.
  STATUS_SETTING_UP: "Setting up",
  STATUS_ACTIVE: "Active",
};
