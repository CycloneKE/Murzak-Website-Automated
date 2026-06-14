/**
 * Capacity targets — Phase 2 (horizontal scale).
 *
 * A "target" is a server that can host tenants. There is always box-1 (the
 * original Hostinger KVM 4, sized from SERVER_CAPACITY). Additional boxes are
 * declared in PROVISIONING_TARGETS as JSON, e.g.:
 *
 *   PROVISIONING_TARGETS='[{"id":"box-2","sellableRamMb":12800,"status":"active",
 *     "coolify":{"baseUrl":"https://cool2…","token":"…","projectUuid":"…","serverUuid":"…"},
 *     "benchCmd":"/opt/murzak/provision-box2.sh"}]'
 *
 * Premium tenants are RAM-heavy, so the runner asks placePremium() which box has
 * headroom; when none does, scaling.js requests a new box. Volume tenants are
 * light and always land on box-1.
 */

const capacity = require("./capacity");
const { JOB_DOCTYPE } = require("./constants");

const enc = encodeURIComponent;
const PRIMARY_ID = "box-1";

/** All known targets (box-1 + env extras). box-1 uses the flat COOLIFY_ / BENCH_ env. */
function listTargets() {
  const box1 = {
    id: PRIMARY_ID,
    primary: true,
    status: "active",
    sellableRamMb: capacity.sellableRamMb(),
  };
  let extras = [];
  try {
    const parsed = JSON.parse(process.env.PROVISIONING_TARGETS || "[]");
    if (Array.isArray(parsed)) {
      extras = parsed
        .filter((t) => t && t.id && t.id !== PRIMARY_ID)
        .map((t) => ({
          status: "active",
          sellableRamMb: capacity.sellableRamMb(),
          ...t,
        }));
    }
  } catch (e) {
    console.warn(`[provisioning] PROVISIONING_TARGETS is not valid JSON: ${e.message}`);
  }
  return [box1, ...extras];
}

function getTarget(id) {
  return listTargets().find((t) => t.id === id) || null;
}

/**
 * Per-target usage (running + active jobs): reserved RAM and premium-tenant
 * count, keyed by target id.
 */
async function usageByTarget(client) {
  const out = {};
  const bump = (id) => (out[id] = out[id] || { ramMb: 0, premium: 0 });
  try {
    const res = await client.get(`/api/resource/${enc(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["status", "in", ["running", "active"]]]),
        fields: JSON.stringify(["ram_mb", "target", "capacity_class"]),
        limit_page_length: 0,
      },
    });
    for (const r of res.data?.data || []) {
      const u = bump(r.target || PRIMARY_ID);
      u.ramMb += Number(r.ram_mb) || 0;
      if (r.capacity_class === "premium") u.premium += 1;
    }
  } catch {
    // best-effort — caller treats missing data as "0 reserved"
  }
  return out;
}

/** Back-compat: per-target reserved RAM (numbers), keyed by target id. */
async function reservedByTarget(client) {
  const usage = await usageByTarget(client);
  const out = {};
  for (const [id, u] of Object.entries(usage)) out[id] = u.ramMb;
  return out;
}

function targetLimitMb(target) {
  return Math.floor((Number(target.sellableRamMb) || 0) * capacity.thresholdPct() / 100);
}

/** Max premium tenants allowed on a target (cap noisy-neighbour on shared bench/DB). */
function premiumCap(target) {
  if (target.id === PRIMARY_ID) {
    const env = Number(process.env.PROVISIONING_BOX1_MAX_PREMIUM);
    return Number.isFinite(env) && env > 0 ? env : Infinity;
  }
  const cap = Number(target.maxPremiumTenants);
  return Number.isFinite(cap) && cap > 0 ? cap : Infinity;
}

/**
 * Pick the first active target with headroom for a premium job — bounded by BOTH
 * the RAM gate and the premium-tenant cap (so a box's shared bench/MariaDB isn't
 * overloaded even when raw RAM would allow it).
 * @returns {Promise<{target:string|null, reserved:object}>} target=null => scale out.
 */
async function placePremium(client, ramMb) {
  const usage = await usageByTarget(client);
  const reserved = {};
  for (const [id, u] of Object.entries(usage)) reserved[id] = u.ramMb;
  const need = Number(ramMb) || 0;
  for (const t of listTargets()) {
    if (t.status === "draining") continue; // not accepting new tenants
    const u = usage[t.id] || { ramMb: 0, premium: 0 };
    const ramOk = u.ramMb + need <= targetLimitMb(t);
    const countOk = u.premium < premiumCap(t);
    if (ramOk && countOk) {
      return { target: t.id, reserved };
    }
  }
  return { target: null, reserved };
}

module.exports = {
  PRIMARY_ID,
  listTargets,
  getTarget,
  usageByTarget,
  reservedByTarget,
  targetLimitMb,
  premiumCap,
  placePremium,
};
