/**
 * The marketplace the POS shows — node test/marketplace.test.js
 */
process.env.MOCK_FRAPPE = "true";

let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const marketplace = require("../services/marketplace");
const { getServiceMeta } = require("../services/provisioning/catalog");

section("what is on offer");
const { groups } = marketplace.buildCatalog();
const items = groups.flatMap((g) => g.items);
ok(groups.length > 0 && items.length > 0, "there is something to buy");
ok(groups.every((g) => g.items.length > 0), "empty groups are dropped");
ok(items.every((i) => getServiceMeta(i.id)), "every item is in the catalogue snapshot");
ok(items.every((i) => i.monthlyKes > 0), "every item is priced");
ok(items.every((i) => getServiceMeta(i.id).capacityClass !== "dedicated"), "no quote-only item is offered");
ok(new Set(items.map((i) => i.id)).size === items.length, "no item appears twice");
ok(items.every((i) => Object.keys(i).sort().join() === "id,monthlyKes,name,setupKes"), "only id, name and prices are given out");

section("prices are the checkout's prices");
for (const i of items) {
  const meta = getServiceMeta(i.id);
  ok(i.monthlyKes === Number(meta.monthlyKes) && i.setupKes === Number(meta.setupKes || 0) && i.name === meta.name, `${i.id} matches the catalogue`);
}

section("rules");
ok(marketplace.isSelfServe({ monthlyKes: 1500, capacityClass: "volume" }) === true, "a priced product is self-serve");
ok(marketplace.isSelfServe({ monthlyKes: 0, capacityClass: "volume" }) === false, "unpriced is not");
ok(marketplace.isSelfServe({ monthlyKes: 9000, capacityClass: "dedicated" }) === false, "quote-only is not");
ok(marketplace.isSelfServe(null) === false, "unknown is not");
ok(marketplace.GROUPS.every((g) => g.ids.every((id) => /^[a-z0-9-]+$/.test(id))), "ids are plain catalogue ids");

section("the route");
const express = require("express");
const http = require("http");
const app = express();
app.use(require("../routes/marketplaceRoutes")());
const server = http.createServer(app).listen(0, () => {
  http.get({ port: server.address().port, path: "/api/marketplace/catalog" }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => {
      const data = JSON.parse(body);
      ok(res.statusCode === 200 && data.ok === true && Array.isArray(data.groups), "answers with the groups");
      ok(/max-age=60/.test(res.headers["cache-control"] || ""), "is cached for a minute");
      server.close();
      console.log(`\n${passed} passed, ${failed} failed`);
      if (failed) { console.error(fails.join("\n")); process.exit(1); }
    });
  });
});
