/**
 * Provisioning service — Phase 0 (notify + audit trail).
 *
 * When an invoice is paid and its services flip Active, this records one
 * "Provisioning Job" per service (status=queued) and emails staff so a human can
 * provision from the runbook. No automation runs yet — Phase 1 adds the runner
 * that turns these queued jobs into real Coolify/bench builds.
 *
 * Design rules:
 *  - NEVER throw into the payment/activation path. Every public function here is
 *    best-effort and swallows its own errors (returning a summary instead).
 *  - Idempotent: jobs are keyed by (invoice, service_id); re-running activation
 *    never double-creates a job.
 *  - Degrades gracefully if the "Provisioning Job" doctype doesn't exist yet
 *    (Phase 0 can ship notify-only before the doctype is imported).
 */

const { getServiceMeta, laneFor, CAPACITY } = require("./catalog");
const { JOB_DOCTYPE } = require("./constants");
const { isValidRepoUrl } = require("../../utils/repoUrl");
const dbPortAllocator = require("./dbPortAllocator");

function isEnabled() {
  // On by default; set PROVISIONING_ENABLED=false to pause without touching payments.
  return String(process.env.PROVISIONING_ENABLED || "true").toLowerCase() !== "false";
}

function adminRecipients() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * serviceIds accepts either plain string ids (legacy callers, and every
 * existing test in this file) or { serviceId, domainChoice } objects — the
 * richer shape billingActivationService.js now passes so a domain
 * registration's purchased domain string survives into the staff
 * notification email (see jobLine/notifyStaffOfJobs below). domainChoice is
 * NEVER written onto the persisted Provisioning Job doc (that doctype's
 * schema is not ours to extend here) — it is carried only in the in-memory
 * created/skipped entries used for the email.
 */
function normalizeServiceInputs(serviceIds) {
  return (Array.isArray(serviceIds) ? serviceIds : [])
    .map((s) =>
      typeof s === "string"
        ? { serviceId: s.trim(), domainChoice: "" }
        : { serviceId: String(s?.serviceId || "").trim(), domainChoice: s?.domainChoice || "" }
    )
    .filter((s) => s.serviceId);
}

/** Find an existing job for (invoice, serviceId), or null. Best-effort. */
async function findExistingJob(client, invoice, serviceId) {
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([
          ["invoice", "=", invoice],
          ["service_id", "=", serviceId],
        ]),
        fields: JSON.stringify(["name", "status"]),
        limit_page_length: 1,
      },
    });
    return res.data?.data?.[0] || null;
  } catch (e) {
    // Doctype missing (417/404) or transient error — treat as "not found" but
    // signal the caller via a thrown marker only for doctype-missing.
    if (e.__doctypeMissing) throw e;
    return null;
  }
}

/** Sum ram of jobs already running/active (reserved footprint). null on failure. */
async function getReservedRamMb(client) {
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["status", "in", ["running", "active"]]]),
        fields: JSON.stringify(["ram_mb"]),
        limit_page_length: 0,
      },
    });
    const rows = res.data?.data || [];
    return rows.reduce((sum, r) => sum + (Number(r.ram_mb) || 0), 0);
  } catch {
    return null;
  }
}

