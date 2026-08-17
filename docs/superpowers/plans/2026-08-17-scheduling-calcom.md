# Scheduling (Cal.com) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cal.com ("Scheduling") as the third curated app in the Coolify provisioning lane, purchasable as a Murzak add-on, alongside a refactor that generalizes multi-service secret generation so Cal.com's different secret shape doesn't get hardcoded into the same function as Invoice Ninja's.

**Architecture:** Two services (`postgres`, `app`) added to `CURATED_APP_CONFIG["starter-scheduling"]` using the existing multi-service schema. `buildMultiServiceComposeYaml` is refactored to build its secret `ctx` from a new `secrets` declaration on each app config (via a `buildSecretCtx` helper + `SECRET_GENERATORS` map) instead of three hardcoded `generateRandomSecret()`/`generateLaravelAppKey()` calls. `starter-invoicing` picks up the same declarative `secrets` field with zero output change. The frontend catalog gets a new `starter-scheduling` entry and a new `"Scheduling"` category; the backend catalog snapshot is regenerated from it.

**Tech Stack:** Node.js/Express backend, plain `node test/*.test.js` test runner (no framework), TypeScript frontend catalog (`serviceCatalog.ts`), Coolify REST API via `docker_compose_raw`.

## Global Constraints

- Image: `calcom/cal.com:latest` (verified via the Docker Hub v2 API — `calcom/cal.diy` has zero published tags; do not use it).
- Postgres user/db: `calcom` / `calcom` (mirrors Invoice Ninja's `ninja`/`ninja` convention).
- No Redis, no nginx — 2 services only.
- `:latest` tag, not pinned (matches DocuSeal/Invoice Ninja precedent).
- No automated first-admin bootstrap — customer completes Cal.com's own `/auth/signup`.
- RAM/disk/pricing: `{ ramMb: 1024, diskGb: 10 }`, `{ model: "addon", monthlyKes: 3200, setupKes: 0 }`.
- Every service in the compose gets the existing hardening block (`cap_drop: ALL` + `CHOWN`/`SETUID`/`SETGID` + `no-new-privileges`), applied automatically by the existing `hardeningBlock(limits)` helper — no new code needed for this.
- `starter-esign`'s and `starter-invoicing`'s generated compose output must be byte-for-byte unchanged after the refactor.

---

### Task 1: Generalize secret generation in `buildMultiServiceComposeYaml`

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js:855-859` (the `buildMultiServiceComposeYaml` function body) and `:726-788` (`CURATED_APP_CONFIG["starter-invoicing"]`)
- Test: `backend/test/invoiceNinjaProvisioning.test.js` (existing file — verify it still passes unmodified)

**Interfaces:**
- Consumes: existing `generateRandomSecret()` (coolify.js:574) and `generateLaravelAppKey()` (coolify.js:579) — both already defined and exported, unchanged.
- Produces: `buildSecretCtx(appConfig, fqdn)` — internal (not exported) helper. Returns `{ fqdn, ...generatedSecretsKeyedByDeclaredName }`. Every `environment`/`healthcheck` callback in `appConfig.services[*]` continues to receive this same `ctx` object as before (this task does not change that calling convention, only how `ctx`'s non-`fqdn` keys get populated).

- [ ] **Step 1: Read the current implementation to confirm the exact lines to change**

Read `backend/services/provisioning/lanes/coolify.js` lines 849-869. Confirm the current body starts:
```js
function buildMultiServiceComposeYaml(name, limits, appConfig, fqdn) {
  const dbPassword = generateRandomSecret();
  const dbRootPassword = generateRandomSecret();
  const appKey = generateLaravelAppKey();
  const ctx = { dbPassword, dbRootPassword, appKey, fqdn };
```

- [ ] **Step 2: Add the generator map and `buildSecretCtx` helper, just above `buildMultiServiceComposeYaml`**

Insert this immediately before the `function buildMultiServiceComposeYaml(...)` line (i.e. right after the closing `}` of `hardeningBlock`, around line 847):

```js
/**
 * Maps a declared secret "kind" (from an app config's `secrets` field) to the
 * generator that produces it. `laravelAppKey` exists only because Invoice
 * Ninja needs that exact format; every other curated app just needs a plain
 * random secret.
 */
const SECRET_GENERATORS = {
  random: generateRandomSecret,
  laravelAppKey: generateLaravelAppKey,
};

/**
 * Builds the per-provision secret ctx from an app config's declared `secrets`
 * map (e.g. `{ dbPassword: "random", appKey: "laravelAppKey" }`), instead of
 * hardcoding one app's specific secret set into buildMultiServiceComposeYaml.
 * A second real multi-service app with a different secret shape (Cal.com:
 * plain random secrets, no Laravel key at all) is what triggered this
 * generalization — see the design doc.
 */
function buildSecretCtx(appConfig, fqdn) {
  const ctx = { fqdn };
  for (const [key, kind] of Object.entries(appConfig.secrets || {})) {
    ctx[key] = SECRET_GENERATORS[kind]();
  }
  return ctx;
}
```

- [ ] **Step 3: Replace the hardcoded ctx construction in `buildMultiServiceComposeYaml`**

Change:
```js
function buildMultiServiceComposeYaml(name, limits, appConfig, fqdn) {
  const dbPassword = generateRandomSecret();
  const dbRootPassword = generateRandomSecret();
  const appKey = generateLaravelAppKey();
  const ctx = { dbPassword, dbRootPassword, appKey, fqdn };
```
to:
```js
function buildMultiServiceComposeYaml(name, limits, appConfig, fqdn) {
  const ctx = buildSecretCtx(appConfig, fqdn);
```

- [ ] **Step 4: Declare `starter-invoicing`'s secrets explicitly**

In `CURATED_APP_CONFIG["starter-invoicing"]` (around line 726), add a `secrets` field as the first property of the object, right after `primaryPort: 80,`:

```js
  "starter-invoicing": {
    primaryService: "nginx",
    primaryPort: 80,
    secrets: { dbPassword: "random", dbRootPassword: "random", appKey: "laravelAppKey" },
    services: {
```

- [ ] **Step 5: Run the existing Invoice Ninja test suite to confirm zero behavior change**

Run: `cd backend && node test/invoiceNinjaProvisioning.test.js`
Expected: `ALL GREEN`, same pass count as before this change (this test already asserts `APP_KEY: "base64:.+"`, `DB_HOST: "mysql"`, etc. — those assertions must still pass unmodified since the generator identities and ctx keys haven't changed, only where they're constructed).

- [ ] **Step 6: Run the DocuSeal (single-service) regression test to confirm it's unaffected**

Run: `cd backend && node test/curatedAppProvisioning.test.js`
Expected: `ALL GREEN` — this exercises `buildCuratedAppComposeYaml`'s single-service branch, which returns before ever reaching `buildMultiServiceComposeYaml`/`buildSecretCtx`, so it must be completely unaffected.

- [ ] **Step 7: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js
git commit -m "refactor: generalize multi-service secret generation

Extracts SECRET_GENERATORS + buildSecretCtx so each curated app
declares its own secrets shape instead of Invoice Ninja's being
hardcoded into buildMultiServiceComposeYaml. Prep for adding Cal.com,
which needs a different secret set (no Laravel key)."
```

---

### Task 2: Add `starter-scheduling` to `CURATED_APP_CONFIG`

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js` (add a new entry to `CURATED_APP_CONFIG`, after `"starter-invoicing"`, and export a test hook)
- Test: `backend/test/calcomProvisioning.test.js` (new file)

**Interfaces:**
- Consumes: `buildMultiServiceComposeYaml(name, limits, appConfig, fqdn)` (unchanged signature from Task 1), `hardeningBlock(limits)` (unchanged, internal), `buildSecretCtx` (from Task 1, internal — not called directly by this task, exercised through `buildMultiServiceComposeYaml`).
- Produces: `CURATED_APP_CONFIG["starter-scheduling"]`, exported as `module.exports.__test_calcomConfig` for the test file to reference (same pattern as `__test_invoiceNinjaConfig`).

- [ ] **Step 1: Add the `starter-scheduling` config entry**

In `backend/services/provisioning/lanes/coolify.js`, immediately after the closing `},` of `"starter-invoicing"` (around line 788, before the outer `};` that closes `CURATED_APP_CONFIG`), add:

```js
  "starter-scheduling": {
    primaryService: "app",
    primaryPort: 3000,
    secrets: {
      dbPassword: "random",
      nextAuthSecret: "random",
      encryptionKey: "random",
      cronApiKey: "random",
    },
    services: {
      postgres: {
        image: "postgres:16",
        volumeName: "pg-data",
        volumePath: "/var/lib/postgresql/data",
        environment: (ctx) => ({
          POSTGRES_USER: "calcom",
          POSTGRES_PASSWORD: ctx.dbPassword,
          POSTGRES_DB: "calcom",
        }),
        healthcheck: () =>
          `      test: ["CMD-SHELL", "pg_isready -U calcom -d calcom"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 20\n`,
      },
      app: {
        image: "calcom/cal.com:latest",
        // Cal.com is stateless — all state lives in postgres, so no
        // volumeName is declared here (the compose builder only emits a
        // volumes: block for a service when volumeName is present).
        environment: (ctx) => {
          const host = ctx.fqdn.replace(/^https?:\/\//, "");
          return {
            DATABASE_URL: `postgresql://calcom:${ctx.dbPassword}@postgres:5432/calcom`,
            DATABASE_DIRECT_URL: `postgresql://calcom:${ctx.dbPassword}@postgres:5432/calcom`,
            DATABASE_HOST: "postgres:5432",
            NEXT_PUBLIC_WEBAPP_URL: ctx.fqdn,
            NEXT_PUBLIC_WEBSITE_URL: ctx.fqdn,
            NEXT_PUBLIC_EMBED_LIB_URL: `${ctx.fqdn}/embed/embed.js`,
            ALLOWED_HOSTNAMES: host,
            NEXTAUTH_URL: ctx.fqdn,
            NEXTAUTH_SECRET: ctx.nextAuthSecret,
            CALENDSO_ENCRYPTION_KEY: ctx.encryptionKey,
            CRON_API_KEY: ctx.cronApiKey,
            EMAIL_FROM: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
            EMAIL_FROM_NAME: "Murzak Scheduling",
            EMAIL_SERVER_HOST: process.env.SMTP_HOST || "",
            EMAIL_SERVER_PORT: process.env.SMTP_PORT || "587",
            EMAIL_SERVER_USER: process.env.SMTP_USER || "",
            EMAIL_SERVER_PASSWORD: process.env.SMTP_PASS || "",
          };
        },
        dependsOn: { postgres: "service_healthy" },
      },
    },
  },
```

- [ ] **Step 2: Export a test hook for the new config**

In the `module.exports` block at the bottom of the file (around line 1353, right after `__test_invoiceNinjaConfig: CURATED_APP_CONFIG["starter-invoicing"],`), add:

```js
  __test_calcomConfig: CURATED_APP_CONFIG["starter-scheduling"],
```

- [ ] **Step 3: Write the compose-generation test file**

Create `backend/test/calcomProvisioning.test.js`:

```js
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
    ok(yaml.includes('ALLOWED_HOSTNAMES: "acct1-scheduling-ab12cd.murzaktech.com"'), "ALLOWED_HOSTNAMES is the bare host, not the full https:// URL");
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
      patch: async (url, body) => { patchedDomain = body?.domains; return { data: {} }; },
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
```

- [ ] **Step 4: Run the new test file and verify it fails first (config not yet added) — SKIP if Step 1 already applied**

If you're following TDD strictly: run `cd backend && node test/calcomProvisioning.test.js` BEFORE Step 1 above — expect a crash (`CURATED_APP_CONFIG["starter-scheduling"]` undefined → `TypeError` reading `.services` on `buildMultiServiceComposeYaml`). Since Step 1 and Step 3 are both in this task, apply Step 1 first, then run the test to confirm PASS rather than chasing an artificial red step.

- [ ] **Step 5: Run the new test file and verify it passes**

Run: `cd backend && node test/calcomProvisioning.test.js`
Expected: `ALL GREEN`, all `ok:` lines, 0 `FAIL:` lines.

- [ ] **Step 6: Add the new test file to the root test script**

In `backend/package.json`, the `"test"` script is one long `&&`-chained command. Add `&& node test/calcomProvisioning.test.js` immediately after `&& node test/invoiceNinjaProvisioning.test.js` (keep it next to the other curated-app tests).

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: every test file in the chain prints `ALL GREEN` and the process exits 0. This also re-confirms `curatedAppProvisioning.test.js` and `invoiceNinjaProvisioning.test.js` still pass with `starter-scheduling` present in `CURATED_APP_CONFIG`.

- [ ] **Step 8: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js backend/test/calcomProvisioning.test.js backend/package.json
git commit -m "feat: add starter-scheduling (Cal.com) curated app

Two-service compose (postgres + app), no nginx/redis. Image confirmed
as calcom/cal.com:latest via the Docker Hub v2 API (calcom/cal.diy has
zero published tags despite being the name in Cal.com's own docs)."
```

---

### Task 3: Add the `starter-scheduling` catalog entry and regenerate the backend snapshot

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts` (add `"Scheduling"` to `ServiceCategory`, add the `starter-scheduling` catalog entry)
- Modify (generated): `backend/data/serviceCatalogSnapshot.json` (regenerated, not hand-edited)
- Test: `backend/test/catalogSnapshot.test.js` (existing file — verify it still passes)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (this task is independent of the provisioning-lane code — it only has to land before a real purchase can reach `provision()` with `service_id: "starter-scheduling"`).
- Produces: `starter-scheduling` resolvable via `getServiceMeta("starter-scheduling")` (the function `catalogSnapshot.test.js` and `orderStore.js` both read from), with `category: "Scheduling"`, `resources: { ramMb: 1024, diskGb: 10 }`, `pricing: { model: "addon", monthlyKes: 3200, setupKes: 0 }`.

- [ ] **Step 1: Add the `"Scheduling"` category**

In `frontend/src/config/serviceCatalog.ts`, in the `ServiceCategory` union type (currently lines 4-22), add `| "Scheduling"` on its own line — same style as the existing `| "E-Signature"` / `| "Invoicing"` entries, placed right after `| "Invoicing"`.

- [ ] **Step 2: Add the `starter-scheduling` catalog entry**

In the same file, find the `starter-invoicing` entry (currently around line 464-476, ending with its `sortOrder` line and closing `},`). Add a new entry immediately after it:

```ts
    {
      id: "starter-scheduling",
      name: "Scheduling",
      description: "Booking pages, calendar sync, and meeting scheduling — your own scheduling tool.",
      category: "Scheduling",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1GB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1024, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 3200, setupKes: 0 },
      highlights: ["Unlimited booking pages", "Calendar sync", "Your own domain"],
      sortOrder: 58,
    },
```

Confirmed against the real file: `starter-esign` is `sortOrder: 56`, `starter-invoicing` is `sortOrder: 57` — so `starter-scheduling` is `58`, continuing the sequence.

- [ ] **Step 3: Regenerate the backend catalog snapshot**

Run: `cd backend && npm run gen:catalog`
Expected: prints a success message and rewrites `backend/data/serviceCatalogSnapshot.json`. Open that file and confirm it now contains a `"starter-scheduling"` entry (or array element, matching whatever shape `starter-invoicing` has in the same file) with `"category": "Scheduling"`, `"ramMb": 1024`, `"diskGb": 10`, `"monthlyKes": 3200`.

- [ ] **Step 4: Run the catalog snapshot test**

Run: `cd backend && node test/catalogSnapshot.test.js`
Expected: `ALL GREEN`. If it warns about `SERVICE_ID_TO_PLAN` missing `starter-scheduling`, check whether `starter-invoicing`/`starter-esign` are listed in `SERVICE_ID_TO_PLAN` (grep for it in `backend/`) — if they are, add `starter-scheduling` alongside them for consistency; if neither DocuSeal nor Invoice Ninja needed that mapping, leave it out here too (don't add a mapping the other two curated apps don't have).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all green, 0 failures, process exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json
git commit -m "feat: add Scheduling (Cal.com) as a purchasable catalog product

KES 3,200/mo, 1024MB/10GB, addon pricing model. Regenerated
backend/data/serviceCatalogSnapshot.json from the frontend catalog
(the single source of truth billing/provisioning both read from)."
```

---

### Task 4: Manual end-to-end sanity check against the real Coolify box (optional but recommended before considering this done)

**Files:** none — this is a manual verification task, no code changes.

**Interfaces:** none.

- [ ] **Step 1: Confirm this task is safe to run**

This deploys a REAL container to the shared production Coolify box. Only do this if you have a disposable test `web_account`/job you can tear down afterward, and confirm with the user first — this is exactly the kind of side-effectful, hard-to-fully-reverse action that needs a go-ahead, not silent execution.

- [ ] **Step 2: Trigger a real `starter-scheduling` provision**

Using whatever mechanism the existing DocuSeal/Invoice Ninja launches used (check `docs/superpowers/plans/2026-08-16-esignature-docuseal.md` and `docs/superpowers/plans/2026-08-17-invoice-ninja-multiservice.md` for how those were smoke-tested against the live box, since this plan doesn't have visibility into that manual step) — provision a `starter-scheduling` job against the real Coolify instance.

- [ ] **Step 3: Verify the deployed app**

Visit the assigned URL. Confirm: the Postgres migration completed (no 500 error), the Cal.com `/auth/signup` page loads, and a first account can be created. Check container logs in Coolify for the `EMAIL_SERVER_*` values resolving (no crash from a missing required env var).

- [ ] **Step 4: Tear down the test resource**

Remove the test service via the same path used to confirm DocuSeal/Invoice Ninja teardown, so this doesn't linger as an orphaned container on the shared box (see the orphan-reconciliation sweep in memory — don't manufacture a new duplicate for it to have to catch).
