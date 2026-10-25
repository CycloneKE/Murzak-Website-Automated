/**
 * Service deletion against an unpaid bundle checkout invoice (I1) —
 * server.js reconcileServiceDeletionAgainstInvoices.
 *   node test/bundleInvoiceReconcile.test.js
 *
 * Deleting one line from a bundle order's still-unpaid checkout invoice
 * re-prices the remaining rows from the catalog. Before I1 that silently
 * dropped the bundle saving; now a pairing's recorded saving survives while
 * both its primary and its companion remain, and goes when either is removed.
 * Requires server.js with MOCK_FRAPPE=true (importing it binds no port).
 */
process.env.MOCK_FRAPPE = "true";

let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { reconcileServiceDeletionAgainstInvoices } = require("../server");
const { makeMockFrappe } = require("./helpers/mockFrappe");

const ACCT = "acct-rc";
function build({ applied = [{ pairingId: "pos-domain-com", invoiceDocName: "PINV-CHK", savingKes: 1575 }], companions } = {}) {
  return makeMockFrappe({
    "Portal Invoice": {
      "PINV-CHK": {
        name: "PINV-CHK", invoice_no: "ADD-1", web_account: ACCT, type: "Add-on", status: "Unpaid",
        // POS Duka 2,500 + .com 4,200 + storage 1,200 - 1,575 saving.
        amount: 6325,
        selected_services: [
          { service_id: "biz-pos-duka", status: "Awaiting Payment" },
          { service_id: "domain-com", domain_choice: "rc.com", status: "Awaiting Payment" },
          { service_id: "starter-storage", status: "Awaiting Payment" },
        ],
      },
    },
    "Checkout Order": {
      "CHK-1": {
        name: "CHK-1", web_account: ACCT, status: "Draft", service_id: "biz-pos-duka", invoice_doc_name: "PINV-CHK",
        config_json: JSON.stringify({ bundle: {
          companions: companions || [{ serviceId: "domain-com", config: { domain: "rc.com" } }, { serviceId: "starter-storage", config: {} }],
          savingKes: 1575, applied } }),
      },
    },
  });
}

(async () => {
  process.env.BUNDLES_ENABLED = "true";

  section("deleting an unpaired line keeps the recorded saving");
  {
    const client = build();
    await reconcileServiceDeletionAgainstInvoices(client, ACCT, "starter-storage");
    const inv = client.store["Portal Invoice"]["PINV-CHK"];
    ok(inv.amount === 5125, `2,500 + 4,200 - 1,575 = 5,125 (got ${inv.amount})`);
    ok(inv.selected_services.length === 2, "storage row removed");
  }

  section("deleting the paired companion drops its saving");
  {
    const client = build();
    await reconcileServiceDeletionAgainstInvoices(client, ACCT, "domain-com");
    ok(client.store["Portal Invoice"]["PINV-CHK"].amount === 3700, `2,500 + 1,200 = 3,700 (got ${client.store["Portal Invoice"]["PINV-CHK"].amount})`);
  }

  section("deleting the primary drops the saving too");
  {
    const client = build();
    await reconcileServiceDeletionAgainstInvoices(client, ACCT, "biz-pos-duka");
    ok(client.store["Portal Invoice"]["PINV-CHK"].amount === 5400, `4,200 + 1,200 = 5,400 (got ${client.store["Portal Invoice"]["PINV-CHK"].amount})`);
  }

  section("a saving recorded against a different invoice is not taken here");
  {
    const client = build({ applied: [{ pairingId: "pos-domain-com", invoiceDocName: "PINV-OTHER", savingKes: 1575 }] });
    await reconcileServiceDeletionAgainstInvoices(client, ACCT, "starter-storage");
    ok(client.store["Portal Invoice"]["PINV-CHK"].amount === 6700, `no recorded saving for this invoice -> 6,700 (got ${client.store["Portal Invoice"]["PINV-CHK"].amount})`);
  }

  section("flag off: priced exactly as before (catalog monthly sum), no order lookup");
  {
    process.env.BUNDLES_ENABLED = "false";
    const client = build();
    const realGet = client.get; let orderReads = 0;
    client.get = async (url, ...r) => { if (String(url).includes("Checkout Order")) orderReads++; return realGet(url, ...r); };
    await reconcileServiceDeletionAgainstInvoices(client, ACCT, "starter-storage");
    ok(client.store["Portal Invoice"]["PINV-CHK"].amount === 6700, `flag off -> 6,700 (got ${client.store["Portal Invoice"]["PINV-CHK"].amount})`);
    ok(orderReads === 0, "no Checkout Order read with the flag off");
    process.env.BUNDLES_ENABLED = "true";
  }

  section("the add-on route prices through createAddonPurchaseInvoice (the unit tested in ordersRoutes.test.js)");
  {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../server.js"), "utf8");
    const start = src.indexOf('app.post("/api/addons/invoice/create"');
    const body = src.slice(start, src.indexOf("app.post(", start + 10));
    ok(start > 0 && /await createAddonPurchaseInvoice\(/.test(body), "route calls createAddonPurchaseInvoice");
    ok(!/createAddonInvoice\(|applyAddOnSaving\(/.test(body), "route does not price or apply the saving any other way");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
  process.exit(0);
})();
