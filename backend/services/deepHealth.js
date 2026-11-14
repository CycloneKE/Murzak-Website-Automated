// services/deepHealth.js
//
// The "is checkout actually able to work?" probe behind GET /api/health/deep.
//
// /api/health only proves the Node process is up and routing. It stays green
// when Frappe (the record of every account, invoice and order) is unreachable,
// which is exactly when sign-in, checkout and payment activation are all
// failing. A monitor watching only /api/health reports "fine" through that
// whole outage.
//
// This runs a named set of dependency checks and answers ok only when every
// one passes. It is public and unauthenticated (monitors cannot log in), so:
//   - the answer is cached for a short while, so hammering the endpoint cannot
//     be turned into load on Frappe or Redis;
//   - concurrent callers share one in-flight run;
//   - each check is time-boxed, so a hung dependency reads as "down" instead
//     of hanging the probe;
//   - the body carries only a name and ok/down per check, never an error
//     message, host name or version.

const DEFAULT_TTL_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 1000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * checks: { name: async () => any }. A check passes unless it throws/rejects.
 * Returns an async function giving { ok, checks: { name: "ok" | "down" } }.
 */
function createDeepHealth(checks, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now || Date.now;
  const log = opts.log || ((name, e) => console.error(`HEALTH: ${name} is down: ${e.message}`));

  let cached = null; // { at, result }
  let inFlight = null;

  async function runAll() {
    const names = Object.keys(checks);
    const outcomes = await Promise.all(
      names.map(async (name) => {
        try {
          await withTimeout(Promise.resolve().then(checks[name]), timeoutMs);
          return "ok";
        } catch (e) {
          log(name, e); // the reason goes to the server log, never to the caller
          return "down";
        }
      })
    );
    const report = {};
    names.forEach((name, i) => { report[name] = outcomes[i]; });
    return { ok: outcomes.every((o) => o === "ok"), checks: report };
  }

  return async function deepHealth() {
    if (cached && now() - cached.at < ttlMs) return cached.result;
    if (!inFlight) {
      inFlight = runAll()
        .then((result) => { cached = { at: now(), result }; return result; })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}

module.exports = { createDeepHealth };
