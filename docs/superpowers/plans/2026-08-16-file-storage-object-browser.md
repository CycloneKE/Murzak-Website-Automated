# File Storage Object Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the "File Storage (25GB)" catalog item a real backend (a shared, self-hosted MinIO
bucket) and a frontend file browser, replacing the current fake Coolify placeholder container.

**Architecture:** One shared MinIO bucket holds every File Storage customer's files, isolated by
key-prefix `{webAccountName}/{serviceId}/`. A new zero-infra provisioning lane activates the purchase
instantly (no container). New `/api/portal/services/:serviceId/files...` routes issue presigned S3
PUT/GET URLs so the browser transfers bytes directly to/from MinIO. Quota (25GB, read live from the
catalog) is enforced in application code via `ListObjectsV2` size summation — no MinIO admin API, no
new database table. See `docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md`.

**Tech Stack:** Node/Express backend (hand-rolled SigV4 S3 client, no AWS SDK), React/TypeScript
frontend, Frappe/ERPNext as the system of record for Provisioning Jobs.

## Global Constraints

- No AWS SDK / S3 client library — extend the existing hand-rolled `s3Client.js` (SigV4), matching
  this codebase's stated preference for "fixed, publicly documented" REST calls over dependencies.
- No new Frappe doctype or DB table for file metadata or quota — MinIO's own `ListObjectsV2` is the
  source of truth for both.
- Feature ships behind `STORAGE_BROWSER_ENABLED` (default `false`), mirroring
  `RESOURCE_ADMIN_ENABLED`/`TERMINAL_ENABLED`.
- Every route scoped by `requireAuth` + ownership check via the existing `loadOwnedJob` pattern in
  `portalRoutes.js`; every client-supplied file name validated against a strict allowlist (no path
  separators, no `..`) before being joined into an S3 key.
- Tests use this repo's existing hand-rolled harness (`ok()`/`section()` helpers, `node test/x.test.js`,
  no Jest/Mocha) — see `backend/test/terminalRetention.test.js` and `backend/test/resourceAdmin.test.js`
  for the exact style to match.

---

### Task 1: Extend the shared S3 client with presigned PUT and list support

**Files:**
- Modify: `backend/services/terminal/s3Client.js`
- Test: `backend/test/s3Client.test.js` (new)

**Interfaces:**
- Produces: `presignPutUrl(key, opts)` — same signature/behavior as the existing `presignGetUrl`, method
  PUT. `listObjectsV2(prefix, opts)` — returns `Promise<{key: string, size: number, lastModified:
  string|null}[]>`.

- [ ] **Step 1: Refactor `presignGetUrl` to share a method-agnostic core, write the failing test for the refactor + new PUT function**

Add to `backend/test/s3Client.test.js`:

```js
/**
 * s3Client.js — presigned PUT + ListObjectsV2, and a refactor-safety check
 * that presignGetUrl's existing output is byte-for-byte unchanged.
 * node test/s3Client.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { presignGetUrl, presignPutUrl } = require("../services/terminal/s3Client");

console.log("# presignGetUrl — unchanged after refactor (golden output)");
{
  const opts = {
    endpoint: "https://s3.us-west-002.backblazeb2.com",
    bucket: "murzak-terminal-recordings",
    region: "us-west-002",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "supersecretkey",
    now: new Date("2026-01-15T10:00:00Z"),
  };
  const url = presignGetUrl("sessions/TERM-WA-00001.ndjson", opts);
  const expectedPrefix =
    "https://s3.us-west-002.backblazeb2.com/murzak-terminal-recordings/sessions/TERM-WA-00001.ndjson" +
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260115%2Fus-west-002%2Fs3%2Faws4_request" +
    "&X-Amz-Date=20260115T100000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=";
  ok(url.startsWith(expectedPrefix), "GET URL shape unchanged (method, path, query params) after the presignUrl refactor");
  ok(/^[0-9a-f]{64}$/.test(url.slice(expectedPrefix.length)), "trailing signature is still a 64-char hex string");
}

console.log("# presignPutUrl — same signing scheme, method PUT");
{
  const opts = {
    endpoint: "https://minio.murzaktech.internal",
    bucket: "murzak-customer-files",
    region: "us-east-1",
    accessKeyId: "AKIASTORAGE",
    secretAccessKey: "storagesecret",
    now: new Date("2026-08-16T09:00:00Z"),
  };
  const url1 = presignPutUrl("WA-1/starter-storage/report.pdf", opts);
  const url2 = presignPutUrl("WA-1/starter-storage/report.pdf", opts);
  ok(url1 === url2, "deterministic — identical inputs produce an identical signature");
  ok(url1.startsWith("https://minio.murzaktech.internal/murzak-customer-files/WA-1/starter-storage/report.pdf"), "targets the correct path-style bucket/key");
  ok(/X-Amz-Signature=[0-9a-f]{64}/.test(url1), "carries a 64-char hex signature");

  const urlDifferentKey = presignPutUrl("WA-1/starter-storage/other.pdf", opts);
  ok(urlDifferentKey !== url1, "a different key changes the signature");

  const urlGet = presignGetUrl("WA-1/starter-storage/report.pdf", opts);
  ok(urlGet !== url1, "PUT and GET presigns for the SAME key differ (method is part of the signed request)");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
```

