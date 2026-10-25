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

// ---- Post-purchase (14-day window) ----------------------------------------
// Kept free of orderStore imports (orderStore requires this module); the order
// doctype name and config shape are mirrored locally.
const ORDER_DOCTYPE = "Checkout Order";

function parseOrderConfig(json) {
  try {
    const v = json ? JSON.parse(json) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The same validity rule validateCompanions applies, for one candidate id. */
function isAllowedCompanion(primaryId, serviceId) {
  if (!serviceId || serviceId === primaryId) return false;
  if (!getServiceMeta(serviceId)) return false;
  if (isAppService(serviceId)) return false;
  return isBusinessApp(serviceId) || isZeroRamCompanion(serviceId);
}

function pairingSaving(pairing, meta) {
  const monthlyKes = Number(meta?.monthlyKes || 0);
  const setupKes = Number(meta?.setupKes || 0);
  const raw = pairing.saving.type === "firstMonthFree" ? monthlyKes : Number(pairing.saving.kes || 0);
  return Math.max(0, Math.min(raw, monthlyKes + setupKes));
}

/**
 * This account's PAID orders whose add-on window is still open
 * (windowEndsAtMs >= nowMs: exactly the end instant is still valid). An unpaid
 * order never carries a window, so it never appears here.
 */
async function activeBundleWindows({ client, webAccountName, nowMs }) {
  if (!bundlesEnabled()) return [];
  let rows;
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
      params: {
        fields: JSON.stringify(["name", "web_account", "status", "service_id", "config_json"]),
        filters: JSON.stringify([["web_account", "=", webAccountName], ["status", "=", "Paid"]]),
        limit_page_length: 0,
      },
    });
    rows = res.data?.data || [];
  } catch (e) {
    // Doctype not installed here: no orders, so no windows.
    if (e.__doctypeMissing || e.response?.status === 404 || e.response?.status === 417) return [];
    throw e;
  }
  const out = [];
  for (const r of rows) {
    // Re-filter in JS; the backend may not honor the filters param.
    if (r.status !== "Paid" || r.web_account !== webAccountName) continue;
    const bundle = parseOrderConfig(r.config_json).bundle;
    const endsAt = bundle && typeof bundle === "object" ? bundle.windowEndsAtMs : undefined;
    if (!Number.isFinite(endsAt) || endsAt < nowMs) continue;
    out.push({
      orderId: r.name,
      primaryId: r.service_id,
      windowEndsAtMs: endsAt,
      applied: Array.isArray(bundle.applied) ? bundle.applied.map(String) : [],
    });
  }
  return out;
}

/**
 * The saving for adding `serviceIds` inside an open window. A pairing's saving
 * applies at most once per paid order (windows[].applied lists the pairing ids
 * already used); each add-on line takes its saving from the first window that
 * still has it. Each saving is capped at that line's monthly + setup.
 */
function savingForAddOn({ windows, serviceIds, nowMs }) {
  const applied = [];
  if (!bundlesEnabled()) return { savingKes: 0, applied };
  const open = (windows || []).filter((w) => Number.isFinite(w.windowEndsAtMs) && w.windowEndsAtMs >= nowMs);
  for (const serviceId of new Set(serviceIds || [])) {
    const meta = getServiceMeta(serviceId);
    if (!meta) continue;
    for (const w of open) {
      const p = PAIRINGS.find(
        (x) => x.companionId === serviceId && x.primaryIds.includes(w.primaryId) && !(w.applied || []).includes(x.id)
      );
      if (!p) continue;
      const savingKes = pairingSaving(p, meta);
      if (savingKes > 0) {
        applied.push({ serviceId, savingKes, pairingId: p.id, orderId: w.orderId });
        break;
      }
    }
  }
  return { savingKes: applied.reduce((s, a) => s + a.savingKes, 0), applied };
}

/** Allowed, not-yet-owned companions with a live saving, per open window. */
function offersForWindows({ windows, ownedServiceIds, nowMs }) {
  const owned = new Set(ownedServiceIds || []);
  const seen = new Set();
  const offers = [];
  for (const w of windows || []) {
    if (!(w.windowEndsAtMs >= nowMs)) continue;
    for (const p of PAIRINGS) {
      if (!p.primaryIds.includes(w.primaryId) || (w.applied || []).includes(p.id)) continue;
      if (owned.has(p.companionId) || seen.has(p.companionId)) continue;
      if (!isAllowedCompanion(w.primaryId, p.companionId)) continue;
      const meta = getServiceMeta(p.companionId);
      const savingKes = pairingSaving(p, meta);
      if (!(savingKes > 0)) continue;
      seen.add(p.companionId);
      offers.push({
        serviceId: p.companionId,
        name: meta.name || p.companionId,
        monthlyKes: Number(meta.monthlyKes) || 0,
        savingKes,
        windowEndsAtMs: w.windowEndsAtMs,
      });
    }
  }
  return offers;
}

/** Record used pairing ids on the paid order (fresh read, merged into config.bundle.applied). */
async function recordAppliedPairings({ client, orderId, pairingIds }) {
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`);
  const config = parseOrderConfig(res.data?.data?.config_json);
  const bundle = config.bundle && typeof config.bundle === "object" ? { ...config.bundle } : {};
  const applied = Array.isArray(bundle.applied) ? bundle.applied.map(String) : [];
  for (const id of pairingIds) if (!applied.includes(id)) applied.push(id);
  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, {
    config_json: JSON.stringify({ ...config, bundle: { ...bundle, applied } }),
  });
}

/**
 * After an add-on invoice exists: reduce it by any open-window saving and record
 * the used pairings. `amountKes` is the amount the caller already knows (never
 * read back). No saving => no writes at all. A saving with an unknown amount
 * throws 500 before anything is written.
 */
async function applyAddOnSaving({ client, webAccountName, invoiceDocName, amountKes, serviceIds, nowMs }) {
  if (!bundlesEnabled()) return { savingKes: 0 };
  const windows = await activeBundleWindows({ client, webAccountName, nowMs });
  const { savingKes, applied } = savingForAddOn({ windows, serviceIds, nowMs });
  if (!(savingKes > 0)) return { savingKes: 0 };

  const known = Number(amountKes);
  if (!Number.isFinite(known) || known <= 0 || !invoiceDocName) {
    const e = new Error("Could not determine the invoice amount for this bundle.");
    e.statusCode = 500;
    throw e;
  }
  await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
    amount: Math.max(0, known - savingKes),
  });
  const byOrder = new Map();
  for (const a of applied) byOrder.set(a.orderId, [...(byOrder.get(a.orderId) || []), a.pairingId]);
  for (const [orderId, pairingIds] of byOrder) await recordAppliedPairings({ client, orderId, pairingIds });
  return { savingKes, applied };
}

module.exports = {
  bundlesEnabled,
  BUNDLE_WINDOW_MS,
  MAX_COMPANIONS,
  validateCompanions,
  computeBundle,
  footprintOf,
  isAllowedCompanion,
  activeBundleWindows,
  savingForAddOn,
  offersForWindows,
  applyAddOnSaving,
};
