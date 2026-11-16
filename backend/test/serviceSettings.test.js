/**
 * Service settings — domains, healthcheck, bulk env, backups lane calls and the
 * .env text parser. Scripted axios (no network), same seam as resourceAdmin.test.js.
 * node test/serviceSettings.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ok:", msg); } else { failed++; console.error("  FAIL:", msg); } }
function section(n) { console.log(`\n# ${n}`); }

process.env.COOLIFY_BASE_URL = "http://coolify.test";
process.env.COOLIFY_TOKEN = "t";
process.env.COOLIFY_PROJECT_UUID = "P";
process.env.COOLIFY_SERVER_UUID = "S";

const axios = require("axios");
const origCreate = axios.create;
function script(handlers) {
  const seen = [];
  axios.create = () => {
    const mk = (m) => async (url, body) => { seen.push({ m, url, body }); return handlers[m](url, body); };
    return { get: mk("get"), patch: mk("patch"), post: mk("post"), delete: mk("delete") };
  };
  return seen;
}

(async () => {
  const coolify = require("../services/provisioning/lanes/coolify");
  const { parseEnvText } = require("../services/envText");

  section("parseEnvText");
  {
    const { rows, errors } = parseEnvText('# c\n\nA=1\nexport B="two words"\nC=\'x\'\nD=a=b\n');
    ok(errors.length === 0, "valid text has no errors");
    ok(rows.length === 4, "four rows, comments and blanks skipped");
    ok(rows[1].value === "two words", "double quotes stripped");
    ok(rows[2].value === "x", "single quotes stripped");
    ok(rows[3].value === "a=b", "only the first = splits");
    const bad = parseEnvText("1BAD=x\nnoequals");
    ok(bad.errors.length === 2 && bad.rows.length === 0, "bad keys and missing = are reported with line numbers");
    ok(parseEnvText("A=\n").rows[0].value === "", "empty value kept");
  }

  section("getSettings maps domains + healthcheck");
  {
    script({ get: async () => ({ data: { fqdn: "https://a.murzaktech.tech,http://shop.example.com", is_force_https_enabled: true, health_check_enabled: true, health_check_path: "/up", health_check_interval: "30" } }) });
    const s = await coolify.getSettings("U1", { kind: "application" });
    ok(s.domains.length === 2 && s.domains[1].host === "shop.example.com" && s.domains[1].scheme === "http", "fqdn split into host+scheme");
    ok(s.forceHttps === true, "force https read");
    ok(s.healthcheck.enabled && s.healthcheck.path === "/up" && s.healthcheck.intervalSeconds === 30, "healthcheck mapped, numbers coerced");
    ok(s.healthcheck.retries === 10, "missing field falls back to default");
    script({ get: async () => ({ data: {} }) });
    const e = await coolify.getSettings("U1", { kind: "application" });
    ok(e.domains.length === 0 && e.forceHttps === null, "empty resource: no domains, unknown https");
  }

  section("setDomains / updateHealthcheck / bulk");
  {
    let seen = script({ patch: async () => ({ data: {} }) });
    await coolify.setDomains("U1", ["a.com", "b.com"], { kind: "application" });
    ok(seen[0].url === "/api/v1/applications/U1" && seen[0].body.domains === "https://a.com,https://b.com", "setDomains writes the full list as https URLs");

    seen = script({ patch: async () => ({ data: {} }) });
    await coolify.updateHealthcheck("U1", { enabled: true, path: "/up", retries: 3 }, { kind: "application" });
    ok(seen[0].body.health_check_enabled === true && seen[0].body.health_check_path === "/up" && seen[0].body.health_check_retries === 3, "healthcheck fields renamed to API names");
    ok(!("health_check_port" in seen[0].body), "unset fields are not sent");

    seen = script({ patch: async () => ({ data: {} }) });
    await coolify.bulkUpsertEnvs("U1", [{ key: "A", value: "1" }], { kind: "application" });
    ok(seen[0].url === "/api/v1/applications/U1/envs/bulk" && seen[0].body.data[0].key === "A", "bulk goes to /envs/bulk with { data: [] }");
  }

  section("listBackups is honest");
  {
    const r = await coolify.listBackups("U1", { kind: "application" });
    ok(r.supported === false, "applications report unsupported rather than an empty list");
    script({ get: async () => ({ data: [{ uuid: "b1", enabled: true, frequency: "0 2 * * *", executions: [{ status: "success", created_at: "2026-11-16" }] }] }) });
    const d = await coolify.listBackups("D1", { kind: "database" });
    ok(d.supported && d.schedules[0].lastStatus === "success", "database schedules mapped with last status");
  }

  section("listEnvs: real Coolify 4.5.3 shape");
  {
    script({ get: async () => ({ data: [
      { uuid: "a", key: "NODE", is_buildtime: true, is_preview: false },
      { uuid: "b", key: "SMOKE", is_runtime: true, is_preview: false },
      { uuid: "c", key: "NODE", is_buildtime: true, is_preview: true },
      { uuid: "d", key: "SMOKE", is_runtime: true, is_preview: true },
      { uuid: "e", key: "WITH_VALUE", value: "x", is_preview: false },
    ] }) });
    const envs = await coolify.listEnvs("U1", { kind: "application" });
    ok(envs.length === 3, "preview-deployment copies are dropped (each variable listed once)");
    ok(envs[0].valueHidden === true, "no `value` field (token lacks read:sensitive) is flagged hidden, not blank");
    ok(envs[2].valueHidden === false && envs[2].value === "x", "a returned value is kept and not hidden");
  }

  axios.create = origCreate;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
