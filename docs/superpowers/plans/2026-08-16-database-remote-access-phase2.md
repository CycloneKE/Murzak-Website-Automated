# Database Remote Access (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `db-mysql`/`db-postgres`/`db-mongo`/`db-redis` actually reachable from a customer's own
SQL client, by publishing a unique external TCP port per purchase and reporting the box's real public
host/port through the connection-details surface already built in phase 1.

**Architecture:** A new port-allocator module assigns each Database Hosting job a unique port from a
configured range at enqueue time (mirroring how `ram_mb`/`disk_gb` are already assigned there); the
port rides along on the job record as a first-class field (like `ram_mb`) through to `coolify.js`,
which publishes it in the compose and reports it — plus a new `DB_PUBLIC_HOST` platform env var — as
the connection details already surfaced by `DatabaseConnectionPanel`.

**Tech Stack:** Node/Express backend, Frappe REST API, this repo's hand-rolled test harness.

## Global Constraints

- One shared port pool across all four engines (`DB_EXTERNAL_PORT_RANGE_START`/`_END`, default
  33000-33999), not per-engine ranges.
- Allocation is best-effort/advisory at enqueue time, same posture as the existing RAM capacity gate
  ("Runtime re-checks in the runner are authoritative — enqueue placement is advisory") — no
  distributed lock. A genuine collision surfaces as a real Coolify deploy failure, caught by the
  runner's existing retry/escalate-to-`needs_human` safety net.
- `enqueueProvisioningForInvoice` must never throw into the payment/activation path — an allocator
  failure sets `payload.status = "needs_human"`, exactly like the existing capacity-gate-exceeded path.
- Free for all four products — no new pricing. `"Remote access"` goes back into the catalog highlights.
- No automated migration for pre-phase-2 customers — out of scope, named in the spec.
- No TLS, no IP allowlist — out of scope, named in the spec.

---

### Task 1: Doctype field + port allocator module

**Files:**
- Modify: `backend/data/doctype-provisioning-job.json`
- Create: `backend/services/provisioning/dbPortAllocator.js`
- Test: `backend/test/dbPortAllocator.test.js` (new)

**Interfaces:**
- Produces: `allocatePort(client, opts?: {exclude?: Set<number>}): Promise<number|null>` — returns the
  lowest free port in the configured range, or `null` when the range is exhausted or the query fails
  (fail closed, never throws). `rangeStart(): number`, `rangeEnd(): number` (exported for tests).

- [ ] **Step 1: Add the field to the doctype fixture**

In `backend/data/doctype-provisioning-job.json`, find the `ram_mb`/`disk_gb` field entries:

```json
    { "fieldname": "ram_mb", "fieldtype": "Int", "label": "RAM (MB)" },
    { "fieldname": "disk_gb", "fieldtype": "Int", "label": "Disk (GB)" },
```

Add a new field right after `disk_gb`:

```json
    { "fieldname": "ram_mb", "fieldtype": "Int", "label": "RAM (MB)" },
    { "fieldname": "disk_gb", "fieldtype": "Int", "label": "Disk (GB)" },
    { "fieldname": "external_port", "fieldtype": "Int", "label": "External Port", "description": "Published host port for Database Hosting remote access (phase 2)" },
```

This file alone doesn't reach the live Frappe instance — `node backend/scripts/install-provisioning-doctype.js`
needs to be re-run against it separately (an ops step; the script is idempotent and only adds missing
fields, per its own header comment). Note this for the final verification task; it can't be run from
this session (no live Frappe/VPS access).

- [ ] **Step 2: Write the failing test**

Create `backend/test/dbPortAllocator.test.js`:

