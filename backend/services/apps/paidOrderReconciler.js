// services/apps/paidOrderReconciler.js
//
// Starts the build for an app order whose invoice was marked Paid BY HAND.
//
// THE GAP THIS CLOSES
//   The normal payment rails (PayPal capture, M-Pesa callback) mark the invoice
//   Paid and then run "activate services", which flips the account's service row
//   to "Setting up" and creates the Provisioning Job. Setting an invoice to Paid
//   in the Frappe desk (a bank transfer, cash, a staff correction) only does the
//   first half: the order page notices the paid invoice and shows "Paid", but no
//   job is ever made, so the customer waits on a shop nobody is building.
//
// WHAT THIS DOES
//   Finds app orders (Murzak POS) whose invoice is Paid and which have no
//   Provisioning Job at all, and runs the SAME activation the payment rails run,
//   through the callback the server wires in. That callback runs with
//   paymentVerified:false, so it can only resync an invoice a person or rail has
//   already marked Paid: it can never turn an unpaid invoice into a paid one.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   - It never marks anything paid.
//   - It never touches an order that already has a job, in any state.
//   - It waits MIN_AGE_MS after the invoice changed, so it never races the
//     normal path that is still finishing the same payment.
//   - A failing order is tried a limited number of times and then left alone
//     (with the reason on the order) rather than retried forever.
//   - In DRY RUN mode it only reports what it would start and changes nothing.
//     Turn the real thing on after reading what dry run lists: an old paid order
//     whose job was deleted during a clean-up would otherwise be rebuilt.
//
// Marker, on the order's existing config_json (no schema change):
//   config.reconcile = {state: "activating"|"done"|"failed"|"gave_up", at, attempts, error?}

const { getServiceMeta } = require("../provisioning/catalog");
const { JOB_DOCTYPE } = require("../provisioning/constants");
const { mergeOrderConfig } = require("./shopSetup");

const ORDER_DOCTYPE = "Checkout Order";
const INVOICE_DOCTYPE = "Portal Invoice";

const MIN_AGE_MS = 2 * 60 * 1000;
const RETRY_GAP_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_PER_SWEEP = 5;
const DEFAULT_LOOKBACK_MS = 14 * 24 * 3600 * 1000;

function parseJson(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function sqlTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

/** Frappe returns naive UTC datetimes ("2026-10-19 13:01:51.419564"). */
function parseUtc(s) {
  const t = Date.parse(String(s || "").replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : NaN;
}

/** Pure: may this order be tried now? */
function reconcileDecision(config, nowMs) {
  const r = config?.reconcile;
  if (!r) return { go: true, attempts: 0 };
  if (r.state === "done" || r.state === "gave_up") return { go: false, reason: r.state };
  const attempts = Number(r.attempts || 0);
  if (attempts >= MAX_ATTEMPTS) return { go: false, reason: "gave_up" };
  const at = Date.parse(r.at || "");
  if (Number.isFinite(at) && nowMs - at < RETRY_GAP_MS) return { go: false, reason: "tried recently" };
  return { go: true, attempts };
}

async function hasJob(client, invoiceDocName) {
  const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
    params: {
      fields: JSON.stringify(["name", "invoice"]),
      filters: JSON.stringify([["invoice", "=", invoiceDocName]]),
      limit_page_length: 5,
    },
  });
  // Re-filter in JS: never trust a server filter to be exact.
  return (res.data?.data || []).some((j) => j?.invoice === invoiceDocName);
}

/**
 * One pass. Never throws.
 *
 * @param {object} client
 * @param {object} opts
 * @param {Function} opts.activate  async ({webAccount, invoiceDocName}) -> void.
 *        Runs the normal "activate services" for an already-Paid invoice.
 * @param {boolean} [opts.dryRun]  report what would be started, change nothing
 * @returns {Promise<{checked:number, reconciled:number, failed:number, skipped:number, wouldStart:string[], error?:string}>}
 */
