// Regression guard: every catalog id this plan adds must resolve through
// the SAME snapshot path production pricing uses (getServiceMeta reads only
// the generated snapshot, never serviceCatalog.ts directly) — this test
// fails if someone edits the catalog and forgets to regenerate it.
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { getServiceMeta } = require("../services/provisioning/catalog");

(async () => {
  section("database engine products resolve from the snapshot");
  // Redis is in-memory and ships with a smaller disk footprint (5GB) than the
  // other engines (10GB) — see serviceCatalog.ts db-redis entry.
  const expectedDiskGb = { "db-mysql": 10, "db-postgres": 10, "db-mongo": 10, "db-redis": 5 };
  for (const id of ["db-mysql", "db-postgres", "db-mongo", "db-redis"]) {
    const meta = getServiceMeta(id);
    ok(!!meta, `${id} resolves`);
    ok(meta?.monthlyKes === 2000, `${id} prices at KES 2000/mo`);
    ok(meta?.ramMb === 768 && meta?.diskGb === expectedDiskGb[id], `${id} has the expected footprint`);
  }

  section("deprecated ids still resolve (existing customers keep pricing)");
  for (const id of ["starter-db-light", "starter-db-mongo"]) {
    ok(!!getServiceMeta(id), `${id} still resolves post-deprecation`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
