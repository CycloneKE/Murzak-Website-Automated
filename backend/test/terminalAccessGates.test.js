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

const { isEnterprisePlan, fetchTerminalGates } = require("../services/terminalEligibility");

console.log("# isEnterprisePlan");
{
  ok(isEnterprisePlan("Enterprise") === true, "exact match -> true");
  ok(isEnterprisePlan("Enterprise Plan") === true, "case/substring tolerant -> true");
  ok(isEnterprisePlan("enterprise") === true, "case-insensitive -> true");
  ok(isEnterprisePlan("Business") === false, "non-enterprise plan -> false");
  ok(isEnterprisePlan(undefined) === false, "undefined plan -> false");
  ok(isEnterprisePlan(null) === false, "null plan -> false");
}

console.log("# fetchTerminalGates");
(async () => {
  const fakeClient = (record) => ({
    get: async (url) => {
      if (!url.includes("Web Account")) throw new Error("unexpected url: " + url);
      return { data: { data: record } };
    },
  });

  const g1 = await fetchTerminalGates(fakeClient({ terminal_access_approved_at: "2026-07-19 10:00:00", terminal_disclosure_accepted_at: "2026-07-19 11:00:00" }), "WA-1");
  ok(g1.approved === true && g1.disclosureAccepted === true, "both timestamps present -> both true");

  const g2 = await fetchTerminalGates(fakeClient({ terminal_access_approved_at: "2026-07-19 10:00:00" }), "WA-2");
  ok(g2.approved === true && g2.disclosureAccepted === false, "only approval stamped -> disclosure false");

  const g3 = await fetchTerminalGates(fakeClient({}), "WA-3");
  ok(g3.approved === false && g3.disclosureAccepted === false, "empty record -> both false, never throws");

  const g4 = await fetchTerminalGates(fakeClient(null), "WA-4");
  ok(g4.approved === false && g4.disclosureAccepted === false, "null record (deleted/missing account) -> both false, never throws");

  console.log(`\n${"=".repeat(48)}`);
  console.log(`TERMINAL ACCESS GATES TESTS: ${passed} passed, ${failed} failed`);
  if (failed) { console.error("Failed."); process.exit(1); }
  console.log("ALL GREEN");
})();
