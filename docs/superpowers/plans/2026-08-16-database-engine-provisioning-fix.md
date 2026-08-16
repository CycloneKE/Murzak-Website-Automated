# Database Engine Provisioning Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `db-mysql`/`db-postgres`/`db-mongo`/`db-redis` — live, self-serve, already-sold products —
actually run the database engine they're sold as, instead of a blank `nginx:alpine` placeholder.

**Architecture:** A 4-entry lookup table in `coolify.js`, keyed by `service_id`, drives a data-driven
compose block (real image, real port, a persistent named volume, a freshly generated root
credential) instead of the current one-size-fits-all `nginx:alpine`-fallback template. A new
ownership-scoped route surfaces the generated connection details to the customer. See
`docs/superpowers/specs/2026-08-16-database-engine-provisioning-fix-design.md`.

**Tech Stack:** Node/Express backend, hand-rolled Coolify REST client (no SDK), React/TypeScript
frontend, this repo's hand-rolled test harness (`ok()`/`section()`, `node test/x.test.js`).

## Global Constraints

- Scope is deploying the correct database + credentials + persistent storage. External ("remote")
  TCP access is explicitly phase 2, not part of this plan — don't build port allocation or host-port
  publishing here.
- No new catalog-wide "curated app" schema — a small, purpose-built lookup table only.
- No kill switch — the runner's existing escalate-on-`needs_human`-on-throw safety net is the
  protection here, matching how every other lane's unverified-live surface is already handled.
- Every `service_id` NOT in the 4-entry table must be provably unaffected (regression-tested).
- Connection-details route follows the exact ownership pattern already established in
  `portalRoutes.js` (`requireAuth` + `loadOwnedJob` + category check), no resource-admin/plan gating.
- Tests use this repo's existing hand-rolled harness and the `axios.create` mocking pattern already
  established in `backend/test/coolifyIdempotency.test.js` — no Express harness, no new test library.

---

### Task 1: Data-driven DB compose builder + credential generation in coolify.js

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js`
- Test: `backend/test/dbEngineProvisioning.test.js` (new)

**Interfaces:**
- Produces (internal to coolify.js, not exported beyond what tests need): `DB_ENGINE_CONFIG` (object
  keyed by service_id), `generateDbPassword(): string`, `buildDbComposeYaml(name, limits, dbConfig,
  password): string`. `provision(job, opts)`'s existing exported behavior gains a new branch; its
  signature and return shape (`{externalRef, access, log}`) are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/dbEngineProvisioning.test.js`:

```js
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
    const p1 = coolify.generateDbPassword();
    const p2 = coolify.generateDbPassword();
    ok(typeof p1 === "string" && p1.length >= 24, "password is a real-length string");
    ok(p1 !== p2, "two calls produce different passwords");
    ok(/^[A-Za-z0-9_-]+$/.test(p1), "URL-safe charset — safe unquoted in YAML, safe as a shell arg, no quoting edge cases");
  }

  section("provision() — db-mysql deploys the real image, port, volume, credential (not nginx:alpine)");
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-DB-1", web_account: "acct-1", service_id: "db-mysql", ram_mb: 768, disk_gb: 10 };
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
      ok(res.access.port === 3306, "access reports the real port");
      ok(typeof res.access.password === "string" && res.access.password.length > 0, "access carries the generated password for the connection-details route to surface");
      ok(res.access.url === "" || res.access.url === undefined, "no HTTP domain attached — a database is not an HTTP app");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/dbEngineProvisioning.test.js`
Expected: `TypeError: coolify.generateDbPassword is not a function` (or similar) before any `ok(...)`
in the first section runs.

- [ ] **Step 3: Implement**

In `backend/services/provisioning/lanes/coolify.js`, add near the top (after the existing `resourceName`
function, before `provision`):