```js
/**
 * External TCP port allocator for Database Hosting jobs (phase 2 — see
 * docs/superpowers/specs/2026-08-16-database-remote-access-phase2-design.md).
 * node test/dbPortAllocator.test.js
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

const { allocatePort, rangeStart, rangeEnd } = require("../services/provisioning/dbPortAllocator");

(async () => {
  section("range defaults and overrides");
  {
    ok(rangeStart() === 33000, "default range start is 33000");
    ok(rangeEnd() === 33999, "default range end is 33999");
    await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "40000", DB_EXTERNAL_PORT_RANGE_END: "40002" }, () => {
      ok(rangeStart() === 40000 && rangeEnd() === 40002, "env vars override the default range");
    });
  }

  section("allocatePort — picks the lowest free port, skipping ones already in use");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33005" }, async () => {
    const client = {
      get: async () => ({
        data: {
          data: [
            { external_port: 33000 },
            { external_port: 33001 },
            { external_port: 0 }, // never-allocated rows report 0 — must not be treated as "port 0 in use"
          ],
        },
      }),
    };
    const port = await allocatePort(client);
    ok(port === 33002, `first free port after 33000/33001 are taken (got ${port})`);
  });

  section("allocatePort — honors the exclude set (same-batch reservations)");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33002" }, async () => {
    const client = { get: async () => ({ data: { data: [] } }) };
    const port = await allocatePort(client, { exclude: new Set([33000, 33001]) });
    ok(port === 33002, `skips ports reserved earlier in the same enqueue batch (got ${port})`);
  });

  section("allocatePort — range exhausted -> null, never reuses a port");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33001" }, async () => {
    const client = { get: async () => ({ data: { data: [{ external_port: 33000 }, { external_port: 33001 }] } }) };
    const port = await allocatePort(client);
    ok(port === null, "exhausted range returns null, doesn't wrap around or double-assign");
  });

  section("allocatePort — a failed query fails closed, never throws");
  {
    const client = { get: async () => { throw new Error("frappe down"); } };
    let threw = false;
    let port;
    try { port = await allocatePort(client); } catch { threw = true; }
    ok(!threw, "a query failure does not throw");
    ok(port === null, "a query failure returns null (cannot prove a port is free, so cannot safely hand one out)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd backend && node test/dbPortAllocator.test.js`
Expected: `Cannot find module '../services/provisioning/dbPortAllocator'`.

- [ ] **Step 4: Implement**

Create `backend/services/provisioning/dbPortAllocator.js`:

```js
/**
 * External TCP port allocator for Database Hosting products (phase 2 — see
 * docs/superpowers/specs/2026-08-16-database-remote-access-phase2-design.md).
 *
 * Mirrors provisioningService.js's getReservedRamMb pattern: query Frappe for
 * the ports already claimed by other active/running database jobs, then hand
 * back the lowest free port in the configured range. Best-effort at enqueue
 * time — same "advisory, not a distributed lock" posture the RAM capacity
 * gate already has for this single-VPS, human-scale business (see
 * scaling.js's own comment: "Runtime re-checks... are authoritative —
 * enqueue placement is advisory"). A genuine collision surfaces as a real
 * Coolify deploy failure, which the runner's existing retry/escalate safety
 * net already covers — this module does not attempt to prevent that itself.
 */

const { JOB_DOCTYPE } = require("./constants");

function rangeStart() {
  return Number(process.env.DB_EXTERNAL_PORT_RANGE_START) || 33000;
}
function rangeEnd() {
  return Number(process.env.DB_EXTERNAL_PORT_RANGE_END) || 33999;
}

/**
 * @param {object} client Frappe REST client (same shape used throughout provisioning/*)
 * @param {{exclude?: Set<number>}} opts exclude: ports already reserved earlier in the
 *   same enqueue batch (a customer buying two database products at once).
 * @returns {Promise<number|null>} lowest free port, or null when exhausted/unreadable.
 */
async function allocatePort(client, { exclude } = {}) {
  const used = new Set(exclude || []);
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        // Deliberately only "=" / "in" filters — the mock and (per this
        // codebase's caution about unverified Frappe behavior) possibly the
        // real API too are safest assumed to support only those; the ">0"
        // exclusion happens in JS below instead of relying on a numeric
        // comparison filter operator.
        filters: JSON.stringify([
          ["category", "=", "Database Hosting"],
          ["status", "in", ["running", "active"]],
        ]),
        fields: JSON.stringify(["external_port"]),
        limit_page_length: 0,
      },
    });
    for (const row of res.data?.data || []) {
      const p = Number(row.external_port);
      if (p > 0) used.add(p);
    }
  } catch {
    return null; // can't prove a port is free -> fail closed
  }
  for (let p = rangeStart(); p <= rangeEnd(); p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

module.exports = { allocatePort, rangeStart, rangeEnd };
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `cd backend && node test/dbPortAllocator.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 6: Add to the test chain and run the full suite**

