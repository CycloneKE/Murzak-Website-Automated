/**
 * Exec jail construction + session lifecycle — the pure, unit-testable core of
 * P5.3. The actual Docker hijack stream lives in dockerClient.js (unverifiable
 * from a dev box); everything here is deterministic logic that decides HOW the
 * shell is jailed and WHEN a session must die, so it can be tested exhaustively.
 */

// Shell candidates tried in order — bash if the image has it, else sh. The
// container almost certainly has /bin/sh; bash is a nicety.
const DEFAULT_SHELL_PROBE = "command -v bash >/dev/null 2>&1 && exec bash -il || exec sh";

/**
 * Build the Docker `POST /containers/{id}/exec` payload for a JAILED shell:
 *   - non-root user (uid:gid) — the container image must actually have this
 *     user; we never exec as root (`-u 0`) even if the image defaults to it.
 *   - a login-ish interactive shell — NOT wrapped in setsid (see below).
 *   - a sane TERM + a marker env var the reaper sweep greps for.
 *
 * NOT wrapped in `setsid`/`setsid -c`, despite that being the original
 * design (see git history) — confirmed live 2026-08-23, isolated with four
 * paired A/B execs directly against the Docker socket, bypassing the broker
 * and its own retry/session logic entirely: a `Tty:true` exec's hijacked
 * stream dies with ZERO bytes delivered, at ANY point before the process
 * naturally exits, whenever the command is wrapped in `setsid` (bare OR
 * `-c`) — but the IDENTICAL command works perfectly (correct multi-second
 * streaming, clean close on real exit) the moment `setsid` is removed. A
 * fast command (`echo hi`, done in under a tick) slips through either way,
 * which is what made this look fixed earlier — a command with any real gap
 * before its output or exit (a `sleep`, or a real user typing) reliably
 * loses the WHOLE session, including output already produced before the
 * gap. This reproduces identically with or without stdin attached, so it
 * is not about stdin — something about `setsid` putting the process in a
 * new session is fatal to this Docker/runc TTY hijack in this environment.
 * Losing setsid means the shell is no longer its own process-group leader,
 * so the reaper (lib/reaper.js) can no longer group-kill it — updated
 * there to kill the marked PID directly instead (see that file's docblock).
 */
function buildExecCreatePayload(opts = {}) {
  const user = opts.user || process.env.TERMINAL_EXEC_USER || "10001:10001";
  const sessionId = opts.sessionId || "";
  // The marker env lets an out-of-band reaper find orphaned processes
  // belonging to a dead session (see lib/reaper.js).
  const inner = opts.shellProbe || DEFAULT_SHELL_PROBE;
  const cmd = ["sh", "-c", inner];
  return {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: user,
    Env: [
      "TERM=xterm-256color",
      sessionId ? `MURZAK_TERMINAL_SESSION=${sessionId}` : "MURZAK_TERMINAL_SESSION=1",
    ],
    Cmd: cmd,
  };
}

/**
 * Session lifecycle manager. Enforces, per the plan:
 *   - concurrency cap per web_account (default 1)
 *   - global concurrency cap (protects the shared box)
 *   - idle timeout (no stdin) and absolute timeout
 * Transport-agnostic: callers feed it open/close/activity events and register
 * an onExpire(sessionId, reason) callback that does the actual kill. Timers use
 * injectable setTimeout/clearTimeout/now so tests run without real time.
 */
class SessionManager {
  constructor(opts = {}) {
    this.idleMs = opts.idleMs ?? Number(process.env.TERMINAL_IDLE_MS || 5 * 60 * 1000);
    this.absoluteMs = opts.absoluteMs ?? Number(process.env.TERMINAL_ABSOLUTE_MS || 30 * 60 * 1000);
    this.perAccount = opts.perAccount ?? Number(process.env.TERMINAL_MAX_PER_ACCOUNT || 1);
    this.globalMax = opts.globalMax ?? Number(process.env.TERMINAL_MAX_GLOBAL || 20);
    this._setTimeout = opts.setTimeout || setTimeout;
    this._clearTimeout = opts.clearTimeout || clearTimeout;
    this._now = opts.now || (() => Date.now());
    this.onExpire = opts.onExpire || (() => {});
    this.sessions = new Map(); // sessionId -> { webAccount, idleTimer, absTimer, startedAt }
  }

  countForAccount(webAccount) {
    let n = 0;
    for (const s of this.sessions.values()) if (s.webAccount === webAccount) n++;
    return n;
  }

  /** Throws (with .code) if a new session would exceed a cap. */
  assertCanOpen(webAccount) {
    if (this.sessions.size >= this.globalMax) {
      const e = new Error("The developer terminal is at capacity — try again shortly.");
      e.code = "GLOBAL_CAP"; throw e;
    }
    if (this.countForAccount(webAccount) >= this.perAccount) {
      const e = new Error("You already have a terminal session open. Close it first.");
      e.code = "ACCOUNT_CAP"; throw e;
    }
  }

  open(sessionId, webAccount) {
    this.assertCanOpen(webAccount);
    const entry = { webAccount, startedAt: this._now(), idleTimer: null, absTimer: null };
    entry.absTimer = this._setTimeout(() => this._expire(sessionId, "absolute_timeout"), this.absoluteMs);
    this.sessions.set(sessionId, entry);
    this.touch(sessionId); // arm the idle timer
    return entry;
  }

  /** Reset the idle timer on stdin activity. */
  touch(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.idleTimer) this._clearTimeout(s.idleTimer);
    s.idleTimer = this._setTimeout(() => this._expire(sessionId, "idle_timeout"), this.idleMs);
  }

  _expire(sessionId, reason) {
    if (!this.sessions.has(sessionId)) return;
    this.close(sessionId);
    this.onExpire(sessionId, reason);
  }

  /** Remove a session and clear its timers (call on any close path). */
  close(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.idleTimer) this._clearTimeout(s.idleTimer);
    if (s.absTimer) this._clearTimeout(s.absTimer);
    this.sessions.delete(sessionId);
  }

  has(sessionId) { return this.sessions.has(sessionId); }
  size() { return this.sessions.size; }
}

module.exports = { buildExecCreatePayload, SessionManager, DEFAULT_SHELL_PROBE };