```js
const crypto = require("crypto");

/**
 * Per-engine deploy config for the four database catalog products. Deliberately
 * a small, purpose-built table here — NOT a generic catalog-wide "curated
 * app" schema. That generalization is real future work (the E-Signature/
 * ecosystem roadmap will need it) but building it now, under this bug fix,
 * would solve a bigger problem than the one in front of us.
 *
 * envVars/command are functions of the generated password so nothing here
 * ever hardcodes a shared secret.
 */
const DB_ENGINE_CONFIG = {
  "db-mysql": {
    engine: "mysql",
    image: "mysql:8",
    port: 3306,
    volumePath: "/var/lib/mysql",
    username: "root",
    database: "app",
    envVars: (password) => ({ MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: "app" }),
  },
  "db-postgres": {
    engine: "postgres",
    image: "postgres:16",
    port: 5432,
    volumePath: "/var/lib/postgresql/data",
    username: "postgres",
    database: "app",
    envVars: (password) => ({ POSTGRES_PASSWORD: password, POSTGRES_DB: "app" }),
  },
  "db-mongo": {
    engine: "mongo",
    image: "mongo:7",
    port: 27017,
    volumePath: "/data/db",
    username: "root",
    database: null,
    envVars: (password) => ({ MONGO_INITDB_ROOT_USERNAME: "root", MONGO_INITDB_ROOT_PASSWORD: password }),
  },
  "db-redis": {
    engine: "redis",
    image: "redis:7",
    port: 6379,
    volumePath: "/data",
    username: null,
    database: null,
    // The official redis image has no auth env var — --requirepass is the
    // only way to seed a password at startup.
    command: (password) => ["redis-server", "--requirepass", password],
  },
};

/** URL-safe (no YAML/shell quoting edge cases) — matches this codebase's existing crypto usage (s3Client.js). */
function generateDbPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Pure — kept side-effect-free so it's unit-tested directly, same reasoning
 * as resourceLimits() above. Same hardening (cap_drop ALL + CHOWN/SETUID/
 * SETGID + no-new-privileges) as the generic app path: every official DB
 * image's entrypoint does the same "chown data dir as root, then drop to its
 * own user" dance nginx:alpine's does, verified live for.
 */
function buildDbComposeYaml(name, limits, dbConfig, password) {
  const volumeName = `${name}-data`;
  const envLines = dbConfig.envVars
    ? Object.entries(dbConfig.envVars(password))
        .map(([k, v]) => `      ${k}: "${v}"\n`)
        .join("")
    : "";
  const commandLines = dbConfig.command
    ? `    command: ${JSON.stringify(dbConfig.command(password))}\n`
    : "";

  return (
    `services:\n` +
    `  app:\n` +
    `    image: ${dbConfig.image}\n` +
    `    restart: unless-stopped\n` +
    `    mem_limit: ${limits.ramMb}m\n` +
    `    cpus: ${limits.cpus}\n` +
    `    pids_limit: ${limits.pidsLimit}\n` +
    `    cap_drop:\n` +
    `      - ALL\n` +
    `    cap_add:\n` +
    `      - CHOWN\n` +
    `      - SETUID\n` +
    `      - SETGID\n` +
    `    security_opt:\n` +
    `      - no-new-privileges:true\n` +
    `    expose:\n` +
    `      - "${dbConfig.port}"\n` +
    commandLines +
    (envLines ? `    environment:\n${envLines}` : "") +
    `    volumes:\n` +
    `      - ${volumeName}:${dbConfig.volumePath}\n` +
    `volumes:\n` +
    `  ${volumeName}:\n`
  );
}
```

Then in `provision(job, opts)`, right after `const limits = resourceLimits(job);` (before the existing
`const composeYaml = ...` block), branch on the new table:

```js
  const limits = resourceLimits(job);
  const dbConfig = DB_ENGINE_CONFIG[job.service_id];
```

Replace the existing `const composeYaml = ...` assignment (the whole template-literal block) with:

```js
  const dbPassword = dbConfig ? generateDbPassword() : null;
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword)
    : `services:\n` +
      `  app:\n` +
      `    image: ${job.docker_image || "nginx:alpine"}\n` +
      `    restart: unless-stopped\n` +
      `    mem_limit: ${limits.ramMb}m\n` +
      `    cpus: ${limits.cpus}\n` +
      `    pids_limit: ${limits.pidsLimit}\n` +
      `    cap_drop:\n` +
      `      - ALL\n` +
      `    cap_add:\n` +
      `      - CHOWN\n` +
      `      - SETUID\n` +
      `      - SETGID\n` +
      `    security_opt:\n` +
      `      - no-new-privileges:true\n` +
      `    expose:\n` +
      `      - "80"\n`;
```

Then update the create-path return (the `return { externalRef: String(uuid), access: {...}, log: ... }`
block right after `ensureServiceRunning`/`attachServiceUrl`). Replace:

```js
  const status = await ensureServiceRunning(client, uuid);
  const url = await attachServiceUrl(client, uuid, job, name);

  return {
    externalRef: String(uuid),
    access: {
      lane: "coolify",
      target: opts?.target?.id || "box-1",
      resource: name,
      url,
      manageUrl: c.baseUrl.replace(/\/+$/, ""),
      uuid: String(uuid),
    },
    // NOTE: disk is intentionally absent — Coolify's /api/v1/services has no
    // disk-quota field (storage_opt 422s), so limits.diskGb is a billing/
    // catalog figure only, not an enforced container bound on this lane.
    log: `coolify: created service "${name}" (uuid=${uuid}, status=${status}) url=${url || "(pending)"} mem=${limits.ramMb}M cpus=${limits.cpus} pids=${limits.pidsLimit} caps=drop-all on ${opts?.target?.id || "box-1"}`,
  };
}
```

with:

```js
  const status = await ensureServiceRunning(client, uuid);
  // A database is not an HTTP app — attaching a domain would try to route SQL
  // traffic through Coolify's HTTP reverse proxy, which makes no sense. Real
  // external ("remote") access is phase 2 (see the design doc); skip entirely
  // for now.
  const url = dbConfig ? "" : await attachServiceUrl(client, uuid, job, name);

  return {
    externalRef: String(uuid),
    access: {
      lane: "coolify",
      target: opts?.target?.id || "box-1",
      resource: name,
      url,
      manageUrl: c.baseUrl.replace(/\/+$/, ""),
      uuid: String(uuid),
      ...(dbConfig
        ? {
            engine: dbConfig.engine,
            // Best-effort — Coolify's own internal Docker DNS name for this
            // resource, not independently verified reachable from another
            // customer's stack (that verification is part of phase 2's
            // external-access work, not this fix).
            host: name,
            port: dbConfig.port,
            database: dbConfig.database,
            username: dbConfig.username,
            password: dbPassword,
          }
        : {}),
    },
    // NOTE: disk is intentionally absent — Coolify's /api/v1/services has no
    // disk-quota field (storage_opt 422s), so limits.diskGb is a billing/
    // catalog figure only, not an enforced container bound on this lane.
    // NOTE: dbPassword is intentionally never interpolated into this log
    // string — it lives only in `access`, which the connection-details route
    // (not the build log) is the sole path back to the customer.
    log: `coolify: created service "${name}" (uuid=${uuid}, status=${status})${dbConfig ? ` engine=${dbConfig.engine}` : ` url=${url || "(pending)"}`} mem=${limits.ramMb}M cpus=${limits.cpus} pids=${limits.pidsLimit} caps=drop-all on ${opts?.target?.id || "box-1"}`,
  };
}
```

