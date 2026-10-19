/**
 * Hand-marked paid app orders get their build started - node test/paidOrderReconciler.test.js
 */
let passed = 0, failed = 0; const fails = [];
function ok(c, m) { if (c) { passed++; console.log("  ok:", m); } else { failed++; fails.push(m); console.error("  FAIL:", m); } }
function section(n) { console.log(`\n# ${n}`); }

const rec = require("../services/apps/paidOrderReconciler");

const NOW = Date.parse("2026-10-19T14:00:00Z");
const longAgo = "2026-10-19 13:30:00.000000";   // 30 min before NOW
const justNow = "2026-10-19 13:59:30.000000";   // 30 s before NOW

function world({ orders, invoices = {}, jobs = [] }) {
  const orderBy = Object.fromEntries(orders.map((o) => [o.name, o]));
  const dec = (u) => decodeURIComponent(u);
  const w = {
    jobs, orderBy, activations: [],
    client: {
      get: async (url) => {
        const u = dec(url);
        if (u.endsWith("/Checkout Order")) return { data: { data: orders } };
        const one = u.match(/\/Checkout Order\/(.+)$/); if (one) return { data: { data: orderBy[one[1]] } };
        const inv = u.match(/\/Portal Invoice\/(.+)$/); if (inv) return { data: { data: invoices[inv[1]] } };
        if (u.endsWith("/Provisioning Job")) return { data: { data: w.jobs } };
        throw new Error(`unexpected GET ${u}`);
      },
      put: async (url, body) => { const m = dec(url).match(/\/Checkout Order\/(.+)$/); Object.assign(orderBy[m[1]], body); return { data: {} }; },
    },
  };
  return w;
}
const order = (o = {}) => ({ name: "CHK-1", status: "Paid", web_account: "ACC-1", service_id: "biz-pos-inventory", invoice_doc_name: "INV-1", config_json: JSON.stringify({ app: "pos", slug: "shop" }), modified: longAgo, ...o });
const paidInv = (o = {}) => ({ "INV-1": { name: "INV-1", status: "Paid", web_account: "ACC-1", modified: longAgo, ...o } });
const cfg = (w, n = "CHK-1") => JSON.parse(w.orderBy[n].config_json);

