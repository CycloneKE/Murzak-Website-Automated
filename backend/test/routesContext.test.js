// Static wiring check: every name a route module destructures from `ctx`
// must exist as a key in server.js's routeContext. A missing key doesn't
// fail at boot — it becomes `undefined` inside the router and only explodes
// when the endpoint runs (this is exactly how the M-Pesa STK push and
// password-reset emails silently broke after the route extraction).
const fs = require("fs");
const path = require("path");

let failed = 0;
let passed = 0;
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ok: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("# routeContext wiring (server.js <-> routes/*.js)");

const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const ctxMatch = serverSrc.match(/const routeContext = \{([\s\S]*?)\n\};/);
ok(!!ctxMatch, "server.js declares routeContext");

const ctxKeys = new Set(
  (ctxMatch ? ctxMatch[1] : "")
    .split("\n")
    .map((l) => l.trim().replace(/[,:].*$/, "").replace(/,$/, "").trim())
    .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
);

const routesDir = path.join(__dirname, "..", "routes");
const routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith(".js"));
ok(routeFiles.length >= 5, `found route modules (${routeFiles.length})`);

for (const file of routeFiles) {
  const src = fs.readFileSync(path.join(routesDir, file), "utf8");
  const dm = src.match(/const \{([\s\S]*?)\} = ctx;/);
  if (!dm) {
    // Module doesn't use the shared ctx (e.g. paypalRoutes takes explicit deps).
    console.log(`  ok: ${file} does not destructure ctx (skipped)`);
    passed++;
    continue;
  }
  const wants = dm[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const missing = wants.filter((w) => !ctxKeys.has(w));
  ok(
    missing.length === 0,
    `${file}: all ${wants.length} ctx keys wired` +
      (missing.length ? ` — MISSING: ${missing.join(", ")}` : "")
  );
}

console.log("================================================");
console.log(`ROUTE CONTEXT TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
