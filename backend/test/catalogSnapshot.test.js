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
  // .com/.org/.net/.io corrected 2026-08-17 for wholesale-cost pricing — see
  // DOMAIN_TLD_PRICES in backend/server.js. .co.ke/.ke/.africa unchanged:
  // Hostinger's catalog doesn't sell those TLDs at all.
  const domainPrices = {
    "domain-coke": 1200,
    "domain-com": 4200,
    "domain-ke": 1800,
    "domain-org": 3800,
    "domain-net": 3800,
    "domain-africa": 2500,
    "domain-io": 15500,
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
  // charged. Reuses domainPrices above (not a second hardcoded map) so a
  // future price correction can't update one and silently leave the other
  // stale, exactly as happened here on 2026-08-17.
  const monthlyEquiv = (yearly) => Math.ceil(yearly / 12);
  for (const [id, yearly] of Object.entries(domainPrices)) {
    const meta = getServiceMeta(id);
    ok(meta?.monthlyKes === yearly, `${id} yearly price is ${yearly}`);
    ok(monthlyEquiv(yearly) * 12 >= yearly, `${id} monthly-equivalent never understates`);
  }
  ok(monthlyEquiv(4200) === 350, ".com -> 350/mo exactly");
  ok(monthlyEquiv(2500) === 209, ".africa 2500/12 = 208.33 rounds UP to 209");
  ok(monthlyEquiv(1200) === 100, ".co.ke -> 100/mo exactly");

  section("invariant: no SERVICE_ID_TO_PLAN id is a Domain Registration");
  // addonEligibility.js's isDomainRegistrationServiceId deliberately fails
  // OPEN on any id missing from the snapshot (an unknown id is treated as
  // NOT a domain, i.e. as real infrastructure) — see its module comment.
  // That's only safe because every id a customer can get for free via a
  // paid PLAN (server.js's SERVICE_ID_TO_PLAN) is, and must stay, a
  // non-domain product. If a domain-like SKU is ever added under a plan,
  // an account could earn "real paid history" from a domain alone again.
  //
  // Duplicated literally rather than required from server.js — server.js
  // calls app.listen() at module scope, so requiring it in a unit test
  // would start a real HTTP server. Keep this list in sync with
  // server.js's SERVICE_ID_TO_PLAN keys by hand.
  const SERVICE_ID_TO_PLAN_IDS = [
    "test-web-hosting-demo", "test-erpnext-demo", "test-crm-demo", "test-staging-demo",
    "starter-web-hosting", "starter-email", "starter-storage", "starter-hrpay",
    "starter-erp-light", "starter-db-light",
    "biz-erp-configured", "biz-erp-bring-your-own", "biz-web-hosting", "biz-crm-helpdesk",
    "biz-accounting", "biz-db-medium", "biz-email-large", "biz-pos-inventory",
    "biz-webapps", "biz-docs",
    "ent-erp-large", "ent-db-large", "ent-ecom-large", "ent-bi",
    "ent-pos-multibranch", "ent-mail", "ent-cctv", "ent-backup-server",
  ];
  const knownIds = [];
  const missingIds = [];
  for (const id of SERVICE_ID_TO_PLAN_IDS) {
    const meta = getServiceMeta(id);
    if (!meta) { missingIds.push(id); continue; }
    knownIds.push(id);
    ok(meta.category !== "Domain Registration", `${id} (a plan-included product) is not a Domain Registration`);
  }
  if (missingIds.length) {
    // Non-fatal by design: this is catalog drift, not a code bug — the
    // eligibility gate's fail-open polarity exists precisely so this class
    // of drift degrades safely instead of blocking real customers. Fix by
    // regenerating the snapshot or updating SERVICE_ID_TO_PLAN, not by
    // hardening this assertion.
    console.warn(
      `  WARN: ${missingIds.length} SERVICE_ID_TO_PLAN id(s) missing from the catalog snapshot: ${missingIds.join(", ")}`
    );
  }

  section("invariant: every Domain Registration item in the snapshot uses the domain- prefix");
  const snapshot = require("../data/serviceCatalogSnapshot.json");
  const items = snapshot?.items || snapshot;
  for (const [id, meta] of Object.entries(items || {})) {
    if (meta?.category === "Domain Registration") {
      ok(id.startsWith("domain-"), `domain SKU "${id}" uses the expected "domain-" prefix`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
