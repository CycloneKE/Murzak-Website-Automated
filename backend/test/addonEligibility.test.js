/**
 * Unit tests for addon eligibility gating — runs without Redis or Frappe.
 *   node test/addonEligibility.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { isAddonEligible, accountHasNonDomainPaidService } = require("../services/addonEligibility");
const { getServiceMeta } = require("../services/provisioning/catalog");

(async () => {
  section("volume-class services are plan-agnostic");
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 2200 },
    }).ok === true,
    "Business-plan customer CAN add a Light-tier volume service (the bug this fixes)"
  );
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === true,
    "Starter-plan customer can add a Light-tier volume service"
  );
  ok(
    isAddonEligible({
      planKey: "Test",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === false,
    "Test plan (never paid) still cannot add volume services"
  );

  section("premium-class services keep tier-matches-plan behavior");
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Medium", capacityClass: "premium", monthlyKes: 4500 },
    }).ok === true,
    "Business-plan customer can add a Medium-tier premium add-on (unchanged)"
  );
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: { tier: "Medium", capacityClass: "premium", monthlyKes: 4500 },
    }).ok === false,
    "Starter-plan customer cannot add a Medium-tier premium add-on (unchanged)"
  );
  ok(
    isAddonEligible({
      planKey: "Business",
      service: { tier: "Large", capacityClass: "premium", monthlyKes: 12000 },
    }).ok === false,
    "Business-plan customer cannot add a Large-tier premium add-on (unchanged)"
  );

  section("unknown plan");
  ok(
    isAddonEligible({
      planKey: "None",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200 },
    }).ok === false,
    "No plan at all -> not eligible (caller must go through attach-selection instead)"
  );

  section("integration: real catalog snapshot meta (getServiceMeta)");
  // The gate's runtime input is getServiceMeta(serviceId), NOT a hand-built
  // object — these cases guard against the snapshot dropping fields the gate
  // depends on (a missing `tier` once made premium gating a silent no-op).
  const erpMeta = getServiceMeta("biz-erp-configured");
  ok(
    erpMeta && typeof erpMeta.tier === "string" && erpMeta.tier.length > 0,
    "catalog snapshot carries a real tier for premium services (biz-erp-configured)"
  );
  ok(
    isAddonEligible({ planKey: "Starter", service: erpMeta }).ok === false,
    "Starter-plan customer cannot add biz-erp-configured (Large-tier premium) — the exact regression"
  );
  ok(
    isAddonEligible({ planKey: "Business", service: getServiceMeta("biz-pos-inventory") }).ok === true,
    "Business-plan customer can add biz-pos-inventory (Medium-tier premium)"
  );
  ok(
    isAddonEligible({ planKey: "Business", service: getServiceMeta("starter-app-hosting") }).ok === true,
    "Business-plan customer can add starter-app-hosting (volume is plan-agnostic)"
  );

  section("accountHasNonDomainPaidService: domain-only history");
  ok(
    accountHasNonDomainPaidService([{ serviceId: "domain-com", status: "Active" }]) === false,
    "a single paid domain row alone is NOT non-domain paid history"
  );
  ok(
    accountHasNonDomainPaidService([
      { serviceId: "domain-com", status: "Active" },
      { serviceId: "domain-net", status: "Active" },
    ]) === false,
    "multiple paid domain rows still are NOT non-domain paid history"
  );

  section("accountHasNonDomainPaidService: real hosting history");
  ok(
    accountHasNonDomainPaidService([{ serviceId: "starter-web-hosting", status: "Active" }]) === true,
    "an Active non-domain service counts as real paid history"
  );
  ok(
    accountHasNonDomainPaidService([
      { serviceId: "domain-com", status: "Active" },
      { serviceId: "starter-web-hosting", status: "Active" },
    ]) === true,
    "domain + real hosting together still count as real paid history"
  );
  ok(
    accountHasNonDomainPaidService([{ serviceId: "biz-erp-configured", status: "Setting up" }]) === true,
    "a premium service still 'Setting up' (not yet fully Active) counts as paid"
  );
  ok(
    accountHasNonDomainPaidService([{ serviceId: "starter-web-hosting", status: "Suspended" }]) === true,
    "a Suspended (lapsed-renewal) non-domain service still counts — it WAS paid"
  );

  section("accountHasNonDomainPaidService: unpaid rows don't count");
  ok(
    accountHasNonDomainPaidService([{ serviceId: "starter-web-hosting", status: "Awaiting Payment" }]) === false,
    "an unpaid/pending non-domain selection does NOT count as paid history"
  );
  ok(
    accountHasNonDomainPaidService([{ serviceId: "starter-web-hosting", status: "Selected" }]) === false,
    "a merely-selected (unpaid) non-domain service does NOT count"
  );
  ok(
    accountHasNonDomainPaidService([]) === false,
    "no service history at all -> false"
  );
  ok(
    accountHasNonDomainPaidService(undefined) === false,
    "undefined/garbage input is handled safely -> false"
  );

  section("isAddonEligible: FIX ROUND 2 — domain-only account add-on gate bypass");
  // Requirement 1: a domain-only account must NOT pass the gate for a REAL
  // (non-domain) add-on, of either capacity class.
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: getServiceMeta("starter-web-hosting"),
      hasNonDomainPaidHistory: false,
    }).ok === false,
    "domain-only account cannot buy a volume-class real add-on (starter-web-hosting)"
  );
  ok(
    isAddonEligible({
      planKey: "Business",
      service: getServiceMeta("biz-pos-inventory"),
      hasNonDomainPaidHistory: false,
    }).ok === false,
    "domain-only account cannot buy a premium-class real add-on (biz-pos-inventory), even though its tier would otherwise match"
  );

  // Requirement 2: a domain-only account MUST still be able to buy MORE
  // domains — this is exactly what the previous, reverted fix attempt broke.
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: getServiceMeta("domain-net"),
      hasNonDomainPaidHistory: false,
    }).ok === true,
    "domain-only account CAN still buy a second domain (repeat domain purchase keeps working)"
  );

  // Requirement 3: a real paid-hosting account keeps full, unrestricted
  // add-on rights — completely unaffected by this fix.
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: getServiceMeta("db-mysql"),
      hasNonDomainPaidHistory: true,
    }).ok === true,
    "real-hosting account can still buy a volume-class add-on"
  );
  ok(
    isAddonEligible({
      planKey: "Business",
      service: getServiceMeta("biz-pos-inventory"),
      hasNonDomainPaidHistory: true,
    }).ok === true,
    "real-hosting account can still buy a premium-class add-on matching its tier"
  );

  // Requirement 4: an account with BOTH real hosting and a domain keeps full
  // add-on rights, for either a domain or a real add-on.
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: getServiceMeta("domain-com"),
      hasNonDomainPaidHistory: true,
    }).ok === true,
    "hosting+domain account can buy another domain"
  );
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: getServiceMeta("starter-web-hosting"),
      hasNonDomainPaidHistory: true,
    }).ok === true,
    "hosting+domain account can buy a real add-on"
  );

  // Back-compat: callers that don't pass hasNonDomainPaidHistory at all
  // (every pre-existing call site/test above) must keep the old behavior.
  ok(
    isAddonEligible({
      planKey: "Starter",
      service: { tier: "Light", capacityClass: "volume", monthlyKes: 1200, category: "Website Hosting" },
    }).ok === true,
    "omitting hasNonDomainPaidHistory defaults to fail-open (unchanged pre-existing behavior)"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
