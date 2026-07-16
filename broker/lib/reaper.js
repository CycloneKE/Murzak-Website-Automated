/**
 * Orphan-process reaper (closes the P5.3 gap noted in exec.js/README). A
 * jailed shell runs under `setsid` so killing its process group on
 * disconnect reaps the shell and its DIRECT children — but grandchildren
 * that get re-parented to the container's PID 1 (e.g. a backgrounded
 * `nohup ... &` two levels deep) can survive session teardown. "Closing the
 * tab is not a security boundary" until something goes and cleans those up.
 *
 * How it finds orphans: every jailed shell is exec'd with
 * MURZAK_TERMINAL_SESSION=<sessionId> in its environment (see
 * buildExecCreatePayload in exec.js). Any process in the container carrying
 * that marker whose session id is NOT in the broker's current live-session
 * set is, by definition, left over from a session that has already ended —
 * kill its process group.
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
    '  stat=$(cat "$d/stat" 2>/dev/null) || continue',
    '  rest=${stat##*) }',
    '  set -- $rest',
    '  pgrp=$3',
    '  [ "$pgrp" = "$p" ] || continue',
    '  kill -9 -"$p" 2>/dev/null',
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
