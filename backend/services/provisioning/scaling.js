/**
 * Scaling orchestration — Phase 2.
 *
 * Turns the binary "capacity gate" into placement + scale-out:
 *   - ensureCapacityFor(): which box should host this job? (premium only)
 *   - requestScaleOut():   when no box has headroom, record a Capacity Request
 *     and alert staff. If PROVISIONING_AUTOSCALE=true AND a Hostinger token is
 *     set, also fire the API to create the next box; otherwise it's a human's
 *     call (creating a paid VPS automatically is opt-in by design).
 *
 * Everything here is best-effort and never throws into the provisioning path.
 */

const targets = require("./targets");

const CAPACITY_REQUEST_DOCTYPE = "Capacity Request";
const enc = encodeURIComponent;

function autoscaleEnabled() {
  return String(process.env.PROVISIONING_AUTOSCALE || "false").toLowerCase() === "true";
}

function adminRecipients() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decide where a job runs.
 * @returns {Promise<{ok:boolean, target:string|null, reserved?:object}>}
 *   ok:true  -> place on `target`
 *   ok:false -> no headroom anywhere; caller should requestScaleOut + escalate
 */
async function ensureCapacityFor(client, { ramMb, capacityClass }) {
  if (capacityClass === "scalable") {
    // K8s cluster manages its own distributed resources and HPA
    return { ok: true, target: "k8s-cluster" };
  }
  if (capacityClass !== "premium") {
    return { ok: true, target: targets.PRIMARY_ID };
  }
  const { target, reserved } = await targets.placePremium(client, ramMb);
  if (target) return { ok: true, target, reserved };
  return { ok: false, target: null, reserved };
}

/** Find an open (pending/provisioning) capacity request, if any. Best-effort. */
async function findOpenRequest(client) {
  try {
    const res = await client.get(`/api/resource/${enc(CAPACITY_REQUEST_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["status", "in", ["pending", "provisioning"]]]),
        fields: JSON.stringify(["name", "status"]),
        limit_page_length: 1,
      },
    });
    return res.data?.data?.[0] || null;
  } catch {
    return null;
  }
}

async function notifyStaff(subject, text) {
  const to = adminRecipients();
  if (!to.length) return { sent: false, reason: "no ADMIN_EMAILS" };
  try {
    const { sendMail } = require("../../utils/mailer");
    await sendMail({ to: to.join(","), subject, text });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

/**
 * Optional: actually create the next box via the Hostinger API. Guarded by
 * PROVISIONING_AUTOSCALE + HOSTINGER_API_TOKEN. Real call, but only fires when
 * explicitly enabled. Returns {triggered, ref|error}. Never throws.
 */
async function triggerHostingerProvision({ reason }) {
  if (!autoscaleEnabled() || !process.env.HOSTINGER_API_TOKEN) {
    return { triggered: false, reason: "autoscale disabled or no token" };
  }
  try {
    const axios = require("axios");
    const c = axios.create({
      baseURL: (process.env.HOSTINGER_API_BASE || "https://api.hostinger.com").replace(/\/+$/, ""),
      headers: { Authorization: `Bearer ${process.env.HOSTINGER_API_TOKEN}` },
      timeout: Number(process.env.HOSTINGER_TIMEOUT_MS || 30000),
    });
    // Integration point: create a VPS from a preconfigured plan/template.
    const res = await c.post("/api/vps/v1/virtual-machines", {
      plan: process.env.HOSTINGER_VPS_PLAN,
      data_center_id: process.env.HOSTINGER_DC_ID,
      template_id: process.env.HOSTINGER_TEMPLATE_ID,
      hostname: `murzak-box-${Date.now()}`,
      // note carried for audit; Hostinger ignores unknown fields
      note: `auto-scale: ${reason}`,
    });
    const ref = res.data?.data?.id || res.data?.id || "requested";
    return { triggered: true, ref: String(ref) };
  } catch (e) {
    return { triggered: false, error: e.response?.data?.message || e.message };
  }
}

/**
 * Record the need for more capacity and alert staff. Idempotent: if a request is
 * already open, it just returns it. Never throws.
 */
async function requestScaleOut(client, { reason, ramMb }) {
  const open = await findOpenRequest(client);
  if (open) {
    return { ok: true, deduped: true, request: open.name, status: open.status };
  }

  const auto = await triggerHostingerProvision({ reason });
  const status = auto.triggered ? "provisioning" : "pending";

  let requestName = null;
  let doctypeMissing = false;
  try {
    const res = await client.post(`/api/resource/${enc(CAPACITY_REQUEST_DOCTYPE)}`, {
      reason: String(reason || "RAM gate reached").slice(0, 500),
      requested_ram_mb: Number(ramMb) || 0,
      status,
      autoscale: auto.triggered ? 1 : 0,
      external_ref: auto.ref || "",
      error: auto.error || "",
    });
    requestName = res.data?.data?.name || null;
  } catch (e) {
    const code = e?.response?.status;
    if (code === 404 || code === 417) doctypeMissing = true;
  }

  await notifyStaff(
    `[Capacity] Box at RAM limit — ${auto.triggered ? "auto-scaling" : "approve KVM #2"}`,
    `The provisioning RAM gate has been reached.

Reason: ${reason}
Needs ~${Number(ramMb) || 0}MB for the next premium tenant.

${
  auto.triggered
    ? `Auto-scale fired (ref ${auto.ref}). Verify the new box provisioned, then add it to PROVISIONING_TARGETS.`
    : auto.error
    ? `Auto-scale attempt FAILED: ${auto.error}. Provision KVM #2 manually.`
    : `Auto-scale is off (PROVISIONING_AUTOSCALE!=true). Provision KVM #2 manually, then add it to PROVISIONING_TARGETS.`
}

Gated jobs are parked as needs_human; re-queue them once the new box is live.

— Murzak provisioning (Phase 2)`
  );

  return { ok: true, deduped: false, request: requestName, status, autoscale: auto.triggered, doctypeMissing };
}

module.exports = {
  CAPACITY_REQUEST_DOCTYPE,
  autoscaleEnabled,
  ensureCapacityFor,
  findOpenRequest,
  requestScaleOut,
  triggerHostingerProvision,
};
