/**
 * Shop setup packs for new POS owners - node test/shopSetup.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const ss = require("../services/apps/shopSetup");

function makeClient(configs) {
  const rows = Object.fromEntries(Object.entries(configs).map(([k, v]) => [k, { name: k, config_json: JSON.stringify(v) }]));
  const dec = (u) => decodeURIComponent(u);
  return {
    rows,
    get: async (url) => { const m = dec(url).match(/\/Checkout Order\/(.+)$/); return { data: { data: rows[m[1]] } }; },
    put: async (url, body) => { const m = dec(url).match(/\/Checkout Order\/(.+)$/); Object.assign(rows[m[1]], body); return { data: {} }; },
  };
}
const paid = (extra = {}) => ({ id: "CHK-1", status: "Paid", config: { app: "pos", slug: "x", ...extra } });

(async () => {
  section("catalogue");
  {
    ok(ss.PACKS.map((p) => p.id).join() === "restaurant,retail,services", "three first-version packs");
    ok(ss.PACKS.every((p) => ["other", "retail", "services"].includes(p.kind)), "every pack maps to a business kind murzak_pos knows");
    ok(Object.isFrozen(ss.PACKS), "catalogue is frozen");
    ok(JSON.parse(JSON.stringify(ss.catalogForClient())).packs.length === 3, "catalogue serialises for the client");
  }

  section("recommendations follow the style");
  {
    const r = ss.PACKS[0];
    const d = (s) => ss.defaultOptions(r, s);
    ok(d("restaurant").kitchenTickets && !d("restaurant").barTill, "restaurant: kitchen on, bar off");
    ok(!d("bar").kitchenTickets && d("bar").barTill, "bar: bar on, kitchen off");
    ok(d("both").kitchenTickets && d("both").barTill, "restaurant with a bar: both on");
    ok(d("both").quickNotes === true && d("both").stationScreens === false, "notes on and screens off by default");
  }

  section("normalizeAnswers: never trusts the browser");
  {
    ok(!ss.normalizeAnswers(null).ok && !ss.normalizeAnswers([]).ok && !ss.normalizeAnswers("x").ok, "rejects non objects");
    ok(!ss.normalizeAnswers({ pack: "casino" }).ok, "rejects an unknown pack");
    ok(!ss.normalizeAnswers({ pack: "restaurant", style: "zoo" }).ok, "rejects an unknown style");
    const a = ss.normalizeAnswers({ pack: "restaurant", style: "both", options: { barTill: "yes", stationScreens: true, evil: true }, branches: "3", staff: 12.5 }).answers;
    ok(a.options.barTill === false, "a flag must be exactly true (the string yes is not)");
    ok(a.options.kitchenTickets === true, "an option not sent takes the recommendation");
    ok(a.options.stationScreens === true && !("evil" in a.options), "unknown options are dropped");
    ok(a.branches === 3 && a.staff === undefined, "a numeric string is accepted, a fraction is dropped");
    const b = ss.normalizeAnswers({ pack: "retail", branches: 2, staff: 5, options: { kitchenTickets: true } }).answers;
    ok(b.branches === 2 && b.staff === 5 && Object.keys(b.options).length === 0, "retail keeps counts and ignores restaurant options");
    ok(ss.normalizeAnswers({ pack: "retail", branches: 0 }).answers.branches === undefined && ss.normalizeAnswers({ pack: "retail", branches: 1000 }).answers.branches === undefined, "out of range counts are dropped");
    ok(ss.normalizeAnswers({ pack: "restaurant" }).answers.style === "restaurant", "style defaults to the pack default");
  }

  section("buildPlan: shapes murzak_pos accepts");
  {
    const plan = (o) => ss.buildPlan(ss.normalizeAnswers(o).answers);
    const both = plan({ pack: "restaurant", style: "both" });
    ok(both.kind === "other" && both.kitchen.enabled === true, "restaurant: kind other, kitchen settings on");
    ok(both.kitchen.stations.map((s) => s.name).join() === "Kitchen,Bar", "kitchen and bar stations");
    ok(both.kitchen.defaultStation === "kitchen", "the kitchen takes anything that matches no group");
    ok(both.itemGroups.join() === "Food,Drinks", "groups the stations need");
    ok(both.kitchen.stations.every((s) => s.name.length <= 20 && s.id.length <= 140), "within the POS's station limits");
    ok(both.kitchen.quickNotes.length <= 12 && both.kitchen.quickNotes.every((n) => n.length <= 80), "quick notes within the POS's limits");
    const bar = plan({ pack: "restaurant", style: "bar" });
    ok(bar.kitchen.stations.length === 1 && bar.kitchen.defaultStation === "bar", "bar only: one station, which is the default");
    const none = plan({ pack: "restaurant", options: { kitchenTickets: false, barTill: false } });
    ok(none.kitchen === null && none.itemGroups.length === 0, "no stations means no kitchen change at all");
    const noNotes = plan({ pack: "restaurant", options: { quickNotes: false } });
    ok(noNotes.kitchen.quickNotes.length === 0, "quick notes can be turned off");
    ok(plan({ pack: "retail" }).kind === "retail" && plan({ pack: "retail" }).kitchen === null, "retail: kind only");
    ok(plan({ pack: "services" }).kind === "services", "services: kind services");
    ok(ss.buildPlan({ pack: "nope" }) === null, "unknown pack has no plan");
  }

  section("describePlan: plain words");
  {
    const lines = ss.describePlan(ss.normalizeAnswers({ pack: "restaurant", style: "both" }).answers).join(" ");
    ok(/Kitchen till is on/.test(lines) && /Bar till is on/.test(lines), "says what is on");
    const off = ss.describePlan(ss.normalizeAnswers({ pack: "restaurant", style: "restaurant" }).answers).join(" ");
    ok(/Bar till is off/.test(off), "says what is off");
    ok(ss.describePlan({ pack: "x" }).length === 0, "nothing for an unknown pack");
  }

  section("saveShopSetup");
  {
    const client = makeClient({ "CHK-1": { app: "pos", slug: "x", welcomeEmail: { state: "sent" } } });
    const r = await ss.saveShopSetup({ client, order: paid(), body: { answers: { pack: "restaurant", style: "both" } }, nowMs: 1 });
    const stored = JSON.parse(client.rows["CHK-1"].config_json);
    ok(r.ok && stored.shopSetup.state === "saved" && stored.shopSetup.plan.kitchen.enabled, "answers and plan are stored");
    ok(stored.welcomeEmail.state === "sent" && stored.app === "pos", "other keys on the order are kept");
    ok(r.setup && !("plan" in r.setup), "the browser gets a summary, not the host plan");

    const bad = await ss.saveShopSetup({ client, order: paid(), body: { answers: { pack: "x" } } });
    ok(!bad.ok && bad.status === 400, "bad answers are a 400");
    const unpaid = await ss.saveShopSetup({ client, order: { id: "CHK-1", status: "Draft", config: { app: "pos" } }, body: { skip: true } });
    ok(!unpaid.ok && unpaid.status === 409, "an unpaid order cannot be set up");
    const notApp = await ss.saveShopSetup({ client, order: { id: "CHK-1", status: "Paid", config: {} }, body: { skip: true } });
    ok(!notApp.ok && notApp.status === 409, "a non app order cannot be set up");

    const again = await ss.saveShopSetup({ client, order: paid({ shopSetup: stored.shopSetup }), body: { answers: { pack: "retail" } } });
    ok(again.ok, "answers can be changed before they are applied");
    for (const state of ["applying", "applied"]) {
      const late = await ss.saveShopSetup({ client, order: paid({ shopSetup: { state } }), body: { answers: { pack: "retail" } } });
      ok(!late.ok && late.status === 409, `no changes once ${state}`);
    }

    const skipped = await ss.saveShopSetup({ client, order: paid(), body: { skip: true }, nowMs: 5 });
    ok(skipped.ok && skipped.setup.skipped === true && JSON.parse(client.rows["CHK-1"].config_json).shopSetup.plan === undefined, "skipping stores no plan");
  }

  section("a marker written meanwhile is not lost");
  {
    const client = makeClient({ "CHK-2": { app: "pos" } });
    await ss.mergeOrderConfig(client, "CHK-2", (c) => { c.shopSetup = { state: "saved" }; return c; });
    await ss.mergeOrderConfig(client, "CHK-2", (c) => { c.welcomeEmail = { state: "sent" }; return c; });
    const c = JSON.parse(client.rows["CHK-2"].config_json);
    ok(c.shopSetup.state === "saved" && c.welcomeEmail.state === "sent", "each writer keeps the other's key");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})();
