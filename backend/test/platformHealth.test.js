/**
 * Platform Health Check sweep tests — sweepOrphanReconciliation and
 * sweepCapacitySnapshot (docs/superpowers/specs/2026-08-15-platform-maintenance-automation-design.md).
 * No live Coolify/Frappe/SMTP here: orphan reconciliation is exercised the
 * same way test/orphanReconciliation.test.js does (monkeypatch the shared
 * coolify/targets module objects), capacity via the injectable
 * getReservedRamMb dep, and admin email via monkeypatching utils/mailer's
 * cached module object.
 *   node test/platformHealth.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { sweepOrphanReconciliation, sweepCapacitySnapshot, latestHealthChecks } = require("../services/provisioning/platformHealth");
const coolify = require("../services/provisioning/lanes/coolify");
const targets = require("../services/provisioning/targets");
const mailer = require("../utils/mailer");

async function withCoolifyMocks({ listTargetsImpl, isConfiguredImpl, listApplicationsImpl, listServicesImpl }, fn) {
  const prev = {
    listTargets: targets.listTargets,
    isConfigured: coolify.isConfigured,
    listApplications: coolify.listApplications,
    listServices: coolify.listServices,
  };
  targets.listTargets = listTargetsImpl;
  coolify.isConfigured = isConfiguredImpl;
  coolify.listApplications = listApplicationsImpl;
  coolify.listServices = listServicesImpl;
  try {
    await fn();
  } finally {
    targets.listTargets = prev.listTargets;
    coolify.isConfigured = prev.isConfigured;
    coolify.listApplications = prev.listApplications;
    coolify.listServices = prev.listServices;
  }
}

async function withMailer(sendMailImpl, fn) {
  const prev = mailer.sendMail;
  mailer.sendMail = sendMailImpl;
  try {
    await fn();
  } finally {
    mailer.sendMail = prev;
  }
}

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** Records every doctype write (as posted to the fake Frappe client). */
function recordingClient(externalRefs = []) {
  const posts = [];
  return {
    posts,
    get: async () => ({ data: { data: externalRefs.map((r) => ({ external_ref: r })) } }),
    post: async (url, body) => { posts.push({ url, body }); return { data: { data: body } }; },
  };
}

