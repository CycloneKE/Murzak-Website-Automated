/**
 * Provisioning test suite — runs without Redis or Frappe (everything mocked).
 *   node test/provisioning.test.js     (or: npm test)
 *
 * Covers catalog routing, enqueue (idempotency / doctype-missing / capacity gate
 * / scale-out), the runner state machine (active / escalate / retry+backoff),
 * multi-target placement + premium cap, backups + edge hooks, atomic claim,
 * the BullMQ hybrid processor logic, and capacity math.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

// ---- Mock Frappe REST client (multi-doctype, list + single-doc) ----
function makeStore(initialJobs = []) {
  const docs = { "Provisioning Job": {}, "Capacity Request": {} };
  let seq = 0;
  for (const d of initialJobs) {
    const name = d.name || `SEED-${++seq}`;
    docs["Provisioning Job"][name] = { ...d, name };
  }
  const parse = (url) => {
    const rest = url.split("/api/resource/")[1];
    const [dtRaw, nameRaw] = rest.split("/");
    return { dt: decodeURIComponent(dtRaw), name: nameRaw ? decodeURIComponent(nameRaw.split("?")[0]) : null };
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
    post: async (url, payload) => {
      const { dt } = parse(url);
      seq++;
      const name = (dt === "Capacity Request" ? "CAP-" : "PRV-") + seq;
      docs[dt][name] = { ...payload, name };
      return { data: { data: { name } } };
    },
    put: async (url, patch) => {
      const { dt, name } = parse(url);
      Object.assign(docs[dt][name], patch);
      return { data: { data: docs[dt][name] } };
    },
  };
}
const PJ = (s) => s.docs["Provisioning Job"];
const CR = (s) => s.docs["Capacity Request"];

const okLane = {
  isConfigured: () => true,
  configError: () => null,
  provision: async (job, opts) => ({ externalRef: "EXT-" + job.service_id, access: { t: opts?.target?.id }, log: "ok" }),
};

(async () => {
  const catalog = require("../services/provisioning/catalog");
  const capacity = require("../services/provisioning/capacity");
  const targets = require("../services/provisioning/targets");
  const runner = require("../services/provisioning/runner");
  const svc = require("../services/provisioning/provisioningService");
  const queue = require("../services/provisioning/queue");
  const coolify = require("../services/provisioning/lanes/coolify");

  // Clean env baseline
  for (const k of ["PROVISIONING_TARGETS", "PROVISIONING_BOX1_MAX_PREMIUM", "BACKUP_CONFIG_CMD", "EDGE_CONFIG_CMD"]) delete process.env[k];

  section("catalog + lane routing");
  ok(catalog.laneFor(catalog.getServiceMeta("biz-erp-light")) === "bench", "premium ERP -> bench lane");
  ok(catalog.laneFor(catalog.getServiceMeta("starter-web-hosting")) === "coolify", "volume web -> coolify lane");
  ok(catalog.laneFor(catalog.getServiceMeta("ent-erp-large")) === "manual", "dedicated -> manual lane");
  ok(catalog.laneFor(catalog.getServiceMeta("nope")) === "manual", "unknown id -> manual lane");
  ok(capacity.thresholdMb() === 10880, "RAM threshold = 10880MB (85% of 12800)");

  section("runner state machine");
  let s = makeStore([{ name: "J1", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  await runner.processQueue(s, { lanes: { coolify: okLane } });
  ok(PJ(s).J1.status === "active" && PJ(s).J1.external_ref === "EXT-starter-web-hosting", "volume job -> active w/ external_ref");

  s = makeStore([{ name: "J2", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  await runner.processQueue(s, { lanes: { coolify: { isConfigured: () => false, configError: () => "unconfigured" } } });
  ok(PJ(s).J2.status === "needs_human", "unconfigured lane -> needs_human (never faked active)");

  s = makeStore([{ name: "J3", service_id: "ent-erp-large", web_account: "WA", capacity_class: "dedicated", lane: "manual", status: "queued", attempts: 0, ram_mb: 0 }]);
  await runner.processQueue(s, { lanes: { coolify: okLane, bench: okLane } });
  ok(PJ(s).J3.status === "needs_human", "manual/dedicated lane -> needs_human");

  let fc = 0;
  const flaky = { isConfigured: () => true, configError: () => null, provision: async () => { fc++; throw new Error("boom" + fc); } };
  s = makeStore([{ name: "J4", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  await runner.processQueue(s, { lanes: { coolify: flaky } });
  ok(PJ(s).J4.status === "queued" && PJ(s).J4.attempts === 1 && !!PJ(s).J4.next_run_at, "transient failure -> queued retry w/ backoff");
  PJ(s).J4.next_run_at = null; await runner.processQueue(s, { lanes: { coolify: flaky } });
  PJ(s).J4.next_run_at = null; await runner.processQueue(s, { lanes: { coolify: flaky } });
  ok(PJ(s).J4.status === "needs_human" && PJ(s).J4.attempts === 3, "exhausts max attempts -> needs_human");

  s = makeStore([{ name: "J5", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 1, ram_mb: 768, next_run_at: new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace("T", " ") }]);
  const r5 = await runner.processQueue(s, { lanes: { coolify: okLane } });
  ok(r5.processed === 0 && PJ(s).J5.status === "queued", "future backoff -> not claimed");

  section("multi-target placement + premium cap");
  process.env.PROVISIONING_TARGETS = JSON.stringify([{ id: "box-2", sellableRamMb: 12800 }]);
  s = makeStore([
    { name: "BIG", service_id: "biz-erp-configured", status: "active", ram_mb: 10000, target: "box-1", capacity_class: "premium" },
    { name: "P1", service_id: "biz-pos-inventory", web_account: "WA", capacity_class: "premium", lane: "bench", status: "queued", attempts: 0, ram_mb: 2048 },
  ]);
  await runner.processQueue(s, { lanes: { bench: okLane } });
  ok(PJ(s).P1.status === "active" && PJ(s).P1.target === "box-2", "premium placed on box-2 when box-1 RAM-full");

  // premium cap: box-2 capped at 1 premium tenant; box-1 full -> nowhere -> scale-out
  process.env.PROVISIONING_TARGETS = JSON.stringify([{ id: "box-2", sellableRamMb: 12800, maxPremiumTenants: 1 }]);
  s = makeStore([
    { name: "B1", service_id: "x", status: "active", ram_mb: 11000, target: "box-1", capacity_class: "premium" },
    { name: "B2", service_id: "y", status: "active", ram_mb: 2048, target: "box-2", capacity_class: "premium" },
    { name: "P2", service_id: "biz-pos-inventory", web_account: "WA", capacity_class: "premium", lane: "bench", status: "queued", attempts: 0, ram_mb: 2048 },
  ]);
  await runner.processQueue(s, { lanes: { bench: okLane } });
  ok(PJ(s).P2.status === "needs_human" && PJ(s).P2.gated === 1, "premium cap reached on box-2 + box-1 full -> needs_human");
  ok(Object.values(CR(s)).length === 1, "scale-out Capacity Request created");
  delete process.env.PROVISIONING_TARGETS;

  section("scale-out idempotency (two gated jobs, one request)");
  s = makeStore([
    { name: "F1", service_id: "x", status: "active", ram_mb: 10500, target: "box-1", capacity_class: "premium" },
    { name: "G1", service_id: "biz-pos-inventory", web_account: "WA", capacity_class: "premium", lane: "bench", status: "queued", attempts: 0, ram_mb: 2048 },
    { name: "G2", service_id: "biz-pos-inventory", web_account: "WA", capacity_class: "premium", lane: "bench", status: "queued", attempts: 0, ram_mb: 2048 },
  ]);
  await runner.processQueue(s, { lanes: { bench: okLane }, limit: 1 });
  ok(PJ(s).G1.status === "needs_human" && PJ(s).G2.status === "needs_human", "both gated jobs -> needs_human");
  ok(Object.values(CR(s)).length === 1, "only ONE Capacity Request (idempotent)");

  section("backups + edge hooks (skipped when unconfigured)");
  s = makeStore([{ name: "B", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  await runner.processQueue(s, { lanes: { coolify: okLane } });
  ok(PJ(s).B.backup_status === "skipped" && PJ(s).B.edge_status === "skipped", "active w/ backup+edge recorded as skipped (visible, not silent)");

  section("per-target lane config");
  ok(coolify.isConfigured({ target: { id: "box-2", coolify: { baseUrl: "https://c2", token: "t", projectUuid: "p", serverUuid: "s" } } }) === true, "coolify configured via per-target creds (no env)");
  ok(coolify.isConfigured() === false, "coolify unconfigured with no env/target");

  section("concurrency");
  s = makeStore([1, 2, 3, 4, 5].map((i) => ({ name: "C" + i, service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 })));
  const rc = await runner.processQueue(s, { lanes: { coolify: okLane }, limit: 3, max: 10 });
  ok(rc.processed === 5 && rc.results.every((x) => x.outcome === "active"), "all 5 volume jobs active under concurrency=3");

  section("atomic claim guard");
  ok((await runner.claimJob({ put: async () => ({}), get: async () => ({ data: { data: { runner_id: "someone-else" } } }) }, "PRV-1", "me", "box-1")) === false, "claim lost when another runner_id present -> false");
  ok((await runner.claimJob({ put: async () => ({}), get: async () => ({ data: { data: { runner_id: "me" } } }) }, "PRV-1", "me", "box-1")) === true, "claim held when our runner_id present -> true");

  section("processJobByName (doctype is source of truth)");
  s = makeStore([{ name: "N1", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  let o = await runner.processJobByName(s, "N1", { coolify: okLane });
  ok(o.outcome === "active", "queued job by name -> active");
  o = await runner.processJobByName(s, "N1", { coolify: okLane });
  ok(o.outcome === "skipped" && /status=active/.test(o.reason), "already-active job by name -> skipped (no double build)");
  o = await runner.processJobByName(s, "DOES-NOT-EXIST");
  ok(o.outcome === "missing", "unknown name -> missing");
  s = makeStore([{ name: "N2", service_id: "starter-web-hosting", status: "queued", capacity_class: "volume", lane: "coolify", ram_mb: 768, next_run_at: new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace("T", " ") }]);
  o = await runner.processJobByName(s, "N2", { coolify: okLane });
  ok(o.outcome === "deferred" && o.retryInSec > 0, "backoff not elapsed by name -> deferred");

  section("BullMQ hybrid processor logic (no Redis)");
  const adds = [];
  const fakeQueue = { add: async (n, d, opt) => { adds.push({ n, d, opt }); } };
  const procRetry = queue.createProcessor({ clientFactory: () => ({}), processFn: async () => ({ outcome: "retry", attempts: 2, retryInSec: 60 }), getQueue: () => fakeQueue });
  o = await procRetry({ data: { name: "PRV-9" } });
  ok(o.outcome === "retry" && adds.length === 1 && adds[0].opt.delay === 60000 && adds[0].opt.jobId === "PRV-9:retry:2", "retry outcome re-enqueues delayed job");
  const before = adds.length;
  const procActive = queue.createProcessor({ clientFactory: () => ({}), processFn: async () => ({ outcome: "active" }), getQueue: () => fakeQueue });
  await procActive({ data: { name: "PRV-10" } });
  ok(adds.length === before, "active outcome does NOT re-enqueue");
  o = await procRetry({ data: {} });
  ok(o.outcome === "missing", "processor with no job name -> missing");
  ok((await queue.enqueue("PRV-X")).enqueued === false, "enqueue is a no-op when dispatcher not in bullmq mode");
  ok(queue.desiredMode() === "off", "desiredMode=off when runner disabled");

  section("enqueue path (payment-time) capacity gate");
  s = makeStore([]);
  await svc.enqueueProvisioningForInvoice({ client: s, webAccount: "WA", invoiceDocName: "INV", serviceIds: ["biz-pos-inventory", "starter-web-hosting"] });
  const pos = Object.values(PJ(s)).find((d) => d.service_id === "biz-pos-inventory");
  const web = Object.values(PJ(s)).find((d) => d.service_id === "starter-web-hosting");
  ok(pos.status === "queued" && pos.target === "box-1" && !pos.gated, "enqueue premium under-cap -> queued on box-1");
  ok(web.status === "queued" && !web.gated, "enqueue volume -> queued");
  s = makeStore([{ name: "ACT", service_id: "big", status: "active", ram_mb: 10500, target: "box-1", capacity_class: "premium" }]);
  await svc.enqueueProvisioningForInvoice({ client: s, webAccount: "WA", invoiceDocName: "INV2", serviceIds: ["biz-pos-inventory"] });
  const gated = Object.values(PJ(s)).find((d) => d.service_id === "biz-pos-inventory");
  ok(gated.status === "needs_human" && gated.gated === 1, "enqueue premium over-cap -> needs_human + gated");
  ok(Object.values(CR(s)).length === 1, "enqueue fired one scale-out request");

  section("enqueue idempotency + doctype-missing");
  const existingStore = makeStore([{ name: "EX", invoice: "INV3", service_id: "starter-web-hosting", status: "queued" }]);
  // force findExistingJob to match by making get(list) return the seeded row
  let r = await svc.enqueueProvisioningForInvoice({ client: existingStore, webAccount: "WA", invoiceDocName: "INV3", serviceIds: ["starter-web-hosting"] });
  ok(r.created.length === 0 && r.skipped.some((x) => x.reason === "already queued"), "duplicate (invoice,service) -> skipped, not re-created");
  const missingClient = { get: async () => { const e = new Error("nf"); e.response = { status: 404 }; throw e; }, post: async () => { const e = new Error("nf"); e.response = { status: 404 }; throw e; }, put: async () => ({}) };
  r = await svc.enqueueProvisioningForInvoice({ client: missingClient, webAccount: "WA", invoiceDocName: "INV4", serviceIds: ["starter-web-hosting"] });
  ok(r.doctypeMissing === true, "doctype not installed -> doctypeMissing flag (notify still works)");

  // The findExistingJob check passes (empty), but the unique job_key index rejects
  // the insert (lost enqueue race) -> treated as idempotent skip, not an error.
  const dupClient = {
    get: async () => ({ data: { data: [] } }),
    post: async () => {
      const e = new Error("Duplicate entry");
      e.response = { status: 409, data: { exception: "frappe.exceptions.DuplicateEntryError: job_key" } };
      throw e;
    },
    put: async () => ({}),
  };
  r = await svc.enqueueProvisioningForInvoice({ client: dupClient, webAccount: "WA", invoiceDocName: "INV5", serviceIds: ["starter-web-hosting"] });
  ok(
    r.created.length === 0 && r.skipped.some((x) => x.reason === "already queued (unique)"),
    "unique job_key violation on insert -> idempotent skip (no double-create, no error)"
  );

  section("dispatcher mode selection (no Redis needed)");
  const savedRunner = process.env.PROVISIONING_RUNNER_ENABLED;
  const savedQueue = process.env.PROVISIONING_QUEUE;
  const savedRedis = process.env.REDIS_URL;
  const savedPRedis = process.env.PROVISIONING_REDIS_URL;
  delete process.env.REDIS_URL; delete process.env.PROVISIONING_REDIS_URL;
  queue.configure({ frappeClientFactory: () => makeStore([]) });

  process.env.PROVISIONING_RUNNER_ENABLED = "false";
  ok((await queue.start()).mode === "off", "start() -> off when runner disabled");

  process.env.PROVISIONING_RUNNER_ENABLED = "true";
  process.env.PROVISIONING_QUEUE = "bullmq"; // requested, but no Redis URL
  const startedNoRedis = await queue.start();
  ok(startedNoRedis.mode === "poll", "bullmq requested w/o Redis URL -> safe fallback to poll");
  await queue.stop();

  process.env.PROVISIONING_QUEUE = "poll";
  ok((await queue.start()).mode === "poll", "poll mode starts the interval runner");
  await queue.stop();

  // restore
  if (savedRunner === undefined) delete process.env.PROVISIONING_RUNNER_ENABLED; else process.env.PROVISIONING_RUNNER_ENABLED = savedRunner;
  if (savedQueue === undefined) delete process.env.PROVISIONING_QUEUE; else process.env.PROVISIONING_QUEUE = savedQueue;
  if (savedRedis !== undefined) process.env.REDIS_URL = savedRedis;
  if (savedPRedis !== undefined) process.env.PROVISIONING_REDIS_URL = savedPRedis;

  // ---- tally ----
  console.log(`\n${"=".repeat(48)}`);
  console.log(`PROVISIONING TESTS: ${passed} passed, ${failed} failed`);
  if (failed) { console.error("Failed:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
