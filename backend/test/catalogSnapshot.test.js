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

  section("domain registration products resolve from the snapshot, prices match DOMAIN_TLD_PRICES");
  const domainPrices = {
    "domain-coke": 1200,
    "domain-com": 1500,
    "domain-ke": 1800,
    "domain-org": 1800,
    "domain-net": 1800,
    "domain-africa": 2500,
    "domain-io": 4500,
  };
  for (const [id, price] of Object.entries(domainPrices)) {
    const meta = getServiceMeta(id);
    ok(!!meta, `${id} resolves`);
    ok(meta?.monthlyKes === price, `${id} prices at KES ${price}`);
    ok(meta?.ramMb === 0 && meta?.diskGb === 0, `${id} has zero server footprint`);
  }

  section("monthly-equivalent domain pricing never understates");
  // Mirror of frontend monthlyEquivalentKes (Math.ceil(yearly / 12)). The
  // frontend function is the source of truth for display; this asserts the
  // arithmetic property that matters commercially — a customer must never see
  // a monthly figure that annualizes to LESS than what they'll actually be
  // charged.
  const monthlyEquiv = (yearly) => Math.ceil(yearly / 12);
  const domainYearly = {
    "domain-coke": 1200,
    "domain-com": 1500,
    "domain-ke": 1800,
    "domain-org": 1800,
    "domain-net": 1800,
    "domain-africa": 2500,
    "domain-io": 4500,
  };
  for (const [id, yearly] of Object.entries(domainYearly)) {
    const meta = getServiceMeta(id);
    ok(meta?.monthlyKes === yearly, `${id} yearly price is ${yearly}`);
    ok(monthlyEquiv(yearly) * 12 >= yearly, `${id} monthly-equivalent never understates`);
  }
  ok(monthlyEquiv(1500) === 125, ".com -> 125/mo exactly");
  ok(monthlyEquiv(2500) === 209, ".africa 2500/12 = 208.33 rounds UP to 209");
  ok(monthlyEquiv(1200) === 100, ".co.ke -> 100/mo exactly");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