(async () => {
  section("sweepOrphanReconciliation: clean run writes 'ok', never alerts");
  await withEnv({ ADMIN_EMAILS: "ops@murzaktech.com" }, async () => {
    await withMailer(async () => { throw new Error("must not be called on a clean run"); }, async () => {
      await withCoolifyMocks({
        listTargetsImpl: () => [{ id: "box-1" }],
        isConfiguredImpl: () => true,
        listApplicationsImpl: async () => [{ uuid: "app-1" }],
        listServicesImpl: async () => [],
      }, async () => {
        const client = recordingClient(["app-1"]);
        const r = await sweepOrphanReconciliation(client);
        ok(r.status === "ok", "status ok when nothing orphaned");
        ok(r.alerted === false, "not alerted on a clean run");
        ok(client.posts.length === 1, "wrote exactly one Platform Health Check row");
        ok(client.posts[0].body.job_type === "orphan_check", "row tagged orphan_check");
        ok(client.posts[0].body.status === "ok", "row status ok");
        ok(client.posts[0].body.alert_sent === 0, "row records alert_sent=0");
      });
    });
  });

  section("sweepOrphanReconciliation: orphan found -> 'attention', emails admins, writes row");
  await withEnv({ ADMIN_EMAILS: "ops@murzaktech.com,root@murzaktech.com" }, async () => {
    const sent = [];
    await withMailer(async ({ to, subject }) => { sent.push({ to, subject }); }, async () => {
      await withCoolifyMocks({
        listTargetsImpl: () => [{ id: "box-1" }],
        isConfiguredImpl: () => true,
        listApplicationsImpl: async () => [{ uuid: "app-owned" }, { uuid: "app-orphan" }],
        listServicesImpl: async () => [],
      }, async () => {
        const client = recordingClient(["app-owned"]);
        const r = await sweepOrphanReconciliation(client);
        ok(r.status === "attention", "status attention when an orphan exists");
        ok(r.alerted === true, "alerted returns true");
        ok(sent.length === 2, "emailed every ADMIN_EMAILS recipient");
        ok(client.posts[0].body.status === "attention", "row status attention");
        ok(client.posts[0].body.alert_sent === 1, "row records alert_sent=1");
      });
    });
  });

  section("sweepOrphanReconciliation: no ADMIN_EMAILS -> attention row still written, not alerted");
  await withEnv({ ADMIN_EMAILS: "" }, async () => {
    await withCoolifyMocks({
      listTargetsImpl: () => [{ id: "box-1" }],
      isConfiguredImpl: () => true,
      listApplicationsImpl: async () => [{ uuid: "orphan" }],
      listServicesImpl: async () => [],
    }, async () => {
      const client = recordingClient([]);
      const r = await sweepOrphanReconciliation(client);
      ok(r.status === "attention", "still flags attention with no admins configured");
      ok(r.alerted === false, "alerted false when ADMIN_EMAILS is empty");
    });
  });

  section("sweepOrphanReconciliation: undetermined ownership -> 'error' row, never alerts");
  {
    const brokenClient = { get: async () => { throw new Error("Frappe down"); }, post: async () => ({ data: {} }) };
    const posts = [];
    brokenClient.post = async (url, body) => posts.push({ url, body });
    const r = await sweepOrphanReconciliation(brokenClient);
    ok(r.status === "error", "status error when ownership can't be determined");
    ok(r.alerted === false, "not alerted on an undetermined run");
    ok(posts[0].body.job_type === "orphan_check", "still writes a row for the error");
  }

  section("sweepCapacitySnapshot: under threshold -> 'ok', no alert, row written every run");
  await withEnv({ ADMIN_EMAILS: "ops@murzaktech.com", PROVISIONING_RAM_THRESHOLD_PCT: "85" }, async () => {
    await withMailer(async () => { throw new Error("must not be called under threshold"); }, async () => {
      const client = recordingClient();
      const r = await sweepCapacitySnapshot(client, { getReservedRamMb: async () => 1000 });
      ok(r.status === "ok", "status ok comfortably under threshold");
      ok(r.alerted === false, "not alerted under threshold");
      ok(client.posts.length === 1, "writes a row even on a clean run (for the dashboard trend)");
      ok(client.posts[0].body.job_type === "capacity_snapshot", "row tagged capacity_snapshot");
    });
  });

  section("sweepCapacitySnapshot: reserved RAM over the gate -> 'attention', emails admins");
  await withEnv({ ADMIN_EMAILS: "ops@murzaktech.com", PROVISIONING_RAM_THRESHOLD_PCT: "85" }, async () => {
    const sent = [];
    await withMailer(async ({ to, subject }) => { sent.push({ to, subject }); }, async () => {
      const client = recordingClient();
      // sellableRamMb comes from CAPACITY.sellableRamMb (catalog) — push reserved
      // absurdly high so it clears the threshold regardless of the configured value.
      const r = await sweepCapacitySnapshot(client, { getReservedRamMb: async () => 999999999 });
      ok(r.status === "attention", "status attention once reserved RAM crosses the gate");
      ok(r.alerted === true, "alerted true");
      ok(sent.length === 1, "emailed the configured admin");
      ok(client.posts[0].body.status === "attention", "row status attention");
    });
  });

  section("sweepCapacitySnapshot: Frappe read failure -> 'error' row, never alerts");
  await withEnv({ ADMIN_EMAILS: "ops@murzaktech.com" }, async () => {
    await withMailer(async () => { throw new Error("must not be called on a read failure"); }, async () => {
      const client = recordingClient();
      const r = await sweepCapacitySnapshot(client, { getReservedRamMb: async () => null });
      ok(r.status === "error", "status error when reserved RAM can't be read");
      ok(r.alerted === false, "not alerted on a read failure");
      ok(client.posts[0].body.job_type === "capacity_snapshot", "still writes a row for the error");
    });
  });

  section("latestHealthChecks: returns the newest row per job_type, null when absent");
  {
    const rows = {
      orphan_check: [{ name: "HEALTH-00002", job_type: "orphan_check", status: "attention" }],
      capacity_snapshot: [],
      backup: [{ name: "HEALTH-00005", job_type: "backup", status: "ok" }],
    };
    const client = {
      get: async (url, opts) => {
        const filters = JSON.parse(opts.params.filters);
        const jobType = filters[0][2];
        return { data: { data: rows[jobType] || [] } };
      },
    };
    const checks = await latestHealthChecks(client);
    ok(checks.orphan_check?.name === "HEALTH-00002", "returns the orphan_check row");
    ok(checks.capacity_snapshot === null, "null when no capacity_snapshot rows exist");
    ok(checks.backup?.name === "HEALTH-00005", "returns the backup row");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
