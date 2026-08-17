# Invoice Ninja Multi-Service Curated App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `starter-invoicing` (Invoice Ninja) as a purchasable catalog product, by generalizing
`CURATED_APP_CONFIG`/`buildCuratedAppComposeYaml` in `coolify.js` to support a multi-service compose
(app + nginx + mysql + redis), without touching DocuSeal's existing single-service path at all.

**Architecture:** `buildCuratedAppComposeYaml` gains a branch at the top: if the config has a
`services` map, delegate to a new `buildMultiServiceComposeYaml`; otherwise run the existing body
unchanged. The multi-service builder emits one hardened compose service block per entry, using
Invoice Ninja's own real reference nginx config (fetched from `invoiceninja/dockerfiles`, not
guessed), embedded via a `command:` heredoc rather than Compose's `configs:` feature.

**Tech Stack:** Node/Express backend, hand-rolled Coolify compose-YAML generation (no SDK), this
repo's hand-rolled test harness.

## Global Constraints

- DocuSeal's existing compose output must be byte-for-byte unaffected — verify with a regression test.
- Four services, images, and configuration exactly as Invoice Ninja's own reference
  (`invoiceninja/dockerfiles`, `debian/` subfolder) defines them — not simplified.
- nginx config embedded via `command:` + heredoc with a **single-quoted** delimiter (`<< 'NGINXEOF'`)
  so nginx's `$uri`/`$query_string` variables are never shell-expanded.
- No `IN_USER_EMAIL`/`IN_PASSWORD` — first admin account is created via Invoice Ninja's own web setup
  wizard, not automated.
- Catalog: id `starter-invoicing`, new category `"Invoicing"`, tier Light, `capacityClass: "volume"`,
  `resources: { ramMb: 1280, diskGb: 15 }`, `pricing: { model: "addon", monthlyKes: 3800, setupKes: 0 }`.
- No frontend changes — same as DocuSeal, the generic `ResourceDetail` page already covers it.

---

### Task 1: Multi-service compose builder

**Files:**
- Modify: `backend/services/provisioning/lanes/coolify.js`
- Test: `backend/test/invoiceNinjaProvisioning.test.js` (new)

**Interfaces:**
- Consumes: `resourceLimits(job)` (existing), `appDomain.fqdnFor`/`slugWithSuffix` (existing),
  `generateRandomSecret()` (existing).