async function sweepPaidAppOrders(client, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const lookbackMs = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const out = { checked: 0, reconciled: 0, failed: 0, skipped: 0, wouldStart: [] };

  let rows;
  try {
    const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
      params: {
        fields: JSON.stringify(["name", "status", "web_account", "service_id", "invoice_doc_name", "config_json", "modified"]),
        filters: JSON.stringify([
          ["invoice_doc_name", "is", "set"],
          ["status", "in", ["Draft", "Paid"]],
          ["modified", ">=", sqlTime(nowMs - lookbackMs)],
        ]),
        order_by: "modified asc",
        limit_page_length: 100,
      },
    });
    rows = res.data?.data || [];
  } catch (e) {
    return { ...out, error: e.message };
  }

  for (const row of rows) {
    if (out.reconciled + out.failed >= MAX_PER_SWEEP) break;
    const config = parseJson(row.config_json, {});
    // Only app orders (Murzak POS); everything else has its own flow.
    if (!row.invoice_doc_name || !config.app || !getServiceMeta(String(row.service_id || ""))?.app) continue;
    out.checked++;

    try {
      const decision = reconcileDecision(config, nowMs);
      if (!decision.go) { out.skipped++; continue; }

      const invRes = await client.get(`/api/resource/${INVOICE_DOCTYPE}/${encodeURIComponent(row.invoice_doc_name)}`);
      const inv = invRes.data?.data;
      if (!inv || String(inv.status || "").trim().toLowerCase() !== "paid") { out.skipped++; continue; }
      // The invoice must belong to the order's own account.
      if (!row.web_account || inv.web_account !== row.web_account) { out.skipped++; continue; }
      const changedAt = parseUtc(inv.modified);
      if (!Number.isFinite(changedAt) || nowMs - changedAt < MIN_AGE_MS) { out.skipped++; continue; }

      if (await hasJob(client, row.invoice_doc_name)) { out.skipped++; continue; }

      if (opts.dryRun) {
        out.wouldStart.push(`${row.name} (${row.invoice_doc_name}, ${row.service_id}, account ${row.web_account}, shop ${config.slug || "?"})`);
        continue;
      }

      const attempts = decision.attempts + 1;
      await mergeOrderConfig(client, row.name, (cfg) => {
        cfg.reconcile = { state: "activating", at: new Date(nowMs).toISOString(), attempts };
        return cfg;
      });

      let failure = "";
      try {
        await opts.activate({ webAccount: row.web_account, invoiceDocName: row.invoice_doc_name });
        // Activation reports provisioning problems without throwing, so check the result.
        if (!(await hasJob(client, row.invoice_doc_name))) failure = "activation ran but no provisioning job was created";
      } catch (e) {
        failure = String(e.message || e).slice(0, 200);
      }

      if (!failure) {
        await mergeOrderConfig(client, row.name, (cfg) => {
          cfg.reconcile = { state: "done", at: new Date(nowMs).toISOString(), attempts };
          return cfg;
        });
        // The buyer may never open the order page again, so settle its status here.
        if (row.status !== "Paid") {
          await client.put(`/api/resource/${ORDER_DOCTYPE}/${encodeURIComponent(row.name)}`, { status: "Paid" }).catch(() => {});
        }
        out.reconciled++;
        console.log(`[paid-order] ${row.name}: started provisioning for hand-marked invoice ${row.invoice_doc_name}`);
      } else {
        await mergeOrderConfig(client, row.name, (cfg) => {
          cfg.reconcile = {
            state: attempts >= MAX_ATTEMPTS ? "gave_up" : "failed",
            at: new Date(nowMs).toISOString(),
            attempts,
            error: failure,
          };
          return cfg;
        }).catch(() => {});
        out.failed++;
        console.warn(`[paid-order] ${row.name}: attempt ${attempts} failed: ${failure}`);
      }
    } catch (e) {
      out.failed++;
      console.warn(`[paid-order] ${row.name}: ${e.message}`);
    }
  }
  return out;
}

module.exports = { MIN_AGE_MS, MAX_ATTEMPTS, reconcileDecision, sweepPaidAppOrders };
