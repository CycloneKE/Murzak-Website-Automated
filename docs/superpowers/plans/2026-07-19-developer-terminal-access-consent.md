# Developer Terminal Access — Consent Workflow & Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate developer-access terminal sessions behind staff approval + a one-time customer
disclosure, and give the (not-yet-live) terminal an allocated, non-floating spot in the service
detail page — per `docs/superpowers/specs/2026-07-19-developer-terminal-access-design.md`.

**Architecture:** Three new Web Account fields (`terminal_access_approved_at/_by`,
`terminal_disclosure_accepted_at`) checked server-side at two new endpoints (`eligibility`,
`accept-disclosure`) and inside the existing mint endpoint. Staff approve via a new AdminInbox
button. The frontend panel reads eligibility and renders one of four states inline in the
service detail page. All gate logic is extracted into small, independently unit-tested pure
functions — no Express test harness exists in this codebase, so route handlers stay thin wrappers
around tested logic rather than being tested themselves (matches this codebase's established
precedent).

**Tech Stack:** Express (backend/routes), Frappe REST (frappeClient), React + TypeScript
(frontend), Node's built-in `assert`-free `ok()`-style test runner (see `backend/test/*.test.js`).

## Global Constraints

- Never trust a client-supplied plan/approval/disclosure claim — every gate is re-checked
  server-side from the Frappe record, never from `req.body` or a cached session field alone.
- No new Express test harness — extract pure logic into `backend/services/*.js` modules and unit
  test those; route handlers stay thin.
- New backend test files must be added to `backend/package.json`'s `test` script explicitly (it's
  a fixed `&&`-chained list, not auto-discovered).
- Match existing code style exactly: `router.get/post(path, requireAuth, ..., async (req, res) => {...})`
  with try/catch returning `{ error: "..." }` on failure, console.error-prefixed logs
  (`"THING ERROR:", err.response?.data || err.message`).
- Frontend: Tailwind classes matching existing `murzak-*` tokens, no new dependencies.

---

## Task 1: Fix the `subject` passthrough bug in `POST /api/portal/requests`

`Portal.tsx:255`'s `handleDeveloperUpsell` sends `subject: "Developer Access Request: {svcName}"`
in its request body — but `backend/routes/portalRoutes.js`'s handler never reads `subject` from
`req.body` and hardcodes `subject: "Technical Sync Request"` unconditionally (verified: every
ticket created via this endpoint today has that exact same subject in Frappe, regardless of what
the frontend sends). This must be fixed first — Task 6's admin approve button depends on being
able to identify a developer-access-request thread by its subject.

**Files:**
- Create: `backend/services/portalRequestPayload.js`
- Create: `backend/test/terminalAccessGates.test.js` (this task's tests; Tasks 3/4 add to the
  same file)
- Modify: `backend/routes/portalRoutes.js:99-146`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `buildPortalRequestPayload({ portalUserId, email, webAcc, subject, message, pageUrl, attachments, nowUTC }) -> object` (the exact Frappe `Portal Users Requests` doc payload)

- [ ] **Step 1: Write the failing test**

Create `backend/test/terminalAccessGates.test.js`:

```js
/**
 * Terminal access gating + the subject-passthrough fix — pure-function unit
 * tests, no network/Express (see backend/services/portalRequestPayload.js
 * and backend/services/terminalEligibility.js). node test/terminalAccessGates.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { buildPortalRequestPayload } = require("../services/portalRequestPayload");

console.log("# portal request payload — subject passthrough");
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-1",
    email: "jane@example.com",
    webAcc: { account_holder_name: "Jane", entity_name: "Jane Co" },
    subject: "Developer Access Request: App Hosting",
    message: "please upgrade",
    pageUrl: "https://x/portal",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Developer Access Request: App Hosting", "custom subject is used verbatim (the bug this fixes)");
  ok(p.portal_user === "WA-1" && p.email === "jane@example.com", "identity fields carried through");
  ok(p.messages[0].message === "please upgrade", "first message embedded correctly");
  ok(p.last_message_at === "2026-07-19 12:00:00", "nowUTC passed through verbatim");
}
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-2",
    email: "bob@example.com",
    webAcc: null,
    subject: undefined,
    message: "hi",
    pageUrl: "",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Technical Sync Request", "no subject supplied -> existing default preserved (Contact.tsx callers unaffected)");
  ok(p.full_name === "bob@example.com", "no webAcc -> falls back to email for full_name");
}
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-3",
    email: "x@example.com",
    webAcc: {},
    subject: "   ",
    message: "hi",
    pageUrl: "",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Technical Sync Request", "whitespace-only subject treated as absent");
}

console.log(`\n${"=".repeat(48)}`);
console.log(`TERMINAL ACCESS GATES TESTS: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failed."); process.exit(1); }
console.log("ALL GREEN");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node test/terminalAccessGates.test.js`
Expected: `Cannot find module '../services/portalRequestPayload'`

- [ ] **Step 3: Write the pure payload-builder module**

Create `backend/services/portalRequestPayload.js`:

```js
/**
 * Pure builder for the Portal Users Requests doc payload. Extracted from
 * routes/portalRoutes.js's POST /api/portal/requests so the subject-
 * passthrough logic is unit-testable without an Express harness (which
 * this codebase doesn't have). `nowUTC` is passed in (from the caller's
 * mysqlDatetimeUTC(), a ctx-injected function) rather than computed here,
 * so this module stays a pure function of its inputs.
 */
