/**
 * Orphan-process reaper tests. buildReaperScript/buildReaperExecPayload are
 * pure and checked directly; sweepContainer/sweepAll are checked against an
 * injected fake docker client — no real Docker host, no real /proc (the
 * script's actual behavior against a live Linux container is unverified
 * here, same convention as dockerClient.js's exec stream).
 * node test/reaper.test.js
 */

const { buildReaperScript, buildReaperExecPayload, sweepContainer, sweepAll } = require("../lib/reaper");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function rejects(promise, msg) {
  return promise.then(
    () => ok(false, msg + " (did not reject)"),
    () => ok(true, msg)
  );
}

console.log("# buildReaperScript — POSIX sh, no gawk/pgrep dependency");
{
  const s = buildReaperScript();
  ok(typeof s === "string" && s.length > 0, "returns a non-empty script");
  ok(s.includes("MURZAK_TERMINAL_SESSION="), "greps for the session marker env var");
  ok(s.includes('kill -9 -"$p"'), "kills the PROCESS GROUP (leading '-'), not just the pid");
  ok(s.includes('[ "$p" = "1" ] && continue'), "never targets PID 1");
  ok(s.includes('[ "$pgrp" = "$p" ] || continue'), "only acts on group LEADERS (pid == pgrp), never arbitrary children");
  ok(!s.includes("pgrep") && !s.includes("pkill"), "avoids tools that minimal/busybox images may not have");
  ok(buildReaperScript() === s, "deterministic — same output every call");
}

console.log("# buildReaperExecPayload");
{
  const p = buildReaperExecPayload(["sess-a", "sess-b"]);
  ok(p.User === "10001:10001", "runs as the same non-root jail user as interactive sessions");
  ok(p.User !== "0" && !p.User.startsWith("0:"), "never runs the reaper as root");
  ok(!p.AttachStdin, "no stdin — this is a one-shot command, not an interactive shell");
  ok(p.Cmd[0] === "sh" && p.Cmd[1] === "-c", "runs via sh -c");
  ok(p.Cmd[3] === "reaper" && p.Cmd[4] === "sess-a sess-b", "live session ids land as the script's $1 (after the sh -c ... $0 label), space-separated");
  ok(!p.Env, "the reaper's OWN exec sets no Env at all (unlike buildExecCreatePayload) — can't mistake itself for live/orphaned");

  const empty = buildReaperExecPayload([]);
  ok(empty.Cmd[4] === "", "empty live-session list still produces a valid (empty) $1");

  const custom = buildReaperExecPayload(["s1"], { user: "2000:2000" });
  ok(custom.User === "2000:2000", "honors an explicit user override");
}

async function main() {
  console.log("# sweepContainer — delegates to the injected docker client");
  {
    let capturedContainerId, capturedPayload;
    const fakeDocker = {
      runExecAndCollect: async (containerId, payload) => {
        capturedContainerId = containerId;
        capturedPayload = payload;
        return "";
      },
    };
    await sweepContainer("container-123", ["live-1"], fakeDocker);
    ok(capturedContainerId === "container-123", "targets the requested container");
    ok(capturedPayload.Cmd[4] === "live-1", "forwards the live-session list into the exec payload");
  }

  console.log("# sweepContainer — propagates a failure to the caller");
  {
    const failingDocker = { runExecAndCollect: async () => { throw new Error("boom"); } };
    await rejects(sweepContainer("c1", [], failingDocker), "a docker-level failure rejects");
  }

  console.log("# sweepAll — one container's failure doesn't stop the rest");
  {
    const calls = [];
    const fakeDocker = {
      runExecAndCollect: async (containerId) => {
        calls.push(containerId);
        if (containerId === "bad") throw new Error("exec failed: container removed");
        return "";
      },
    };
    const summary = await sweepAll(["good-1", "bad", "good-2"], ["sess-x"], fakeDocker);
    ok(calls.length === 3, "attempted all three containers despite the middle one failing");
    ok(summary.swept === 2, "counted the two successful sweeps");
    ok(summary.errors === 1, "counted exactly one failure");
  }

  console.log("# sweepAll — empty container list is a no-op, not an error");
  {
    const fakeDocker = { runExecAndCollect: async () => "" };
    const summary = await sweepAll([], [], fakeDocker);
    ok(summary.swept === 0 && summary.errors === 0, "nothing to sweep -> zero/zero, no crash");
  }

  console.log(`\nREAPER TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
}

main();
