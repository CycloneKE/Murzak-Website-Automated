/**
 * Stalwart mail order input validation: every field is checked and ALL errors
 * come back keyed by field, so the form can show them together.
 *   node test/mailInput.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { validateMailSetup, RESERVED_LOCAL_PARTS } = require("../services/email/mailInput");

const BASE = Object.freeze({
  planId: "mail-starter",
  businessName: "Acme Ltd",
  domain: "acme.com",
  contactEmail: "owner@gmail.com",
  mailboxes: ["info", "sales"],
});

function withOverrides(overrides) {
  return { ...BASE, ...overrides };
}

/** Validate and report whether the given field key is among the errors. */
function errorKeys(input, opts) {
  const res = validateMailSetup(input, opts);
  return res.ok ? [] : Object.keys(res.errors);
}

(async () => {
  section("happy path returns a normalised value");
  {
    const res = validateMailSetup(
      withOverrides({ businessName: "  Acme Ltd  ", domain: "  Acme.COM ", mailboxes: [" info ", "sales"] }),
      { takenDomains: new Set() },
    );
    ok(res.ok === true, "valid input is accepted");
    ok(res.value?.domain === "acme.com", "domain is returned lowercased and trimmed");
    ok(res.value?.businessName === "Acme Ltd", "business name is returned trimmed");
    ok(Array.isArray(res.value?.mailboxes) && res.value.mailboxes.join(",") === "info,sales", "mailbox names are returned trimmed");
    ok(res.value?.planId === "mail-starter", "plan id is returned");
    ok(res.value?.contactEmail === "owner@gmail.com", "contact email is returned");
  }

  section("local part: strict charset and shape");
  for (const bad of ["Sales", ".sales", "sales.", "a..b", "sàles", "sa_les", "sa les"]) {
    ok(errorKeys(withOverrides({ mailboxes: [bad] })).includes("mailboxes"), `mailbox "${bad}" is rejected`);
  }
  {
    const long = "a".repeat(65);
    ok(errorKeys(withOverrides({ mailboxes: [long] })).includes("mailboxes"), "65-char local part is rejected");
    const max = "a".repeat(64);
    ok(!errorKeys(withOverrides({ mailboxes: [max] })).includes("mailboxes"), "64-char local part is accepted");
    ok(!errorKeys(withOverrides({ mailboxes: ["ops.team-1"] })).includes("mailboxes"), "dots and hyphens inside a name are accepted");
  }

  section("reserved local parts are rejected");
  for (const name of ["admin", "abuse", "noreply", "root", "postmaster"]) {
    ok(RESERVED_LOCAL_PARTS.has(name), `${name} is in RESERVED_LOCAL_PARTS`);
    ok(errorKeys(withOverrides({ mailboxes: [name] })).includes("mailboxes"), `${name} is rejected as a mailbox`);
  }

  section("mailbox cap comes from the plan");
  ok(errorKeys(withOverrides({ planId: "mail-starter", mailboxes: ["a1", "a2", "a3", "a4"] })).includes("mailboxes"), "4 mailboxes on mail-starter (cap 3) is rejected");
  ok(!errorKeys(withOverrides({ planId: "mail-starter", mailboxes: ["a1", "a2", "a3"] })).includes("mailboxes"), "3 mailboxes on mail-starter is accepted");
  ok(!errorKeys(withOverrides({ planId: "mail-pro", mailboxes: Array.from({ length: 30 }, (_, i) => `u${i}`) })).includes("mailboxes"), "30 mailboxes on mail-pro is accepted");
  ok(errorKeys(withOverrides({ mailboxes: [] })).includes("mailboxes"), "zero mailboxes is rejected");
  ok(errorKeys(withOverrides({ mailboxes: undefined })).includes("mailboxes"), "missing mailboxes list is rejected");
  ok(errorKeys(withOverrides({ mailboxes: ["info", "INFO "] })).includes("mailboxes"), "duplicate names are rejected (case-insensitive after trim)");

  section("business name length");
  ok(errorKeys(withOverrides({ businessName: "A" })).includes("businessName"), 'businessName "A" is rejected');
  ok(errorKeys(withOverrides({ businessName: "   " })).includes("businessName"), "blank business name is rejected");
  ok(errorKeys(withOverrides({ businessName: "x".repeat(81) })).includes("businessName"), "81-char business name is rejected");
  ok(!errorKeys(withOverrides({ businessName: "x".repeat(80) })).includes("businessName"), "80-char business name is accepted");

  section("domain");
  ok(errorKeys(withOverrides({ domain: "not a domain" })).includes("domain"), "malformed domain is rejected");
  ok(errorKeys(withOverrides({ domain: "" })).includes("domain"), "empty domain is rejected");
  ok(errorKeys(withOverrides({ domain: "acme.com" }), { takenDomains: new Set(["acme.com"]) }).includes("domain"), "a domain already taken is rejected");
  ok(errorKeys(withOverrides({ domain: "ACME.com" }), { takenDomains: new Set(["acme.com"]) }).includes("domain"), "taken check is case-insensitive");

  section("contact email must not be on the new mail domain");
  ok(errorKeys(withOverrides({ contactEmail: "me@acme.com" })).includes("contactEmail"), "me@acme.com with domain acme.com is rejected");
  ok(errorKeys(withOverrides({ contactEmail: "me@ACME.com" })).includes("contactEmail"), "same-domain check is case-insensitive");
  ok(!errorKeys(withOverrides({ contactEmail: "me@acme.co.ke" })).includes("contactEmail"), "a different domain is accepted");
  ok(errorKeys(withOverrides({ contactEmail: "not-an-email" })).includes("contactEmail"), "a malformed contact email is rejected");

  section("plan id");
  ok(errorKeys(withOverrides({ planId: "starter-email" })).includes("planId"), "legacy starter-email is not a mail plan");
  ok(errorKeys(withOverrides({ planId: "nope" })).includes("planId"), "unknown plan id is rejected");

  section("all errors are collected, not just the first");
  {
    const res = validateMailSetup(
      { planId: "bogus", businessName: "A", domain: "??", contactEmail: "x", mailboxes: ["admin", "Sales"] },
      { takenDomains: new Set() },
    );
    ok(res.ok === false, "bad input is rejected");
    const keys = res.ok ? [] : Object.keys(res.errors).sort();
    ok(keys.join(",") === "businessName,contactEmail,domain,mailboxes,planId", `all five fields report errors (got ${keys.join(",")})`);
  }

  section("the input-level result is always an object with ok");
  {
    const res = validateMailSetup({}, {});
    ok(res.ok === false && typeof res.errors === "object", "empty input returns ok:false with an errors map");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