function buildPortalRequestPayload({ portalUserId, email, webAcc, subject, message, pageUrl, attachments, nowUTC }) {
  const cleanSubject = (subject && String(subject).trim()) || "";
  return {
    portal_user: portalUserId,
    email,
    full_name: webAcc?.account_holder_name || email,
    company_name: webAcc?.entity_name || "",
    subject: cleanSubject || "Technical Sync Request",
    status: "New",
    source: "Portal",
    last_message_at: nowUTC,
    page_url: pageUrl || "",
    messages: [{
      sender_type: "User",
      sender: email,
      message,
      attachments: attachments || "",
    }],
  };
}

module.exports = { buildPortalRequestPayload };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node test/terminalAccessGates.test.js`
Expected: `TERMINAL ACCESS GATES TESTS: 7 passed, 0 failed` / `ALL GREEN`

- [ ] **Step 5: Wire the real route to use it**

In `backend/routes/portalRoutes.js`, find the `POST /api/portal/requests` handler
(currently lines ~100-146) and replace the body-destructure + payload block:

```js
// BEFORE:
    const {
      message,
      pageUrl,
      attachments
    } = req.body;

    // Identity comes from the session, never the request body.
    const email = String(req.session?.user?.email || "").trim();
    if (!email || !message) {
      return res.status(400).json({
        error: "Missing required fields."
      });
    }
    const client = frappeClient();
    const webAcc = await getWebAccountByEmail(client, email);
    const portalUserId = webAcc?.name || null;
    const payload = {
      portal_user: portalUserId,
      email: email,
      full_name: webAcc?.account_holder_name || email,
      company_name: webAcc?.entity_name || "",
      subject: "Technical Sync Request",
      status: "New",
      source: "Portal",
      last_message_at: mysqlDatetimeUTC(),
      page_url: pageUrl || "",
      messages: [{
        sender_type: "User",
        sender: email,
        message: message,
        attachments: attachments || ""
      }]
    };
```

```js
// AFTER:
    const {
      message,
      pageUrl,
      attachments,
      subject
    } = req.body;

    // Identity comes from the session, never the request body.
    const email = String(req.session?.user?.email || "").trim();
    if (!email || !message) {
      return res.status(400).json({
        error: "Missing required fields."
      });
    }
    const client = frappeClient();
    const webAcc = await getWebAccountByEmail(client, email);
    const portalUserId = webAcc?.name || null;
    const payload = buildPortalRequestPayload({
      portalUserId,
      email,
      webAcc,
      subject,
      message,
      pageUrl,
      attachments,
      nowUTC: mysqlDatetimeUTC(),
    });
