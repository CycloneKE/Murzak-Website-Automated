/**
 * Unit tests for turning a paid domain purchase into fulfilment records.
 *   node test/domainPurchaseFulfilment.test.js   (or: npm test)
 *
 * The subtle part is WHICH invoice rows count. `domain_choice` is a field
 * borrowed from the hosting flow, where it holds "Bring My Domain" and
 * friends. Only a Domain Registration product means it holds a domain someone
 * bought — so the serviceId has to gate this, never the presence of a value.
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
  fulfilPurchasedDomains,
  isDomainProductId,
  purchasedDomainsFrom,
} = require("../services/domainPurchaseFulfilment");
const { splitPurchasedDomain } = require("../services/customerDomains");

(async () => {
  section("splitPurchasedDomain — the TLD comes from the PRODUCT, not the string");
  ok(
    JSON.stringify(splitPurchasedDomain("acme.co.ke", ".co.ke")) ===
      JSON.stringify({ requestedName: "acme", requestedTld: ".co.ke", fullDomain: "acme.co.ke" }),
    "a two-label TLD splits correctly — a first-dot split would have said tld='.co.ke' by luck and '.ke' by bug"
  );
  ok(splitPurchasedDomain("acme.com", ".com").requestedName === "acme", "a single-label TLD splits");
  ok(
    splitPurchasedDomain("  HTTPS://Acme.COM/cart ", ".com").fullDomain === "acme.com",
    "normalizes before splitting, so a pasted URL still yields a clean name"
  );
  ok(splitPurchasedDomain("acme.io", ".com") === null, "a domain that does not end in the product's TLD is refused");
  ok(splitPurchasedDomain(".com", ".com") === null, "a bare TLD with no label is refused");
  ok(splitPurchasedDomain("", ".com") === null, "empty domain refused");
  ok(splitPurchasedDomain("acme.com", "") === null, "empty tld refused");
  ok(splitPurchasedDomain(null, null) === null, "nulls refused without throwing");

  section("isDomainProductId");
  ok(isDomainProductId("domain-com") === true, "domain-com is a domain product");
  ok(isDomainProductId("domain-coke") === true, "domain-coke is a domain product");
  ok(isDomainProductId("biz-web-hosting") === false, "website hosting is not");
  ok(isDomainProductId("") === false, "empty is not");
  ok(isDomainProductId(undefined) === false, "undefined is not");
  ok(isDomainProductId("toString") === false, "an Object.prototype key is not a product (own-property check)");

  section("purchasedDomainsFrom — only real domain purchases");
  const rows = [
    { serviceId: "domain-com", domainChoice: "acme.com" },
    { serviceId: "domain-coke", domainChoice: "duka.co.ke" },
    // The trap: hosting reuses domain_choice for something else entirely.
    { serviceId: "biz-web-hosting", domainChoice: "Bring My Domain" },
    { serviceId: "starter-web-hosting", domainChoice: "Use Murzak Subdomain" },
    // Bought a .com product but the value is a .io — checkout should already
    // have refused this; if it ever leaks through, drop it rather than
    // queueing a domain nobody paid for.
    { serviceId: "domain-com", domainChoice: "acme.io" },
    { serviceId: "domain-net", domainChoice: "" },
  ];
  const picked = purchasedDomainsFrom(rows);
  ok(picked.length === 2, "picks exactly the two genuine domain purchases");
  ok(picked[0].fullDomain === "acme.com" && picked[0].requestedTld === ".com", "first is acme.com");
  ok(picked[1].fullDomain === "duka.co.ke" && picked[1].requestedTld === ".co.ke", "second is duka.co.ke");
  ok(
    !picked.some((p) => p.fullDomain === "Bring My Domain".toLowerCase()),
    "a hosting row's domain_choice is never mistaken for a purchase"
  );
  ok(purchasedDomainsFrom([]).length === 0, "empty rows");
  ok(purchasedDomainsFrom(undefined).length === 0, "undefined rows do not throw");
  ok(purchasedDomainsFrom([{}]).length === 0, "a row with nothing on it is skipped");

  section("fulfilPurchasedDomains — records created, never throws");
  const makeClient = () => ({
    posts: [],
    existingRequests: [],
    existingDomains: [],
    async get(url, cfg) {
      if (url.includes("Hosting%20Domain%20Purchase%20Request") || url.includes("Hosting Domain Purchase Request")) {
        return { data: { data: this.existingRequests } };
      }
      return { data: { data: this.existingDomains } };
    },
    async post(url, body) {
      this.posts.push({ url, body });
      return { data: { data: { name: `NEW-${this.posts.length}`, ...body } } };
    },
  });

  const c1 = makeClient();
  const s1 = await fulfilPurchasedDomains(c1, "ACC-1", [{ serviceId: "domain-com", domainChoice: "acme.com" }]);
  ok(s1.considered === 1, "considered the one purchase");
  ok(s1.requests === 1, "created a purchase request");
  ok(s1.domains === 1, "created the ownership record");
  ok(s1.errors.length === 0, "no errors");
  const req = c1.posts.find((p) => p.url.includes("Purchase"));
  ok(req.body.service_id === "domain-com", "the request records the DOMAIN product id, not a hosting service id");
  ok(req.body.requested_name === "acme" && req.body.requested_tld === ".com", "name and tld are split out");
  ok(req.body.provider === "Murzak Cloud", "white-label: no upstream registrar named");
  const dom = c1.posts.find((p) => p.url.includes("Customer%20Domain") || p.url.includes("Customer Domain"));
  ok(dom.body.attached_to_service === "", "a standalone purchase is owned but NOT attached to anything");
  ok(dom.body.kind === "registered", "kind is registered");
  ok(dom.body.source_name === "NEW-1", "ownership record points back at the request that created it");

  const c2 = makeClient();
  c2.existingRequests = [{ name: "PR-9", status: "pending" }];
  c2.existingDomains = [{ name: "CD-9", domain_name: "acme.com", kind: "registered", status: "pending" }];
  const s2 = await fulfilPurchasedDomains(c2, "ACC-1", [{ serviceId: "domain-com", domainChoice: "acme.com" }]);
  ok(s2.requests === 0 && s2.skipped === 1, "a re-synced activation does not queue the same domain twice");
  ok(c2.posts.length === 0, "…and writes nothing at all");

  const c3 = makeClient();
  c3.post = async () => { throw new Error("frappe exploded"); };
  const s3 = await fulfilPurchasedDomains(c3, "ACC-1", [{ serviceId: "domain-com", domainChoice: "acme.com" }]);
  ok(s3.errors.length === 1, "a Frappe failure is captured, not thrown — the invoice is already paid");
  ok(s3.domains === 0, "and nothing is claimed as created");

  const s4 = await fulfilPurchasedDomains(makeClient(), "ACC-1", [{ serviceId: "biz-web-hosting", domainChoice: "x" }]);
  ok(s4.considered === 0, "an invoice with no domain products does no work at all");

  section("wired into activation — a PAID domain invoice produces both records");
  // Drives the real activateServicesForInvoice, the same way billing.test.js
  // does, so this proves the call site and not just the helper. Provisioning
  // off so its best-effort step is a clean no-op.
  process.env.PROVISIONING_ENABLED = "false";
  const { activateServicesForInvoice } = require("../services/billingActivationService");

  const runActivation = async (invoiceServices) => {
    const invoice = { name: "INV-1", web_account: "acct-1", status: "Unpaid", services: invoiceServices };
    const account = { services: invoiceServices.map((s) => ({ service_id: s.service_id, status: "Pending" })) };
    const writes = [];
    const client = {
      get: async (url) => {
        if (url.includes("Portal%20Invoice") || url.includes("Portal Invoice")) return { data: { data: invoice } };
        if (url.includes("Web%20Account") || url.includes("Web Account")) return { data: { data: account } };
        return { data: { data: [] } }; // no existing request, no existing domain
      },
      put: async (url, body) => { writes.push({ verb: "PUT", url, body }); return { data: { data: {} } }; },
      post: async (url, body) => {
        writes.push({ verb: "POST", url, body });
        return { data: { data: { name: "NEW-1", ...body } } };
      },
    };
    await activateServicesForInvoice({
      req: { session: { webAccount: "acct-1", user: { id: "acct-1" } } },
      invoiceDocName: "INV-1",
      paymentVerified: true,
      frappeClient: () => client,
      PORTAL_INVOICE_SERVICES_FIELD: "services",
      CHILD_SERVICE_ID_FIELD: "service_id",
      WEB_ACCOUNT_SERVICES_FIELD: "services",
      CHILD_STATUS_FIELD: "status",
      fetchInvoicesForUser: async () => [],
      fetchSelectedServicesForUser: async () => [],
      buildUserPayload: () => ({ id: "acct-1" }),
    });
    return writes;
  };

  const domainWrites = await runActivation([
    { service_id: "domain-coke", domain_choice: "kimani-hardware.co.ke" },
  ]);
  const postedRequest = domainWrites.find((w) => w.verb === "POST" && /Purchase%20Request|Purchase Request/.test(w.url));
  const postedDomain = domainWrites.find((w) => w.verb === "POST" && /Customer%20Domain|Customer Domain/.test(w.url));
  ok(!!postedRequest, "paying for a domain creates the staff fulfilment request — it never did before");
  ok(!!postedDomain, "…and the ownership record the customer's Domains tab reads");
  ok(postedRequest.body.full_domain === "kimani-hardware.co.ke", "the request carries the domain that was paid for");
  ok(postedRequest.body.requested_tld === ".co.ke", "with the two-label TLD intact");
  ok(postedDomain.body.attached_to_service === "", "bought on its own, so attached to nothing yet");

  const hostingWrites = await runActivation([
    { service_id: "biz-web-hosting", domain_choice: "Bring My Domain" },
  ]);
  ok(
    !hostingWrites.some((w) => w.verb === "POST" && /Purchase|Customer/.test(w.url)),
    "a hosting purchase whose domain_choice holds an unrelated hosting option creates NOTHING"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