Finally, add `generateDbPassword` and `buildDbComposeYaml` to `module.exports` at the bottom of the
file (find the existing `module.exports = { ... provision, ... }` line and add both names to it).

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `cd backend && node test/dbEngineProvisioning.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Add to the root test script and run the full suite**

In `backend/package.json`, insert `node test/dbEngineProvisioning.test.js` into the `"test"` chain,
right after `node test/coolifyIdempotency.test.js`.

Run: `cd backend && npm test`
Expected: all green, including the existing `coolifyIdempotency.test.js` (the recovery/create-path
tests there use `starter-web-hosting`, which stays on the unchanged generic path).

- [ ] **Step 6: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js backend/test/dbEngineProvisioning.test.js backend/package.json
git commit -m "$(cat <<'EOF'
fix: deploy the real database engine for db-mysql/postgres/mongo/redis

These four live, self-serve catalog products were provisioning as a
blank nginx:alpine container — the generic coolify compose template
had no mechanism for a non-BYOA job to specify what image to deploy.
A small per-engine lookup table now drives the real image, port,
persistent volume, and a freshly generated root credential. External
("remote") TCP access is intentionally out of scope here (phase 2);
this fixes what's broken (the wrong container entirely), not what's
merely incomplete.
EOF
)"
```

---

### Task 2: Connection-details route

**Files:**
- Modify: `backend/routes/portalRoutes.js`
- Test: `backend/test/databaseConnectionRoutes.test.js` (new)

**Interfaces:**
- Consumes: `job.access` (JSON string) as written by Task 1's `provision()`; the existing
  `loadOwnedJob(client, webAccountName, serviceId)` helper.
- Produces: `GET /api/portal/services/:serviceId/database/connection` →
  `{ok, engine, host, port, database, username, password}` or, when a service was recovered rather
  than freshly created (so the original password is lost — see design doc), `{ok, engine, host, port,
  database, username, password: null, note}`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/databaseConnectionRoutes.test.js`:

```js
/**
 * Connection-details parsing for the database connection route — the pure
 * part (safely reading engine/host/port/database/username/password out of a
 * job's stored `access` JSON, including the "password unknown" recovery
 * case) split out so it's testable without an Express harness (this
 * codebase has none). node test/databaseConnectionRoutes.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { parseDbConnectionAccess } = require("../services/storage/dbConnection");

console.log("# parseDbConnectionAccess — normal case");
{
  const access = JSON.stringify({
    lane: "coolify", engine: "mysql", host: "acct1-db-mysql", port: 3306,
    database: "app", username: "root", password: "sekret123",
  });
  const r = parseDbConnectionAccess(access);
  ok(r.engine === "mysql" && r.port === 3306 && r.password === "sekret123", "full connection details round-trip");
}

console.log("# parseDbConnectionAccess — recovered service, password unknown");
{
  const access = JSON.stringify({ lane: "coolify", host: "acct1-db-mysql", uuid: "EXISTING-1" });
  const r = parseDbConnectionAccess(access);
  ok(r === null || r.password == null, "no engine/password on a recovered-without-db-fields access blob -> never fabricates a credential");
}

console.log("# parseDbConnectionAccess — malformed/missing access never throws");
{
  ok(parseDbConnectionAccess("") === null, "empty string -> null, not a throw");
  ok(parseDbConnectionAccess("not json") === null, "malformed JSON -> null, not a throw");
  ok(parseDbConnectionAccess(undefined) === null, "undefined -> null");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/databaseConnectionRoutes.test.js`
Expected: `Cannot find module '../services/storage/dbConnection'`.

- [ ] **Step 3: Implement the pure parser**

Create `backend/services/storage/dbConnection.js`:

```js
/**
 * Pure parsing of a Provisioning Job's stored `access` JSON into the shape
 * the connection-details route returns. Split out of the route so the "does
 * this access blob actually carry database credentials" logic is
 * independently testable — a job recovered after a crash (see
 * coolify.js provision()'s idempotency path) may have NO db fields at all,
 * and this must degrade honestly, never fabricate a credential.
 */
