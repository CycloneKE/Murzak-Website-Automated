/**
 * M-Pesa reconciliation — the primary Kenyan money-in rail.
 *   node test/mpesaReconciliation.test.js   (or: npm test)
 *
 * Before this the rail had no test of any kind, and three ways to lose money:
 *
 *  1. Portal Invoice carried ONE overwritable mpesa_checkout_request_id. Every
 *     STK push overwrote the previous id, so if a customer let the first prompt
 *     sit, tapped "pay" again, and then entered their PIN on the FIRST prompt,
 *     the callback arrived carrying an id no invoice matched any more. The
 *     money left their account and nothing recorded it.
 *
 *  2. Nothing ever asked Daraja what happened to a push. If the callback was
 *     dropped — Safaricom retries are not guaranteed and the endpoint is
 *     public — the payment was simply never applied.
 *
 *  3. Re-pushing was unguarded, so a customer who tapped twice could be
 *     prompted (and pay) twice for one invoice.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  appendCheckoutRequestId,
  checkoutIdHistoryHas,
  findInvoiceByCheckoutRequestId,
  DARAJA_TIMEOUT_MS,
} = require("../services/mpesaService");

(async () => {
  section("checkout-id history keeps every push, not just the newest");
  {
    ok(appendCheckoutRequestId("", "ws_CO_1") === "ws_CO_1", "first push seeds the history");
    ok(appendCheckoutRequestId("ws_CO_1", "ws_CO_2") === "ws_CO_1,ws_CO_2", "second push is appended, first is retained");
    ok(
      appendCheckoutRequestId("ws_CO_1,ws_CO_2", "ws_CO_2") === "ws_CO_1,ws_CO_2",
      "re-pushing the same id does not duplicate it"
    );
    ok(appendCheckoutRequestId(null, "ws_CO_1") === "ws_CO_1", "a null history is handled");
  }

  section("history is bounded so a retry loop cannot grow the field without limit");
  {
    let h = "";
    for (let i = 0; i < 30; i++) h = appendCheckoutRequestId(h, `ws_CO_${i}`);
    const kept = h.split(",");
    ok(kept.length <= 10, `history is capped (kept ${kept.length})`);
    ok(kept.includes("ws_CO_29"), "the newest push is always retained");
  }

  section("membership test matches whole ids, not substrings");
  {
    ok(checkoutIdHistoryHas("ws_CO_1,ws_CO_2", "ws_CO_1") === true, "finds an id at the head");
    ok(checkoutIdHistoryHas("ws_CO_1,ws_CO_2", "ws_CO_2") === true, "finds an id at the tail");
    ok(checkoutIdHistoryHas("ws_CO_11", "ws_CO_1") === false, "ws_CO_1 does not match inside ws_CO_11");
    ok(checkoutIdHistoryHas("", "ws_CO_1") === false, "an empty history matches nothing");
  }

  section("a payment on a superseded push still finds its invoice");
  {
    // The exact money-loss case: two pushes, the customer pays the FIRST one.
    const calls = [];
    const client = {
      get: async (_url, opts) => {
        const filters = JSON.parse(opts?.params?.filters || "[]");
        calls.push(filters);
        const [field, op, value] = filters[0];
        // Frappe holds an invoice whose CURRENT id is the second push, with
        // both pushes in its history.
        const invoice = {
          name: "PINV-1", web_account: "acct-1", status: "Unpaid", amount: 1200,
          mpesa_checkout_request_id: "ws_CO_2",
          mpesa_checkout_request_ids: "ws_CO_1,ws_CO_2",
        };
        if (field === "mpesa_checkout_request_id" && op === "=" && value === invoice.mpesa_checkout_request_id) {
          return { data: { data: [invoice] } };
        }
        if (field === "mpesa_checkout_request_ids" && op === "like" && String(value).includes("ws_CO_1")) {
          return { data: { data: [invoice] } };
        }
        return { data: { data: [] } };
      },
    };

    const found = await findInvoiceByCheckoutRequestId(client, "ws_CO_1");
    ok(found?.name === "PINV-1", `the superseded push still resolves to its invoice (got ${found?.name})`);
    ok(calls.length === 2, `it falls back to the history only after the exact match misses (${calls.length} queries)`);
  }

  section("the current push resolves on the first query");
  {
    let queries = 0;
    const client = {
      get: async (_url, opts) => {
        queries++;
        const [field, , value] = JSON.parse(opts.params.filters)[0];
        if (field === "mpesa_checkout_request_id" && value === "ws_CO_2") {
          return { data: { data: [{ name: "PINV-1", status: "Unpaid", amount: 1200 }] } };
        }
        return { data: { data: [] } };
      },
    };
    const found = await findInvoiceByCheckoutRequestId(client, "ws_CO_2");
    ok(found?.name === "PINV-1", "current id resolves");
    ok(queries === 1, `no wasted second query on the happy path (${queries})`);
  }

  section("an unknown id resolves to nothing rather than a wrong invoice");
  {
    const client = { get: async () => ({ data: { data: [] } }) };
    const found = await findInvoiceByCheckoutRequestId(client, "ws_CO_UNKNOWN");
    ok(found === null, `unknown id returns null (got ${JSON.stringify(found)})`);
  }

  section("Daraja calls have a bounded timeout");
  {
    // A stalled Daraja response used to pin the request forever — on the STK
    // path that means the customer's phone is prompted while the HTTP call
    // never returns.
    ok(Number.isFinite(DARAJA_TIMEOUT_MS) && DARAJA_TIMEOUT_MS > 0, `a timeout is defined (${DARAJA_TIMEOUT_MS}ms)`);
    ok(DARAJA_TIMEOUT_MS <= 30000, "the timeout is short enough to fail fast");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
