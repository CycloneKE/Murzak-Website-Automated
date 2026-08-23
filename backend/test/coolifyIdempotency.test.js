/**
 * Regression: provision() must RECOVER an existing Coolify service instead of
 * creating a second one — under BOTH response-envelope shapes.
 *
 * Live evidence (2026-08-15 audit of 187.124.217.78): the production Coolify
 * held 12 redundant running containers — user-26-02-14-0002-starter-web-hosting
 * ×4, user-26-07-18-0001-starter-web-hosting ×4, and three more families ×3 —
 * all duplicated by NAME with different uuids. Applications had ZERO
 * duplicates. The only difference between the two idempotency checks was the
 * response-envelope fallback: provisionApp read
 * `listRes.data?.data || listRes.data || []` while provision read
 * `listRes.data?.data || []`. When Coolify answers GET /api/v1/services with a
 * BARE ARRAY, the services form evaluates to [], .find() returns undefined,
 * the check concludes "doesn't exist", and every runner retry POSTs another
 * container.
 *
 * Both shapes are asserted here precisely because the API is IP-allowlisted to
 * the VPS and we cannot observe which one it really returns — the lane must be
 * correct either way. node test/coolifyIdempotency.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const LANE_ENV = {
  COOLIFY_BASE_URL: "http://coolify.test",
  COOLIFY_TOKEN: "test-token",
  COOLIFY_PROJECT_UUID: "PROJ-1",
  COOLIFY_SERVER_UUID: "SRV-1",
};

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

(async () => {
  const coolify = require("../services/provisioning/lanes/coolify");
  const axios = require("axios");

  const JOB = { name: "PRV-1", web_account: "user-26-02-14-0002", service_id: "starter-web-hosting", ram_mb: 512, disk_gb: 5, category: "Website Hosting" };
  const EXPECTED_NAME = coolify.resourceName(JOB);

  /**
   * Client that answers the services list with `envelope` and treats ANY POST
   * as the bug: a POST here means the idempotency check failed to see the
   * service that the list plainly contains.
   */
  const makeClient = (envelope, spy) => ({
    get: async (url) => {
      if (url === "/api/v1/services") return { data: envelope };
      if (url === `/api/v1/services/EXISTING-1`) return { data: { data: { status: "running:healthy" } } };
      throw new Error("unexpected GET " + url);
    },
    post: async (url) => { spy.posted.push(url); throw new Error("DUPLICATE CREATED: unexpected POST " + url); },
    patch: async () => ({ data: {} }),
  });

  const run = async (label, envelope) => {
    const spy = { posted: [] };
    const origCreate = axios.create;
    axios.create = () => makeClient(envelope, spy);
    try {
      const res = await coolify.provision(JOB, {});
      ok(res.externalRef === "EXISTING-1", `${label}: recovered the existing uuid instead of creating`);
      ok(spy.posted.length === 0, `${label}: no POST issued (no duplicate container)`);
      ok(/recovered existing service/.test(res.log || ""), `${label}: reports recovery in the job log`);
    } catch (e) {
      ok(false, `${label}: threw instead of recovering — ${e.message}`);
    } finally {
      axios.create = origCreate;
    }
  };

  section("provision() idempotency across both envelope shapes");
  ok(EXPECTED_NAME === "user-26-02-14-0002-starter-web-hosting", `resourceName is the match key (${EXPECTED_NAME})`);

  // Shape A — wrapped. This one already worked.
  await withEnvAsync(LANE_ENV, () =>
    run("wrapped {data:[...]}", { data: [{ name: EXPECTED_NAME, uuid: "EXISTING-1" }] })
  );

  // Shape B — bare array. This is the one that produced 12 duplicates live.
  await withEnvAsync(LANE_ENV, () =>
    run("bare [...]", [{ name: EXPECTED_NAME, uuid: "EXISTING-1" }])
  );

  section("a genuinely absent service still gets created");
  await withEnvAsync(LANE_ENV, async () => {
    const origCreate = axios.create;
    let posted = 0;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [{ name: "someone-elses-service", uuid: "OTHER-1" }] };
        if (url === "/api/v1/services/NEW-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async () => { posted++; return { data: { data: { uuid: "NEW-1" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      const res = await coolify.provision(JOB, {});
      ok(posted === 1, "non-matching list -> exactly one create (idempotency must not block first provision)");
      ok(res.externalRef === "NEW-1", "new service uuid returned");
    } catch (e) {
      ok(false, `absent-service path threw: ${e.message}`);
    } finally {
      axios.create = origCreate;
    }
  });

  section("an unreadable list must NOT blind-create");
  await withEnvAsync(LANE_ENV, async () => {
    const origCreate = axios.create;
    let posted = 0;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") { const e = new Error("connect ETIMEDOUT"); throw e; }
        throw new Error("unexpected GET " + url);
      },
      post: async () => { posted++; return { data: { data: { uuid: "BLIND-1" } } }; },
      patch: async () => ({ data: {} }),
    });
    let err = null;
    try {
      await coolify.provision(JOB, {});
    } catch (e) { err = e; }
    ok(posted === 0, "list failure -> no create attempted (cannot prove absence, so cannot safely create)");
    ok(err && !err.permanent, "list failure -> RETRYABLE error, so the runner backs off and retries rather than duplicating");
    axios.create = origCreate;
  });

  // provisionApp carried the envelope fallback from the start, but shared the
  // same over-broad catch — and additionally swallowed PERMANENT errors, so a
  // failed recovery deploy fell through to creating a second application.
  section("provisionApp(): same guarantees on the BYOA path");
  const APP_JOB = { ...JOB, service_id: "starter-app-hosting", repo_url: "https://github.com/acme/app#main", app_port: 3000 };

  await withEnvAsync(LANE_ENV, async () => {
    const origCreate = axios.create;
    let posted = 0;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/applications") throw new Error("connect ETIMEDOUT");
        throw new Error("unexpected GET " + url);
      },
      post: async () => { posted++; return { data: { data: { uuid: "BLIND-APP" } } }; },
      patch: async () => ({ data: {} }),
    });
    let err = null;
    try { await coolify.provision(APP_JOB, {}); } catch (e) { err = e; }
    ok(posted === 0, "app list failure -> no create attempted");
    ok(err && !err.permanent, "app list failure -> retryable, runner retries instead of duplicating");
    axios.create = origCreate;
  });

  await withEnvAsync(LANE_ENV, async () => {
    const origCreate = axios.create;
    let posted = 0;
    // Recovery finds the app, then the deploy fails PERMANENTLY. That must
    // surface as a permanent failure — never fall through into a second create.
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/applications") return { data: [{ name: coolify.resourceName(APP_JOB), uuid: "APP-1" }] };
        if (url.startsWith("/api/v1/deployments/")) return { data: { data: { status: "failed", logs: "build blew up" } } };
        if (url === "/api/v1/applications/APP-1") return { data: { data: { fqdn: "" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url) => {
        if (url.startsWith("/api/v1/deploy")) return { data: { deployments: [{ deployment_uuid: "DEP-1" }] } };
        posted++;
        return { data: { data: { uuid: "DUPLICATE-APP" } } };
      },
      patch: async () => ({ data: {} }),
    });
    let err = null;
    try { await coolify.provision(APP_JOB, {}); } catch (e) { err = e; }
    ok(posted === 0, "failed recovery deploy -> no second application created");
    ok(err && err.permanent === true, "failed recovery deploy -> surfaces as PERMANENT, not swallowed");
    axios.create = origCreate;
  });

  console.log("\n================================================");
  console.log(`COOLIFY IDEMPOTENCY TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