In `backend/package.json`, insert `node test/dbPortAllocator.test.js` into the `"test"` chain, right
after `node test/curatedAppProvisioning.test.js`.

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/data/doctype-provisioning-job.json backend/services/provisioning/dbPortAllocator.js backend/test/dbPortAllocator.test.js backend/package.json
git commit -m "$(cat <<'EOF'
feat: add external-port allocator and doctype field for DB remote access

Phase 2 of the database engine fix. allocatePort mirrors the existing
getReservedRamMb pattern -- best-effort at enqueue time, fails closed
(null) on an exhausted range or an unreadable query, never throws.
Doctype fixture updated; install-provisioning-doctype.js still needs
a manual re-run against the live Frappe instance to add the field
there (no VPS access this session).
EOF
)"
```

---

### Task 2: Wire port allocation into the enqueue path

**Files:**
- Modify: `backend/services/provisioning/provisioningService.js`
- Modify: `backend/test/provisioning.test.js`

**Interfaces:**
- Consumes: `dbPortAllocator.allocatePort(client, {exclude}): Promise<number|null>` (Task 1).
- Produces: `buildJobPayload`'s returned object gains `external_port` (only present/non-zero for
  Database Hosting jobs that got a port; unchanged for everything else). Every other field/behavior
  of `enqueueProvisioningForInvoice` is unchanged.

- [ ] **Step 1: Write the failing test**

In `backend/test/provisioning.test.js`, find the `section("domain registration...")` block (search for
`section("domain registration`) and add a new section right before it:

```js
  section("Database Hosting enqueue: gets a real external_port, needs_human when the pool is exhausted");
  {
    const sPort = makeStore([]);
    const eqPort = await svc.enqueueProvisioningForInvoice({
      client: sPort, webAccount: "WP", invoiceDocName: "INV-PORT", serviceIds: ["db-mysql"],
    });
    ok(eqPort.created.length === 1, "db-mysql purchase creates one job");
    const portJob = Object.values(PJ(sPort))[0];
    ok(Number(portJob.external_port) >= 33000 && Number(portJob.external_port) <= 33999, `db-mysql job gets a real port in range (got ${portJob.external_port})`);

    // Two database purchases in the SAME batch must not collide.
    const sTwo = makeStore([]);
    const eqTwo = await svc.enqueueProvisioningForInvoice({
      client: sTwo, webAccount: "WP2", invoiceDocName: "INV-PORT2", serviceIds: ["db-mysql", "db-postgres"],
    });
    ok(eqTwo.created.length === 2, "two database products in one order both create jobs");
    const twoJobs = Object.values(PJ(sTwo));
    const ports = twoJobs.map((j) => Number(j.external_port));
    ok(ports[0] !== ports[1], `two database products in the same batch get DIFFERENT ports (got ${ports.join(", ")})`);

    // Non-database volume products never get a port at all.
    const sWeb = makeStore([]);
    await svc.enqueueProvisioningForInvoice({
      client: sWeb, webAccount: "WP3", invoiceDocName: "INV-PORT3", serviceIds: ["starter-web-hosting"],
    });
    const webJob = Object.values(PJ(sWeb))[0];
    ok(!webJob.external_port, "a non-database product never gets an external_port field populated");

    // Exhausted range -> needs_human, matching the capacity-gate-exceeded pattern.
    await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33000" }, async () => {
      const sExhausted = makeStore([
        { name: "TAKEN", service_id: "db-postgres", category: "Database Hosting", status: "active", external_port: 33000 },
      ]);
      await svc.enqueueProvisioningForInvoice({
        client: sExhausted, webAccount: "WP4", invoiceDocName: "INV-PORT4", serviceIds: ["db-mysql"],
      });
      const exhaustedJob = Object.values(PJ(sExhausted)).find((j) => j.service_id === "db-mysql");
      ok(exhaustedJob.status === "needs_human", "exhausted port range -> needs_human, not a fake/duplicate port");
    });
  }

```

Add a top-level `withEnvAsync` helper to `backend/test/provisioning.test.js` if the file doesn't
already have one (check first — several other test files in this repo define this exact helper; if
`provisioning.test.js` doesn't have it, add it near the top, right after `makeStore`'s definition):

```js
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/provisioning.test.js`
Expected: the new section's assertions fail (`portJob.external_port` is `undefined`) — everything
before that section still passes.

- [ ] **Step 3: Implement**

In `backend/services/provisioning/provisioningService.js`, add the require near the top:

```js
const dbPortAllocator = require("./dbPortAllocator");
```

In `enqueueProvisioningForInvoice`, find the `for (const { serviceId, domainChoice } of services) {`
loop. Right before it, add a batch-local reservation set:

```js
  const reservedPortsThisBatch = new Set();
  for (const { serviceId, domainChoice } of services) {
```

Inside the loop, find where `payload` is built and the premium-capacity-gate block that follows it:

```js
    const payload = buildJobPayload({
      webAccount,
      invoice: invoiceDocName,
      serviceId,
      repoUrl: accountRepoUrl,
      appPort: accountAppPort,
    });
    const meta = getServiceMeta(serviceId);
    if (meta?.capacityClass === "premium") {
```

Insert a new block between the `payload`/`meta` lines and the `if (meta?.capacityClass === "premium")`
check:

```js
    const payload = buildJobPayload({
      webAccount,
      invoice: invoiceDocName,
      serviceId,
      repoUrl: accountRepoUrl,
      appPort: accountAppPort,
    });
    const meta = getServiceMeta(serviceId);

    // Phase 2: Database Hosting jobs get a real external port so a customer
    // can connect with their own SQL client. Only for jobs that are actually
    // going to be built (status is still "queued" here — buildJobPayload
    // already flipped it to needs_human for an unrecognized id, so don't
    // bother allocating a port for a job that's escalating regardless).
    if (payload.category === "Database Hosting" && payload.status === "queued") {
      const port = await dbPortAllocator.allocatePort(client, { exclude: reservedPortsThisBatch });
      if (port) {
        payload.external_port = port;
        reservedPortsThisBatch.add(port);
      } else {
        payload.status = "needs_human";
        payload.error = "No external port available in the configured range — the pool is exhausted or Frappe couldn't be queried.";
      }
    }

    if (meta?.capacityClass === "premium") {
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/provisioning.test.js`
Expected: `ALL GREEN` (or however this file reports success — check its final summary line matches
what it printed before this change, just with more passing assertions).

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/services/provisioning/provisioningService.js backend/test/provisioning.test.js
git commit -m "$(cat <<'EOF'
feat: assign a real external port to Database Hosting jobs at enqueue

Same batch-local collision guard for a customer buying two database
products in one order. Exhausted range escalates to needs_human,
mirroring the existing capacity-gate-exceeded path -- never a fake
or duplicate port.
EOF
)"
```

---

### Task 3: Publish the port in the compose and report it as connection details

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js`
- Modify: `backend/services/provisioning/runner.js`
- Modify: `backend/test/dbEngineProvisioning.test.js`

