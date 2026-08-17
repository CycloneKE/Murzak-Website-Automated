# Scheduling (Cal.com) — Third Curated App

Date: 2026-08-17

## Problem

Cal.com is item 3 on the Coolify-ecosystem curated-apps roadmap (after DocuSeal/E-Signature and Invoice
Ninja/Invoicing — see [2026-08-17-invoice-ninja-multiservice-design.md](2026-08-17-invoice-ninja-multiservice-design.md)).

Cal.com's self-hosted product was rebranded "Cal.diy" in its docs (cal.diy), but the docs site's own image
reference (`calcom/cal.diy`) turned out to be an **empty** Docker Hub repository (confirmed via the Docker
Hub v2 API — zero tags). The actual published image, still updated as of this writing, is
`calcom/cal.com:latest`. This is exactly the kind of "the docs summary was wrong" trap the Invoice Ninja
spec warned about — confirmed against the real Docker Hub API, not the marketing docs, before committing
to an image reference.

Structurally Cal.com is simpler than Invoice Ninja: it needs Postgres (not MySQL), Redis is optional (not
required — skipped here to keep the footprint down), and it needs no separate nginx container — the
published image is a Next.js server that serves HTTP directly on port 3000. Its entrypoint
(`scripts/start.sh`, read verbatim from the `calcom/cal.com` GitHub repo) waits for the database and runs
`prisma migrate deploy` automatically on every boot, so no separate migration step is needed on our side.

## Decisions made during brainstorming

1. **Generalize secret generation in `buildMultiServiceComposeYaml`, don't hardcode a second app's secrets
   into it.** That function currently hardcodes Invoice Ninja's exact three secrets (`dbPassword`,
   `dbRootPassword`, a Laravel-format `appKey`) inline. Cal.com needs a different set (plain random
   `dbPassword`, `nextAuthSecret`, `encryptionKey`, `cronApiKey` — no Laravel format at all). A second
   real case with different secret needs is the trigger to generalize, per the precedent set in the
   Invoice Ninja spec ("don't force a shared abstraction until a second real shape actually shows up
   needing it" — that point has now arrived for secret generation specifically, not for the whole
   single-vs-multi-service schema split, which stays as-is).
2. **`starter-invoicing` gets a `secrets` declaration too**, for the same generic mechanism to generate
   its ctx. This is a pure refactor with no behavioral change — same generators (`generateRandomSecret`,
   `generateLaravelAppKey`), same resulting ctx keys — so its existing byte-for-byte compose-output
   regression test is expected to keep passing unmodified.
3. **No Redis, no nginx.** Redis is documented as optional for Cal.com's core scheduling functionality;
   omitted to keep this at 2 containers instead of 3. No nginx: the app image serves HTTP directly.
4. **`:latest`, matching DocuSeal/Invoice Ninja precedent**, not a pinned version — consistency with the
   existing two curated apps outweighs the (accepted) risk of an upstream breaking release landing
   unnoticed.
5. **No automated first-admin bootstrap.** Same precedent as Invoice Ninja: the customer completes
   Cal.com's own `/auth/signup` themselves — an honest, disclosed extra step, not hidden.
6. **Pricing: KES 3,200/mo, KES 0 setup, 1024MB RAM, 10GB disk.** Sized between DocuSeal (512MB, single
   container) and Invoice Ninja (1280MB, 4 containers) — a Next.js SSR app plus a small Postgres instance.

## Design

### Secret generation refactor

```js
const SECRET_GENERATORS = { random: generateRandomSecret, laravelAppKey: generateLaravelAppKey };

function buildSecretCtx(appConfig, fqdn) {
  const ctx = { fqdn };
  for (const [key, kind] of Object.entries(appConfig.secrets || {})) ctx[key] = SECRET_GENERATORS[kind]();
  return ctx;
}
```

`buildMultiServiceComposeYaml` calls `buildSecretCtx(appConfig, fqdn)` instead of its current three
hardcoded `generateRandomSecret()`/`generateLaravelAppKey()` calls.

`starter-invoicing` gains:
```js
secrets: { dbPassword: "random", dbRootPassword: "random", appKey: "laravelAppKey" },
```

### Schema

```js
"starter-scheduling": {
  primaryService: "app",
  primaryPort: 3000,
  secrets: { dbPassword: "random", nextAuthSecret: "random", encryptionKey: "random", cronApiKey: "random" },
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

`app` declares no `volumeName` — it is stateless (all state lives in Postgres), matching how the existing
builder already treats services with no `volumeName` (no `volumes:` block emitted for that service).

Only `app` (the `primaryService`) gets `expose: [primaryPort]` and participates in `attachServiceUrl`'s
domain PATCH; `postgres` is reachable only via the compose network, by service name, never exposed — same
posture as every other database container this lane builds.

The existing hardening block (`cap_drop: ALL` + `CHOWN`/`SETUID`/`SETGID` + `no-new-privileges`) applies to
both services unchanged, via the existing `hardeningBlock(limits)` helper.

### Catalog entry

```ts
{
  id: "starter-scheduling",
  name: "Scheduling",
  description: "Booking pages, calendar sync, and meeting scheduling — your own scheduling tool.",
  category: "Scheduling", // new — no existing ServiceCategory fits; same precedent as adding
    // "E-Signature" for starter-esign and "Invoicing" for starter-invoicing rather than forcing
    // it into "Apps"
  tier: "Light",
  capacityClass: "volume",
  resources: { ramMb: 1024, diskGb: 10 },
  pricing: { model: "addon", monthlyKes: 3200, setupKes: 0 },
  highlights: ["Unlimited booking pages", "Calendar sync", "Your own domain"],
}
```

## Out of scope

Redis (optional per Cal.com's own docs — omitted to keep the footprint at 2 containers). Automated
first-admin bootstrap. SSO/SAML login. Stripe billing integration inside Cal.com itself — customers
configure their own via its settings UI, same posture as Invoice Ninja's payment gateway scope note.
Pinning to a specific image version (deferred — `:latest` chosen for consistency; revisit if an upstream
breaking release actually causes a problem).

## Testing

- Unit tests for `SECRET_GENERATORS`/`buildSecretCtx`: correct generator dispatched per declared kind,
  distinct random values across calls.
- Compose-generation tests confirming both `starter-scheduling` services appear with correct images, the
  `postgres` healthcheck uses `pg_isready`, `DATABASE_URL`/`DATABASE_HOST` are correctly formatted, only
  `app` gets `expose:`, and hardening flags apply to both services.
- A regression test confirming `starter-esign`'s and `starter-invoicing`'s compose output is byte-for-byte
  unchanged by the `buildSecretCtx` refactor (proves generalizing secret generation didn't disturb either
  existing path).
- Route-through to `attachServiceUrl`/`access.url` unchanged in shape from the DocuSeal/Invoice Ninja
  cases — same `access.url === patchedDomain` assertion pattern, for the `app` service's uuid.
