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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
