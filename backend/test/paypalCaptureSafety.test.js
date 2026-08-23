/**
 * PayPal capture safety.
 *   node test/paypalCaptureSafety.test.js   (or: npm test)
 *
 * captureOrder moves the customer's money BEFORE anything is verified. The
 * reference and amount checks run afterwards and used to `throw` — with no
 * refund, no record, no alert, and the invoice left Unpaid. The webhook then
 * failed the identical check and returned {ignored:true} so PayPal stopped
 * retrying. Net effect: the customer is debited and nothing anywhere records
 * that it happened.
 *
 * Two things are asserted here:
 *
 *  1. The expected USD is SNAPSHOTTED on the invoice at order-creation time.
 *     Recomputing it at capture time from the live invoice amount and the live
 *     KES_TO_USD_RATE means an FX update — or an invoice edited mid-checkout —
 *     fails every in-flight capture and destroys those payments.
 *
 *  2. A capture that fails verification is RECORDED and escalated, never
 *     silently dropped. Money that left a customer's account must always be
 *     traceable to an invoice.
 */

process.env.KES_TO_USD_RATE = process.env.KES_TO_USD_RATE || "0.0078";

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  verifyCapture,
  recordPaymentException,
  convertKesToPaypalAmount,
} = require("../services/paypalService");

// A capture response shaped the way PayPal returns one.
function captureResponse({ reference, value, currency = "USD", captureId = "CAP-1" }) {
  return {
    id: "PPORDER-1",
    status: "COMPLETED",
    purchase_units: [{
      reference_id: reference,
      custom_id: reference,
      amount: { value: String(value), currency_code: currency },
      payments: { captures: [{ id: captureId, status: "COMPLETED", custom_id: reference }] },
    }],
  };
}

(async () => {
  section("a correct capture verifies");
  {
    const invoice = { name: "PINV-1", amount: 1200 };
    const value = convertKesToPaypalAmount(1200); // 9.36 at 0.0078
    const res = verifyCapture({ invoice, jsonResponse: captureResponse({ reference: "PINV-1", value }) });
    ok(res.ok === true, `matching capture verifies (got ${JSON.stringify(res)})`);
  }

  section("a capture for a different invoice is rejected");
  {
    const invoice = { name: "PINV-1", amount: 1200 };
    const value = convertKesToPaypalAmount(1200);
    const res = verifyCapture({ invoice, jsonResponse: captureResponse({ reference: "PINV-OTHER", value }) });
    ok(res.ok === false, "reference mismatch is rejected");
    ok(res.code === "REFERENCE_MISMATCH", `carries a machine-readable code (got ${res.code})`);
  }

  section("a capture for the wrong amount is rejected");
  {
    const invoice = { name: "PINV-1", amount: 1200 };
    const res = verifyCapture({ invoice, jsonResponse: captureResponse({ reference: "PINV-1", value: "1.00" }) });
    ok(res.ok === false, "amount mismatch is rejected");
    ok(res.code === "AMOUNT_MISMATCH", `carries a machine-readable code (got ${res.code})`);
  }

  section("verification uses the amount snapshotted at order creation, not the live rate");
  {
    // The buyer was quoted 9.36 USD for a KES 1,200 invoice and approved it.
    const quotedUsd = convertKesToPaypalAmount(1200);
    const invoice = { name: "PINV-1", amount: 1200, paypal_expected_usd: quotedUsd };

    // Between approval and capture, the KES/USD rate moves.
    const originalRate = process.env.KES_TO_USD_RATE;
    process.env.KES_TO_USD_RATE = "0.0100"; // 1200 KES would now quote 12.00
    try {
      const res = verifyCapture({
        invoice,
        jsonResponse: captureResponse({ reference: "PINV-1", value: quotedUsd }),
      });
      ok(res.ok === true, `the capture the buyer actually approved still verifies after an FX move (got ${JSON.stringify(res)})`);
    } finally {
      process.env.KES_TO_USD_RATE = originalRate;
    }
  }

  section("an invoice edited mid-checkout does not destroy the buyer's capture");
  {
    // The buyer approved 9.36 for order A; the invoice was then grown by
    // another purchase. Without a snapshot, the capture fails and the money
    // is lost. With one, it verifies against what was actually authorised.
    const quotedUsd = convertKesToPaypalAmount(1200);
    const invoice = { name: "PINV-1", amount: 3200, paypal_expected_usd: quotedUsd };
    const res = verifyCapture({
      invoice,
      jsonResponse: captureResponse({ reference: "PINV-1", value: quotedUsd }),
    });
    ok(res.ok === true, "capture verifies against the snapshot, not the mutated invoice amount");
  }

  section("with no snapshot it falls back to the live computation (legacy orders)");
  {
    const invoice = { name: "PINV-1", amount: 1200 };
    const res = verifyCapture({
      invoice,
      jsonResponse: captureResponse({ reference: "PINV-1", value: convertKesToPaypalAmount(1200) }),
    });
    ok(res.ok === true, "orders created before the snapshot field still capture");
  }

  section("a failed verification is recorded on the invoice, never silently dropped");
  {
    const puts = [];
    const frappeClient = {
      put: async (url, body) => { puts.push({ url, body }); return { data: { data: {} } }; },
    };
    await recordPaymentException({
      frappeClient,
      invoice: { name: "PINV-1", amount: 1200 },
      jsonResponse: captureResponse({ reference: "PINV-1", value: "1.00" }),
      reason: "PayPal amount mismatch. Expected 9.36 USD, captured 1.00 USD.",
      code: "AMOUNT_MISMATCH",
    });
    ok(puts.length >= 1, `the invoice is written to (got ${puts.length} writes)`);
    const body = puts[0].body;
    ok(String(puts[0].url).includes("PINV-1"), "written against the right invoice");
    ok(body.paypal_capture_id === "CAP-1", `the capture id is persisted so the money is traceable (got ${body.paypal_capture_id})`);
    ok(body.paypal_order_id === "PPORDER-1", `the PayPal order id is persisted (got ${body.paypal_order_id})`);
    ok(
      typeof body.payment_exception === "string" && body.payment_exception.includes("AMOUNT_MISMATCH"),
      `the reason is persisted for the operator (got ${body.payment_exception})`
    );
  }

  section("recording never throws, even when the custom fields are missing");
  {
    // These are optional Portal Invoice custom fields. If they aren't
    // installed, the write 417s — but losing the audit write must not also
    // swallow the caller's own error path.
    const frappeClient = { put: async () => { throw new Error("417 unknown field"); } };
    let threw = false;
    try {
      await recordPaymentException({
        frappeClient,
        invoice: { name: "PINV-1", amount: 1200 },
        jsonResponse: captureResponse({ reference: "PINV-1", value: "1.00" }),
        reason: "mismatch",
        code: "AMOUNT_MISMATCH",
      });
    } catch { threw = true; }
    ok(!threw, "a missing custom field does not throw out of the recorder");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
