# Murzak Cloud Instant Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-resource "Launch a cloud resource" instant-checkout picker for the four volume-class self-serve categories (Website Hosting, App Hosting/BYOA, Database Hosting, Storage), separate from the bundled plan configurator, reusing all existing invoice/payment plumbing.

**Architecture:** A new `CloudLaunchModal` component (spec-card picker, HostAfrica-style) reuses the *existing* pending-selection → register/login → `attach-selection` → `/payment/:id` path for brand-new customers, and calls the *existing* `/api/addons/invoice/create` endpoint for customers who already have a paid plan. One backend fix makes that endpoint plan-agnostic for volume-class services (today it wrongly blocks a Business-plan customer from buying a Light-tier cloud resource). No new payment code, no new invoice-creation code — only a picker UI and one authorization fix.

**Tech Stack:** React 19 + TypeScript + Vite (frontend), Node/Express + Frappe REST (backend), Playwright (e2e).

## Global Constraints

- Never fake provisioning/payment state — every code path must exercise the real backend, matching this repo's established "no mock-path lies" standard (see `docs/superpowers/specs/2026-07-17-murzak-cloud-instant-checkout-design.md`).
- Reuse existing endpoints (`/api/plan/attach-selection`, `/api/addons/invoice/create`, `/api/portal/account/repo`) — do not create parallel invoice-creation logic.
- Scope is exactly four categories: Website Hosting, App Hosting, Database Hosting, Storage — all `capacityClass: "volume"`. Managed ERP/POS/CRM (`capacityClass: "premium"`) and Enterprise (`capacityClass: "dedicated"`) are out of scope and must not appear in the picker.
- One resource per checkout — no multi-item cart.
- Configure first, account/login only at the "Launch now" step — no auth wall before that.

---

## File Map

- **Create:** `backend/services/addonEligibility.js` — pure, testable gating logic for `/api/addons/invoice/create`.
- **Create:** `backend/test/addonEligibility.test.js` — unit tests for the above.
- **Modify:** `backend/server.js` — wire the new gating module into `/api/addons/invoice/create`; return `invoiceId` in its response.
- **Modify:** `frontend/src/config/serviceCatalog.ts` — add `cloudLaunchCatalog()` helper (the four-category, volume-only view of the catalog).
- **Create:** `frontend/src/components/CloudLaunchModal.tsx` — the picker UI.
- **Modify:** `frontend/src/pages/Cloud.tsx` — hero CTA opens the picker; mount the modal; support `?launch=<serviceId>` deep link.
- **Modify:** `frontend/src/pages/Login.tsx` — prefill `formData.sourceCode` from a pending selection's `repoUrl`, if present.
- **Create:** `frontend/e2e/cloud-launch.spec.ts` — Playwright coverage of both auth branches.

---

### Task 1: Backend — plan-agnostic volume-addon eligibility + return invoiceId

**Files:**
- Create: `backend/services/addonEligibility.js`
- Create: `backend/test/addonEligibility.test.js`
- Modify: `backend/server.js:773-778` (existing `allowedAddonTiersForPlan`), `backend/server.js:1130-1152` (tier check inside `/api/addons/invoice/create`), `backend/server.js:1223-1253` (the two invoice-write branches), `backend/server.js:1295` (JSON response)

**Interfaces:**
- Produces: `isAddonEligible({ planKey, service, paid }) -> { ok: boolean, error?: string }` from `backend/services/addonEligibility.js`, where `service` is a catalog snapshot item shaped like `{ tier, capacityClass, monthlyKes }` (i.e. what `getServiceMeta(serviceId)` from `backend/services/provisioning/catalog.js` returns).
- Consumes: nothing from other tasks (this task is self-contained; later frontend tasks consume the resulting JSON response shape `{ ok, user, invoiceId }`).

Today, `/api/addons/invoice/create` (server.js:1110) gates every add-on by
`allowedAddonTiersForPlan(planKey)` (server.js:773), which only allows tier
`"Medium"` add-ons for a `"Business"` plan customer and tier `"Light"` for
`"Starter"`. All four volume-class cloud resources (Website Hosting, App
Hosting, Database, Storage) are tier `"Light"` — so a Business-plan customer
is rejected today trying to buy one. The fix: a volume-class service
(`capacityClass === "volume"`) is always safe for any *paid* customer to
self-serve add, regardless of their plan's own tier — that gate exists to
protect capacity/provisioning risk, not to restrict cross-selling. Premium
add-ons keep the existing tier-matches-plan behavior.

- [ ] **Step 1: Write the failing unit test**

Create `backend/test/addonEligibility.test.js`:

```js
/**
 * Unit tests for addon eligibility gating — runs without Redis or Frappe.
 *   node test/addonEligibility.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { isAddonEligible } = require("../services/addonEligibility");

(async () => {
  section("volume-class services are plan-agnostic");
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 2200 },
    }).ok === true,
    "Business-plan customer CAN add a Light-tier volume service (the bug this fixes)"
  );
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === true,
    "Starter-plan customer can add a Light-tier volume service"
  );
  ok(
    isAddonEligible({
      planKey: "Test",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === false,
    "Test plan (never paid) still cannot add volume services"
  );

  section("premium-class services keep tier-matches-plan behavior");
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Medium", capacityClass: "premium", monthlyKes: 4500 },
    }).ok === true,
    "Business-plan customer can add a Medium-tier premium add-on (unchanged)"
  );
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: { tier: "Medium", capacityClass: "premium", monthlyKes: 4500 },
    }).ok === false,
    "Starter-plan customer cannot add a Medium-tier premium add-on (unchanged)"
  );
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Large", capacityClass: "premium", monthlyKes: 12000 },
    }).ok === false,
    "Business-plan customer cannot add a Large-tier premium add-on (unchanged)"
  );

  section("unknown plan");
  ok(
    isAddonEligible({
      planKey: "None",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === false,
    "No plan at all -> not eligible (caller must go through attach-selection instead)"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node test/addonEligibility.test.js`
Expected: FAIL with `Cannot find module '../services/addonEligibility'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/addonEligibility.js`:

```js
/**
 * Eligibility gate for /api/addons/invoice/create.
 *
 * Volume-class services (light, self-serve, Coolify-lane — Website Hosting,
 * App Hosting, Database, Storage) are safe for ANY paying customer to add
 * regardless of their plan's own tier, because the gate exists to protect
 * provisioning/capacity risk (volume-class is always the cheapest, safest
 * footprint), not to restrict which plan can cross-sell which category.
 *
 * Premium-class services (managed Frappe apps) keep the original
 * tier-matches-plan rule, since those need to match the density the
 * customer's plan is already provisioned for.
 */

const PREMIUM_TIERS_BY_PLAN = {
  Starter: ["Light"],
  Business: ["Medium"],
  Enterprise: ["Light", "Medium", "Large", "Enterprise"],
};

function isPaidPlan(planKey) {
  return planKey === "Starter" || planKey === "Business" || planKey === "Enterprise";
}

/**
 * @param {{planKey: string, service: {tier?: string, capacityClass?: string, monthlyKes?: number}}} args
 * @returns {{ok: boolean, error?: string}}
 */
function isAddonEligible({ planKey, service }) {
  if (!isPaidPlan(planKey)) {
    return { ok: false, error: "Add-ons are not available for your current plan." };
  }

  if (service?.capacityClass === "volume") {
    return { ok: true };
  }

  const allowedTiers = PREMIUM_TIERS_BY_PLAN[planKey] || [];
  if (!service?.tier || allowedTiers.includes(String(service.tier))) {
    return { ok: true };
  }

  return { ok: false, error: `Service tier not allowed for add-ons under ${planKey}.` };
}

module.exports = { isAddonEligible };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node test/addonEligibility.test.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Wire the new module into `/api/addons/invoice/create`, and return `invoiceId`**

In `backend/server.js`, add the require near the other local service requires (line 92, right after the `provisioning/catalog` require):

```js
const { getServiceMeta, sumSelectedServicesMonthlyKes } = require("./services/provisioning/catalog");
const { isAddonEligible } = require("./services/addonEligibility");
```

Replace the tier-check block at server.js:1130-1152 (currently: build `allowedTiers` from `allowedAddonTiersForPlan`, look up each service's `meta`, then a separate `bad = norm.find(...)` tier check) with a single per-service eligibility check that uses each service's real `capacityClass` from the catalog snapshot:

```js
    const norm = normalizeSelectedServices(services);

    // Every add-on must be a real, priced catalog service — no fabricated
    // pricing for something not in the catalog snapshot. Also enforce
    // eligibility per-service (volume-class is plan-agnostic; premium-class
    // must match the customer's plan tier).
    for (const s of norm) {
      const meta = getServiceMeta(s.serviceId);
      if (!meta || !(Number(meta.monthlyKes) > 0)) {
        return res.status(400).json({ error: `Add-on pricing not configured for service: ${s.serviceId}` });
      }
      const elig = isAddonEligible({ planKey, service: meta });
      if (!elig.ok) {
        return res.status(400).json({ error: elig.error });
      }
    }
