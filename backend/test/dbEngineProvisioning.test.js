/**
 * Database engine provisioning — the per-engine compose block a db-mysql/
 * db-postgres/db-mongo/db-redis purchase now actually deploys, instead of
 * the nginx:alpine placeholder every "volume" coolify job got before.
 * node test/dbEngineProvisioning.test.js
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
  const raw = Buffer.from(body.docker_compose_raw, "base64").toString("utf8");
  return raw;
}

(async () => {
  section("generateDbPassword — random, URL-safe, long enough to be a real credential");
  {
    const p1 = coolify.generateRandomSecret();
    const p2 = coolify.generateRandomSecret();
    ok(typeof p1 === "string" && p1.length >= 24, "password is a real-length string");
    ok(p1 !== p2, "two calls produce different passwords");
    ok(/^[A-Za-z0-9_-]+$/.test(p1), "URL-safe charset — safe unquoted in YAML, safe as a shell arg, no quoting edge cases");
  }

  section("provision() — db-mysql deploys the real image, port, volume, credential (not nginx:alpine)");
  await withEnvAsync({ ...LANE_ENV, DB_PUBLIC_HOST: "db.murzaktech.com" }, async () => {
    const job = { name: "PRV-DB-1", web_account: "acct-1", service_id: "db-mysql", ram_mb: 768, disk_gb: 10, external_port: 33005 };
    let capturedBody = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-DB-1") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-DB-1" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("image: mysql:8"), "deploys mysql:8, not nginx:alpine");
      ok(compose.includes('expose:\n      - "3306"'), "exposes MySQL's real port internally");
      ok(compose.includes("/var/lib/mysql"), "mounts a volume at MySQL's real data directory");
      ok(/MYSQL_ROOT_PASSWORD: ".+"/.test(compose), "seeds a root password env var");
      ok(!compose.includes("nginx:alpine"), "the nginx:alpine fallback is never reached for a known db engine");
      ok(res.access.engine === "mysql", "access reports the engine");
      ok(typeof res.access.password === "string" && res.access.password.length > 0, "access carries the generated password for the connection-details route to surface");
      ok(res.access.url === "" || res.access.url === undefined, "no HTTP domain attached — a database is not an HTTP app");
      ok(compose.includes("published: 33005"), "publishes the allocated external port in the compose");
      ok(res.access.port === 33005, "access.port reports the real external port, not the internal container port");
      ok(res.access.host === "db.murzaktech.com", "access.host reports the configured public host, not the internal docker name");
    } finally {
      axios.create = origCreate;
    }
  });

  section("provision() — db-redis uses --requirepass (no env var in the official image)");
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-DB-2", web_account: "acct-2", service_id: "db-redis", ram_mb: 768, disk_gb: 5 };
    let capturedBody = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-DB-2") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-DB-2" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("image: redis:7"), "deploys redis:7");
      ok(compose.includes("--requirepass"), "uses the command-line flag, not a nonexistent env var");
      ok(res.access.username === null, "redis has no username concept — reported as null, not fabricated");
    } finally {
      axios.create = origCreate;
    }
  });

  section("regression: every non-DB service_id is byte-for-byte unaffected");
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-WEB-1", web_account: "acct-3", service_id: "starter-web-hosting", ram_mb: 512, disk_gb: 5 };
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
      const compose = decodeComposeFromBody(capturedBody);
      ok(compose.includes("image: nginx:alpine"), "a non-DB volume service still gets the generic nginx:alpine fallback, unchanged");
      ok(compose.includes('expose:\n      - "80"'), "still exposes port 80, unchanged");
      ok(!compose.includes("volumes:"), "still no volume section for the generic path, unchanged");
    } finally {
      axios.create = origCreate;
    }
  });

  section("provision() — db-mysql with no external_port or DB_PUBLIC_HOST falls back to phase-1 behavior");
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-DB-3", web_account: "acct-4", service_id: "db-mysql", ram_mb: 768, disk_gb: 10 }; // no external_port — a pre-phase-2 job
    let capturedBody = null;
    const origCreate = axios.create;
    axios.create = () => ({
      get: async (url) => {
        if (url === "/api/v1/services") return { data: [] };
        if (url === "/api/v1/services/NEW-DB-3") return { data: { data: { status: "running:healthy" } } };
        throw new Error("unexpected GET " + url);
      },
      post: async (url, body) => { capturedBody = body; return { data: { data: { uuid: "NEW-DB-3" } } }; },
      patch: async () => ({ data: {} }),
    });
    try {
      const res = await coolify.provision(job, {});
      const compose = decodeComposeFromBody(capturedBody);
      ok(!compose.includes("ports:"), "no external_port on the job -> no ports: mapping published, never guesses one");
      ok(res.access.host !== "db.murzaktech.com", "falls back to the internal best-effort host, not a leftover DB_PUBLIC_HOST from another test");
      ok(res.access.port === 3306, "falls back to the internal container port when no external_port is assigned");
    } finally {
      axios.create = origCreate;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
