/**
 * Go-live readiness — a checklist the admin panel renders so you can SEE what's
 * configured after adding env vars. Each check has a level:
 *   - required:    must be green for the provisioning feature to work at all
 *   - conditional: required only because of how you've configured things
 *                  (e.g. a lane is required once the runner is enabled)
 *   - optional:    nice-to-have upsell/hardening
 *
 * `ready` is true when every required + conditional check passes.
 */

const { JOB_DOCTYPE } = require("./constants");
const { CAPACITY_REQUEST_DOCTYPE } = require("./scaling");
const { ORDER_DOCTYPE } = require("../checkout/orderStore");
const { CLAIMABLE_JOB_FIELDS } = require("./runner");
const coolify = require("./lanes/coolify");
const bench = require("./lanes/bench");
const backups = require("./backups");
const edge = require("./edge");
const targets = require("./targets");
const queue = require("./queue");

const enc = encodeURIComponent;

function flag(name, dflt = "false") {
  return String(process.env[name] || dflt).toLowerCase() === "true";
}

/** Does a doctype exist? Probe a 1-row list; 404/417 means "not installed". */
async function doctypeInstalled(client, doctype) {
  try {
    await client.get(`/api/resource/${enc(doctype)}`, { params: { limit_page_length: 1 } });
    return { ok: true };
  } catch (e) {
    const code = e?.response?.status;
    if (code === 404 || code === 417) return { ok: false, detail: "not installed" };
    return { ok: false, detail: e.message };
  }
}

/**
 * Does a field exist on a doctype, whether it's a NATIVE field (baked
 * directly into the DocType's own definition — the case for every field on
 * Murzak's own custom doctypes, e.g. Web Account.app_port,
 * Portal Invoice.mpesa_checkout_request_id) or an EXTENSION added via a
 * separate "Custom Field" record (the case for fields bolted onto a doctype
 * after the fact, e.g. the terminal-consent fields)? Checking only "Custom
 * Field" misses every native field and reports a false "not installed" —
 * caught live 2026-08-11 installing this exact fixture set.
 *
 * Note: a Custom Field created moments ago can take a short while to appear
 * in Frappe's cached runtime meta even though the record exists correctly —
 * this checks the record exists, not whether the cache has caught up. If a
 * feature still doesn't work right after this goes green, that's a cache
 * propagation issue (needs a `bench clear-cache` / worker restart on the
 * Frappe side), not a missing field.
 */
