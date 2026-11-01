/**
 * Magic-link tokens and emailed confirmation codes for Stalwart mail.
 *   node test/mailAccess.test.js   (or: npm test)
 *
 * Pins: HMAC token round trip, tamper/expiry/missing-secret refusal, the code
 * flow stores only a hash, 60 s issue gap, 5 attempts then invalidation,
 * single use, 10 minute life, and that the code is never stored.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

process.env.MAIL_LINK_SECRET = "access-test-secret";
process.env.APP_BASE_URL = "https://portal.example.com/";

const { makeMockFrappe } = require("./helpers/mockFrappe");
const access = require("../services/email/mailAccess");

const T0 = Date.parse("2026-11-01T08:00:00Z");
const DAY = 24 * 3600 * 1000;

function seed(extra = {}) {
  return makeMockFrappe({
    "Checkout Order": {
      "CHK-1": {
        name: "CHK-1",
        status: "Paid",
        config_json: JSON.stringify({
          mailSetup: { state: "live", domain: "acme.com", contactEmail: "owner@gmail.com", businessName: "Acme Ltd", ...extra },
        }),
      },
    },
  });
}
const setupOf = (client) => JSON.parse(client.store["Checkout Order"]["CHK-1"].config_json).mailSetup;

async function thrown(fn) { try { await fn(); return null; } catch (e) { return e; } }

(async () => {
  section("tokens");
  {
    const t = access.signOrderToken("CHK-1", T0);
    ok(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t), "token is url-safe");
    const v = access.verifyOrderToken(t, T0 + DAY);
    ok(v.ok && v.orderName === "CHK-1", "valid token verifies to the order name");
    ok(access.verifyOrderToken(t, T0 + 29 * DAY).ok, "still valid after 29 days");
    ok(access.verifyOrderToken(t, T0 + 30 * DAY).ok === false, "expired after 30 days");
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "CHK-2", e: T0 + 30 * DAY })).toString("base64url");
    ok(access.verifyOrderToken(`${forged}.${s}`, T0).ok === false, "payload swapped for another order is refused");
    ok(access.verifyOrderToken(`${p}.${s.slice(0, -2)}AA`, T0).ok === false, "tampered signature is refused");
    ok(access.verifyOrderToken(`${p}.`, T0).ok === false, "empty signature is refused");
    for (const bad of ["", "abc", null, undefined, 42, {}, "a.b.c", "x".repeat(5000)]) {
      ok(access.verifyOrderToken(bad, T0).ok === false, `garbage token ${JSON.stringify(String(bad).slice(0, 12))} is refused without throwing`);
    }
    const other = process.env.MAIL_LINK_SECRET;
    process.env.MAIL_LINK_SECRET = "different";
    ok(access.verifyOrderToken(t, T0).ok === false, "token signed with another secret is refused");
    delete process.env.MAIL_LINK_SECRET;
    ok((await thrown(() => access.signOrderToken("CHK-1"))) !== null, "signing without a secret throws");
    ok(access.verifyOrderToken(t, T0).ok === false, "verifying without a secret returns ok:false");
    process.env.MAIL_LINK_SECRET = other;
  }

  section("statusUrlFor");
  {
    const url = access.statusUrlFor("CHK-1");
    ok(url.startsWith("https://portal.example.com/mail/status/") && !url.includes("//mail"), "APP_BASE_URL/mail/status/<token>, no doubled slash");
    const tok = url.split("/mail/status/")[1];
    ok(access.verifyOrderToken(tok).orderName === "CHK-1", "the token in the URL verifies");
  }

  section("issueCode stores only a hash and emails the code");
  {
    const client = seed();
    const sent = [];
    let clock = T0;
    const deps = { now: () => clock, sendCodeEmail: async (a) => { sent.push(a); } };
    await access.issueCode(client, "CHK-1", deps);
    ok(sent.length === 1 && /^\d{6}$/.test(sent[0].code), "a 6-digit code is emailed");
    ok(sent[0].to === "owner@gmail.com", "to the contact email");
    ok(!JSON.stringify(setupOf(client)).includes(`"${sent[0].code}"`), "the code is not stored as a value");
    const ch = setupOf(client).codeChallenge;
    ok(typeof ch.hash === "string" && ch.hash.length >= 32 && ch.attempts === 0, "a hash and an attempt counter are stored");
    ok(ch.hash !== sent[0].code && !ch.hash.includes(sent[0].code), "the hash is not the code");
    ok(ch.expiresAt === T0 + 10 * 60 * 1000, "expires in 10 minutes");

    const e = await thrown(() => access.issueCode(client, "CHK-1", deps));
    ok(e && e.code === "code_rate_limited" && e.statusCode === 429, "a second issue within 60 s is rate limited");
    ok(sent.length === 1, "and sends nothing");
    clock = T0 + 61 * 1000;
    await access.issueCode(client, "CHK-1", deps);
    ok(sent.length === 2, "after 60 s a new code can be issued");
    ok(sent[0].code === sent[1].code || (await access.verifyCode(client, "CHK-1", sent[0].code, deps)) === false, "the older code no longer works");
  }

  section("verifyCode: single use, attempts, expiry");
  {
    const client = seed();
    const sent = [];
    let clock = T0;
    const deps = { now: () => clock, sendCodeEmail: async (a) => { sent.push(a); } };
    await access.issueCode(client, "CHK-1", deps);
    const code = sent[0].code;
    const wrong = code === "000000" ? "111111" : "000000";
    ok(await access.verifyCode(client, "CHK-1", wrong, deps) === false, "wrong code is refused");
    ok(setupOf(client).codeChallenge.attempts === 1, "the attempt is counted");
    ok(await access.verifyCode(client, "CHK-1", code, deps) === true, "right code is accepted");
    ok(setupOf(client).codeChallenge == null, "the challenge is cleared on success");
    ok(await access.verifyCode(client, "CHK-1", code, deps) === false, "the same code cannot be used twice");

    clock = T0 + 120 * 1000;
    await access.issueCode(client, "CHK-1", deps);
    const code2 = sent[1].code;
    const wrong2 = code2 === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await access.verifyCode(client, "CHK-1", wrong2, deps);
    ok(setupOf(client).codeChallenge == null, "5 wrong attempts invalidate the challenge");
    ok(await access.verifyCode(client, "CHK-1", code2, deps) === false, "the correct code no longer works after 5 failures");

    clock = T0 + 300 * 1000;
    await access.issueCode(client, "CHK-1", deps);
    ok(await access.verifyCode(client, "CHK-1", sent[2].code, { ...deps, now: () => clock + 11 * 60 * 1000 }) === false, "an expired code is refused");

    for (const bad of [undefined, null, "", "12345", "1234567", "abcdef", {}, [], 123456.5]) {
      ok(await access.verifyCode(client, "CHK-1", bad, deps) === false, `malformed code ${JSON.stringify(bad)} is refused without throwing`);
    }
    ok(await access.verifyCode(seed(), "CHK-1", "123456", deps) === false, "no challenge at all is refused");
    ok(await access.verifyCode(client, "CHK-404", "123456", deps) === false, "unknown order is refused");
  }

  section("concurrent use of one code succeeds once");
  {
    const client = seed();
    const sent = [];
    const deps = { now: () => T0, sendCodeEmail: async (a) => { sent.push(a); } };
    await access.issueCode(client, "CHK-1", deps);
    const results = await Promise.all([1, 2, 3].map(() => access.verifyCode(client, "CHK-1", sent[0].code, deps)));
    ok(results.filter(Boolean).length === 1, "exactly one of three parallel uses wins");
  }

  section("email failure and missing sender");
  {
    const client = seed();
    const e = await thrown(() => access.issueCode(client, "CHK-1", { now: () => T0, sendCodeEmail: async () => { throw new Error("smtp down"); } }));
    ok(e && e.message === "smtp down", "a send failure is reported");
    ok(setupOf(client).codeChallenge == null && !setupOf(client).codeIssuedAt, "nothing is left behind, so the customer can retry at once");
    const sent = [];
    await access.issueCode(client, "CHK-1", { now: () => T0, sendCodeEmail: async (a) => { sent.push(a); } });
    ok(sent.length === 1, "and the retry sends");

    const warns = [];
    const realWarn = console.warn;
    console.warn = (m) => warns.push(String(m));
    let threw = null;
    try { await access.issueCode(seed(), "CHK-1", { now: () => T0 }); } catch (err) { threw = err; }
    console.warn = realWarn;
    ok(threw === null, "the default sender (no sendMailCodeEmail yet) resolves");
    ok(warns.some((w) => /sendMailCodeEmail/.test(w)), "and warns that it is not configured");
    const nosetup = await thrown(() => access.issueCode(makeMockFrappe({ "Checkout Order": { "CHK-1": { name: "CHK-1", config_json: "{}" } } }), "CHK-1", { now: () => T0, sendCodeEmail: async () => {} }));
    ok(nosetup && nosetup.statusCode === 404, "an order with no mail setup is refused");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