// The one choke point every job creation passes through — validates
// service_id and repo_url before either is ever written to the doctype or
// baked into job_key. A leading-space service_id reached production and
// silently broke the portal's activity lookup (string equality against the
// trimmed id everywhere else never matched); an unrecognized service_id
// used to fall through to lane "manual" with an empty category/ram/disk
// instead of a clearly-flagged job a human would notice.
function buildJobPayload({ webAccount, invoice, serviceId, repoUrl, appPort }) {
  const trimmedServiceId = String(serviceId || "").trim();
  const meta = getServiceMeta(trimmedServiceId);
  const lane = laneFor(meta);
  const port = Number(appPort);
  const trimmedRepoUrl = String(repoUrl || "").trim();
  // BYOA: a service that deploys the customer's own repo carries it on the
  // job; with no repo on file, or a malformed one, the job is born
  // needs_human (never a fake build against a bad URL).
  const byoa = meta?.requiresRepo
    ? trimmedRepoUrl && isValidRepoUrl(trimmedRepoUrl)
      ? {
          repo_url: trimmedRepoUrl,
          // Port the app listens on — the coolify lane exposes this on the
          // container (falls back to COOLIFY_DEFAULT_APP_PORT / 3000 when 0).
          ...(Number.isInteger(port) && port > 0 && port <= 65535 ? { app_port: port } : {}),
        }
      : {
          status: "needs_human",
          error: trimmedRepoUrl
            ? `BYOA service but the repository URL on the account ("${trimmedRepoUrl}") isn't a valid https/git@ URL — ask the customer to fix it (My Account → Project repository).`
            : "BYOA service but no repository URL on the account — ask the customer for their Git repo (My Account → Project repository).",
        }
    : {};
  // Unrecognized service_id (catalog drift, a bad request that slipped past
  // upstream checks) — flag for a human instead of silently enqueuing a
  // manual-lane job with no name/category/footprint. BYOA's own needs_human
  // above takes priority when both apply (meta is null there too, so `byoa`
  // is always {} in that branch — no conflict).
  const unknownService = !meta
    ? {
        status: "needs_human",
        error: `Unrecognized service id "${trimmedServiceId}" — not in the catalog snapshot. A human must provision this manually.`,
      }
    : {};
  return {
    web_account: webAccount,
    invoice,
    service_id: trimmedServiceId,
    // Unique key (enforced by a unique index on the doctype) so concurrent
    // enqueues for the same (invoice, service) can't create duplicate jobs even
    // if the findExistingJob check-then-insert races — the second insert is
    // rejected and treated as "already queued".
    job_key: `${invoice}::${trimmedServiceId}`,
    service_name: meta?.name || trimmedServiceId,
    category: meta?.category || "",
    capacity_class: meta?.capacityClass || "",
    lane,
    status: "queued",
    attempts: 0,
    ram_mb: meta?.ramMb || 0,
    disk_gb: meta?.diskGb || 0,
    target: "box-1",
    backup_status: "pending",
    ...unknownService,
    ...byoa,
  };
}

/**
 * Create a queued Provisioning Job per service id (idempotent).
 * Returns { created:[], skipped:[], doctypeMissing:bool, error:string|null }.
 * Never throws.
 */
