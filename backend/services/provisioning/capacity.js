/**
 * Capacity gate — keeps provisioning from overselling the single KVM 4.
 *
 * RAM is the binding constraint (light web/email tenants are cheap; ERP tenants
 * eat 1–2GB each). The gate compares already-reserved RAM + the new job's RAM
 * against a threshold (a fraction of the sellable budget). When it trips, the
 * job is escalated to a human instead of auto-built — the signal to provision
 * KVM #2 rather than oversell.
 */

const { CAPACITY } = require("./catalog");

function sellableRamMb() {
  return Number(CAPACITY.sellableRamMb) || 0;
}

/** Fraction of sellable RAM we allow to be auto-committed (default 85%). */
function thresholdPct() {
  const pct = Number(process.env.PROVISIONING_RAM_THRESHOLD_PCT);
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) return pct;
  return 85;
}

function thresholdMb() {
  return Math.floor((sellableRamMb() * thresholdPct()) / 100);
}

/** True when committing this job would push reserved RAM past the threshold. */
function gateExceeded({ reserved, ramMb }) {
  const limit = thresholdMb();
  if (!limit) return false; // no capacity data -> don't block (fail open to human review elsewhere)
  return Number(reserved || 0) + Number(ramMb || 0) > limit;
}

function summary({ reserved, ramMb }) {
  return {
    reservedMb: Number(reserved || 0),
    requestMb: Number(ramMb || 0),
    thresholdMb: thresholdMb(),
    sellableMb: sellableRamMb(),
    exceeded: gateExceeded({ reserved, ramMb }),
  };
}

module.exports = { sellableRamMb, thresholdPct, thresholdMb, gateExceeded, summary };
