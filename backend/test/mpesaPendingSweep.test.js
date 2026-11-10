/**
 * M-Pesa payments the callback never applied get settled - node test/mpesaPendingSweep.test.js
 *
 * The callback answers Safaricom before doing its work, and Safaricom does not
 * retry. A callback that failed or never arrived used to leave a PAID invoice
 * Unpaid for good. The sweep asks Daraja directly and settles what it reports
 * paid, and must never settle anything it cannot prove was paid in full.
 */

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { appendCheckoutRequestId, checkoutIdHistoryHas, parseCheckoutHistory } = require("../services/mpesaService");
const sweep = require("../services/mpesaPendingSweep");

const NOW = Date.parse("2026-11-10T12:00:00Z");
const MIN = 60 * 1000;

function inv(over = {}) {
  return {
    name: "INV-1", web_account: "WA-1", status: "Unpaid", amount: 1500,
    mpesa_checkout_request_id: "ws_CO_1", mpesa_checkout_request_ids: "ws_CO_1:1500",
    ...over,
  };
}

/** A fake Frappe holding invoices; records the list filter and every write. */
function world(invoices) {
  const w = { puts: [], filters: null };
  w.client = {
    get: async (url, cfg) => {
      w.filters = JSON.parse(cfg.params.filters);
      const open = w.filters.find((f) => f[0] === "status")[2];
      return { data: { data: invoices.filter((i) => open.includes(i.status) && i.mpesa_checkout_request_id) } };
    },
    put: async (url, body) => { w.puts.push({ url, body }); return { data: {} }; },
  };
  return w;
}

/** Runs the sweep twice: once to notice the prompt, once after the wait. */
async function settle(w, opts) {
  const state = opts.state || new Map();
  const first = await sweep.sweepPendingMpesa(w.client, { ...opts, state, nowMs: NOW });
  const second = await sweep.sweepPendingMpesa(w.client, { ...opts, state, nowMs: NOW + 2 * MIN });
  return { first, second, state };
}

const paid = async () => ({ resultCode: 0, resultDesc: "ok" });
const never = async () => { throw new Error("must not activate"); };

