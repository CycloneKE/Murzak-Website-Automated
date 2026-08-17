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
 *
 * Domain Registration (and any other product with a genuinely zero server
 * footprint — ramMb 0 AND diskGb 0) is capacityClass "volume" but has
 * NOTHING to build: no container, no RAM, no disk. Before this fix these
 * fell through to "coolify" and (a) enqueued a real Coolify build job for a
 * purchase that should touch no infrastructure, and (b) coolify.js's RAM
 * floor (Math.max(job.ram_mb, DEFAULT_RAM_MB)) then allocated real RAM on the
 * capacity-capped shared box anyway. Manual = "escalate to a human", which is
 * exactly right for a manually-fulfilled, zero-footprint purchase like a
 * domain registration.
 */
function laneFor(meta) {
  if (!meta) return "manual";
  if (meta.capacityClass === "dedicated") return "manual";
  if (meta.capacityClass === "premium") return "bench";
  if (meta.capacityClass === "scalable") return "k8s";
  if (meta.category === "Domain Registration") return "manual";
  // Email Hosting runs on HOSTINGER, not our VPS. Before this, the volume-class
  // email products fell through to "coolify" and (a) built a meaningless
  // container for a service that needs none, (b) reserved 256-384MB on the
  // RAM-capped box for a product that consumes zero of it, and (c) provisioned
  // no email at all. Same failure as the Domain Registration case above, but it
  // slipped past that guard because email declares a non-zero ramMb.
  // Checked after "dedicated" so Enterprise Mail (a custom quote) stays manual.
  //
  // "Bulk Email / Newsletters" is in this category but is NOT mailbox hosting —
  // it is a campaign/transactional sender. Hostinger's mail API offers nothing
  // like it, and we have no self-hosted implementation (no curated app), so it
  // would either fake success on the email lane or build an empty container on
  // coolify. Manual until someone actually builds it.
  if (meta.category === "Email Hosting") {
    return meta.id === "addon-bulk-email" ? "manual" : "emailHosting";
  }
  // File Storage is a shared MinIO bucket, not a per-purchase container — see
  // docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
  // Routed explicitly (not via the ramMb/diskGb zero-footprint fallback below)
  // because this product DOES consume real shared disk, just not a container.
  if (meta.category === "Storage") return "objectStorage";
  if (!(Number(meta.ramMb) > 0) && !(Number(meta.diskGb) > 0)) return "manual";
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
