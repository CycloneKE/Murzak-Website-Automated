/**
 * Murzak Cloud app templates.
 *
 * Each entry below is a plain description of one deployable app: its images,
 * environment variables, storage and health checks. The Coolify lane turns any
 * entry into a hardened Docker Compose stack, attaches a
 * `name.cloud.murzaktech.tech` address, and returns the login details. To add
 * a new app you add one entry here and one product block in
 * frontend/src/config/serviceCatalog.ts; no other code changes are needed.
 *
 * Entry fields (all optional unless stated):
 *   primaryService  (required) the service that serves the website
 *   primaryPort     (required) port that service listens on
 *   domainBaseEnv   env var holding the domain zone (always CLOUD_DOMAIN_BASE here)
 *   secrets         secrets generated per customer: { name: "random" | "complexPassword" }
 *   services        (required) map of compose services; see below
 *   accessDetails   function (ctx, job) returning what the portal shows the customer
 *
 * Service fields: image, volumeName + volumePath (+ extraVolumes), environment(ctx, job),
 * dependsOn, healthcheck(ctx), command (shell script string, or an array of arguments),
 * user, extraCaps (extra Linux capabilities on top of the hardened baseline).
 *
 * A note on "$$": Docker Compose treats "$$" as a literal "$". Use it for any
 * shell or PHP variable inside a command or environment value.
 */

const DOMAIN_ENV = "CLOUD_DOMAIN_BASE";
const TZ = "Africa/Nairobi";

/** Entrypoints that start as root and then drop to an app user need these. */
const FILE_CAPS = ["DAC_OVERRIDE", "FOWNER"];
/** Apache (WordPress, Nextcloud) binds port 80 as root, then signals its workers. */
const APACHE_CAPS = [...FILE_CAPS, "KILL", "NET_BIND_SERVICE"];

/** web_account is the portal user (normally an email); fall back to a Murzak address. */
function adminEmailFor(job) {
  const acct = String((job && job.web_account) || "");
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(acct)) return acct;
  return process.env.SMTP_FROM_EMAIL || process.env.WP_FALLBACK_ADMIN_EMAIL || "admin@murzaktech.tech";
}