async function customFieldInstalled(client, dt, fieldname) {
  try {
    const dtRes = await client.get(`/api/resource/DocType/${enc(dt)}`);
    const nativeFields = (dtRes.data?.data?.fields || []).map((f) => f.fieldname);
    if (nativeFields.includes(fieldname)) {
      return { ok: true, detail: `native field on ${dt}` };
    }
  } catch {
    // Doctype meta fetch failed — fall through to the Custom Field check;
    // doctypeInstalled() elsewhere already reports if the doctype itself is missing.
  }

  try {
    const res = await client.get(`/api/resource/Custom Field`, {
      params: {
        filters: JSON.stringify([["dt", "=", dt], ["fieldname", "=", fieldname]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });
    const found = (res.data?.data || []).length > 0;
    return { ok: found, detail: found ? "" : "not installed" };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

/**
 * Does a doctype have every field in `requiredFields`? Catches drift between
 * the fixture in backend/data/ (which the runner's code was updated against)
 * and what's actually installed in Frappe — a missing field here makes
 * Frappe reject fetchClaimable()'s GET outright (417), silently killing
 * provisioning entirely, every tick, forever, with no signal but a
 * console.error. Reproduced live 2026-08-11/12 — see CLAIMABLE_JOB_FIELDS's
 * comment in runner.js for the full incident.
 */
// "name" (and a handful of other Frappe built-ins: owner, creation,
// modified, docstatus, ...) are implicit on every document — Frappe never
// lists them in a DocType's own `fields` child table, so checking for them
// there always false-positives as "missing." Only compare the fields that
// are actually meant to be declared.
const IMPLICIT_DOC_FIELDS = new Set(["name", "owner", "creation", "modified", "modified_by", "docstatus", "idx"]);

async function doctypeHasFields(client, doctype, requiredFields) {
  try {
    const res = await client.get(`/api/resource/DocType/${enc(doctype)}`);
    const have = new Set((res.data?.data?.fields || []).map((f) => f.fieldname));
    const missing = requiredFields.filter((f) => !IMPLICIT_DOC_FIELDS.has(f) && !have.has(f));
    return { ok: missing.length === 0, missing };
  } catch (e) {
    return { ok: false, missing: requiredFields, detail: e.message };
  }
}

async function getReadiness(client) {
  const runnerOn = flag("PROVISIONING_RUNNER_ENABLED");
  const bullmq = String(process.env.PROVISIONING_QUEUE || "poll").toLowerCase() === "bullmq";
  const checks = [];
  const add = (key, label, ok, level, detail) => checks.push({ key, label, ok: !!ok, level, detail: detail || "" });

  // --- Frappe doctypes ---
  const jobDt = await doctypeInstalled(client, JOB_DOCTYPE);
  add("doctype_job", `Doctype: ${JOB_DOCTYPE}`, jobDt.ok, "required", jobDt.detail);

  // Doctype existing isn't enough — every field the runner's fetchClaimable()
  // reads must also exist, or Frappe 417s the GET and provisioning silently
  // dies entirely (see CLAIMABLE_JOB_FIELDS's comment in runner.js).
  if (jobDt.ok) {
    const fieldsCheck = await doctypeHasFields(client, JOB_DOCTYPE, CLAIMABLE_JOB_FIELDS);
    add("doctype_job_fields", `Doctype: ${JOB_DOCTYPE} has all runner-required fields`, fieldsCheck.ok, "required",
      fieldsCheck.ok ? "" :
        `missing: ${fieldsCheck.missing.join(", ")} — provisioning silently stops entirely until these are added ` +
        "(run backend/scripts/install-provisioning-doctype.js, it merges missing fields idempotently)");
  }

  const capDt = await doctypeInstalled(client, CAPACITY_REQUEST_DOCTYPE);
  add("doctype_capacity", `Doctype: ${CAPACITY_REQUEST_DOCTYPE}`, capDt.ok, "optional", capDt.detail || "needed only for scale-out records");
  // Not provisioning-specific, but every self-serve purchase (any category,
  // not just what this runner builds) goes through orderStore.js first —
  // missing this doctype 503s ALL checkout, silently, with no readiness
  // signal until now. See backend/data/doctype-checkout-order.json.
  const orderDt = await doctypeInstalled(client, ORDER_DOCTYPE);
  add("doctype_checkout_order", `Doctype: ${ORDER_DOCTYPE}`, orderDt.ok, "required",
    orderDt.ok ? "" : (orderDt.detail || "") + " — self-serve checkout is completely broken without this — import backend/data/doctype-checkout-order.json");

  const updateDt = await doctypeInstalled(client, "Portal Update");
  add("doctype_portal_update", "Doctype: Portal Update", updateDt.ok, "required",
    updateDt.ok ? "" : (updateDt.detail || "") + " — portal 'Updates & support' feed and concierge chat can't read/write — import backend/data/doctype-portal-update.json");

  // M-Pesa STK-push callback matches the paying invoice via this field —
  // without it the callback logs "no invoice found" and silently never
  // activates the service, even though Safaricom confirmed the payment.
  // Only meaningful once M-Pesa creds are actually set.
  const mpesaConfigured = !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET);
  if (mpesaConfigured) {
    const mpesaField = await customFieldInstalled(client, "Portal Invoice", "mpesa_checkout_request_id");
    add("custom_field_mpesa", "Custom field: Portal Invoice.mpesa_checkout_request_id", mpesaField.ok, "required",
      mpesaField.ok ? mpesaField.detail : "M-Pesa payments will be captured by Safaricom but never activate the service — import backend/data/custom-fields-portal-invoice-mpesa.json");
  }

  // Developer-terminal consent gate (approve + accept-disclosure) writes to
  // these Web Account custom fields. Missing them doesn't error — Frappe
  // silently drops writes to unknown fields — so approvals appear to work
  // but customers stay stuck at "awaiting approval" forever. Only relevant
  // once the terminal feature itself is enabled.
  const terminalOn = flag("TERMINAL_ENABLED");
  if (terminalOn) {
    const consentField = await customFieldInstalled(client, "Web Account", "terminal_disclosure_accepted_at");
    add("custom_field_terminal_consent", "Custom field: Web Account.terminal_disclosure_accepted_at", consentField.ok, "required",
      consentField.ok ? consentField.detail : "approve/accept-disclosure calls silently persist nothing — import backend/data/custom-fields-web-account.json");

    const sessionDt = await doctypeInstalled(client, "Terminal Session");
    add("doctype_terminal_session", "Doctype: Terminal Session", sessionDt.ok, "required",
      sessionDt.ok ? "" : (sessionDt.detail || "") + " — run backend/scripts/install-terminal-doctypes.js");
    const recLogDt = await doctypeInstalled(client, "Terminal Recording Access Log");
    add("doctype_terminal_recording_log", "Doctype: Terminal Recording Access Log", recLogDt.ok, "required",
      recLogDt.ok ? "" : (recLogDt.detail || "") + " — run backend/scripts/install-terminal-doctypes.js");
  }

  // --- Notifications (Phase 0 depends on these) ---
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  add("admin_emails", "Staff notify: ADMIN_EMAILS set", adminEmails.length > 0, "required",
    adminEmails.length ? `${adminEmails.length} recipient(s)` : "no recipients — staff won't be alerted");
  const smtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  add("smtp", "Email: SMTP configured", smtp, "required", smtp ? "" : "SMTP_HOST/USER/PASS missing");

  add("provisioning_enabled", "Provisioning enabled (PROVISIONING_ENABLED)", flag("PROVISIONING_ENABLED", "true"), "required");

  // --- Runner / dispatcher ---
  add("runner_enabled", "Runner enabled (PROVISIONING_RUNNER_ENABLED)", runnerOn, "optional",
    runnerOn ? "" : "Phase 0 (notify-only) works without this");

  let dispatcherMode = "off";
  try { dispatcherMode = (await queue.health()).mode; } catch { /* ignore */ }
  add("dispatcher", `Dispatcher mode: ${dispatcherMode}`, dispatcherMode !== "off" || !runnerOn, "conditional",
    runnerOn ? `running in ${dispatcherMode} mode` : "dispatcher off (runner disabled)");

  // Lanes — required once the runner is on (otherwise jobs only escalate).
  const mock = require("./lanes/mock");
  const mockOn = mock.isEnabled();
  const coolOk = mockOn || coolify.isConfigured();
  const benchOk = mockOn || bench.isConfigured();
  add("lane_coolify", "Lane: Coolify (web/app/db)", coolOk, runnerOn ? "conditional" : "optional", mockOn ? "mock mode" : coolOk ? "" : coolify.configError());
  add("lane_bench", "Lane: Frappe bench (ERP/POS/CRM)", benchOk, runnerOn ? "conditional" : "optional", mockOn ? "mock mode" : benchOk ? "" : bench.configError());
  if (mockOn) add("lane_mock", "Mock provisioning active", true, "optional", "builds are simulated — no real infrastructure");
  if (runnerOn) {
    add("lane_any", "At least one build lane configured", coolOk || benchOk, "conditional",
      coolOk || benchOk ? "" : "with no lane, every job escalates to needs_human");
  }

  // Redis — required when bullmq dispatch is selected AND runner is on.
  if (runnerOn && bullmq) {
    const dedicated = !!process.env.PROVISIONING_REDIS_URL;
    const anyRedis = dedicated || !!process.env.REDIS_URL;
    add("redis_url", "BullMQ: Redis URL set", anyRedis, "conditional",
      dedicated ? "dedicated PROVISIONING_REDIS_URL" : anyRedis ? "using shared REDIS_URL — prefer a dedicated one" : "no Redis URL");
    add("redis_dedicated", "BullMQ: dedicated, persistent Redis", dedicated, "optional",
      dedicated ? "" : "sharing the session cache risks eviction dropping jobs");
    add("redis_connected", "BullMQ: broker reachable", dispatcherMode === "bullmq", "conditional",
      dispatcherMode === "bullmq" ? "" : "dispatcher fell back to poll — check the Redis URL");
  }

  // --- Hardening / upsell (optional) ---
  add("backups", "Off-site backups (BACKUP_CONFIG_CMD)", backups.isConfigured(), "optional",
    backups.isConfigured() ? "" : "tenants record backup_status=skipped");
  add("edge", "Per-tenant edge / WAF (EDGE_CONFIG_CMD)", edge.isConfigured(), "optional",
    edge.isConfigured() ? "" : "tenants record edge_status=skipped");
  const autoscale = flag("PROVISIONING_AUTOSCALE") && !!process.env.HOSTINGER_API_TOKEN;
  add("autoscale", "Auto-scale to KVM #2 (Hostinger)", autoscale, "optional",
    autoscale ? "armed" : "manual approval (recommended default)");

  const targetCount = targets.listTargets().length;
  add("targets", `Capacity targets: ${targetCount} box(es)`, targetCount >= 1, "optional");

  const ready = checks.filter((c) => c.level === "required" || c.level === "conditional").every((c) => c.ok);
  return { ready, mode: dispatcherMode, runnerEnabled: runnerOn, checks };
}

module.exports = { getReadiness };
