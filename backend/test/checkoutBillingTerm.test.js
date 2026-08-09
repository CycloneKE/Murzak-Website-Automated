// backend/test/checkoutBillingTerm.test.js
//
// checkoutBillingTerm.js — the single source of truth for "what term is
// this account on, and since when." Every consumer (renewal sweep, add-on
// pro-rata, checkout eligibility) goes through one of these four functions,
// so they cannot disagree about the term — that disagreement was the root
// cause of Critical C2 in the prior whole-branch review.

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const {
  findLastPaidSubscriptionInvoice,
  readInvoiceBillingTerm,
  getCurrentBillingTerm,
  isEligibleForTermChoice,
} = require("../services/checkoutBillingTerm");

// Minimal mock: a single "web_account" can have at most one paid Subscription
// invoice fixture, and single-document GETs by name resolve against a small
// name -> doc map. Mirrors the shape of a real Frappe client closely enough
// for these pure query-composition functions.
function makeClient({ paidInvoice = null, docsByName = {} } = {}) {
  return {
    get: async (url, opts) => {
      if (url === "/api/resource/Portal Invoice" && opts?.params) {
        return { data: { data: paidInvoice ? [paidInvoice] : [] } };
      }
      const m = /\/api\/resource\/Portal Invoice\/(.+)$/.exec(url);
      if (m) {
        const name = decodeURIComponent(m[1]);
        const doc = docsByName[name];
        if (!doc) { const e = new Error("404"); e.response = { status: 404 }; throw e; }
        return { data: { data: doc } };
      }
      return { data: { data: {} } };
    },
  };
}

(async () => {
  section("findLastPaidSubscriptionInvoice");
  {
    const client = makeClient({ paidInvoice: { name: "PINV-1", invoice_date: "2026-01-05" } });
    const res = await findLastPaidSubscriptionInvoice(client, "acct-1");
    ok(res?.name === "PINV-1", "returns the paid invoice's name");
    ok(res?.invoice_date === "2026-01-05", "returns the paid invoice's invoice_date");
  }
  {
    const client = makeClient({ paidInvoice: null });
    const res = await findLastPaidSubscriptionInvoice(client, "acct-1");
    ok(res === null, "no paid Subscription invoice -> null");
  }

  section("readInvoiceBillingTerm — fail-safe to monthly");
  {
    const client = makeClient({ docsByName: { "PINV-A": { name: "PINV-A", billing_term: "annual" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-A") === "annual", "explicit annual");
  }
  {
    const client = makeClient({ docsByName: { "PINV-M": { name: "PINV-M", billing_term: "monthly" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-M") === "monthly", "explicit monthly");
  }
  {
    // Pre-existing invoice, never migrated — the field is simply absent,
    // not an error. This is what makes every invoice ever created before
    // this feature safe by construction.
    const client = makeClient({ docsByName: { "PINV-OLD": { name: "PINV-OLD" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-OLD") === "monthly", "missing field -> monthly");
  }
  {
    const client = makeClient({ docsByName: { "PINV-X": { name: "PINV-X", billing_term: "yearly" } } });
    ok(await readInvoiceBillingTerm(client, "PINV-X") === "monthly", "unknown value -> monthly, never trusted raw");
  }

  section("getCurrentBillingTerm");
  {
    const client = makeClient({
      paidInvoice: { name: "PINV-2", invoice_date: "2026-02-10" },
      docsByName: { "PINV-2": { name: "PINV-2", billing_term: "annual" } },
    });
    const res = await getCurrentBillingTerm(client, "acct-1");
    ok(res.term === "annual", "term read from the last paid invoice");
    ok(res.anchorDate === "2026-02-10", "anchorDate is the last paid invoice's own invoice_date");
    ok(res.lastPaidInvoiceName === "PINV-2", "lastPaidInvoiceName is exposed");
  }
  {
    const client = makeClient({ paidInvoice: null });
    const res = await getCurrentBillingTerm(client, "acct-1");
    ok(res.term === "monthly", "no paid invoice -> monthly (first-purchase/no-history case)");
    ok(res.anchorDate === null, "no paid invoice -> anchorDate null");
    ok(res.lastPaidInvoiceName === null, "no paid invoice -> lastPaidInvoiceName null");
  }

  section("isEligibleForTermChoice");
  {
    const client = makeClient({ paidInvoice: null });
    ok(await isEligibleForTermChoice(client, "acct-1", "Web Hosting") === true, "no paid history + monthly-billed product -> eligible");
  }
  {
    const client = makeClient({ paidInvoice: { name: "PINV-3", invoice_date: "2026-01-01" } });
    ok(await isEligibleForTermChoice(client, "acct-1", "Web Hosting") === false, "paid history already exists -> not eligible");
  }
  {
    const client = makeClient({ paidInvoice: null });
    ok(await isEligibleForTermChoice(client, "acct-1", "Domain Registration") === false, "domain product -> never eligible, regardless of history");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