async function enqueueProvisioningForInvoice({ client, webAccount, invoiceDocName, serviceIds }) {
  const created = [];
  const skipped = [];
  let doctypeMissing = false;

  const services = normalizeServiceInputs(serviceIds);
  const ids = services.map((s) => s.serviceId);

  // Capacity gate (Phase 2): premium tenants are RAM-heavy. Ask scaling which
  // box can host each one; if none has headroom, park it as needs_human and
  // request scale-out (the "provision KVM #2" signal). Lazy require avoids a
  // load-time cycle (scaling -> targets -> constants). Runtime re-checks in the
  // runner are authoritative — enqueue placement is advisory.
  const scaling = require("./scaling");
  let scaleOutNeeded = null;

  // BYOA: fetch the account's project repository once if any service in this
  // order deploys the customer's own code. Best-effort — a fetch failure just
  // means the job is born needs_human (same as no repo on file).
  let accountRepoUrl = "";
  let accountAppPort = 0;
  if (ids.some((id) => getServiceMeta(id)?.requiresRepo)) {
    try {
      const accRes = await client.get(
        `/api/resource/Web Account/${encodeURIComponent(webAccount)}`
      );
      accountRepoUrl = String(accRes.data?.data?.source_code || "").trim();
      accountAppPort = Number(accRes.data?.data?.app_port) || 0;
    } catch (e) {
      console.warn(`[provisioning] BYOA repo lookup failed for ${webAccount}: ${e.message}`);
    }
  }

  const reservedPortsThisBatch = new Set();
  for (const { serviceId, domainChoice } of services) {
    const payload = buildJobPayload({
      webAccount,
      invoice: invoiceDocName,
      serviceId,
      repoUrl: accountRepoUrl,
      appPort: accountAppPort,
    });
    const meta = getServiceMeta(serviceId);

    // Phase 2: Database Hosting jobs get a real external port so a customer
    // can connect with their own SQL client. Only for jobs that are actually
    // going to be built (status is still "queued" here — buildJobPayload
    // already flipped it to needs_human for an unrecognized id, so don't
    // bother allocating a port for a job that's escalating regardless).
    if (payload.category === "Database Hosting" && payload.status === "queued") {
      const port = await dbPortAllocator.allocatePort(client, { exclude: reservedPortsThisBatch });
      if (port) {
        payload.external_port = port;
        reservedPortsThisBatch.add(port);
      } else {
        payload.status = "needs_human";
        payload.error = "No external port available in the configured range — the pool is exhausted or Frappe couldn't be queried.";
      }
    }

    if (meta?.capacityClass === "premium") {
      const placement = await scaling.ensureCapacityFor(client, {
        ramMb: payload.ram_mb,
        capacityClass: "premium",
      });
      if (placement.ok) {
        payload.target = placement.target;
      } else {
        payload.status = "needs_human";
        payload.gated = 1;
        payload.error = "Capacity gate: no box has RAM headroom — scale-out requested (provision KVM #2)";
        scaleOutNeeded = {
          reason: `No box headroom for ${payload.service_name} (~${payload.ram_mb}MB)`,
          ramMb: payload.ram_mb,
        };
      }
    }
    try {
      const existing = await findExistingJob(client, invoiceDocName, serviceId);
      if (existing?.name) {
        skipped.push({ ...payload, name: existing.name, reason: "already queued", domainChoice });
        continue;
      }
      const res = await client.post(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, payload);
      const createdName = res.data?.data?.name;
      created.push({ ...payload, name: createdName, domainChoice });
      // Low-latency dispatch (bullmq mode only; no-op in poll/off). Lazy require
      // avoids a load-time cycle; never throws into the payment path. Only
      // dispatch jobs that are actually runnable (queued), not gated ones.
      if (createdName && payload.status === "queued") {
        try {
          require("./queue").enqueue(createdName);
        } catch (e) {
          /* dispatcher not ready / poll mode — reconcile or poll will pick it up */
        }
      }
    } catch (e) {
      const status = e?.response?.status;
      const errText = `${e?.response?.data?.exception || e?.response?.data?._error_message || e?.message || ""}`;
      // Frappe returns 417/404 when the doctype doesn't exist yet.
      if (status === 404 || status === 417 || e.__doctypeMissing) {
        doctypeMissing = true;
        // Still surface the service so staff get notified even without the doctype.
        skipped.push({ ...payload, reason: "doctype not installed", domainChoice });
      } else if (status === 409 || /duplicate|already exists|unique/i.test(errText)) {
        // Lost the enqueue race — the unique job_key index rejected this insert.
        // Idempotent: a job for (invoice, service) already exists.
        skipped.push({ ...payload, reason: "already queued (unique)", domainChoice });
      } else {
        skipped.push({ ...payload, reason: `error: ${e?.message || status || "unknown"}`, domainChoice });
      }
    }
  }

  if (scaleOutNeeded) {
    // Idempotent + best-effort; never throws.
    await scaling.requestScaleOut(client, scaleOutNeeded);
  }

  return { created, skipped, doctypeMissing, error: null };
}

function jobLine(j) {
  const lane = j.lane === "manual" ? "MANUAL (quote/separate box)" : j.lane;
  const ram = j.ram_mb ? ` · ~${(j.ram_mb / 1024).toFixed(1)}GB RAM` : "";
  // Surfaces the purchased domain string (or hosting domainChoice) so staff
  // fulfilling a manually-provisioned order — most importantly a domain
  // registration — can actually see WHAT was bought, not just the SKU name.
  const domain = j.domainChoice ? ` · domain: ${j.domainChoice}` : "";
  const flag = j.gated
    ? " · ⚠ CAPACITY-GATED (needs KVM #2)"
    : j.status === "needs_human"
    ? " · ⚠ needs human"
    : "";
  return `• ${j.service_name} [${j.category}]${domain} → lane: ${lane}${ram}${flag}`;
}

