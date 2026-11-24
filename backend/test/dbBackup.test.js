/**
 * Customer database backups - node test/dbBackup.test.js
 *
 * A customer's database is a Coolify SERVICE (compose file), which Coolify's
 * database-backup API cannot see, so its data volume is backed up instead
 * (services/provisioning/dbBackup.js). These tests pin:
 *   - nothing is scheduled until an S3 destination is named, and that is
 *     visible on the job as "skipped", not silent;
 *   - the right volume is chosen, and never guessed;
 *   - a failure never blocks handing the database over, but is recorded as
 *     "failed" and retried by the sweep;
 *   - the schedule is saved to S3 with the database stopped during the copy
 *     (so the copy restores), unless that is switched off.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const dbBackup = require("../services/provisioning/dbBackup");
const coolify = require("../services/provisioning/lanes/coolify");
const runner = require("../services/provisioning/runner");
const { sweepDatabaseBackups } = require("../services/provisioning/dbBackupSweep");
const axios = require("axios");

const S3 = { uuid: "S3-R2", name: "R2 bucket", is_usable: true };
const VOL = (mount, uuid = "VOL-1") => ({ uuid, name: "v", mount_path: mount, resource_type: "database" });

/** A fake Coolify client that records every call. */
function fakeCoolify({ s3 = [S3], volumes = [VOL("/var/lib/postgresql/data")], putResult, putError } = {}) {
  const calls = [];
  return {
    calls,
    get: async (url) => {
      calls.push(["GET", url]);
      if (url === "/api/v1/s3-storages") return { data: s3 };
      if (/\/storages$/.test(url)) return { data: { persistent_storages: volumes, file_storages: [] } };
      throw new Error("unexpected GET " + url);
    },
    put: async (url, body) => {
      calls.push(["PUT", url, body]);
      if (putError) throw putError;
      return { data: putResult || { uuid: "SCHED-1", enabled: true, save_s3: true } };
    },
  };
}
const CTX = { serviceUuid: "SVC-1", volumePath: "/var/lib/postgresql/data" };
const ENV = { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" };

(async () => {
  section("settings: off until an S3 destination is named");
  {
    ok(dbBackup.isConfigured({}) === false, "not configured with no S3 destination");
    ok(dbBackup.isConfigured({ COOLIFY_DB_BACKUP_S3_UUID: "x" }) === true, "configured by uuid");
    ok(dbBackup.isConfigured({ COOLIFY_DB_BACKUP_S3_NAME: "R2 bucket" }) === true, "configured by name");
    const d = dbBackup.settings({});
    ok(d.frequency === "0 23 * * *", "default schedule is 23:00 UTC (02:00 Nairobi)");
    ok(d.stopDuringBackup === true, "the database is stopped during the copy by default");
    ok(d.retentionS3 === 14 && d.retentionLocal === 2, "keeps 14 copies in S3 and 2 on the server");
    ok(dbBackup.settings({ COOLIFY_DB_BACKUP_STOP: "false" }).stopDuringBackup === false, "stopping can be switched off");
    ok(dbBackup.settings({ COOLIFY_DB_BACKUP_RETENTION: "abc" }).retentionS3 === 14, "a bad number falls back to the default");
  }

  section("not configured: skipped, with the reason, and Coolify is never called");
  {
    const c = fakeCoolify();
    const r = await dbBackup.ensureDatabaseBackup(c, CTX, {});
    ok(r.status === "skipped" && /COOLIFY_DB_BACKUP_S3_UUID/.test(r.detail), "skipped and says which setting to set");
    ok(c.calls.length === 0, "no request is made to Coolify");
  }

  section("configured: the schedule is saved to S3 on the data volume");
  {
    const c = fakeCoolify();
    const r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "configured" && r.scheduleUuid === "SCHED-1", "configured, with Coolify's schedule id");
    const put = c.calls.find((x) => x[0] === "PUT");
    ok(put && put[1] === "/api/v1/services/SVC-1/storages/VOL-1/backups", "saved against the service's data volume");
    ok(put[2].save_s3 === true && put[2].s3_storage_uuid === "S3-R2" && put[2].enabled === true, "sent to the S3 destination, enabled");
    ok(put[2].stop_during_backup === true, "database stopped during the copy, so the copy restores");
    ok(put[2].frequency === "0 23 * * *" && put[2].retention_amount_s3 === 14 && put[2].retention_amount_locally === 2, "default schedule and retention");
    ok(put[2].missing_backup_notification_days === 2, "Coolify alerts if no backup appears for 2 days");
    ok(/stopped during the copy/.test(r.detail), "the detail says the database is stopped");
  }

  section("settings are honoured");
  {
    const c = fakeCoolify();
    await dbBackup.ensureDatabaseBackup(c, CTX, { ...ENV, COOLIFY_DB_BACKUP_FREQUENCY: "0 1 * * 0", COOLIFY_DB_BACKUP_STOP: "false", COOLIFY_DB_BACKUP_RETENTION: "30" });
    const body = c.calls.find((x) => x[0] === "PUT")[2];
    ok(body.frequency === "0 1 * * 0" && body.stop_during_backup === false && body.retention_amount_s3 === 30, "frequency, no-stop and retention come from the environment");
  }

  section("the S3 destination can be found by name");
  {
    const c = fakeCoolify();
    const r = await dbBackup.ensureDatabaseBackup(c, CTX, { COOLIFY_DB_BACKUP_S3_NAME: "r2 BUCKET" });
    ok(r.status === "configured" && c.calls.find((x) => x[0] === "PUT")[2].s3_storage_uuid === "S3-R2", "matched ignoring case");
  }

  section("S3 problems fail loudly and nothing is scheduled");
  {
    let c = fakeCoolify({ s3: [] });
    let r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /not found/.test(r.detail), "unknown destination -> failed, not found");
    ok(!c.calls.some((x) => x[0] === "PUT"), "no schedule is saved");

    c = fakeCoolify({ s3: [{ ...S3, is_usable: false }] });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /not usable/.test(r.detail), "an unvalidated destination -> failed, says to validate it");

    c = fakeCoolify({ s3: [S3, { ...S3, uuid: "S3-2" }] });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, { COOLIFY_DB_BACKUP_S3_NAME: "R2 bucket" });
    ok(r.status === "failed" && /more than one/.test(r.detail), "two destinations with one name -> failed, never picks one");
  }

  section("the data volume is never guessed");
  {
    let c = fakeCoolify({ volumes: [VOL("/other")] });
    let r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /no persistent volume/.test(r.detail), "no volume at the data folder -> failed");

    c = fakeCoolify({ volumes: [VOL("/var/lib/postgresql/data", "A"), VOL("/var/lib/postgresql/data", "B")] });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /refusing to guess/.test(r.detail), "two volumes at the data folder -> failed");

    c = fakeCoolify({ volumes: [VOL("/other", "X"), VOL("/var/lib/postgresql/data/", "Y")] });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "configured" && c.calls.find((x) => x[0] === "PUT")[1].includes("/storages/Y/"), "picks the volume at the data folder (trailing slash ignored)");
  }

  section("Coolify errors are reported, not thrown");
  {
    let c = fakeCoolify({ putError: Object.assign(new Error("denied"), { response: { status: 403, data: { message: "Forbidden" } } }) });
    let r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /403/.test(r.detail) && /deploy permission/.test(r.detail), "403 -> failed with the deploy-permission hint");

    c = fakeCoolify({ putError: Object.assign(new Error("bad"), { response: { status: 422, data: { message: "Validation failed.", errors: { frequency: ["nope"] } } } }) });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed" && /422/.test(r.detail) && /frequency/.test(r.detail), "422 -> failed with Coolify's reason");

    c = fakeCoolify({ putResult: { uuid: "S", enabled: true, save_s3: false } });
    r = await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    ok(r.status === "failed", "Coolify answering without S3 enabled is not called configured");

    c = fakeCoolify();
    r = await dbBackup.ensureDatabaseBackup(c, CTX, { ...ENV, COOLIFY_DB_BACKUP_FREQUENCY: "every night" });
    ok(r.status === "failed" && /cron/.test(r.detail) && c.calls.length === 0, "a typo in the schedule is caught before Coolify is asked");

    r = await dbBackup.ensureDatabaseBackup(fakeCoolify(), { serviceUuid: "", volumePath: "/x" }, ENV);
    ok(r.status === "failed", "no service uuid -> failed");
  }

  section("running it twice leaves one schedule (idempotent)");
  {
    const c = fakeCoolify();
    await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    await dbBackup.ensureDatabaseBackup(c, CTX, ENV);
    const puts = c.calls.filter((x) => x[0] === "PUT");
    ok(puts.length === 2 && puts[0][1] === puts[1][1] && JSON.stringify(puts[0][2]) === JSON.stringify(puts[1][2]), "the same volume and the same settings both times (Coolify replaces, never adds)");
  }

  // ---- the lane: provision() ----
  const LANE_ENV = { COOLIFY_BASE_URL: "http://coolify.test", COOLIFY_TOKEN: "t", COOLIFY_PROJECT_UUID: "P", COOLIFY_SERVER_UUID: "S" };
  async function withEnv(vars, fn) {
    const saved = {};
    for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    try { return await fn(); }
    finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  }
  function laneClient({ puts, existing, s3 = [S3], volumeMount = "/var/lib/postgresql/data", putError }) {
    return {
      get: async (url) => {
        if (url === "/api/v1/services") return { data: existing ? [{ name: existing, uuid: "NEW-DB" }] : [] };
        if (url === "/api/v1/services/NEW-DB") return { data: { data: { status: "running:healthy" } } };
        if (url === "/api/v1/s3-storages") return { data: s3 };
        if (url === "/api/v1/services/NEW-DB/storages") return { data: { persistent_storages: [VOL(volumeMount, "VOL-9")], file_storages: [] } };
        throw new Error("unexpected GET " + url);
      },
      post: async () => ({ data: { data: { uuid: "NEW-DB" } } }),
      put: async (url, body) => { puts.push([url, body]); if (putError) throw putError; return { data: { uuid: "SCHED-9", enabled: true, save_s3: true } }; },
      patch: async () => ({ data: {} }),
    };
  }
  async function provisionDb(serviceId, extraEnv, clientOpts, jobExtra = {}) {
    const puts = [];
    const origCreate = axios.create;
    axios.create = () => laneClient({ puts, ...clientOpts });
    try {
      const job = { name: "J-1", web_account: "acct", service_id: serviceId, ram_mb: 768, disk_gb: 10, ...jobExtra };
      const res = await withEnv({ ...LANE_ENV, ...extraEnv }, () => coolify.provision(job, {}));
      return { res, puts };
    } finally { axios.create = origCreate; }
  }

  section("lane: a new database gets its backup scheduled as it is handed over");
  {
    const { res, puts } = await provisionDb("db-postgres", { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" }, {});
    ok(res.backup && res.backup.status === "configured", "provision() reports the backup as configured");
    ok(puts.length === 1 && puts[0][0] === "/api/v1/services/NEW-DB/storages/VOL-9/backups", "the schedule is saved on the new service's data volume");
    ok(res.externalRef === "NEW-DB" && res.access.engine === "postgres" && !!res.access.password, "the customer still gets their database and credentials");
    ok(!/password/i.test(res.log) && /backup=configured/.test(res.log), "the log notes the backup and never the password");
  }

  section("lane: each database engine is backed up at its own data folder");
  {
    for (const [id, mount] of [["db-mysql", "/var/lib/mysql"], ["db-mongo", "/data/db"], ["db-redis", "/data"]]) {
      const { res, puts } = await provisionDb(id, { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" }, { volumeMount: mount });
      ok(res.backup.status === "configured" && puts.length === 1, `${id}: backed up at ${mount}`);
    }
  }

  section("lane: without an S3 destination the database is handed over and the job says skipped");
  {
    const { res, puts } = await provisionDb("db-postgres", { COOLIFY_DB_BACKUP_S3_UUID: undefined, COOLIFY_DB_BACKUP_S3_NAME: undefined }, {});
    ok(res.backup.status === "skipped" && puts.length === 0, "skipped, nothing scheduled");
    ok(!!res.externalRef && !!res.access.password, "the database is still delivered");
  }

  section("lane: a backup failure never blocks the customer's database");
  {
    const { res } = await provisionDb("db-postgres", { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" }, { putError: new Error("coolify down") });
    ok(res.backup.status === "failed" && /coolify down/.test(res.backup.detail), "failed, with the reason");
    ok(res.externalRef === "NEW-DB" && !!res.access.password, "the database is still delivered");
  }

  section("lane: a recovered database (runner crashed after creating it) is also backed up");
  {
    const name = coolify.resourceName({ name: "J-1", web_account: "acct", service_id: "db-postgres" });
    const { res, puts } = await provisionDb("db-postgres", { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" }, { existing: name });
    ok(res.backup && res.backup.status === "configured" && puts.length === 1, "recovery path schedules the backup too");
  }

  section("lane: things that are not databases get no database backup");
  {
    const { res, puts } = await provisionDb("starter-web-hosting", { COOLIFY_DB_BACKUP_S3_UUID: "S3-R2" }, {}, { category: "Website Hosting" });
    ok(res.backup === undefined && puts.length === 0, "a web hosting service is not touched");
  }

  // ---- the runner records it ----
  function makeStore(jobs) {
    const docs = { "Provisioning Job": {}, "Capacity Request": {}, "Portal Users Requests": {}, "Web Account": {} };
    for (const j of jobs) docs["Provisioning Job"][j.name] = { ...j };
    const parse = (url) => {
      const [dt, nm] = url.split("/api/resource/")[1].split("/");
      return { dt: decodeURIComponent(dt), name: nm ? decodeURIComponent(nm.split("?")[0]) : null };
    };
    return {
      docs,
      get: async (url, opts) => {
        const { dt, name } = parse(url);
        const coll = docs[dt] || {};
        if (name) return { data: { data: coll[name] ? { ...coll[name] } : null } };
        const filters = JSON.parse(opts?.params?.filters || "[]");
        let rows = Object.values(coll);
        for (const [f, op, v] of filters) {
          if (op === "=") rows = rows.filter((r) => String(r[f]) === String(v));
          else if (op === "in") rows = rows.filter((r) => v.includes(r[f]));
        }
        return { data: { data: rows.map((r) => ({ ...r })) } };
      },
      post: async () => ({ data: { data: { name: "X" } } }),
      put: async (url, patch) => { const { dt, name } = parse(url); Object.assign(docs[dt][name], patch); return { data: { data: docs[dt][name] } }; },
    };
  }
  const dbJob = (name) => ({ name, service_id: "db-postgres", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 });
  const laneReturning = (backup) => ({
    isConfigured: () => true,
    configError: () => null,
    provision: async (job) => ({ externalRef: "EXT-" + job.name, access: {}, log: "ok", ...(backup ? { backup } : {}) }),
  });

  section("runner: the lane's backup result is recorded on the job");
  {
    let s = makeStore([dbJob("R1")]);
    await runner.processQueue(s, { lanes: { coolify: laneReturning({ status: "configured", detail: "x" }) } });
    ok(s.docs["Provisioning Job"].R1.status === "active" && s.docs["Provisioning Job"].R1.backup_status === "configured", "active, backup configured");

    s = makeStore([dbJob("R2")]);
    const origErr = console.error; const logged = [];
    console.error = (...a) => logged.push(a.join(" "));
    await runner.processQueue(s, { lanes: { coolify: laneReturning({ status: "failed", detail: "S3 destination was not found" }) } });
    console.error = origErr;
    ok(s.docs["Provisioning Job"].R2.status === "active" && s.docs["Provisioning Job"].R2.backup_status === "failed", "a failed backup still hands the database over, recorded as failed");
    ok(logged.some((l) => /BACKUP NOT SET UP/.test(l) && /R2/.test(l)), "and it is logged loudly");

    s = makeStore([dbJob("R3")]);
    await runner.processQueue(s, { lanes: { coolify: laneReturning({ status: "skipped", detail: "off" }) } });
    ok(s.docs["Provisioning Job"].R3.backup_status === "skipped", "skipped stays visibly skipped (the generic hook was not configured either)");

    s = makeStore([dbJob("R4")]);
    await runner.processQueue(s, { lanes: { coolify: laneReturning(null) } });
    ok(s.docs["Provisioning Job"].R4.backup_status === "skipped", "a lane with no backup of its own behaves as before");
  }

  // ---- the sweep ----
  section("sweep: does nothing until S3 is configured");
  {
    const s = makeStore([{ ...dbJob("S1"), status: "active", backup_status: "skipped", external_ref: "U1" }]);
    const r = await sweepDatabaseBackups(s, { isConfigured: () => false, lane: { isDatabaseService: () => true, isConfigured: () => true, ensureDatabaseBackup: async () => { throw new Error("must not run"); } } });
    ok(r.skippedAll === true && s.docs["Provisioning Job"].S1.backup_status === "skipped", "no change, nothing called");
  }

  section("sweep: closes the gap for databases handed over without a backup");
  {
    const asked = [];
    const lane = {
      isDatabaseService: (id) => id.startsWith("db-"),
      isConfigured: () => true,
      ensureDatabaseBackup: async (ref, id) => { asked.push(ref); return ref === "U-BAD" ? { status: "failed", detail: "S3 not usable" } : { status: "configured", detail: "ok" }; },
    };
    const s = makeStore([
      { ...dbJob("A"), status: "active", backup_status: "skipped", external_ref: "U-A" },
      { ...dbJob("B"), status: "active", backup_status: "failed", external_ref: "U-BAD" },
      { ...dbJob("C"), status: "active", backup_status: "configured", external_ref: "U-C" },
      { ...dbJob("D"), status: "needs_human", backup_status: "skipped", external_ref: "U-D" },
      { ...dbJob("E"), service_id: "starter-web-hosting", status: "active", backup_status: "skipped", external_ref: "U-E" },
      { ...dbJob("F"), status: "active", backup_status: "skipped", external_ref: "" },
    ]);
    const origLog = console.log; const origErr = console.error; console.log = () => {}; console.error = () => {};
    const r = await sweepDatabaseBackups(s, { isConfigured: () => true, lane });
    console.log = origLog; console.error = origErr;
    const J = s.docs["Provisioning Job"];
    ok(J.A.backup_status === "configured", "a skipped database is now configured");
    ok(J.B.backup_status === "failed" && r.failed === 1, "a database that still cannot be backed up stays failed and is counted");
    ok(asked.join() === "U-A,U-BAD", "only active database jobs that need a backup were asked about (not configured, not needs_human, not web hosting, not missing a uuid)");
    ok(r.configured === 1, "one newly configured");
  }

  section("sweep: Frappe or the lane failing is reported, not thrown");
  {
    const r = await sweepDatabaseBackups({ get: async () => { throw new Error("frappe down"); } }, { isConfigured: () => true, lane: { isDatabaseService: () => true, isConfigured: () => true } });
    ok(r.error === "frappe down", "list failure is returned as an error");

    const s = makeStore([{ ...dbJob("G"), status: "active", backup_status: "skipped", external_ref: "U-G" }]);
    const origErr = console.error; console.error = () => {};
    const r2 = await sweepDatabaseBackups(s, { isConfigured: () => true, lane: { isDatabaseService: () => true, isConfigured: () => true, ensureDatabaseBackup: async () => { throw new Error("boom"); } } });
    console.error = origErr;
    ok(r2.failed === 1 && s.docs["Provisioning Job"].G.backup_status === "failed", "a lane that throws is recorded as failed");
  }

  section("sweep: bounded per pass");
  {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...dbJob("N" + i), status: "active", backup_status: "skipped", external_ref: "U" + i }));
    const s = makeStore(rows);
    let n = 0;
    const origLog = console.log; console.log = () => {};
    await sweepDatabaseBackups(s, { isConfigured: () => true, lane: { isDatabaseService: () => true, isConfigured: () => true, ensureDatabaseBackup: async () => { n++; return { status: "configured" }; } } });
    console.log = origLog;
    ok(n === 10, "at most 10 databases per pass");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
