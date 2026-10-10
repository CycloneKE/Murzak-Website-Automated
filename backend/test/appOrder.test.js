/**
 * App order validation — node test/appOrder.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }
function throwsCode(fn, code, msg) {
  try { fn(); ok(false, `${msg} (expected ${code})`); } catch (e) { ok(e.code === code, `${msg} -> ${e.code}`); }
}

const { validateAppOrder } = require("../services/apps/appOrder");

section("non-app services pass straight through");
ok(validateAppOrder({ serviceId: "biz-erp-light", config: {}, existingServiceRows: [] }) === null, "ERP is not an app order");

section("POS tier needs a valid address and shop name");
const good = validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Mama Njeri Stores", slug: "mamanjeri" },
  existingServiceRows: [],
});
ok(good && good.app === "pos" && good.slug === "mamanjeri" && good.shopName === "Mama Njeri Stores", "valid order normalized");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "X Shop" }, existingServiceRows: [] }), "slug_invalid", "missing slug");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "X", slug: "api" }, existingServiceRows: [] }), "slug_invalid", "reserved slug");
throwsCode(() => validateAppOrder({ serviceId: "biz-pos-duka", config: { shopName: "  ", slug: "good-shop" }, existingServiceRows: [] }), "shop_name_required", "blank shop name");
ok(validateAppOrder({ serviceId: "biz-pos-chain", config: { shopName: "A", slug: " Good-Shop " }, existingServiceRows: [] }).slug === "good-shop", "slug trimmed and lowercased");

section("one live shop per app until upgrades ship (phase 3)");
throwsCode(() => validateAppOrder({
  serviceId: "biz-pos-chain",
  config: { shopName: "Second", slug: "second-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-inventory", status: "Active" }],
}), "APP_EXISTS", "an Active POS tier blocks a second POS purchase");
throwsCode(() => validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Second", slug: "second-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-duka", status: "Setting up" }],
}), "APP_EXISTS", "a shop still being set up also blocks");
ok(!!validateAppOrder({
  serviceId: "biz-pos-duka",
  config: { shopName: "Again", slug: "again-shop" },
  existingServiceRows: [{ serviceId: "biz-pos-duka", status: "Awaiting Payment" }],
}), "an unpaid earlier attempt does not block");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error(fails.join("\n")); process.exit(1); }
