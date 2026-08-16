# E-Signature (DocuSeal) — First Curated Third-Party App

Date: 2026-08-16

## Problem

Murzak's catalog has nothing resembling e-signature. Per the Coolify-ecosystem roadmap discussed in
this session (the "Documents & Collaboration / Sales & Ops / Growth" pillars), E-Signature was picked
as the first product to build because it's pure white space (no overlap with anything already sold,
unlike a Coolify-based DMS which would compete with the existing `biz-docs` product) and
architecturally the simplest: a per-customer `coolify`-lane container, the same shape as Website
Hosting/BYOA already use, not a new provisioning lane.

It's also the first real test of a **curated third-party app** — a pre-built, published Docker image
deployed as a specific product, as opposed to the two things the `coolify` lane already knows how to
deploy: a customer's own BYOA repo (built from source), or (as of the database engine fix, see
[2026-08-16-database-engine-provisioning-fix-design.md](2026-08-16-database-engine-provisioning-fix-design.md))
a small table of raw database engines with no HTTP surface at all.

## Decisions made during brainstorming

1. **DocuSeal, not Documenso.** Confirmed via Docker Hub and DocuSeal's own docs: it ships with
   SQLite by default — no bundled Postgres — so the compose stays single-service, the same shape as
   every other `coolify`-lane job. Documenso mandates Postgres plus more mandatory secrets (encryption
   keys, certificate management), meaning a real multi-service stack. DocuSeal is MIT-licensed with
   strong embeddable/API tooling; Documenso has the stronger cryptographic-signing story but at real
   extra build cost this product doesn't need for a first version.
2. **A separate config table, not a merge into `DB_ENGINE_CONFIG`.** `CURATED_APP_CONFIG` is its own
   small table. Two data points (databases, now e-signature) define a pattern; one doesn't yet
   justify forcing both into one generic mechanism, especially since this app needs domain attachment
   (an HTTP surface) and the databases explicitly do not. When a third curated app is built
   (Invoice Ninja, Cal.com, per the roadmap), that's the natural point to unify.
3. **Murzak's own SMTP relay, reused per customer.** DocuSeal cannot deliver signature invites
   without working SMTP. Murzak already centralizes all outbound platform email (password resets,
   support alerts) through one relay (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`). Every customer's DocuSeal
   instance reuses those same platform credentials — consistent with how outbound email already works
   here, not a new pattern. The shared-sender-reputation tradeoff is named, not solved, in this spec.
4. **Pricing: KES 1,800/mo, KES 0 setup, 512MB RAM, 10GB disk.** Light tier, same self-serve bracket
   as File Storage/the database engines.

## Design

### `CURATED_APP_CONFIG` table and compose builder

A new table in `coolify.js`, parallel in spirit to `DB_ENGINE_CONFIG` but distinct in shape — it
needs domain attachment (an HTTP app) and a single volume path (not an engine-specific data
directory), and its env vars are a flat platform-secret map rather than a per-purchase generated
credential set (aside from `SECRET_KEY_BASE`, which IS generated per purchase):

```js
const CURATED_APP_CONFIG = {
  "starter-esign": {
    image: "docuseal/docuseal:latest",
    port: 3000,
    volumePath: "/data",
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
```

`provision(job, opts)` gains a second branch, checked alongside the existing `dbConfig` branch: if
`job.service_id` matches `CURATED_APP_CONFIG`, build a compose block with the real image, `expose`
the real port, mount a named volume at the config's `volumePath`, and seed the env vars — using the
fqdn `attachServiceUrl` returns (domain attachment runs normally for this branch, unlike the database
branch which skips it) and a freshly generated `SECRET_KEY_BASE`.

`generateDbPassword` is renamed `generateRandomSecret` (it was already generic — `crypto.randomBytes`
producing a URL-safe string — the name was just DB-specific; `SECRET_KEY_BASE` is the second caller).
All existing call sites and tests are updated to the new name; behavior is unchanged.

Missing SMTP config (`SMTP_HOST` unset) is not specially handled — the compose still deploys with
empty `SMTP_*` values, DocuSeal comes up but can't send invites, and that surfaces to the customer as
"emails aren't sending," diagnosable via the existing runtime-logs panel. This matches this lane's
established posture: it does not pre-validate that every env var it seeds is individually meaningful,
it deploys what's configured and lets a real failure surface as a real failure.

### Catalog entry

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
}
```

`"E-Signature"` is added to `CloudLaunchCategory` and `CLOUD_LAUNCH_CATEGORIES` in `serviceCatalog.ts`
so it appears as its own tab in the self-serve instant-launch modal — no icon-map or other per-category
config exists to update beyond those two lists.

### Frontend

None needed beyond the catalog entry. `starter-esign` routes through the existing `coolify` lane like
Website Hosting/BYOA, so the generic `ResourceDetail` page — Overview, env-var/logs via
`ResourceAdminPanel`, the "Connect your domain" form — already covers it. This is the first curated
app to ship with zero new frontend surface, which is itself evidence the "curated app via the coolify
lane" pattern is cheap once the compose builder supports it.

## Out of scope

Embedding DocuSeal's signing widget into a customer's own site (the "embeddable components" DocuSeal
supports) — a real future enhancement, not part of shipping the standalone product. Any SMTP
reputation/deliverability mitigation (e.g. per-customer subaddressing) beyond naming the tradeoff.
Unifying `CURATED_APP_CONFIG` with `DB_ENGINE_CONFIG`.

## Untouched

The existing `coolify.js` DB engine path, `attachServiceUrl`, `resourceLimits`, and every other
existing lane behavior — this adds one new branch and renames one function, nothing else changes.

## Testing

- Pure unit tests for the compose block DocuSeal-branch generation (image/port/volume/env vars),
  mirroring the database engine tests' `axios.create` mocking pattern from
  `backend/test/dbEngineProvisioning.test.js`.
- A regression test confirming the rename (`generateRandomSecret`) doesn't change any existing
  database-engine test's observed behavior.
- A regression test confirming every `service_id` in neither table is still byte-for-byte unaffected.