```

(This removes the now-unused `allowedTiers` variable and the separate `bad = norm.find(...)` block — both folded into the loop above.)

Then capture the invoice id in both write branches and return it. In the
"merge into open invoice" branch (server.js:1223, inside the `if (open?.name ...)` block), the id is already known — add a local variable right after the `await client.put(...)` call:

```js
      await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`, {
        type: "Add-on",
        plan: planKey,
        amount: mergedAmount,
        invoice_date: today,
        status: open.status || "Unpaid",
        [PORTAL_INVOICE_SERVICES_FIELD]: mergedRows,
      });
      var createdInvoiceId = open.name;
    } else {
      const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
      const clientName = accRes.data?.data?.account_holder_name || "";

      const rows = buildInvoiceServiceRows(
        norm.map((s) => ({
          ...s,
          status: "Awaiting Payment",
        }))
      );

      const created = await client.post("/api/resource/Portal Invoice", {
        web_account: webAccountName,
        client_name: clientName,
        invoice_no: `ADD-${Date.now()}`,
        type: "Add-on",
        plan: planKey,
        amount,
        status: "Unpaid",
        invoice_date: today,
        [PORTAL_INVOICE_SERVICES_FIELD]: rows,
      });
      var createdInvoiceId = created.data?.data?.name || null;
    }
```

(Using `var` deliberately here — the two branches are the `if`/`else` arms already inside the same function scope in server.js, and `var` gives the variable function-level scope so it's visible after the `if/else` block regardless of which arm ran; a `const`/`let` declared inside one arm wouldn't be visible to the code below.)

Finally, update the success response at server.js:1295:

```js
    return res.json({ ok: true, user: userPayload, invoiceId: createdInvoiceId });
```

- [ ] **Step 6: Manually verify against a live dev backend**

This route has no supertest harness in this repo (route-level checks here are
done via a live walkthrough, matching the existing convention — see
`backend/test/billing.test.js`'s header comment and this repo's BYOA session
notes). Start the backend (`cd backend && npm start`), log in as an existing
test account that already has a **paid Business plan**, and call:

```bash
curl -s -X POST http://localhost:PORT/api/addons/invoice/create \
  -H "Content-Type: application/json" \
  -b "<session cookie>" \
  -d '{"services":[{"serviceId":"starter-app-hosting","serviceName":"App Hosting (Node.js / Docker)","tier":"Light"}]}'
```

Expected: `200` with `{"ok":true,"user":{...},"invoiceId":"ADD-..."}` (previously this returned `400 Service tier not allowed for add-ons under Business.`).

- [ ] **Step 7: Commit**

```bash
git add backend/services/addonEligibility.js backend/test/addonEligibility.test.js backend/server.js
git commit -m "fix: allow any paid plan to self-serve buy volume-class cloud add-ons"
```

---

### Task 2: Frontend catalog helper — `cloudLaunchCatalog()`

**Files:**
- Modify: `frontend/src/config/serviceCatalog.ts` (append near the other exported helpers, after `planStartingKes`)

**Interfaces:**
- Produces: `CloudLaunchCategory` type (`"Website Hosting" | "App Hosting" | "Database Hosting" | "Storage"`) and `cloudLaunchCatalog(): Record<CloudLaunchCategory, ServiceItem[]>` — used by Task 4's `CloudLaunchModal`.
- Consumes: `SERVICE_CATALOG`, `ServiceItem`, `ServiceCategory` (all already defined earlier in this same file).

- [ ] **Step 1: Add the helper**

Append to `frontend/src/config/serviceCatalog.ts`, after the `planStartingKes` function (after line 859, before the "CAPACITY ENFORCEMENT" section comment):

```ts
// =====================================================================
//  MURZAK CLOUD — instant single-resource checkout. Scoped to exactly the
//  volume-class categories that provision without a human (Coolify lane).
//  Deliberately excludes UNIVERSAL_ADDONS (those augment an existing
//  resource, e.g. "+50GB Storage" — they are not standalone launchable
//  resources) and anything capacityClass "premium"/"dedicated".
// =====================================================================

export type CloudLaunchCategory =
  | "Website Hosting"
  | "App Hosting"
  | "Database Hosting"
  | "Storage";

export const CLOUD_LAUNCH_CATEGORIES: CloudLaunchCategory[] = [
  "Website Hosting",
  "App Hosting",
  "Database Hosting",
  "Storage",
];

/** Every self-serve, instantly-provisioned resource, grouped by category. */
export function cloudLaunchCatalog(): Record<CloudLaunchCategory, ServiceItem[]> {
  const allVolumeServices = (Object.keys(SERVICE_CATALOG) as PlanCode[])
    .flatMap((code) => SERVICE_CATALOG[code])
    .filter((s) => s.capacityClass === "volume");

  const result = {} as Record<CloudLaunchCategory, ServiceItem[]>;
  for (const cat of CLOUD_LAUNCH_CATEGORIES) {
    result[cat] = allVolumeServices
      .filter((s) => s.category === cat)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return result;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manually verify the data shape**

Add a one-off temporary check (do NOT commit this file) to confirm the
grouping is correct, then delete it:

```bash
cd frontend && node -e "
require('ts-node/register');
const { cloudLaunchCatalog } = require('./src/config/serviceCatalog.ts');
const c = cloudLaunchCatalog();
console.log(Object.keys(c).map(k => k + ': ' + c[k].map(s => s.id).join(',')));
"
```

If `ts-node` isn't available, instead confirm manually by reading
`SERVICE_CATALOG` in the file: `cloudLaunchCatalog()["App Hosting"]` should
contain exactly `starter-app-hosting`; `"Website Hosting"` should contain
`starter-web-hosting`, `starter-web-hosting-plus`, and `biz-web-hosting`;
`"Database Hosting"` should contain `starter-db-light` and `starter-db-mongo`;
`"Storage"` should contain `starter-storage`. No `addon-*` ids should appear
anywhere in the result.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/config/serviceCatalog.ts
git commit -m "feat: add cloudLaunchCatalog() — volume-class resources grouped for instant checkout"
```

