/**
 * Provisioning runner identity -- unique runner_id, real claim discrimination.
 *   node test/runnerIdentity.test.js
 *
 * claimJob is a write-then-verify optimistic claim: write runner_id, re-read
 * it, and only proceed if what comes back is still ours. That verification is
 * only meaningful if runnerId is actually unique per process. Before this,
 * processJob/processJobByName/processQueue all defaulted runnerId to the
 * LITERAL STRING "runner" (processJob, processQueue) or "worker"
 * (processJobByName), and queue.js's bullmq dispatcher calls
 * processJobByName with no runnerId at all -- so two poll-mode processes (two
 * containers, or one mid-restart) both wrote the identical constant, and the
 * verify step compared "runner" !== "runner", which is always false. Both
 * claims "succeeded". This is the documented 12-duplicate-Coolify-container
 * incident, not the earlier envelope-shape bug that was already fixed.
 */
const { execFileSync } = require("child_process");
const path = require("path");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const runner = require("../services/provisioning/runner");

(async () => {
  section("the default runner identity is not the old hardcoded literal");
  {
    ok(runner.DEFAULT_RUNNER_ID !== "runner", 'default is not the literal "runner"');
    ok(runner.DEFAULT_RUNNER_ID !== "worker", 'default is not the literal "worker"');
    ok(typeof runner.DEFAULT_RUNNER_ID === "string" && runner.DEFAULT_RUNNER_ID.length > 0, "a default identity exists");
  }

  section("the default identity is stable within one process, but carries process-specific entropy");
  {
    ok(runner.DEFAULT_RUNNER_ID.includes(String(process.pid)), "includes this process's pid");
    // A normal repeated require() (NOT cache-busted) hits Node's module
    // cache and returns the SAME module instance -- so every caller within
    // this one process sees the SAME identity. That consistency is what
    // claimJob's idempotent-reclaim path (line 112: "OR already owned by us")
    // depends on -- if the identity changed between calls, a process could
    // no longer recognize its own earlier claim.
    const runnerAgain = require("../services/provisioning/runner");
    ok(runnerAgain.DEFAULT_RUNNER_ID === runner.DEFAULT_RUNNER_ID, "stable across repeated require() in the same process");
  }

  section("two SEPARATE processes never share a runner identity");
  {
    // The actual failure mode: two containers/processes. Spawn a second real
    // node process running this same module and compare.
    const script = "console.log(require(" + JSON.stringify(path.resolve(__dirname, "../services/provisioning/runner")) + ").DEFAULT_RUNNER_ID)";
    const childOutput = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim();
    ok(childOutput.length > 0, "the child process produced an identity");
    ok(childOutput !== runner.DEFAULT_RUNNER_ID, `a second OS process gets a DIFFERENT identity (parent=${runner.DEFAULT_RUNNER_ID}, child=${childOutput})`);
  }

  section("RUNNER_ID env override is honored (operator can pin an identity)");
  {
    const script = "console.log(require(" + JSON.stringify(path.resolve(__dirname, "../services/provisioning/runner")) + ").DEFAULT_RUNNER_ID)";
    const childOutput = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, RUNNER_ID: "box-2-primary" },
    }).trim();
    ok(childOutput === "box-2-primary", `RUNNER_ID env var is honored verbatim (got ${childOutput})`);
  }

  section("processJob/processJobByName/processQueue no longer default to the shared literal");
  {
    // Read the function source to confirm the default parameter itself
    // changed, not just that a constant with the right value exists somewhere
    // unused.
    const src = runner.processJob.toString();
    ok(!/runnerId\s*=\s*["']runner["']/.test(src), "processJob's default parameter is no longer the literal \"runner\"");
    const src2 = runner.processJobByName.toString();
    ok(!/runnerId\s*=\s*["']worker["']/.test(src2), "processJobByName's default parameter is no longer the literal \"worker\"");
    const src3 = runner.processQueue.toString();
    ok(!/runnerId\s*=\s*["']runner["']/.test(src3), "processQueue's default parameter is no longer the literal \"runner\"");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("UNCAUGHT:", e); process.exit(1); });
