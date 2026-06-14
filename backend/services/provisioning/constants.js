/**
 * Shared provisioning constants. Kept in its own module so leaf modules
 * (targets, etc.) can reference the doctype name without a require cycle back
 * through provisioningService.
 */
module.exports = {
  JOB_DOCTYPE: "Provisioning Job",
};
