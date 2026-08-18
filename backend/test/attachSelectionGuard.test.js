/**
 * Static regression check for the Critical #1 guard on server.js's
 * POST /api/plan/attach-selection handler.
 *
 * server.js is a monolith: it calls app.listen(...) unconditionally at
 * require time and needs Frappe/session infra to boot, so (unlike
 * billingRoutes.js / authRoutes.js / ordersRoutes.js, which export a
 * ctx-factory and are exercised directly in billingRoutes.test.js /
 * authRoutes.test.js / ordersRoutes.test.js) there is no safe way to invoke
 * this specific handler function in isolation here. assertNotAnnualBefore-
 * PlanChange's own behavior (409/ANNUAL_TERM_LOCKED vs. pass-through) is
 * fully covered by test/checkoutBillingTerm.test.js; this test instead
 * proves — the same way test/routesContext.test.js proves wiring — that the
 * call actually exists at this call site and runs BEFORE the Web Account is
 * read or applyPlanAndCreateInvoice is called, so a future edit can't
 * silently reorder or drop it without this test catching it.
 *   node test/attachSelectionGuard.test.js   (or: npm test)
 */
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

section("POST /api/plan/attach-selection — assertNotAnnualBeforePlanChange guard");

const routeStart = src.indexOf('app.post("/api/plan/attach-selection"');
ok(routeStart !== -1, "route declaration found in server.js");

// Bounded by the next top-level function declaration that immediately
// follows this handler in the file (see server.js around line 2034).
const routeEnd = src.indexOf("function normalizeInvoiceServiceRow", routeStart);
ok(routeEnd !== -1 && routeEnd > routeStart, "handler body boundary found");

const handlerSrc = routeStart !== -1 && routeEnd !== -1 ? src.slice(routeStart, routeEnd) : "";

const guardIdx = handlerSrc.indexOf("assertNotAnnualBeforePlanChange(");
ok(guardIdx !== -1, "handler calls assertNotAnnualBeforePlanChange(...)");

const accountLoadIdx = handlerSrc.indexOf(
  "`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`"
);
ok(accountLoadIdx !== -1, "handler still loads the Web Account by webAccountName (sanity check)");
ok(
  guardIdx !== -1 && accountLoadIdx !== -1 && guardIdx < accountLoadIdx,
  "guard runs BEFORE the Web Account is read"
);

const applyCallIdx = handlerSrc.indexOf("applyPlanAndCreateInvoice(");
ok(applyCallIdx !== -1, "handler still calls applyPlanAndCreateInvoice (sanity check)");
ok(
  guardIdx !== -1 && applyCallIdx !== -1 && guardIdx < applyCallIdx,
  "guard runs BEFORE applyPlanAndCreateInvoice"
);

// The require at the top of server.js must exist too, or the guard call
// above would throw ReferenceError at runtime despite being present in the
// route source.
ok(
  /require\(["']\.\/services\/checkoutBillingTerm["']\)/.test(src) &&
    /assertNotAnnualBeforePlanChange/.test(src.slice(0, routeStart === -1 ? src.length : routeStart)),
  "assertNotAnnualBeforePlanChange is required at the top of server.js, before this route"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