/** Email staff about newly-queued jobs. Best-effort; never throws. */
async function notifyStaffOfJobs({ jobs, webAccount, invoiceDocName, reservedRamMb, doctypeMissing }) {
  const to = adminRecipients();
  if (!to.length || !jobs.length) {
    return { sent: false, reason: !to.length ? "no ADMIN_EMAILS configured" : "no jobs" };
  }

  let sendMail;
  try {
    ({ sendMail } = require("../../utils/mailer"));
  } catch (e) {
    return { sent: false, reason: `mailer unavailable: ${e.message}` };
  }

  const reqRam = jobs.reduce((s, j) => s + (Number(j.ram_mb) || 0), 0);
  const sellable = CAPACITY.sellableRamMb || 0;
  const reserved = typeof reservedRamMb === "number" ? reservedRamMb : null;
  const headroom =
    reserved != null && sellable
      ? `Box RAM: ${reserved}MB reserved + ${reqRam}MB this order of ${sellable}MB sellable ` +
        `(${Math.round(((reserved + reqRam) / sellable) * 100)}% after).`
      : `This order needs ~${reqRam}MB RAM (sellable budget ${sellable}MB).`;

  const lines = jobs.map(jobLine).join("\n");
  const warn = doctypeMissing
    ? "\n\n⚠ The 'Provisioning Job' doctype is not installed in Frappe yet, so these were NOT recorded — provision from the order details above and import the doctype to enable the audit trail."
    : "";

  const text = `New paid order needs provisioning.

Account: ${webAccount}
Invoice: ${invoiceDocName}

Services:
${lines}

${headroom}${warn}

Follow the provisioning runbook, then flip each Provisioning Job to "active" in the admin view.

— Murzak provisioning (Phase 0)`;

  try {
    await sendMail({
      to: to.join(","),
      subject: `[Provisioning] ${jobs.length} service(s) queued — ${invoiceDocName}`,
      text,
    });
    return { sent: true, to };
  } catch (e) {
    return { sent: false, reason: `sendMail failed: ${e.message}` };
  }
}

/**
 * Top-level Phase-0 entry point. Enqueues jobs and notifies staff.
 * Fully wrapped: returns a summary and NEVER throws, so a paid invoice is never
 * rolled back by a provisioning hiccup.
 */
async function runProvisioningForInvoice({ client, webAccount, invoiceDocName, serviceIds }) {
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: "PROVISIONING_ENABLED=false" };
  }
  // serviceIds may be plain string ids or { serviceId, domainChoice } objects
  // (see normalizeServiceInputs) — both are truthy, so filter(Boolean) works
  // for either shape; enqueueProvisioningForInvoice normalizes it further.
  const ids = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : [];
  if (!ids.length) {
    return { ok: true, jobs: 0, reason: "no services to provision" };
  }

  try {
    const result = await enqueueProvisioningForInvoice({
      client,
      webAccount,
      invoiceDocName,
      serviceIds: ids,
    });

    // Notify on everything we attempted (created + skipped-for-doctype), so a
    // missing doctype still pages a human.
    const notifyJobs = [...result.created, ...result.skipped.filter((s) => s.reason === "doctype not installed")];
    const reservedRamMb = result.doctypeMissing ? null : await getReservedRamMb(client);

    const notify = await notifyStaffOfJobs({
      jobs: notifyJobs.length ? notifyJobs : result.created,
      webAccount,
      invoiceDocName,
      reservedRamMb,
      doctypeMissing: result.doctypeMissing,
    });

    return {
      ok: true,
      created: result.created.length,
      skipped: result.skipped.length,
      doctypeMissing: result.doctypeMissing,
      notified: notify.sent,
      notifyReason: notify.reason,
    };
  } catch (e) {
    // Last-resort guard — log and move on; payment already succeeded.
    console.error(`[provisioning] runProvisioningForInvoice failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  JOB_DOCTYPE,
  isEnabled,
  buildJobPayload,
  enqueueProvisioningForInvoice,
  notifyStaffOfJobs,
  getReservedRamMb,
  runProvisioningForInvoice,
};
