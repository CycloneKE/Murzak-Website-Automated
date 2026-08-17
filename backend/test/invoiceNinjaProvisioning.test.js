/**
 * Invoice Ninja — the first multi-service curated app (app + nginx + mysql +
 * redis), built on the schema generalization added to CURATED_APP_CONFIG.
 * Config values pulled from the project's own reference deployment
 * (invoiceninja/dockerfiles, debian/ subfolder), not guessed.
 * node test/invoiceNinjaProvisioning.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

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

const LANE_ENV = {
  COOLIFY_BASE_URL: "http://coolify.test",
  COOLIFY_TOKEN: "test-token",
  COOLIFY_PROJECT_UUID: "PROJ-1",
  COOLIFY_SERVER_UUID: "SRV-1",
};

function decodeComposeFromBody(body) {
  return Buffer.from(body.docker_compose_raw, "base64").toString("utf8");
}

(async () => {
  section("generateLaravelAppKey — Laravel's exact format, random, offline-computable");
  {
    const k1 = coolify.generateLaravelAppKey();
    const k2 = coolify.generateLaravelAppKey();
    ok(k1.startsWith("base64:"), "starts with the base64: prefix Laravel expects");
    ok(Buffer.from(k1.slice(7), "base64").length === 32, "decodes to exactly 32 raw bytes");
    ok(k1 !== k2, "two calls produce different keys");
  }

  section("buildMultiServiceComposeYaml — all four services, real Invoice Ninja config, hardened");
  {
    const appConfig = require("../services/provisioning/lanes/coolify").__test_invoiceNinjaConfig;
    const yaml = coolify.buildMultiServiceComposeYaml("acct1-starter-invoicing", { ramMb: 1280, cpus: 0.5, pidsLimit: 512 }, appConfig, "https://acct1-invoicing-ab12cd.murzaktech.com");

    ok(yaml.includes("mysql:8"), "mysql service uses mysql:8");
    ok(yaml.includes("redis:alpine"), "redis service uses redis:alpine");
    ok(yaml.includes("invoiceninja/invoiceninja-debian:latest"), "app service uses the debian image (the one with the real Dockerfile this was verified against)");
    ok(yaml.includes("nginx:alpine"), "nginx service uses nginx:alpine");

    ok(yaml.includes("fastcgi_pass app:9000"), "nginx config routes PHP to the app service's real internal port, not a guessed one");
    ok(yaml.includes("<< 'NGINXEOF'") || yaml.includes("<<'NGINXEOF'"), "heredoc delimiter is quoted, so nginx's $uri/$query_string are never shell-expanded");
    ok(yaml.includes("$uri") && yaml.includes("$query_string"), "real nginx variables survive into the compose (not escaped away by a JS template-literal bug)");
    ok(yaml.includes("\\.php$"), "the PHP location regex keeps its backslash (a template-literal escaping bug would silently drop it)");

    ok(/APP_KEY: "base64:.+"/.test(yaml), "app service gets a generated Laravel APP_KEY");
    ok(yaml.includes('APP_URL: "https://acct1-invoicing-ab12cd.murzaktech.com"'), "app service gets APP_URL set to the assigned fqdn");
    ok(yaml.includes('DB_HOST: "mysql"'), "app connects to the mysql service by its internal compose name");
    ok(yaml.includes('REDIS_HOST: "redis"'), "app connects to the redis service by its internal compose name");

    ok(yaml.includes("expose:") && yaml.includes('- "80"'), "only nginx exposes a port");
    const mysqlBlockEnd = yaml.indexOf("redis:");
    ok(!yaml.slice(0, mysqlBlockEnd).includes("expose:"), "mysql does not expose a port");

    const capDropCount = (yaml.match(/cap_drop:/g) || []).length;
    ok(capDropCount === 4, `all four services get the hardening block (found ${capDropCount})`);

    ok(yaml.includes("depends_on") && yaml.includes("service_healthy"), "app waits for mysql/redis health checks before starting");
  }

  section("provision() — starter-invoicing end to end, via CURATED_APP_CONFIG");
  await withEnvAsync({ ...LANE_ENV, SMTP_HOST: "smtp.murzaktech.com", SMTP_PORT: "587", SMTP_USER: "notify@murzaktech.com", SMTP_PASS: "platform-secret", APP_DOMAIN_BASE: "apps.murzaktech.tech" }, async () => {
    const job = { name: "PRV-INV-1", web_account: "acct-9", service_id: "starter-invoicing", ram_mb: 1280, disk_gb: 15 };
    let capturedBody = null;
    let patchedDomain = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-INV-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-INV-1" } } }; },
      patch: async (url, body) => { patchedDomain = body?.urls?.[0]?.url; ok(body?.urls?.[0]?.name === "nginx", "the urls[] entry targets the nginx-facing compose service, not \"app\""); return { data: {} }; },
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("invoiceninja/invoiceninja-debian"), "a real starter-invoicing purchase deploys the multi-service stack");
      ok(!!patchedDomain, "a domain was attached to the nginx-facing service");
      ok(res.access.url === patchedDomain, "access.url matches the attached domain");
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
