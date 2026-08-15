/**
 * Orphan reconciliation tests — findOrphanedCoolifyResources compares live
 * Coolify applications/services against Provisioning Job external_ref
 * values. There's no live Coolify instance to test against here, so this
 * monkey-patches coolify.listApplications/listServices/isConfigured and
 * targets.listTargets — orphans.js calls them as properties on the required
 * (Node-cached, shared) module objects rather than destructured locals, so
 * reassigning those properties here reaches the same calls orphans.js makes.
 *   node test/orphanReconciliation.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { findOrphanedCoolifyResources } = require("../services/provisioning/orphans");
const coolify = require("../services/provisioning/lanes/coolify");
const targets = require("../services/provisioning/targets");

async function withMocks({ listTargetsImpl, isConfiguredImpl, listApplicationsImpl, listServicesImpl }, fn) {
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

function jobClient(externalRefs) {
  return {
    get: async () => ({ data: { data: externalRefs.map((r) => ({ external_ref: r })) } }),
  };
}

(async () => {
  section("findOrphanedCoolifyResources: flags a live resource with no owning job");
  await withMocks({
    listTargetsImpl: () => [{ id: "box-1" }],
    isConfiguredImpl: () => true,
    listApplicationsImpl: async () => [{ uuid: "app-owned", name: "shipstack" }, { uuid: "app-orphan", name: "old-test-app" }],
    listServicesImpl: async () => [{ uuid: "svc-orphan", name: "user-26-08-12-0001-starter-app-hosting" }],
  }, async () => {
    const client = jobClient(["app-owned"]);
    const result = await findOrphanedCoolifyResources(client);
    ok(result.checked === true, "checked");
    ok(result.targets.length === 1, "one target reported");
    const t = result.targets[0];
    ok(t.orphanApplications.length === 1 && t.orphanApplications[0].uuid === "app-orphan", "owned application excluded, orphan flagged");
    ok(t.orphanServices.length === 1 && t.orphanServices[0].uuid === "svc-orphan", "unowned service flagged (the exact CHK-00019 class of bug)");
  });

  section("findOrphanedCoolifyResources: nothing orphaned when every live uuid is owned");
  await withMocks({
    listTargetsImpl: () => [{ id: "box-1" }],
    isConfiguredImpl: () => true,
    listApplicationsImpl: async () => [{ uuid: "app-1", name: "a" }],
    listServicesImpl: async () => [{ uuid: "svc-1", name: "b" }],
  }, async () => {
    const client = jobClient(["app-1", "svc-1"]);
    const result = await findOrphanedCoolifyResources(client);
    ok(result.targets[0].orphanApplications.length === 0 && result.targets[0].orphanServices.length === 0, "no orphans when every live uuid has an owning job");
  });

  section("findOrphanedCoolifyResources: skips an unconfigured target rather than reporting it falsely clean");
  await withMocks({
    listTargetsImpl: () => [{ id: "box-1" }, { id: "box-2" }],
    isConfiguredImpl: (opts) => opts?.target?.id === "box-1",
    listApplicationsImpl: async () => [],
    listServicesImpl: async () => [],
  }, async () => {
    const client = jobClient([]);
    const result = await findOrphanedCoolifyResources(client);
    ok(result.targets.length === 1 && result.targets[0].targetId === "box-1", "unconfigured box-2 is skipped entirely, not reported as empty/clean");
  });

  section("findOrphanedCoolifyResources: undetermined owned-ref list fails safe");
  {
    const brokenClient = { get: async () => { throw new Error("Frappe down"); } };
    const result = await findOrphanedCoolifyResources(brokenClient);
    ok(result.checked === false, "checked:false — refuses to guess");
    ok(result.targets.length === 0, "no targets/orphans reported when ownership can't be determined (would false-flag every live resource)");
  }

  section("findOrphanedCoolifyResources: a per-target Coolify API error doesn't crash the whole sweep");
  await withMocks({
    listTargetsImpl: () => [{ id: "box-1" }],
    isConfiguredImpl: () => true,
    listApplicationsImpl: async () => { throw new Error("Coolify API down"); },
    listServicesImpl: async () => [],
  }, async () => {
    const client = jobClient([]);
    const result = await findOrphanedCoolifyResources(client);
    ok(result.checked === true, "top-level check still completes");
    ok(!!result.targets[0].error, "per-target error recorded instead of throwing");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
