/**
 * Mailbox self-service — entitlement arithmetic and access policy.
 *
 * The security-critical case is mailboxBelongsTo: Hostinger's password-change
 * and delete endpoints take a bare mailbox id with NO order scoping, so without
 * this check any customer could pass another customer's id and take over their
 * email. Pure functions, no Express harness (this codebase has none — see
 * storageFilesRoutes.test.js).
 *   node test/mailboxSelfService.test.js   (or: npm test)
 */
let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const ent = require("../services/mailboxEntitlement");
const policy = require("../services/mailboxPolicy");
const { getServiceMeta } = require("../services/provisioning/catalog");

section("mailboxBelongsTo — the cross-tenant guard");
{
  const mine = [{ id: "mb_1" }, { id: "mb_2" }];
  ok(policy.mailboxBelongsTo(mine, "mb_1") === true, "accepts a mailbox on my order");
  ok(policy.mailboxBelongsTo(mine, "mb_9") === false, "REFUSES another tenant's mailbox id");
  ok(policy.mailboxBelongsTo(mine, "") === false, "refuses an empty id");
  ok(policy.mailboxBelongsTo(mine, null) === false, "refuses null");
  ok(policy.mailboxBelongsTo(mine, undefined) === false, "refuses undefined");
  ok(policy.mailboxBelongsTo([], "mb_1") === false, "refuses when the order has no mailboxes");
  ok(policy.mailboxBelongsTo(null, "mb_1") === false, "refuses when the list isn't an array");
  // Hostinger returns ids as numbers in some payloads, strings in others.
  ok(policy.mailboxBelongsTo([{ id: 42 }], "42") === true, "numeric id matches its string form (legit owner not locked out)");
  ok(policy.mailboxBelongsTo([{ resource_id: "r1" }], "r1") === true, "resource_id is honoured too");
  ok(policy.mailboxBelongsTo([{ id: 42 }], " 42 ") === true, "tolerates surrounding whitespace");
  // Guard against loose equality bugs.
  ok(policy.mailboxBelongsTo([{ id: 0 }], "") === false, "id 0 does not match an empty string");
  ok(policy.mailboxBelongsTo([{ id: null }], "null") === false, "a null id never matches the text 'null'");
  ok(policy.mailboxBelongsTo([{}], "undefined") === false, "a missing id never matches the text 'undefined'");
}

section("isValidLocalPart");
{
  for (const good of ["info", "jane.doe", "a", "sales-team", "x_y", "a1"]) {
    ok(policy.isValidLocalPart(good) === true, `accepts ${JSON.stringify(good)}`);
  }
  for (const bad of ["", " ", ".lead", "trail.", "-lead", "trail-", "has space", "UPPER!", "a@b", "a".repeat(65)]) {
    ok(policy.isValidLocalPart(bad) === false, `rejects ${JSON.stringify(bad)}`);
  }
  ok(policy.isValidLocalPart("INFO") === true, "uppercase is normalized, not rejected");
}

section("validatePassword");
{
  ok(policy.validatePassword("Str0ngPass") === null, "accepts a strong password");
  ok(/8 characters/.test(policy.validatePassword("Ab1")), "rejects too short");
  ok(/128/.test(policy.validatePassword("Ab1" + "x".repeat(200))), "rejects too long");
  ok(/uppercase/.test(policy.validatePassword("alllower1")), "requires an uppercase letter");
  ok(/uppercase/.test(policy.validatePassword("ALLUPPER1")), "requires a lowercase letter");
  ok(/uppercase/.test(policy.validatePassword("NoDigitsHere")), "requires a number");
  ok(policy.validatePassword(null) !== null, "rejects null");
  ok(policy.validatePassword(undefined) !== null, "rejects undefined");
}

section("localPartExists");
{
  const rows = [{ local_part: "info" }, { local_part: "Sales" }];
  ok(policy.localPartExists(rows, "info") === true, "finds an exact match");
  ok(policy.localPartExists(rows, "sales") === true, "case-insensitive");
  ok(policy.localPartExists(rows, "other") === false, "absent local part");
  ok(policy.localPartExists([], "info") === false, "empty list");
}

section("publicMailbox — allow-listed, no provider internals leak");
{
  const out = policy.publicMailbox({
    id: 7, local_part: "info", email: "info@acme.co.ke",
    used_bytes: 10, quota_bytes: 100,
    internal_secret: "nope", provider_note: "hostinger-internal",
  });
  ok(out.id === "7", "id stringified");
  ok(out.address === "info@acme.co.ke", "address mapped");
  ok(out.usedBytes === 10 && out.quotaBytes === 100, "usage mapped");
  ok(!("internal_secret" in out) && !("provider_note" in out), "unknown provider fields are dropped");
  ok(Object.keys(out).length === 5, "exactly the five public fields");
  const empty = policy.publicMailbox(null);
  ok(empty.id === "" && empty.usedBytes === 0, "null input degrades to empty, doesn't throw");
}

