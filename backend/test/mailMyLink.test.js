/**
 * GET /api/mail/my/:orderName/link - the signed-in owner's way to their status link.
 *   node test/mailMyLink.test.js
 * Pinned: only the owning web account gets a link; other accounts, non-mail orders,
 * unknown orders and signed-out callers all see the same 404 (or 401 when signed out).
 */
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

process.env.STALWART_MOCK = "1";
process.env.MAIL_LINK_SECRET = "mylink-test-secret";
process.env.APP_BASE_URL = "https://example.test";

const createMailRouter = require("../routes/mailRoutes");
const { makeMockFrappe } = require("./helpers/mockFrappe");
const access = require("../services/email/mailAccess");

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
}
const PATH = "/api/mail/my/:orderName/link";
async function call(router, orderName, session) {
  const layer = router.stack.find((l) => l.route && l.route.path === PATH && l.route.methods.get);
  if (!layer) throw new Error("route missing");
  const res = makeRes();
  const stack = layer.route.stack;
  // Run the middleware chain the way express would (requireAuth first).
  const req = { params: { orderName }, session, headers: {} };
  let i = 0;
  const next = async () => { const h = stack[i++]; if (h) await h.handle(req, res, next); };
  await next();
  return res;
}

(async () => {
  const client = makeMockFrappe({
    "Checkout Order": {
      "CHK-1": { name: "CHK-1", web_account: "WA-1", status: "Paid", config_json: JSON.stringify({ mailSetup: { domain: "acme.com", state: "provisioning" } }) },
      "CHK-2": { name: "CHK-2", web_account: "WA-1", status: "Paid", config_json: JSON.stringify({ app: "pos" }) },
      "CHK-3": { name: "CHK-3", web_account: "WA-2", status: "Paid", config_json: JSON.stringify({ mailSetup: { domain: "x.com" } }) },
    },
  });
  const requireAuth = (req, res, next) => (req.session && (req.session.webAccount || (req.session.user && req.session.user.id)) ? next() : res.status(401).json({ error: "Not authenticated." }));
  const router = createMailRouter({ frappeClient: () => client, requireAuth });

  section("owner gets a link");
  const good = await call(router, "CHK-1", { webAccount: "WA-1" });
  ok(good.statusCode === 200, "200");
  ok(good.body && access.verifyOrderToken(good.body.token).orderName === "CHK-1", "token verifies to the order");
  ok(good.body && good.body.statusUrl === `https://example.test/mail/status/${good.body.token}`, "statusUrl built from token");
  ok(good.headers["cache-control"] === "no-store", "no-store");
  const viaUser = await call(router, "CHK-1", { user: { id: "WA-1" } });
  ok(viaUser.statusCode === 200, "session.user.id also accepted");

  section("everything else is the same 404");
  const other = await call(router, "CHK-3", { webAccount: "WA-1" });
  const notMail = await call(router, "CHK-2", { webAccount: "WA-1" });
  const missing = await call(router, "CHK-999", { webAccount: "WA-1" });
  const stranger = await call(router, "CHK-1", { webAccount: "WA-2" });
  for (const [n, r] of Object.entries({ other, notMail, missing, stranger })) ok(r.statusCode === 404, `${n}: 404`);
  const bodies = new Set([other, notMail, missing, stranger].map((r) => JSON.stringify(r.body)));
  ok(bodies.size === 1, "identical 404 bodies");

  section("signed out");
  const anon = await call(router, "CHK-1", {});
  ok(anon.statusCode === 401, "401 without a session");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
