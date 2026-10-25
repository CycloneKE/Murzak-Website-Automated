/**
 * Every Murzak Cloud app template must yield a valid, hardened Compose stack.
 * Runs for each entry in cloudApps.js plus WordPress, so adding a new app
 * automatically adds it to these checks.
 * node test/cloudApps.test.js
 */
const yaml = require("js-yaml");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const coolify = require("../services/provisioning/lanes/coolify");
const { CLOUD_APPS } = require("../services/provisioning/lanes/cloudApps");

const LIMITS = { ramMb: 1024, cpus: 1, pidsLimit: 512 };
const FQDN = "https://acme-ab12.cloud.murzaktech.tech";
const JOB = { web_account: "client@example.com" };

const apps = { ...CLOUD_APPS, "starter-wordpress": coolify.__test_wordpressConfig, "starter-woocommerce": coolify.__test_woocommerceConfig };

// docker compose can validate offline; skip that extra check if it is absent.
function composeAvailable() {
  try { execFileSync("docker", ["compose", "version"], { stdio: "ignore" }); return true; } catch { return false; }
}
const HAS_COMPOSE = composeAvailable();

for (const [id, cfg] of Object.entries(apps)) {
  console.log(`\n# ${id}`);
  const text = coolify.buildMultiServiceComposeYaml(`acme-${id}`, LIMITS, cfg, FQDN, null, JOB);
  let doc;
  try { doc = yaml.load(text); ok(true, "YAML parses"); } catch (e) { ok(false, "YAML parses: " + e.message); continue; }

  const names = Object.keys(doc.services);
  ok(names.includes(cfg.primaryService), "primary service exists");
  ok(cfg.domainBaseEnv === "CLOUD_DOMAIN_BASE", "uses the cloud domain zone");
  ok(names.every((n) => doc.services[n].cap_drop && doc.services[n].cap_drop.includes("ALL")), "every container drops all capabilities");
  ok(names.every((n) => !doc.services[n].privileged), "nothing privileged");
  ok(names.every((n) => (doc.services[n].security_opt || []).includes("no-new-privileges:true")), "no-new-privileges everywhere");
  ok(names.every((n) => /m$/.test(String(doc.services[n].mem_limit))), "every container has a memory limit");
  const exposed = names.filter((n) => doc.services[n].expose);
  ok(exposed.length === 1 && exposed[0] === cfg.primaryService, "only the primary service is exposed");
  const depsOk = names.every((n) => Object.keys(doc.services[n].depends_on || {}).every((d) => names.includes(d)));
  ok(depsOk, "depends_on only references real services");
  const declared = Object.keys(doc.volumes || {});
  const used = names.flatMap((n) => (doc.services[n].volumes || []).map((v) => v.split(":")[0]));
  ok(used.every((v) => declared.includes(v)), "every mounted volume is declared");
  ok(typeof cfg.accessDetails === "function", "accessDetails defined for the portal");

  if (HAS_COMPOSE) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cloudapp-")), "compose.yml");
    fs.writeFileSync(f, text);
    try { execFileSync("docker", ["compose", "-f", f, "config", "-q"], { stdio: "pipe" }); ok(true, "docker compose accepts the file"); }
    catch (e) { ok(false, "docker compose accepts the file: " + String(e.stderr || e.message).slice(0, 300)); }
  }
}

console.log("\n# secrets");
const a = coolify.buildMultiServiceComposeYaml("x-a", LIMITS, apps["starter-nocodb"], FQDN, null, JOB);
const b = coolify.buildMultiServiceComposeYaml("x-b", LIMITS, apps["starter-nocodb"], FQDN, null, JOB);
ok(a !== b, "each order gets different generated secrets");
const pw = /NC_ADMIN_PASSWORD: "([^"]+)"/.exec(a)[1];
ok(pw.length >= 20 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw), "NocoDB admin password meets complexity rules");

console.log(`\n${passed} passed, ${failed} failed (compose check ${HAS_COMPOSE ? "on" : "skipped"})`);
process.exit(failed ? 1 : 0);
