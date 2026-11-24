/**
 * What the portal tells a customer about their database's backup - node test/dbBackupPortal.test.js
 *
 * A customer's database is a Coolify SERVICE, so Coolify's standalone-database
 * backup endpoint knows nothing about it. The route used to ask that endpoint
 * anyway, which fails, so a database customer saw an error where their backup
 * status should be. It now answers from what provisioning recorded, and says
 * "set up", never "the last backup worked", because nothing checks that.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const http = require("http");
const express = require("express");
const dbBackup = require("../services/provisioning/dbBackup");
const coolify = require("../services/provisioning/lanes/coolify");
const createPortalRouter = require("../routes/portalRoutes");

function get(app, path) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      http.get({ port: srv.address().port, path }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => { srv.close(); resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }); });
      });
    });
  });
}

/** A portal app whose Frappe holds these jobs. Signed in as `account`. */
function build(account, jobs) {
  const app = express();
  app.use((req, _res, next) => { req.session = account ? { webAccount: account } : {}; next(); });
  const client = {
    get: async (url, o) => {
      if (/\/api\/resource\/Provisioning%20Job\/[^?]+$/.test(url)) {
        const name = decodeURIComponent(url.split("/").pop());
        return { data: { data: jobs.find((j) => j.name === name) || null } };
      }
      const f = JSON.parse(o?.params?.filters || "[]");
      const rows = jobs.filter((j) => f.every(([k, , v]) => String(j[k]) === String(v)));
      return { data: { data: rows.map((j) => ({ name: j.name, status: j.status, external_ref: j.external_ref })) } };
    },
  };
  const requireAuth = (req, res, next) => (req.session.webAccount ? next() : res.status(401).json({ error: "no" }));
  app.use(createPortalRouter({
    frappeClient: () => client,
    requireAuth,
    rateLimit: () => (_q, _s, n) => n(),
    upload: new Proxy({}, { get: () => () => (_q, _s, n) => n() }),
    PROVISIONING_JOB_DOCTYPE: "Provisioning Job",
  }));
  return app;
}

const dbJob = (over = {}) => ({
  name: "PRV-1", web_account: "ACC-1", service_id: "db-postgres", lane: "coolify", status: "active",
  external_ref: "SVC-1", category: "Database Hosting", backup_status: "configured", ...over,
});

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

(async () => {
  section("dailyTimeEat: a once-a-day UTC schedule as East Africa Time (UTC+3)");
  {
    ok(dbBackup.dailyTimeEat("0 23 * * *") === "02:00", "23:00 UTC is 02:00 in Nairobi");
    ok(dbBackup.dailyTimeEat("30 22 * * *") === "01:30", "22:30 UTC is 01:30");
    ok(dbBackup.dailyTimeEat("0 21 * * *") === "00:00", "21:00 UTC is midnight");
    ok(dbBackup.dailyTimeEat("5 8 * * *") === "11:05", "08:05 UTC is 11:05");
    ok(dbBackup.dailyTimeEat("0 1 * * 0") === null, "a weekly schedule gives no time");
    ok(dbBackup.dailyTimeEat("*/5 * * * *") === null, "an every-few-minutes schedule gives no time");
    ok(dbBackup.dailyTimeEat("0 25 * * *") === null && dbBackup.dailyTimeEat("") === null && dbBackup.dailyTimeEat(undefined) === null, "nonsense gives no time rather than a wrong one");
  }

  section("customerSummary: only 'configured' counts as set up");
  {
    const on = dbBackup.customerSummary("configured", {});
    ok(on.state === "active" && on.when === "02:00" && on.brieflyStopped === true, "configured: active, 02:00, database briefly stopped (the default)");
    for (const st of ["failed", "skipped", "pending", "", undefined, "weird"]) {
      const r = dbBackup.customerSummary(st, {});
      ok(r.state === "setting_up" && r.when === null && r.brieflyStopped === false, `${st === undefined ? "undefined" : `"${st}"`}: not active yet, and no time or stop notice is promised`);
    }
    ok(dbBackup.customerSummary("configured", { COOLIFY_DB_BACKUP_STOP: "false" }).brieflyStopped === false, "no stop notice when stopping is switched off");
    ok(dbBackup.customerSummary("configured", { COOLIFY_DB_BACKUP_FREQUENCY: "0 1 * * 0" }).when === null, "a weekly schedule shows no nightly time");
  }

  section("GET /api/portal/services/:id/backups for a database");
  {
    const realList = coolify.listBackups;
    let askedCoolify = 0;
    coolify.listBackups = async () => { askedCoolify++; throw new Error("must not ask Coolify's database endpoint about a service"); };
    try {
      const a = await get(build("ACC-1", [dbJob()]), "/api/portal/services/db-postgres/backups");
      ok(a.status === 200 && a.body.ok && a.body.supported === true && a.body.managed === true, "answers, as a managed backup");
      ok(a.body.state === "active" && a.body.when === "02:00" && a.body.brieflyStopped === true && Array.isArray(a.body.schedules) && a.body.schedules.length === 0, "set up, nightly at 02:00, database briefly stopped");
      ok(askedCoolify === 0, "Coolify's database endpoint is never asked (it would fail for a service)");

      for (const st of ["failed", "skipped", "pending"]) {
        const r = await get(build("ACC-1", [dbJob({ backup_status: st })]), "/api/portal/services/db-postgres/backups");
        ok(r.status === 200 && r.body.state === "setting_up" && !r.body.when && !r.body.brieflyStopped, `backup_status "${st}" reads as not active yet, not as an error`);
      }

      for (const id of ["db-mysql", "db-mongo", "db-redis"]) {
        const r = await get(build("ACC-1", [dbJob({ service_id: id })]), `/api/portal/services/${id}/backups`);
        ok(r.status === 200 && r.body.managed === true && r.body.state === "active", `${id} is handled the same way`);
      }

      const none = await get(build("ACC-1", [dbJob({ web_account: "ACC-2" })]), "/api/portal/services/db-postgres/backups");
      ok(none.status === 200 && none.body.supported === false && !none.body.managed, "another account's database is not revealed");

      const anon = await get(build(null, [dbJob()]), "/api/portal/services/db-postgres/backups");
      ok(anon.status === 401, "signed out is refused");

      const notYet = await get(build("ACC-1", [dbJob({ external_ref: "" })]), "/api/portal/services/db-postgres/backups");
      ok(notYet.status === 200 && notYet.body.supported === false, "a database that is not built yet has no backup panel content");

      await withEnv({ COOLIFY_DB_BACKUP_STOP: "false" }, async () => {
        const r = await get(build("ACC-1", [dbJob()]), "/api/portal/services/db-postgres/backups");
        ok(r.body.state === "active" && r.body.brieflyStopped === false, "no stop notice when stopping is switched off");
      });
    } finally { coolify.listBackups = realList; }
  }

  section("other services behave exactly as before");
  {
    const real = coolify.listBackups;
    const seen = [];
    coolify.listBackups = async (ref, opts) => { seen.push([ref, opts.kind]); return { supported: false, schedules: [] }; };
    try {
      const r = await get(build("ACC-1", [dbJob({ service_id: "starter-web-hosting", category: "Website Hosting", external_ref: "SVC-7" })]), "/api/portal/services/starter-web-hosting/backups");
      ok(r.status === 200 && r.body.supported === false && !r.body.managed, "web hosting still says it is not supported here");
      ok(seen.length === 1 && seen[0][0] === "SVC-7" && seen[0][1] === "service", "and still goes through the lane as a service");
    } finally { coolify.listBackups = real; }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