```

Add the require near the top of the file, alongside the other non-ctx requires (right after the
existing `const coolifyLane = require(...)` / `const deploymentHistory = require(...)` lines,
still before the `module.exports = function(ctx) {` line so it doesn't disturb the
`routesContext.test.js` static guard):

```js
const portalRequestPayloadLib = require('../services/portalRequestPayload');
```

Then inside `module.exports = function(ctx) { ... }`, right after the existing `const router = express.Router();` line, add:

```js
  const { buildPortalRequestPayload } = portalRequestPayloadLib;
```

(Requiring the module outside the ctx-destructure block and only pulling the named function
inside keeps the single `const { ... } = ctx;` pattern the static guard matches untouched.)

- [ ] **Step 6: Syntax-check and run full suite**

Run:
```bash
cd backend
node --check routes/portalRoutes.js
node --check services/portalRequestPayload.js
```
Expected: no output (success) from both.

- [ ] **Step 7: Add the new test file to package.json's test chain**

In `backend/package.json`, find the `"test"` script (a single `&&`-chained string) and append
`&& node test/terminalAccessGates.test.js` at the end.

Run: `cd backend && npm test 2>&1 | tail -15`
Expected: all existing suites still green, plus `TERMINAL ACCESS GATES TESTS: 7 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add backend/services/portalRequestPayload.js backend/test/terminalAccessGates.test.js backend/routes/portalRoutes.js backend/package.json
git commit -m "fix: honor the client-supplied subject in POST /api/portal/requests

handleDeveloperUpsell (Portal.tsx:255) sends subject: 'Developer
Access Request: {svc}' but the backend never read it from req.body
and hardcoded 'Technical Sync Request' for every ticket regardless.
Extracted the payload-building into a pure, unit-tested function
(portalRequestPayload.js) so this stays covered without an Express
harness. Prerequisite for the AdminInbox approve button (Task 6),
which identifies developer-access requests by this exact subject."
```

---

## Task 2: Frappe custom fields — approval + disclosure timestamps

**Files:**
- Modify: `backend/data/custom-fields-web-account.json`

**Interfaces:**
- Produces: three new fields readable via `client.get('/api/resource/Web Account/{id}')` as
  `terminal_access_approved_at`, `terminal_access_approved_by`, `terminal_disclosure_accepted_at`.

- [ ] **Step 1: Add the fields to the existing fixture**

Replace the full contents of `backend/data/custom-fields-web-account.json`:

```json
[
  {
    "doctype": "Custom Field",
    "dt": "Web Account",
    "fieldname": "app_port",
    "label": "App Port",
    "fieldtype": "Int",
    "insert_after": "source_code",
    "description": "BYOA: port the customer's app listens on inside its container (default 3000). Copied onto the Provisioning Job at enqueue, alongside source_code."
  },
  {
    "doctype": "Custom Field",
    "dt": "Web Account",
    "fieldname": "terminal_access_approved_at",
    "label": "Terminal Access Approved At",
    "fieldtype": "Datetime",
    "read_only": 1,
    "insert_after": "app_port",
    "description": "Stamped by staff via the AdminInbox \"Approve Developer Access\" action. Required (alongside terminal_disclosure_accepted_at) before a terminal session can be minted — being on an Enterprise plan alone is not sufficient."
  },
  {
    "doctype": "Custom Field",
    "dt": "Web Account",
    "fieldname": "terminal_access_approved_by",
    "label": "Terminal Access Approved By",
    "fieldtype": "Data",
    "read_only": 1,
    "insert_after": "terminal_access_approved_at",
    "description": "Staff email that approved developer terminal access, for audit."
  },
  {
    "doctype": "Custom Field",
    "dt": "Web Account",
    "fieldname": "terminal_disclosure_accepted_at",
    "label": "Terminal Disclosure Accepted At",
    "fieldtype": "Datetime",
    "read_only": 1,
    "insert_after": "terminal_access_approved_by",
    "description": "Customer's one-time acceptance of the developer-terminal disclosure (network/session-recording notice). Never client-settable except via POST /api/portal/terminal/accept-disclosure, which stamps this from the server clock."
  }
]
```

- [ ] **Step 2: Validate the JSON**

Run: `cd backend && node -e "JSON.parse(require('fs').readFileSync('data/custom-fields-web-account.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/data/custom-fields-web-account.json
git commit -m "feat: add terminal access approval + disclosure fields to Web Account fixture

Three new fields backing the developer-terminal consent workflow:
terminal_access_approved_at/_by (staff-set) and
terminal_disclosure_accepted_at (customer-set, once). Deploying this
against the live Frappe instance needs the same bench import-doc or
Customize Form approach used for app_port earlier — this commit only
updates the repo's fixture."
```

---

## Task 3: Backend `terminalEligibility` service module + tests

**Files:**
- Create: `backend/services/terminalEligibility.js`
- Modify: `backend/test/terminalAccessGates.test.js`

**Interfaces:**
- Consumes: a Frappe-REST-shaped `client` (has `.get(url)` returning `{ data: { data: {...} } }`,
  matching every other lane/service in this codebase).
- Produces:
  - `isEnterprisePlan(plan: string) -> boolean`
  - `fetchTerminalGates(client, webAccountName: string) -> Promise<{ approved: boolean, disclosureAccepted: boolean }>`

- [ ] **Step 1: Write the failing tests**

Replace the final tally block of `backend/test/terminalAccessGates.test.js` (the
`console.log(\`\n${"=".repeat(48)}\`); ... ALL GREEN` block at the end) with:

```js
const { isEnterprisePlan, fetchTerminalGates } = require("../services/terminalEligibility");

console.log("# isEnterprisePlan");
{
  ok(isEnterprisePlan("Enterprise") === true, "exact match -> true");
  ok(isEnterprisePlan("Enterprise Plan") === true, "case/substring tolerant -> true");
  ok(isEnterprisePlan("enterprise") === true, "case-insensitive -> true");
  ok(isEnterprisePlan("Business") === false, "non-enterprise plan -> false");
  ok(isEnterprisePlan(undefined) === false, "undefined plan -> false");
  ok(isEnterprisePlan(null) === false, "null plan -> false");
}

console.log("# fetchTerminalGates");
(async () => {
  const fakeClient = (record) => ({
    get: async (url) => {
      if (!url.includes("Web%20Account")) throw new Error("unexpected url: " + url);
      return { data: { data: record } };
    },
  });

  const g1 = await fetchTerminalGates(fakeClient({ terminal_access_approved_at: "2026-07-19 10:00:00", terminal_disclosure_accepted_at: "2026-07-19 11:00:00" }), "WA-1");
  ok(g1.approved === true && g1.disclosureAccepted === true, "both timestamps present -> both true");

  const g2 = await fetchTerminalGates(fakeClient({ terminal_access_approved_at: "2026-07-19 10:00:00" }), "WA-2");
  ok(g2.approved === true && g2.disclosureAccepted === false, "only approval stamped -> disclosure false");

  const g3 = await fetchTerminalGates(fakeClient({}), "WA-3");
  ok(g3.approved === false && g3.disclosureAccepted === false, "empty record -> both false, never throws");

  const g4 = await fetchTerminalGates(fakeClient(null), "WA-4");
  ok(g4.approved === false && g4.disclosureAccepted === false, "null record (deleted/missing account) -> both false, never throws");

  console.log(`\n${"=".repeat(48)}`);
  console.log(`TERMINAL ACCESS GATES TESTS: ${passed} passed, ${failed} failed`);
  if (failed) { console.error("Failed."); process.exit(1); }
  console.log("ALL GREEN");
})();
```

The file's final shape: the synchronous `buildPortalRequestPayload` tests from Task 1 run first
(top-level, synchronous), then `isEnterprisePlan` tests (also synchronous), then this one async
IIFE containing the `fetchTerminalGates` tests plus the tally — since the tally must run last and
`fetchTerminalGates` is async, the tally moves inside this IIFE rather than staying a plain
trailing block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node test/terminalAccessGates.test.js`
Expected: `Cannot find module '../services/terminalEligibility'`

- [ ] **Step 3: Write the module**

Create `backend/services/terminalEligibility.js`:

```js
/**
 * Developer-terminal access gates — Web Account fields that must be true
 * before a terminal session can ever be minted. Being on an Enterprise plan
 * is necessary but not sufficient (see the design spec): staff must also
 * approve, and the customer must accept the one-time disclosure. Both are
 * re-checked from the live Frappe record on every mint attempt — never
 * trusted from the client or a stale session field.
 */

function isEnterprisePlan(plan) {
  return String(plan || "None").toLowerCase().includes("enterprise");
}

/** @returns {Promise<{approved: boolean, disclosureAccepted: boolean}>} never throws. */
async function fetchTerminalGates(client, webAccountName) {
  try {
    const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const rec = res.data?.data || {};
    return {
      approved: !!rec.terminal_access_approved_at,
      disclosureAccepted: !!rec.terminal_disclosure_accepted_at,
    };
  } catch (e) {
    return { approved: false, disclosureAccepted: false };
  }
}

module.exports = { isEnterprisePlan, fetchTerminalGates };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node test/terminalAccessGates.test.js`
Expected: `TERMINAL ACCESS GATES TESTS: 17 passed, 0 failed` / `ALL GREEN`

- [ ] **Step 5: Commit**

```bash
git add backend/services/terminalEligibility.js backend/test/terminalAccessGates.test.js
git commit -m "feat: add terminalEligibility service module (isEnterprisePlan + fetchTerminalGates)

Pure, unit-tested gate-check logic shared by the eligibility endpoint,
accept-disclosure route, and the mint endpoint (Tasks 4-5). Degrades
to {approved:false, disclosureAccepted:false} on any Frappe error or
missing record — never throws into a caller, matching this
codebase's soft-fail convention for nice-to-have reads."
```

---

## Task 4: Backend endpoints — `GET eligibility` + `POST accept-disclosure`

**Files:**
- Modify: `backend/routes/portalRoutes.js`

**Interfaces:**
- Consumes: `terminalEligibilityLib.isEnterprisePlan`, `terminalEligibilityLib.fetchTerminalGates` (Task 3)
- Produces:
  - `GET /api/portal/terminal/eligibility` → `{ ok: true, enterprisePlan: boolean, approved: boolean, disclosureAccepted: boolean }`
  - `POST /api/portal/terminal/accept-disclosure` → `{ ok: true, disclosureAcceptedAt: string }`

- [ ] **Step 1: Add the require**

In `backend/routes/portalRoutes.js`, alongside the `portalRequestPayloadLib` require added in
Task 1 (near the top, before `module.exports`):

```js
const terminalEligibilityLib = require('../services/terminalEligibility');
```

- [ ] **Step 2: Add the two routes**

Find the existing terminal section comment `// --- DEVELOPER ACCESS TERMINAL (Phase 5.2 — mint + WS auth only) ---`
(currently ~line 1196) and insert these two new routes immediately **before** it (so eligibility/
accept-disclosure sit together, ahead of the mint route that will consume them in Task 5):

```js
// --- DEVELOPER TERMINAL ACCESS: eligibility + one-time disclosure ---
// Neither of these ever mints a session or touches Coolify/the broker — they
// only read/write the two Web Account gate fields the mint endpoint (below)
// checks. The frontend panel uses eligibility to decide which of its four
// states to render (see docs/superpowers/specs/2026-07-19-developer-terminal-access-design.md).
router.get("/api/portal/terminal/eligibility", requireAuth, async (req, res) => {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  const enterprisePlan = terminalEligibilityLib.isEnterprisePlan(req.session?.user?.plan);
  if (!webAccountName) {
    return res.json({ ok: true, enterprisePlan, approved: false, disclosureAccepted: false });
  }
  try {
    const client = frappeClient();
    const gates = await terminalEligibilityLib.fetchTerminalGates(client, webAccountName);
    return res.json({ ok: true, enterprisePlan, ...gates });
  } catch (err) {
    // fetchTerminalGates itself never throws, but stay defensive — this is a
    // nice-to-have read, never worth a 500 that blanks the service page.
    console.error("TERMINAL ELIGIBILITY ERROR:", err.response?.data || err.message);
    return res.json({ ok: true, enterprisePlan, approved: false, disclosureAccepted: false });
  }
});

router.post("/api/portal/terminal/accept-disclosure", requireAuth, async (req, res) => {
  const webAccountName = req.session?.webAccount || req.session?.user?.id;
  if (!webAccountName) return res.status(401).json({ error: "No session account." });
  try {
    const client = frappeClient();
    const stampedAt = mysqlDatetimeUTC();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
      terminal_disclosure_accepted_at: stampedAt,
    });
    return res.json({ ok: true, disclosureAcceptedAt: stampedAt });
  } catch (err) {
    console.error("TERMINAL DISCLOSURE ACCEPT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to record disclosure acceptance." });
  }
});

```

- [ ] **Step 3: Syntax-check**

Run: `cd backend && node --check routes/portalRoutes.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/portalRoutes.js
git commit -m "feat: add terminal eligibility + accept-disclosure endpoints

GET /api/portal/terminal/eligibility and POST
/api/portal/terminal/accept-disclosure — the two reads/writes the
frontend consent panel (Task 9) needs. Both degrade safely (eligibility
never 500s; a missing session is a plain 401, matching every other
portal route)."
```

---

## Task 5: Wire the eligibility gates into the existing mint endpoint

**Files:**
- Modify: `backend/routes/portalRoutes.js:1217-1298` (the existing `isEnterprisePlan` function
  and `POST /api/portal/services/:serviceId/terminal/session` route)

**Interfaces:**
- Consumes: `terminalEligibilityLib.isEnterprisePlan`, `terminalEligibilityLib.fetchTerminalGates` (Task 3)

- [ ] **Step 1: Remove the now-duplicated local `isEnterprisePlan` and use the shared one**

In `backend/routes/portalRoutes.js`, delete the local function (currently lines ~1217-1219):

```js
// DELETE:
function isEnterprisePlan(plan) {
  return String(plan || "None").toLowerCase().includes("enterprise");
}
```

Update the one call site (inside the mint route):

```js
// BEFORE:
  if (!isEnterprisePlan(req.session?.user?.plan)) {
    return res.status(403).json({ error: "Developer access is an Enterprise-plan feature — contact sales to upgrade." });
  }
```

```js
// AFTER:
  if (!terminalEligibilityLib.isEnterprisePlan(req.session?.user?.plan)) {
    return res.status(403).json({ error: "Developer access is an Enterprise-plan feature — contact sales to upgrade." });
  }
```

- [ ] **Step 2: Add the two new gates right after the plan check**

Immediately after the block from Step 1 (still before the `brokerSigningKey`/`SESSION_SECRET`
config checks that follow), insert:

```js
  // Approval + disclosure gates (see docs/superpowers/specs/2026-07-19-
  // developer-terminal-access-design.md) — Enterprise plan alone is not
  // sufficient. Re-checked from the live Frappe record every mint attempt.
  {
    const client = frappeClient();
    const gates = await terminalEligibilityLib.fetchTerminalGates(client, webAccountName);
    if (!gates.approved) {
      return res.status(403).json({ code: "not_approved", error: "Developer access hasn't been approved for this account yet — our team will follow up on your request." });
    }
    if (!gates.disclosureAccepted) {
      return res.status(403).json({ code: "disclosure_required", error: "Please review and accept the developer access disclosure before starting a session." });
    }
  }
```

Note: this creates a second, block-scoped `const client = frappeClient()`. The existing code
further down in the same function already declares its own `const client = frappeClient();` for
the job lookup — that is unaffected since this one goes out of scope when the `{ }` block ends.

- [ ] **Step 3: Syntax-check**

Run: `cd backend && node --check routes/portalRoutes.js`
Expected: no output.

- [ ] **Step 4: Manual verification (no Express test harness exists for this route)**

This route's plumbing (session/plan/gate-ordering) is exercised live rather than via an automated
test, consistent with this codebase's established precedent for route-level logic. After deploying:
1. As a non-Enterprise account, `POST .../terminal/session` → expect the existing plan-gate 403
   (unchanged).
2. As an Enterprise account with no `terminal_access_approved_at` set → expect
   `403 { code: "not_approved" }`.
3. Manually stamp `terminal_access_approved_at` on that Web Account via Frappe desk → retry →
   expect `403 { code: "disclosure_required" }`.
4. Manually stamp `terminal_disclosure_accepted_at` too → retry → expect the existing downstream
   behavior (job lookup, TERMINAL_ENABLED check, etc.) — unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/portalRoutes.js
git commit -m "feat: gate terminal session mint on staff approval + disclosure acceptance

Adds the two new checks (not_approved / disclosure_required, each
with a distinct error code) right after the existing Enterprise-plan
check, using the shared terminalEligibility module instead of a
locally-duplicated isEnterprisePlan. Being on Enterprise alone no
longer mints a session — approval and disclosure acceptance are both
required, matching the design spec."
```

---

## Task 6: Backend admin approve endpoint

**Files:**
- Modify: `backend/routes/adminRoutes.js`

**Interfaces:**
- Consumes: nothing new (uses `frappeClient`, `requireAuth`, `requireAdmin`, `mysqlDatetimeUTC`,
  already in this file's `ctx` destructure)
- Produces: `POST /api/admin/web-accounts/:webAccount/terminal-access/approve` →
  `{ ok: true, approvedAt: string, approvedBy: string }`

- [ ] **Step 1: Add the route**

In `backend/routes/adminRoutes.js`, add this route (anywhere after the existing `/api/admin/threads/:id/reply`
route is a natural spot, keeping all thread/access-related admin actions together):

```js
// --- DEVELOPER TERMINAL ACCESS: staff approval ---
// Stamps the Web Account fields the mint endpoint's gate checks
// (routes/portalRoutes.js) require. Frappe's own document version history
// on Web Account is the audit trail for who/when — no separate log field.
router.post("/api/admin/web-accounts/:webAccount/terminal-access/approve", requireAuth, requireAdmin, async (req, res) => {
  const { webAccount } = req.params;
  if (!webAccount) return res.status(400).json({ error: "Missing webAccount." });
  const approvedBy = String(req.session?.user?.email || "").trim();
  if (!approvedBy) return res.status(401).json({ error: "No session account." });
  try {
    const client = frappeClient();
    const approvedAt = mysqlDatetimeUTC();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`, {
      terminal_access_approved_at: approvedAt,
      terminal_access_approved_by: approvedBy,
    });
    return res.json({ ok: true, approvedAt, approvedBy });
  } catch (err) {
    console.error("TERMINAL ACCESS APPROVE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to approve developer access." });
  }
});
```

- [ ] **Step 2: Syntax-check**

Run: `cd backend && node --check routes/adminRoutes.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/adminRoutes.js
git commit -m "feat: add admin endpoint to approve developer terminal access

POST /api/admin/web-accounts/:webAccount/terminal-access/approve
stamps terminal_access_approved_at/_by on the Web Account. This is
the staff-facing half of the consent gate added in Task 5 — without
this endpoint, approving access meant a raw Frappe-desk field edit."
```

---

## Task 7: Frontend service functions

**Files:**
- Create: `frontend/src/services/terminal.ts`
- Modify: `frontend/src/services/adminChat.ts`

**Interfaces:**
- Produces (`terminal.ts`):
  - `fetchTerminalEligibility(): Promise<{ enterprisePlan: boolean; approved: boolean; disclosureAccepted: boolean }>`
  - `acceptTerminalDisclosure(): Promise<{ disclosureAcceptedAt: string }>`
- Produces (`adminChat.ts` additions):
  - `ThreadDoc` gains `subject?: string` and `portal_user?: string`
  - `adminApproveTerminalAccess(webAccount: string): Promise<{ approvedAt: string; approvedBy: string }>`

- [ ] **Step 1: Create the terminal service file**

Create `frontend/src/services/terminal.ts`:

```ts
export interface TerminalEligibility {
  enterprisePlan: boolean;
  approved: boolean;
  disclosureAccepted: boolean;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Request failed.");
  return data as T;
}

export async function fetchTerminalEligibility(): Promise<TerminalEligibility> {
  const res = await fetch("/api/portal/terminal/eligibility", { credentials: "include" });
  const data = await handleJson<{ ok: true } & TerminalEligibility>(res);
  return { enterprisePlan: !!data.enterprisePlan, approved: !!data.approved, disclosureAccepted: !!data.disclosureAccepted };
}

export async function acceptTerminalDisclosure(): Promise<{ disclosureAcceptedAt: string }> {
  const res = await fetch("/api/portal/terminal/accept-disclosure", {
    method: "POST",
    credentials: "include",
  });
  return handleJson<{ disclosureAcceptedAt: string }>(res);
}
```

- [ ] **Step 2: Extend `adminChat.ts`**

In `frontend/src/services/adminChat.ts`, change the `ThreadSummary` type:

```ts
// BEFORE:
export type ThreadSummary = {
  name: string;
  email?: string;
  full_name?: string;
  company_name?: string;
  status?: string;
  last_message_at?: string;
  modified?: string;
};
```

```ts
// AFTER:
export type ThreadSummary = {
  name: string;
  email?: string;
  full_name?: string;
  company_name?: string;
  status?: string;
  last_message_at?: string;
  modified?: string;
  // Present on the single-thread GET (unprojected Frappe doc); absent from
  // the list endpoint's projected fields. Optional here so both call sites
  // type-check.
  subject?: string;
  portal_user?: string;
};
```

Add a new exported function at the end of the file:

```ts
export async function adminApproveTerminalAccess(webAccount: string): Promise<{ approvedAt: string; approvedBy: string }> {
  const res = await fetch(`/api/admin/web-accounts/${encodeURIComponent(webAccount)}/terminal-access/approve`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to approve developer access.");
  return data;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/terminal.ts frontend/src/services/adminChat.ts
git commit -m "feat: add frontend service functions for terminal eligibility + admin approval

fetchTerminalEligibility/acceptTerminalDisclosure (Task 9's panel) and
adminApproveTerminalAccess (Task 8's AdminInbox button), plus the two
new optional fields on ThreadDoc the approve button needs to identify
a developer-access-request thread."
```

---

## Task 8: AdminInbox "Approve Developer Access" button

**Files:**
- Modify: `frontend/src/pages/admin/AdminInbox.tsx`

**Interfaces:**
- Consumes: `adminApproveTerminalAccess` (Task 7), `ThreadDoc.subject`/`ThreadDoc.portal_user` (Task 7)

- [ ] **Step 1: Add state + handler**

In `frontend/src/pages/admin/AdminInbox.tsx`, update the import and add two new state variables
alongside the existing ones (near `const [error, setError] = useState<string>("");`):

```ts
import {
  adminGetThread,
  adminListThreads,
  adminReply,
  adminApproveTerminalAccess,
  ChatMessage,
  ThreadDoc,
  ThreadSummary,
} from "../../services/adminChat";
```

```ts
  const [approvingTerminal, setApprovingTerminal] = useState(false);
  const [terminalApproveNote, setTerminalApproveNote] = useState("");
```

Add the handler right after `handleSend`:

```ts
  const isDeveloperAccessThread = (t: ThreadDoc | null) =>
    !!t?.subject && t.subject.startsWith("Developer Access Request:");

  const handleApproveTerminalAccess = async () => {
    if (!threadDoc?.portal_user) return;
    setApprovingTerminal(true);
    setTerminalApproveNote("");
    try {
      await adminApproveTerminalAccess(threadDoc.portal_user);
      setTerminalApproveNote("Developer access approved — the customer can now accept the disclosure and open a session.");
    } catch (e: any) {
      setTerminalApproveNote(e?.message || "Failed to approve developer access.");
    } finally {
      setApprovingTerminal(false);
    }
  };
```

- [ ] **Step 2: Render the button in the thread detail panel**

Find the thread header block (the `<div className="p-6 border-b ...">` right after `{/* Right: Thread */}`,
containing `threadTitle`/`threadMeta`), and add the button + note right after that header `</div>`
closes and before `<div className="p-6">` opens (i.e., between the header and the message list):

```tsx
          {isDeveloperAccessThread(threadDoc) && (
            <div className="px-6 py-4 border-b border-slate-100 dark:border-murzak-border bg-murzak-accent/5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-micro font-black uppercase text-slate-600">
                Developer access request
              </p>
              <button
                type="button"
                onClick={handleApproveTerminalAccess}
                disabled={approvingTerminal || !threadDoc?.portal_user}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
              >
                {approvingTerminal ? "Approving..." : "Approve Developer Access"}
              </button>
            </div>
          )}
          {terminalApproveNote && (
            <div className="px-6 pt-4 text-micro font-black uppercase text-murzak-accent">
              {terminalApproveNote}
            </div>
          )}
```

- [ ] **Step 3: Typecheck and build**

Run:
```bash
cd frontend
npx tsc --noEmit
npm run build
```
Expected: both clean/succeed.

- [ ] **Step 4: Live verification**

Start the frontend dev server, log in as an admin account, open AdminInbox, and confirm:
1. A thread with subject NOT starting with "Developer Access Request:" shows no approve button.
2. A thread with that subject prefix shows the button.
3. Clicking it succeeds and shows the confirmation note (test against the mock/dev backend from
   this session, per this codebase's established live-verification pattern).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/AdminInbox.tsx
git commit -m "feat: add Approve Developer Access button to AdminInbox

Shows only on threads whose subject matches the existing
'Developer Access Request: {svc}' prefix Portal.tsx's upsell modal
already sends (now actually persisted, per Task 1's fix). Calls the
new admin approve endpoint (Task 6)."
```

---

## Task 9: `DeveloperTerminalPanel` component + mount in Portal.tsx

**Files:**
- Create: `frontend/src/components/portal/DeveloperTerminalPanel.tsx`
- Modify: `frontend/src/pages/Portal.tsx`

**Interfaces:**
- Consumes: `fetchTerminalEligibility`, `acceptTerminalDisclosure` (Task 7)
- Props: `DeveloperTerminalPanelProps = { serviceId: string; isActive: boolean; onRequestUpgrade: () => void }`

- [ ] **Step 1: Create the panel component**

Create `frontend/src/components/portal/DeveloperTerminalPanel.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { Terminal, ShieldCheck, Clock } from "lucide-react";
import { fetchTerminalEligibility, acceptTerminalDisclosure, TerminalEligibility } from "../../services/terminal";

interface DeveloperTerminalPanelProps {
  serviceId: string;
  isActive: boolean;
  /** Opens the existing Developer Upsell request modal (Portal.tsx's developerUpsellSvc flow). */
  onRequestUpgrade: () => void;
}

/**
 * Allocated (non-floating) panel for the developer-access terminal — lives
 * inline in the service detail page, always occupying its own layout space.
 * Renders one of four states based on eligibility; the actual shell (Phase
 * 5.3 broker bridge) is a separate, later piece of work — see
 * docs/superpowers/specs/2026-07-19-developer-terminal-access-design.md.
 */
const DeveloperTerminalPanel: React.FC<DeveloperTerminalPanelProps> = ({ serviceId, isActive, onRequestUpgrade }) => {
  const [eligibility, setEligibility] = useState<TerminalEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const load = () => {
    setLoading(true);
    fetchTerminalEligibility()
      .then(setEligibility)
      .catch(() => setEligibility({ enterprisePlan: false, approved: false, disclosureAccepted: false }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptError("");
    try {
      await acceptTerminalDisclosure();
      load();
    } catch (e: any) {
      setAcceptError(e?.message || "Failed to record acceptance.");
    } finally {
      setAccepting(false);
    }
  };

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center gap-3 mb-3">
        <Terminal className="w-5 h-5 text-murzak-accent" />
        <p className="text-micro font-black uppercase text-slate-600">Developer Access</p>
      </div>

      {loading ? (
        <p className="text-label font-medium text-slate-500">Checking access…</p>
      ) : !eligibility?.enterprisePlan ? (
        <div>
          <p className="text-label font-medium text-slate-600 dark:text-slate-600 mb-3">
            A jailed shell into this service is available on the Enterprise plan.
          </p>
          <button
            type="button"
            onClick={onRequestUpgrade}
            className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase hover:scale-[1.02] transition"
          >
            Request Upgrade
          </button>
        </div>
      ) : !eligibility.approved ? (
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-label font-medium text-slate-600 dark:text-slate-600">
            Your developer access request is awaiting approval from our team — you'll be able to
            connect as soon as it's confirmed.
          </p>
        </div>
      ) : !eligibility.disclosureAccepted ? (
        <div>
          <div className="flex items-start gap-3 mb-4">
            <ShieldCheck className="w-4 h-4 text-murzak-accent shrink-0 mt-0.5" />
            <div className="text-label font-medium text-slate-600 dark:text-slate-600 space-y-2">
              <p>
                Before your first session, please review: this shell runs inside your own service's
                container — you'll be able to see its internal network address, hostname, and
                running processes. Sessions are recorded for security and audit purposes. Use is
                limited to your own service; attempting to reach other tenants or the host is not
                permitted and will end your access.
              </p>
            </div>
          </div>
          {acceptError && <p className="text-label font-bold text-red-500 mb-3">{acceptError}</p>}
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
          >
            {accepting ? "Saving…" : "I understand and agree"}
          </button>
        </div>
      ) : (
        <p className="text-label font-medium text-slate-500">
          Terminal access is finalizing — check back soon.
        </p>
      )}
    </div>
  );
};

export default DeveloperTerminalPanel;
```

(The final `else` branch is today's honest placeholder for "approved + accepted, but the broker
bridge doesn't exist yet" — per the design spec's explicit scope boundary. Replacing it with an
actual xterm.js mount is a separate, later task.)

- [ ] **Step 2: Mount it in Portal.tsx**

In `frontend/src/pages/Portal.tsx`, find the anchor right after the Deployments card's closing
`{deployLogView && ( ... )}` block and right before `{isActive && ( ... Connect your domain ...
)}`. Insert:

```tsx
            <DeveloperTerminalPanel
              serviceId={cloudServiceId}
              isActive={isActive}
              onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
            />

```

Add the import near the top of `Portal.tsx`, alongside the other `components/portal/*` imports:

```tsx
import DeveloperTerminalPanel from "../components/portal/DeveloperTerminalPanel";
```

- [ ] **Step 3: Typecheck and build**

Run:
```bash
cd frontend
npx tsc --noEmit
npm run build
```
Expected: both clean/succeed.

- [ ] **Step 4: Live verification of all four states**

Using this session's established mock-backend pattern (`DEV_AUTO_LOGIN=true MOCK_FRAPPE=true`),
verify each state renders correctly for a service on the "My Systems" page:
1. Non-Enterprise account → "Request Upgrade" prompt; clicking it opens the existing upsell modal.
2. Enterprise account, no approval stamped → "awaiting approval" message.
3. Enterprise + approved (stamp `terminal_access_approved_at` directly via the mock store or a
   real Frappe test record), no disclosure accepted → disclosure text + "I understand and agree"
   button; clicking it calls accept-disclosure and the panel updates.
4. Enterprise + approved + disclosure accepted → "Terminal access is finalizing — check back
   soon."

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/portal/DeveloperTerminalPanel.tsx frontend/src/pages/Portal.tsx
git commit -m "feat: allocated developer-terminal panel in the service detail page

Renders inline (never floating) below the Deployments card, one of
four states based on /api/portal/terminal/eligibility: request-
upgrade, awaiting-approval, one-time disclosure acceptance, or (once
approved+accepted) an honest 'finalizing' placeholder — the actual
shell is a separate, later piece of work (broker bridge + xterm.js).

Verified live across all four states against the mock backend."
```

---

## Final full-suite verification

After Task 9:
```bash
cd backend && npm test 2>&1 | tail -20
cd ../frontend && npx tsc --noEmit && npm run build
```
Expected: full backend suite green (including the new
`TERMINAL ACCESS GATES TESTS: 17 passed, 0 failed`), `tsc` clean, `vite build` succeeds.