- [ ] **Step 2: Run it to confirm it fails (presignPutUrl doesn't exist yet)**

Run: `cd backend && node test/s3Client.test.js`
Expected: throws `TypeError: presignPutUrl is not a function` (or similar) before any `ok(...)` runs.

- [ ] **Step 3: Implement — extract a shared presign core, add presignPutUrl and listObjectsV2**

In `backend/services/terminal/s3Client.js`, replace the existing `presignGetUrl` function with a
shared core plus two thin wrappers (keep every other function in the file — `cfg`, `hmac`, `sha256hex`,
`amzDateStamp`, `dateStamp`, `signingKey`, `objectPath`, `putObject`, `deleteObject`, `isConfigured` —
unchanged):

```js
/**
 * Presigned URL core — shared by presignGetUrl and presignPutUrl. PURE (no
 * network, no I/O), fully deterministic given the same `now`. Only the HTTP
 * method differs between a download link and an upload link; everything else
 * about SigV4 query-string presigning is identical.
 */
function presignUrl(method, key, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const expiresSeconds = Math.min(Math.max(Number(opts.expiresSeconds) || 300, 1), 7 * 24 * 3600);

  const host = c.endpoint.host;
  const canonicalUri = objectPath(c.bucket, key);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;
  const amzDate = amzDateStamp(now);

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  return `${c.endpoint.protocol}//${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/** Generate a presigned GET URL — the recording/file download link. */
function presignGetUrl(key, opts = {}) {
  return presignUrl("GET", key, opts);
}

/** Generate a presigned PUT URL — a customer's browser uploads directly here. */
function presignPutUrl(key, opts = {}) {
  return presignUrl("PUT", key, opts);
}
```

Then add, after `deleteObject`:

```js
/** Strip XML entities MinIO/S3 escape in Key text nodes. */
function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Regex-parsed XML, matching this codebase's "simple extractor, not a full
 * parser" style (see generate-catalog-snapshot.js) — safe here because the
 * response is our own trusted bucket's, never arbitrary attacker input. */
function parseListObjectsXml(xml) {
  const items = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = contentsRe.exec(xml)) !== null) {
    const block = m[1];
    const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
    const size = (block.match(/<Size>([\s\S]*?)<\/Size>/) || [])[1];
    const lastModified = (block.match(/<LastModified>([\s\S]*?)<\/LastModified>/) || [])[1];
    if (key) items.push({ key: decodeXmlEntities(key), size: Number(size) || 0, lastModified: lastModified || null });
  }
  return items;
}

/**
 * List objects under a prefix (ListObjectsV2). Real HTTP call, never
 * exercised against a live bucket — same unverified-live caveat as
 * putObject/deleteObject.
 */
