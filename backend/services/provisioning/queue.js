/**
 * Provisioning dispatch layer.
 *
 * Three modes (PROVISIONING_QUEUE):
 *   - "poll"   (default): the in-process interval runner (runner.startRunner).
 *   - "bullmq": Redis-backed dispatch. BullMQ provides the atomic claim (one
 *              worker per job), low-latency pickup and delayed retries.
 *   - off:     when PROVISIONING_RUNNER_ENABLED!=true, nothing dispatches.
 *
 * HYBRID CONTRACT: in bullmq mode the Frappe "Provisioning Job" doctype remains
 * the single source of truth. BullMQ carries only the job *name*; the worker
 * loads the doctype, runs runner.processJobByName (which writes all state back),
 * and BullMQ is used purely for locking + scheduling. A reconcile loop re-injects
 * any queued doctype rows missing from Redis (covers Redis restarts / lost
 * events / jobs created while the queue was down).
 *
 * SAFETY: use a dedicated, persistent Redis (PROVISIONING_REDIS_URL). Sharing the
 * session cache risks eviction silently dropping provisioning jobs — startup
 * checks warn loudly about both.
 */

const runner = require("./runner");

const QUEUE_NAME = "murzak-provisioning";

const state = {
  mode: "off",
  clientFactory: null,
  processFn: null,
  queue: null,
  worker: null,
  connection: null,
  reconcileTimer: null,
};

function runnerEnabled() {
  return String(process.env.PROVISIONING_RUNNER_ENABLED || "false").toLowerCase() === "true";
}

function desiredMode() {
  if (!runnerEnabled()) return "off";
  return String(process.env.PROVISIONING_QUEUE || "poll").toLowerCase() === "bullmq" ? "bullmq" : "poll";
}

function redisUrl() {
  return process.env.PROVISIONING_REDIS_URL || process.env.REDIS_URL || "";
}

function concurrency() {
  return Math.max(1, Number(process.env.PROVISIONING_CONCURRENCY || 2));
}

function reconcileMs() {
  return Math.max(30000, Number(process.env.PROVISIONING_RECONCILE_MS || 300000));
}

function configure({ frappeClientFactory, processFn } = {}) {
  state.clientFactory = frappeClientFactory || state.clientFactory;
  // processFn(client, name) -> outcome. Injectable for tests; defaults to the
  // doctype-truth worker entrypoint.
  state.processFn = processFn || ((client, name) => runner.processJobByName(client, name));
}

/**
 * The BullMQ worker processor (factored out so it can be unit-tested without
 * Redis). Loads + processes one job; on a transient "retry" outcome it schedules
 * a delayed re-dispatch. Never throws.
 */
function createProcessor({ clientFactory, processFn, getQueue }) {
  return async function processor(job) {
    const name = job?.data?.name;
    if (!name) return { outcome: "missing", reason: "no job name" };
    let out;
    try {
      out = await processFn(clientFactory(), name);
    } catch (e) {
      return { outcome: "error", reason: e.message };
    }
    if (out && out.outcome === "retry") {
      const q = getQueue && getQueue();
      if (q) {
        try {
          await q.add(
            "provision",
            { name },
            {
              delay: Math.max(0, Number(out.retryInSec) || 0) * 1000,
              jobId: `${name}:retry:${out.attempts || 0}`,
              removeOnComplete: true,
              removeOnFail: 100,
            }
          );
        } catch (e) {
          // Re-dispatch failed — the reconcile loop will pick the job up later.
          console.error(`[provisioning] retry re-enqueue failed for ${name}: ${e.message}`);
        }
      }
    }
    return out;
  };
}

