/**
 * Fleet capacity gate on every sale path — assertFleetHasHeadroom.
 *   node test/fleetCapacityGate.test.js   (or: npm test)
 *
 * assertOrderWithinCapacity is a PER-ORDER sanity cap (3200MB/40GB) — it asks
 * "could one shared tenant ever be this big", never "is there room left on the
 * box". The fleet question was asked in exactly one place: ordersRoutes'
 * POST /api/orders, via orderStore's reservation math. The other three intake
 * points — register with selected services (routes/authRoutes.js),
 * /api/plan/select-with-services (server.js), and add-on purchase
 * (services/addonInvoiceService.js) — enforced only the per-order cap, so the
 * main storefront flow could sell the same 6.25GB box to unlimited customers.
 *
 * This is the shared assertion those paths need.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }
async function throwsWith(fn, code, msg) {
  try { await fn(); ok(false, `${msg} (expected throw ${code})`); }
  catch (e) { ok(e.statusCode === code, `${msg} -> ${code} (got ${e.statusCode})`); return; }
}

const { assertFleetHasHeadroom } = require("../services/orderCapacity");
const { CAPACITY } = require("../services/provisioning/catalog");

// thresholdMb() is 85% of sellableRamMb by default -> 5440 of 6400.
const THRESHOLD = Math.floor((CAPACITY.sellableRamMb * 85) / 100);

// Serves a fleet whose committed RAM is exactly `reservedMb`.
function clientReserving(reservedMb) {
  return {
    get: async () => ({ data: { data: reservedMb > 0 ? [{ ram_mb: reservedMb }] : [] } }),
  };
}

(async () => {
  section("an empty box admits a normal order");
  {
    // biz-erp-light is 2048MB.
    await assertFleetHasHeadroom({
      client: clientReserving(0),
      selectedServices: [{ serviceId: "biz-erp-light" }],
    });
    ok(true, "empty fleet + 2048MB order passes");
  }

  section("a nearly-full box refuses the order that would tip it over");
  {
    // 4096 already committed; +2048 = 6144 > 5440 threshold.
    await throwsWith(
      () => assertFleetHasHeadroom({
        client: clientReserving(4096),
        selectedServices: [{ serviceId: "biz-erp-light" }],
      }),
      409,
      "order that exceeds the fleet threshold is refused"
    );
  }

  section("the refusal is machine-readable so checkout can offer the waitlist");
  {
    try {
      await assertFleetHasHeadroom({
        client: clientReserving(5000),
        selectedServices: [{ serviceId: "biz-erp-light" }],
      });
      ok(false, "expected a throw");
    } catch (e) {
      ok(e.code === "CAPACITY", `error carries code CAPACITY (got ${e.code})`);
      ok(typeof e.message === "string" && e.message.length > 0, "error carries a customer-safe message");
    }
  }

  section("an order that exactly reaches the threshold is still admitted");
  {
    const room = THRESHOLD - 2048;
    await assertFleetHasHeadroom({
      client: clientReserving(room),
      selectedServices: [{ serviceId: "biz-erp-light" }],
    });
    ok(true, `reserved ${room} + 2048 === threshold ${THRESHOLD} passes`);
  }

  section("zero-footprint products never trip the gate");
  {
    // A domain has ramMb 0 / diskGb 0 — it consumes no box capacity and must
    // stay buyable even when the node is completely full.
    await assertFleetHasHeadroom({
      client: clientReserving(THRESHOLD),
      selectedServices: [{ serviceId: "domain-com" }],
    });
    ok(true, "domain purchase passes on a full box");
  }

  section("an unreachable Frappe does not silently open the gate");
  {
    // getReservedRamMb returns null when it cannot read the fleet. Treating
    // that as "0 reserved" would turn an outage into an oversell.
    await throwsWith(
      () => assertFleetHasHeadroom({
        client: { get: async () => { throw new Error("frappe down"); } },
        selectedServices: [{ serviceId: "biz-erp-light" }],
      }),
      503,
      "unknown fleet state fails closed for a real workload"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