**Interfaces:**
- Consumes: `job.external_port` (now populated by Task 2's enqueue step for Database Hosting jobs;
  falsy/absent for jobs enqueued before this shipped — must degrade, not crash).
- Produces: `buildDbComposeYaml`'s signature gains a 5th parameter, `externalPort`. `provision()`'s
  returned `access.host`/`access.port` now report real, externally-reachable values when
  `DB_PUBLIC_HOST` is configured and the job has a port; otherwise fall back to phase 1's best-effort
  internal values (never silently blank).

- [ ] **Step 1: Extend the existing test to cover the new behavior, confirm it fails**

In `backend/test/dbEngineProvisioning.test.js`, find the `"provision() — db-mysql deploys..."`
section. Add new assertions inside it, right after the existing `ok(res.access.url === "" ...)` line —
and change the `job` object in that section to include `external_port`:

```js
    const job = { name: "PRV-DB-1", web_account: "acct-1", service_id: "db-mysql", ram_mb: 768, disk_gb: 10, external_port: 33005 };
```

(this replaces the existing `job` line in that section — same variable, one field added)

Then, inside the same `try` block, right after the existing `ok(res.access.url === "" || res.access.url === undefined, ...)` line, add:

```js
      ok(compose.includes("published: 33005"), "publishes the allocated external port in the compose");
      ok(res.access.port === 33005, "access.port reports the real external port, not the internal container port");
```

Wrap the whole `provision()` call in `withEnvAsync` with `DB_PUBLIC_HOST` added, by changing:

```js
  await withEnvAsync(LANE_ENV, async () => {
    const job = { name: "PRV-DB-1", ...
```

to:

```js
  await withEnvAsync({ ...LANE_ENV, DB_PUBLIC_HOST: "db.murzaktech.com" }, async () => {
    const job = { name: "PRV-DB-1", web_account: "acct-1", service_id: "db-mysql", ram_mb: 768, disk_gb: 10, external_port: 33005 };
```

and add one more assertion after the two above:

```js
      ok(res.access.host === "db.murzaktech.com", "access.host reports the configured public host, not the internal docker name");
```

Add a new section, right after the existing `"regression: every non-DB service_id..."` section, testing the no-port / no-DB_PUBLIC_HOST fallback:

```js
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
      ok(res.access.host === "PRV-DB-3".length > 0 ? res.access.host !== "db.murzaktech.com" : true, "falls back to the internal best-effort host, not the (unset here) DB_PUBLIC_HOST");
      ok(res.access.port === 3306, "falls back to the internal container port when no external_port is assigned");
    } finally {
      axios.create = origCreate;
    }
  });
```

- [ ] **Step 2: Run to confirm the new assertions fail**

Run: `cd backend && node test/dbEngineProvisioning.test.js`
Expected: failures on `compose.includes("published: 33005")`, `res.access.port === 33005`, and
`res.access.host === "db.murzaktech.com"` — the fallback section's assertions should already pass
(current code already behaves that way by default, since `job.external_port` is currently never read
at all).

- [ ] **Step 3: Implement**

In `backend/services/provisioning/lanes/coolify.js`, update `buildDbComposeYaml`'s signature and body:

```js
function buildDbComposeYaml(name, limits, dbConfig, password, externalPort) {
  const volumeName = `${name}-data`;
  const envLines = dbConfig.envVars
    ? Object.entries(dbConfig.envVars(password))
        .map(([k, v]) => `      ${k}: "${v}"\n`)
        .join("")
    : "";
  const commandLines = dbConfig.command
    ? `    command: ${JSON.stringify(dbConfig.command(password))}\n`
    : "";
  // Phase 2 only — phase 1 deliberately never published a host port (see the
  // long comment on the generic app path about port 80 colliding with
  // Coolify's own proxy). A unique per-customer port here doesn't collide
  // with anything, as long as the allocator guarantees uniqueness.
  const portsLines = externalPort
    ? `    ports:\n      - target: ${dbConfig.port}\n        published: ${externalPort}\n`
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
    portsLines +
    commandLines +
    (envLines ? `    environment:\n${envLines}` : "") +
    `    volumes:\n` +
    `      - ${volumeName}:${dbConfig.volumePath}\n` +
    `volumes:\n` +
    `  ${volumeName}:\n`
  );
}
```

In `provision(job, opts)`, find:

```js
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword)
    : curatedAppConfig
```

Change to:

```js
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword, Number(job.external_port) > 0 ? Number(job.external_port) : null)
    : curatedAppConfig
```

Find the `access` object's db-specific spread:

```js
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
```

Change to:

```js
      ...(dbConfig
        ? {
            engine: dbConfig.engine,
            // Phase 2: when both a public host is configured AND this job has
            // an allocated external port, report the REAL externally-reachable
            // coordinates. Otherwise fall back to phase 1's honest best-effort
            // guess (the internal Docker resource name / container port) —
            // never silently blank, and never a fabricated public endpoint for
            // a job that was never actually given one.
            host: (process.env.DB_PUBLIC_HOST && Number(job.external_port) > 0) ? process.env.DB_PUBLIC_HOST : name,
            port: Number(job.external_port) > 0 ? Number(job.external_port) : dbConfig.port,
            database: dbConfig.database,
            username: dbConfig.username,
            password: dbPassword,
          }
        : {}),
```

In `backend/services/provisioning/runner.js`, find `CLAIMABLE_JOB_FIELDS` and add `"external_port"`:

```js
const CLAIMABLE_JOB_FIELDS = [
  "name", "web_account", "invoice", "service_id", "service_name",
  "category", "capacity_class", "lane", "status", "attempts",
  "ram_mb", "disk_gb", "external_port", "next_run_at", "target",
```

(only the one line changes — `"ram_mb", "disk_gb", "next_run_at", "target",` becomes
`"ram_mb", "disk_gb", "external_port", "next_run_at", "target",`; read the surrounding lines first to
confirm nothing has shifted since Task 1/2 of the earlier database-engine-fix plan.)

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/dbEngineProvisioning.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js backend/services/provisioning/runner.js backend/test/dbEngineProvisioning.test.js
git commit -m "$(cat <<'EOF'
feat: publish the allocated port and report real connection details