---

### Task 3: `CloudLaunchModal` component

**Files:**
- Create: `frontend/src/components/CloudLaunchModal.tsx`

**Interfaces:**
- Consumes: `cloudLaunchCatalog()`, `CLOUD_LAUNCH_CATEGORIES`, `CloudLaunchCategory`, `ServiceItem`, `formatKes` (all from `frontend/src/config/serviceCatalog.ts`, Task 2); `DomainChoice` type (already defined in `serviceCatalog.ts`); `User` type from `frontend/src/types.ts`.
- Produces: default export `CloudLaunchModal` with props:
  ```ts
  type CloudLaunchModalProps = {
    isOpen: boolean;
    onClose: () => void;
    isLoggedIn: boolean;
    onNavigate: (path: string) => void;
    initialServiceId?: string; // for the ?launch= deep link (Task 4)
  };
  ```
  Consumed by `Cloud.tsx` (Task 4).

The component's own submit handler calls two existing endpoints directly
(no new frontend service module needed — this mirrors how `AddonsModal`'s
consumer already calls `fetch` inline in `Portal.tsx`):
- `POST /api/addons/invoice/create` (existing, body `{ services: [{ serviceId, serviceName, tier, domainChoice }] }`, returns `{ ok, user, invoiceId }` after Task 1).
- `POST /api/plan/attach-selection` (existing, body `{ planKey: "Starter", selectedServices: [{ serviceId, serviceName, category, tier, domainChoice }] }`, returns `{ user, invoices }` — see `Login.tsx:162-201` for the exact shape already handled).
- `PUT /api/portal/account/repo` (existing, body `{ repoUrl }`) — only called after either invoice call succeeds, and only when the launched service `requiresRepo`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CloudLaunchModal.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, AlertCircle, Rocket } from "lucide-react";
import {
  cloudLaunchCatalog,
  CLOUD_LAUNCH_CATEGORIES,
  CloudLaunchCategory,
  ServiceItem,
  DomainChoice,
  formatKes,
} from "../config/serviceCatalog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  onNavigate: (path: string) => void;
  initialServiceId?: string;
};

const DOMAIN_CHOICES: DomainChoice[] = [
  "Use Murzak Subdomain",
  "Bring My Domain",
  "Register New Domain",
];

function findServiceCategory(
  catalog: Record<CloudLaunchCategory, ServiceItem[]>,
  serviceId: string
): CloudLaunchCategory | null {
  for (const cat of CLOUD_LAUNCH_CATEGORIES) {
    if (catalog[cat].some((s) => s.id === serviceId)) return cat;
  }
  return null;
}