function hostOf(fqdn) {
  return String(fqdn).replace(/^https?:\/\//, "");
}

/** Shared PostgreSQL building block. */
function postgres({ user, db }) {
  return {
    image: "postgres:16",
    volumeName: "pg-data",
    volumePath: "/var/lib/postgresql/data",
    extraCaps: FILE_CAPS,
    environment: (ctx) => ({
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: ctx.dbPassword,
      POSTGRES_DB: db,
    }),
    healthcheck: () =>
      `      test: ["CMD-SHELL", "pg_isready -U ${user} -d ${db}"]\n` +
      `      interval: 5s\n` +
      `      timeout: 5s\n` +
      `      retries: 20\n`,
  };
}

const CLOUD_APPS = {
  // ------------------------------------------------------------------
  // n8n: workflow automation
  // ------------------------------------------------------------------
  "starter-n8n": {
    primaryService: "n8n",
    primaryPort: 5678,
    domainBaseEnv: DOMAIN_ENV,
    secrets: { dbPassword: "random", encryptionKey: "random" },
    accessDetails: (ctx) => ({
      adminUrl: ctx.fqdn,
      note: "Open this address to create your owner account. The first person to open it becomes the owner, so do it straight away.",
    }),
    services: {
      postgres: postgres({ user: "n8n", db: "n8n" }),
      n8n: {
        image: "n8nio/n8n:latest",
        volumeName: "n8n-data",
        volumePath: "/home/node/.n8n",
        environment: (ctx) => ({
          DB_TYPE: "postgresdb",
          DB_POSTGRESDB_HOST: "postgres",
          DB_POSTGRESDB_PORT: "5432",
          DB_POSTGRESDB_DATABASE: "n8n",
          DB_POSTGRESDB_USER: "n8n",
          DB_POSTGRESDB_PASSWORD: ctx.dbPassword,
          N8N_HOST: hostOf(ctx.fqdn),
          N8N_PORT: "5678",
          N8N_PROTOCOL: "https",
          N8N_EDITOR_BASE_URL: ctx.fqdn,
          WEBHOOK_URL: `${ctx.fqdn}/`,
          N8N_PROXY_HOPS: "2",
          N8N_ENCRYPTION_KEY: ctx.encryptionKey,
          GENERIC_TIMEZONE: TZ,
          TZ,
        }),
        dependsOn: { postgres: "service_healthy" },
      },
    },
  },

  // ------------------------------------------------------------------
  // Ghost: publishing and newsletters
  // ------------------------------------------------------------------
  "starter-ghost": {
    primaryService: "ghost",
    primaryPort: 2368,
    domainBaseEnv: DOMAIN_ENV,
    secrets: { dbPassword: "random", dbRootPassword: "random" },
    accessDetails: (ctx) => ({
      adminUrl: `${ctx.fqdn}/ghost`,
      note: "Open the admin address to create your owner account. The first person to open it becomes the owner, so do it straight away.",
    }),
    services: {
      mysql: {
        image: "mysql:8.0",
        volumeName: "db-data",
        volumePath: "/var/lib/mysql",
        extraCaps: FILE_CAPS,
        environment: (ctx) => ({
          MYSQL_ROOT_PASSWORD: ctx.dbRootPassword,
          MYSQL_DATABASE: "ghost",
          MYSQL_USER: "ghost",
          MYSQL_PASSWORD: ctx.dbPassword,
        }),
        // "ping" succeeds whenever the server is alive, so no password is needed here.
        healthcheck: () =>
          `      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "--silent"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 30\n`,
      },
      ghost: {
        image: "ghost:5-alpine",
        volumeName: "content",
        volumePath: "/var/lib/ghost/content",
        environment: (ctx) => ({
          url: ctx.fqdn,
          database__client: "mysql",
          database__connection__host: "mysql",
          database__connection__user: "ghost",
          database__connection__password: ctx.dbPassword,
          database__connection__database: "ghost",
          // Outgoing email is only configured when the platform relay exists.
          ...(process.env.SMTP_HOST
            ? {
                mail__transport: "SMTP",
                mail__from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
                mail__options__host: process.env.SMTP_HOST,
                mail__options__port: process.env.SMTP_PORT || "587",
                mail__options__auth__user: process.env.SMTP_USER || "",
                mail__options__auth__pass: process.env.SMTP_PASS || "",
              }
            : {}),
        }),
        dependsOn: { mysql: "service_healthy" },
      },
    },
  },

  // ------------------------------------------------------------------
  // Nextcloud: files, calendars, contacts
  // ------------------------------------------------------------------
  "starter-nextcloud": {
    primaryService: "nextcloud",
    primaryPort: 80,
    domainBaseEnv: DOMAIN_ENV,
    secrets: { dbPassword: "random", dbRootPassword: "random", adminPassword: "random" },
    accessDetails: (ctx) => ({
      adminUrl: ctx.fqdn,
      username: "admin",
      password: ctx.adminPassword,
    }),
    services: {
      mariadb: {
        image: "mariadb:10.11",
        volumeName: "db-data",
        volumePath: "/var/lib/mysql",
        extraCaps: FILE_CAPS,
        // Settings Nextcloud requires from its database.
        command: ["--transaction-isolation=READ-COMMITTED", "--log-bin=binlog", "--binlog-format=ROW"],
        environment: (ctx) => ({
          MARIADB_DATABASE: "nextcloud",
          MARIADB_USER: "nextcloud",
          MARIADB_PASSWORD: ctx.dbPassword,
          MARIADB_ROOT_PASSWORD: ctx.dbRootPassword,
        }),
        healthcheck: () =>
          `      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]\n` +
          `      interval: 5s\n` +
          `      timeout: 5s\n` +
          `      retries: 30\n`,
      },
      nextcloud: {
        image: "nextcloud:apache",
        volumeName: "nc-data",
        volumePath: "/var/www/html",
        extraCaps: APACHE_CAPS,
        environment: (ctx) => ({
          MYSQL_HOST: "mariadb",
          MYSQL_DATABASE: "nextcloud",
          MYSQL_USER: "nextcloud",
          MYSQL_PASSWORD: ctx.dbPassword,
          NEXTCLOUD_ADMIN_USER: "admin",
          NEXTCLOUD_ADMIN_PASSWORD: ctx.adminPassword,
          NEXTCLOUD_TRUSTED_DOMAINS: hostOf(ctx.fqdn),
          OVERWRITEPROTOCOL: "https",
          OVERWRITEHOST: hostOf(ctx.fqdn),
          TRUSTED_PROXIES: "10.0.0.0/8 172.16.0.0/12 192.168.0.0/16",
          PHP_MEMORY_LIMIT: "512M",
          PHP_UPLOAD_LIMIT: "512M",
        }),
        dependsOn: { mariadb: "service_healthy" },
        healthcheck: () =>
          `      test: ["CMD-SHELL", "bash -c 'exec 3<>/dev/tcp/127.0.0.1/80'"]\n` +
          `      interval: 15s\n` +
          `      timeout: 5s\n` +
          `      retries: 20\n`,
      },
    },
  },

  // ------------------------------------------------------------------
  // Uptime Kuma: website and service monitoring
  // ------------------------------------------------------------------
  "starter-uptime-kuma": {
    primaryService: "kuma",
    primaryPort: 3001,
    domainBaseEnv: DOMAIN_ENV,
    secrets: {},
    accessDetails: (ctx) => ({
      adminUrl: ctx.fqdn,
      note: "Open this address to create your admin account. The first person to open it becomes the admin, so do it straight away.",
    }),
    services: {
      kuma: {
        image: "louislam/uptime-kuma:1",
        volumeName: "kuma-data",
        volumePath: "/app/data",
        environment: () => ({ TZ }),
      },
    },
  },

  // ------------------------------------------------------------------
  // NocoDB: spreadsheet-style database and no-code backend
  // ------------------------------------------------------------------
  "starter-nocodb": {
    primaryService: "nocodb",
    primaryPort: 8080,
    domainBaseEnv: DOMAIN_ENV,
    secrets: { dbPassword: "random", jwtSecret: "random", adminPassword: "complexPassword" },
    accessDetails: (ctx, job) => ({
      adminUrl: ctx.fqdn,
      username: adminEmailFor(job),
      password: ctx.adminPassword,
    }),
    services: {
      postgres: postgres({ user: "nocodb", db: "nocodb" }),
      nocodb: {
        image: "nocodb/nocodb:latest",
        volumeName: "nc-data",
        volumePath: "/usr/app/data",
        environment: (ctx, job) => ({
          NC_DB: `pg://postgres:5432?u=nocodb&p=${ctx.dbPassword}&d=nocodb`,
          NC_AUTH_JWT_SECRET: ctx.jwtSecret,
          NC_PUBLIC_URL: ctx.fqdn,
          NC_ADMIN_EMAIL: adminEmailFor(job),
          NC_ADMIN_PASSWORD: ctx.adminPassword,
        }),
        dependsOn: { postgres: "service_healthy" },
      },
    },
  },
};

module.exports = { CLOUD_APPS, adminEmailFor, DOMAIN_ENV };
