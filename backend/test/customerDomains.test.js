/**
 * Unit tests for the Customer Domain model — runs without Frappe.
 *   node test/customerDomains.test.js   (or: npm test)
 *
 * The normalization rules matter more than they look: a domain typed three
 * different ways must collapse to ONE record, because ensureCustomerDomain's
 * idempotency (and therefore the backfill's safety) is keyed on the
 * normalized name.
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
  DOMAIN_KINDS,
  buildCustomerDomainPayload,
  domainKindForIntake,
  isValidDomainName,
  mapCustomerDomainRow,
  normalizeDomainName,
  normalizeStatus,
  ensureCustomerDomain,
} = require("../services/customerDomains");

(async () => {
  section("normalizeDomainName — one name, however it was typed");
  ok(normalizeDomainName("Example.CO.KE") === "example.co.ke", "lowercases");
  ok(normalizeDomainName("  example.co.ke  ") === "example.co.ke", "trims");
  ok(normalizeDomainName("https://example.co.ke") === "example.co.ke", "strips https scheme");
  ok(normalizeDomainName("http://example.co.ke") === "example.co.ke", "strips http scheme");
  ok(normalizeDomainName("example.co.ke/shop/index.php") === "example.co.ke", "strips path");
  ok(normalizeDomainName("example.co.ke:8080") === "example.co.ke", "strips port");
  ok(normalizeDomainName("example.co.ke.") === "example.co.ke", "strips the trailing root dot");
  ok(normalizeDomainName("example.co.ke?utm=x") === "example.co.ke", "strips query");
  ok(normalizeDomainName("https://Example.CO.KE:443/a?b#c") === "example.co.ke", "all of the above at once");
  ok(normalizeDomainName("") === "", "empty stays empty");
  ok(normalizeDomainName(null) === "", "null -> empty (never throws)");
  ok(normalizeDomainName(undefined) === "", "undefined -> empty");
  ok(
    normalizeDomainName("www.example.co.ke") === "www.example.co.ke",
    "does NOT strip www — www.x and x are different hosts and may point different places"
  );

  section("isValidDomainName — shape only, not availability");
  ok(isValidDomainName("example.co.ke") === true, "a normal domain");
  ok(isValidDomainName("shop.example.co.ke") === true, "a subdomain");
  ok(isValidDomainName("HTTPS://Example.com") === true, "validates after normalizing");
  ok(isValidDomainName("my-shop.co.ke") === true, "hyphens are fine mid-label");
  ok(isValidDomainName("example") === false, "a bare label is not a domain");
  ok(isValidDomainName("") === false, "empty");
  ok(isValidDomainName(null) === false, "null");
  ok(isValidDomainName("exa mple.com") === false, "spaces rejected");
  ok(isValidDomainName("-example.com") === false, "leading hyphen rejected");
  ok(isValidDomainName("example.c") === false, "single-char TLD rejected");
  ok(isValidDomainName("a".repeat(254) + ".com") === false, "over-length rejected");

  section("domainKindForIntake — each intake doctype maps to one kind");
  ok(domainKindForIntake("Hosting Domain Purchase Request") === DOMAIN_KINDS.REGISTERED, "purchase -> registered");
  ok(domainKindForIntake("Hosting External Domain Connection") === DOMAIN_KINDS.EXTERNAL, "external connection -> external");
  ok(domainKindForIntake("Hosting Murzak Subdomain") === DOMAIN_KINDS.MURZAK_SUBDOMAIN, "murzak subdomain -> murzak_subdomain");
  ok(domainKindForIntake("Something Else") === null, "an unknown doctype maps to nothing");
  ok(domainKindForIntake(undefined) === null, "undefined maps to nothing");

  section("buildCustomerDomainPayload");
  const p = buildCustomerDomainPayload({
    webAccount: "ACC-1",
    domainName: "  HTTPS://Shop.Example.CO.KE/cart ",
    kind: "external",
    status: "active",
    registrar: " Safaricom ",
    sourceDoctype: "Hosting External Domain Connection",
    sourceName: "HEDC-1",
  });
  ok(p.domain_name === "shop.example.co.ke", "normalizes the name into the payload");
  ok(p.web_account === "ACC-1", "carries the owning account");
  ok(p.kind === "external", "carries the kind");
  ok(p.status === "active", "carries a valid status");
  ok(p.registrar === "Safaricom", "trims registrar");
  ok(p.attached_to_service === "", "unattached by default — owned-but-unattached is legitimate");
  ok(p.auto_renew === 0, "auto-renew off by default");
  ok(p.ssl_status === "none", "ssl starts at none");
  ok(p.source_name === "HEDC-1", "keeps provenance back to the intake record");

  ok(
    buildCustomerDomainPayload({
      webAccount: "ACC-1", domainName: "x.co.ke",
      sourceDoctype: "Hosting Domain Purchase Request",
    }).kind === "registered",
    "kind is inferred from sourceDoctype when not given explicitly"
  );
  ok(
    buildCustomerDomainPayload({ webAccount: "A", domainName: "x.co.ke", kind: "registered", status: "nonsense" }).status === "pending",
    "an unrecognized status falls back to pending rather than being written through"
  );

  const threw = (fn) => { try { fn(); return false; } catch { return true; } };
  ok(threw(() => buildCustomerDomainPayload({ domainName: "x.co.ke", kind: "registered" })),
     "refuses to build without an owning account");
  ok(threw(() => buildCustomerDomainPayload({ webAccount: "A", kind: "registered" })),
     "refuses to build without a domain name");
  ok(threw(() => buildCustomerDomainPayload({ webAccount: "A", domainName: "x.co.ke" })),
     "refuses to build with no kind and no inferable source");
  ok(threw(() => buildCustomerDomainPayload({ webAccount: "A", domainName: "x.co.ke", kind: "banana" })),
     "refuses an invalid kind instead of silently storing it");

  section("normalizeStatus");
  ok(normalizeStatus("Active") === "active", "case-insensitive");
  ok(normalizeStatus("  pending ") === "pending", "trims");
  ok(normalizeStatus("") === "pending", "empty -> pending");
  ok(normalizeStatus("weird") === "pending", "unknown -> pending");

  section("mapCustomerDomainRow");
  const mapped = mapCustomerDomainRow({
    name: "CD-1", domain_name: "example.co.ke", kind: "registered", status: "active",
    ssl_status: "active", auto_renew: 1, attached_to_service: "biz-web-hosting", creation: "2026-08-15 10:00:00",
  });
  ok(mapped.id === "CD-1" && mapped.domainName === "example.co.ke", "maps identity");
  ok(mapped.autoRenew === true, "coerces the Frappe 0/1 check to a boolean");
  ok(mapped.attachedToService === "biz-web-hosting", "surfaces the attachment");
  ok(mapCustomerDomainRow({ name: "CD-2", attached_to_service: "" }).attachedToService === null,
     "blank attachment maps to null, not empty string");
  ok(mapCustomerDomainRow({ name: "CD-3" }).sslStatus === "none", "missing ssl_status defaults to none");

  section("ensureCustomerDomain — idempotent on (account, name)");
  // Minimal fake client: enough surface for find + create.
  const makeClient = (rows) => ({
    calls: { get: 0, post: 0 },
    async get() { this.calls.get++; return { data: { data: rows.slice(0, 1) } }; },
    async post(_url, body) {
      this.calls.post++;
      const row = { name: "CD-NEW", creation: "2026-08-15 10:00:00", ...body };
      rows.push(row);
      return { data: { data: row } };
    },
  });

  const emptyClient = makeClient([]);
  const first = await ensureCustomerDomain(emptyClient, {
    webAccount: "ACC-1", domainName: "example.co.ke", kind: "registered",
  });
  ok(first.created === true, "creates when the account does not hold the name");
  ok(first.domain.domainName === "example.co.ke", "returns the created domain");
  ok(emptyClient.calls.post === 1, "exactly one write");

  const existingClient = makeClient([
    { name: "CD-9", domain_name: "example.co.ke", kind: "registered", status: "active" },
  ]);
  const second = await ensureCustomerDomain(existingClient, {
    webAccount: "ACC-1", domainName: "  HTTPS://Example.CO.KE/  ", kind: "registered",
  });
  ok(second.created === false, "does NOT create when the account already holds that name");
  ok(second.domain.id === "CD-9", "returns the record it already had");
  ok(existingClient.calls.post === 0, "no write at all — replaying the backfill is safe");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
