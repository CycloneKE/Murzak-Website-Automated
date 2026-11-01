/**
 * Mail provider facade: routes mailbox operations to Stalwart or Hostinger.
 *
 * The security-critical cases: a Stalwart job only ever sees and changes
 * accounts on its own domain (a foreign account id is refused), the postmaster@
 * account is system-owned and hidden and refused, and creating past the plan's
 * mailbox limit is refused. Hostinger jobs keep their existing behavior.
 *   node test/mailProvider.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

process.env.STALWART_MOCK = "1";
delete process.env.STALWART_URL;
delete process.env.STALWART_API_KEY;

const facade = require("../services/email/mailProvider");
const stalwart = require("../services/email/stalwartClient");
const hostingerMail = require("../services/hostingerMail");
const mailboxEntitlement = require("../services/mailboxEntitlement");
const { PLANS } = require("../config/emailPlans");

// Expected-throw helper: resolves to the thrown error, or null if nothing threw.
async function thrownBy(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

const GB = 1024 ** 3;

(async () => {
  section("providerFor: stalwart for mail plans or access.provider, hostinger otherwise");
  {
    ok(facade.providerFor({ service_id: "mail-starter" }) === "stalwart", "a mail-* plan job is stalwart");
    ok(facade.providerFor({ service_id: "mail-pro" }) === "stalwart", "mail-pro job is stalwart");
    ok(facade.providerFor({ service_id: "starter-email", access: '{"provider":"stalwart"}' }) === "stalwart",
      "access JSON string with provider stalwart is stalwart");
    ok(facade.providerFor({ service_id: "starter-email", access: { provider: "stalwart" } }) === "stalwart",
      "access object with provider stalwart is stalwart");
    ok(facade.providerFor({ service_id: "starter-email", access: '{"provider":"hostinger"}' }) === "hostinger",
      "explicit hostinger access is hostinger");
    ok(facade.providerFor({ service_id: "starter-email" }) === "hostinger", "legacy email job with no access is hostinger");
    ok(facade.providerFor({ service_id: "starter-email", access: "{not json" }) === "hostinger", "malformed access JSON falls back to hostinger");
    ok(facade.providerFor(null) === "hostinger", "no job falls back to hostinger");
  }

  section("hostinger jobs keep calling hostingerMail with the order id, unchanged");
  {
    const calls = [];
    const realList = hostingerMail.listMailboxes;
    const realCreate = hostingerMail.createMailbox;
    const realPw = hostingerMail.changeMailboxPassword;
    const realDel = hostingerMail.deleteMailbox;
    hostingerMail.listMailboxes = async (orderId) => {
      calls.push(["list", orderId]);
      return [{ id: 7, local_part: "info", email: "info@acme.co.ke", used_bytes: 1, quota_bytes: 2, secret: "x" }];
    };
    hostingerMail.createMailbox = async (orderId, body) => { calls.push(["create", orderId, body.localPart, body.password]); return { id: 8, local_part: "sales" }; };
    hostingerMail.changeMailboxPassword = async (id, pw) => { calls.push(["pw", id, pw]); return {}; };
    hostingerMail.deleteMailbox = async (id) => { calls.push(["del", id]); return {}; };
    try {
      const ctx = { orderId: "98765", job: { service_id: "starter-email" }, serviceId: "starter-email" };
      const list = await facade.listMailboxes(ctx);
      ok(calls[0][0] === "list" && calls[0][1] === "98765", "hostinger list uses the order id from the context");
      ok(list.length === 1 && list[0].id === "7" && list[0].address === "info@acme.co.ke" && list[0].localPart === "info",
        "hostinger list returns publicMailbox-shaped rows");
      ok(Object.keys(list[0]).length === 5 && !("secret" in list[0]), "hostinger rows are allow-listed (no provider fields)");
      const created = await facade.createMailbox(ctx, { localPart: "sales", password: "Passw0rdX" });
      ok(calls[1][0] === "create" && calls[1][1] === "98765" && calls[1][2] === "sales", "hostinger create passes order id and local part");
      ok(created.id === "8" && created.localPart === "sales", "hostinger create returns a publicMailbox-shaped row");
      await facade.changePassword(ctx, "7", "Passw0rdY");
      ok(calls[2][0] === "pw" && calls[2][1] === "7", "hostinger changePassword forwards the mailbox id");
      await facade.deleteMailbox(ctx, "7");
      ok(calls[3][0] === "del" && calls[3][1] === "7", "hostinger deleteMailbox forwards the mailbox id");
    } finally {
      hostingerMail.listMailboxes = realList;
      hostingerMail.createMailbox = realCreate;
      hostingerMail.changeMailboxPassword = realPw;
      hostingerMail.deleteMailbox = realDel;
    }
  }

  // Seed a two-domain Stalwart mock: acme (ours) and other (another tenant).
  stalwart.__resetMockForTests();
  const acme = await stalwart.ensureDomain({ name: "acme.co.ke", description: "acme", dnsServerId: "srv-1" });
  const other = await stalwart.ensureDomain({ name: "other.co.ke", description: "other", dnsServerId: "srv-1" });
  const info = await stalwart.ensureAccount({ domainId: acme.id, localPart: "info", quotaBytes: 5 * GB });
  await stalwart.ensureAccount({ domainId: acme.id, localPart: "postmaster", quotaBytes: 1 * GB });
  const foreign = await stalwart.ensureAccount({ domainId: other.id, localPart: "sales", quotaBytes: 5 * GB });
  const stalwartJob = { name: "JOB-1", service_id: "mail-starter", external_ref: "acme.co.ke", access: "{}" };
  const stalwartCtx = { orderId: "acme.co.ke", job: stalwartJob, serviceId: "mail-starter", provider: "stalwart" };

  // Hostinger must never be touched on a Stalwart job.
  const noHostinger = async () => { throw new Error("hostingerMail must not be called for a stalwart job"); };
  const savedHost = { list: hostingerMail.listMailboxes, create: hostingerMail.createMailbox, pw: hostingerMail.changeMailboxPassword, del: hostingerMail.deleteMailbox };
  hostingerMail.listMailboxes = noHostinger;
  hostingerMail.createMailbox = noHostinger;
  hostingerMail.changeMailboxPassword = noHostinger;
  hostingerMail.deleteMailbox = noHostinger;

  section("stalwart list: only this domain, postmaster hidden, public shape");
  {
    const list = await facade.listMailboxes(stalwartCtx);
    ok(list.length === 1 && list[0].localPart === "info", "lists only the info account on acme (postmaster hidden)");
    ok(!list.some((m) => m.id === foreign.id), "another tenant's account is never returned");
    ok(list[0].address === "info@acme.co.ke", "address is the full mailbox address");
    ok(list[0].quotaBytes === 5 * GB && list[0].usedBytes === 0, "quota is reported, usage defaults to 0");
    ok(Object.keys(list[0]).sort().join(",") === "address,id,localPart,quotaBytes,usedBytes", "stalwart rows match the publicMailbox shape exactly");
    ok(typeof list[0].id === "string", "id is a string");
  }

  section("stalwart changePassword / deleteMailbox refuse foreign and postmaster ids");
  {
    const e1 = await thrownBy(() => facade.changePassword(stalwartCtx, foreign.id, "Passw0rdX"));
    ok(e1 instanceof Error, "changePassword with another domain's account id is REFUSED");
    const pm = (await stalwart.listAccounts(acme.id)).find((a) => a.address === "postmaster@acme.co.ke");
    const e2 = await thrownBy(() => facade.changePassword(stalwartCtx, pm.id, "Passw0rdX"));
    ok(e2 instanceof Error, "changePassword on postmaster@ is REFUSED");
    const e3 = await thrownBy(() => facade.deleteMailbox(stalwartCtx, foreign.id));
    ok(e3 instanceof Error, "deleteMailbox with another domain's account id is REFUSED");
    const e4 = await thrownBy(() => facade.deleteMailbox(stalwartCtx, pm.id));
    ok(e4 instanceof Error, "deleteMailbox on postmaster@ is REFUSED");
    const e5 = await thrownBy(() => facade.changePassword(stalwartCtx, "no-such-id", "Passw0rdX"));
    ok(e5 instanceof Error, "changePassword with an unknown id is REFUSED");
    const otherStill = await stalwart.listAccounts(other.id);
    ok(otherStill.length === 1 && otherStill[0].id === foreign.id, "the foreign account was not deleted by the refused call");
    const ok1 = await thrownBy(() => facade.changePassword(stalwartCtx, info.id, "Passw0rdX"));
    ok(ok1 === null, "changePassword on this domain's own account succeeds");
  }

  section("stalwart createMailbox: plan limit, duplicates, reserved names, quota");
  {
    const canCreateSpy = [];
    const realCanCreate = mailboxEntitlement.canCreate;
    mailboxEntitlement.canCreate = (args) => { canCreateSpy.push(args); return realCanCreate(args); };
    try {
      const planLimit = PLANS["mail-starter"].mailboxes; // 3 mailboxes, postmaster not counted
      const made1 = await facade.createMailbox(stalwartCtx, { localPart: "sales", password: "Passw0rdX" });
      ok(made1.address === "sales@acme.co.ke" && made1.localPart === "sales", "creates sales@ on this domain");
      const acctRow = (await stalwart.listAccounts(acme.id)).find((a) => a.address === "sales@acme.co.ke");
      ok(acctRow && acctRow.quotaBytes === PLANS["mail-starter"].quotaGb * GB, "new account quota = plan quotaGb in bytes (5 GB)");
      ok(canCreateSpy.length >= 1 && canCreateSpy[0].used === 1, "limit check uses mailboxEntitlement.canCreate with the used count (postmaster excluded)");
      const dup = await thrownBy(() => facade.createMailbox(stalwartCtx, { localPart: "sales", password: "Passw0rdX" }));
      ok(dup && dup.status === 409, "creating an existing local part is a 409 conflict");
      const resv = await thrownBy(() => facade.createMailbox(stalwartCtx, { localPart: "postmaster", password: "Passw0rdX" }));
      ok(resv && resv.status === 400, "postmaster is refused on create");
      await facade.createMailbox(stalwartCtx, { localPart: "team", password: "Passw0rdX" });
      ok((await facade.listMailboxes(stalwartCtx)).length === planLimit, "reached the plan's mailbox count (3 of 3 used)");
      const over = await thrownBy(() => facade.createMailbox(stalwartCtx, { localPart: "extra", password: "Passw0rdX" }));
      ok(over && over.status === 409, "create past the plan limit is REFUSED with 409");
      ok(over && /3 mailbox/.test(over.message), "refusal says how many mailboxes the plan includes");
      ok((await stalwart.listAccounts(acme.id)).every((a) => a.address !== "extra@acme.co.ke"), "the refused mailbox was never created");
    } finally {
      mailboxEntitlement.canCreate = realCanCreate;
    }
  }

  section("stalwart: a domain that is not on the server is an error, not an empty list");
  {
    const missing = { orderId: "absent.co.ke", job: stalwartJob, serviceId: "mail-starter", provider: "stalwart" };
    const err = await thrownBy(() => facade.listMailboxes(missing));
    ok(err instanceof Error, "listMailboxes on an unknown domain throws");
  }

  hostingerMail.listMailboxes = savedHost.list;
  hostingerMail.createMailbox = savedHost.create;
  hostingerMail.changeMailboxPassword = savedHost.pw;
  hostingerMail.deleteMailbox = savedHost.del;

  section("isConfigured follows the provider");
  {
    ok(facade.isConfigured("stalwart") === true, "stalwart is configured in mock mode");
    ok(facade.isConfigured("hostinger") === hostingerMail.isConfigured(), "hostinger reports the Hostinger configuration");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error("FAILED:\n- " + fails.join("\n- "));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
