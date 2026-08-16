# E-Signature (DocuSeal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real, purchasable "E-Signature" catalog product backed by DocuSeal, as the first
curated third-party HTTP app deployed through the existing `coolify` lane.

**Architecture:** A new `CURATED_APP_CONFIG` table in `coolify.js`, parallel to (but deliberately
separate from) the `DB_ENGINE_CONFIG` table added by the database engine fix — this one needs domain
attachment (a real HTTP app) and reuses Murzak's own platform SMTP relay for signature-invite email.
No new provisioning lane, no new frontend component — `starter-esign` routes through the exact same
`coolify` lane and generic `ResourceDetail` page every Website Hosting/BYOA purchase already uses.

**Tech Stack:** Node/Express backend, hand-rolled Coolify REST client, React/TypeScript frontend
(catalog-only change, no new components), this repo's hand-rolled test harness.

## Global Constraints

- DocuSeal only — SQLite by default, single-service compose, no bundled Postgres (confirmed via
  Docker Hub: image `docuseal/docuseal:latest`, port 3000, volume at `/data`).
- `CURATED_APP_CONFIG` stays a separate table from `DB_ENGINE_CONFIG` — do not merge them. Merge is
  deferred to when a third curated app exists.
- SMTP env vars for DocuSeal come from Murzak's own platform `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`
  (already in `.env.example`), not a new per-customer credential.
- `generateDbPassword` is renamed `generateRandomSecret` (it was already generic; this task gives it
  a second caller). Every existing call site and test updates to the new name — no behavior change.
- Catalog: id `starter-esign`, category `"E-Signature"` (new), tier Light, `capacityClass: "volume"`,
  `resources: { ramMb: 512, diskGb: 10 }`, `pricing: { model: "addon", monthlyKes: 1800, setupKes: 0 }`.
- No new frontend component — the generic `ResourceDetail` page already covers this product.

---

### Task 1: Curated-app compose support in coolify.js

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js`
- Modify: `backend/test/dbEngineProvisioning.test.js` (rename fix-up)
- Test: `backend/test/curatedAppProvisioning.test.js` (new)

**Interfaces:**
- Consumes: `appDomain.slugWithSuffix(name, jobName): string` and `appDomain.fqdnFor(slug): string`
  (both already required at the top of `coolify.js`), `resourceLimits(job)` (existing).
- Produces: `generateRandomSecret(): string` (renamed from `generateDbPassword`, same behavior),
  `buildCuratedAppComposeYaml(name, limits, appConfig, fqdn, secret): string` (new, exported for
  tests). `provision(job, opts)`'s exported signature and `{externalRef, access, log}` return shape
  are unchanged.

- [ ] **Step 1: Rename `generateDbPassword` → `generateRandomSecret` in the existing test, confirm it now fails**

In `backend/test/dbEngineProvisioning.test.js`, find the line:

```js
    const p1 = coolify.generateDbPassword();
    const p2 = coolify.generateDbPassword();
```

Replace with:

```js
    const p1 = coolify.generateRandomSecret();
    const p2 = coolify.generateRandomSecret();
