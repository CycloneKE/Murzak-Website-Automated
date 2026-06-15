// services/orderCapacity.js
//
// Server-side per-order capacity guard. Mirrors the configurator's client-side
// cap (frontend serviceCatalog.exceedsSelfServeCap) so a crafted request can't
// place an order that no single shared tenant on the box could serve. Reads the
// generated catalog snapshot (resource footprint) — the same source provisioning
// uses. Fleet-level oversell across tenants is gated separately at provisioning.

const { getServiceMeta, CAPACITY } = require("./provisioning/catalog");

// Cap precedence: env override → catalog snapshot (single source of truth,
// generated from serviceCatalog.ts) → hardcoded fallback. Reading the snapshot
// keeps this guard in lockstep with the configurator's client-side caps.
function capMb() {
  const env = Number(process.env.SELF_SERVE_ORDER_RAM_CAP_MB);
  if (Number.isFinite(env) && env > 0) return env;
  const snap = Number(CAPACITY?.selfServeOrderRamCapMb);
  if (Number.isFinite(snap) && snap > 0) return snap;
  return 6144; // 6 GB
}
function capDiskGb() {
  const env = Number(process.env.SELF_SERVE_ORDER_DISK_CAP_GB);
  if (Number.isFinite(env) && env > 0) return env;
  const snap = Number(CAPACITY?.selfServeOrderDiskCapGb);
  if (Number.isFinite(snap) && snap > 0) return snap;
  return 80; // 80 GB
}

// Sum the real RAM/disk footprint of a selection. Unknown ids contribute 0
// (they carry no measurable footprint in the snapshot).
function orderFootprint(selectedServices = []) {
  let ramMb = 0;
  let diskGb = 0;
  for (const s of Array.isArray(selectedServices) ? selectedServices : []) {
    const id = typeof s === "string" ? s : s?.serviceId || s?.service_id;
    const meta = id ? getServiceMeta(String(id)) : null;
    if (meta) {
      ramMb += Number(meta.ramMb || 0);
      diskGb += Number(meta.diskGb || 0);
    }
  }
  return { ramMb, diskGb };
}

// Throws a 422 if a single self-serve order exceeds the shared-tenant caps.
function assertOrderWithinCapacity(selectedServices = []) {
  const { ramMb, diskGb } = orderFootprint(selectedServices);
  if (ramMb > capMb() || diskGb > capDiskGb()) {
    const err = new Error(
      "This configuration needs dedicated capacity. Reduce services or contact sales for a dedicated quote."
    );
    err.statusCode = 422;
    err.footprint = { ramMb, diskGb, ramCapMb: capMb(), diskCapGb: capDiskGb() };
    throw err;
  }
}

module.exports = { orderFootprint, assertOrderWithinCapacity, capMb, capDiskGb };
