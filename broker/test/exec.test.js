/**
 * Exec jail + session-manager tests. Pure logic, injected timers — no Docker,
 * no real waiting. node test/exec.test.js
 */

const assert = require("assert");
const { buildExecCreatePayload, SessionManager } = require("../lib/exec");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function throws(fn, code, msg) {
  try { fn(); ok(false, msg + " (did not throw)"); }
  catch (e) { ok(!code || e.code === code, msg + (code ? ` (code=${e.code})` : "")); }
}

console.log("# buildExecCreatePayload — jail defaults");
{
  const p = buildExecCreatePayload({ sessionId: "sess-1" });
  ok(p.User === "10001:10001", "defaults to a non-root uid:gid (never root)");
  ok(p.User !== "0" && p.User !== "root" && !p.User.startsWith("0:"), "never execs as root");
  ok(p.Tty === true && p.AttachStdin && p.AttachStdout, "attaches a TTY + stdio");
  ok(p.Cmd[0] === "setsid", "wraps the shell in setsid (own process group for reaping)");
  ok(p.Env.some((e) => e === "TERM=xterm-256color"), "sets TERM");
  ok(p.Env.some((e) => e === "MURZAK_TERMINAL_SESSION=sess-1"), "stamps the session-id marker env for the reaper");

  const custom = buildExecCreatePayload({ user: "2000:2000", sessionId: "x" });
  ok(custom.User === "2000:2000", "honors an explicit non-root user override");
}

console.log("# SessionManager — caps + timers");
{
  // Fake clock/timers so we can fire idle/absolute deterministically.
  let seq = 0;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
  const fakeClearTimeout = (id) => timers.delete(id);
  const fire = (id) => { const t = timers.get(id); if (t) { timers.delete(id); t.fn(); } };

  const expired = [];
  const sm = new SessionManager({
    idleMs: 1000, absoluteMs: 5000, perAccount: 1, globalMax: 2,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, now: () => 0,
    onExpire: (sid, reason) => expired.push({ sid, reason }),
  });

  sm.open("s1", "WA1");
  ok(sm.size() === 1, "open tracks a session");
  throws(() => sm.open("s2", "WA1"), "ACCOUNT_CAP", "per-account cap (1) rejects a 2nd session for same account");

  sm.open("s3", "WA2");
  ok(sm.size() === 2, "different account can open (under global cap)");
  throws(() => sm.open("s4", "WA3"), "GLOBAL_CAP", "global cap (2) rejects a 3rd overall session");

  // Fire s1's idle timer -> should expire with idle_timeout and free the slot.
  const s1 = sm.sessions.get("s1");
  fire(s1.idleTimer);
  ok(expired.some((e) => e.sid === "s1" && e.reason === "idle_timeout"), "idle timer expires the session (idle_timeout)");
  ok(!sm.has("s1"), "expired session is removed");
  ok(sm.countForAccount("WA1") === 0, "account slot freed after expiry");

  // Now WA1 can open again; fire absolute timer this time.
  sm.open("s5", "WA1");
  const s5 = sm.sessions.get("s5");
  fire(s5.absTimer);
  ok(expired.some((e) => e.sid === "s5" && e.reason === "absolute_timeout"), "absolute timer expires the session (absolute_timeout)");

  // WA2's s3 is still open (never expired/closed) — confirms expiry only
  // frees the SPECIFIC account whose session expired, not every account.
  throws(() => sm.open("s6", "WA2"), "ACCOUNT_CAP", "WA2's still-open s3 correctly still counts against its own cap");
}

console.log("# SessionManager — touch re-arms idle timer");
{
  let seq = 0;
  const timers = new Map();
  const cleared = [];
  const sm = new SessionManager({
    idleMs: 1000, absoluteMs: 5000, perAccount: 5, globalMax: 5,
    setTimeout: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: (id) => { cleared.push(id); timers.delete(id); },
    now: () => 0,
  });
  sm.open("t1", "WA");
  const firstIdle = sm.sessions.get("t1").idleTimer;
  sm.touch("t1");
  const secondIdle = sm.sessions.get("t1").idleTimer;
  ok(cleared.includes(firstIdle), "touch clears the previous idle timer");
  ok(secondIdle !== firstIdle, "touch installs a fresh idle timer");
}

console.log(`\nEXEC TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
