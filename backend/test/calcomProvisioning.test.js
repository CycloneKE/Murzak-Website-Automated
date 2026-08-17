/**
 * Cal.com — the second consumer of the generalized multi-service secret
 * schema (buildSecretCtx), and the first curated app with no nginx/Redis.
 * Image confirmed via the Docker Hub v2 API directly (calcom/cal.diy has
 * zero published tags; the real image is still calcom/cal.com), and the
 * entrypoint (scripts/start.sh in calcom/cal.com) confirmed to run
 * `prisma migrate deploy` automatically on boot — no separate migration step.
 * node test/calcomProvisioning.test.js
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
  section("buildMultiServiceComposeYaml — starter-scheduling, two services, hardened, no nginx/redis");
  {
    const appConfig = coolify.__test_calcomConfig;
    const yaml = coolify.buildMultiServiceComposeYaml("acct1-starter-scheduling", { ramMb: 1024, cpus: 0.5, pidsLimit: 512 }, appConfig, "https://acct1-scheduling-ab12cd.murzaktech.com");

    ok(yaml.includes("postgres:16"), "postgres service uses postgres:16");
    ok(yaml.includes("calcom/cal.com:latest"), "app service uses the real published image (not the empty calcom/cal.diy repo)");
    ok(!yaml.includes("nginx"), "no nginx service — the app image serves HTTP directly");
    ok(!yaml.includes("redis"), "no redis service — optional upstream, omitted here");

    ok(yaml.includes("pg_isready -U calcom -d calcom"), "postgres healthcheck targets the calcom user/db");
    ok(yaml.includes('POSTGRES_USER: "calcom"') && yaml.includes('POSTGRES_DB: "calcom"'), "postgres env sets the calcom user/db");

    ok(/DATABASE_URL: "postgresql:\/\/calcom:.+@postgres:5432\/calcom"/.test(yaml), "app gets a DATABASE_URL pointing at the postgres service by compose name");
    ok(yaml.includes('DATABASE_HOST: "postgres:5432"'), "app gets DATABASE_HOST for start.sh's wait-for-it check");
    ok(yaml.includes('NEXT_PUBLIC_WEBAPP_URL: "https://acct1-scheduling-ab12cd.murzaktech.com"'), "app gets NEXT_PUBLIC_WEBAPP_URL set to the assigned fqdn");
    ok(yaml.includes('NEXTAUTH_URL: "https://acct1-scheduling-ab12cd.murzaktech.com"'), "app gets NEXTAUTH_URL set to the assigned fqdn");
    ok(yaml.includes('ALLOWED_HOSTNAMES: "\\"acct1-scheduling-ab12cd.murzaktech.com\\""'), "ALLOWED_HOSTNAMES carries embedded quotes (Cal.com JSON.parses `[${ALLOWED_HOSTNAMES}]`) and is the bare host, not the full https:// URL");
    ok(/NEXTAUTH_SECRET: ".+"/.test(yaml), "app gets a generated NEXTAUTH_SECRET");
    ok(/CALENDSO_ENCRYPTION_KEY: ".+"/.test(yaml), "app gets a generated CALENDSO_ENCRYPTION_KEY");
    ok(/CRON_API_KEY: ".+"/.test(yaml), "app gets a generated CRON_API_KEY");
    ok(!yaml.includes("base64:"), "no Laravel-format secret leaks into a Cal.com deploy (proves buildSecretCtx is per-app, not shared state)");

    ok(yaml.includes('expose:\n      - "3000"'), "only app exposes a port, on Cal.com's real port 3000");
    const postgresBlockEnd = yaml.indexOf("app:");
    ok(!yaml.slice(0, postgresBlockEnd).includes("expose:"), "postgres does not expose a port");

    const capDropCount = (yaml.match(/cap_drop:/g) || []).length;
    ok(capDropCount === 2, `both services get the hardening block (found ${capDropCount})`);

    ok(yaml.includes("depends_on") && yaml.includes("service_healthy"), "app waits for postgres's health check before starting");

    ok(!yaml.includes("acct1-starter-scheduling-app:"), "app declares no volume — it is stateless");
    ok(yaml.includes("acct1-starter-scheduling-pg-data:/var/lib/postgresql/data"), "postgres gets its data volume");
  }

  section("provision() — starter-scheduling end to end, via CURATED_APP_CONFIG");
  await withEnvAsync({ ...LANE_ENV, SMTP_HOST: "smtp.murzaktech.com", SMTP_PORT: "587", SMTP_USER: "notify@murzaktech.com", SMTP_PASS: "platform-secret", APP_DOMAIN_BASE: "apps.murzaktech.tech" }, async () => {
    const job = { name: "PRV-CAL-1", web_account: "acct-11", service_id: "starter-scheduling", ram_mb: 1024, disk_gb: 10 };
    let capturedBody = null;
    let patchedDomain = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-CAL-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-CAL-1" } } }; },
      patch: async (url, body) => { patchedDomain = body?.urls?.[0]?.url; ok(body?.urls?.[0]?.name === "app", "the urls[] entry targets the compose service actually named \"app\""); return { data: {} }; },
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("calcom/cal.com:latest"), "a real starter-scheduling purchase deploys the two-service stack");
      ok(/EMAIL_SERVER_HOST: "smtp\.murzaktech\.com"/.test(compose), "SMTP config comes from platform env, not a per-customer value");
      ok(!!patchedDomain, "a domain was attached to the app service");
      ok(res.access.url === patchedDomain, "access.url matches the attached domain");
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
