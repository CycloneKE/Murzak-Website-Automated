/**
 * Orphan-process reaper (closes the P5.3 gap noted in exec.js/README).
 *
 * ORIGINALLY designed around a jailed shell running under `setsid`, so
 * killing its process group on disconnect would reap the shell and its
 * DIRECT children in one shot. `setsid` was removed from exec.js entirely
 * (confirmed live 2026-08-23: it reliably killed the exec's own hijacked TTY
 * stream before real output/exit — see that file's docblock), so the shell
 * is no longer its own process-group leader and a group-kill (`kill -9
 * -$pid`) can no longer be aimed at it. This sweep now kills the marked PID
 * directly instead. That is a real, narrower guarantee than before: a
 * grandchild the shell backgrounds (`nohup ... &`) and that gets
 * re-parented before this sweep runs will NOT be caught by killing the
 * shell's own PID, whereas a working process-group kill would have caught
 * it. "Closing the tab is not a security boundary" already acknowledged
 * grandchildren as a gap for OTHER reasons (re-parenting to PID 1 mid-
 * session); this sweep is the backstop for exactly that class of leftover,
 * and it still catches the common case — the marked shell itself, and any
 * child still in its own process group when the sweep runs, since a plain
 * PID kill only fails to reach a child that already re-parented away.
 *
 * How it finds orphans: every jailed shell is exec'd with
 * MURZAK_TERMINAL_SESSION=<sessionId> in its environment (see
 * buildExecCreatePayload in exec.js). Any process in the container carrying
 * that marker whose session id is NOT in the broker's current live-session
 * set is, by definition, left over from a session that has already ended —
 * kill it.
 *
 * Pure/testable half: buildReaperScript()/buildReaperExecPayload() — a
 * deterministic POSIX sh script using only /proc (no pgrep/pkill, which
 * minimal customer images may lack). Parses /proc/{pid}/stat by stripping
 * through the last ")" rather than field-splitting on spaces, since the
 * `comm` field itself can contain spaces or parens.
 *
 * Live-Docker half: sweepContainer()/sweepAll() — exec the script into each
 * container the broker has touched since it started. Deps
 * (createExec/startExecStream via runExecAndCollect) are injected so this is
 * testable without a real Docker host, same convention as the rest of this
 * broker's "logic is tested, the live socket call is flagged unverified"
 * split.
 */

function buildReaperScript() {
  return [
    'LIVE="$1"',
    'for d in /proc/[0-9]*; do',
    '  p=${d#/proc/}',
    '  [ "$p" = "1" ] && continue',
    '  [ -r "$d/environ" ] || continue',
    '  sid=$(tr "\\0" "\\n" < "$d/environ" 2>/dev/null | sed -n "s/^MURZAK_TERMINAL_SESSION=//p")',
    '  [ -n "$sid" ] || continue',
    '  case " $LIVE " in',
    '    *" $sid "*) continue ;;',
    '  esac',
    '  kill -9 "$p" 2>/dev/null',
    'done',
  ].join("\n");
}

/**
 * Docker exec payload for a one-shot reaper pass — runs as the SAME non-root
 * jail user as the interactive sessions (so it can read /proc/{pid}/environ
 * for processes it owns, and no others), never as root, and carries no
 * MURZAK_TERMINAL_SESSION marker itself (so it can never mistake itself for
 * a live/orphaned session).
 */
function buildReaperExecPayload(liveSessionIds, opts = {}) {
  const user = opts.user || process.env.TERMINAL_EXEC_USER || "10001:10001";
  const script = buildReaperScript();
  const liveArg = (liveSessionIds || []).filter(Boolean).join(" ");
  return {
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: user,
    // `sh -c script arg0 arg1` sets $0=arg0 (unused, just a conventional
    // label) and $1=arg1 inside the script — this is how LIVE="$1" is fed.
    Cmd: ["sh", "-c", script, "reaper", liveArg],
  };
}

/** Sweep a single container. Throws on failure — caller decides how to log/aggregate. */
async function sweepContainer(containerId, liveSessionIds, docker) {
  const payload = buildReaperExecPayload(liveSessionIds);
  await docker.runExecAndCollect(containerId, payload);
}

/**
 * Sweep every given container. Best-effort per container — one container's
 * exec failing (e.g. it was removed since the last sweep) must never stop
 * the sweep from reaching the rest.
 */
async function sweepAll(containerIds, liveSessionIds, docker) {
  const summary = { swept: 0, errors: 0 };
  for (const containerId of containerIds) {
    try {
      await sweepContainer(containerId, liveSessionIds, docker);
      summary.swept++;
    } catch (e) {
      summary.errors++;
      console.error(`[broker] reaper sweep failed for ${containerId}:`, e.message);
    }
  }
  return summary;
}

module.exports = { buildReaperScript, buildReaperExecPayload, sweepContainer, sweepAll };
