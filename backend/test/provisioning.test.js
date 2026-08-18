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
  const docs = { "Provisioning Job": {}, "Capacity Request": {}, "Portal Users Requests": {}, "Web Account": {} };
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
      // Honor field projection like real Frappe does — the runner's claimable
      // list is projected, and a field missing from that list is invisible to
      // the lanes (this exact truncation shipped a live bug for repo_url).
      const fields = opts?.params?.fields ? JSON.parse(opts.params.fields) : null;
      const project = (r) => {
        if (!fields) return { ...r };
        const out = {};
        for (const f of fields) out[f] = r[f];
        return out;
      };
      return { data: { data: rows.map(project) } };
    },
    post: async (url, payload) => {
      const { dt } = parse(url);
      seq++;
      const name = (dt === "Capacity Request" ? "CAP-" : dt === "Portal Users Requests" ? "REQ-" : "PRV-") + seq;
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

async function withEnvAsync(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

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
  // Critical 3 (final-review-fix-report.md): domain-registration products are
  // capacityClass "volume" but zero-footprint (ramMb 0 / diskGb 0) — they must
  // never fall through to the coolify lane, which would enqueue a real
  // container build (and coolify.js's RAM floor would then actually consume
  // real box RAM) for a purchase that touches no infrastructure at all.
  for (const id of ["domain-coke", "domain-com", "domain-ke", "domain-org", "domain-net", "domain-africa", "domain-io"]) {
    ok(catalog.laneFor(catalog.getServiceMeta(id)) === "manual", `${id} (domain registration) -> manual lane, never coolify`);
  }
  // Same rule generalizes to any other genuinely zero-footprint "volume" product.
  ok(catalog.laneFor(catalog.getServiceMeta("addon-priority-support")) === "manual", "zero-footprint addon -> manual lane, not a fake coolify build");
  ok(catalog.laneFor(catalog.getServiceMeta("starter-web-hosting")) === "coolify", "real-footprint volume product still routes to coolify (no regression)");
  ok(catalog.laneFor(catalog.getServiceMeta("starter-storage")) === "objectStorage", "File Storage -> objectStorage lane, not coolify (no fake container)");
  ok(capacity.thresholdMb() === 5440, "RAM threshold = 5440MB (85% of 6400)");

  // The whole E2E suite shares one backend process/mock capacity pool, and
  // unpaid Draft checkout orders reserve RAM for 30 minutes with nothing
  // cancelling them — so by test ~110 the shared pool has enough accumulated,
  // never-expiring reservation to trip this gate on requests that have
  // nothing to do with real capacity (caught live: cloud-launch.spec.ts and
  // products-databases.spec.ts started getting a legitimate 409 CAPACITY on
  // a fresh account's very first order). Mirrors server.js's skipInE2E.
  {
    const prevE2E = process.env.E2E_TEST;
    process.env.E2E_TEST = "true";
    ok(capacity.thresholdMb() === Infinity, "E2E_TEST=true -> capacity gate disabled outright");
    ok(capacity.gateExceeded({ reserved: 999999, ramMb: 999999 }) === false, "…so gateExceeded never trips, no matter how much is reserved");
    if (prevE2E === undefined) delete process.env.E2E_TEST; else process.env.E2E_TEST = prevE2E;
    ok(capacity.thresholdMb() === 5440, "restoring the env afterward restores the real threshold (no leakage into later tests)");
  }

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

  section("runner: reclaims jobs orphaned in \"running\" (runner died mid-build)");
  const staleTs = new Date(Date.now() - 3600e3).toISOString().slice(0, 19).replace("T", " ");
  const freshTs = new Date().toISOString().slice(0, 19).replace("T", " ");
  s = makeStore([
    { name: "J6", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "running", attempts: 0, ram_mb: 768, started_at: staleTs, runner_id: "dead-runner" },
    { name: "J7", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "running", attempts: 0, ram_mb: 768, started_at: freshTs, runner_id: "live-runner" },
  ]);
  const reclaimResult = await runner.reclaimStaleRunning(s, 900);
  ok(reclaimResult.reclaimed === 1 && reclaimResult.total === 1, "only the stale job is reclaimed, not the fresh one");
  ok(PJ(s).J6.status === "queued" && PJ(s).J6.attempts === 1 && !PJ(s).J6.runner_id, "stale job -> requeued, attempt burned, runner_id cleared");
  ok(PJ(s).J7.status === "running", "recently-claimed job left alone");

  s = makeStore([{ name: "J8", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "running", attempts: 2, ram_mb: 768, started_at: staleTs, runner_id: "dead-runner" }]);
  await runner.reclaimStaleRunning(s, 900);
  ok(PJ(s).J8.status === "needs_human" && PJ(s).J8.attempts === 3, "stale job past max attempts -> needs_human, not an infinite requeue loop");

  s = makeStore([{ name: "J9", service_id: "starter-web-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 768 }]);
  await runner.processQueue(s, { lanes: { coolify: okLane } });
  ok(PJ(s).J9.status === "active", "processQueue reclaim pass doesn't disturb a normal queued job");

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

  section("P5.0 container resource limits (resourceLimits)");
  {
    const savedPids = process.env.COOLIFY_PIDS_LIMIT;
    delete process.env.COOLIFY_PIDS_LIMIT;

    // 768MB volume service on a 2-vCPU / 6400MB box → ~0.24 raw, floored to 0.25.
    const l = coolify.resourceLimits({ ram_mb: 768, disk_gb: 10 });
    ok(l.ramMb === 768, "resourceLimits: memory passes through job.ram_mb");
    ok(l.cpus === 0.25, "resourceLimits: small service floored to MIN_CPUS (0.25)");
    ok(l.pidsLimit === 512, "resourceLimits: default pids limit 512 (fork-bomb bound)");
    ok(l.diskGb === 10, "resourceLimits: disk passes through job.disk_gb");

    // A large service gets proportionally more CPU: 6144MB → 6144/6400*2 ≈ 1.92
    // (same numeric result as the old 12800MB/4vCPU box — both RAM and vCPU
    // halved together, so this proportion happens to be scale-invariant here).
    const big = coolify.resourceLimits({ ram_mb: 6144, disk_gb: 80 });
    ok(big.cpus === 1.92, "resourceLimits: cpu scales with RAM share of the box");

    // A single service can never be entitled to more than the whole box.
    const huge = coolify.resourceLimits({ ram_mb: 999999 });
    ok(huge.cpus === 2, "resourceLimits: cpu ceiled at the box vcpu count");

    // Missing footprint → safe floor, no disk key.
    const bare = coolify.resourceLimits({});
    ok(bare.ramMb === 256 && bare.cpus === 0.25 && bare.diskGb === 0, "resourceLimits: missing footprint floors to safe defaults, no disk");

    // Env override for pids.
    process.env.COOLIFY_PIDS_LIMIT = "1024";
    ok(coolify.resourceLimits({ ram_mb: 768 }).pidsLimit === 1024, "resourceLimits: COOLIFY_PIDS_LIMIT env override honored");

    if (savedPids === undefined) delete process.env.COOLIFY_PIDS_LIMIT;
    else process.env.COOLIFY_PIDS_LIMIT = savedPids;
  }

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

  section("Database Hosting enqueue: gets a real external_port, needs_human when the pool is exhausted");
  {
    const sPort = makeStore([]);
    const eqPort = await svc.enqueueProvisioningForInvoice({
      client: sPort, webAccount: "WP", invoiceDocName: "INV-PORT", serviceIds: ["db-mysql"],
    });
    ok(eqPort.created.length === 1, "db-mysql purchase creates one job");
    const portJob = Object.values(PJ(sPort))[0];
    ok(Number(portJob.external_port) >= 33000 && Number(portJob.external_port) <= 33999, `db-mysql job gets a real port in range (got ${portJob.external_port})`);

    // Two database purchases in the SAME batch must not collide.
    const sTwo = makeStore([]);
    const eqTwo = await svc.enqueueProvisioningForInvoice({
      client: sTwo, webAccount: "WP2", invoiceDocName: "INV-PORT2", serviceIds: ["db-mysql", "db-postgres"],
    });
    ok(eqTwo.created.length === 2, "two database products in one order both create jobs");
    const twoJobs = Object.values(PJ(sTwo));
    const ports = twoJobs.map((j) => Number(j.external_port));
    ok(ports[0] !== ports[1], `two database products in the same batch get DIFFERENT ports (got ${ports.join(", ")})`);

    // Non-database volume products never get a port at all.
    const sWeb = makeStore([]);
    await svc.enqueueProvisioningForInvoice({
      client: sWeb, webAccount: "WP3", invoiceDocName: "INV-PORT3", serviceIds: ["starter-web-hosting"],
    });
    const webJob = Object.values(PJ(sWeb))[0];
    ok(!webJob.external_port, "a non-database product never gets an external_port field populated");

    // Exhausted range -> needs_human, matching the capacity-gate-exceeded pattern.
    await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33000" }, async () => {
      const sExhausted = makeStore([
        { name: "TAKEN", service_id: "db-postgres", category: "Database Hosting", status: "active", external_port: 33000 },
      ]);
      await svc.enqueueProvisioningForInvoice({
        client: sExhausted, webAccount: "WP4", invoiceDocName: "INV-PORT4", serviceIds: ["db-mysql"],
      });
      const exhaustedJob = Object.values(PJ(sExhausted)).find((j) => j.service_id === "db-mysql");
      ok(exhaustedJob.status === "needs_human", "exhausted port range -> needs_human, not a fake/duplicate port");
    });
  }

  section("domain registration: manual lane, and the purchased domain reaches the staff email (Critical 2 + 3)");
  {
    // enqueueProvisioningForInvoice also accepts the richer
    // { serviceId, domainChoice } shape billingActivationService.js now
    // sends (plain string ids, used everywhere above, still work too).
    const sDom = makeStore([]);
    const eqDom = await svc.enqueueProvisioningForInvoice({
      client: sDom,
      webAccount: "WD",
      invoiceDocName: "INV-DOM",
      serviceIds: [{ serviceId: "domain-com", domainChoice: "acme.com" }],
    });
    ok(eqDom.created.length === 1, "domain purchase creates exactly one job");
    const domJob = Object.values(PJ(sDom))[0];
    ok(domJob.lane === "manual", "domain job is queued on the manual lane, not coolify");
    ok((domJob.ram_mb || 0) === 0, "domain job carries zero RAM (never floored/allocated on the shared box)");
    ok(eqDom.created[0].domainChoice === "acme.com", "the purchased domain string survives onto the created-job entry used for the staff email");

    // Legacy plain-string serviceIds must keep working with no domain info.
    const eqLegacy = await svc.enqueueProvisioningForInvoice({
      client: makeStore([]), webAccount: "WD2", invoiceDocName: "INV-DOM2", serviceIds: ["domain-com"],
    });
    ok(eqLegacy.created[0].domainChoice === "", "plain string serviceIds still work, with an empty domainChoice");

    // End-to-end: the domain must actually reach the staff notification EMAIL
    // TEXT, not just an in-memory field — that's the whole point of Critical 2.
    const mailer = require("../utils/mailer");
    const originalSendMail = mailer.sendMail;
    const savedAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "ops@murzaktech.test";
    let capturedText = null;
    mailer.sendMail = async ({ text }) => { capturedText = text; };
    try {
      const notify = await svc.notifyStaffOfJobs({
        jobs: eqDom.created,
        webAccount: "WD",
        invoiceDocName: "INV-DOM",
        reservedRamMb: 0,
        doctypeMissing: false,
      });
      ok(notify.sent === true, "staff notification email was sent");
      ok(/acme\.com/.test(capturedText || ""), "staff notification email body contains the purchased domain string");
      ok(/MANUAL/.test(capturedText || ""), "staff notification email flags the manual lane for the domain job");
    } finally {
      mailer.sendMail = originalSendMail;
      if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = savedAdminEmails;
    }
  }

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

  // Regression, 2026-08-18: a 417 is Frappe's GENERIC validation-error status
  // -- it fires for ANY frappe.exceptions.ValidationError, not only a missing
  // doctype. Blindly treating every 417 as doctypeMissing mislabeled a real
  // bug (the "lane" Select field rejecting "emailHosting"/"objectStorage"/
  // "k8s" -- none were in its options list) as "doctype not installed",
  // which is false and actively misleading (two other jobs on the SAME
  // invoice succeeded moments earlier). A 417 whose body carries a
  // ValidationError exc_type must be reported as a real rejection, not
  // mistaken for a missing doctype.
  const savedConsoleError = console.error;
  let loggedRejection = "";
  console.error = (msg) => { loggedRejection += msg; };
  const selectRejectClient = {
    get: async () => ({ data: { data: [] } }),
    post: async () => {
      const e = new Error("ValidationError");
      e.response = {
        status: 417,
        data: { exc_type: "ValidationError", exception: 'frappe.exceptions.ValidationError:  Lane cannot be "emailHosting"' },
      };
      throw e;
    },
    put: async () => ({}),
  };
  try {
    r = await svc.enqueueProvisioningForInvoice({ client: selectRejectClient, webAccount: "WA", invoiceDocName: "INV6", serviceIds: ["addon-mailboxes-5"] });
  } finally {
    console.error = savedConsoleError;
  }
  ok(r.doctypeMissing === false, "a ValidationError 417 is NOT mislabeled as doctype-missing");
  ok(r.skipped.some((x) => x.reason.startsWith("error:")), "the rejection is recorded as a real error, not silently treated as 'doctype not installed'");
  ok(/job insert REJECTED/.test(loggedRejection) && /emailHosting/.test(loggedRejection), "the rejection is logged loudly (console.error), not just swallowed into a best-effort staff notification");

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

  section("BYOA (bring-your-own-app) repo plumbing");
  {
    ok(catalog.laneFor(catalog.getServiceMeta("starter-app-hosting")) === "coolify", "BYOA app-hosting SKU -> coolify lane");
    ok(catalog.laneFor(catalog.getServiceMeta("starter-db-mongo")) === "coolify", "MongoDB SKU -> coolify lane");
    ok(catalog.getServiceMeta("starter-app-hosting")?.requiresRepo === true, "snapshot carries requiresRepo flag");

    const p = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "https://github.com/x/y#dev" });
    ok(p.repo_url === "https://github.com/x/y#dev" && p.status === "queued" && p.lane === "coolify", "BYOA payload carries repo_url, stays queued");
    const p2 = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting" });
    ok(p2.status === "needs_human" && /repository/i.test(p2.error || ""), "BYOA with no repo -> born needs_human (never fake-built)");
    const p3 = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-web-hosting", repoUrl: "https://github.com/x/y" });
    ok(!p3.repo_url, "non-BYOA service ignores account repo");

    ok(coolify.parseRepoRef("https://github.com/x/y").branch === "main", "parseRepoRef defaults branch to main");
    const ref = coolify.parseRepoRef("https://github.com/x/y#staging");
    ok(ref.url === "https://github.com/x/y" && ref.branch === "staging", "parseRepoRef splits #branch suffix");
    ok(coolify.parseRepoRef("") === null, "parseRepoRef empty -> null");

    // Enqueue reads the account's source_code once and attaches it to BYOA jobs.
    s = makeStore([]);
    s.docs["Web Account"]["WA"] = { name: "WA", source_code: "https://github.com/cust/app" };
    const eq = await svc.enqueueProvisioningForInvoice({ client: s, webAccount: "WA", invoiceDocName: "INV-9", serviceIds: ["starter-app-hosting"] });
    ok(eq.created.length === 1 && eq.created[0].repo_url === "https://github.com/cust/app", "enqueue attaches account source_code to BYOA job");

    // No repo on the account -> the created job is parked for a human.
    s = makeStore([]);
    s.docs["Web Account"]["WA2"] = { name: "WA2", source_code: "" };
    const eq2 = await svc.enqueueProvisioningForInvoice({ client: s, webAccount: "WA2", invoiceDocName: "INV-10", serviceIds: ["starter-app-hosting"] });
    ok(eq2.created.length === 1 && eq2.created[0].status === "needs_human", "enqueue with no account repo -> needs_human job");

    // END-TO-END through the runner: repo_url must survive the projected
    // claimable-list fetch and reach the lane (regression: the runner's field
    // projection silently dropped it, downgrading app deploys to blank services).
    let seenRepo = null;
    const repoLane = {
      isConfigured: () => true,
      configError: () => null,
      provision: async (job) => { seenRepo = job.repo_url; return { externalRef: "APP-1", access: {}, log: "ok" }; },
    };
    s = makeStore([{ name: "JB", service_id: "starter-app-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 1024, repo_url: "https://github.com/cust/app#main" }]);
    await runner.processQueue(s, { lanes: { coolify: repoLane } });
    ok(seenRepo === "https://github.com/cust/app#main" && PJ(s).JB.status === "active", "runner passes repo_url through the projected fetch to the lane");
  }

  // ------------------------------------------------------------------
  // P0 workflow safety: buildJobPayload is the one choke point every job
  // creation passes through. A leading-space service_id reached production
  // and silently broke the portal's activity lookup (string equality never
  // matched the trimmed id used everywhere else); a malformed repo_url on
  // the account would have been carried straight into a job (and then
  // straight into a real git clone attempt) with no format check.
  // ------------------------------------------------------------------
  section("buildJobPayload: input validation choke point");
  {
    const withSpace = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: " starter-web-hosting " });
    ok(withSpace.service_id === "starter-web-hosting", "leading/trailing whitespace on service_id is trimmed");
    ok(withSpace.job_key === "INV-1::starter-web-hosting", "job_key is built from the TRIMMED id, not the raw one");
    ok(withSpace.category === "Website Hosting", "trimmed id resolves real catalog meta (category populated)");

    const unknown = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "totally-not-a-real-sku" });
    ok(unknown.status === "needs_human", "unrecognized service_id is flagged for a human, not silently enqueued");
    ok(/not in the catalog/i.test(unknown.error || ""), "error names the reason (catalog drift), not a generic failure");
    ok(unknown.lane === "manual", "unknown service still gets a safe lane (manual), never a real build lane");

    const badRepo = svc.buildJobPayload({
      webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "not-a-url-at-all",
    });
    ok(badRepo.status === "needs_human", "malformed repo_url on the account -> needs_human, not carried into the job");
    ok(!badRepo.repo_url, "malformed repo_url is never written onto the job payload");
    ok(/valid https\/git@/i.test(badRepo.error || ""), "error explains the format problem, distinct from the missing-repo message");

    const goodRepo = svc.buildJobPayload({
      webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "  https://github.com/x/y#dev  ",
    });
    ok(goodRepo.status === "queued" && goodRepo.repo_url === "https://github.com/x/y#dev", "a valid (whitespace-padded) repo_url is trimmed and accepted");

    // Enqueue-level: the trim happens upstream in normalizeServiceInputs too,
    // so every consumer inside the loop (capacity gate, BYOA repo detection)
    // sees the same trimmed id buildJobPayload used — not just the final payload.
    s = makeStore([]);
    s.docs["Web Account"]["WA3"] = { name: "WA3", source_code: "https://github.com/cust/app" };
    const eqSpace = await svc.enqueueProvisioningForInvoice({
      client: s, webAccount: "WA3", invoiceDocName: "INV-11", serviceIds: [" starter-app-hosting "],
    });
    ok(
      eqSpace.created.length === 1 && eqSpace.created[0].service_id === "starter-app-hosting" && eqSpace.created[0].repo_url === "https://github.com/cust/app",
      "enqueue trims a whitespace-padded service_id upstream so BYOA repo detection still fires"
    );
  }

  section("BYOA build-wait: deployment classification + log tail");
  {
    ok(coolify.classifyDeploymentStatus("finished") === "success", "finished -> success");
    ok(coolify.classifyDeploymentStatus("Success") === "success", "Success (any case) -> success");
    ok(coolify.classifyDeploymentStatus("failed") === "failure", "failed -> failure");
    ok(coolify.classifyDeploymentStatus("cancelled") === "failure", "cancelled -> failure");
    ok(coolify.classifyDeploymentStatus("in_progress") === "pending", "in_progress -> pending");
    ok(coolify.classifyDeploymentStatus("") === "pending", "empty/unknown -> pending (never assumed done)");

    ok(coolify.extractLogTail({ logs: "hello world" }) === "hello world", "plain string logs pass through");
    const arrLogs = JSON.stringify([{ output: "line1" }, { output: "line2" }]);
    ok(coolify.extractLogTail({ logs: arrLogs }) === "line1\nline2", "JSON-array logs joined by output");
    ok(coolify.extractLogTail({ logs: "x".repeat(5000) }, 2000).length === 2000, "log tail truncates to last N chars");
    ok(coolify.extractLogTail({}) === "", "missing logs -> empty string");
  }

  section("BYOA build-wait: deployAndWait against a scripted client");
  {
    const noSleep = async () => {};
    // Scripted client: deploy trigger returns a deployment_uuid; polls walk a
    // status sequence.
    const scripted = (sequence) => {
      let i = 0;
      return {
        post: async (url) => {
          if (url.startsWith("/api/v1/deploy")) return { data: { deployments: [{ deployment_uuid: "DEP-1" }] } };
          throw new Error("unexpected POST " + url);
        },
        get: async (url) => {
          if (url.startsWith("/api/v1/deployments/")) {
            const status = sequence[Math.min(i++, sequence.length - 1)];
            return { data: { data: { status, logs: `log-at-${status}` } } };
          }
          throw new Error("unexpected GET " + url);
        },
      };
    };

    const okRun = await coolify.deployAndWait(scripted(["in_progress", "finished"]), "APP-1", { pollMs: 1, timeoutMs: 60000, sleep: noSleep });
    ok(okRun.deploymentUuid === "DEP-1" && /finished/.test(okRun.logTail), "finished deployment -> success with log tail");

    let permErr = null;
    try {
      await coolify.deployAndWait(scripted(["in_progress", "failed"]), "APP-1", { pollMs: 1, timeoutMs: 60000, sleep: noSleep });
    } catch (e) { permErr = e; }
    ok(permErr?.permanent === true && permErr?.deploymentUuid === "DEP-1" && /log-at-failed/.test(permErr?.logTail || ""), "failed build -> PERMANENT error with deployment uuid + log tail");

    let timeoutErr = null;
    try {
      await coolify.deployAndWait(scripted(["in_progress"]), "APP-1", { pollMs: 1, timeoutMs: 3, sleep: noSleep });
    } catch (e) { timeoutErr = e; }
    ok(timeoutErr && timeoutErr.permanent !== true && timeoutErr.deploymentUuid === "DEP-1", "timeout -> RETRYABLE error carrying deployment uuid for resume");

    // Resume path: an existing deploymentUuid skips the trigger POST entirely.
    const noPost = {
      post: async () => { throw new Error("must not re-trigger deploy on resume"); },
      get: async () => ({ data: { data: { status: "finished", logs: "resumed" } } }),
    };
    const resumed = await coolify.deployAndWait(noPost, "APP-1", { pollMs: 1, timeoutMs: 60000, deploymentUuid: "DEP-9", sleep: noSleep });
    ok(resumed.deploymentUuid === "DEP-9" && resumed.logTail === "resumed", "resume polls the EXISTING deployment, never re-triggers a build");
  }

  section("runner: permanent failure short-circuits retries");
  {
    const permLane = {
      isConfigured: () => true,
      configError: () => null,
      provision: async () => {
        const e = new Error("build failed hard");
        e.permanent = true;
        e.logTail = "npm ERR! missing script: build";
        e.deploymentUuid = "DEP-X";
        throw e;
      },
    };
    let s2 = makeStore([{ name: "JP", service_id: "starter-app-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 1024, repo_url: "https://github.com/cust/app" }]);
    await runner.processQueue(s2, { lanes: { coolify: permLane } });
    const jp = PJ(s2).JP;
    ok(jp.status === "needs_human" && jp.attempts === 1, "permanent failure -> needs_human on FIRST attempt (no retry burn)");
    ok(/Permanent failure/.test(jp.error || ""), "error labels the failure permanent");
    ok(/missing script: build/.test(jp.log || ""), "build log tail preserved on the job");
    ok(jp.deployment_uuid === "DEP-X", "deployment uuid recorded for staff diagnosis");
    ok(JSON.parse(jp.deployment_history || "[]").some((e) => e.uuid === "DEP-X"), "failed deployment still recorded in self-tracked history (visible in Deployments card)");

    // Retryable timeout hands its deployment_uuid to the queued retry.
    const timeoutLane = {
      isConfigured: () => true,
      configError: () => null,
      provision: async () => {
        const e = new Error("build still running after 10m");
        e.deploymentUuid = "DEP-T";
        throw e;
      },
    };
    s2 = makeStore([{ name: "JT", service_id: "starter-app-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 1024, repo_url: "https://github.com/cust/app" }]);
    await runner.processQueue(s2, { lanes: { coolify: timeoutLane } });
    const jt = PJ(s2).JT;
    ok(jt.status === "queued" && jt.attempts === 1 && jt.deployment_uuid === "DEP-T", "timed-out build -> queued retry carrying deployment_uuid for resume");
    ok(JSON.parse(jt.deployment_history || "[]").some((e) => e.uuid === "DEP-T"), "timed-out deployment recorded in history too");

    // Successful active job also records its deployment_uuid in the history array.
    const successLane = {
      isConfigured: () => true,
      configError: () => null,
      provision: async () => ({ externalRef: "APP-3", deploymentUuid: "DEP-OK", access: {}, log: "ok" }),
    };
    let s4 = makeStore([{ name: "JOK", service_id: "starter-app-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 1024, repo_url: "https://github.com/cust/app" }]);
    await runner.processQueue(s4, { lanes: { coolify: successLane } });
    const jok = PJ(s4).JOK;
    ok(jok.status === "active" && jok.deployment_uuid === "DEP-OK", "successful deploy records deployment_uuid");
    ok(JSON.parse(jok.deployment_history || "[]").length === 1 && JSON.parse(jok.deployment_history)[0].uuid === "DEP-OK", "successful deploy appends to deployment_history");
  }

  section("app_port threading (enqueue -> claimable fetch -> lane)");
  {
    const p = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "https://github.com/x/y", appPort: 8080 });
    ok(p.app_port === 8080, "buildJobPayload copies a valid app_port onto BYOA jobs");
    const pDefault = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "https://github.com/x/y" });
    ok(pDefault.app_port === undefined, "no appPort -> field omitted (lane falls back to 3000)");
    const pBad = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-app-hosting", repoUrl: "https://github.com/x/y", appPort: 99999 });
    ok(pBad.app_port === undefined, "out-of-range appPort rejected, not written");
    const pNonByoa = svc.buildJobPayload({ webAccount: "WA", invoice: "INV-1", serviceId: "starter-web-hosting", repoUrl: "", appPort: 8080 });
    ok(pNonByoa.app_port === undefined, "non-BYOA service never carries app_port");

    // Enqueue reads app_port off the Web Account alongside source_code.
    let s3 = makeStore([]);
    s3.docs["Web Account"]["WAP"] = { name: "WAP", source_code: "https://github.com/cust/app", app_port: 4321 };
    const eqp = await svc.enqueueProvisioningForInvoice({ client: s3, webAccount: "WAP", invoiceDocName: "INV-20", serviceIds: ["starter-app-hosting"] });
    ok(eqp.created.length === 1 && eqp.created[0].app_port === 4321, "enqueue attaches account app_port to BYOA job");

    // Same bug class as repo_url: the projected claimable fetch must include
    // app_port + deployment_uuid or the lane silently loses them.
    let seenPort = null, seenDep = null;
    const portLane = {
      isConfigured: () => true,
      configError: () => null,
      provision: async (job) => { seenPort = job.app_port; seenDep = job.deployment_uuid; return { externalRef: "APP-2", access: {}, log: "ok" }; },
    };
    s3 = makeStore([{ name: "JPORT", service_id: "starter-app-hosting", web_account: "WA", capacity_class: "volume", lane: "coolify", status: "queued", attempts: 0, ram_mb: 1024, repo_url: "https://github.com/cust/app", app_port: 4321, deployment_uuid: "DEP-R" }]);
    await runner.processQueue(s3, { lanes: { coolify: portLane } });
    ok(seenPort === 4321 && seenDep === "DEP-R", "runner passes app_port + deployment_uuid through the projected fetch to the lane");
  }

  section("deployment history: normalizeDeployment");
  {
    const n = coolify.normalizeDeployment({
      deployment_uuid: "DEP-1",
      status: "finished",
      commit: "abcdef1234567890",
      commit_message: "fix: thing",
      created_at: "2026-07-18 10:00:00",
      finished_at: "2026-07-18 10:03:00",
    });
    ok(n.uuid === "DEP-1" && n.result === "success" && n.commit === "abcdef123456", "normalizes uuid/result, truncates commit to 12 chars");
    const n2 = coolify.normalizeDeployment({ uuid: "DEP-2", deployment_status: "failed" });
    ok(n2.uuid === "DEP-2" && n2.result === "failure", "alt field names (uuid/deployment_status) handled");
    const n3 = coolify.normalizeDeployment({});
    ok(n3.uuid === "" && n3.result === "pending", "empty row degrades, never throws");
  }

  section("deploymentHistory: self-recorded (Coolify has no history endpoint)");
  {
    const dh = require("../services/provisioning/deploymentHistory");

    ok(dh.parseHistory(undefined).length === 0, "empty/undefined -> []");
    ok(dh.parseHistory("not json").length === 0, "malformed JSON degrades to []");

    let h = dh.appendDeployment("[]", "DEP-1", "t1");
    ok(JSON.parse(h).length === 1 && JSON.parse(h)[0].uuid === "DEP-1", "first append records uuid+timestamp");

    h = dh.appendDeployment(h, "DEP-2", "t2");
    ok(JSON.parse(h).length === 2, "second append grows the list");

    const same = dh.appendDeployment(h, "DEP-2", "t3");
    ok(JSON.parse(same).length === 2, "re-appending an already-recorded uuid is a no-op (idempotent resume)");

    ok(dh.appendDeployment("[]", "", "t") === "[]", "empty uuid -> no-op");

    // Cap at MAX_ENTRIES — oldest entries fall off, list never grows unbounded.
    let capped = "[]";
    for (let i = 0; i < dh.MAX_ENTRIES + 5; i++) capped = dh.appendDeployment(capped, "DEP-" + i, "t");
    const parsed = JSON.parse(capped);
    ok(parsed.length === dh.MAX_ENTRIES, "history capped at MAX_ENTRIES");
    ok(parsed[parsed.length - 1].uuid === `DEP-${dh.MAX_ENTRIES + 4}`, "newest entry survives the cap");
    ok(parsed[0].uuid === "DEP-5", "oldest entries dropped once capped");

    const uuids = dh.listUuids(capped, 3);
    ok(uuids.length === 3 && uuids[0] === `DEP-${dh.MAX_ENTRIES + 4}`, "listUuids returns newest-first, respecting limit");
  }

  section("appDomain: slug + fqdn helpers");
  {
    const appDomain = require("../services/provisioning/appDomain");
    const savedBase = process.env.APP_DOMAIN_BASE;

    delete process.env.APP_DOMAIN_BASE;
    ok(appDomain.isConfigured() === false, "unset APP_DOMAIN_BASE -> not configured");
    ok(appDomain.fqdnFor("shop") === "", "unconfigured -> empty fqdn (URL pending, never fabricated)");

    process.env.APP_DOMAIN_BASE = "apps.murzaktech.tech";
    ok(appDomain.isConfigured() === true, "set APP_DOMAIN_BASE -> configured");
    ok(appDomain.fqdnFor("shop") === "https://shop.apps.murzaktech.tech", "fqdnFor builds https URL under the base");

    process.env.APP_DOMAIN_BASE = "https://apps.murzaktech.tech/";
    ok(appDomain.fqdnFor("shop") === "https://shop.apps.murzaktech.tech", "scheme/trailing junk in env tolerated");

    const s1 = appDomain.slugWithSuffix("wa-starter-app-hosting", "PRV-1");
    const s2b = appDomain.slugWithSuffix("wa-starter-app-hosting", "PRV-2");
    ok(s1 !== s2b, "same slug, different jobs -> different suffixed slugs (collision-safe)");
    ok(s1 === appDomain.slugWithSuffix("wa-starter-app-hosting", "PRV-1"), "suffix deterministic per job (retries keep the same fqdn)");
    ok(s1.length <= 63, "suffixed slug stays a valid DNS label length");

    if (savedBase !== undefined) process.env.APP_DOMAIN_BASE = savedBase; else delete process.env.APP_DOMAIN_BASE;
  }

  // ---- tally ----
  console.log(`\n${"=".repeat(48)}`);
  console.log(`PROVISIONING TESTS: ${passed} passed, ${failed} failed`);
  if (failed) { console.error("Failed:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