export default function CloudLaunchModal({
  isOpen,
  onClose,
  isLoggedIn,
  onNavigate,
  initialServiceId,
}: Props) {
  const catalog = useMemo(() => cloudLaunchCatalog(), []);

  const [category, setCategory] = useState<CloudLaunchCategory>("App Hosting");
  const [selectedId, setSelectedId] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState("");
  const [domainChoice, setDomainChoice] = useState<DomainChoice>("Use Murzak Subdomain");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (initialServiceId) {
      const cat = findServiceCategory(catalog, initialServiceId);
      if (cat) {
        setCategory(cat);
        setSelectedId(initialServiceId);
        return;
      }
    }
    setCategory("App Hosting");
    setSelectedId(catalog["App Hosting"][0]?.id || "");
  }, [isOpen, initialServiceId, catalog]);

  useEffect(() => {
    if (!isOpen) return;
    setErr("");
    setSubmitting(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const servicesForCategory = catalog[category] || [];
  const selected = servicesForCategory.find((s) => s.id === selectedId) || null;

  const handlePickCategory = (cat: CloudLaunchCategory) => {
    setCategory(cat);
    const first = catalog[cat][0];
    setSelectedId(first?.id || "");
    setErr("");
  };

  const attachRepoIfNeeded = async () => {
    if (!selected?.requiresRepo) return;
    const res = await fetch("/api/portal/account/repo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ repoUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to save repository URL.");
  };

  const launchLoggedIn = async () => {
    if (!selected) return;

    // Try the existing-customer add-on path first — the backend is the
    // single source of truth on whether this account has a paid plan yet.
    const addonRes = await fetch("/api/addons/invoice/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        services: [
          {
            serviceId: selected.id,
            serviceName: selected.name,
            tier: selected.tier,
            domainChoice: selected.requiresDomainChoice ? domainChoice : "",
          },
        ],
      }),
    });
    const addonData = await addonRes.json().catch(() => ({}));

    if (addonRes.ok) {
      await attachRepoIfNeeded();
      onNavigate(`/payment/${addonData.invoiceId}`);
      return;
    }

    // Not paid on any plan yet (first-ever order) -> establish it via the
    // same call the bundled configurator already makes for a first Starter
    // order. Any other rejection (e.g. genuine plan conflict) surfaces as-is.
    if (!/pay your subscription plan first/i.test(addonData?.error || "")) {
      throw new Error(addonData?.error || "Failed to launch resource.");
    }

    const attachRes = await fetch("/api/plan/attach-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        planKey: "Starter",
        selectedServices: [
          {
            serviceId: selected.id,
            serviceName: selected.name,
            category: selected.category,
            tier: selected.tier,
            domainChoice: selected.requiresDomainChoice ? domainChoice : "",
          },
        ],
      }),
    });
    const attachData = await attachRes.json().catch(() => ({}));
    if (!attachRes.ok) throw new Error(attachData?.error || "Failed to launch resource.");

    await attachRepoIfNeeded();

    const unpaid = (attachData?.invoices || []).find((inv: any) => inv.status === "Unpaid");
    if (!unpaid) throw new Error("Order created but no invoice was generated — contact support.");
    onNavigate(`/payment/${unpaid.docName || unpaid.name}`);
  };

  const launchLoggedOut = () => {
    if (!selected) return;
    const payload = {
      plan: "Starter",
      planLabel: "Infrastructure Core",
      selectedServices: [
        {
          serviceId: selected.id,
          serviceName: selected.name,
          category: selected.category,
          tier: selected.tier,
          domainChoice: selected.requiresDomainChoice ? domainChoice : "",
        },
      ],
      monthlyTotalKes: selected.pricing.monthlyKes || 0,
      setupTotalKes: selected.pricing.setupKes || 0,
      domainYearlyTotalKes: 0,
      status: "Pending",
      selectedAt: new Date().toISOString(),
      source: "CloudLaunch",
      upgradeIntent: false,
      upgradeMode: "",
      repoUrl: selected.requiresRepo ? repoUrl : undefined,
    };
    localStorage.setItem("murzak_plan_selection_pending", JSON.stringify(payload));
    onClose();
    onNavigate("/login");
  };

  const handleLaunch = async () => {
    setErr("");
    if (!selected) {
      setErr("Pick a resource to continue.");
      return;
    }
    if (selected.requiresRepo && !/^(https?:\/\/|git@)\S+$/i.test(repoUrl.trim())) {
      setErr("Enter a valid repository URL (e.g. https://github.com/you/app).");
      return;
    }

    if (!isLoggedIn) {
      launchLoggedOut();
      return;
    }

    try {
      setSubmitting(true);
      await launchLoggedIn();
    } catch (e: any) {
      setErr(e?.message || "Failed to launch resource.");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div className="absolute inset-0 bg-murzak-deep/50 backdrop-blur-xl" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] bg-white/95 dark:bg-murzak-navy/90 backdrop-blur-xl rounded-2xl sm:rounded-[2.5rem] overflow-hidden border border-white/10 flex flex-col min-h-0 shadow-2xl">
          <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-murzak-cyan/20 bg-murzak-navy text-white flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-murzak-cyan/90">
                Murzak Cloud
              </p>
              <h3 className="text-lg sm:text-2xl font-black tracking-tighter text-white mt-1">
                Launch a cloud resource
              </h3>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-xl p-2 border border-white/15 text-white/80 hover:text-murzak-cyan hover:border-murzak-cyan bg-white/5 hover:bg-white/10"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-8 space-y-6">
            <div className="flex flex-wrap gap-2">
              {CLOUD_LAUNCH_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handlePickCategory(cat)}
                  className={`px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest border transition-all ${
                    category === cat
                      ? "bg-murzak-cyan text-murzak-navy border-murzak-cyan"
                      : "border-white/15 text-slate-300 hover:border-murzak-cyan/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {servicesForCategory.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => setSelectedId(svc.id)}
                  className={`text-left rounded-3xl p-5 border transition-all ${
                    selectedId === svc.id
                      ? "border-murzak-cyan bg-murzak-cyan/10"
                      : "border-white/10 bg-white/5 hover:border-murzak-cyan/40"
                  }`}
                >
                  <p className="text-sm font-black text-white">{svc.name}</p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1 leading-relaxed">
                    {svc.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                    <span>{svc.specs.ram} RAM</span>
                    <span>·</span>
                    <span>{svc.specs.storage}</span>
                  </div>
                  <p className="mt-3 text-lg font-black text-murzak-cyan">
                    {formatKes(svc.pricing.monthlyKes)}/mo
                  </p>
                </button>
              ))}
              {servicesForCategory.length === 0 && (
                <p className="text-sm font-bold text-slate-400 col-span-2">
                  No resources available in this category yet.
                </p>
              )}
            </div>

            {selected?.requiresRepo && (
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/app"
                  className="mt-2 w-full rounded-2xl px-5 py-4 bg-black/20 border border-white/10 text-white font-bold focus:outline-none focus:ring-2 focus:ring-murzak-cyan"
                />
              </div>
            )}

            {selected?.requiresDomainChoice && (
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                  Domain
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DOMAIN_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setDomainChoice(choice)}
                      className={`px-4 py-2 rounded-full text-[11px] font-black border ${
                        domainChoice === choice
                          ? "bg-murzak-cyan text-murzak-navy border-murzak-cyan"
                          : "border-white/15 text-slate-300"
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {err && (
              <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 flex items-start gap-2 text-sm font-bold">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {err}
              </div>
            )}
          </div>

          <div className="p-5 sm:p-6 border-t border-white/10 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p>
              <p className="text-xl font-black text-white">
                {selected ? formatKes(selected.pricing.monthlyKes) : "—"}/mo
              </p>
            </div>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={submitting || !selected}
              className="px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-murzak-cyan text-murzak-navy flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {submitting ? "Launching…" : "Launch now"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors. (If `formatKes`/`DomainChoice`/`CloudLaunchCategory` aren't exported with those exact names, fix the import to match Task 2's actual export names before proceeding — do not rename on this side.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CloudLaunchModal.tsx
git commit -m "feat: add CloudLaunchModal — instant single-resource cloud checkout picker"
```

---

### Task 4: Wire `Cloud.tsx` — entry point + deep link

**Files:**
- Modify: `frontend/src/pages/Cloud.tsx`

**Interfaces:**
- Consumes: `CloudLaunchModal` (Task 3, default export, props as defined there).
- Produces: nothing new for later tasks — this is a leaf wiring task.

`Cloud.tsx`'s `NavProps` (from `frontend/src/types.ts`) already provides
`onNavigate`. This task needs `isLoggedIn` too, which `Cloud.tsx` doesn't
currently receive — check how `App.tsx:306` renders `<Cloud onNavigate={onNavigate} isLoading={isPageLoading} />` and add `isLoggedIn={isLoggedIn}` there, matching how `Pricing.tsx` already receives it at `App.tsx:307`.

- [ ] **Step 1: Pass `isLoggedIn` into `Cloud` from `App.tsx`**

In `frontend/src/App.tsx`, change:

```tsx
              <Route path="/cloud" element={<Cloud onNavigate={onNavigate} isLoading={isPageLoading} />} />
```

to:

```tsx
              <Route path="/cloud" element={<Cloud onNavigate={onNavigate} isLoading={isPageLoading} isLoggedIn={isLoggedIn} />} />
```

- [ ] **Step 2: Update `Cloud.tsx`'s props type and add the modal**

In `frontend/src/pages/Cloud.tsx`, replace the top of the file:

```tsx
import React from 'react';
import {
  ArrowRight, Globe, Mail, Database, HardDrive, ShieldCheck, RefreshCw,
  Activity, Headphones, Smartphone,
} from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';

const Cloud: React.FC<NavProps> = ({ onNavigate }) => {
```

with:

```tsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Globe, Mail, Database, HardDrive, ShieldCheck, RefreshCw,
  Activity, Headphones, Smartphone,
} from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';

type CloudProps = NavProps & { isLoggedIn?: boolean };

const Cloud: React.FC<CloudProps> = ({ onNavigate, isLoggedIn = false }) => {
  const [searchParams] = useSearchParams();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchServiceId, setLaunchServiceId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const launch = searchParams.get('launch');
    if (launch) {
      setLaunchServiceId(launch);
      setLaunchOpen(true);
    }
  }, [searchParams]);
```

- [ ] **Step 3: Change the hero CTA and mount the modal**

Replace the hero CTA block:

```tsx
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => onNavigate('pricing')}>
              Build my plan <ArrowRight size={18} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => onNavigate('test-request')}>
              Try it free for 36h
            </Button>
          </div>