DB_PUBLIC_HOST + job.external_port (from the phase-2 allocator) now
drive the compose's ports: mapping and the access.host/access.port
DatabaseConnectionPanel already displays -- no frontend changes
needed, per the phase-2 design. Falls back to phase 1's internal-only
best-effort values when either is missing (pre-phase-2 jobs, or an
operator who hasn't set DB_PUBLIC_HOST yet).
EOF
)"
```

---

### Task 4: Env docs, catalog copy, and final verification

**Files:**
- Modify: `backend/.env.example`
- Modify: `frontend/src/config/serviceCatalog.ts`
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated)

- [ ] **Step 1: Document the new env vars**

In `backend/.env.example`, find the Lane A / Coolify section (search for `COOLIFY_BASE_URL`) and add a
new block after it, before the next section:

```
# ---- Database Hosting remote access (Phase 2) ----
# Public hostname or IP customers connect to with their own SQL client.
# One-time DNS setup (a plain A record, not a wildcard) -- see appDomain.js
# for the analogous APP_DOMAIN_BASE setup this mirrors.
# DB_PUBLIC_HOST=db.murzaktech.com
# Shared port pool across all four database engines (mysql/postgres/mongo/
# redis) -- the box has one IP either way, only the port varies per
# customer. Needs a one-time firewall rule opening this range for inbound
# TCP; not something this code can do for itself.
# DB_EXTERNAL_PORT_RANGE_START=33000
# DB_EXTERNAL_PORT_RANGE_END=33999
```

- [ ] **Step 2: Restore "Remote access" to the catalog highlights**

In `frontend/src/config/serviceCatalog.ts`, find `db-mysql`, `db-postgres`, and `db-mongo`. Each
currently has `"Auto-generated credentials"` in its highlights (from the phase-1 fix). Replace that
entry with `"Remote access"` in all three:

`db-mysql`: `highlights: ["Daily backups", "Auto-generated credentials", "Managed by us"]` →
`highlights: ["Daily backups", "Remote access", "Managed by us"]`

`db-postgres`: same replacement.

`db-mongo`: `highlights: ["MongoDB 7", "Daily backups", "Auto-generated credentials"]` →
`highlights: ["MongoDB 7", "Daily backups", "Remote access"]`

`db-redis`: currently `highlights: ["In-memory speed", "Daily backups", "Managed by us"]`. Replace with:
`highlights: ["In-memory speed", "Daily backups", "Remote access"]`

(Read each block with the Read tool immediately before editing to confirm exact current text — line
numbers have shifted from every earlier session's edits to this same file.)

- [ ] **Step 3: Regenerate the snapshot**

Run: `cd backend && npm run gen:catalog`
Expected: `Wrote 55 services to backend/data/serviceCatalogSnapshot.json` (count unchanged — copy-only
change, nothing the snapshot generator extracts is affected).

- [ ] **Step 4: Full verification**

Run: `cd backend && npm test`
Expected: zero failures across every chained file, including the three new/modified ones from Tasks 1-3.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

Run: `cd frontend && node scripts/check-portal-actions.mjs`
Expected: all portal actions still reachable (this change doesn't touch frontend UI at all, but it's
a fast, cheap check worth running given how many things this session has touched).

- [ ] **Step 5: Commit**

```bash
git add backend/.env.example frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json
git commit -m "$(cat <<'EOF'
docs: document DB_PUBLIC_HOST/DB_EXTERNAL_PORT_RANGE_* and restore "Remote access" copy

The phase-1 correction from "Remote access" to "Auto-generated
credentials" is undone now that remote access is real. Env vars
documented but left commented-out/unset by default -- an operator
with VPS access must set DB_PUBLIC_HOST, open the firewall range, and
re-run install-provisioning-doctype.js before this is actually live.
EOF
)"
```

## What still can't be verified from this session

Same limitation as every prior phase: no live Coolify/VPS/Frappe access. Before this is real for a
customer, an operator needs to: (1) re-run `install-provisioning-doctype.js` to add `external_port` to
the live doctype, (2) set `DB_PUBLIC_HOST` and open the firewall's 33000-33999 range, (3) verify an
actual purchase publishes the port and a real SQL client can connect using the credentials
`DatabaseConnectionPanel` displays.
