/**
 * No silent nginx:alpine build for a service with no real delivery mechanism.
 *   node test/noSilentNginxFallback.test.js
 *
 * Nine live catalog ids reach coolify.js's provision() with no
 * DB_ENGINE_CONFIG or CURATED_APP_CONFIG entry and no repo_url (not BYOA):
 * starter-db-light, starter-db-mongo, addon-waf, addon-backup-plus,
 * addon-staging, addon-malware, addon-cdn, addon-ssl-premium,
 * addon-dedicated-ip. Before this, every one of them silently built a bare
 * nginx:alpine container and billed the customer as if the product — a
 * database, a firewall, malware scanning, a CDN, an SSL cert, a dedicated
 * IP — actually existed. Two of the nine (addon-waf, addon-malware) are
 * SECURITY claims: billing for protection that isn't there is the most
 * serious item in this fix.
 *
 * "Website Hosting" and "App Hosting" are the one legitimate case for the
 * generic fallback — nginx (or the customer's own image via BYOA, handled
 * earlier by the repo_url branch) is a real product there. Everything else
 * with no curated delivery must escalate to needs_human, never build silently.
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

const coolify = require("../services/provisioning/lanes/coolify");
const axios = require("axios");

const UNDELIVERABLE_IDS = [
  "starter-db-light", "starter-db-mongo",
  "addon-waf", "addon-backup-plus", "addon-staging",
  "addon-malware", "addon-cdn", "addon-ssl-premium", "addon-dedicated-ip",
];

(async () => {
  for (const serviceId of UNDELIVERABLE_IDS) {
    section(`provision() — ${serviceId} escalates instead of building nginx`);
    await withEnvAsync(LANE_ENV, async () => {
      const job = { name: `PRV-${serviceId}`, web_account: "acct-1", service_id: serviceId, ram_mb: 512, disk_gb: 10, category: catFor(serviceId) };
      let created = false;
      const origCreate = axios.create;
      axios.create = () => ({
        get: async (url) => {
          if (url === "/api/v1/services") return { data: [] };
          throw new Error("unexpected GET " + url);
        },
        post: async () => { created = true; return { data: { data: { uuid: "SHOULD-NOT-EXIST" } } }; },
        patch: async () => ({ data: {} }),
      });
      try {
        let thrown = null;
        try { await coolify.provision(job, {}); }
        catch (e) { thrown = e; }
        ok(thrown !== null, `${serviceId} throws instead of returning success`);
        ok(thrown?.permanent === true, `${serviceId} error is marked permanent (goes to needs_human on first attempt, no retry burn)`);
        ok(!created, `${serviceId} never calls Coolify to create a container`);
      } finally {
        axios.create = origCreate;
      }
    });
  }

  section("provision() — Website Hosting still legitimately uses the nginx fallback");
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-web-1", web_account: "acct-1", service_id: "starter-web-hosting", ram_mb: 768, disk_gb: 10, category: "Website Hosting" };
    let capturedBody = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-WEB-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-WEB-1" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      await coolify.provision(job, {});
      ok(capturedBody !== null, "Website Hosting still builds successfully (unaffected by this fix)");
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();

function catFor(id) {
  const map = {
    "starter-db-light": "Database Hosting", "starter-db-mongo": "Database Hosting",
    "addon-waf": "Security & Backup", "addon-backup-plus": "Security & Backup",
    "addon-staging": "Performance", "addon-malware": "Security & Backup",
    "addon-cdn": "Performance", "addon-ssl-premium": "Domains & SSL",
    "addon-dedicated-ip": "Domains & SSL",
  };
  return map[id];
}