async function listObjectsV2(prefix, opts = {}) {
  const c = cfg(opts);
  const now = opts.now || new Date();
  const host = c.endpoint.host;
  const canonicalUri = `/${c.bucket}`;
  const amzDate = amzDateStamp(now);
  const credentialScope = `${dateStamp(now)}/${c.region}/${c.service}/aws4_request`;
  const payloadHash = sha256hex("");

  const queryParams = { "list-type": "2", prefix };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = ["GET", canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(c.secretAccessKey, now, c.region, c.service), stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${c.endpoint.protocol}//${host}${canonicalUri}?${canonicalQueryString}`;
  const res = await axios.get(url, {
    headers: { ...headers, Authorization: authHeader },
    timeout: Number(process.env.TERMINAL_S3_TIMEOUT_MS || 30000),
  });
  return parseListObjectsXml(String(res.data));
}
```

Finally, update `module.exports` at the bottom of the file:

```js
module.exports = { presignGetUrl, presignPutUrl, listObjectsV2, putObject, deleteObject, isConfigured, objectPath };
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/s3Client.test.js`
Expected: `ALL GREEN` with the count of `ok:` lines matching the assertions above, 0 failed.

- [ ] **Step 5: Add the new test to the root test script and run the full suite**

In `backend/package.json`, insert `node test/s3Client.test.js` into the `"test"` script's chain
(anywhere after `node test/provisioning.test.js`, e.g. right before `node test/billing.test.js`).

Run: `cd backend && npm test`
Expected: every existing test still passes (this step only added functions and refactored
`presignGetUrl` internally without changing its output — Step 1's golden-output assertion is the
regression guard).

- [ ] **Step 6: Commit**

```bash
git add backend/services/terminal/s3Client.js backend/test/s3Client.test.js backend/package.json
git commit -m "feat: add presigned PUT and ListObjectsV2 to the shared S3 client"
```

---

### Task 2: Storage-product S3 wrapper (customer prefixing, quota-safe key handling)

**Files:**
- Create: `backend/services/storage/storageS3.js`
- Create: `backend/services/storageEligibility.js`
- Test: `backend/test/storageS3.test.js` (new)

**Interfaces:**
- Consumes: `presignGetUrl`, `presignPutUrl`, `listObjectsV2`, `deleteObject`, all from Task 1's
  `s3Client.js`.
- Produces: `storageS3.isConfigured(): boolean`, `storageS3.customerPrefix(webAccountName, serviceId):
  string` (throws on unsafe input), `storageS3.sanitizeFileName(name): string|null`,
  `storageS3.listFiles(prefix): Promise<{key,name,size,lastModified}[]>`,
  `storageS3.usedBytes(prefix): Promise<number>`, `storageS3.presignUpload(key, expiresSeconds):
  string`, `storageS3.presignDownload(key, expiresSeconds): string`, `storageS3.deleteFile(key):
  Promise<void>`. `storageEligibility.isStorageBrowserEnabled(): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/storageS3.test.js`:

```js
/**
 * storageS3.js — customer key-prefixing, filename sanitization, and the
 * STORAGE_BROWSER_ENABLED kill switch. node test/storageS3.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function throws(fn, msg) {
  try { fn(); ok(false, msg + " (did not throw)"); }
  catch (e) { ok(true, msg); }
}
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const storageS3 = require("../services/storage/storageS3");
const { isStorageBrowserEnabled } = require("../services/storageEligibility");

console.log("# kill switch defaults OFF");
{
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "" }, isStorageBrowserEnabled) === false, "unset -> disabled");
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "false" }, isStorageBrowserEnabled) === false, "'false' -> disabled");
  ok(withEnv({ STORAGE_BROWSER_ENABLED: "true" }, isStorageBrowserEnabled) === true, "'true' -> enabled");
}

console.log("# isConfigured — requires all four STORAGE_S3_* vars");
{
  ok(withEnv({ STORAGE_S3_ENDPOINT: "", STORAGE_S3_BUCKET: "", STORAGE_S3_ACCESS_KEY_ID: "", STORAGE_S3_SECRET_ACCESS_KEY: "" }, storageS3.isConfigured) === false, "nothing set -> not configured");
  ok(withEnv({
    STORAGE_S3_ENDPOINT: "https://minio.internal",
    STORAGE_S3_BUCKET: "murzak-customer-files",
    STORAGE_S3_ACCESS_KEY_ID: "key",
    STORAGE_S3_SECRET_ACCESS_KEY: "secret",
  }, storageS3.isConfigured) === true, "all four set -> configured");
}

console.log("# customerPrefix — safe inputs only, never mangled into a possible collision");
{
  ok(storageS3.customerPrefix("WA-00001", "starter-storage") === "WA-00001/starter-storage/", "builds the expected prefix");
  throws(() => storageS3.customerPrefix("../etc", "starter-storage"), "path-traversal webAccountName is refused, not sanitized-and-allowed");
  throws(() => storageS3.customerPrefix("WA-1/../WA-2", "starter-storage"), "slash-containing webAccountName is refused");
  throws(() => storageS3.customerPrefix("", "starter-storage"), "empty webAccountName is refused");
  throws(() => storageS3.customerPrefix("WA-1", ""), "empty serviceId is refused");
}

console.log("# sanitizeFileName — flat namespace, no traversal");
{
  ok(storageS3.sanitizeFileName("report.pdf") === "report.pdf", "plain filename accepted");
  ok(storageS3.sanitizeFileName("  spaced name.txt  ") === "spaced name.txt", "trims surrounding whitespace");
  ok(storageS3.sanitizeFileName("a/b.txt") === null, "forward slash refused (no nested paths)");
  ok(storageS3.sanitizeFileName("a\\b.txt") === null, "backslash refused");
  ok(storageS3.sanitizeFileName("..") === null, "bare .. refused");
  ok(storageS3.sanitizeFileName("") === null, "empty name refused");
  ok(storageS3.sanitizeFileName("x".repeat(300)) === null, "over-long name refused");
}

console.log("# keyBelongsToPrefix — the ownership boundary");
{
  const prefix = "WA-1/starter-storage/";
  ok(storageS3.keyBelongsToPrefix(prefix + "report.pdf", prefix) === true, "own key inside prefix");
  ok(storageS3.keyBelongsToPrefix("WA-2/starter-storage/report.pdf", prefix) === false, "another tenant's key rejected");
  ok(storageS3.keyBelongsToPrefix(prefix, prefix) === false, "the bare prefix itself is not a file");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/storageS3.test.js`
Expected: `Cannot find module '../services/storage/storageS3'`.

- [ ] **Step 3: Implement**

Create `backend/services/storageEligibility.js`:

```js
/**
 * File Storage browser — master kill switch, mirroring RESOURCE_ADMIN_ENABLED
 * and TERMINAL_ENABLED. Defaults to OFF so the feature stays hidden until the
 * shared MinIO bucket and STORAGE_S3_* credentials are actually live.
 */
function isStorageBrowserEnabled() {
  return String(process.env.STORAGE_BROWSER_ENABLED || "false").toLowerCase() === "true";
}

module.exports = { isStorageBrowserEnabled };
```

Create `backend/services/storage/storageS3.js`:

```js
/**
 * File Storage product — thin wrapper around the shared S3 client, scoped to
 * the STORAGE_S3_* env vars (a separate shared MinIO bucket from terminal
 * recordings' TERMINAL_S3_*). One bucket, every File Storage customer,
 * isolated by key-prefix. See
 * docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
 */
const s3 = require("../terminal/s3Client");

function cfg() {
  return {
    endpoint: process.env.STORAGE_S3_ENDPOINT,
    bucket: process.env.STORAGE_S3_BUCKET,
    region: process.env.STORAGE_S3_REGION || "us-east-1",
    accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
  };
}

function isConfigured() {
  const c = cfg();
  return !!(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
}

// Strict allowlist — an id that fails this is REFUSED, never mangled into a
// prefix that might collide with another tenant's.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function customerPrefix(webAccountName, serviceId) {
  const wa = String(webAccountName || "");
  const sid = String(serviceId || "");
  if (!SAFE_SEGMENT_RE.test(wa) || !SAFE_SEGMENT_RE.test(sid)) {
    throw new Error("Invalid account/service identifier for storage prefix.");
  }
  return `${wa}/${sid}/`;
}

// Flat namespace only (no nested "folders" — see design doc's out-of-scope
// list): a name containing any path separator is refused outright.
function sanitizeFileName(name) {
  const n = String(name || "").trim();
  if (!n || n === "." || n === ".." || /[\\/]/.test(n) || n.length > 255) return null;
  return n;
}

/** True only for a key that is genuinely inside this customer's own prefix — the ownership boundary for every file operation. */
function keyBelongsToPrefix(key, prefix) {
  return typeof key === "string" && key.startsWith(prefix) && key !== prefix;
}

async function listFiles(prefix) {
  const items = await s3.listObjectsV2(prefix, cfg());
  return items
    .filter((i) => keyBelongsToPrefix(i.key, prefix))
    .map((i) => ({ key: i.key, name: i.key.slice(prefix.length), size: i.size, lastModified: i.lastModified }));
}

async function usedBytes(prefix) {
  const files = await listFiles(prefix);
  return files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
}

function presignUpload(key, expiresSeconds = 300) {
  return s3.presignPutUrl(key, { ...cfg(), expiresSeconds });
}

function presignDownload(key, expiresSeconds = 300) {
  return s3.presignGetUrl(key, { ...cfg(), expiresSeconds });
}

async function deleteFile(key) {
  return s3.deleteObject(key, cfg());
}

module.exports = {
  isConfigured,
  customerPrefix,
  sanitizeFileName,
  keyBelongsToPrefix,
  listFiles,
  usedBytes,
  presignUpload,
  presignDownload,
  deleteFile,
};
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/storageS3.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Add to the root test script**

In `backend/package.json`, insert `node test/storageS3.test.js` into the `"test"` chain, right after
`node test/s3Client.test.js`.

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/services/storage/storageS3.js backend/services/storageEligibility.js backend/test/storageS3.test.js backend/package.json
git commit -m "feat: add storage-product S3 wrapper with customer prefix isolation"
```

---

### Task 3: Zero-infra provisioning lane + catalog routing

**Files:**
- Create: `backend/services/provisioning/lanes/objectStorage.js`
- Modify: `backend/services/provisioning/catalog.js`
- Modify: `backend/services/provisioning/runner.js`
- Modify: `frontend/src/config/serviceCatalog.ts` (`starter-storage` entry)
- Modify: `backend/data/serviceCatalogSnapshot.json` (regenerated, not hand-edited)
- Test: `backend/test/provisioning.test.js` (extend existing file)

**Interfaces:**
- Consumes: `storageS3.isConfigured/customerPrefix` from Task 2.
- Produces: lane module shaped like `bench.js`/`mock.js` — `{ lane: "objectStorage", isConfigured(opts),
  configError(opts), provision(job, opts) }`, `provision()` resolving `{externalRef, access, log}`.

- [ ] **Step 1: Write the failing test**

In `backend/test/provisioning.test.js`, find the existing `laneFor` assertions (around the lines
containing `"volume web -> coolify lane"`) and add, in the same section:

```js
  ok(catalog.laneFor(catalog.getServiceMeta("starter-storage")) === "objectStorage", "File Storage -> objectStorage lane, not coolify (no fake container)");
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/provisioning.test.js`
Expected: FAIL — `starter-storage` still resolves to `"coolify"`.

- [ ] **Step 3: Implement — catalog routing**

In `backend/services/provisioning/catalog.js`, modify `laneFor`:

```js
function laneFor(meta) {
  if (!meta) return "manual";
  if (meta.capacityClass === "dedicated") return "manual";
  if (meta.capacityClass === "premium") return "bench";
  if (meta.capacityClass === "scalable") return "k8s";
  if (meta.category === "Domain Registration") return "manual";
  // File Storage is a shared MinIO bucket, not a per-purchase container — see
  // docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
  // Routed explicitly (not via the ramMb/diskGb zero-footprint fallback below)
  // because this product DOES consume real shared disk, just not a container.
  if (meta.category === "Storage") return "objectStorage";
  if (!(Number(meta.ramMb) > 0) && !(Number(meta.diskGb) > 0)) return "manual";
  return "coolify";
}
```

- [ ] **Step 4: Implement — the lane module**

Create `backend/services/provisioning/lanes/objectStorage.js`:

```js
/**
 * Lane — Object Storage (the "Storage" category). Unlike coolify/bench/k8s,
 * there is no infrastructure to build per purchase: the bucket is one fixed
 * platform resource every File Storage customer shares, isolated by
 * key-prefix. provision() marks the job active immediately.
 *
 * Required env (via storageS3.js): STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET,
 * STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY.
 *
 * See docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
 */
const storageS3 = require("../../storage/storageS3");

function isConfigured() {
  return storageS3.isConfigured();
}

function configError() {
  if (isConfigured()) return null;
  return "Object storage lane not configured (missing: STORAGE_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY)";
}

async function provision(job) {
  const prefix = storageS3.customerPrefix(job.web_account, job.service_id);
  return {
    externalRef: prefix,
    access: { lane: "objectStorage", prefix },
    log: `[objectStorage] activated shared-bucket prefix "${prefix}" — no container created.`,
  };
}

module.exports = { lane: "objectStorage", isConfigured, configError, provision };
```

- [ ] **Step 5: Wire the lane into the runner**

In `backend/services/provisioning/runner.js`, add the require near the other lane requires:

```js
const objectStorage = require("./lanes/objectStorage");
```

And update `DEFAULT_LANES` — the mock substitution stays limited to the three lanes that make real
external calls (coolify/bench/k8s); `objectStorage.provision()` makes no network call itself, so it's
safe to run for real even under `MOCK_PROVISIONING=true` (it will still correctly escalate to
`needs_human` via `configError()` if `STORAGE_S3_*` isn't set in that test environment, which is the
existing, desired "never fake a build" behavior):

```js
const DEFAULT_LANES = mock.isEnabled()
  ? { coolify: mock, bench: mock, k8s: mock, objectStorage }
  : { coolify, bench, k8s, objectStorage };
```

- [ ] **Step 6: Drop the phantom RAM footprint in the catalog**

In `frontend/src/config/serviceCatalog.ts`, find the `starter-storage` entry (`id: "starter-storage"`)
and change its `resources` line from:

```ts
      resources: { ramMb: 256, diskGb: 25 },
```

to:

```ts
      resources: { ramMb: 0, diskGb: 25 },
```

(Leave `specs.ram: "Shared"` and every other display field untouched — this only changes the
provisioning-internal footprint used to size a container that no longer exists.)

- [ ] **Step 7: Regenerate the backend catalog snapshot**

Run: `cd backend && npm run gen:catalog`
Expected output: `Wrote N services to backend/data/serviceCatalogSnapshot.json` (N unchanged from
before). Confirm the change landed:

Run: `node -e "console.log(require('./backend/data/serviceCatalogSnapshot.json').items['starter-storage'])"`
Expected: `ramMb: 0, diskGb: 25` in the printed object.

- [ ] **Step 8: Run the provisioning test again to confirm it passes**

Run: `cd backend && node test/provisioning.test.js`
Expected: PASS, including the new `objectStorage` lane assertion.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all green. (`catalogSnapshot.test.js`'s `starter-storage` check only asserts
`category !== "Domain Registration"`, which is unaffected.)

- [ ] **Step 10: Commit**

```bash
git add backend/services/provisioning/lanes/objectStorage.js backend/services/provisioning/catalog.js backend/services/provisioning/runner.js frontend/src/config/serviceCatalog.ts backend/data/serviceCatalogSnapshot.json backend/test/provisioning.test.js
git commit -m "feat: route File Storage to a zero-infra object-storage lane instead of a fake container"
```

---

### Task 4: Backend file routes (list, upload-url, download-url, delete)

**Files:**
- Modify: `backend/routes/portalRoutes.js`
- Test: `backend/test/storageFilesRoutes.test.js` (new)

**Interfaces:**
- Consumes: `storageS3` and `storageEligibility` from Task 2; `getServiceMeta` from
  `services/provisioning/catalog.js`; the existing `loadOwnedJob(client, webAccountName, serviceId)`
  helper already defined in `portalRoutes.js` (around line 800).
- Produces: `GET /api/portal/services/:serviceId/files` → `{ok, enabled, files, usedBytes,
  quotaBytes}`. `POST /api/portal/services/:serviceId/files/upload-url` body `{fileName, sizeBytes}` →
  `{ok, uploadUrl, key}`. `GET /api/portal/services/:serviceId/files/download-url?name=...` →
  `{ok, downloadUrl}`. `DELETE /api/portal/services/:serviceId/files?name=...` → `{ok, message}`.

This codebase has no Express test harness (per `resourceAdmin.test.js`'s header comment: "Pure
functions + scripted HTTP clients, no Express harness"). Route logic is written as small, directly
testable pure/async helper functions inside `portalRoutes.js` (`loadStorageContext`,
`quotaCheck`), and the test file exercises those helpers directly plus `storageS3.sanitizeFileName`'s
integration with them — mirroring how `resourceAdmin.test.js` tests `resourceAdminEligibility.js`'s
gate functions rather than firing real HTTP requests.

- [ ] **Step 1: Write the failing test**

Create `backend/test/storageFilesRoutes.test.js`:

```js
/**
 * File Storage routes — the quota-headroom check and filename/prefix safety
 * that gate every upload. Pure functions, no Express harness (this codebase
 * has none — see resourceAdmin.test.js). node test/storageFilesRoutes.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { hasQuotaHeadroom } = require("../services/storage/quota");

console.log("# hasQuotaHeadroom — reject only when usage + incoming exceeds quota");
{
  ok(hasQuotaHeadroom({ usedBytes: 0, incomingBytes: 100, quotaBytes: 1000 }) === true, "well under quota");
  ok(hasQuotaHeadroom({ usedBytes: 900, incomingBytes: 100, quotaBytes: 1000 }) === true, "exactly at quota is allowed");
  ok(hasQuotaHeadroom({ usedBytes: 900, incomingBytes: 101, quotaBytes: 1000 }) === false, "one byte over quota is refused");
  ok(hasQuotaHeadroom({ usedBytes: 0, incomingBytes: 0, quotaBytes: 0 }) === false, "a zero quota (unknown product) never allows an upload");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && node test/storageFilesRoutes.test.js`
Expected: `Cannot find module '../services/storage/quota'`.

- [ ] **Step 3: Implement the quota helper**

Create `backend/services/storage/quota.js`:

```js
/** Pure quota-headroom check, split out of the routes so it's independently testable. */
function hasQuotaHeadroom({ usedBytes, incomingBytes, quotaBytes }) {
  if (!(Number(quotaBytes) > 0)) return false;
  return Number(usedBytes) + Number(incomingBytes) <= Number(quotaBytes);
}

module.exports = { hasQuotaHeadroom };
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cd backend && node test/storageFilesRoutes.test.js`
Expected: `ALL GREEN`.

- [ ] **Step 5: Implement the routes**

In `backend/routes/portalRoutes.js`, add three requires near the top with the other lib requires
(after the `resourceAdminEligibilityLib` line):

```js
const storageS3Lib = require('../services/storage/storageS3');
const storageEligibilityLib = require('../services/storageEligibility');
const storageQuotaLib = require('../services/storage/quota');
const { getServiceMeta } = require('../services/provisioning/catalog');
```

Then, right after the existing `runtimeLogsLimiter` definition (after the resource-admin block, before
the `--- DEVELOPER TERMINAL ACCESS` section — or anywhere else at module scope in the file, since only
`ctx`-scoped names matter for placement), add:

```js
const storageFilesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

/**
 * Shared context for every File Storage route: kill switch → session →
 * ownership (must be an active "Storage" category job) → storage backend
 * actually configured. Returns `{disabled: true}` when the kill switch is
 * off (never an error — the frontend hides the panel silently), `null` after
 * already sending an error response, or `{webAccountName, job, prefix,
 * quotaBytes}` on success.
 */
async function loadStorageContext(req, res) {
  if (!storageEligibilityLib.isStorageBrowserEnabled()) {
    return { disabled: true };
  }
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  if (!webAccountName) {
    res.status(401).json({ error: "No session account." });
    return null;
  }
  const { serviceId } = req.params;
  if (!serviceId) {
    res.status(400).json({ error: "Missing serviceId." });
    return null;
  }
  let job;
  try {
    job = await loadOwnedJob(frappeClient(), webAccountName, serviceId);
  } catch (err) {
    console.error("STORAGE FILES LOOKUP ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to look up this service." });
    return null;
  }
  // Deliberately indistinguishable from "not yours": a wrong-owner probe and a
  // wrong-category service must not be tellable apart from the outside.
  if (!job || job.category !== "Storage") {
    res.status(404).json({ error: "File storage isn't available for this service." });
    return null;
  }
  if (job.status !== "active") {
    res.status(409).json({ error: "This service isn't live yet." });
    return null;
  }
  if (!storageS3Lib.isConfigured()) {
    res.status(503).json({ error: "File storage isn't available right now. Please try again shortly." });
    return null;
  }
  const meta = getServiceMeta(serviceId);
  const quotaBytes = Math.max(0, Number(meta?.diskGb) || 0) * 1024 * 1024 * 1024;
  const prefix = storageS3Lib.customerPrefix(webAccountName, serviceId);
  return { webAccountName, job, prefix, quotaBytes };
}

