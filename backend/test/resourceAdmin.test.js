/**
 * Resource admin — the gate, the Coolify lane calls that back it, and the
 * teardown ordering that keeps a failed delete from creating an orphan.
 *
 * Pure functions + scripted HTTP clients, no Express harness (this codebase
 * has none). node test/resourceAdmin.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

/** Save/assign/restore process.env around a body (same helper as k8sLane.test.js). */
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/** Async form of withEnv — the lane reads COOLIFY_* at call time, not import time. */
async function withEnvAsync(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/** Minimum config for coolify.js's cfg()/http() to build a client at all. */
const LANE_ENV = {
  COOLIFY_BASE_URL: "http://coolify.test",
  COOLIFY_TOKEN: "test-token",
  COOLIFY_PROJECT_UUID: "PROJ-1",
  COOLIFY_SERVER_UUID: "SRV-1",
};

(async () => {
  const gates = require("../services/resourceAdminEligibility");
  const coolify = require("../services/provisioning/lanes/coolify");

  section("gate: plan tier");
  {
    ok(gates.isResourceAdminPlan("Business") === true, "Business plan allowed");
    ok(gates.isResourceAdminPlan("Enterprise") === true, "Enterprise plan allowed");
    ok(gates.isResourceAdminPlan("Enterprise Plus") === true, "plan match is substring-based, like the terminal gate");
    ok(gates.isResourceAdminPlan("Starter") === false, "Starter plan refused");
    ok(gates.isResourceAdminPlan("Test") === false, "Test plan refused");
    ok(gates.isResourceAdminPlan(null) === false, "missing plan refused (fail closed)");
    ok(gates.isResourceAdminPlan(undefined) === false, "undefined plan refused (fail closed)");
  }

  section("gate: kill switch defaults OFF");
  {
    ok(withEnv({ RESOURCE_ADMIN_ENABLED: "" }, () => gates.isResourceAdminEnabled()) === false, "unset -> disabled");
    ok(withEnv({ RESOURCE_ADMIN_ENABLED: "false" }, () => gates.isResourceAdminEnabled()) === false, "'false' -> disabled");
    ok(withEnv({ RESOURCE_ADMIN_ENABLED: "TRUE" }, () => gates.isResourceAdminEnabled()) === true, "'TRUE' -> enabled (case-insensitive)");
    ok(withEnv({ RESOURCE_ADMIN_ENABLED: "1" }, () => gates.isResourceAdminEnabled()) === false, "'1' is NOT enabled — only the literal 'true', matching TERMINAL_ENABLED");
  }

  section("gate: approval + disclosure read from the live record");
  {
    const client = (rec) => ({ get: async () => ({ data: { data: rec } }) });

    let g = await gates.fetchResourceAdminGates(client({}), "WA-1");
    ok(g.approved === false && g.disclosureAccepted === false, "blank record -> both gates closed");

    g = await gates.fetchResourceAdminGates(client({ resource_admin_approved_at: "2026-08-15 10:00:00" }), "WA-1");
    ok(g.approved === true && g.disclosureAccepted === false, "approval alone is not sufficient");

    g = await gates.fetchResourceAdminGates(client({ resource_admin_disclosure_accepted_at: "2026-08-15 10:00:00" }), "WA-1");
    ok(g.approved === false && g.disclosureAccepted === true, "disclosure alone is not sufficient");

    g = await gates.fetchResourceAdminGates(client({
      resource_admin_approved_at: "2026-08-15 10:00:00",
      resource_admin_disclosure_accepted_at: "2026-08-15 11:00:00",
    }), "WA-1");
    ok(g.approved === true && g.disclosureAccepted === true, "both stamped -> both gates open");

    // The terminal fields must NOT open the resource-admin gate: an account can
    // hold a shell without holding configuration rights, and vice versa.
    g = await gates.fetchResourceAdminGates(client({
      terminal_access_approved_at: "2026-08-15 10:00:00",
      terminal_disclosure_accepted_at: "2026-08-15 11:00:00",
    }), "WA-1");
    ok(g.approved === false && g.disclosureAccepted === false, "terminal grants do NOT imply resource-admin grants");

    const throwing = { get: async () => { throw new Error("frappe down"); } };
    g = await gates.fetchResourceAdminGates(throwing, "WA-1");
    ok(g.approved === false && g.disclosureAccepted === false, "lookup failure fails CLOSED and never throws");
  }

  section("lane: env CRUD hits the documented paths");
  await withEnvAsync(LANE_ENV, async () => {
    // Scripted axios-alike. coolify.js builds its client via http(opts), so we
    // stub the module's internals by asserting on a recording client injected
    // through the same axios.create seam the other lane tests rely on.
    const calls = [];
    const axios = require("axios");
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => { calls.push(["GET", url]); return { data: { data: [
        { uuid: "ENV-1", key: "API_KEY", value: "s3cret", is_shown_once: true },
        { uuid: "ENV-2", key: "PORT", value: "3000", is_buildtime: true },
      ] } }; },
      post: async (url, body) => { calls.push(["POST", url, body]); return { data: {} }; },
      patch: async (url, body) => { calls.push(["PATCH", url, body]); return { data: {} }; },
      delete: async (url) => { calls.push(["DELETE", url]); return { data: {} }; },
    });

    try {
      const envs = await coolify.listEnvs("APP-1", { kind: "application" });
      ok(calls[0][1] === "/api/v1/applications/APP-1/envs", "listEnvs GETs the application envs path");
      ok(envs.length === 2 && envs[0].key === "API_KEY", "envs normalized with key");
      ok(envs[0].isShownOnce === true, "is_shown_once carried through so the route can redact it");
      ok(envs[1].isBuildTime === true, "is_buildtime normalized to isBuildTime");

      await coolify.listEnvs("SVC-1", { kind: "service" });
      ok(calls[1][1] === "/api/v1/services/SVC-1/envs", "service kind routes to the services namespace");

      await coolify.createEnv("APP-1", { key: "FOO", value: "bar" }, { kind: "application" });
      ok(calls[2][0] === "POST" && calls[2][1] === "/api/v1/applications/APP-1/envs", "createEnv POSTs to envs");
      ok(calls[2][2].key === "FOO" && calls[2][2].value === "bar", "createEnv sends key+value");
      ok(calls[2][2].is_buildtime === false && calls[2][2].is_literal === false, "createEnv sends explicit booleans, never undefined");

      await coolify.updateEnv("APP-1", { key: "FOO", value: "baz" }, { kind: "application" });
      ok(calls[3][0] === "PATCH" && calls[3][1] === "/api/v1/applications/APP-1/envs", "updateEnv PATCHes the collection, addressing by key (not uuid)");
      ok(calls[3][2].key === "FOO" && calls[3][2].value === "baz", "updateEnv sends the new value");

      await coolify.deleteEnv("APP-1", "ENV-1", { kind: "application" });
      ok(calls[4][0] === "DELETE" && calls[4][1] === "/api/v1/applications/APP-1/envs/ENV-1", "deleteEnv addresses the env uuid");
    } finally {
      axios.create = origCreate;
    }
  });

  section("lane: runtime logs are applications-only");
  await withEnvAsync(LANE_ENV, async () => {
    let err = null;
    try {
      await coolify.getLogs("SVC-1", { lines: 100 }, { kind: "service" });
    } catch (e) { err = e; }
    ok(err && err.permanent === true, "service kind -> PERMANENT error, never a silent empty log");

    const axios = require("axios");
    const origCreate = axios.create;
    const seen = [];
    axios.create = () => ({
      get: async (url) => { seen.push(url); return { data: { data: { logs: "hello" } } }; },
    });
    try {
      const r = await coolify.getLogs("APP-1", { lines: 50 }, { kind: "application" });
      ok(seen[0] === "/api/v1/applications/APP-1/logs?lines=50", "logs path carries the lines query");
      ok(r.logs === "hello", "logs string returned");

      await coolify.getLogs("APP-1", { lines: 99999 }, { kind: "application" });
      ok(seen[1] === "/api/v1/applications/APP-1/logs?lines=1000", "lines clamped to 1000 at the lane, not just the route");

      await coolify.getLogs("APP-1", { lines: 0 }, { kind: "application" });
      ok(seen[2] === "/api/v1/applications/APP-1/logs?lines=200", "zero/absent lines falls back to the 200 default");

      axios.create = () => ({ get: async () => ({ data: { data: {} } }) });
      const empty = await coolify.getLogs("APP-1", {}, { kind: "application" });
      ok(empty.logs === "", "missing logs field -> empty string, never undefined");
    } finally {
      axios.create = origCreate;
    }
  });

  section("lane: destroy addresses the right namespace");
  await withEnvAsync(LANE_ENV, async () => {
    const axios = require("axios");
    const origCreate = axios.create;
    const seen = [];
    axios.create = () => ({ delete: async (url) => { seen.push(url); return { data: {} }; } });
    try {
      await coolify.destroy("APP-1", { kind: "application" });
      ok(seen[0] === "/api/v1/applications/APP-1", "application teardown");
      await coolify.destroy("SVC-1", { kind: "service" });
      ok(seen[1] === "/api/v1/services/SVC-1", "service teardown");
    } finally {
      axios.create = origCreate;
    }
  });

  section("lane exports are wired");
  {
    for (const fn of ["listEnvs", "createEnv", "updateEnv", "deleteEnv", "getLogs", "destroy"]) {
      ok(typeof coolify[fn] === "function", `coolify.${fn} exported`);
    }
  }

  section("secret hygiene: audit lines carry the key, never the value");
  {
    // Mirrors the format built by appendJobAudit in routes/portalRoutes.js. If
    // that format ever changes to interpolate a value, this must fail.
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "routes", "portalRoutes.js"), "utf8");
    const auditLines = src.split("\n").filter((l) => /\[ACTION\] env\./.test(l));
    ok(auditLines.length === 3, "three env audit lines (create/update/delete)");
    ok(auditLines.every((l) => /\$\{key\}|\$\{target\.key\}/.test(l)), "each audit line interpolates the KEY");
    ok(auditLines.every((l) => !/\$\{value\}|\$\{req\.body/.test(l)), "no audit line interpolates a VALUE");
  }

  section("teardown ordering: destroy before records, abort on failure");
  {
    // Static guard on billingRoutes.js — the ordering is the correctness
    // property here, and it is not observable from a pure function.
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "routes", "billingRoutes.js"), "utf8");
    const teardownAt = src.indexOf("destroyServiceInfrastructure(client, webAccountName, serviceId)");
    const removeAt = src.indexOf("updateWebAccountServices(client, webAccountName, filtered)");
    ok(teardownAt > -1, "delete route calls destroyServiceInfrastructure");
    ok(removeAt > -1, "delete route still removes the child rows");
    ok(teardownAt < removeAt, "teardown runs BEFORE the Frappe rows are removed (an orphan is created if this flips)");
    ok(/if \(!teardown\.ok\)[\s\S]{0,200}return res\.status\(502\)/.test(src), "failed teardown aborts with 502 instead of falling through");
    ok(/status: "needs_human"/.test(src), "failed teardown flags the job for a human");
    ok(/err\?\.response\?\.status !== 404/.test(src), "a 404 from upstream counts as already-gone, not a failure");
  }

  section("capacity: reserved RAM ignores deleted jobs");
  {
    const { getReservedRamMb } = require("../services/provisioning/provisioningService");
    let capturedFilters = null;
    const client = {
      get: async (_url, opts) => {
        capturedFilters = JSON.parse(opts.params.filters);
        return { data: { data: [{ ram_mb: 512 }, { ram_mb: 1024 }] } };
      },
    };
    const total = await getReservedRamMb(client);
    ok(total === 1536, "sums ram_mb across returned rows");
    const statusFilter = capturedFilters.find((f) => f[0] === "status");
    ok(!!statusFilter && !statusFilter[2].includes("deleted"), "'deleted' is not in the reserved-RAM status filter, so teardown frees capacity");
  }

  section("provisioning job doctype allows the deleted status");
  {
    const doctype = require("../data/doctype-provisioning-job.json");
    const statusField = doctype.fields.find((f) => f.fieldname === "status");
    ok(!!statusField, "status field present");
    ok(statusField.options.split("\n").includes("deleted"), "'deleted' is a valid status option");
  }

  section("web account custom fields declare the resource-admin gates");
  {
    const fields = require("../data/custom-fields-web-account.json");
    const names = fields.map((f) => f.fieldname);
    for (const f of ["resource_admin_approved_at", "resource_admin_approved_by", "resource_admin_disclosure_accepted_at"]) {
      ok(names.includes(f), `${f} declared`);
      ok(fields.find((x) => x.fieldname === f).read_only === 1, `${f} is read_only (never client-settable via the generic doc API)`);
    }
  }

  console.log("\n================================================");
  console.log(`RESOURCE ADMIN TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
