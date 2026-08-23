/**
 * Fleet capacity accounting — getReservedRamMb.
 *   node test/capacityAccounting.test.js   (or: npm test)
 *
 * This number is what stands between the storefront and overselling the box.
 * services/checkout/orderStore.js gates every order on
 *   fleetReservedRamMb + reservedDraftRamMb + newRamMb > thresholdMb()
 * so if getReservedRamMb under-reports, the gate silently approves everything.
 *
 * It used to count only status running|active. PROVISIONING_RUNNER_ENABLED
 * defaults to FALSE, so in the default configuration jobs sit at "queued"
 * forever and were never counted — reserved read ~0 no matter how much had
 * been sold, and the one sale path that does consult the fleet gate approved
 * every order. Committed-but-not-yet-built work is still committed capacity.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { getReservedRamMb } = require("../services/provisioning/provisioningService");

// Records the status filter the query used, and serves back only the jobs
// whose status matches it — so the test measures the real filter, not a stub.
function makeClient(jobs) {
  const seen = { statuses: null };
  return {
    seen,
    get: async (_url, opts) => {
      const filters = JSON.parse(opts?.params?.filters || "[]");
      const statusFilter = filters.find((f) => f[0] === "status");
      seen.statuses = statusFilter ? statusFilter[2] : null;
      const allowed = new Set(seen.statuses || []);
      return { data: { data: jobs.filter((j) => allowed.has(j.status)).map((j) => ({ ram_mb: j.ram_mb })) } };
    },
  };
}

(async () => {
  section("queued jobs count as reserved capacity");
  {
    // The default-configuration case: runner off, everything sits at queued.
    const client = makeClient([
      { status: "queued", ram_mb: 2048 },
      { status: "queued", ram_mb: 2048 },
    ]);
    const reserved = await getReservedRamMb(client);
    ok(reserved === 4096, `two queued 2048MB jobs reserve 4096MB (got ${reserved})`);
  }

  section("running and active still count");
  {
    const client = makeClient([
      { status: "running", ram_mb: 1024 },
      { status: "active", ram_mb: 512 },
    ]);
    ok((await getReservedRamMb(client)) === 1536, "running + active = 1536MB");
  }

  section("needs_human counts — an escalated job may already hold a live container");
  {
    // coolify.js can create the Coolify resource and then throw; the job lands
    // needs_human with the container still running and still eating RAM.
    // Not counting it lets that RAM be sold twice.
    const client = makeClient([{ status: "needs_human", ram_mb: 2048 }]);
    ok((await getReservedRamMb(client)) === 2048, "needs_human reserves its RAM");
  }

  section("deleted and failed do not count");
  {
    // Torn down, or never built — counting these forever would permanently
    // leak sellable capacity that nothing is actually using.
    const client = makeClient([
      { status: "deleted", ram_mb: 4096 },
      { status: "failed", ram_mb: 4096 },
    ]);
    ok((await getReservedRamMb(client)) === 0, "deleted + failed reserve nothing");
  }

  section("a full box reports its real commitment");
  {
    const client = makeClient([
      { status: "active", ram_mb: 2048 },
      { status: "queued", ram_mb: 2048 },
      { status: "needs_human", ram_mb: 2048 },
      { status: "deleted", ram_mb: 2048 },
    ]);
    const reserved = await getReservedRamMb(client);
    // 6144 of 6400 sellable — the gate must see this, not 2048.
    ok(reserved === 6144, `mixed fleet reserves 6144MB, not just the active 2048 (got ${reserved})`);
  }

  section("a Frappe failure reports null, not a falsely-empty box");
  {
    const client = { get: async () => { throw new Error("frappe down"); } };
    const reserved = await getReservedRamMb(client);
    ok(reserved === null, `unreachable Frappe returns null so callers can fail safe (got ${reserved})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
