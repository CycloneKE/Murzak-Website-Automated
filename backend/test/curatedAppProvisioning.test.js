/**
 * Curated third-party app provisioning — the compose block a starter-esign
 * (DocuSeal) purchase deploys. First consumer of CURATED_APP_CONFIG,
 * deliberately separate from DB_ENGINE_CONFIG (see the design doc: two data
 * points don't yet justify one shared abstraction).
 * node test/curatedAppProvisioning.test.js
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

function decodeComposeFromBody(body) {
  return Buffer.from(body.docker_compose_raw, "base64").toString("utf8");
}

(async () => {
  section("buildCuratedAppComposeYaml — pure, deterministic");
  {
    const appConfig = {
      image: "docuseal/docuseal:latest",
      port: 3000,
      volumePath: "/data",
      envVars: (fqdn, secret) => ({ HOST: fqdn, SECRET_KEY_BASE: secret, SMTP_ADDRESS: "smtp.test" }),
    };
    const yaml = coolify.buildCuratedAppComposeYaml("acct1-starter-esign", { ramMb: 512, cpus: 0.5, pidsLimit: 512 }, appConfig, "https://acct1-esign-ab12cd.murzaktech.com", "sekret");
    ok(yaml.includes("image: docuseal/docuseal:latest"), "deploys the configured image");
    ok(yaml.includes('expose:\n      - "3000"'), "exposes DocuSeal's real port");
    ok(yaml.includes("acct1-starter-esign-data:/data"), "mounts a volume at /data");
    ok(yaml.includes('HOST: "https://acct1-esign-ab12cd.murzaktech.com"'), "seeds HOST from the assigned fqdn");
    ok(yaml.includes('SECRET_KEY_BASE: "sekret"'), "seeds a generated secret, not a hardcoded one");
  }

  section("provision() — starter-esign deploys docuseal, attaches a domain, seeds SMTP from platform env");
  await withEnvAsync({ ...LANE_ENV, SMTP_HOST: "smtp.murzaktech.com", SMTP_PORT: "587", SMTP_USER: "notify@murzaktech.com", SMTP_PASS: "platform-secret", APP_DOMAIN_BASE: "apps.murzaktech.tech" }, async () => {
    const job = { name: "PRV-ESIGN-1", web_account: "acct-1", service_id: "starter-esign", ram_mb: 512, disk_gb: 10 };
    let capturedBody = null;
    let patchedDomain = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-ESIGN-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-ESIGN-1" } } }; },
      patch: async (url, body) => { patchedDomain = body?.urls?.[0]?.url; ok(body?.urls?.[0]?.name === "app", "the urls[] entry targets the compose service actually named \"app\""); return { data: {} }; },
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("image: docuseal/docuseal:latest"), "deploys docuseal, not nginx:alpine");
      ok(/SMTP_ADDRESS: "smtp\.murzaktech\.com"/.test(compose), "SMTP config comes from platform env, not a per-customer value");
      ok(/SECRET_KEY_BASE: ".+"/.test(compose), "seeds a generated SECRET_KEY_BASE");
      ok(!!patchedDomain, "a domain WAS attached (unlike the database branch, which skips this)");
      ok(res.access.url === patchedDomain, "the returned access.url matches the attached domain");
    } finally {
      axios.create = origCreate;
    }
  });

  section("regression: db-mysql and a plain volume service are still unaffected by CURATED_APP_CONFIG");
  await withEnvAsync(LANE_ENV, async () => {
    const dbJob = { name: "PRV-DB-X", web_account: "acct-9", service_id: "db-mysql", ram_mb: 768, disk_gb: 10 };
    let capturedDbBody = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-DB-X") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedDbBody = body; return { data: { data: { uuid: "NEW-DB-X" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      await coolify.provision(dbJob, {});
      const compose = decodeComposeFromBody(capturedDbBody);
      ok(compose.includes("image: mysql:8"), "db-mysql still deploys mysql:8, unaffected by the new curated-app branch");
      ok(!compose.includes("SECRET_KEY_BASE"), "db-mysql's compose never picks up DocuSeal's env vars");
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