// --- File Storage: list, upload, download, delete ---
// No resource-admin gating (RESOURCE_ADMIN_ENABLED/plan/approval/disclosure):
// browsing your own storage bucket is ordinary product usage for a Light-tier
// product, not the risky "can break your live service" territory env
// vars/logs sit in. Gated only by STORAGE_BROWSER_ENABLED (infra readiness)
// and plain ownership.

router.get("/api/portal/services/:serviceId/files", requireAuth, async (req, res) => {
  const ctx = await loadStorageContext(req, res);
  if (ctx === null) return;
  if (ctx.disabled) return res.json({ ok: true, enabled: false, files: [], usedBytes: 0, quotaBytes: 0 });
  try {
    const files = await storageS3Lib.listFiles(ctx.prefix);
    const usedBytes = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    return res.json({ ok: true, enabled: true, files, usedBytes, quotaBytes: ctx.quotaBytes });
  } catch (err) {
    console.error("STORAGE FILES LIST ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Couldn't load your files. Please try again." });
  }
});

router.post("/api/portal/services/:serviceId/files/upload-url", requireAuth, storageFilesLimiter, async (req, res) => {
  const ctx = await loadStorageContext(req, res);
  if (ctx === null) return;
  if (ctx.disabled) return res.status(503).json({ error: "File storage isn't available yet." });

  const safeName = storageS3Lib.sanitizeFileName(req.body?.fileName);
  if (!safeName) return res.status(400).json({ error: "Invalid file name." });
  const sizeBytes = Number(req.body?.sizeBytes);
  if (!(sizeBytes > 0)) return res.status(400).json({ error: "Invalid file size." });

  try {
    const usedBytes = await storageS3Lib.usedBytes(ctx.prefix);
    if (!storageQuotaLib.hasQuotaHeadroom({ usedBytes, incomingBytes: sizeBytes, quotaBytes: ctx.quotaBytes })) {
      const usedGb = (usedBytes / (1024 * 1024 * 1024)).toFixed(1);
      const quotaGb = (ctx.quotaBytes / (1024 * 1024 * 1024)).toFixed(0);
      return res.status(409).json({ error: `This would exceed your storage limit (${usedGb}GB of ${quotaGb}GB used).` });
    }
    const key = ctx.prefix + safeName;
    const uploadUrl = storageS3Lib.presignUpload(key);
    return res.json({ ok: true, uploadUrl, key: safeName });
  } catch (err) {
    console.error("STORAGE UPLOAD-URL ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Couldn't prepare that upload. Please try again." });
  }
});

