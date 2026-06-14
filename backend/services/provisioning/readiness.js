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

async function getReadiness(client) {
  const runnerOn = flag("PROVISIONING_RUNNER_ENABLED");
  const bullmq = String(process.env.PROVISIONING_QUEUE || "poll").toLowerCase() === "bullmq";
  const checks = [];
  const add = (key, label, ok, level, detail) => checks.push({ key, label, ok: !!ok, level, detail: detail || "" });

  // --- Frappe doctypes ---
  const jobDt = await doctypeInstalled(client, JOB_DOCTYPE);
  add("doctype_job", `Doctype: ${JOB_DOCTYPE}`, jobDt.ok, "required", jobDt.detail);
  const capDt = await doctypeInstalled(client, CAPACITY_REQUEST_DOCTYPE);
  add("doctype_capacity", `Doctype: ${CAPACITY_REQUEST_DOCTYPE}`, capDt.ok, "optional", capDt.detail || "needed only for scale-out records");

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
  const coolOk = coolify.isConfigured();
  const benchOk = bench.isConfigured();
  add("lane_coolify", "Lane: Coolify (web/app/db)", coolOk, runnerOn ? "conditional" : "optional", coolOk ? "" : coolify.configError());
  add("lane_bench", "Lane: Frappe bench (ERP/POS/CRM)", benchOk, runnerOn ? "conditional" : "optional", benchOk ? "" : bench.configError());
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
