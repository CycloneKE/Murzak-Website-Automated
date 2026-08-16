/**
 * Guardrails for the ONE script allowed to delete live infrastructure
 * (scripts/coolify-orphan-cleanup.js).
 *
 * The fixture below is the real resource inventory read off the production box
 * on 2026-08-15 — 24 resources, of which exactly 18 were unowned tenant
 * containers. The assertion that matters most is that murzak-website-automated
 * survives: it has no Provisioning Job either, so an ownership-only rule (which
 * is all orphans.js applies when reporting) would delete the company's live
 * website. node test/coolifyOrphanCleanup.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { TENANT_NAME_RE, classifyResources } = require("../scripts/coolify-orphan-cleanup");

// Real inventory, 2026-08-15.
const LIVE = [
  { kind: "application", uuid: "m97a6sejlizhpmvk5b77dhib", name: "murzak-website-automated" },
  { kind: "application", uuid: "t838dhookpknkgwxiohtk0l9", name: "user-26-08-12-0001-starter-app-hosting" },
  { kind: "database",    uuid: "xjr6tu20dwcj7j27oxetqb6c", name: "murzak-redis" },
  { kind: "service", uuid: "cmilzsltrniayysv870n6yti", name: "hermes-agent-with-webui-cmilzsltrniayysv870n6yti" },
  { kind: "service", uuid: "e3x2iil1co8mrhv18xe8bc84", name: "hermes-agent-with-webui-e3x2iil1co8mrhv18xe8bc84" },
  { kind: "service", uuid: "i3lbinz17bv61xe0vxqyti54", name: "appsmith-i3lbinz17bv61xe0vxqyti54" },
  ...["hracm717hc98232c63rez72t","n12c5o377e485wwbpnxza5pv","g2k5bvn0af6r3eopglruonsn","cd9od2uk65i5oxlc3euau4qw"]
    .map((uuid) => ({ kind: "service", uuid, name: "user-26-02-14-0002-starter-web-hosting" })),
  ...["x2hj6k1cqj1ihws81c5au172","wj8mfoelgjsq3oiqvbgmhzwh","hbzi2ggmn1k1g33bw710dlbi","i9heygwvacahqf7oglxdw113"]
    .map((uuid) => ({ kind: "service", uuid, name: "user-26-07-18-0001-starter-web-hosting" })),
  ...["g43164jilom4abt4dffkhdo3","qumkx6hxqp9b20t8bx2frmmq","yk75pjqhywlyfzntki9allni"]
    .map((uuid) => ({ kind: "service", uuid, name: "user-26-02-14-0002-starter-app-hosting" })),
  ...["o2khto4yxn4q7706uj7w8vr3","ox6ujdhdld6rosssoi6wahvj","cgsyxwarcnp5nug1b86tatrd"]
    .map((uuid) => ({ kind: "service", uuid, name: "user-26-07-18-0001-starter-app-hosting" })),
  ...["u850ina9mk3o1z4kiow6o4ta","wn9659r1lymtm07qyvsw4xo3","edl9l7zbibw05nv6luqqipqg"]
    .map((uuid) => ({ kind: "service", uuid, name: "user-26-02-14-0002-db-postgres" })),
  { kind: "service", uuid: "vg5egzh9xhwiziqpynmtl99p", name: "user-26-08-12-0001-starter-app-hosting" },
];

// The only external_ref any Provisioning Job actually claimed.
const OWNED = new Set(["t838dhookpknkgwxiohtk0l9"]);

section("name allowlist — platform infrastructure can never be matched");
{
  ok(TENANT_NAME_RE.test("user-26-02-14-0002-starter-web-hosting"), "tenant resource matches");
  ok(TENANT_NAME_RE.test("USER-26-02-14-0002-DB-POSTGRES"), "match is case-insensitive");
  ok(!TENANT_NAME_RE.test("murzak-website-automated"), "the LIVE WEBSITE never matches");
  ok(!TENANT_NAME_RE.test("murzak-redis"), "redis never matches");
  ok(!TENANT_NAME_RE.test("appsmith-i3lbinz17bv61xe0vxqyti54"), "third-party appsmith never matches");
  ok(!TENANT_NAME_RE.test("hermes-agent-with-webui-cmilzsltrniayysv870n6yti"), "third-party hermes never matches");
  ok(!TENANT_NAME_RE.test("user-website-automated"), "a lookalike without the date block never matches");
  ok(!TENANT_NAME_RE.test("not-user-26-02-14-0002-x"), "anchored at the start — no mid-string match");
}

section("classification against the real 2026-08-15 inventory");
{
  const { doomed, protectedByName, protectedByOwner } = classifyResources(LIVE, OWNED);
  ok(LIVE.length === 24, `fixture is the full inventory (${LIVE.length})`);
  ok(doomed.length === 18, `exactly 18 orphans selected (got ${doomed.length})`);
  ok(protectedByOwner.length === 1 && protectedByOwner[0].uuid === "t838dhookpknkgwxiohtk0l9", "the one claimed ref is protected");
  ok(protectedByName.length === 5, `5 non-tenant resources protected by name (got ${protectedByName.length})`);

  const doomedUuids = new Set(doomed.map((d) => d.uuid));
  ok(!doomedUuids.has("m97a6sejlizhpmvk5b77dhib"), "murzak-website-automated is NOT deleted (the unrecoverable mistake)");
  ok(!doomedUuids.has("xjr6tu20dwcj7j27oxetqb6c"), "murzak-redis is NOT deleted");
  ok(!doomedUuids.has("t838dhookpknkgwxiohtk0l9"), "the live BYOA app is NOT deleted");
  ok(doomed.every((d) => d.kind === "service"), "every orphan selected is a service — no application is touched");
  ok(doomedUuids.size === 18, "no duplicate uuids in the delete set");
}

section("ownership is re-read live — a job that gained a ref protects its resource");
{
  const laterOwned = new Set(["t838dhookpknkgwxiohtk0l9", "hracm717hc98232c63rez72t"]);
  const { doomed } = classifyResources(LIVE, laterOwned);
  ok(doomed.length === 17, "a newly-claimed ref drops out of the delete set");
  ok(!doomed.some((d) => d.uuid === "hracm717hc98232c63rez72t"), "the newly-claimed resource is spared");
}

section("empty ownership still cannot reach platform infrastructure");
{
  // Worst case: Frappe returns zero refs. The script aborts before this point,
  // but even if it didn't, the name allowlist must still hold the line.
  const { doomed } = classifyResources(LIVE, new Set());
  ok(doomed.length === 19, "with nothing owned, all 19 tenant-shaped resources are selected");
  ok(!doomed.some((d) => /^murzak-/.test(d.name)), "still never selects murzak-* platform resources");
}

console.log("\n================================================");
console.log(`ORPHAN CLEANUP GUARDRAIL TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
