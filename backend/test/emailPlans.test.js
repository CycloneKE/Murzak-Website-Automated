/**
 * Stalwart business-email plans: the single config that prices and sizes the
 * mail-* products, the domain-price formula, and their catalog/lane routing.
 *   node test/emailPlans.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const emailPlans = require("../config/emailPlans");
const catalog = require("../services/provisioning/catalog");

const { PLANS, isMailPlan, domainPriceKes } = emailPlans;

(async () => {
  section("plans match the spec");
  const expected = {
    "mail-starter": { mailboxes: 3, quotaGb: 5, monthlyKes: 450, annualKes: 4500 },
    "mail-business": { mailboxes: 10, quotaGb: 10, monthlyKes: 1200, annualKes: 12000 },
    "mail-pro": { mailboxes: 30, quotaGb: 15, monthlyKes: 2900, annualKes: 29000 },
  };
  for (const [id, want] of Object.entries(expected)) {
    const plan = PLANS[id];
    ok(!!plan, `${id} is defined`);
    ok(plan?.id === id, `${id} carries its own id`);
    ok(plan?.mailboxes === want.mailboxes, `${id} allows ${want.mailboxes} mailboxes`);
    ok(plan?.quotaGb === want.quotaGb, `${id} gives ${want.quotaGb}GB per mailbox`);
    ok(plan?.monthlyKes === want.monthlyKes, `${id} is KES ${want.monthlyKes}/mo`);
    ok(plan?.annualKes === want.annualKes, `${id} is KES ${want.annualKes}/yr`);
  }
  ok(Object.keys(PLANS).length === 3, "exactly three mail plans");
  ok(Object.isFrozen(PLANS), "PLANS map is frozen");

  section("annual is 10x monthly for every plan");
  for (const [id, plan] of Object.entries(PLANS)) {
    ok(plan.annualKes === plan.monthlyKes * 10, `${id} annual = 10 x monthly`);
  }

  section("isMailPlan recognises only the new mail-* ids");
  ok(isMailPlan("mail-pro") === true, "mail-pro is a mail plan");
  ok(isMailPlan("mail-starter") === true, "mail-starter is a mail plan");
  ok(isMailPlan("starter-email") === false, "legacy starter-email is NOT a mail plan");
  ok(isMailPlan("biz-email") === false, "legacy biz-email is NOT a mail plan");
  ok(isMailPlan("") === false, "empty id is not a mail plan");
  ok(isMailPlan(undefined) === false, "undefined id is not a mail plan");

  section("domainPriceKes: wholesale USD cents -> retail KES, +25%, rounded up to 50");
  ok(domainPriceKes(1099, 129) === 1800, "1099c x 129 x 1.25 = 1772.1 rounds up to 1800");
  ok(domainPriceKes(1000, 129) === 1650, "1000c x 129 x 1.25 = 1612.5 rounds up to 1650 (KES 50 step)");
  ok(domainPriceKes(100, 129) === 1200, "small wholesale floors at KES 1200");
  ok(domainPriceKes(0, 129) === 1200, "zero wholesale still floors at KES 1200");

  section("domainPriceKes: bad input throws instead of quoting the floor");
  const throwsTypeError = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  for (const bad of [NaN, undefined, -5]) {
    ok(throwsTypeError(() => domainPriceKes(bad, 129)), `wholesaleUsdCents ${String(bad)} throws TypeError`);
    ok(throwsTypeError(() => domainPriceKes(1099, bad)), `usdToKes ${String(bad)} throws TypeError`);
  }
  ok(throwsTypeError(() => domainPriceKes(1099, 0)), "usdToKes 0 throws TypeError");

  section("catalog snapshot: mail-* resolve, route to emailHosting, reserve 0 RAM");
  for (const id of Object.keys(PLANS)) {
    const meta = catalog.getServiceMeta(id);
    ok(!!meta, `${id} resolves from the catalog snapshot`);
    ok(meta?.category === "Email Hosting", `${id} is in the Email Hosting category`);
    ok(catalog.laneFor(meta) === "emailHosting", `${id} routes to the emailHosting lane`);
    ok(meta?.ramMb === 0 && meta?.diskGb === 0, `${id} reserves 0MB RAM / 0GB disk`);
    ok(meta?.mailboxes === PLANS[id].mailboxes, `${id} snapshot mailboxes match PLANS`);
    ok(meta?.monthlyKes === PLANS[id].monthlyKes, `${id} snapshot price matches PLANS`);
  }

  section("legacy starter-email and biz-email are kept for existing customers");
  for (const id of ["starter-email", "biz-email"]) {
    ok(!!catalog.getServiceMeta(id), `${id} still resolves`);
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
