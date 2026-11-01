/**
 * Mail plans cannot be bought through the generic paid routes.
 *   node test/mailPlanRoutes.test.js   (or: npm run test:email)
 *
 * Business email is ordered from the email setup page (POST /api/orders with a
 * mailSetup). The four generic routes below must refuse a mail-* plan with
 * 400 MAIL_PLAN_SETUP_REQUIRED, because paying for one with no mailSetup would
 * charge the customer for mailboxes the lane can never build. Real HTTP against
 * server.js with MOCK_FRAPPE, like testPlanRouteSafety.test.js.
 */
process.env.MOCK_FRAPPE = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.DEV_AUTO_LOGIN = "true";

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { containsMailPlan } = require("../services/email/mailPlanGuard");
const { app } = require("../server");

const CODE = "MAIL_PLAN_SETUP_REQUIRED";

(async () => {
  section("containsMailPlan");
  ok(containsMailPlan([{ serviceId: "mail-starter" }]) === true, "serviceId form");
  ok(containsMailPlan([{ service_id: "mail-pro" }]) === true, "service_id form");
  ok(containsMailPlan(["starter-web-hosting", "mail-business"]) === true, "plain string ids");
  ok(containsMailPlan([{ serviceId: "starter-web-hosting" }, { serviceId: "starter-email" }]) === false, "legacy starter-email is not a mail plan");
  ok(containsMailPlan(undefined) === false && containsMailPlan("mail-pro") === false, "non-arrays are not matched");

  const server = app.listen(0);
  const port = server.address().port;
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    section("the four generic routes refuse a mail plan");
    const cases = [
      ["/api/services/add", { services: [{ serviceId: "mail-starter" }] }],
      ["/api/services/addons/add", { services: [{ serviceId: "starter-web-hosting" }, { serviceId: "mail-pro" }] }],
      ["/api/addons/invoice/create", { services: [{ serviceId: "mail-business" }] }],
      ["/api/plan/attach-selection", { planKey: "Starter", selectedServices: [{ serviceId: "mail-starter" }] }],
    ];
    for (const [path, body] of cases) {
      const r = await post(path, body);
      ok(r.status === 400 && r.body.code === CODE, `${path} -> 400 ${CODE} (got ${r.status} ${r.body.code})`);
      ok(r.body.error === "Business email is ordered from the email setup page.", `${path} -> the message names the setup page`);
    }

    section("ordinary adds are not caught by the guard");
    const normal = [
      ["/api/services/add", { services: [{ serviceId: "starter-web-hosting" }] }],
      ["/api/services/addons/add", { services: [{ serviceId: "addon-mailboxes-5" }] }],
      ["/api/addons/invoice/create", { services: [{ serviceId: "addon-mailboxes-5" }] }],
      ["/api/plan/attach-selection", { planKey: "Starter", selectedServices: [{ serviceId: "starter-web-hosting" }] }],
    ];
    for (const [path, body] of normal) {
      const r = await post(path, body);
      ok(r.body.code !== CODE, `${path} with a non-mail service is not refused by the guard (status ${r.status})`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