router.get("/api/portal/services/:serviceId/files/download-url", requireAuth, async (req, res) => {
  const ctx = await loadStorageContext(req, res);
  if (ctx === null) return;
  if (ctx.disabled) return res.status(503).json({ error: "File storage isn't available yet." });

  const safeName = storageS3Lib.sanitizeFileName(req.query?.name);
  if (!safeName) return res.status(400).json({ error: "Invalid file name." });

  try {
    const key = ctx.prefix + safeName;
    const downloadUrl = storageS3Lib.presignDownload(key);
    return res.json({ ok: true, downloadUrl });
  } catch (err) {
    console.error("STORAGE DOWNLOAD-URL ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Couldn't prepare that download. Please try again." });
  }
});

router.delete("/api/portal/services/:serviceId/files", requireAuth, storageFilesLimiter, async (req, res) => {
  const ctx = await loadStorageContext(req, res);
  if (ctx === null) return;
  if (ctx.disabled) return res.status(503).json({ error: "File storage isn't available yet." });

  const safeName = storageS3Lib.sanitizeFileName(req.query?.name);
  if (!safeName) return res.status(400).json({ error: "Invalid file name." });

  try {
    const key = ctx.prefix + safeName;
    await storageS3Lib.deleteFile(key);
    return res.json({ ok: true, message: `${safeName} deleted.` });
  } catch (err) {
    console.error("STORAGE DELETE ERROR:", err.response?.data || err.message);
    return res.status(502).json({ error: "Couldn't delete that file. Please try again." });
  }
});
```

- [ ] **Step 6: Add the new test to the root test script**

In `backend/package.json`, insert `node test/storageFilesRoutes.test.js` into the `"test"` chain,
right after `node test/storageS3.test.js`.

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/portalRoutes.js backend/services/storage/quota.js backend/test/storageFilesRoutes.test.js backend/package.json
git commit -m "feat: add File Storage list/upload/download/delete routes"
```

