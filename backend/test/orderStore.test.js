/**
 * Checkout Order store tests — runs without Redis or Frappe.
 *   node test/orderStore.test.js   (or: npm test)
 *
 * Covers RAM-reservation pricing/footprint from the catalog snapshot, the
 * 30-minute draft reservation window (and its expiry with no sweeper needed),
 * the capacity gate, and getOrder's ownership/renewal/paid-derivation
 * behavior for services/checkout/orderStore.js.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }
async function throws(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (expected throw ${code})`); }
  catch (e) { ok(e.statusCode === code, `${msg} -> ${code} (${e.statusCode})`); }
}

const {
  createOrder, getOrder, cancelOrder, linkInvoice, reservedDraftRamMb, RESERVATION_TTL_MS,
} = require("../services/checkout/orderStore");

function makeClient({ invoices = {} } = {}) {
  const docs = {}; let seq = 0;
  return {
    docs,
    get: async (url, opts) => {
      if (url.includes("/Portal Invoice/")) {
        const name = decodeURIComponent(url.split("/").pop());
        return { data: { data: invoices[name] || null } };
      }
      if (url.endsWith("/Checkout Order") || url.endsWith("/Checkout%20Order"))
        return { data: { data: Object.values(docs) } };   // list endpoint
      const name = decodeURIComponent(url.split("/").pop());
      if (!docs[name]) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
      return { data: { data: docs[name] } };
    },
    post: async (url, body) => { const name = `CHK-${++seq}`; docs[name] = { name, ...body }; return { data: { data: docs[name] } }; },
    put: async (url, body) => { const name = decodeURIComponent(url.split("/").pop()); Object.assign(docs[name], body); return { data: { data: docs[name] } }; },
  };
}

const T0 = 1_800_000_000_000; // fixed epoch for deterministic tests

(async () => {
  section("createOrder: prices + footprint from snapshot, reservation set");
  {
    const client = makeClient();
    const order = await createOrder({
      client, webAccountName: "acct-1", serviceId: "starter-web-hosting",
      config: { domainChoice: "Use Murzak Subdomain" }, planKey: "Starter",
      source: "CloudLaunch", fleetReservedRamMb: 0, nowMs: T0,
    });
    ok(order.monthlyKes === 1200 && order.setupKes === 500, "prices from snapshot");
    ok(order.totalDueKes === 1700, "totalDue = monthly + setup");
    ok(order.status === "Draft", "starts as Draft");
    ok(Date.parse(order.reservationExpiresAt) === T0 + RESERVATION_TTL_MS, "30-min reservation");
  }

  section("createOrder: unknown service -> 400");
  await throws(
    () => createOrder({ client: makeClient(), webAccountName: "a", serviceId: "nope", config: {}, fleetReservedRamMb: 0, nowMs: T0 }),
    400, "unknown service refused"
  );

  section("capacity: draft reservations count until they expire");
  {
    const client = makeClient();
    await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    ok((await reservedDraftRamMb(client, T0)) === 768, "live draft counts (starter-web-hosting = 768MB)");
    ok((await reservedDraftRamMb(client, T0 + RESERVATION_TTL_MS + 1)) === 0, "expired draft stops counting");
  }

  section("capacity: create refuses when fleet+drafts+new exceeds threshold");
  await throws(
    () => createOrder({
      client: makeClient(), webAccountName: "a", serviceId: "starter-web-hosting",
      config: {}, fleetReservedRamMb: 999999, nowMs: T0,
    }),
    409, "over-threshold create is a 409 CAPACITY"
  );

  section("getOrder: ownership, renewal heartbeat, paid derivation");
  {
    const invoices = { "PINV-1": { name: "PINV-1", status: "Paid" } };
    const client = makeClient({ invoices });
    const o = await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    await throws(() => getOrder({ client, webAccountName: "intruder", orderId: o.id, nowMs: T0 }), 403, "not-owner is 403");
    const renewed = await getOrder({ client, webAccountName: "a", orderId: o.id, nowMs: T0 + 60_000, renew: true });
    ok(Date.parse(renewed.reservationExpiresAt) === T0 + 60_000 + RESERVATION_TTL_MS, "heartbeat renews reservation");
    await linkInvoice({ client, orderId: o.id, invoiceDocName: "PINV-1" });
    const paid = await getOrder({ client, webAccountName: "a", orderId: o.id, nowMs: T0 + 120_000 });
    ok(paid.status === "Paid", "linked Paid invoice flips order to Paid");
    ok((await reservedDraftRamMb(client, T0 + 120_000)) === 0, "paid order no longer reserves");
  }

  section("cancelOrder releases the reservation");
  {
    const client = makeClient();
    const o = await createOrder({ client, webAccountName: "a", serviceId: "starter-web-hosting", config: {}, fleetReservedRamMb: 0, nowMs: T0 });
    await cancelOrder({ client, webAccountName: "a", orderId: o.id });
    ok((await reservedDraftRamMb(client, T0)) === 0, "cancelled order stops counting");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