function parseDbConnectionAccess(accessJson) {
  if (!accessJson) return null;
  let access;
  try {
    access = JSON.parse(accessJson);
  } catch {
    return null;
  }
  if (!access || typeof access !== "object" || !access.engine) return null;
  return {
    engine: access.engine,
    host: access.host || null,
    port: access.port || null,
    database: access.database || null,
    username: access.username || null,
    password: access.password || null,
  };
}

module.exports = { parseDbConnectionAccess };
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/databaseConnectionRoutes.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Implement the route**

In `backend/routes/portalRoutes.js`, add a require near the other storage-lib requires (added in the
File Storage work):

```js
const dbConnectionLib = require('../services/storage/dbConnection');
```

Then add the route — placed right after the File Storage routes block (after the `DELETE
/api/portal/services/:serviceId/files` route, before `// --- DEVELOPER TERMINAL ACCESS`):

```js
// --- Database connection details ---
// No resource-admin gating, same reasoning as File Storage: a database's own
// credentials are the product itself, not an advanced-controls extra.
router.get("/api/portal/services/:serviceId/database/connection", requireAuth, async (req, res) => {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  if (!webAccountName) return res.status(401).json({ error: "No session account." });
  const { serviceId } = req.params;
  if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

  let job;
  try {
    job = await loadOwnedJob(frappeClient(), webAccountName, serviceId);
  } catch (err) {
    console.error("DATABASE CONNECTION LOOKUP ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to look up this service." });
  }
  // Deliberately indistinguishable from "not yours": same reasoning as every
  // other ownership-scoped route in this file.
  if (!job || job.category !== "Database Hosting") {
    return res.status(404).json({ error: "Connection details aren't available for this service." });
  }
  if (job.status !== "active") {
    return res.status(409).json({ error: "This service isn't live yet." });
  }

  const details = dbConnectionLib.parseDbConnectionAccess(job.access);
  if (!details) {
    // A service recovered after a crash (see coolify.js provision()'s
    // idempotency path) never had its password persisted — honest empty
    // state, never a fabricated credential.
    return res.json({
      ok: true,
      engine: null,
      note: "Connection details aren't available for this service yet — message support and we'll help you reset your credentials.",
    });
  }
  return res.json({ ok: true, ...details });
});
```

- [ ] **Step 6: Syntax-check and run the full suite**

Run: `cd backend && node -c routes/portalRoutes.js && echo OK`
Expected: `OK`.

In `backend/package.json`, insert `node test/databaseConnectionRoutes.test.js` into the `"test"`
chain, right after `node test/dbEngineProvisioning.test.js`.

Run: `cd backend && npm test`
Expected: all green, including `routesContext.test.js` (the new require follows the same
non-destructured-at-import-time style already used for `storageS3Lib`/`storageEligibilityLib`, so it
won't trip that test's greedy static guard).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/portalRoutes.js backend/services/storage/dbConnection.js backend/test/databaseConnectionRoutes.test.js backend/package.json
git commit -m "$(cat <<'EOF'
feat: add database connection-details route

Ownership-scoped (requireAuth + loadOwnedJob + category check), no
resource-admin gating — a database's own credentials are the product,
not an advanced-controls extra. Degrades honestly (never fabricates a
credential) when a service was recovered after a crash and its
original password was never persisted.
EOF
)"
```

---

### Task 3: Frontend connection-details panel

**Files:**
- Create: `frontend/src/services/databaseConnection.ts`
- Create: `frontend/src/components/portal/cloud/DatabaseConnectionPanel.tsx`
- Modify: `frontend/src/pages/portal/tabs/ResourceDetail.tsx`

**Interfaces:**
- Consumes: Task 2's route.
- Produces: `<DatabaseConnectionPanel serviceId={string} isActive={boolean} />`, rendered in
  `ResourceDetail`'s Settings pane when `svc?.category === "Database Hosting"`, ABOVE
  `ResourceAdminPanel`/`DeveloperTerminalPanel` (which still apply here — these are real containers
  with env vars/logs worth managing, unlike Storage's shared-bucket product).

- [ ] **Step 1: Create the service layer**

Create `frontend/src/services/databaseConnection.ts`:

```ts
/** Database connection-details API client. */

