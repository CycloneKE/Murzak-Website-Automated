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

const { containsMailPlan, stripMailPlans, newMailPlanIds } = require("../services/email/mailPlanGuard");
const fs = require("fs");
const path = require("path");
const { app } = require("../server");

const CODE = "MAIL_PLAN_SETUP_REQUIRED";

(async () => {
  section("containsMailPlan");
  ok(containsMailPlan([{ serviceId: "mail-starter" }]) === true, "serviceId form");
  ok(containsMailPlan([{ service_id: "mail-pro" }]) === true, "service_id form");
  ok(containsMailPlan(["starter-web-hosting", "mail-business"]) === true, "plain string ids");
  ok(containsMailPlan([{ serviceId: "starter-web-hosting" }, { serviceId: "starter-email" }]) === false, "legacy starter-email is not a mail plan");
  ok(containsMailPlan(undefined) === false && containsMailPlan("mail-pro") === false, "non-arrays are not matched");

  section("stripMailPlans / newMailPlanIds");
  {
    const kept = stripMailPlans([{ serviceId: "mail-pro" }, { serviceId: "starter-web-hosting" }, "mail-starter"]);
    ok(kept.length === 1 && kept[0].serviceId === "starter-web-hosting", "mail-* entries are stripped, others kept");
    ok(Array.isArray(stripMailPlans(null)) && stripMailPlans(null).length === 0, "garbage becomes an empty list");
    ok(newMailPlanIds([{ serviceId: "mail-pro" }, { service_id: "mail-starter" }], new Set(["mail-pro"])).join() === "mail-starter", "only mail plans the account does not already hold are 'new'");
  }

  section("defence in depth: every pending-services read in authRoutes goes through the strip");
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes", "authRoutes.js"), "utf8");
    const raw = src.match(/(?<!stripMailPlans\()normalizeSelectedServices\(req\.(session\.pendingServices|body\.selectedServices)\)/g) || [];
    ok(raw.length === 0, `no bare normalizeSelectedServices(req.session.pendingServices / req.body.selectedServices) is left (${raw.length})`);
    ok((src.match(/stripMailPlans\(/g) || []).length >= 3, "the strip is applied at the register, login and Google apply steps");
  }

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

    section("POST /api/account/services/update refuses a NEW mail plan and writes nothing");
    {
      const store = global.__mockFrappeStore;
      const acct = store["Web Account"].find((a) => a.name === "dev-user@example.com");
      const before = JSON.stringify(acct);
      const r = await post("/api/account/services/update", { plan: "Business", selectedServices: [{ serviceId: "biz-web-hosting" }, { serviceId: "mail-starter" }] });
      ok(r.status === 400 && r.body.code === CODE, `-> 400 ${CODE} (got ${r.status} ${r.body.code})`);
      ok(JSON.stringify(acct) === before, "the Web Account is unchanged");
      ok(!JSON.stringify(store["Portal Invoice"] || []).includes("mail-starter"), "no invoice line mentions the mail plan");

      // An account that ALREADY holds a mail row can resend it with its other services.
      acct.selected_services.push({ service_id: "mail-starter", service_name: "Business Email", tier: "", status: "Active" });
      const keep = await post("/api/account/services/update", { plan: "Business", selectedServices: [{ serviceId: "biz-web-hosting" }, { serviceId: "mail-starter", status: "Active" }] });
      ok(keep.body.code !== CODE, `an already-held mail row is not refused (status ${keep.status})`);
      const plain = await post("/api/account/services/update", { plan: "Business", selectedServices: [{ serviceId: "biz-web-hosting" }] });
      ok(plain.body.code !== CODE, `a non-mail update is not refused by the guard (status ${plain.status})`);
    }

    section("POST /api/plan/select-with-services refuses a mail plan, still parks others");
    {
      const bad = await post("/api/plan/select-with-services", { planName: "Starter", selectedServices: [{ serviceId: "mail-business" }] });
      ok(bad.status === 400 && bad.body.code === CODE, `-> 400 ${CODE} (got ${bad.status} ${bad.body.code})`);
      const good = await post("/api/plan/select-with-services", { planName: "Starter", selectedServices: [{ serviceId: "starter-web-hosting" }] });
      ok(good.body.code !== CODE && good.status === 200, `a non-mail selection is parked (status ${good.status})`);
    }

    section("POST /api/register refuses a mail plan smuggled in selectedServices and creates no account");
    {
      const before = (global.__mockFrappeStore["Web Account"] || []).length;
      const r = await post("/api/register", { name: "N", company: "C", email: "smuggle@example.com", password: "longenough1", plan: "Starter", selectedServices: [{ serviceId: "mail-starter" }] });
      ok(r.status === 400 && r.body.code === CODE, `-> 400 ${CODE} (got ${r.status} ${r.body.code})`);
      ok((global.__mockFrappeStore["Web Account"] || []).length === before, "no Web Account was created");
    }
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