```

with:

```tsx
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => { setLaunchServiceId(undefined); setLaunchOpen(true); }}>
              Launch a resource <ArrowRight size={18} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => onNavigate('test-request')}>
              Try it free for 36h
            </Button>
          </div>
```

Then, right before the closing `</main>` tag at the end of the component's
returned JSX, mount the modal:

```tsx
      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={launchServiceId}
      />
    </main>
  );
};

export default Cloud;
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build`
Expected: no errors, build succeeds.

- [ ] **Step 5: Manual browser check**

Start the dev server, navigate to `/cloud`, click "Launch a resource" —
the modal should open showing the App Hosting category by default. Switch
categories, confirm each shows only volume-class resources with correct
prices. Navigate to `/cloud?launch=starter-db-mongo` directly — the modal
should auto-open pre-selected on Database Hosting / MongoDB.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/Cloud.tsx
git commit -m "feat: wire CloudLaunchModal into Cloud.tsx hero CTA + ?launch= deep link"
```

---

### Task 5: `Login.tsx` — prefill repo URL from a pending cloud launch

**Files:**
- Modify: `frontend/src/pages/Login.tsx`

**Interfaces:**
- Consumes: the `murzak_plan_selection_pending` localStorage payload written by `CloudLaunchModal.launchLoggedOut` (Task 3), specifically its optional `repoUrl` field.
- Produces: nothing for later tasks.

