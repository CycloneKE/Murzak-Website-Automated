/**
 * Shop progress checklist - node test/shopProgress.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const http = require("http");
const express = require("express");
const sp = require("../services/apps/shopProgress");
const createPortalRouter = require("../routes/portalRoutes");

const sig = (o = {}) => ({ signedIn: false, products: 0, staff: 1, tillOpened: false, firstSale: false, checkedAt: "2026-10-19T10:00:00Z", ...o });

function get(app, path) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      http.get({ port: srv.address().port, path }, (res) => {
        let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { srv.close(); resolve({ status: res.statusCode, body: JSON.parse(b || "{}") }); });
      });
    });
  });
}

(async () => {
  section("progressView: before the host has looked");
  {
    const v = sp.progressView({ app: "pos" });
    ok(v.checked === false && v.complete === false && v.nextStepId === null, "unchecked is not shown as facts");
    ok(v.steps.every((s) => s.done === false), "no step is ticked");
    ok(sp.progressView(undefined).checked === false && sp.progressView({ shopProgress: "x" }).checked === false, "garbage reads as unchecked");
  }

  section("progressView: a shop moving along");
  {
    const fresh = sp.progressView({ shopProgress: sig() });
    ok(fresh.checked && fresh.doneCount === 0 && fresh.nextStepId === "signedIn", "fresh shop: first step is signing in");
    const mid = sp.progressView({ shopProgress: sig({ signedIn: true, products: 12 }) });
    ok(mid.doneCount === 2 && mid.nextStepId === "tillOpened", "next step follows the order, skipping done ones");
    const done = sp.progressView({ shopProgress: sig({ signedIn: true, products: 3, tillOpened: true, firstSale: true }) });
    ok(done.complete && done.nextStepId === null && done.doneCount === 4 && done.total === 4, "complete without staff: staff is optional");
    const staff = (n) => sp.progressView({ shopProgress: sig({ staff: n }) }).steps.find((s) => s.id === "staff").done;
    ok(staff(1) === false && staff(2) === true, "staff ticks at 2 users (the owner is the first)");
    ok(done.steps.find((s) => s.id === "staff").optional === true, "staff is marked optional");
  }

  section("normalizeSignals never trusts the stored value");
  {
    const n = sp.normalizeSignals({ signedIn: "yes", products: -4, staff: 1.5, tillOpened: 1, firstSale: "true", checkedAt: 5 });
    ok(!n.signedIn && n.products === 0 && n.staff === 0 && !n.tillOpened && !n.firstSale && n.checkedAt === null, "only exact values count");
    ok(sp.normalizeSignals([]) === null && sp.normalizeSignals(null) === null, "non objects are rejected");
  }

  section("GET /api/portal/services/:id/shop-progress");
  {
    const orders = [
      { name: "CHK-1", web_account: "ACC-1", service_id: "biz-pos-duka", status: "Paid", config_json: JSON.stringify({ app: "pos", shopProgress: sig({ signedIn: true }) }) },
      { name: "CHK-2", web_account: "ACC-2", service_id: "biz-pos-duka", status: "Paid", config_json: JSON.stringify({ app: "pos", shopProgress: sig({ signedIn: true, products: 9 }) }) },
    ];
    const build = (account) => {
      const app = express();
      app.use((req, _res, next) => { req.session = account ? { webAccount: account } : {}; next(); });
      const client = { get: async (_u, o) => ({ data: { data: orders } }) }; // deliberately ignores filters
      const requireAuth = (req, res, next) => (req.session.webAccount ? next() : res.status(401).json({ error: "no" }));
      app.use(createPortalRouter({ frappeClient: () => client, requireAuth, rateLimit: () => (_q, _s, n) => n(), upload: new Proxy({}, { get: () => () => (_q, _s, n) => n() }), PROVISIONING_JOB_DOCTYPE: "Provisioning Job" }));
      return app;
    };
    const mine = await get(build("ACC-1"), "/api/portal/services/biz-pos-duka/shop-progress");
    ok(mine.status === 200 && mine.body.progress.doneCount === 1, "returns the caller's own progress");
    const other = await get(build("ACC-2"), "/api/portal/services/biz-pos-duka/shop-progress");
    ok(other.body.progress.doneCount === 2, "another account sees only its own shop, even if the query returned both");
    const anon = await get(build(null), "/api/portal/services/biz-pos-duka/shop-progress");
    ok(anon.status === 401, "signed out is refused");
    const none = await get(build("ACC-9"), "/api/portal/services/biz-pos-duka/shop-progress");
    ok(none.body.progress === null, "an account with no shop gets null");
    const notApp = await get(build("ACC-1"), "/api/portal/services/test-web-hosting-demo/shop-progress");
    ok(notApp.body.progress === null, "a service that is not an app has no checklist");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})();