- Produces: `generateLaravelAppKey(): string` (exported), `buildMultiServiceComposeYaml(name, limits,
  appConfig, fqdn): string` (exported, called internally by `buildCuratedAppComposeYaml` — its own
  signature `(name, limits, appConfig, fqdn, secretKeyBase)` is unchanged; multi-service configs
  simply don't use the `secretKeyBase` param).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/invoiceNinjaProvisioning.test.js`:

```js
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
      patch: async (url, body) => { patchedDomain = body?.domains; return { data: {} }; },
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
```

This test expects `coolify.js` to export a narrow, test-only accessor for the `starter-invoicing`
entry inside `CURATED_APP_CONFIG` (that table itself isn't exported): implement it as
`__test_invoiceNinjaConfig: CURATED_APP_CONFIG["starter-invoicing"]` in `module.exports` (Step 3
below), not a general-purpose export of the whole table.

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/invoiceNinjaProvisioning.test.js`
Expected: `TypeError: coolify.generateLaravelAppKey is not a function`.

- [ ] **Step 3: Implement**

In `backend/services/provisioning/lanes/coolify.js`, add right after `generateRandomSecret`'s
definition (find `function generateRandomSecret() {` and its closing `}`):

```js
/** Laravel's exact APP_KEY format (base64: + 32 raw random bytes) — no `artisan key:generate` needed. */
function generateLaravelAppKey() {
  return `base64:${crypto.randomBytes(32).toString("base64")}`;
}
```

Add the two real nginx config file contents as module-level constants, right before
`const CURATED_APP_CONFIG = {` — copied verbatim from
`invoiceninja/dockerfiles`'s `debian/nginx/invoiceninja.conf` and `debian/nginx/laravel.conf` (note
the doubled backslashes below — this is JS template-literal source; each `\\` produces one literal
`\` in the resulting string, required so `\.php$` in the real nginx regex survives instead of being
silently corrupted to `.php$` by JS's escape-sequence handling):

```js
/**
 * Invoice Ninja's own reference nginx config, verbatim from
 * invoiceninja/dockerfiles (debian/nginx/invoiceninja.conf +
 * debian/nginx/laravel.conf) — not simplified or guessed at. Embedded here
 * (rather than relied on as a bind-mounted file) because Coolify's
 * docker_compose_raw deploy has no mechanism for shipping extra files
 * alongside the compose YAML.
 */
const INVOICE_NINJA_NGINX_TUNING_CONF =
  "client_max_body_size 10M;\n" +
  "client_body_buffer_size 10M;\n" +
  "server_tokens off;\n" +
  "fastcgi_buffers 32 16K;\n" +
  "gzip on;\n" +
  "gzip_comp_level 2;\n" +
  "gzip_min_length 1M;\n" +
  "gzip_proxied any;\n" +
  "gzip_types *;\n";

const INVOICE_NINJA_NGINX_LARAVEL_CONF =
  "server {\n" +
  "    listen 80 default_server;\n" +
  "    server_name _;\n" +
  "    root /var/www/html/public;\n" +
  "\n" +
  "    add_header X-Frame-Options \"SAMEORIGIN\";\n" +
  "    add_header X-Content-Type-Options \"nosniff\";\n" +
  "\n" +
  "    index index.php;\n" +
  "\n" +
  "    charset utf-8;\n" +
  "\n" +
  "    location / {\n" +
  "        try_files $uri $uri/ /index.php?$query_string;\n" +
  "    }\n" +
  "\n" +
  "    location = /favicon.ico { access_log off; log_not_found off; }\n" +
  "    location = /robots.txt  { access_log off; log_not_found off; }\n" +
  "\n" +
  "    error_page 404 /index.php;\n" +
  "\n" +
  "    location ~ \\.php$ {\n" +
  "        fastcgi_pass app:9000;\n" +
  "        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;\n" +
  "        include fastcgi_params;\n" +
  "    }\n" +
  "\n" +
  "    location ~ /\\.(?!well-known).* {\n" +
  "        deny all;\n" +
  "    }\n" +
  "}\n";
```

Add the `starter-invoicing` entry to `CURATED_APP_CONFIG`. Find the closing of the `"starter-esign"`
entry — the line `  },` immediately followed by the object's closing `};` (i.e. `CURATED_APP_CONFIG`
currently contains only `"starter-esign"` and ends right after it) — and insert a new sibling entry
between them, so the object ends up containing both keys:

```js
  "starter-invoicing": {
    primaryService: "nginx",
    primaryPort: 80,
    services: {
      mysql: {
        image: "mysql:8",
        volumeName: "mysql-data",
        volumePath: "/var/lib/mysql",
        environment: (ctx) => ({
          MYSQL_DATABASE: "ninja",
          MYSQL_USER: "ninja",
          MYSQL_PASSWORD: ctx.dbPassword,
          MYSQL_ROOT_PASSWORD: ctx.dbRootPassword,
        }),
        healthcheck: (ctx) =>
          `      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uninja", "-p${ctx.dbPassword}"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 20\n`,
      },
      redis: {
        image: "redis:alpine",
        volumeName: "redis-data",
        volumePath: "/data",
        healthcheck: () =>
          `      test: ["CMD", "redis-cli", "ping"]\n` +
          `      interval: 5s\n` +
          `      timeout: 3s\n` +
          `      retries: 10\n`,
      },
      app: {
        image: "invoiceninja/invoiceninja-debian:latest",
        volumeName: "app-public",
        volumePath: "/var/www/html/public",
        extraVolumes: [{ name: "app-storage", path: "/var/www/html/storage" }],
        environment: (ctx) => ({
          APP_KEY: ctx.appKey,
          APP_URL: ctx.fqdn,
          DB_CONNECTION: "mysql",
          DB_HOST: "mysql",
          DB_DATABASE: "ninja",
          DB_USERNAME: "ninja",
          DB_PASSWORD: ctx.dbPassword,
          DB_PORT: "3306",
          REDIS_HOST: "redis",
          REQUIRE_HTTPS: "true",
          NINJA_ENVIRONMENT: "selfhost",
          MAIL_MAILER: "smtp",
          MAIL_HOST: process.env.SMTP_HOST || "",
          MAIL_PORT: process.env.SMTP_PORT || "587",
          MAIL_USERNAME: process.env.SMTP_USER || "",
          MAIL_PASSWORD: process.env.SMTP_PASS || "",
          MAIL_FROM_ADDRESS: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
        }),
        dependsOn: { mysql: "service_healthy", redis: "service_healthy" },
      },
      nginx: {
        image: "nginx:alpine",
        sharedVolumesFrom: "app", // mounts app's app-public/app-storage, read-only
        dependsOn: { app: "service_started" },
      },
    },
  },
```

This is inserted immediately before the object's existing closing `};` — the file's
`CURATED_APP_CONFIG` now contains both `"starter-esign"` and `"starter-invoicing"`, and that
pre-existing closing `};` is untouched.

Add `buildMultiServiceComposeYaml`, right after `buildCuratedAppComposeYaml`'s existing closing
brace:

```js
/**
 * Shared hardening block, identical to every other service this lane builds
 * (see buildDbComposeYaml/buildCuratedAppComposeYaml) — every container gets
 * cap_drop ALL + CHOWN/SETUID/SETGID + no-new-privileges, not just the
 * primary/public-facing one. A database container run as root during its own
 * init is exactly the same category of risk this hardening exists for.
 */