Without this, a not-logged-in visitor who typed a repo URL into the
`CloudLaunchModal` would have to type it again on the signup form's own
"GitHub URL or App Link" field (`formData.sourceCode`) — this task removes
that duplicate step by reading it out of the same pending-selection payload
`Login.tsx` already parses in `attachPendingSelection`.

- [ ] **Step 1: Add the prefill effect**

In `frontend/src/pages/Login.tsx`, right after the existing trial-prefill
effect (the `useEffect` ending at line 115, which reads `murzak_selected_plan`
for trial email/company prefill), add a new effect:

```tsx
  // If a pending cloud-launch selection carries a repo URL (App Hosting),
  // prefill the signup form's repo field so the visitor doesn't retype it.
  useEffect(() => {
    try {
      const pendingRaw = localStorage.getItem("murzak_plan_selection_pending");
      if (!pendingRaw) return;
      const pending = JSON.parse(pendingRaw);
      if (pending?.repoUrl) {
        setFormData((prev) => (prev.sourceCode ? prev : { ...prev, sourceCode: pending.repoUrl }));
      }
    } catch (e) {
      console.warn("Repo URL prefill failed", e);
    }
  }, []);
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual browser check**

Clear localStorage, go to `/cloud`, launch "App Hosting" with a repo URL
filled in, while logged out. Confirm you land on `/login` in signup mode,
and the "Repository URL / GitHub URL or App Link" field is already filled
with the URL you typed in the picker.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Login.tsx
git commit -m "feat: prefill signup repo URL from a pending cloud-launch selection"
```

---

### Task 6: End-to-end Playwright coverage

**Files:**
- Create: `frontend/e2e/cloud-launch.spec.ts`

**Interfaces:**
- Consumes: the live app (via `page.goto`), the mock PayPal capture endpoint `/api/paypal/capture-order` with `orderID: 'MOCK_PAYPAL_SUCCESS'` (same mechanism `frontend/e2e/customer-journey.spec.ts:63-76` already uses — non-prod + `MOCK_FRAPPE` gated per `[[murzaktech-byoa-app-hosting]]`).
- Produces: nothing for later tasks — this is the final verification task.

- [ ] **Step 1: Write the not-logged-in branch test**

Create `frontend/e2e/cloud-launch.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('E2E Murzak Cloud instant checkout', () => {
  const randomSuffix = Math.floor(Math.random() * 100000);

  test('logged-out visitor launches App Hosting, registers, and pays', async ({ page }) => {
    const testEmail = `test_cloud_${randomSuffix}@example.com`;
    const testPassword = 'TestPassword123!';
    const repoUrl = 'https://github.com/CycloneKE/WanderLust';

    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

    // 1. Deep-link straight into the App Hosting resource.
    await page.goto('/cloud?launch=starter-app-hosting');

    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('https://github.com/you/app').fill(repoUrl);
    await launchBtn.click();

    // 2. Unauthenticated -> redirected to Login (signup mode), repo prefilled.
    await expect(page).toHaveURL(/.*\/login.*/);
    const repoInput = page.locator('input[value="' + repoUrl + '"]');
    await expect(repoInput).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Cloud Test User');
    await page.getByPlaceholder('My Company Ltd').fill('Cloud Test Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing Murzak Cloud');
    await page.getByPlaceholder('sam@company.co.ke').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    // 3. Auto-attach should redirect straight to payment.
    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });

    const invoiceMatch = page.url().match(/\/payment\/([^/]+)/);
    const invoiceId = invoiceMatch ? invoiceMatch[1] : '';
    expect(invoiceId).toBeTruthy();

    await page.evaluate(async (invId) => {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
      if (res.ok) window.location.href = '/portal/overview';
    }, invoiceId);

    await expect(page).toHaveURL(/.*\/portal\/overview/);
    const appHostingRow = page.locator('text=App Hosting (Node.js / Docker)').first();
    await expect(appHostingRow).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd frontend && npx playwright test e2e/cloud-launch.spec.ts`
