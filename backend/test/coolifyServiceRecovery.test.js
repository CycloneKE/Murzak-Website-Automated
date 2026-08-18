/**
 * Regression coverage for two live bugs found recovering PRV-USER-26-08-18-
 * 0001-00029/00030 (2026-08-18): a genuinely healthy "starter-web-hosting"-
 * class Coolify service that had already failed once and been left stuck.
 *
 * 1. ensureServiceRunning killed a job on a SINGLE "exited" read, the same
 *    asymmetry the 2026-08-12 incident already fixed for "running" (two
 *    consecutive reads required there, only one here). A container that
 *    reports "exited" once mid-restart and "running" on the very next poll
 *    is healthy — the old code called that a permanent failure anyway.
 *
 * 2. attachServiceUrl's `urls` PATCH only writes Coolify's database record.
 *    Confirmed live: the container's own labels and on-disk compose file had
 *    no traefik labels or FQDN entries after a successful PATCH, and the URL 503'd.
 *    Only a subsequent restart makes Coolify regenerate the compose file
 *    with real Traefik routing labels — verified by restarting both stuck
 *    services live and watching the URL go 503 -> 200. Every prior
 *    successful provision on this lane shipped a URL that never routed
 *    until something else happened to restart the container later.
 *
 * node test/coolifyServiceRecovery.test.js
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
  COOLIFY_SERVICE_START_POLL_MS: "1",
  COOLIFY_SERVICE_START_TIMEOUT_MS: "30000",
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

  const JOB = { name: "PRV-1", web_account: "user-26-08-18-0001", service_id: "biz-web-hosting", ram_mb: 1536, disk_gb: 25 };

  section("ensureServiceRunning: one 'exited' read then 'running' -> job still succeeds");
  await withEnvAsync(LANE_ENV, async () => {
    // First read (pre-/start check) is non-running so /start actually fires;
    // the retry loop then sees exactly one "exited" read before recovering —
    // that single read must not be treated as permanent.
    const statusQueue = ["restarting:unknown", "exited:unknown", "running:unknown", "running:healthy"];
    const spy = { restarted: false, patched: null };
    const client = {
      get: async (url) => {
        if (url === "/api/v1/services") return { data: { data: [{ name: coolify.resourceName(JOB), uuid: "EXISTING-1" }] } };
        if (url === "/api/v1/services/EXISTING-1/start") return { data: {} };
        if (url === "/api/v1/services/EXISTING-1/restart") { spy.restarted = true; return { data: {} }; }
        if (url === "/api/v1/services/EXISTING-1") {
          const status = statusQueue.length > 1 ? statusQueue.shift() : statusQueue[0];
          return { data: { data: { status } } };
        }
        throw new Error("unexpected GET " + url);
      },
      patch: async (url, body) => { spy.patched = { url, body }; return { data: {} }; },
    };
    const origCreate = axios.create;
    axios.create = () => client;
    try {
      const res = await coolify.provision(JOB, {});
      ok(res.externalRef === "EXISTING-1", "a single mid-restart 'exited' read does not kill the job");
    } catch (e) {
      ok(false, `should not have thrown — ${e.message}`);
    } finally {
      axios.create = origCreate;
    }
  });

  section("ensureServiceRunning: TWO consecutive 'exited' reads -> still a permanent failure");
  await withEnvAsync(LANE_ENV, async () => {
    const client = {
      get: async (url) => {
        if (url === "/api/v1/services") return { data: { data: [{ name: coolify.resourceName(JOB), uuid: "EXISTING-2" }] } };
        if (url === "/api/v1/services/EXISTING-2/start") return { data: {} };
        if (url === "/api/v1/services/EXISTING-2") return { data: { data: { status: "exited:unknown" } } };
        throw new Error("unexpected GET " + url);
      },
      patch: async () => ({ data: {} }),
    };
    const origCreate = axios.create;
    axios.create = () => client;
    try {
      await coolify.provision(JOB, {});
      ok(false, "a container that never comes back must still permanently fail");
    } catch (e) {
      ok(e.permanent === true, "reported as a permanent failure, not a silent success");
    } finally {
      axios.create = origCreate;
    }
  });

  section("attachServiceUrl: restarts the service after the domains PATCH, and waits for it to come back");
  await withEnvAsync({ ...LANE_ENV, APP_DOMAIN_BASE: "apps.murzaktech.tech" }, async () => {
    const statusQueue = ["running:healthy"]; // already running -> no /start call at all
    const restartStatusQueue = ["exited:unknown", "running:unknown", "running:healthy"];
    const spy = { restartCalled: false, patchBody: null };
    const client = {
      get: async (url) => {
        if (url === "/api/v1/services") return { data: { data: [{ name: coolify.resourceName(JOB), uuid: "EXISTING-3" }] } };
        if (url === "/api/v1/services/EXISTING-3/restart") { spy.restartCalled = true; return { data: {} }; }
        if (url === "/api/v1/services/EXISTING-3") {
          if (spy.restartCalled) {
            const status = restartStatusQueue.length > 1 ? restartStatusQueue.shift() : restartStatusQueue[0];
            return { data: { data: { status } } };
          }
          const status = statusQueue.length > 1 ? statusQueue.shift() : statusQueue[0];
          return { data: { data: { status } } };
        }
        throw new Error("unexpected GET " + url);
      },
      patch: async (url, body) => { spy.patchBody = body; return { data: {} }; },
    };
    const origCreate = axios.create;
    axios.create = () => client;
    try {
      const res = await coolify.provision(JOB, {});
      const appDomain = require("../services/provisioning/appDomain");
      const expectedFqdn = appDomain.fqdnFor(appDomain.slugWithSuffix(coolify.resourceName(JOB), JOB.name));
      ok(spy.patchBody && Array.isArray(spy.patchBody.urls), "PATCH carried the urls array (not the rejected top-level domains field)");
      ok(spy.restartCalled, "a restart was triggered after the domains PATCH — the missing step that left Traefik unrouted");
      ok(res.access?.url === expectedFqdn, "the fqdn is still returned once the restart settles back to running");
    } catch (e) {
      ok(false, `should not have thrown — ${e.message}`);
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