function hardeningBlock(limits) {
  return (
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
    `      - no-new-privileges:true\n`
  );
}

/**
 * Multi-service curated apps (app + a real backing database, unlike
 * DocuSeal's SQLite default). First consumer: starter-invoicing (Invoice
 * Ninja). RAM/CPU limits apply per-container, not summed across the stack —
 * a known, accepted looseness (see the design doc), not silently ignored.
 */
function buildMultiServiceComposeYaml(name, limits, appConfig, fqdn) {
  const dbPassword = generateRandomSecret();
  const dbRootPassword = generateRandomSecret();
  const appKey = generateLaravelAppKey();
  const ctx = { dbPassword, dbRootPassword, appKey, fqdn };

  const volumeDecls = [];
  let serviceBlocks = "";

  for (const [serviceName, svc] of Object.entries(appConfig.services)) {
    const envEntries = svc.environment ? svc.environment(ctx) : null;
    const envLines = envEntries
      ? `    environment:\n` +
        Object.entries(envEntries).map(([k, v]) => `      ${k}: "${v}"\n`).join("")
      : "";

    let volumeLines = "";
    if (svc.sharedVolumesFrom) {
      // nginx: mounts the app service's volumes read-only, no volume of its own.
      const shared = appConfig.services[svc.sharedVolumesFrom];
      const allShared = [
        { name: shared.volumeName, path: shared.volumePath },
        ...(shared.extraVolumes || []),
      ];
      volumeLines =
        `    volumes:\n` +
        allShared.map((v) => `      - ${name}-${v.name}:${v.path}:ro\n`).join("");
    } else if (svc.volumeName) {
      const allVolumes = [{ name: svc.volumeName, path: svc.volumePath }, ...(svc.extraVolumes || [])];
      volumeLines =
        `    volumes:\n` +
        allVolumes.map((v) => `      - ${name}-${v.name}:${v.path}\n`).join("");
      for (const v of allVolumes) volumeDecls.push(`${name}-${v.name}`);
    }

    const exposeLines =
      serviceName === appConfig.primaryService
        ? `    expose:\n      - "${appConfig.primaryPort}"\n`
        : "";

    const dependsLines = svc.dependsOn
      ? `    depends_on:\n` +
        Object.entries(svc.dependsOn)
          .map(([dep, cond]) => `      ${dep}:\n        condition: ${cond}\n`)
          .join("")
      : "";

    const healthLines = svc.healthcheck
      ? `    healthcheck:\n${svc.healthcheck(ctx)}`
      : "";

    let commandLines = "";
    if (serviceName === "nginx") {
      commandLines =
        `    command:\n` +
        `      - sh\n` +
        `      - -c\n` +
        `      - |\n` +
        `        cat > /etc/nginx/conf.d/laravel.conf << 'NGINXEOF'\n` +
        INVOICE_NINJA_NGINX_LARAVEL_CONF.split("\n").map((l) => `        ${l}`).join("\n") +
        `        NGINXEOF\n` +
        `        cat > /etc/nginx/conf.d/invoiceninja.conf << 'NGINXEOF2'\n` +
        INVOICE_NINJA_NGINX_TUNING_CONF.split("\n").map((l) => `        ${l}`).join("\n") +
        `        NGINXEOF2\n` +
        `        exec nginx -g 'daemon off;'\n`;
    }

    serviceBlocks +=
      `  ${serviceName}:\n` +
      `    image: ${svc.image}\n` +
      hardeningBlock(limits) +
      commandLines +
      envLines +
      volumeLines +
      exposeLines +
      dependsLines +
      healthLines;
  }

  return (
    `services:\n` +
    serviceBlocks +
    `volumes:\n` +
    volumeDecls.map((v) => `  ${v}:\n`).join("")
  );
}
```

Update `buildCuratedAppComposeYaml`'s signature to branch at the top (find `function
buildCuratedAppComposeYaml(name, limits, appConfig, fqdn, secretKeyBase) {` and its first line):

```js
function buildCuratedAppComposeYaml(name, limits, appConfig, fqdn, secretKeyBase) {
  if (appConfig.services) return buildMultiServiceComposeYaml(name, limits, appConfig, fqdn);
  const volumeName = `${name}-data`;
```

(Everything below that in the existing function body — the single-service DocuSeal path — is
untouched.)

In `module.exports` (find the block near the bottom of the file), add the two new names plus the
test-only seam:

```js
  generateLaravelAppKey,
  buildMultiServiceComposeYaml,
  __test_invoiceNinjaConfig: CURATED_APP_CONFIG["starter-invoicing"],
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd backend && node test/invoiceNinjaProvisioning.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Confirm DocuSeal's output is unaffected (regression)**

Run: `cd backend && node test/curatedAppProvisioning.test.js`
Expected: `ALL GREEN` — unchanged from before this task, proving the branch-on-`appConfig.services`
approach didn't disturb the existing single-service path.

- [ ] **Step 6: Add to the test chain and run the full suite**

In `backend/package.json`, insert `node test/invoiceNinjaProvisioning.test.js` into the `"test"`
chain, right after `node test/curatedAppProvisioning.test.js` and before
`node test/dbPortAllocator.test.js`.

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/services/provisioning/lanes/coolify.js backend/test/invoiceNinjaProvisioning.test.js backend/package.json
git commit -m "$(cat <<'EOF'
feat: add multi-service curated app support, starter-invoicing (Invoice Ninja)

CURATED_APP_CONFIG entries can now describe multiple bundled services
(app + nginx + mysql + redis for Invoice Ninja), not just DocuSeal's
single SQLite-backed container. buildCuratedAppComposeYaml branches
on appConfig.services -- DocuSeal's existing single-service path is
completely unchanged (verified by regression test).

nginx config is Invoice Ninja's own real reference config (from
invoiceninja/dockerfiles), embedded via a command: heredoc with a
single-quoted delimiter so its $uri/$query_string variables are never
shell-expanded -- deliberately not using Compose's configs: feature,
which is untested against this Coolify deployment.
EOF
)"
```

---

### Task 2: Catalog entry

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts`
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated)

