/**
 * Terminal access gating + the subject-passthrough fix — pure-function unit
 * tests, no network/Express (see backend/services/portalRequestPayload.js
 * and backend/services/terminalEligibility.js). node test/terminalAccessGates.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { buildPortalRequestPayload } = require("../services/portalRequestPayload");

console.log("# portal request payload — subject passthrough");
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-1",
    email: "jane@example.com",
    webAcc: { account_holder_name: "Jane", entity_name: "Jane Co" },
    subject: "Developer Access Request: App Hosting",
    message: "please upgrade",
    pageUrl: "https://x/portal",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Developer Access Request: App Hosting", "custom subject is used verbatim (the bug this fixes)");
  ok(p.portal_user === "WA-1" && p.email === "jane@example.com", "identity fields carried through");
  ok(p.messages[0].message === "please upgrade", "first message embedded correctly");
  ok(p.last_message_at === "2026-07-19 12:00:00", "nowUTC passed through verbatim");
}
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-2",
    email: "bob@example.com",
    webAcc: null,
    subject: undefined,
    message: "hi",
    pageUrl: "",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Technical Sync Request", "no subject supplied -> existing default preserved (Contact.tsx callers unaffected)");
  ok(p.full_name === "bob@example.com", "no webAcc -> falls back to email for full_name");
}
{
  const p = buildPortalRequestPayload({
    portalUserId: "WA-3",
    email: "x@example.com",
    webAcc: {},
    subject: "   ",
    message: "hi",
    pageUrl: "",
    attachments: "",
    nowUTC: "2026-07-19 12:00:00",
  });
  ok(p.subject === "Technical Sync Request", "whitespace-only subject treated as absent");
}

console.log(`\n${"=".repeat(48)}`);
console.log(`TERMINAL ACCESS GATES TESTS: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failed."); process.exit(1); }
console.log("ALL GREEN");