---

### Task 5: Frontend service layer + file browser component

**Files:**
- Create: `frontend/src/services/storageFiles.ts`
- Create: `frontend/src/components/portal/cloud/StorageFileBrowser.tsx`

**Interfaces:**
- Consumes: the four routes from Task 4.
- Produces: `<StorageFileBrowser serviceId={string} isActive={boolean} />`, a self-contained panel
  matching `ResourceAdminPanel`'s visual language, that renders nothing when the service isn't active
  or the backend reports `enabled: false`.

- [ ] **Step 1: Create the service layer**

Create `frontend/src/services/storageFiles.ts`:

```ts
/**
 * File Storage API client — list/upload/download/delete for a customer's
 * shared-bucket, prefix-isolated storage. Uploads/downloads use presigned
 * URLs: this client fetches the URL, then talks to MinIO directly — file
 * bytes never pass through our own server.
 */

export interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
}

export interface StorageFilesResponse {
  enabled: boolean;
  files: StorageFile[];
  usedBytes: number;
  quotaBytes: number;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Request failed.");
  return data as T;
}

const JSON_POST = {
  headers: { "Content-Type": "application/json" },
  credentials: "include" as const,
};

export async function fetchStorageFiles(serviceId: string): Promise<StorageFilesResponse> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/files`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true } & StorageFilesResponse>(res);
  return {
    enabled: !!data.enabled,
    files: data.files || [],
    usedBytes: Number(data.usedBytes) || 0,
    quotaBytes: Number(data.quotaBytes) || 0,
  };
}