- [ ] **Step 1: Add the "Invoicing" category**

In `frontend/src/config/serviceCatalog.ts`, find the `ServiceCategory` union (the one also updated for
`"E-Signature"`). Add `| "Invoicing"` right after `"E-Signature"`:

```ts
  | "Storage"
  | "E-Signature"
  | "Invoicing"
  | "Apps"
```

`CloudLaunchCategory`/`CLOUD_LAUNCH_CATEGORIES` also need the addition, right after `"E-Signature"`:

```ts
export type CloudLaunchCategory =
  | "Website Hosting"
  | "App Hosting"
  | "Database Hosting"
  | "Storage"
  | "E-Signature"
  | "Invoicing";

export const CLOUD_LAUNCH_CATEGORIES: CloudLaunchCategory[] = [
  "Website Hosting",
  "App Hosting",
  "Database Hosting",
  "Storage",
  "E-Signature",
  "Invoicing",
];
```

(Read the current file with the Read tool immediately before editing — confirm exact text; line
numbers have shifted from every earlier session's edits.)

- [ ] **Step 2: Add the catalog entry**

Find the `starter-esign` entry (added in the E-Signature work) and the item immediately after it.
Insert the new entry right after `starter-esign`:

```ts
    {
      id: "starter-invoicing",
      name: "Invoicing",
      description: "Send invoices, track payments, and manage clients — your own invoicing tool.",
      category: "Invoicing",
      tier: "Light",
      capacityClass: "volume",
      specs: { ram: "1.25GB", storage: "15GB NVMe", cpu: "Shared", bandwidth: "Generous", backups: "Daily", sla: "99.5%" },
      resources: { ramMb: 1280, diskGb: 15 },
      pricing: { model: "addon", monthlyKes: 3800, setupKes: 0 },
      highlights: ["Unlimited clients", "Payment tracking", "Your own domain"],
      sortOrder: 57,
    },
```

(`sortOrder: 57` — right after `starter-esign`'s `56` and before `starter-hrpay`'s `60`; confirm those
values haven't shifted by reading the file first.)

- [ ] **Step 3: Regenerate the snapshot**

Run: `cd backend && npm run gen:catalog`
Expected: `Wrote 56 services to backend/data/serviceCatalogSnapshot.json` (55 → 56).

- [ ] **Step 4: Verify resolution and lane routing**

Run: `cd backend && node -e "const {getServiceMeta,laneFor}=require('./services/provisioning/catalog'); const m=getServiceMeta('starter-invoicing'); console.log(JSON.stringify(m)); console.log('lane:', laneFor(m));"`
Expected: prints the meta with `"category":"Invoicing"`, `"ramMb":1280`, `"diskGb":15`,
`"monthlyKes":3800`, and `lane: coolify` (no `laneFor` change needed, same reasoning as
`starter-esign`).

- [ ] **Step 5: Run the full backend suite and frontend type check**

Run: `cd backend && npm test`
Expected: all green.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors — this is what actually proves `"Invoicing"` was added consistently to both
category unions.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json
git commit -m "$(cat <<'EOF'
feat: add Invoicing (Invoice Ninja) as a purchasable catalog product

starter-invoicing, Light tier, KES 3,800/mo, 1280MB RAM / 15GB disk --
re-priced up from the original app+MySQL estimate once the real
four-service (app+nginx+mysql+redis) footprint was confirmed against
Invoice Ninja's own reference deployment.
EOF
)"
```

---

### Task 3: Full-suite verification

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && npm test`
Expected: zero failures, including both new test files from Tasks 1-2.

- [ ] **Step 2: Run the frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Direct regression guard — DocuSeal's compose is still byte-identical to before this plan**

Run: `cd backend && node test/curatedAppProvisioning.test.js && node test/invoiceNinjaProvisioning.test.js`
Expected: both `ALL GREEN`.

No commit for this task — verification only, over work already committed in Tasks 1-2.

## What still can't be verified from this session

No live Coolify/VPS access. Given tonight's MinIO domain-routing trouble, this plan deliberately
avoided Compose's `configs:` feature and any dependency on `SERVICE_FQDN_*`-style magic variables —
`starter-invoicing` reuses `attachServiceUrl`, the same domain-PATCH mechanism already proven live for
the real BYOA customer app. That reduces risk but does not eliminate the need for a real test
purchase before this is something you'd want to actually sell.
