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

/**
 * config.bundle.applied entries: { pairingId, invoiceDocName, savingKes }.
 * Legacy plain-string entries read as { pairingId } with no invoice.
 */
function appliedEntries(bundle) {
  const raw = bundle && Array.isArray(bundle.applied) ? bundle.applied : [];
  return raw
    .map((e) => (typeof e === "string"
      ? { pairingId: e, invoiceDocName: "", savingKes: 0 }
      : { pairingId: String(e?.pairingId || ""), invoiceDocName: String(e?.invoiceDocName || ""), savingKes: Number(e?.savingKes) || 0 }))
    .filter((e) => e.pairingId);
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
      applied: appliedEntries(bundle).map((e) => e.pairingId),
      appliedEntries: appliedEntries(bundle),
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

// In-process per-order critical section (single Node process, same assumption
// as orderStore's serialize mutex).
const orderLocks = new Map();
function withOrderLock(orderId, fn) {
  const prev = orderLocks.get(orderId) || Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => {});
  orderLocks.set(orderId, tail);
  tail.then(() => { if (orderLocks.get(orderId) === tail) orderLocks.delete(orderId); });
  return p;
}

async function readOrderBundle(client, orderId) {
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`);
  const config = parseOrderConfig(res.data?.data?.config_json);
  const bundle = config.bundle && typeof config.bundle === "object" ? { ...config.bundle } : {};
  return { config, bundle };
}

async function writeOrderBundle(client, orderId, config, bundle, entries) {
  await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(orderId)}`, {
    config_json: JSON.stringify({ ...config, bundle: { ...bundle, applied: entries } }),
  });
}

/** Claim pairings on one order (fresh read, merged); returns the entries actually claimed. */
function claimPairings({ client, orderId, candidates, invoiceDocName }) {
  return withOrderLock(orderId, async () => {
    const { config, bundle } = await readOrderBundle(client, orderId);
    const entries = appliedEntries(bundle);
    const taken = new Set(entries.map((e) => e.pairingId));
    const claimed = candidates
      .filter((c) => !taken.has(c.pairingId))
      .map((c) => ({ pairingId: c.pairingId, invoiceDocName, savingKes: c.savingKes }));
    if (!claimed.length) return [];
    await writeOrderBundle(client, orderId, config, bundle, [...entries, ...claimed]);
    return claimed;
  });
}

function releasePairings({ client, orderId, claimed, invoiceDocName }) {
  return withOrderLock(orderId, async () => {
    const { config, bundle } = await readOrderBundle(client, orderId);
    const ids = new Set(claimed.map((c) => c.pairingId));
    const entries = appliedEntries(bundle).filter((e) => !(ids.has(e.pairingId) && e.invoiceDocName === invoiceDocName));
    await writeOrderBundle(client, orderId, config, bundle, entries);
  });
}

async function ownedIds(client, webAccountName) {
  try {
    const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const rows = res.data?.data?.selected_services;
    return (Array.isArray(rows) ? rows : []).map((r) => String(r?.service_id ?? r?.serviceId ?? "").trim()).filter(Boolean);
  } catch (e) {
    if (e.response?.status === 404) return [];
    throw e;
  }
}

/**
 * After an add-on invoice exists (created OR merged into an open one): reduce it
 * by the open-window saving. `amountKes` is the amount the caller already knows
 * for that invoice (never read back).
 *  - Claim first, serialized per order: the pairing is recorded as
 *    { pairingId, invoiceDocName, savingKes } BEFORE the invoice PUT; a failed PUT
 *    rolls the claim back. Concurrent calls for one pairing yield one saving.
 *  - A merge resets the invoice to full price, so savings already recorded
 *    against this same (still unpaid) invoice are subtracted again, never
 *    duplicated and never lost.
 *  - The invoice never goes to 0: the new saving is skipped, and an oversized
 *    prior reduction is capped, so the amount stays >= 1.
 *  - No saving at all => no writes. A saving with an unknown amount => 500, no writes.
 */
async function applyAddOnSaving({ client, webAccountName, invoiceDocName, amountKes, serviceIds, ownedServiceIds, nowMs }) {
  if (!bundlesEnabled()) return { savingKes: 0 };
  const windows = await activeBundleWindows({ client, webAccountName, nowMs });
  if (!windows.length) return { savingKes: 0 };

  const owned = new Set(ownedServiceIds || (await ownedIds(client, webAccountName)));
  const wanted = (serviceIds || []).filter((id) => !owned.has(id));
  const { applied: candidates } = savingForAddOn({ windows, serviceIds: wanted, nowMs });
  const priorKes = windows.reduce(
    (sum, w) => sum + w.appliedEntries.filter((e) => e.invoiceDocName && e.invoiceDocName === invoiceDocName).reduce((a, e) => a + e.savingKes, 0),
    0
  );
  if (!(candidates.length || priorKes > 0)) return { savingKes: 0 };

  const known = Number(amountKes);
  if (!Number.isFinite(known) || known <= 0 || !invoiceDocName) {
    const e = new Error("Could not determine the invoice amount for this bundle.");
    e.statusCode = 500;
    throw e;
  }

  // Claim (serialized per order). Skip the new saving if it would zero the invoice.
  const claims = [];
  const newPotential = candidates.reduce((s, c) => s + c.savingKes, 0);
  if (candidates.length && known - priorKes - newPotential >= 1) {
    const byOrder = new Map();
    for (const c of candidates) byOrder.set(c.orderId, [...(byOrder.get(c.orderId) || []), c]);
    try {
      for (const [orderId, list] of byOrder) {
        const claimed = await claimPairings({ client, orderId, candidates: list, invoiceDocName });
        if (claimed.length) claims.push({ orderId, claimed });
      }
    } catch (err) {
      await rollbackClaims({ client, claims, invoiceDocName });
      throw err;
    }
  }
  const newKes = claims.reduce((s, c) => s + c.claimed.reduce((a, x) => a + x.savingKes, 0), 0);
  const totalKes = priorKes + newKes;
  if (!(totalKes > 0)) return { savingKes: 0 };

  try {
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
      amount: Math.max(1, known - totalKes),
    });
  } catch (err) {
    await rollbackClaims({ client, claims, invoiceDocName });
    throw err;
  }
  return { savingKes: totalKes, newSavingKes: newKes, applied: claims.flatMap((c) => c.claimed) };
}

async function rollbackClaims({ client, claims, invoiceDocName }) {
  for (const { orderId, claimed } of claims) {
    try {
      await releasePairings({ client, orderId, claimed, invoiceDocName });
    } catch (e) {
      console.error(`BUNDLE CLAIM ROLLBACK FAILED for order ${orderId} (pairings ${claimed.map((c) => c.pairingId).join(",")}):`, e.message);
    }
  }
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
