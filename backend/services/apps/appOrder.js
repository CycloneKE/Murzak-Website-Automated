// services/apps/appOrder.js
//
// What makes an order an APP order (a Murzak POS tier, later ERP/CRM…) and
// what it must carry. Pure — the route does the I/O.

const { getServiceMeta } = require("../provisioning/catalog");
const { checkSlug } = require("./shopAddress");

const APP_ADDRESS_SUFFIX = { pos: "pos.murzaktech.tech" };
// A row in any of these states is a shop that exists (or is being built).
const LIVE_SERVICE_STATUSES = new Set(["Active", "Setting up", "Suspended"]);

function coded(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function isAppService(serviceId) {
  return !!getServiceMeta(serviceId)?.app;
}

/**
 * @returns {null | { app: string, slug: string, shopName: string }}
 *   null when serviceId is not an app tier (caller proceeds as before).
 */
function validateAppOrder({ serviceId, config, existingServiceRows }) {
  const app = getServiceMeta(serviceId)?.app;
  if (!app) return null;

  const shopName = String(config?.shopName || "").trim().slice(0, 80);
  if (!shopName) throw coded("shop_name_required", "Please enter your shop's name.", 400);

  const slug = String(config?.slug || "").trim().toLowerCase();
  if (!checkSlug(slug).ok) throw coded("slug_invalid", "Please choose a different shop address.", 400);

  // Second shops need per-shop billing rows (phase 3); until then one live
  // shop per app per account, and the page sends the owner to the portal.
  const hasLiveShop = (existingServiceRows || []).some(
    (r) => getServiceMeta(r.serviceId)?.app === app && LIVE_SERVICE_STATUSES.has(r.status)
  );
  if (hasLiveShop) {
    throw coded("APP_EXISTS", "You already have a shop on this account — manage it from your portal.", 409);
  }

  return { app, slug, shopName };
}

module.exports = { APP_ADDRESS_SUFFIX, isAppService, validateAppOrder };