(async () => {
  section("the amount a prompt charged is kept with its id");
  {
    const h = appendCheckoutRequestId("ws_CO_1", "ws_CO_2", 1500);
    ok(h === "ws_CO_1,ws_CO_2:1500", "the amount is stored next to the id");
    ok(checkoutIdHistoryHas(h, "ws_CO_2") && checkoutIdHistoryHas(h, "ws_CO_1"), "the callback still finds both ids");
    ok(!checkoutIdHistoryHas(h, "ws_CO_2:1500") && !checkoutIdHistoryHas("ws_CO_11:5", "ws_CO_1"), "matching is still on the whole id");
    const parsed = parseCheckoutHistory(h);
    ok(parsed[0].amountKes === null && parsed[1].amountKes === 1500, "an older entry with no amount reads back as unknown");
    ok(appendCheckoutRequestId(h, "ws_CO_2", 2000) === "ws_CO_1,ws_CO_2:2000", "re-pushing the same id replaces it, never duplicates");
    ok(appendCheckoutRequestId("", "ws_CO_1", 0) === "ws_CO_1", "a zero amount is not stored");
  }

  section("a paid prompt whose callback was lost is settled");
  {
    const w = world([inv()]);
    const activations = [];
    const queries = [];
    const { first, second } = await settle(w, {
      queryStatus: async (id) => { queries.push(id); return paid(); },
      activate: async (a) => { activations.push(a); },
    });
    ok(first.queried === 0, "a prompt just seen is not asked about yet (the customer may still be paying)");
    ok(second.settled === 1 && queries.join() === "ws_CO_1", "Daraja is asked once and the invoice is settled");
    ok(activations.length === 1 && activations[0].invoiceDocName === "INV-1" && activations[0].webAccount === "WA-1", "activation runs for the right invoice and account");
    ok(w.filters.some((f) => f[0] === "status" && f[1] === "in" && f[2].join() === "Unpaid,Pending,Draft"), "only open invoices are looked at");
  }

  section("a settled prompt is not asked about again");
  {
    const w = world([inv()]);
    let asked = 0;
    const { state } = await settle(w, { queryStatus: async () => { asked++; return paid(); }, activate: async () => {} });
    await sweep.sweepPendingMpesa(w.client, { state, nowMs: NOW + 24 * 60 * MIN, queryStatus: async () => { asked++; return paid(); }, activate: never });
    ok(asked === 1, "one question, one activation");
  }

  section("a paid SUPERSEDED prompt still settles the invoice");
  {
    const w = world([inv({ mpesa_checkout_request_id: "ws_CO_2", mpesa_checkout_request_ids: "ws_CO_1:1500,ws_CO_2:1500" })]);
    const activations = [];
    const { second } = await settle(w, {
      queryStatus: async (id) => (id === "ws_CO_1" ? paid() : { resultCode: 1032, resultDesc: "cancelled" }),
      activate: async (a) => { activations.push(a); },
    });
    ok(second.settled === 1 && activations.length === 1, "the customer who paid the first prompt is not left unpaid");
  }

  section("money that cannot be proven to cover the invoice is never applied");
  {
    // The invoice grew (an add-on was merged in) after the prompt was sent.
    const w = world([inv({ amount: 2500 })]);
    const { second } = await settle(w, { queryStatus: paid, activate: never });
    ok(second.settled === 0 && second.exceptions === 1, "an underpaid prompt is not activated");
    ok(w.puts.length === 1 && /MPESA_UNDERPAID/.test(w.puts[0].body.payment_exception), "it is written on the invoice for a person to resolve");

    // A prompt sent before amounts were recorded.
    const w2 = world([inv({ mpesa_checkout_request_ids: "ws_CO_1" })]);
    const r2 = await settle(w2, { queryStatus: paid, activate: never });
    ok(r2.second.settled === 0 && r2.second.exceptions === 1 && /MPESA_AMOUNT_UNKNOWN/.test(w2.puts[0].body.payment_exception), "a paid prompt with no recorded amount is flagged, not activated");

    // Only the single-id field exists (the history field is not installed).
    const w3 = world([inv({ mpesa_checkout_request_ids: "" })]);
    const r3 = await settle(w3, { queryStatus: paid, activate: never });
    ok(r3.second.settled === 0 && r3.second.exceptions === 1, "the same holds when only the current id is known");
  }

  section("invoices that are not open are left alone");
  {
    for (const status of ["Paid", "Deleted", "Cancelled", "Refunded"]) {
      const w = world([inv({ status })]);
      const { second } = await settle(w, { queryStatus: async () => { throw new Error("must not ask"); }, activate: never });
      ok(second.checked === 0 && second.settled === 0, `${status} is never asked about or settled`);
    }
  }

  section("a prompt that was not paid");
  {
    let asked = 0;
    const w = world([inv()]);
    const { state } = await settle(w, { queryStatus: async () => { asked++; return { resultCode: 1032, resultDesc: "cancelled" }; }, activate: never });
    await sweep.sweepPendingMpesa(w.client, { state, nowMs: NOW + 10 * 60 * MIN, queryStatus: async () => { asked++; return paid(); }, activate: never });
    ok(asked === 1, "a cancelled prompt is asked about once and then dropped");
  }

  section("an answer that is not known yet is asked again later, a bounded number of times");
  {
    let asked = 0;
    const w = world([inv()]);
    const state = new Map();
    const pending = async () => { asked++; throw new Error("The transaction is being processed"); };
    let t = NOW;
    await sweep.sweepPendingMpesa(w.client, { state, nowMs: t, queryStatus: pending, activate: never });
    for (let i = 0; i < 400; i++) { // every 3 minutes for 20 hours
      t += 3 * MIN;
      await sweep.sweepPendingMpesa(w.client, { state, nowMs: t, queryStatus: pending, activate: never });
    }
    ok(asked === sweep.RETRY_GAPS_MS.length + 1, `Daraja is asked ${asked} times in total, not on every pass`);
  }

  section("activation failing (Frappe down) is retried, not forgotten");
  {
    const w = world([inv()]);
    const state = new Map();
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error("Frappe unreachable"); };
    await sweep.sweepPendingMpesa(w.client, { state, nowMs: NOW, queryStatus: paid, activate: flaky });
    const a = await sweep.sweepPendingMpesa(w.client, { state, nowMs: NOW + 2 * MIN, queryStatus: paid, activate: flaky });
    ok(a.failed === 1 && a.settled === 0, "the failure is counted");
    const b = await sweep.sweepPendingMpesa(w.client, { state, nowMs: NOW + 8 * MIN, queryStatus: paid, activate: flaky });
    ok(b.settled === 1 && calls === 2, "the next due pass settles it");
  }

  section("dry run changes nothing");
  {
    const w = world([inv()]);
    const { second } = await settle(w, { queryStatus: paid, activate: never, dryRun: true });
    ok(second.settled === 0 && second.wouldSettle.length === 1 && /INV-1/.test(second.wouldSettle[0]), "lists what it would settle");
    ok(w.puts.length === 0, "writes nothing");
  }

  section("Daraja is not flooded");
  {
    const many = Array.from({ length: 30 }, (_, i) => inv({ name: `INV-${i}`, mpesa_checkout_request_id: `ws_CO_${i}`, mpesa_checkout_request_ids: `ws_CO_${i}:1500` }));
    const w = world(many);
    let asked = 0;
    const { second } = await settle(w, { queryStatus: async () => { asked++; return { resultCode: 4999, resultDesc: "processing" }; }, activate: never });
    ok(asked === 10 && second.queried === 10, "at most 10 questions per pass");
  }

  section("the list failing is reported, not thrown");
  {
    const r = await sweep.sweepPendingMpesa({ get: async () => { throw new Error("Frappe down"); } }, { nowMs: NOW, state: new Map(), queryStatus: paid, activate: never });
    ok(r.error === "Frappe down" && r.settled === 0, "the pass ends quietly and the next one tries again");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
