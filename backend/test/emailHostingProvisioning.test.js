/**
 * Email Hosting lane + routing.
 *
 * The bug this locks down: every volume-class Email Hosting product used to
 * route to the coolify lane, which built a meaningless container and reserved
 * 256-384MB on the RAM-capped box for a service that runs on HOSTINGER and
 * consumes none of ours — while provisioning no email at all.
 *
 * Also covers the honest-failure contract: Hostinger exposes no API to bind a
 * domain to a mail order, so the lane must escalate rather than report success
 * for a mailbox the customer cannot use.
 *   node test/emailHostingProvisioning.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const catalog = require("../services/provisioning/catalog");
const emailHosting = require("../services/provisioning/lanes/emailHosting");
const hostingerMail = require("../services/hostingerMail");
const customerDomains = require("../services/customerDomains");

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** Swap module functions for the duration of fn, then restore. */
async function withStubs(stubs, fn) {
  const saved = [];
  for (const [mod, name, impl] of stubs) {
    saved.push([mod, name, mod[name]]);
    mod[name] = impl;
  }
  try { return await fn(); }
  finally { for (const [mod, name, orig] of saved) mod[name] = orig; }
}

const job = { web_account: "WA-0001", service_id: "starter-email", service_name: "Business Email" };

(async () => {
  section("routing: mailbox hosting leaves the coolify lane and stops reserving RAM");
  for (const id of ["starter-email", "biz-email", "addon-mailboxes-5"]) {
    const meta = catalog.getServiceMeta(id);
    ok(!!meta, `${id} is in the catalog snapshot`);
    ok(catalog.laneFor(meta) === "emailHosting", `${id} -> emailHosting lane (was coolify)`);
    ok(Number(meta.ramMb) === 0, `${id} reserves 0MB RAM (runs on Hostinger, not our box)`);
    ok(Number(meta.diskGb) === 0, `${id} reserves 0GB disk`);
  }

  section("routing: the two Email Hosting items that are NOT mailbox hosting");
  const bulk = catalog.getServiceMeta("addon-bulk-email");
  ok(catalog.laneFor(bulk) === "manual", "addon-bulk-email -> manual (campaign sender, no implementation)");
  ok(Number(bulk.ramMb) > 0, "addon-bulk-email KEEPS its footprint — it will need a real container once built");
  const ent = catalog.getServiceMeta("ent-mail");
  ok(catalog.laneFor(ent) === "manual", "ent-mail -> manual (dedicated, custom quote)");

  section("routing: unrelated lanes are untouched");
  ok(catalog.laneFor(catalog.getServiceMeta("starter-web-hosting")) === "coolify", "web hosting still coolify");
  ok(catalog.laneFor(catalog.getServiceMeta("starter-storage")) === "objectStorage", "file storage still objectStorage");

  section("config: requires the Hostinger token, never fakes a build");
  withEnv({ HOSTINGER_API_TOKEN: "" }, () => {
    ok(emailHosting.isConfigured() === false, "not configured without HOSTINGER_API_TOKEN");
    ok(/HOSTINGER_API_TOKEN/.test(emailHosting.configError() || ""), "configError names the missing env var");
  });
  withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => {
    ok(emailHosting.isConfigured() === true, "configured with a token");
    ok(emailHosting.configError() === null, "no configError when configured");
  });

  section("API base: a stale api.hostinger.com env var must not be used (it 530s)");
  withEnv({ HOSTINGER_API_BASE: "https://api.hostinger.com" }, () => {
    ok(hostingerMail.resolveHost() === "https://developers.hostinger.com", "api.hostinger.com is overridden to the real API host");
  });
  withEnv({ HOSTINGER_API_BASE: "https://developers.hostinger.com/api" }, () => {
    ok(hostingerMail.resolveHost() === "https://developers.hostinger.com", "trailing /api is stripped so documented paths append cleanly");
  });
  withEnv({ HOSTINGER_API_BASE: "" }, () => {
    ok(hostingerMail.resolveHost() === "https://developers.hostinger.com", "defaults to the developers host");
  });

  section("provision: no domain on the account is a PERMANENT failure");
  await withStubs([[customerDomains, "listCustomerDomains", async () => []]], async () => {
    let err = null;
    try { await emailHosting.provision(job, { client: {} }); } catch (e) { err = e; }
    ok(!!err, "throws when the account has no domain");
    ok(err && err.permanent === true, "marked permanent — a retry cannot conjure a domain");
    ok(err && /has none on file/.test(err.message), "message says the domain is missing");
  });

  section("provision: no mail order bound to the domain -> permanent, with the manual steps");
  await withStubs([
    [customerDomains, "listCustomerDomains", async () => [{ name: "acme.co.ke", status: "active" }]],
    [hostingerMail, "findOrderForDomain", async () => null],
    [hostingerMail, "listEmailPlans", async () => [
      { id: "hostingercom-hostingermail-pro", name: "Starter Business Email",
        prices: [{ currency: "USD", amountMinor: 299, period: 1, periodUnit: "month" }] },
    ]],
  ], async () => {
    let err = null;
    try { await emailHosting.provision(job, { client: {} }); } catch (e) { err = e; }
    ok(!!err && err.permanent === true, "permanent failure — never reports success for an unusable mailbox");
    ok(/acme\.co\.ke/.test(err.message), "names the domain that needs binding");
    ok(/hPanel/.test(err.message), "tells the human where to bind it");
    ok(/hostingercom-hostingermail-pro/.test(err.message), "names the exact plan id to buy");
    ok(/USD 2\.99/.test(err.message), "quotes the real wholesale price from the live catalog");
  });

  section("provision: an existing order for the domain goes ACTIVE");
  await withStubs([
    [customerDomains, "listCustomerDomains", async () => [{ name: "acme.co.ke", status: "active" }]],
    [hostingerMail, "findOrderForDomain", async () => ({ id: "ord_42", domain: "acme.co.ke", status: "active" })],
    [hostingerMail, "getOrderPlan", async () => ({ mailbox_limit: 5 })],
    [hostingerMail, "listMailboxes", async () => [{ id: "mb_1" }, { id: "mb_2" }]],
  ], async () => {
    const out = await emailHosting.provision(job, { client: {} });
    ok(out.externalRef === "ord_42", "externalRef is the Hostinger mail order id");
    ok(out.access.domain === "acme.co.ke", "access records the domain");
    ok(out.access.mailboxCount === 2, "access records existing mailbox count");
    ok(out.access.mailboxLimit === 5, "access records the plan's mailbox allowance");
    ok(/imap\.hostinger\.com/.test(JSON.stringify(out.access)), "access carries IMAP details for the portal");
    ok(/No VPS resources used/.test(out.log), "log states no VPS resources were consumed");
  });

  section("provision: plan/mailbox read failures degrade, they don't fail the job");
  await withStubs([
    [customerDomains, "listCustomerDomains", async () => [{ name: "acme.co.ke", status: "active" }]],
    [hostingerMail, "findOrderForDomain", async () => ({ id: "ord_7", domain: "acme.co.ke" })],
    [hostingerMail, "getOrderPlan", async () => { throw new Error("boom"); }],
    [hostingerMail, "listMailboxes", async () => { throw new Error("boom"); }],
  ], async () => {
    const out = await emailHosting.provision(job, { client: {} });
    ok(out.externalRef === "ord_7", "still active when the informational reads fail");
    ok(out.access.mailboxLimit === null, "unknown allowance is null, not invented");
  });

  section("provision: prefers the domain already attached to THIS service");
  await withStubs([
    [customerDomains, "listCustomerDomains", async () => [
      { name: "other.co.ke", status: "active" },
      { name: "chosen.co.ke", status: "active", attachedServiceId: "starter-email" },
    ]],
    [hostingerMail, "findOrderForDomain", async (d) => ({ id: "ord_9", domain: d })],
    [hostingerMail, "getOrderPlan", async () => ({})],
    [hostingerMail, "listMailboxes", async () => []],
  ], async () => {
    const out = await emailHosting.provision(job, { client: {} });
    ok(out.access.domain === "chosen.co.ke", "attached domain wins over any other active domain");
  });

  section("provision: refuses to guess without a Frappe client");
  await (async () => {
    let err = null;
    try { await emailHosting.provision(job, {}); } catch (e) { err = e; }
    ok(!!err && /requires a Frappe client/.test(err.message), "fails loudly rather than provisioning the wrong address");
  })();

  section("createMailbox: rejects a malformed local part before calling the API");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    for (const bad of ["bad address", "-lead", "UPPER CASE!", "", "trail-"]) {
      let err = null;
      try { await hostingerMail.createMailbox("ord_1", { localPart: bad }); } catch (e) { err = e; }
      ok(!!err && err.permanent === true, `rejects local part ${JSON.stringify(bad)} as permanent`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
