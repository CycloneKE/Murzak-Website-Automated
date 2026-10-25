/**
 * WordPress (Murzak Cloud) curated product.
 * node test/wordpressProvisioning.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(n) { console.log(`\n# ${n}`); }

const coolify = require("../services/provisioning/lanes/coolify");
const appDomain = require("../services/provisioning/appDomain");

const LIMITS = { ramMb: 1024, cpus: 1, pidsLimit: 512 };
const cfg = coolify.__test_wordpressConfig;
const FQDN = "https://acme-ab12.cloud.murzaktech.tech";

(async () => {
  section("domain base override");
  ok(appDomain.fqdnFor("acme", "cloud.murzaktech.tech") === "https://acme.cloud.murzaktech.tech", "override base is used");
  ok(appDomain.fqdnFor("acme", "https://cloud.murzaktech.tech/") === "https://acme.cloud.murzaktech.tech", "scheme and trailing slash tolerated");
  const saved = process.env.APP_DOMAIN_BASE; delete process.env.APP_DOMAIN_BASE;
  ok(appDomain.fqdnFor("acme") === "", "no base and no override gives empty (degrades, never guesses)");
  if (saved !== undefined) process.env.APP_DOMAIN_BASE = saved;

  section("compose for starter-wordpress");
  const job = { web_account: "client@example.com" };
  const yaml = coolify.buildMultiServiceComposeYaml("client-starter-wordpress", LIMITS, cfg, FQDN, null, job);
  ok(yaml.includes("wordpress:6-apache") && yaml.includes("mariadb:11") && yaml.includes("wordpress:cli"), "three services with expected images");
  ok(yaml.includes(`WP_SITE_URL: "${FQDN}"`), "site URL is the assigned cloud address");
  ok(yaml.includes('WP_ADMIN_EMAIL: "client@example.com"'), "admin email comes from the portal account");
  ok(yaml.includes('user: "33:33"'), "wpcli runs as www-data");
  ok((yaml.match(/cap_drop:/g) || []).length === 3, "all three containers keep cap_drop ALL");
  ok(yaml.includes("- KILL") && yaml.includes("- NET_BIND_SERVICE"), "apache gets only the extra capabilities it needs");
  ok(!yaml.includes("privileged"), "nothing privileged");
  ok(/wp-data:\/var\/www\/html\n/.test(yaml) && !/wp-data:\/var\/www\/html:ro/.test(yaml), "wpcli shares the WordPress volume read-write");
  ok(yaml.includes("$$WP_ADMIN_PASSWORD") && yaml.includes("$$m->connect_errno"), "shell/PHP variables are Compose-escaped");
  ok((yaml.match(/expose:/g) || []).length === 1 && yaml.includes('- "80"'), "only wordpress exposes port 80");
  ok(/volumes:\n  client-starter-wordpress-db-data:\n  client-starter-wordpress-wp-data:\n/.test(yaml), "two named volumes declared");

  section("access details returned to the portal");
  const ctx = { fqdn: FQDN, adminPassword: "pw123" };
  const acc = cfg.accessDetails(ctx, job);
  ok(acc.adminUrl === `${FQDN}/wp-admin` && acc.username === "siteadmin" && acc.password === "pw123", "admin URL, username and password returned");

  section("domain base selected per product");
  process.env.CLOUD_DOMAIN_BASE = "cloud.murzaktech.tech";
  process.env.APP_DOMAIN_BASE = "apps.murzaktech.tech";
  const wp = coolify.__test_curatedFqdn(cfg, "acme-ab12");
  ok(wp === "https://acme-ab12.cloud.murzaktech.tech", "WordPress lands on the cloud zone");
  const other = coolify.__test_curatedFqdn(coolify.__test_calcomConfig, "acme-ab12");
  ok(other === "https://acme-ab12.apps.murzaktech.tech", "other products keep APP_DOMAIN_BASE");
  delete process.env.CLOUD_DOMAIN_BASE;
  ok(coolify.__test_curatedFqdn(cfg, "acme-ab12") === "https://acme-ab12.apps.murzaktech.tech", "falls back to APP_DOMAIN_BASE if CLOUD_DOMAIN_BASE is unset");
  if (saved === undefined) delete process.env.APP_DOMAIN_BASE; else process.env.APP_DOMAIN_BASE = saved;
  delete process.env.CLOUD_DOMAIN_BASE;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
