# Invoicing (Invoice Ninja) — Multi-Service Curated Apps

Date: 2026-08-17

## Problem

Invoice Ninja is next on the Coolify-ecosystem roadmap (Sales & Ops pillar). Unlike DocuSeal (the first
curated app, SQLite by default, single container), Invoice Ninja genuinely requires a database — and,
per its own reference deployment ([invoiceninja/dockerfiles](https://github.com/invoiceninja/dockerfiles)),
not just one companion service but three: MySQL, Redis (required, not optional), and a separate nginx
container (the app image alone is PHP-FPM only, port 9000, not directly HTTP-servable — confirmed
against the actual `Dockerfile`/`docker-compose.yml` in that repo after an initial web summary claimed
otherwise and was wrong).

This is also not a one-off: checking the rest of the roadmap, nearly everything left (Cal.com → Postgres,
Bookstack → MySQL, Chatwoot → Postgres+Redis, Listmonk → Postgres) needs a real backing database.
DocuSeal was the simple outlier, not the template. So this spec generalizes `CURATED_APP_CONFIG` to
support a multi-service compose, using Invoice Ninja as the first (and most complex) real case.

## Decisions made during brainstorming

1. **Extend the schema, don't rewrite it.** `CURATED_APP_CONFIG` entries can be either the existing
   single-service shape (DocuSeal — untouched, all existing tests keep passing unchanged) or a new
   multi-service shape (`{ services, primaryService, primaryPort }`). `buildCuratedAppComposeYaml`
   branches on which shape it receives. Mirrors the same reasoning already used for keeping
   `DB_ENGINE_CONFIG` separate from `CURATED_APP_CONFIG` — don't force a shared abstraction until a
   second real shape actually shows up needing it.
2. **Four services, matching the project's own reference compose exactly**: `mysql`, `redis`, `app`,
   `nginx`. Not simplified or guessed at — pulled from the real `debian/docker-compose.yml`,
   `debian/nginx/invoiceninja.conf`, and `debian/nginx/laravel.conf` in `invoiceninja/dockerfiles`.
3. **nginx config embedded via a `command:` heredoc, not Compose's `configs:` feature.** After tonight's
   MinIO session (a documented, standard Coolify convention — `SERVICE_FQDN_*` — turning out not to
   work as expected for compose Services in this environment), I'd rather use the most portable,
   maximally-boring mechanism for getting Invoice Ninja's real nginx config into the container than
   trust a newer Compose Specification feature I can't verify Coolify's deploy pipeline handles
   correctly. A `command:` override that writes the config file at container start and then execs
   nginx is guaranteed to work under any Compose-compatible engine.
4. **No automated first-admin-account creation.** Invoice Ninja's `IN_USER_EMAIL`/`IN_PASSWORD`
   bootstrap vars exist, but using them would need a customer email address not reliably available at
   provision time. The customer completes Invoice Ninja's own first-run setup wizard themselves — an
   honest, disclosed extra step, not hidden.
5. **Pricing: KES 3,800/mo, KES 0 setup, 1280MB RAM, 15GB disk.** Re-priced up from the original
   ~KES 2,500-3,000 "app + MySQL" estimate once the real four-service footprint became clear.

## Design

### Schema

```js
const CURATED_APP_CONFIG = {
  "starter-esign": { /* unchanged, single-service shape */ },
  "starter-invoicing": {
    primaryService: "nginx",
    primaryPort: 80,
    services: {
      mysql: {
        image: "mysql:8",
        environment: (ctx) => ({
          MYSQL_DATABASE: "ninja",
          MYSQL_USER: "ninja",
          MYSQL_PASSWORD: ctx.dbPassword,
          MYSQL_ROOT_PASSWORD: ctx.dbRootPassword,
        }),
        volumes: [{ name: "mysql-data", path: "/var/lib/mysql" }],
        healthcheck: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uninja", "-p${MYSQL_PASSWORD}"],
      },
      redis: {
        image: "redis:alpine",
        volumes: [{ name: "redis-data", path: "/data" }],
        healthcheck: ["CMD", "redis-cli", "ping"],
      },
      app: {
        image: "invoiceninja/invoiceninja-debian:latest",
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
        volumes: [{ name: "app-public", path: "/var/www/html/public" }, { name: "app-storage", path: "/var/www/html/storage" }],
        dependsOn: ["mysql", "redis"],
      },
      nginx: {
        image: "nginx:alpine",
        command: "<heredoc writing laravel.conf + invoiceninja.conf, then `nginx -g 'daemon off;'`>",
        volumes: [{ name: "app-public", path: "/var/www/html/public", readOnly: true }, { name: "app-storage", path: "/var/www/html/storage", readOnly: true }],
        dependsOn: ["app"],
      },
    },
  },
};
```

`app-public`/`app-storage` are shared named volumes between `app` and `nginx` (read-write on `app`,
read-only on `nginx`) — this is how the app writes files and nginx serves them directly, exactly
matching the reference compose.

### Generated secrets

Three per purchase, all via the existing `generateRandomSecret()`: `dbPassword`, `dbRootPassword`, and
`appKey` — except `appKey` needs Laravel's specific format (`base64:` + 32 raw random bytes,
base64-encoded), not the `base64url` 24-byte shape `generateRandomSecret` produces. A second small
generator, `generateLaravelAppKey()`, is added alongside it in `coolify.js`.

### Compose builder

`buildCuratedAppComposeYaml` gains a check at the top: if `appConfig.services` exists, delegate to a
new `buildMultiServiceComposeYaml(name, limits, appConfig, ctx)` function; otherwise, run the existing
single-service body completely unchanged. The multi-service builder emits one `services:` block per
entry in `appConfig.services`, applying the same hardening (`cap_drop: ALL` + `CHOWN`/`SETUID`/`SETGID`
+ `no-new-privileges`) to every container, not just the primary one — a database container run as root
during MySQL's own init is exactly the same category of risk the existing hardening exists for.

Only the `primaryService` gets `expose: [primaryPort]` and participates in `attachServiceUrl`'s domain
PATCH — `mysql`/`redis`/`app` are reachable only via Docker's default compose network, by service name,
never exposed.

RAM/CPU limits (`limits.ramMb`/`limits.cpus`, from `resourceLimits(job)`) apply to the WHOLE job today,
computed once. For a 4-container job, splitting that budget per-container evenly would starve MySQL
disproportionately; instead each service gets the full `mem_limit`/`cpus` values as an per-container
ceiling (not a sum) — Docker doesn't enforce an aggregate cross-container limit via `docker compose`
this way, so in practice the 4 containers can jointly use up to ~4x `limits.ramMb` if all spike at once.
This is a known, accepted looseness (documented, not silently ignored) — precise per-container budgeting
is future work if it proves to matter in practice; it doesn't block shipping this.

### Catalog entry

```ts
{
  id: "starter-invoicing",
  name: "Invoicing",
  description: "Send invoices, track payments, and manage clients — your own invoicing tool.",
  category: "Invoicing", // new — no existing ServiceCategory fits; same precedent as adding
    // "E-Signature" for starter-esign rather than forcing it into "Apps"
  tier: "Light",
  capacityClass: "volume",
  resources: { ramMb: 1280, diskGb: 15 },
  pricing: { model: "addon", monthlyKes: 3800, setupKes: 0 },
  highlights: ["Unlimited clients", "Payment tracking", "Your own domain"],
}
```

## Out of scope

Automated first-admin bootstrap (`IN_USER_EMAIL`/`IN_PASSWORD`). Precise per-container RAM/CPU
sub-budgeting within the 4-service job. Payment gateway integration (Stripe/PayPal/M-Pesa) inside
Invoice Ninja itself — customers configure their own via its settings UI, same as any self-hosted
instance would.

## Testing

- Pure unit tests for `generateLaravelAppKey()` (format: `base64:` prefix, decodes to 32 bytes,
  randomness across calls).
- Compose-generation tests confirming all four services appear with correct images, the nginx
  `command:` contains the real `fastcgi_pass app:9000` line (not a guessed/simplified one), only
  `nginx` gets `expose:`, and hardening flags apply to every service.
- A regression test confirming `starter-esign`'s compose output is byte-for-byte unchanged by this
  schema extension (proves the branch-on-shape approach didn't disturb the existing single-service path).
- Route through to `attachServiceUrl`/`access.url` unchanged in shape from the DocuSeal case — same
  `access.url === patchedDomain` assertion pattern, just for the `nginx` service's uuid.
