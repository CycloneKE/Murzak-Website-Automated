/**
 * Shop address rules — node test/shopAddress.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const { slugFromName, checkSlug, suggestSlugs } = require("../services/apps/shopAddress");

section("slugFromName");
ok(slugFromName("Mama Njeri Stores") === "mama-njeri-stores", "spaces become hyphens, lowercased");
ok(slugFromName("  Café  Délice!! ") === "cafe-delice", "accents stripped, punctuation dropped, trimmed");
ok(slugFromName("A&B -- Wholesalers") === "a-b-wholesalers", "runs of separators collapse to one hyphen");
ok(slugFromName("x".repeat(60)).length === 40, "cut to 40 characters");
ok(slugFromName("a".repeat(39) + " bc") === "a".repeat(39), "never ends on a hyphen after the cut");
ok(slugFromName("!!!") === "", "nothing usable -> empty");

section("checkSlug");
ok(checkSlug("mamanjeri").ok === true, "plain name is fine");
ok(checkSlug("ab").reason === "too_short", "under 3 chars");
ok(checkSlug("a".repeat(41)).reason === "too_long", "over 40 chars");
ok(checkSlug("-shop").reason === "invalid", "leading hyphen");
ok(checkSlug("shop-").reason === "invalid", "trailing hyphen");
ok(checkSlug("Shop").reason === "invalid", "uppercase rejected (caller must slugify)");
ok(checkSlug("shop_1").reason === "invalid", "underscore rejected");
for (const r of ["api", "www", "admin", "pos", "erp", "murzak", "status"]) ok(checkSlug(r).reason === "reserved", `${r} is reserved`);
ok(checkSlug("user-26-08-12-0001").reason === "reserved", "account-derived site names are reserved");
ok(checkSlug("prov-check").reason === "reserved", "provisioner probe name is reserved");
ok(checkSlug("user-friendly-shop").ok === true, "'user-' followed by a letter is fine");

section("suggestSlugs");
const s = suggestSlugs("mamanjeri");
ok(s.length === 3 && s.every((x) => checkSlug(x).ok), "three valid suggestions");
ok(!s.includes("mamanjeri"), "never suggests the taken name itself");
ok(suggestSlugs("x".repeat(40)).every((x) => x.length <= 40 && checkSlug(x).ok), "suggestions respect the length cap");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error(fails.join("\n")); process.exit(1); }