section("entitlementFor — only what they actually paid for counts");
{
  const e0 = ent.entitlementFor([], getServiceMeta);
  ok(e0.limit === 0 && e0.unlimited === false, "no services -> zero allowance");

  const e1 = ent.entitlementFor([{ serviceId: "starter-email", status: "Active" }], getServiceMeta);
  ok(e1.limit === 5 && !e1.unlimited, "starter-email grants 5");

  const e2 = ent.entitlementFor([
    { serviceId: "starter-email", status: "Active" },
    { serviceId: "addon-mailboxes-5", status: "Active" },
  ], getServiceMeta);
  ok(e2.limit === 10, "addon adds 5 (customer gets what they bought)");

  const e3 = ent.entitlementFor([
    { serviceId: "starter-email", status: "Active" },
    { serviceId: "addon-mailboxes-5", status: "Active" },
    { serviceId: "addon-mailboxes-5", status: "Active" },
  ], getServiceMeta);
  ok(e3.limit === 15, "two addons stack");

  const unpaid = ent.entitlementFor([
    { serviceId: "starter-email", status: "Active" },
    { serviceId: "addon-mailboxes-5", status: "Awaiting Payment" },
  ], getServiceMeta);
  ok(unpaid.limit === 5, "an unpaid addon grants nothing (revenue leak guard)");

  const biz = ent.entitlementFor([{ serviceId: "biz-email", status: "Active" }], getServiceMeta);
  ok(biz.unlimited === true, "biz-email is sold unlimited");

  const noise = ent.entitlementFor([
    { serviceId: "starter-web-hosting", status: "Active" },
    { serviceId: "addon-bulk-email", status: "Active" },
    { serviceId: "", status: "Active" },
    null,
  ], getServiceMeta);
  ok(noise.limit === 0 && !noise.unlimited, "non-mailbox products (incl. bulk-email) grant nothing");

  ok(ent.entitlementFor([{ service_id: "starter-email", status: "active" }], getServiceMeta).limit === 5,
    "accepts snake_case rows and lowercase status");
}

section("effectiveLimit — the LOWER of what they bought and what the plan supports");
{
  const capped = ent.effectiveLimit({ entitlement: { limit: 10, unlimited: false }, planLimit: 5 });
  ok(capped.limit === 5 && capped.source === "hostinger", "plan cap wins when it's lower");

  const ours = ent.effectiveLimit({ entitlement: { limit: 5, unlimited: false }, planLimit: 50 });
  ok(ours.limit === 5 && ours.source === "murzak", "our entitlement wins when it's lower (revenue leak guard)");

  const unlim = ent.effectiveLimit({ entitlement: { limit: 0, unlimited: true }, planLimit: 25 });
  ok(unlim.limit === 25 && unlim.unlimited === false && unlim.source === "hostinger",
    "'unlimited' is reported as the plan's real ceiling, not infinity");

  const unknownPlan = ent.effectiveLimit({ entitlement: { limit: 5, unlimited: false }, planLimit: null });
  ok(unknownPlan.limit === 5 && unknownPlan.source === "murzak", "unknown plan limit falls back to our entitlement");

  const bothUnknown = ent.effectiveLimit({ entitlement: { limit: 0, unlimited: true }, planLimit: null });
  ok(bothUnknown.limit === null && bothUnknown.unlimited === true && bothUnknown.source === "unknown",
    "unlimited + unreadable plan reports unknown rather than inventing a number");

  ok(ent.effectiveLimit({ entitlement: { limit: 5, unlimited: false }, planLimit: 0 }).limit === 5,
    "a zero plan limit is treated as unknown, not as a hard zero");
}

section("canCreate");
{
  ok(ent.canCreate({ used: 2, effective: { limit: 5, unlimited: false } }).ok === true, "under the limit");
  ok(ent.canCreate({ used: 5, effective: { limit: 5, unlimited: false } }).ok === false, "at the limit refuses");
  ok(ent.canCreate({ used: 9, effective: { limit: 5, unlimited: false } }).ok === false, "over the limit refuses");
  ok(ent.canCreate({ used: 999, effective: { unlimited: true } }).ok === true, "unlimited always allows");
  ok(ent.canCreate({ used: 3, effective: { limit: null, unlimited: false } }).ok === true,
    "unknown ceiling allows — never lock a paying customer out of a mailbox they may be owed");

  const murzakMsg = ent.canCreate({ used: 5, effective: { limit: 5, unlimited: false, source: "murzak" } }).reason;
  ok(/\+5 Business Mailboxes/.test(murzakMsg), "our-limit message upsells the addon");
  const planMsg = ent.canCreate({ used: 5, effective: { limit: 5, unlimited: false, source: "hostinger" } }).reason;
  ok(!/\+5 Business Mailboxes/.test(planMsg) && /plan supports/.test(planMsg),
    "plan-limit message doesn't upsell an addon that wouldn't help");
}

section("catalog: machine-readable allowances exist for the portal to enforce");
{
  ok(getServiceMeta("starter-email").mailboxes === 5, "starter-email declares 5");
  ok(getServiceMeta("addon-mailboxes-5").mailboxes === 5, "addon declares 5");
  ok(getServiceMeta("biz-email").mailboxes === 0, "biz-email declares 0 (=no Murzak cap)");
  ok(getServiceMeta("addon-bulk-email").mailboxes === undefined, "bulk-email declares none (not mailbox hosting)");
  ok(getServiceMeta("starter-web-hosting").mailboxes === undefined, "non-email products unaffected");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("ALL GREEN");
