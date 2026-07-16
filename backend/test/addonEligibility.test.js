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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
