/**
 * The deep health probe tells the truth about dependencies - node test/deepHealth.test.js
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { createDeepHealth } = require("../services/deepHealth");
const quiet = { log: () => {} };

(async () => {
  section("every dependency up");
  {
    const r = await createDeepHealth({ frappe: async () => {}, sessions: async () => {} }, quiet)();
    ok(r.ok === true && r.checks.frappe === "ok" && r.checks.sessions === "ok", "answers ok with each check named");
  }

  section("one dependency down");
  {
    const logged = [];
    const r = await createDeepHealth(
      { frappe: async () => { throw new Error("ECONNREFUSED 10.0.0.5:8000"); }, sessions: async () => {} },
      { log: (name, e) => logged.push(`${name}: ${e.message}`) }
    )();
    ok(r.ok === false && r.checks.frappe === "down" && r.checks.sessions === "ok", "answers not ok and says which one");
    ok(!JSON.stringify(r).includes("ECONNREFUSED") && !JSON.stringify(r).includes("10.0.0.5"), "the reason is not given to the caller");
    ok(logged.length === 1 && /ECONNREFUSED/.test(logged[0]), "the reason goes to the server log");
  }

  section("a dependency that hangs");
  {
    const started = Date.now();
    const r = await createDeepHealth({ frappe: () => new Promise(() => {}) }, { ...quiet, timeoutMs: 50 })();
    ok(r.ok === false && r.checks.frappe === "down", "reads as down");
    ok(Date.now() - started < 1000, "and does not hang the probe");
  }

  section("the endpoint cannot be used to load the dependencies");
  {
    let calls = 0;
    let t = 1000;
    const probe = createDeepHealth({ frappe: async () => { calls++; } }, { ...quiet, ttlMs: 30000, now: () => t });
    await probe(); await probe(); await probe();
    ok(calls === 1, "repeated calls inside the cache window run the checks once");
    t += 31000;
    await probe();
    ok(calls === 2, "after the window the checks run again");

    let slow = 0;
    const p2 = createDeepHealth({ frappe: async () => { slow++; await new Promise((r) => setTimeout(r, 30)); } }, quiet);
    await Promise.all([p2(), p2(), p2(), p2()]);
    ok(slow === 1, "callers arriving together share one run");
  }

  section("a failure is not stuck after recovery");
  {
    let up = false;
    let t = 0;
    const probe = createDeepHealth({ frappe: async () => { if (!up) throw new Error("down"); } }, { ...quiet, ttlMs: 30000, now: () => t });
    ok((await probe()).ok === false, "down while it is down");
    up = true; t += 31000;
    ok((await probe()).ok === true, "ok again once it recovers");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