export interface DatabaseConnection {
  engine: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  password: string | null;
  note?: string;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Request failed.");
  return data as T;
}

export async function fetchDatabaseConnection(serviceId: string): Promise<DatabaseConnection> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/database/connection`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true } & DatabaseConnection>(res);
  return {
    engine: data.engine ?? null,
    host: data.host ?? null,
    port: data.port ?? null,
    database: data.database ?? null,
    username: data.username ?? null,
    password: data.password ?? null,
    note: data.note,
  };
}
```

- [ ] **Step 2: Create the component**

Create `frontend/src/components/portal/cloud/DatabaseConnectionPanel.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { Database, Eye, EyeOff, Copy, RefreshCw } from "lucide-react";
import { fetchDatabaseConnection, DatabaseConnection } from "../../../services/databaseConnection";

interface DatabaseConnectionPanelProps {
  serviceId: string;
  isActive: boolean;
}

function Row({ label, value, secret, revealed, onToggle }: {
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-murzak-border px-3 py-2">
      <span className="text-micro font-black uppercase text-slate-400 w-20 shrink-0">{label}</span>
      <code className="text-label font-bold text-slate-700 dark:text-slate-300 truncate flex-1">
        {secret && !revealed ? "•".repeat(Math.min(16, value.length) || 8) : value}
      </code>
      {secret && (
        <button
          type="button"
          onClick={onToggle}
          className="text-slate-400 hover:text-murzak-accent transition shrink-0"
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="text-slate-400 hover:text-murzak-accent transition shrink-0"
        aria-label={`Copy ${label}`}
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Connection details for a Database Hosting resource. Available to any
 * active purchase regardless of plan — a database's own credentials are the
 * product, not an advanced-controls extra (see ResourceAdminPanel's gating,
 * which this deliberately does NOT reuse).
 */
const DatabaseConnectionPanel: React.FC<DatabaseConnectionPanelProps> = ({ serviceId, isActive }) => {
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<DatabaseConnection | null>(null);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchDatabaseConnection(serviceId)
      .then(setConn)
      .catch((e: any) => setError(e?.message || "Couldn't load connection details."))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-murzak-accent" />
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Connection Details</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading && <p className="text-label font-medium text-slate-500">Loading…</p>}
      {error && <p className="text-label font-bold text-red-500">{error}</p>}

      {!loading && !error && conn && !conn.password && (
        <p className="text-label font-medium text-slate-500">
          {conn.note || "Connection details aren't available for this service yet."}
        </p>
      )}

      {!loading && !error && conn?.password && (
        <div className="space-y-1.5">
          <Row label="Engine" value={conn.engine || ""} />
          <Row label="Host" value={conn.host || ""} />
          <Row label="Port" value={String(conn.port ?? "")} />
          {conn.database && <Row label="Database" value={conn.database} />}
          {conn.username && <Row label="Username" value={conn.username} />}
          <Row label="Password" value={conn.password} secret revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
        </div>
      )}
    </div>
  );
};

export default DatabaseConnectionPanel;
```

- [ ] **Step 3: Wire it into ResourceDetail.tsx**

Add the import near the other component imports:

```tsx
import DatabaseConnectionPanel from "../../../components/portal/cloud/DatabaseConnectionPanel";
```

In the Settings pane's non-Storage branch (inside the `<>` that renders `ResourceAdminPanel`,
`DeveloperTerminalPanel`, and the domain form), add `DatabaseConnectionPanel` as the FIRST child,
before `ResourceAdminPanel`:

