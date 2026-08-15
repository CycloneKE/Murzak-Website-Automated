/**
 * Provisioning readiness tests — runs without Redis or Frappe.
 *   node test/readiness.test.js   (or: npm test)
 *
 * Covers the doctype-field-drift check added after a real incident
 * (2026-08-11/12): the "Provisioning Job" doctype existed, but two fields
 * fetchClaimable() depends on (repo_url, deployment_history) were added to
 * the code/fixture after the doctype was first installed and never
 * re-synced in production — Frappe 417'd every fetchClaimable() call,
 * silently killing all provisioning, forever, with only a console.error.
 * doctype_job (existence) stayed green the whole time; only a field-level
 * check catches this class of drift.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { getReadiness } = require("../services/provisioning/readiness");
const { CLAIMABLE_JOB_FIELDS } = require("../services/provisioning/runner");

function makeClient(doctypeFieldnames) {
  return {
    get: async (url) => {
      if (url.includes("/DocType/")) {
        return { data: { data: { name: decodeURIComponent(url.split("/").pop()), fields: doctypeFieldnames.map((f) => ({ fieldname: f })) } } };
      }
      if (url.includes("/Custom Field")) return { data: { data: [] } };
      // Any plain doctype list probe (doctypeInstalled) — pretend it exists.
      return { data: { data: [] } };
    },
  };
}

(async () => {
  section("doctype_job_fields: catches drift between the fixture and the live doctype");
  {
    // Every CLAIMABLE_JOB_FIELDS field present except two — the exact
    // real-world incident.
    const fields = CLAIMABLE_JOB_FIELDS.filter((f) => f !== "repo_url" && f !== "deployment_history");
    const client = makeClient(fields);
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "doctype_job_fields");
    ok(!!check, "check is present");
    ok(check.ok === false, "flags NOT ok when fields are missing");
    ok(check.detail.includes("repo_url") && check.detail.includes("deployment_history"), "names the specific missing fields");
    ok(check.level === "required", "is a required check (would block 'ready')");
  }

  section("doctype_job_fields: green once every field is present");
  {
    const client = makeClient(CLAIMABLE_JOB_FIELDS);
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "doctype_job_fields");
    ok(check.ok === true, "passes once all fields exist");
    ok(check.detail === "", "no alarming detail text on a passing check");
  }

  section("doctype_job_fields: implicit Frappe fields (name, owner, ...) never false-flag as missing");
  {
    // "name" is Frappe's implicit primary key — it's never listed in a
    // DocType's own `fields` child table, so a naive "is it in fields?"
    // check would always report it missing even on a fully-correct doctype.
    const client = makeClient(CLAIMABLE_JOB_FIELDS.filter((f) => f !== "name"));
    // CLAIMABLE_JOB_FIELDS doesn't actually include "name" as a real gap
    // case here since fetchClaimable requests "name" as a field too — this
    // just confirms the doctype-meta fetch doesn't choke on its absence.
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "doctype_job_fields");
    ok(check.ok === true, "implicit fields (name/owner/creation/...) are never treated as missing");
  }

  section("doctype_job_fields: skipped (not false-green) when the doctype itself doesn't exist");
  {
    const client = {
      get: async (url) => {
        if (url.includes("/DocType/")) {
          const e = new Error("404");
          e.response = { status: 404 };
          throw e;
        }
        const e = new Error("404");
        e.response = { status: 404 };
        throw e;
      },
    };
    const r = await getReadiness(client);
    const jobCheck = r.checks.find((c) => c.key === "doctype_job");
    const fieldsCheck = r.checks.find((c) => c.key === "doctype_job_fields");
    ok(jobCheck.ok === false, "doctype_job itself correctly fails");
    ok(!fieldsCheck, "field-drift check doesn't run (and doesn't false-report) when the doctype is missing entirely");
  }

  // ------------------------------------------------------------------
  // FIX ROUND 3 (P0 workflow safety): runner_enabled used to grade
  // "optional" unconditionally, so `ready: true` was achievable with the
  // runner off and NO deliberate opt-out — reclaimStaleRunning() never
  // sweeps, backoff retries never fire, gated jobs are never re-examined,
  // yet readiness looked fine. PROVISIONING_PHASE=notify-only is now the
  // only way to keep the runner off without failing readiness.
  // ------------------------------------------------------------------
  function withEnv(vars, fn) {
    const prev = {};
    for (const k of Object.keys(vars)) prev[k] = process.env[k];
    Object.assign(process.env, vars);
    return Promise.resolve(fn()).finally(() => {
      for (const k of Object.keys(vars)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    });
  }

  // Baseline that satisfies every OTHER required check, so toggling only
  // PROVISIONING_PHASE below isolates runner_enabled's effect on r.ready.
  const READY_BASELINE_ENV = {
    ADMIN_EMAILS: "ops@example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "u",
    SMTP_PASS: "p",
    PROVISIONING_ENABLED: "true",
  };

  section("runner_enabled: runner off, no PROVISIONING_PHASE opt-out — required and fails");
  await withEnv({ ...READY_BASELINE_ENV, PROVISIONING_RUNNER_ENABLED: "false", PROVISIONING_PHASE: "" }, async () => {
    const client = makeClient(CLAIMABLE_JOB_FIELDS);
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "runner_enabled");
    ok(check.level === "required", "runner_enabled is required by default (no silent notify-only)");
    ok(check.ok === false, "fails when the runner is off and no phase is declared");
    ok(check.detail.includes("PROVISIONING_PHASE=notify-only"), "detail names the opt-out");
    ok(r.ready === false, "overall readiness is false — provisioning being silently dead now blocks ready:true");
  });

  section("runner_enabled: runner off, PROVISIONING_PHASE=notify-only — deliberate opt-out passes");
  await withEnv({ ...READY_BASELINE_ENV, PROVISIONING_RUNNER_ENABLED: "false", PROVISIONING_PHASE: "notify-only" }, async () => {
    const client = makeClient(CLAIMABLE_JOB_FIELDS);
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "runner_enabled");
    ok(check.level === "optional", "regrades to optional once notify-only is explicitly declared");
    ok(check.ok === true, "passes — this is a deliberate declaration, not a default");
    ok(r.ready === true, "overall readiness is true — same infra, only the declaration changed");
  });

  section("runner_enabled: runner on — passes regardless of PROVISIONING_PHASE");
  await withEnv({ PROVISIONING_RUNNER_ENABLED: "true", PROVISIONING_PHASE: "" }, async () => {
    const client = makeClient(CLAIMABLE_JOB_FIELDS);
    const r = await getReadiness(client);
    const check = r.checks.find((c) => c.key === "runner_enabled");
    ok(check.ok === true, "passes when the runner is actually on");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