```

Run: `cd backend && node test/dbEngineProvisioning.test.js`
Expected: `TypeError: coolify.generateRandomSecret is not a function` (the rename hasn't happened in
the source yet — this confirms the test is actually exercising the renamed call).

- [ ] **Step 2: Perform the rename in coolify.js**

Find `function generateDbPassword() {` and rename it to `function generateRandomSecret() {` (body
unchanged — still `return crypto.randomBytes(24).toString("base64url");`).

Find `const dbPassword = dbConfig ? generateDbPassword() : null;` and change to
`const dbPassword = dbConfig ? generateRandomSecret() : null;`.

In `module.exports`, find `generateDbPassword,` and change to `generateRandomSecret,`.

- [ ] **Step 3: Run the renamed test and the full database-engine suite to confirm nothing broke**

Run: `cd backend && node test/dbEngineProvisioning.test.js && node test/databaseConnectionRoutes.test.js`
Expected: both `ALL GREEN` — the rename is purely mechanical, every database-engine behavior test
still passes under the new name.

- [ ] **Step 4: Write the failing tests for curated-app compose generation**

Create `backend/test/curatedAppProvisioning.test.js`:

```js
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
  await withEnvAsync({ ...LANE_ENV, SMTP_HOST: "smtp.murzaktech.com", SMTP_PORT: "587", SMTP_USER: "notify@murzaktech.com", SMTP_PASS: "platform-secret", MURZAK_DOMAIN_BASE: "murzaktech.com" }, async () => {
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
      patch: async (url, body) => { patchedDomain = body?.domains; return { data: {} }; },
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
```

- [ ] **Step 5: Run to confirm it fails**

Run: `cd backend && node test/curatedAppProvisioning.test.js`
Expected: `TypeError: coolify.buildCuratedAppComposeYaml is not a function`.

- [ ] **Step 6: Implement**

In `backend/services/provisioning/lanes/coolify.js`, add the new table and builder right after
`buildDbComposeYaml`'s closing brace (still before `async function provision(job, opts) {`):

```js
/**
 * Curated third-party HTTP apps deployed through this lane — pre-built,
 * published images, not something built from a customer's repo (that's
 * provisionApp/BYOA) and not a raw database engine (that's DB_ENGINE_CONFIG,
 * which has no HTTP surface and deliberately skips domain attachment).
 *
 * Deliberately a SEPARATE table from DB_ENGINE_CONFIG, not merged — two data
 * points don't yet justify one shared abstraction. When a third curated app
 * is added, that's the point to unify both into one generic mechanism.
 */
const CURATED_APP_CONFIG = {
  "starter-esign": {
    image: "docuseal/docuseal:latest",
    port: 3000,
    volumePath: "/data",
    // Every customer's instance reuses Murzak's own platform SMTP relay —
    // same identity already used for password-reset/support-alert email.
    // DocuSeal cannot deliver signature invites without SOME SMTP config;
    // if SMTP_HOST is unset these come through blank and the app deploys
    // but can't send mail — surfaces via the runtime-logs panel, not
    // specially handled here (this lane deploys what's configured, same
    // posture as everywhere else in it).
    envVars: (fqdn, secretKeyBase) => ({
      HOST: fqdn,
      SECRET_KEY_BASE: secretKeyBase,
      SMTP_ADDRESS: process.env.SMTP_HOST || "",
      SMTP_PORT: process.env.SMTP_PORT || "587",
      SMTP_USERNAME: process.env.SMTP_USER || "",
      SMTP_PASSWORD: process.env.SMTP_PASS || "",
      SMTP_AUTHENTICATION: "plain",
      SMTP_FROM: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
    }),
  },
};

/** Pure — same reasoning as buildDbComposeYaml: side-effect-free, unit-tested directly. */
function buildCuratedAppComposeYaml(name, limits, appConfig, fqdn, secretKeyBase) {
  const volumeName = `${name}-data`;
  const envLines = Object.entries(appConfig.envVars(fqdn, secretKeyBase))
    .map(([k, v]) => `      ${k}: "${v}"\n`)
    .join("");

  return (
    `services:\n` +
    `  app:\n` +
    `    image: ${appConfig.image}\n` +
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
    `      - "${appConfig.port}"\n` +
    `    environment:\n${envLines}` +
    `    volumes:\n` +
    `      - ${volumeName}:${appConfig.volumePath}\n` +
    `volumes:\n` +
    `  ${volumeName}:\n`
  );
}
```

In `provision(job, opts)`, find:

```js
  const limits = resourceLimits(job);
  const dbConfig = DB_ENGINE_CONFIG[job.service_id];
```

Change to:

```js
  const limits = resourceLimits(job);
  const dbConfig = DB_ENGINE_CONFIG[job.service_id];
  const curatedAppConfig = CURATED_APP_CONFIG[job.service_id];
```

Find:

```js
  const dbPassword = dbConfig ? generateRandomSecret() : null;
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword)
    : `services:\n` +
```

Change to:

```js
  const dbPassword = dbConfig ? generateRandomSecret() : null;
  // Computed BEFORE creation — slugWithSuffix/fqdnFor are pure functions of
  // name/job.name, not of the Coolify-assigned uuid, so the same fqdn this
  // seeds into HOST is what attachServiceUrl (below, after creation) PATCHes
  // onto the service. No chicken-and-egg: both derive the identical value.
  const curatedAppFqdn = curatedAppConfig
    ? appDomain.fqdnFor(appDomain.slugWithSuffix(name, job.name))
    : null;
  const curatedAppSecret = curatedAppConfig ? generateRandomSecret() : null;
  const composeYaml = dbConfig
    ? buildDbComposeYaml(name, limits, dbConfig, dbPassword)
    : curatedAppConfig
    ? buildCuratedAppComposeYaml(name, limits, curatedAppConfig, curatedAppFqdn, curatedAppSecret)
    : `services:\n` +
```

(The generic fallback template below stays exactly as-is — only the ternary's branching changed.)

The `url`/`attachServiceUrl` line and the `log` line need NO changes — both already branch on
`dbConfig` alone, and `curatedAppConfig` jobs fall into their existing `else` paths correctly
(`attachServiceUrl` runs normally; the log's `url=${url || "(pending)"}` branch fires). Confirm this
by reading the surrounding ~15 lines before editing anything there — if they've drifted from this
description, stop and re-read the current file rather than guessing.

Finally, in `module.exports`, add `buildCuratedAppComposeYaml,` on its own line right after the
`generateRandomSecret,`/`buildDbComposeYaml,` entries (do not remove either of those).

- [ ] **Step 7: Run the new test to confirm it passes**

Run: `cd backend && node test/curatedAppProvisioning.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 8: Add to the test chain and run the full suite**

In `backend/package.json`, insert `node test/curatedAppProvisioning.test.js` right after
`node test/databaseConnectionRoutes.test.js` in the `"test"` chain.

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js backend/test/dbEngineProvisioning.test.js backend/test/curatedAppProvisioning.test.js backend/package.json
git commit -m "$(cat <<'EOF'
feat: add curated third-party app support to the coolify lane

CURATED_APP_CONFIG deploys a specific published image with domain
attachment and seeded env vars -- the first consumer beyond BYOA
(built-from-source) and DB_ENGINE_CONFIG (raw databases, no HTTP
surface). Kept as a separate table from DB_ENGINE_CONFIG; unifying
them is deferred until a third curated app exists. Also renames
generateDbPassword to generateRandomSecret, its second caller.
EOF
)"
```

---

### Task 2: Catalog entry for E-Signature

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts`
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated, not hand-edited)

- [ ] **Step 1: Add "E-Signature" to both category types**

In `frontend/src/config/serviceCatalog.ts`, find the `ServiceCategory` union (starts `export type
ServiceCategory =`, around line 4). Add a new line `| "E-Signature"` — placed after `| "Storage"`:

```ts
export type ServiceCategory =
  | "Website Hosting"
  | "App Hosting"
  | "ERP Hosting"
  | "CRM & Helpdesk"
  | "Email Hosting"
  | "Database Hosting"
  | "Domain Registration"
  | "Storage"
  | "E-Signature"
  | "Apps"
  | "Security & Backup"
  | "POS & Inventory"
  | "Analytics"
  | "CCTV"
  | "Domains & SSL"
  | "Performance"
  | "Support & SLA";
```

Find `export type CloudLaunchCategory =` (around line 1161) and its paired
`CLOUD_LAUNCH_CATEGORIES` array (around line 1167). Add `"E-Signature"` to both, right after
`"Storage"`:

```ts
export type CloudLaunchCategory =
  | "Website Hosting"
  | "App Hosting"
  | "Database Hosting"
  | "Storage"
  | "E-Signature";

export const CLOUD_LAUNCH_CATEGORIES: CloudLaunchCategory[] = [
  "Website Hosting",
  "App Hosting",
  "Database Hosting",
  "Storage",
  "E-Signature",
];
```

- [ ] **Step 2: Add the catalog entry**

Find the `db-redis` entry (ends around line 447 with `sortOrder: 54,\n    },`) and the
`starter-hrpay` entry that follows it (starts around line 448). Insert a new entry between them:

```ts
    {
      id: "starter-esign",
      name: "E-Signature",
      description: "Send documents for signature and track status — your own e-signature tool.",
      category: "E-Signature",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "512MB", storage: "10GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 512, diskGb: 10 },
      pricing: { model: "addon", monthlyKes: 1800, setupKes: 0 },
      highlights: ["Unlimited documents", "Signer tracking", "Your own domain"],
      sortOrder: 56,
    },
```

(Read the exact current text around `db-redis`/`starter-hrpay` with the Read tool immediately before
editing — line numbers may have shifted from earlier sessions' edits to this same file.)

- [ ] **Step 3: Regenerate the snapshot**

Run: `cd backend && npm run gen:catalog`
Expected: `Wrote 55 services to backend/data/serviceCatalogSnapshot.json` (54 → 55, one new id).

- [ ] **Step 4: Verify the new id resolves through the snapshot**

Run: `cd backend && node -e "const {getServiceMeta,laneFor}=require('./services/provisioning/catalog'); const m=getServiceMeta('starter-esign'); console.log(JSON.stringify(m)); console.log('lane:', laneFor(m));"`
Expected: prints the meta object with `"category":"E-Signature"`, `"capacityClass":"volume"`,
`"ramMb":512`, `"diskGb":10`, `"monthlyKes":1800`, and `lane: coolify` (no `laneFor` change was
needed — `capacityClass: "volume"` with `ramMb > 0` already falls through to the existing `coolify`
default).

- [ ] **Step 5: Run the full backend suite and frontend type check**

Run: `cd backend && npm test`
Expected: all green — in particular `catalogSnapshot.test.js`, which asserts invariants across the
whole snapshot (e.g. "no SERVICE_ID_TO_PLAN id is a Domain Registration") that a new id must not
violate; `starter-esign` isn't in that hardcoded list so it isn't directly checked by name, but
confirm the run is still green as a whole.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors — this is the real check that `"E-Signature"` was added to both unions
consistently (a missed spot here is a compile error, not a runtime one).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json
git commit -m "$(cat <<'EOF'
feat: add E-Signature (DocuSeal) as a purchasable catalog product

starter-esign, Light tier, KES 1,800/mo, routes through the existing
coolify lane via CURATED_APP_CONFIG (added in the prior commit) --
no new provisioning lane, no new frontend component. First product
built on the curated-third-party-app pattern.
EOF
)"
```

---

### Task 3: Full-suite verification

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && npm test`
Expected: zero failures across every chained file, including the two new ones added in Task 1.

- [ ] **Step 2: Run the frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm the end-to-end catalog → lane resolution directly**

Run: `cd backend && node -e "const {getServiceMeta,laneFor}=require('./services/provisioning/catalog'); const c=require('./services/provisioning/lanes/coolify'); const m=getServiceMeta('starter-esign'); const yaml=c.buildCuratedAppComposeYaml('x',{ramMb:512,cpus:0.25,pidsLimit:512},{image:'docuseal/docuseal:latest',port:3000,volumePath:'/data',envVars:()=>({HOST:'https://x.test'})},'https://x.test','sec'); console.log(laneFor(m)==='coolify' && yaml.includes('docuseal') ? 'OK' : 'FAIL')"`
Expected: `OK`.

No commit for this task — verification only, over work already committed in Tasks 1–2.
