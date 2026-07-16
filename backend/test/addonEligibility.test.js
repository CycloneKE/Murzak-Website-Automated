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

const { isAddonEligible } = require("../services/addonEligibility");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
