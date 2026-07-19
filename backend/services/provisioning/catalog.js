/**
 * Provisioning catalog — backend view of the service catalog.
 *
 * Reads the generated snapshot (see scripts/generate-catalog-snapshot.js) so the
 * frontend catalog stays the single source of truth. Exposes the metadata
 * provisioning needs: resource footprint, capacity class, and which lane should
 * build a given service.
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_PATH = path.resolve(__dirname, "../../data/serviceCatalogSnapshot.json");

let snapshot = { capacity: {}, items: {} };
try {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
} catch (e) {
  // Missing/corrupt snapshot must not crash the server — provisioning degrades
  // to "unknown service" (manual lane), which is the safe default.
  console.warn(
    `[provisioning] could not load catalog snapshot at ${SNAPSHOT_PATH}: ${e.message}`
  );
}

const CAPACITY = snapshot.capacity || {};
const ITEMS = snapshot.items || {};

/** Look up provisioning metadata for a catalog service id. */
function getServiceMeta(serviceId) {
  return ITEMS[serviceId] || null;
}

/**
 * Sum the real retail monthly price (KES) of a selection, reading the same
 * catalog snapshot the configurator's totals and provisioning both use.
 * Unknown ids contribute 0 (no fabricated pricing for something not in the
 * catalog). Accepts the same row shapes attach-selection/renewal pass around:
 * strings, {serviceId}, or Frappe child rows {service_id}.
 */
function sumSelectedServicesMonthlyKes(selectedServices = []) {
  let total = 0;
  for (const s of Array.isArray(selectedServices) ? selectedServices : []) {
    const id = typeof s === "string" ? s : s?.serviceId || s?.service_id;
    const meta = id ? getServiceMeta(String(id)) : null;
    if (meta) total += Number(meta.monthlyKes || 0);
  }
  return total;
}

/**
 * Which build lane handles this service.
 *  - dedicated capacity (custom-quote, separate box) -> manual
 *  - premium  (managed Frappe apps: ERP/POS/CRM/HR)  -> bench
 *  - volume   (light web/email/storage/db slices)    -> coolify
 * Unknown ids fall back to manual so a human always reviews them.
 */
function laneFor(meta) {
  if (!meta) return "manual";
  if (meta.capacityClass === "dedicated") return "manual";
  if (meta.capacityClass === "premium") return "bench";
  if (meta.capacityClass === "scalable") return "k8s";
  return "coolify";
}

module.exports = {
  SNAPSHOT_PATH,
  CAPACITY,
  ITEMS,
  getServiceMeta,
  sumSelectedServicesMonthlyKes,
  laneFor,
};