Expected: 1 passed. If the repo-prefill locator or button names don't match
what's actually rendered, adjust the selector to match the real DOM (do not
change the feature to match a wrong guess in this test) and re-run.

- [ ] **Step 3: Add the logged-in-with-a-paid-plan branch**

Append a second test to the same `describe` block in
`frontend/e2e/cloud-launch.spec.ts`:

```ts
  test('logged-in Business-plan customer launches a second cloud resource via add-on', async ({ page }) => {
    const testEmail = `test_cloud_biz_${randomSuffix}@example.com`;
    const testPassword = 'TestPassword123!';

    // Bootstrap: register + buy a Business-plan service first (mirrors
    // customer-journey.spec.ts's POS purchase), so this account already has
    // a PAID Business plan before we touch the cloud picker.
    await page.goto('/pricing?configure=biz-pos-inventory');
    const checkoutBtn = page.getByRole('button', { name: /Continue to checkout/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    const domainInput = page.locator('input[placeholder="myshop"]');
    if (await domainInput.isVisible()) await domainInput.fill(`bizshop${randomSuffix}`);
    await checkoutBtn.click();

    await expect(page).toHaveURL(/.*\/login.*/);
    await page.getByRole('button', { name: /Need a New Account\? Get Started/i }).click();
    await page.getByPlaceholder('Samuel Okoth').fill('Biz Cloud Tester');
    await page.getByPlaceholder('My Company Ltd').fill('Biz Cloud Co');
    await page.getByPlaceholder('e.g. Launching Logistics App').fill('Testing add-on cloud launch');
    await page.getByPlaceholder('sam@company.co.ke').fill(testEmail);
    await page.getByPlaceholder('••••••••').fill(testPassword);
    await page.getByRole('button', { name: /I authorize Murzak to help set up/i }).click();
    await page.getByRole('button', { name: 'Create My Project & Launch', exact: true }).click();

    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });
    const firstInvoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    await page.evaluate(async (invId) => {
      await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceDocName: invId, orderID: 'MOCK_PAYPAL_SUCCESS' }),
      });
    }, firstInvoiceId);

    // Now this account has a PAID Business plan. Launch a Light-tier volume
    // resource — this must succeed via /api/addons/invoice/create, which
    // before Task 1's fix would have rejected it with a tier-mismatch error.
    await page.goto('/cloud?launch=starter-storage');
    const launchBtn = page.getByRole('button', { name: /Launch now/i });
    await expect(launchBtn).toBeVisible({ timeout: 10000 });
    await launchBtn.click();

    await expect(page).toHaveURL(/.*\/payment\/.+/, { timeout: 15000 });
    const secondInvoiceId = page.url().match(/\/payment\/([^/]+)/)?.[1] || '';
    expect(secondInvoiceId).toBeTruthy();
    expect(secondInvoiceId).not.toBe(firstInvoiceId);
  });
```

- [ ] **Step 4: Run the full spec**

Run: `cd frontend && npx playwright test e2e/cloud-launch.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: Run the full existing e2e suite to check for regressions**

Run: `cd frontend && npx playwright test`
Expected: all specs (`contact`, `auth-guards`, `pricing`, `customer-journey`, `navigation`, `cloud-launch`) pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/cloud-launch.spec.ts
git commit -m "test: add e2e coverage for Murzak Cloud instant checkout (both auth branches)"
```

---

## Self-Review Notes

- **Spec coverage:** entry point (Task 4), picker UI + 4 categories + resource-specific fields (Task 3), auth branching for both logged-out and logged-in-with-paid-plan (Task 3 + Task 1), the backend `capacityClass` gating fix (Task 1), repo-URL threading for both branches (Task 3's `attachRepoIfNeeded` + Task 5's prefill), e2e verification (Task 6). No spec section is without a task.
- **Type consistency:** `CloudLaunchCategory`/`cloudLaunchCatalog`/`CLOUD_LAUNCH_CATEGORIES` (Task 2) are the exact names imported in Task 3 and Task 4. `invoiceId` (Task 1's response field) is the exact name `CloudLaunchModal` reads in Task 3. `formData.sourceCode` (Task 5) matches the existing field name already in `Login.tsx`.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command with expected output.
