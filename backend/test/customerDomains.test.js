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
  canAttachDomain,
  canTransitionDomainStatus,
  domainKindForIntake,
  getOwnedCustomerDomain,
  intakeStatusForDomainStatus,
  summarizeByStatus,
  isValidDomainName,
  mapCustomerDomainRow,
  normalizeDomainName,
  normalizeStatus,
  ensureCustomerDomain,
  resolveFreeSubdomainRoot,
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

  section("canAttachDomain — the authorization boundary for attach");
  const owned = [
    { serviceId: "biz-web-hosting", status: "Active" },
    { serviceId: "starter-app-hosting", status: "Awaiting Payment" },
  ];
  const freeDomain = { id: "CD-1", status: "active", attachedToService: null };

  ok(canAttachDomain({ domain: freeDomain, serviceId: "biz-web-hosting", ownedServices: owned }).ok === true,
     "an owned, active service accepts an unattached domain");
  ok(
    canAttachDomain({ domain: freeDomain, serviceId: "biz-web-hosting", ownedServices: owned }).reason === undefined,
    "a successful verdict carries no reason"
  );

  const notMine = canAttachDomain({ domain: freeDomain, serviceId: "someone-elses-service", ownedServices: owned });
  ok(notMine.ok === false, "a service the account does not own is refused");
  ok(
    /not on your account/.test(notMine.reason),
    "…and the message does not reveal whether that service id exists at all"
  );

  ok(canAttachDomain({ domain: freeDomain, serviceId: "starter-app-hosting", ownedServices: owned }).ok === false,
     "an owned but not-yet-active service is refused");
  ok(canAttachDomain({ domain: freeDomain, serviceId: "", ownedServices: owned }).ok === false,
     "no service id is refused");
  ok(canAttachDomain({ domain: null, serviceId: "biz-web-hosting", ownedServices: owned }).ok === false,
     "a missing domain is refused");
  ok(canAttachDomain({ domain: freeDomain, serviceId: "biz-web-hosting", ownedServices: [] }).ok === false,
     "an account with no services can attach nothing");
  ok(canAttachDomain({ domain: freeDomain, serviceId: "biz-web-hosting", ownedServices: undefined }).ok === false,
     "undefined service list is refused, not crashed on");

  ok(
    canAttachDomain({
      domain: { ...freeDomain, status: "expired" }, serviceId: "biz-web-hosting", ownedServices: owned,
    }).ok === false,
    "an expired domain cannot be attached"
  );
  ok(
    canAttachDomain({
      domain: { ...freeDomain, status: "cancelled" }, serviceId: "biz-web-hosting", ownedServices: owned,
    }).ok === false,
    "a cancelled domain cannot be attached"
  );
  ok(
    canAttachDomain({
      domain: { ...freeDomain, status: "pending" }, serviceId: "biz-web-hosting", ownedServices: owned,
    }).ok === true,
    "a PENDING domain CAN be attached — you point it before it finishes resolving"
  );
  ok(
    canAttachDomain({
      domain: { ...freeDomain, attachedToService: "biz-web-hosting" },
      serviceId: "biz-web-hosting", ownedServices: owned,
    }).ok === false,
    "re-attaching to where it already points is refused as a no-op"
  );
  ok(
    canAttachDomain({
      domain: { ...freeDomain, attachedToService: "other-service" },
      serviceId: "biz-web-hosting", ownedServices: owned,
    }).ok === true,
    "MOVING an already-attached domain to a different owned service is allowed"
  );

  section("getOwnedCustomerDomain — no cross-account reads");
  const docClient = (doc) => ({ async get() { return { data: { data: doc } }; } });
  ok(
    (await getOwnedCustomerDomain(docClient({ name: "CD-1", web_account: "ACC-1", domain_name: "x.co.ke" }), "ACC-1", "CD-1"))?.id === "CD-1",
    "returns the domain to the account that owns it"
  );
  ok(
    (await getOwnedCustomerDomain(docClient({ name: "CD-1", web_account: "ACC-2", domain_name: "x.co.ke" }), "ACC-1", "CD-1")) === null,
    "returns null for another account's domain — an id guess leaks nothing"
  );
  ok(
    (await getOwnedCustomerDomain(docClient(null), "ACC-1", "CD-1")) === null,
    "returns null when the doc does not exist"
  );
  ok(
    (await getOwnedCustomerDomain(docClient({}), "ACC-1", "")) === null,
    "returns null for an empty id without hitting Frappe"
  );
  const notFoundClient = { async get() { const e = new Error("Not Found"); e.response = { status: 404 }; throw e; } };
  ok(
    (await getOwnedCustomerDomain(notFoundClient, "ACC-1", "GUESSED-ID")) === null,
    "a Frappe 404 is 'not found', not an error — letting it propagate turned a guessed id into a 500"
  );
  const brokenClient = { async get() { const e = new Error("boom"); e.response = { status: 500 }; throw e; } };
  let propagated = false;
  try { await getOwnedCustomerDomain(brokenClient, "ACC-1", "CD-1"); } catch { propagated = true; }
  ok(propagated, "a real Frappe fault still propagates — only 404 is swallowed");

  section("canTransitionDomainStatus — the fulfilment state machine");
  const can = (f, t) => canTransitionDomainStatus(f, t).ok;
  ok(can("pending", "active"), "pending -> active (the fulfilment decision)");
  ok(can("pending", "failed"), "pending -> failed");
  ok(can("pending", "cancelled"), "pending -> cancelled");
  ok(can("failed", "pending"), "failed -> pending (retry after fixing something)");
  ok(can("failed", "active"), "failed -> active");
  ok(can("active", "expired"), "active -> expired");
  ok(can("active", "cancelled"), "active -> cancelled");
  ok(can("expired", "active"), "expired -> active (renewed)");
  ok(!can("active", "pending"), "active -> pending is refused: fulfilment does not un-happen");
  ok(!can("active", "failed"), "active -> failed is refused: it already worked");
  ok(!can("cancelled", "active"), "cancelled is terminal");
  ok(!can("cancelled", "pending"), "…in every direction");
  ok(!can("pending", "pending"), "a no-op transition is refused rather than writing nothing");
  ok(!can("pending", "banana"), "an unknown target status is refused");
  ok(!can("pending", ""), "an empty target status is refused");
  ok(
    /final/.test(canTransitionDomainStatus("cancelled", "active").reason),
    "a terminal state explains itself"
  );
  ok(
    /can only become/.test(canTransitionDomainStatus("active", "pending").reason),
    "a refused transition names what IS allowed"
  );
  ok(can("PENDING", "Active"), "case-insensitive on both sides");

  section("intakeStatusForDomainStatus — each intake has its OWN vocabulary");
  const PR = "Hosting Domain Purchase Request";
  const EX = "Hosting External Domain Connection";
  const MS = "Hosting Murzak Subdomain";
  // Verified against the live doctypes:
  //   PR: pending|quoted|awaiting_payment|purchased|connected|rejected
  //   EX: pending|awaiting_dns_update|verifying|connected|failed
  //   MS: pending|active|rejected|suspended
  ok(intakeStatusForDomainStatus("active", PR) === "connected", "a purchase request goes to 'connected', NOT 'active'");
  ok(intakeStatusForDomainStatus("active", EX) === "connected", "an external connection goes to 'connected'");
  ok(intakeStatusForDomainStatus("active", MS) === "active", "a subdomain really does use 'active'");
  ok(intakeStatusForDomainStatus("failed", PR) === "rejected", "a purchase request has no 'failed' — it is 'rejected'");
  ok(intakeStatusForDomainStatus("failed", EX) === "failed", "an external connection does have 'failed'");
  ok(intakeStatusForDomainStatus("failed", MS) === "rejected", "a subdomain has no 'failed' — it is 'rejected'");
  ok(intakeStatusForDomainStatus("cancelled", PR) === "rejected", "no intake has 'cancelled'; it maps to the nearest real value");
  ok(intakeStatusForDomainStatus("pending", PR) === "pending", "pending is the one word they all share");
  ok(
    intakeStatusForDomainStatus("expired", PR) === null,
    "expired does NOT sync — no intake vocabulary expresses it, and writing it would put a value in the Select that it cannot display"
  );
  ok(
    intakeStatusForDomainStatus("active", "Some Other Doctype") === null,
    "an unknown source doctype syncs nothing rather than guessing"
  );
  ok(
    intakeStatusForDomainStatus("active", undefined) === null,
    "a missing source doctype syncs nothing"
  );
  for (const [dt, map] of Object.entries(require("../services/customerDomains").INTAKE_STATUS_MAPS)) {
    ok(
      Object.values(map).every((v) => typeof v === "string" && v.length > 0),
      `${dt}: every mapped value is a real status string`
    );
  }

  section("domainStatusForIntakeStatus — reading an intake's own word back");
  const dsi = require("../services/customerDomains").domainStatusForIntakeStatus;
  ok(dsi("connected", PR) === "active", "a connected purchase request IS a live domain");
  ok(dsi("connected", EX) === "active", "so is a connected external domain");
  ok(dsi("active", MS) === "active", "an active subdomain is live");
  ok(
    dsi("purchased", PR) === "pending",
    "'purchased' stays pending — we own the name but have not pointed it anywhere, so there is still work to do"
  );
  ok(dsi("quoted", PR) === "pending", "quoted is pending");
  ok(dsi("awaiting_payment", PR) === "pending", "awaiting_payment is pending");
  ok(dsi("awaiting_dns_update", EX) === "pending", "awaiting DNS is pending");
  ok(dsi("verifying", EX) === "pending", "verifying is pending");
  ok(dsi("rejected", PR) === "failed", "rejected is failed");
  ok(dsi("failed", EX) === "failed", "failed is failed");
  ok(
    dsi("suspended", MS) === "pending",
    "suspended is a temporary hold, not a failure — pending keeps it visible"
  );
  ok(dsi("something-new", PR) === "pending", "an unrecognized intake status surfaces as pending, never hidden");
  ok(dsi("connected", "Unknown Doctype") === "pending", "an unknown doctype defaults to pending");
  ok(dsi(undefined, PR) === "pending", "a missing status defaults to pending");
  ok(
    dsi("connected", PR) === "active" && intakeStatusForDomainStatus("active", PR) === "connected",
    "the two directions agree on the one mapping that matters most (connected <-> active)"
  );

  section("summarizeByStatus");
  const summary = summarizeByStatus([
    { status: "pending" }, { status: "pending" }, { status: "active" }, { status: "weird" },
  ]);
  ok(summary.active === 1, "counts active");
  ok(summary.cancelled === 0, "reports zero for statuses with no rows rather than omitting them");
  ok(
    summary.pending === 3,
    "an unrecognized status folds into pending (2 real + 1 junk) — an unreadable row " +
      "inflates the work queue rather than vanishing from it, which is the safe direction"
  );
  ok(Object.keys(summary).length === 5, "no bucket is invented for the junk status");
  ok(summarizeByStatus([]).pending === 0, "empty list");
  ok(summarizeByStatus(undefined).pending === 0, "undefined list does not throw");

  section("resolveFreeSubdomainRoot — never guess a customer-facing hostname in production");
  ok(
    resolveFreeSubdomainRoot({ envValue: "murzaktech.tech", nodeEnv: "production" }).ok === true,
    "an explicitly configured root is used in production"
  );
  ok(
    resolveFreeSubdomainRoot({ envValue: "murzaktech.tech", nodeEnv: "production" }).root === "murzaktech.tech",
    "…and returned as-is"
  );
  ok(
    resolveFreeSubdomainRoot({ envValue: "  Murzaktech.TECH  ", nodeEnv: "production" }).root === "murzaktech.tech",
    "trimmed and lowercased"
  );
  {
    const r = resolveFreeSubdomainRoot({ envValue: "", nodeEnv: "production" });
    ok(r.ok === false, "unset in production is refused, not guessed");
    ok(/FREE_SUBDOMAIN_ROOT_DOMAIN/.test(r.reason), "the refusal names the env var to set");
  }
  ok(
    resolveFreeSubdomainRoot({ envValue: undefined, nodeEnv: "production" }).ok === false,
    "undefined in production is refused the same as empty"
  );
  ok(
    resolveFreeSubdomainRoot({ envValue: "", nodeEnv: "development" }).ok === true,
    "unset OUTSIDE production still returns something usable, so local dev isn't blocked"
  );
  ok(
    resolveFreeSubdomainRoot({ envValue: "", nodeEnv: "development" }).root !== "murzaktech.com",
    "…and it is NOT the dead domain this used to be hardcoded to"
  );
  ok(
    resolveFreeSubdomainRoot({}).ok === true,
    "called with no args at all still returns something (defensive — never throws)"
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFAILURES:", fails);
    process.exit(1);
  }
})();
