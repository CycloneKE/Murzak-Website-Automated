// services/mpesaPendingSweep.js
//
// Settles M-Pesa payments whose callback never did its job.
//
// THE GAP THIS CLOSES
//   The callback route answers Safaricom "Accepted" BEFORE it does any work
//   (the Daraja spec wants a fast 200), and Safaricom never retries a callback
//   it got a 200 for. So if Frappe was unreachable at that moment, or
//   activation threw, or the callback simply never arrived, the customer has
//   paid and the invoice stays Unpaid for good: no shop is built, and the only
//   trace is a log line. mpesaService.queryStkStatus was written for this and
//   then never called by anything.
//
// WHAT THIS DOES
//   Every few minutes it looks at open invoices that had an M-Pesa prompt sent
//   recently, asks Daraja directly what became of each prompt, and for one
//   Daraja says was PAID it runs the same activation the callback runs.
//
// WHY IT IS SAFE TO LET THIS MARK AN INVOICE PAID
//   - The answer comes from Daraja over an authenticated call we make, which is
//     stronger evidence than the callback (an unsigned POST to a public URL).
//   - Only prompts recorded on the invoice by our own stk-push route are asked
//     about, so a payment can only ever settle the invoice it was pushed for.
//   - The amount that prompt charged is checked against what the invoice costs
//     NOW, exactly as the callback does. Daraja's status answer carries no
//     amount, so the amount is the one stored with the prompt id when it was
//     sent (mpesaService.appendCheckoutRequestId). A paid prompt with no stored
//     amount, or one that paid less than the invoice now costs, is NOT applied:
//     it is written on the invoice (payment_exception) and logged for a person.
//   - Only invoices still in an open status are touched, so an invoice staff
//     cancelled, deleted or reversed is never switched back on.
//   - Activation is idempotent: if the callback got there first, this is a
//     no-op resync.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   - It does not ask about a prompt younger than FIRST_CHECK_MS: the customer
//     may still be typing their PIN and the callback may still be on its way.
//   - It does not poll forever. Each prompt is asked about a handful of times at
//     growing gaps, then left alone. Daraja rate-limits this query.
//   - In DRY RUN mode it only reports what it would settle and changes nothing.
//
// STATE is in memory only (which prompts were asked about, and when). A restart
// forgets it, which costs at most one extra round of questions; the lookback
// window still bounds the work.

const { parseCheckoutHistory } = require("./mpesaService");

const INVOICE_DOCTYPE = "Portal Invoice";
const OPEN_STATUSES = ["Unpaid", "Pending", "Draft"];

const FIRST_CHECK_MS = 90 * 1000;
// Gap before the 2nd, 3rd, ... question about the same prompt.
const RETRY_GAPS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const DEFAULT_LOOKBACK_MS = 24 * 3600 * 1000;
const FORGET_AFTER_MS = 60 * 60 * 1000;
const MAX_QUERIES_PER_SWEEP = 10;
const MAX_IDS_PER_INVOICE = 5;
const MAX_INVOICES = 50;

// Daraja result codes that mean "this prompt is finished and was not paid":
// insufficient balance, cancelled by the customer, phone unreachable / prompt
// timed out, wrong PIN, prompt expired. Anything else that is not 0 is treated
// as "not known yet" and asked again later.
const FINAL_UNPAID_CODES = new Set([1, 1019, 1032, 1037, 2001]);

const defaultState = new Map(); // checkout id -> { lastSeen, attempts, nextAt, done }

function sqlTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/** Prompts recorded on an invoice, newest first, as [{ id, amountKes }]. */
function promptsFor(inv) {
  const entries = parseCheckoutHistory(inv.mpesa_checkout_request_ids);
  const current = String(inv.mpesa_checkout_request_id || "").trim();
  if (current && !entries.some((e) => e.id === current)) {
    entries.push({ id: current, amountKes: null });
  }
  return entries.reverse().slice(0, MAX_IDS_PER_INVOICE);
}

/** Schedule the next question about a prompt, or stop asking. */
function backOff(entry, nowMs) {
  const gap = RETRY_GAPS_MS[entry.attempts - 1];
  if (gap === undefined) entry.done = true;
  else entry.nextAt = nowMs + gap;
}

async function recordException(client, inv, code, reason) {
  // Loud and structured: until real alerting exists this line is the alert.
  console.error(
    "MPESA PAYMENT EXCEPTION, money paid but NOT applied:",
    JSON.stringify({ invoice: inv.name, webAccount: inv.web_account, code, reason })
  );
  try {
    await client.put(`/api/resource/${INVOICE_DOCTYPE}/${encodeURIComponent(inv.name)}`, {
      payment_gateway: "M-Pesa",
      payment_exception: `${code}: ${reason}`,
    });
  } catch (e) {
    console.error(
      `MPESA PAYMENT EXCEPTION: could not write it on ${inv.name} ` +
        `(are the Portal Invoice custom fields installed?): ${e.response?.data?.message || e.message}`
    );
  }
}