/** Add a job name to the queue (idempotent by jobId). No-op unless in bullmq mode. */
async function enqueue(name, { delaySec = 0 } = {}) {
  if (state.mode !== "bullmq" || !state.queue || !name) return { enqueued: false };
  try {
    await state.queue.add(
      "provision",
      { name },
      {
        jobId: name, // dedup: immediate enqueue + reconcile won't double-add
        delay: Math.max(0, Number(delaySec) || 0) * 1000,
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
    return { enqueued: true };
  } catch (e) {
    console.error(`[provisioning] enqueue failed for ${name}: ${e.message}`);
    return { enqueued: false, error: e.message };
  }
}

/** Re-inject any queued doctype rows that aren't in Redis. Best-effort. */
async function reconcile() {
  if (state.mode !== "bullmq" || !state.clientFactory) return { reconciled: 0 };
  let jobs = [];
  try {
    jobs = await runner.fetchClaimable(state.clientFactory(), 100);
  } catch (e) {
    return { reconciled: 0, error: e.message };
  }
  let n = 0;
  for (const j of jobs) {
    const r = await enqueue(j.name);
    if (r.enqueued) n++;
  }
  return { reconciled: n };
}

async function warnRedisSafety(connection) {
  if (!process.env.PROVISIONING_REDIS_URL && process.env.REDIS_URL) {
    console.warn(
      "[provisioning] PROVISIONING_REDIS_URL not set — using the session REDIS_URL. " +
        "Use a DEDICATED, persistent Redis so cache eviction can't drop provisioning jobs."
    );
  }
  try {
    const res = await connection.config("GET", "maxmemory-policy");
    const policy = Array.isArray(res) ? res[1] : res?.["maxmemory-policy"];
    if (policy && policy !== "noeviction") {
      console.error(
        `[provisioning] Redis maxmemory-policy is "${policy}" — queued jobs can be EVICTED. ` +
          'Set it to "noeviction" (and enable AOF/RDB persistence) for the provisioning Redis.'
      );
    }
  } catch {
    // Managed Redis often blocks CONFIG GET — skip the check silently.
  }
}

async function startBull() {
  const url = redisUrl();
  if (!url) {
    console.warn("[provisioning] bullmq mode requested but no Redis URL — falling back to poll.");
    return startPoll();
  }
  let Queue, Worker, IORedis;
  try {
    ({ Queue, Worker } = require("bullmq"));
    IORedis = require("ioredis");
  } catch (e) {
    console.error(`[provisioning] bullmq/ioredis not available (${e.message}) — falling back to poll.`);
    return startPoll();
  }

  try {
    state.connection = new IORedis(url, { maxRetriesPerRequest: null });
    await warnRedisSafety(state.connection);

    state.queue = new Queue(QUEUE_NAME, { connection: state.connection });
    const processor = createProcessor({
      clientFactory: state.clientFactory,
      processFn: state.processFn,
      getQueue: () => state.queue,
    });
    state.worker = new Worker(QUEUE_NAME, processor, {
      connection: state.connection,
      concurrency: concurrency(),
    });
    state.worker.on("failed", (job, err) =>
      console.error(`[provisioning] worker job ${job?.id} failed: ${err?.message}`)
    );

    state.mode = "bullmq";

    // Initial + periodic reconcile (re-inject lost/queued jobs).
    const tick = () => reconcile().catch((e) => console.error("[provisioning] reconcile error:", e.message));
    setTimeout(tick, 3000).unref?.();
    state.reconcileTimer = setInterval(tick, reconcileMs());
    state.reconcileTimer.unref?.();

    return { mode: "bullmq", concurrency: concurrency(), reconcileMs: reconcileMs() };
  } catch (e) {
    console.error(`[provisioning] failed to start bullmq (${e.message}) — falling back to poll.`);
    return startPoll();
  }
}

function startPoll() {
  state.mode = "poll";
  const r = runner.startRunner(state.clientFactory);
  return { mode: "poll", ...r };
}

/** Start the dispatcher per desiredMode(). Never throws. */
async function start() {
  if (!state.clientFactory) return { mode: "off", reason: "not configured" };
  const mode = desiredMode();
  try {
    if (mode === "off") {
      state.mode = "off";
      return { mode: "off" };
    }
    if (mode === "bullmq") return await startBull();
    return startPoll();
  } catch (e) {
    console.error("[provisioning] dispatcher start failed:", e.message);
    return { mode: "off", error: e.message };
  }
}

async function health() {
  const out = { mode: state.mode };
  if (state.mode === "bullmq" && state.queue) {
    try {
      out.counts = await state.queue.getJobCounts();
    } catch (e) {
      out.countsError = e.message;
    }
  }
  return out;
}

async function stop() {
  if (state.reconcileTimer) clearInterval(state.reconcileTimer);
  state.reconcileTimer = null;
  try {
    if (state.worker) await state.worker.close();
    if (state.queue) await state.queue.close();
    if (state.connection) await state.connection.quit();
  } catch {
    /* ignore shutdown errors */
  }
  runner.stopRunner();
  state.worker = state.queue = state.connection = null;
  state.mode = "off";
}

module.exports = {
  QUEUE_NAME,
  desiredMode,
  configure,
  createProcessor,
  enqueue,
  reconcile,
  start,
  health,
  stop,
  _state: state,
};