(async () => {
  section("reconcileDecision");
  {
    ok(rec.reconcileDecision({}, NOW).go === true, "untouched order may go");
    ok(rec.reconcileDecision({ reconcile: { state: "done" } }, NOW).go === false, "done is never repeated");
    ok(rec.reconcileDecision({ reconcile: { state: "gave_up" } }, NOW).go === false, "gave up is left alone");
    ok(rec.reconcileDecision({ reconcile: { state: "failed", attempts: 1, at: new Date(NOW - 60000).toISOString() } }, NOW).go === false, "waits before a retry");
    ok(rec.reconcileDecision({ reconcile: { state: "failed", attempts: 1, at: new Date(NOW - 3600000).toISOString() } }, NOW).go === true, "retries after the gap");
    ok(rec.reconcileDecision({ reconcile: { state: "failed", attempts: 3, at: new Date(NOW - 3600000).toISOString() } }, NOW).go === false, "stops at the attempt limit");
  }

  section("a hand-marked paid order with no job is started");
  {
    const w = world({ orders: [order({ status: "Draft" })], invoices: paidInv() });
    const r = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, activate: async (a) => { w.activations.push(a); w.jobs.push({ invoice: a.invoiceDocName }); } });
    ok(r.reconciled === 1 && r.failed === 0, "reported as started");
    ok(w.activations.length === 1 && w.activations[0].webAccount === "ACC-1" && w.activations[0].invoiceDocName === "INV-1", "activation runs for the order's own account and invoice");
    ok(cfg(w).reconcile.state === "done" && cfg(w).app === "pos", "marked done, other keys kept");
    ok(w.orderBy["CHK-1"].status === "Paid", "a still-Draft order is settled to Paid");
    const again = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, activate: async () => { throw new Error("must not run twice"); } });
    ok(again.reconciled === 0 && w.activations.length === 1, "a second pass does nothing");
  }

  section("dry run changes nothing");
  {
    const w = world({ orders: [order({ status: "Draft" })], invoices: paidInv() });
    const r = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, dryRun: true, activate: async () => { throw new Error("must not activate"); } });
    ok(r.reconciled === 0 && r.failed === 0 && r.wouldStart.length === 1 && /CHK-1 \(INV-1/.test(r.wouldStart[0]), "lists what it would start");
    ok(!("reconcile" in cfg(w)) && w.orderBy["CHK-1"].status === "Draft", "writes no marker and leaves the order as it was");
  }

  section("things it must leave alone");
  {
    const never = async () => { throw new Error("must not activate"); };
    const run = async (o, extra = {}) => {
      const w = world({ orders: [o], invoices: extra.invoices || paidInv(), jobs: extra.jobs || [] });
      const r = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, activate: never });
      return { r, w };
    };
    ok((await run(order(), { invoices: paidInv({ status: "Unpaid" }) })).r.skipped === 1, "an unpaid invoice is never started");
    ok((await run(order(), { jobs: [{ invoice: "INV-1" }] })).r.reconciled === 0, "an order that already has a job is untouched");
    ok((await run(order(), { invoices: paidInv({ modified: justNow }) })).r.skipped === 1, "waits for the normal path when the invoice only just changed");
    ok((await run(order(), { invoices: paidInv({ web_account: "ACC-2" }) })).r.skipped === 1, "an invoice from another account is refused");
    ok((await run(order({ config_json: JSON.stringify({ domain: "a.com" }) }))).r.checked === 0, "not an app order: ignored");
    ok((await run(order({ service_id: "test-web-hosting-demo" }))).r.checked === 0, "not an app service: ignored");
    ok((await run(order({ invoice_doc_name: "" }))).r.checked === 0, "no invoice yet: ignored");
  }

  section("failure handling");
  {
    const w = world({ orders: [order()], invoices: paidInv() });
    let r = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, activate: async () => { throw new Error("frappe down"); } });
    ok(r.failed === 1 && cfg(w).reconcile.state === "failed" && /frappe down/.test(cfg(w).reconcile.error), "failure recorded with the reason");
    ok(cfg(w).reconcile.attempts === 1, "attempt counted");

    const soon = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW + 60000, activate: async () => { throw new Error("no"); } });
    ok(soon.failed === 0 && soon.skipped === 1, "not retried straight away");

    let t = NOW;
    for (let i = 0; i < 3; i++) { t += 3600000; await rec.sweepPaidAppOrders(w.client, { nowMs: t, activate: async () => { throw new Error("still down"); } }); }
    ok(cfg(w).reconcile.state === "gave_up", "gives up after the attempt limit");
    const after = await rec.sweepPaidAppOrders(w.client, { nowMs: t + 7200000, activate: async () => { throw new Error("must not run"); } });
    ok(after.failed === 0, "and then leaves it alone");

    const w2 = world({ orders: [order()], invoices: paidInv() });
    const silent = await rec.sweepPaidAppOrders(w2.client, { nowMs: NOW, activate: async () => {} }); // ran, made no job
    ok(silent.failed === 1 && /no provisioning job/.test(cfg(w2).reconcile.error), "activation that creates no job counts as a failure");
  }

  section("list failure and the per-pass cap");
  {
    const bad = await rec.sweepPaidAppOrders({ get: async () => { throw new Error("boom"); } }, { nowMs: NOW, activate: async () => {} });
    ok(bad.error === "boom" && bad.reconciled === 0, "a failed list is reported, not thrown");
    const many = Array.from({ length: 8 }, (_, i) => order({ name: `CHK-${i}`, invoice_doc_name: "INV-1" }));
    const w = world({ orders: many, invoices: paidInv() });
    const r = await rec.sweepPaidAppOrders(w.client, { nowMs: NOW, activate: async () => {} });
    ok(r.failed <= 5, "at most five orders are worked per pass");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error(fails.join("\n")); process.exit(1); }
})();