/**
 * One pass.
 *
 * client            Frappe REST client (axios-like: get/put).
 * opts.queryStatus  async (checkoutRequestID) => { resultCode, resultDesc }
 * opts.activate     async ({ webAccount, invoiceDocName }) => void. Must run the
 *                   normal activation with paymentVerified:true.
 * opts.expectedKes  (invoiceAmount) => whole KES the invoice costs now.
 * opts.dryRun       report only.
 * opts.nowMs, opts.lookbackMs, opts.state   for tests.
 */
async function sweepPendingMpesa(client, opts = {}) {
  const {
    queryStatus,
    activate,
    expectedKes = (a) => Math.ceil(Number(a) || 0),
    dryRun = false,
    nowMs = Date.now(),
    lookbackMs = DEFAULT_LOOKBACK_MS,
    state = defaultState,
  } = opts;
  const out = { checked: 0, queried: 0, settled: 0, exceptions: 0, failed: 0, wouldSettle: [] };

  let invoices;
  try {
    const res = await client.get(`/api/resource/${INVOICE_DOCTYPE}`, {
      params: {
        filters: JSON.stringify([
          ["status", "in", OPEN_STATUSES],
          ["mpesa_checkout_request_id", "is", "set"],
          ["modified", ">", sqlTime(nowMs - lookbackMs)],
        ]),
        fields: JSON.stringify([
          "name", "web_account", "status", "amount",
          "mpesa_checkout_request_id", "mpesa_checkout_request_ids",
        ]),
        order_by: "modified desc",
        limit_page_length: MAX_INVOICES,
      },
    });
    invoices = res.data?.data || [];
  } catch (e) {
    return { ...out, error: e.response?.data?.message || e.message };
  }

  // Forget prompts whose invoice has dropped out of the list (settled, closed,
  // or aged out), so the map cannot grow without bound. A prompt is kept for as
  // long as its invoice is still listed, so it is never asked about afresh.
  for (const [id, entry] of state) {
    if (nowMs - entry.lastSeen > FORGET_AFTER_MS) state.delete(id);
  }

  for (const inv of invoices) {
    out.checked++;
    for (const prompt of promptsFor(inv)) {
      let entry = state.get(prompt.id);
      if (!entry) {
        // First sighting: give the customer and the callback time to finish.
        entry = { lastSeen: nowMs, attempts: 0, nextAt: nowMs + FIRST_CHECK_MS, done: false };
        state.set(prompt.id, entry);
      }
      entry.lastSeen = nowMs;
      if (entry.done || nowMs < entry.nextAt) continue;
      if (out.queried >= MAX_QUERIES_PER_SWEEP) return out;

      out.queried++;
      entry.attempts++;
      let result;
      try {
        result = await queryStatus(prompt.id);
      } catch {
        // Daraja answers a prompt it is still processing with an HTTP error,
        // and a network failure looks the same from here: ask again later.
        backOff(entry, nowMs);
        continue;
      }

      if (result.resultCode !== 0) {
        if (FINAL_UNPAID_CODES.has(result.resultCode)) entry.done = true;
        else backOff(entry, nowMs);
        continue;
      }

      // Daraja says this prompt was PAID.
      const expected = expectedKes(inv.amount);
      if (prompt.amountKes == null) {
        entry.done = true;
        out.exceptions++;
        if (!dryRun) {
          await recordException(client, inv, "MPESA_AMOUNT_UNKNOWN",
            `Daraja reports prompt ${prompt.id} paid, but the amount it charged was not recorded. Check the M-Pesa statement, then mark the invoice Paid by hand.`);
        }
        break;
      }
      if (expected > 0 && prompt.amountKes < expected) {
        entry.done = true;
        out.exceptions++;
        if (!dryRun) {
          await recordException(client, inv, "MPESA_UNDERPAID",
            `Prompt ${prompt.id} paid KES ${prompt.amountKes}, but the invoice now costs KES ${expected}.`);
        }
        break;
      }

      if (dryRun) {
        entry.done = true;
        out.wouldSettle.push(`${inv.name} (prompt ${prompt.id}, KES ${prompt.amountKes})`);
        break;
      }
      try {
        await activate({ webAccount: inv.web_account, invoiceDocName: inv.name });
        entry.done = true;
        out.settled++;
        console.log(`[mpesa-sweep] settled ${inv.name}: Daraja confirms prompt ${prompt.id} paid KES ${prompt.amountKes}`);
      } catch (e) {
        // Frappe may be the thing that is down. Keep the prompt and try again.
        out.failed++;
        backOff(entry, nowMs);
        console.error(`[mpesa-sweep] ${inv.name} is paid at Daraja but activation failed (will retry): ${e.message}`);
      }
      break; // one paid prompt settles the invoice; do not ask about its others
    }
  }
  return out;
}

module.exports = {
  sweepPendingMpesa,
  promptsFor,
  FIRST_CHECK_MS,
  RETRY_GAPS_MS,
  OPEN_STATUSES,
};
