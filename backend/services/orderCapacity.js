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
  return 3200; // 3.2 GB — matches the real KVM 2, not the box this used to assume
}
function capDiskGb() {
  const env = Number(process.env.SELF_SERVE_ORDER_DISK_CAP_GB);
  if (Number.isFinite(env) && env > 0) return env;
  const snap = Number(CAPACITY?.selfServeOrderDiskCapGb);
  if (Number.isFinite(snap) && snap > 0) return snap;
  return 40; // 40 GB
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

/**
 * Fleet-level gate: is there room left on the box for this selection?
 *
 * assertOrderWithinCapacity above answers a different question — "could one
 * shared tenant ever be this big" — and deliberately says nothing about how
 * much of the box is already sold. That fleet question was asked in exactly
 * one place (ordersRoutes' POST /api/orders, through orderStore's reservation
 * math), so the register / plan-selection / add-on paths could each sell the
 * same 6.25GB indefinitely. This is the assertion they all share.
 *
 * Fails CLOSED when the fleet state can't be read: an unreachable Frappe means
 * "unknown", not "empty", and treating it as empty turns an outage into an
 * oversell. Zero-footprint products (domains) skip the gate entirely — they
 * consume no box capacity and must stay buyable on a full node.
 *
 * Throws 409 `code: "CAPACITY"` when full (checkout renders the waitlist off
 * this code) and 503 `code: "CAPACITY_UNKNOWN"` when it cannot tell.
 *
 * Lazy requires: provisioningService pulls in the provisioning graph, and this
 * module is required from addonInvoiceService which that graph can reach.
 */
async function assertFleetHasHeadroom({ client, selectedServices = [] }) {
  const { ramMb } = orderFootprint(selectedServices);
  if (!(ramMb > 0)) return; // zero-footprint purchase — nothing to reserve

  const { getReservedRamMb } = require("./provisioning/provisioningService");
  const { thresholdMb } = require("./provisioning/capacity");

  const reserved = await getReservedRamMb(client);
  if (reserved === null || reserved === undefined) {
    const err = new Error(
      "We couldn't confirm available capacity just now. Please try again in a moment."
    );
    err.statusCode = 503;
    err.code = "CAPACITY_UNKNOWN";
    throw err;
  }

  const limit = thresholdMb();
  if (reserved + ramMb > limit) {
    const err = new Error(
      "We're at capacity for this configuration right now. Join the waitlist and we'll email you the moment a slot frees up."
    );
    err.statusCode = 409;
    err.code = "CAPACITY";
    err.footprint = { ramMb, reservedMb: reserved, thresholdMb: limit };
    throw err;
  }
}

module.exports = {
  orderFootprint,
  assertOrderWithinCapacity,
  assertFleetHasHeadroom,
  capMb,
  capDiskGb,
};