export async function requestUploadUrl(
  serviceId: string,
  input: { fileName: string; sizeBytes: number }
): Promise<{ uploadUrl: string; key: string }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/files/upload-url`, {
    method: "POST",
    ...JSON_POST,
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

/** PUTs straight to the presigned MinIO URL — no credentials, no Content-Type games, just the bytes. */
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
}

export async function requestDownloadUrl(serviceId: string, name: string): Promise<{ downloadUrl: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/files/download-url?name=${encodeURIComponent(name)}`,
    { credentials: "include" }
  );
  return handleJson(res);
}

export async function deleteStorageFile(serviceId: string, name: string): Promise<{ message: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/files?name=${encodeURIComponent(name)}`,
    { method: "DELETE", credentials: "include" }
  );
  return handleJson(res);
}
```

- [ ] **Step 2: Create the component**

Create `frontend/src/components/portal/cloud/StorageFileBrowser.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, Upload, Download, Trash2, RefreshCw } from "lucide-react";
import {
  fetchStorageFiles,
  requestUploadUrl,
  uploadToPresignedUrl,
  requestDownloadUrl,
  deleteStorageFile,
  StorageFile,
} from "../../../services/storageFiles";

interface StorageFileBrowserProps {
  serviceId: string;
  isActive: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * File browser for the "File Storage" product — a shared-bucket, per-customer
 * prefix. Renders nothing until the backend confirms the feature is enabled
 * (STORAGE_BROWSER_ENABLED), so an unconfigured deploy shows no broken tab.
 */
const StorageFileBrowser: React.FC<StorageFileBrowserProps> = ({ serviceId, isActive }) => {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchStorageFiles(serviceId)
      .then((data) => {
        setEnabled(data.enabled);
        setFiles(data.files);
        setUsedBytes(data.usedBytes);
        setQuotaBytes(data.quotaBytes);
      })
      .catch((e: any) => setError(e?.message || "Couldn't load your files."))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!isActive || loading || !enabled) return null;

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const { uploadUrl } = await requestUploadUrl(serviceId, { fileName: file.name, sizeBytes: file.size });
      await uploadToPresignedUrl(uploadUrl, file);
      setNotice(`${file.name} uploaded.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: StorageFile) => {
    setBusyName(file.name);
    setError("");
    try {
      const { downloadUrl } = await requestDownloadUrl(serviceId, file.name);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e?.message || "Couldn't prepare that download.");
    } finally {
      setBusyName(null);
    }
  };

  const handleDelete = async (file: StorageFile) => {
    if (!window.confirm(`Delete ${file.name}? This can't be undone.`)) return;
    setBusyName(file.name);
    setError("");
    try {
      await deleteStorageFile(serviceId, file.name);
      setNotice(`${file.name} deleted.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete that file.");
    } finally {
      setBusyName(null);
    }
  };

  const usedPct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-murzak-accent" />
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Your Files</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-micro font-bold text-slate-500 mb-1">
          <span>{formatBytes(usedBytes)} used</span>
          <span>{formatBytes(quotaBytes)} total</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
          <div
            className={`h-full rounded-full ${usedPct > 90 ? "bg-red-500" : "bg-murzak-accent"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {error && <p className="text-label font-bold text-red-500 mb-3">{error}</p>}
      {notice && <p className="text-label font-bold text-emerald-600 dark:text-emerald-400 mb-3">{notice}</p>}

      {files.length === 0 ? (
        <p className="text-label font-medium text-slate-500 mb-4">No files uploaded yet.</p>
      ) : (
        <div className="space-y-1.5 mb-4">
          {files.map((file) => (
            <div
              key={file.key}
              className="flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-murzak-border px-3 py-2"
            >
              <span className="text-label font-bold text-slate-700 dark:text-slate-300 truncate flex-1">{file.name}</span>
              <span className="text-micro font-medium text-slate-400 shrink-0">{formatBytes(file.size)}</span>
              <span className="text-micro font-medium text-slate-400 shrink-0 hidden sm:inline">{formatDate(file.lastModified)}</span>
              <button
                type="button"
                onClick={() => handleDownload(file)}
                disabled={busyName === file.name}
                className="text-slate-400 hover:text-murzak-accent transition shrink-0 disabled:opacity-50"
                aria-label={`Download ${file.name}`}
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(file)}
                disabled={busyName === file.name}
                className="text-slate-400 hover:text-red-500 transition shrink-0 disabled:opacity-50"
                aria-label={`Delete ${file.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
      <button
        type="button"
        onClick={handleUploadClick}
        disabled={uploading}
        className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60 inline-flex items-center gap-1"
      >
        <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : "Upload file"}
      </button>
    </div>
  );
};

export default StorageFileBrowser;
```

- [ ] **Step 3: Type-check the new files**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors attributable to `storageFiles.ts` or `StorageFileBrowser.tsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/storageFiles.ts frontend/src/components/portal/cloud/StorageFileBrowser.tsx
git commit -m "feat: add File Storage frontend service client and browser component"
```

---

### Task 6: Wire the file browser into the resource page, hide the inapplicable panels

**Files:**
- Modify: `frontend/src/pages/portal/tabs/ResourceDetail.tsx`

**Interfaces:**
- Consumes: `StorageFileBrowser` from Task 5.

- [ ] **Step 1: Add the import**

In `frontend/src/pages/portal/tabs/ResourceDetail.tsx`, add near the other component imports (after
the `ResourceAdminPanel` import):

```tsx
import StorageFileBrowser from "../../../components/portal/cloud/StorageFileBrowser";
```

- [ ] **Step 2: Branch the Settings pane by category**

Replace the existing settings-pane block (the one starting `{pane === "settings" && (` and containing
`<ResourceAdminPanel`, `<DeveloperTerminalPanel`, and the "Connect your domain" form) with:

```tsx
      {pane === "settings" && (
        <>
            {svc?.category === "Storage" ? (
              <StorageFileBrowser serviceId={cloudServiceId} isActive={isActive} />
            ) : (
              <>
                <ResourceAdminPanel
                  serviceId={cloudServiceId}
                  serviceName={svc?.name || cloudServiceId}
                  isActive={isActive}
                  onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
                  onAdminActiveChange={setResourceAdminActive}
                />

                <DeveloperTerminalPanel
                  serviceId={cloudServiceId}
                  isActive={isActive}
                  onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
                />

                {isActive && (
                  <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
                    <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mb-1">Connect your domain</p>
                    <p className="text-label font-medium text-slate-600 dark:text-slate-400 mb-4">
                      Own a domain already? Point an A record at our server, then connect it here — SSL is issued automatically.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="shop.yourbusiness.co.ke"
                        className="flex-1 rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5 px-4 py-2.5 text-[12px] font-bold text-murzak-ink dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                      />
                      <button
                        onClick={submitDomainAttach}
                        disabled={domainSubmitting || !domainInput.trim()}
                        className="px-5 py-2.5 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        {domainSubmitting ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                    {domainResult && (
                      <p className={`mt-3 text-label font-bold ${domainResult.type === "success" ? "text-emerald-500" : "text-red-500"}`}>
                        {domainResult.text}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
        </>
      )}
```

(This is a straight relocation of the existing three blocks into the `else` branch — no behavior
change for any non-Storage resource.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke check in the dev server (regression only — the feature itself stays behind `STORAGE_BROWSER_ENABLED=false`)**

Start the frontend dev server, log into the portal with a test account that has an active non-Storage
resource (e.g. Website Hosting or an app-hosting SKU), open its Resource Detail → Settings tab, and
confirm `ResourceAdminPanel`/`DeveloperTerminalPanel`/domain form still render exactly as before. This
confirms the relocation didn't change behavior for the 99% case that isn't Storage.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/portal/tabs/ResourceDetail.tsx
git commit -m "feat: show the File Storage browser instead of env-var controls for Storage resources"
```

---

### Task 7: Env var documentation

**Files:**
- Modify: `backend/.env.example`

- [ ] **Step 1: Add the kill switch next to RESOURCE_ADMIN_ENABLED**

In `backend/.env.example`, right after the `RESOURCE_ADMIN_ENABLED=false` line (end of the "Customer
resource admin" section), add:

```
# ---- File Storage browser (shared MinIO bucket) ----
# Master gate for the File Storage file browser. Default false — the routes
# report the feature as unavailable (not an error) until this is true AND
# STORAGE_S3_* below is configured. See
# docs/superpowers/specs/2026-08-16-file-storage-object-browser-design.md.
STORAGE_BROWSER_ENABLED=false
```

- [ ] **Step 2: Add the STORAGE_S3_* block next to TERMINAL_S3_***

Right after the `# TERMINAL_S3_SECRET_ACCESS_KEY=` line, before the
`# TERMINAL_RECORDING_ACCESS_EMAILS=` line, add:

```
# ---- File Storage product: shared MinIO bucket ----
# One self-hosted MinIO instance on this box (not per-customer — a fixed
# platform service). Every File Storage customer's files live in ONE bucket
# here, isolated by key-prefix ({webAccountName}/{serviceId}/). Deliberately
# separate credentials/bucket from TERMINAL_S3_* above (different purpose,
# different trust boundary — a customer's own file access must never be able
# to touch terminal recordings, and vice versa).
# STORAGE_S3_ENDPOINT=https://minio.murzaktech.internal
# STORAGE_S3_BUCKET=murzak-customer-files
# STORAGE_S3_REGION=us-east-1
# STORAGE_S3_ACCESS_KEY_ID=
# STORAGE_S3_SECRET_ACCESS_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "docs: document STORAGE_BROWSER_ENABLED and STORAGE_S3_* env vars"
```

---

### Task 8: Full-suite verification

- [ ] **Step 1: Run the complete backend test suite**

Run: `cd backend && npm test`
Expected: `ALL GREEN` (or equivalent zero-`failed` output) from every chained test file, including the
three new ones added in Tasks 1, 2 and 4.

- [ ] **Step 2: Run the frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm the kill switch actually hides the feature end-to-end**

Run: `node -e "process.env.STORAGE_BROWSER_ENABLED=''; console.log(require('./backend/services/storageEligibility').isStorageBrowserEnabled())"`
Expected: `false` — confirms a deploy with no env change at all ships this dark, matching Task 7's
documented default.

No commit for this task — it's verification only, over work already committed in Tasks 1–7.
