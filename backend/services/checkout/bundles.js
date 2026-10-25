/**
 * Bundle pricing — pure companion validation and saving computation.
 *
 * No I/O. Everything is gated behind BUNDLES_ENABLED === "true" (default off).
 * Pairings gate only the SAVING; the allowed-companion rule gates VALIDITY, so
 * an allowed companion without a pairing is accepted at full price.
 */

const PAIRINGS = require("../../data/bundlePairings.json");
const { getServiceMeta } = require("../provisioning/catalog");
const { effectiveFootprint } = require("../provisioning/capacity");
const { isAppService } = require("../apps/appOrder");

const BUNDLE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_COMPANIONS = 3;
const ZERO_RAM_IDS = new Set(["starter-email", "biz-email", "starter-storage"]);

function bundlesEnabled() {
  return process.env.BUNDLES_ENABLED === "true";
}

function reject(message) {
  const err = new Error(message);
  err.statusCode = 422;
  return err;
}

function isBusinessApp(id) {
  return id === "biz-crm-helpdesk" || id.startsWith("biz-erp-");
}

function isZeroRamCompanion(id) {
  return id.startsWith("domain-") || ZERO_RAM_IDS.has(id);
}

function validateCompanions({ primaryId, companions }) {
  if (!bundlesEnabled()) throw reject("Bundles are not available yet.");
  const list = Array.isArray(companions) ? companions : [];
  if (list.length > MAX_COMPANIONS) throw reject(`You can add at most ${MAX_COMPANIONS} companions.`);
  if (!getServiceMeta(primaryId)) throw reject("Unknown primary service.");

  const seen = new Set();
  let businessApps = 0;
  return list.map((c) => {
    const serviceId = String(c?.serviceId || "");
    if (seen.has(serviceId)) throw reject(`${serviceId} was added more than once.`);
    seen.add(serviceId);
    if (serviceId === primaryId) throw reject("A companion must differ from the main item.");
    const meta = getServiceMeta(serviceId);
    if (!meta) throw reject(`Unknown companion ${serviceId}.`);
    if (isAppService(serviceId)) throw reject("Shop-address apps cannot be added as companions.");
    if (isBusinessApp(serviceId)) {
      businessApps += 1;
      if (businessApps > 1) throw reject("Only one business app can be added as a companion.");
    } else if (!isZeroRamCompanion(serviceId)) {
      throw reject(`${meta.name || serviceId} cannot be bundled.`);
    }
    return { serviceId, config: c.config && typeof c.config === "object" ? c.config : {}, meta };
  });
}

function computeBundle({ primaryId, companions }) {
  const lines = [];
  const savings = [];
  let monthlyAndSetup = 0;
  for (const c of companions || []) {
    const meta = getServiceMeta(c.serviceId);
    const monthlyKes = Number(meta?.monthlyKes || 0);
    const setupKes = Number(meta?.setupKes || 0);
    lines.push({ serviceId: c.serviceId, monthlyKes, setupKes });
    monthlyAndSetup += monthlyKes + setupKes;
    const p = PAIRINGS.find((x) => x.companionId === c.serviceId && x.primaryIds.includes(primaryId));
    if (!p) continue;
    const raw = p.saving.type === "firstMonthFree" ? monthlyKes : Number(p.saving.kes || 0);
    const savingKes = Math.max(0, Math.min(raw, monthlyKes + setupKes));
    if (savingKes > 0) {
      savings.push({
        serviceId: c.serviceId,
        savingKes,
        reason: p.saving.type === "firstMonthFree" ? "First month free" : "Bundle saving",
      });
    }
  }
  const savingKes = Math.min(savings.reduce((s, x) => s + x.savingKes, 0), monthlyAndSetup);
  return { lines, savingKes, savings };
}

function footprintOf(primaryId, companions) {
  const ids = [primaryId, ...(companions || []).map((c) => c.serviceId)];
  return ids.reduce(
    (acc, id) => {
      const f = effectiveFootprint(getServiceMeta(id));
      return { ramMb: acc.ramMb + f.ramMb, diskGb: acc.diskGb + f.diskGb };
    },
    { ramMb: 0, diskGb: 0 }
  );
}

module.exports = { bundlesEnabled, BUNDLE_WINDOW_MS, MAX_COMPANIONS, validateCompanions, computeBundle, footprintOf };