```tsx
              <>
                {svc?.category === "Database Hosting" && (
                  <DatabaseConnectionPanel serviceId={cloudServiceId} isActive={isActive} />
                )}

                <ResourceAdminPanel
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/databaseConnection.ts frontend/src/components/portal/cloud/DatabaseConnectionPanel.tsx frontend/src/pages/portal/tabs/ResourceDetail.tsx
git commit -m "$(cat <<'EOF'
feat: show real connection details for Database Hosting resources

DatabaseConnectionPanel renders above the existing env-var/logs panels
(which still apply to these — real containers, unlike File Storage's
shared bucket). Degrades to an honest empty state when a service was
recovered after a crash and its password was never persisted.
EOF
)"
```

---

### Task 4: Catalog copy correction

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts`
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated, not hand-edited)

- [ ] **Step 1: Correct the highlights for all four database products**

In `frontend/src/config/serviceCatalog.ts`, find each of `db-mysql`, `db-postgres`, `db-mongo`,
`db-redis`. Each currently has a `highlights` array containing `"Remote access"` (or, for db-mysql,
`"MySQL or Postgres"` — a separate pre-existing copy issue worth fixing in the same pass since it's
right next to what we're already touching: db-mysql's highlight is wrong regardless of this fix, it
literally offers both engines' names on the MySQL-specific product). Replace:

`db-mysql` (around line 406, `highlights: ["Daily backups", "Remote access", "Managed by us"]`) →
```ts
      highlights: ["Daily backups", "Auto-generated credentials", "Managed by us"],
```

`db-postgres` (around line 419, same array) →
```ts
      highlights: ["Daily backups", "Auto-generated credentials", "Managed by us"],
```

`db-mongo` (around line 431ish — locate via `id: "db-mongo"`, highlights containing `"MongoDB 7"`) →
replace its `"Remote access"` entry with `"Auto-generated credentials"`, keep `"MongoDB 7"` and
`"Daily backups"`.

`db-redis` — locate via `id: "db-redis"`; apply the same `"Remote access"` → `"Auto-generated
credentials"` replacement.

(Read each block with the Read tool immediately before editing to confirm exact current text — line
numbers may have shifted from earlier tasks' edits to this same file.)

- [ ] **Step 2: Regenerate the snapshot**

Run: `cd backend && npm run gen:catalog`
Expected: `Wrote N services to backend/data/serviceCatalogSnapshot.json` (N unchanged — this is a
copy-only change, no id/category/capacityClass/resources change, so nothing the snapshot generator
extracts is affected; regenerating is a no-op on the snapshot's actual content, done anyway to keep
the "always regenerate after touching the catalog" habit consistent).

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all green (highlights aren't part of what the snapshot extracts or any test asserts on).

- [ ] **Step 4: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json
git commit -m "$(cat <<'EOF'
fix: correct database product highlights to match what's actually delivered

"Remote access" promised external TCP connectivity this fix doesn't
build (that's phase 2 — see the design doc). Replaced with "Auto-
generated credentials", which is real as of this change. Also fixed
db-mysql's highlight literally advertising "MySQL or Postgres" on the
MySQL-specific product, a pre-existing copy bug next to what we were
already touching.
EOF
)"
```

---

### Task 5: Full-suite verification

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && npm test`
Expected: zero failures across every chained file, including the three new ones added in Tasks 1, 2.

- [ ] **Step 2: Run the frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm the regression guard directly**

Run: `node -e "const c = require('./backend/services/provisioning/lanes/coolify'); const yaml = c.buildDbComposeYaml('x', {ramMb:768,cpus:0.5,pidsLimit:512}, {image:'redis:7',port:6379,volumePath:'/data',command:(p)=>['redis-server','--requirepass',p]}, 'testpass'); console.log(yaml.includes('redis:7') && yaml.includes('--requirepass') ? 'OK' : 'FAIL')"`
Expected: `OK`.

No commit for this task — verification only, over work already committed in Tasks 1–4.
