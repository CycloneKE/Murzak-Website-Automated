/**
 * Stalwart mailSetup store + domain gate.
 *   node test/mailSetupStore.test.js   (or: npm test)
 *
 * The mail setup lives on the Checkout Order's config_json under `mailSetup`,
 * the same way shopSetup lives under `shopSetup`. These tests pin the store
 * contract: invalid input stores nothing, other config keys survive, progress
 * and state writes are idempotent, the taken-domain set excludes only the
 * order being saved, and the domain gate retries while a domain is pending and
 * escalates to a permanent failure when staff must register it by hand.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const { makeMockFrappe } = require("./helpers/mockFrappe");
const {
  saveMailSetup,
  getMailSetup,
  setProgress,
  setMailState,
  mergeMailSetup,
  listTakenMailDomains,
  waitForDomain,
} = require("../services/email/mailSetupStore");

const LIVE = "2099-01-01 00:00:00";
const EXPIRED = "2000-01-01 00:00:00";

const VALID = Object.freeze({
  planId: "mail-starter",
  domainMode: "new",
  businessName: "Acme Ltd",
  domain: "acme.com",
  contactEmail: "owner@gmail.com",
  mailboxes: ["info", "sales"],
});

function orderSeed(overrides = {}) {
  return {
    "Checkout Order": {
      "CHK-1": {
        name: "CHK-1",
        web_account: "WA-1",
        status: "Draft",
        reservation_expires_at: LIVE,
        invoice_doc_name: "PINV-1",
        config_json: JSON.stringify({ shopProgress: { signedIn: true, products: 4 }, welcomeEmail: { state: "sent" } }),
        ...(overrides["CHK-1"] || {}),
      },
      "CHK-2": {
        name: "CHK-2",
        web_account: "WA-2",
        status: "Draft",
        reservation_expires_at: LIVE,
        invoice_doc_name: "PINV-2",
        config_json: JSON.stringify({
          mailSetup: { state: "awaiting_payment", domain: "other.co.uk", planId: "mail-business" },
        }),
        ...(overrides["CHK-2"] || {}),
      },
    },
  };
}

function configOf(client, name) {
  return JSON.parse(client.store["Checkout Order"][name].config_json || "{}");
}

async function rejects(promise) {
  try { await promise; return null; } catch (e) { return e; }
}

(async () => {
  section("saveMailSetup rejects invalid input and stores nothing");
  {
    const client = makeMockFrappe(orderSeed());
    const before = client.store["Checkout Order"]["CHK-1"].config_json;

    const badDomain = await rejects(saveMailSetup(client, "CHK-1", { ...VALID, domain: "not a domain" }));
    ok(badDomain && badDomain.statusCode === 400 && badDomain.errors.domain, "invalid domain rejects with a 400 and a field error");
    const badMode = await rejects(saveMailSetup(client, "CHK-1", { ...VALID, domainMode: "maybe" }));
    ok(badMode && badMode.errors.domainMode, "unknown domainMode rejects");
    const noMode = await rejects(saveMailSetup(client, "CHK-1", { ...VALID, domainMode: undefined }));
    ok(noMode && noMode.errors.domainMode, "missing domainMode rejects");
    const taken = await rejects(saveMailSetup(client, "CHK-1", { ...VALID, domain: "other.co.uk" }));
    ok(taken && taken.errors.domain, "a domain already used by another order rejects");

    ok(client.store["Checkout Order"]["CHK-1"].config_json === before, "rejected input leaves the order config untouched");
    ok(client.puts.length === 0, "rejected input issues no write");
  }

  section("saveMailSetup stores a valid awaiting_payment setup");
  {
    const client = makeMockFrappe(orderSeed());
    const setup = await saveMailSetup(client, "CHK-1", VALID);
    ok(setup.state === "awaiting_payment", "state starts awaiting_payment");
    ok(setup.provider === "stalwart", "provider is stalwart");
    ok(setup.domainMode === "new" && setup.planId === "mail-starter", "domainMode and planId are stored");
    ok(setup.domain === "acme.com" && setup.businessName === "Acme Ltd", "domain and business name are stored");
    ok(JSON.stringify(setup.mailboxes) === JSON.stringify([{ localPart: "info", passwordSet: false }, { localPart: "sales", passwordSet: false }]), "mailboxes are stored as local parts with no password yet");
    ok(JSON.stringify(setup.progress) === JSON.stringify({ payment: "pending", domain: "pending", mail: "pending", webmail: "pending", dns: "pending" }), "every progress stage starts pending");
    const stored = configOf(client, "CHK-1").mailSetup;
    ok(stored && stored.state === "awaiting_payment" && stored.domain === "acme.com", "the setup is persisted under config.mailSetup");
  }

  section("saveMailSetup preserves the other config keys");
  {
    const client = makeMockFrappe(orderSeed());
    await saveMailSetup(client, "CHK-1", VALID);
    const cfg = configOf(client, "CHK-1");
    ok(cfg.shopProgress && cfg.shopProgress.products === 4, "shopProgress survives the save");
    ok(cfg.welcomeEmail && cfg.welcomeEmail.state === "sent", "welcomeEmail survives the save");
  }

  section("re-saving the same order does not count its own domain as taken");
  {
    const client = makeMockFrappe(orderSeed({ "CHK-1": { config_json: JSON.stringify({ mailSetup: { state: "awaiting_payment", domain: "acme.com" } }) } }));
    const again = await rejects(saveMailSetup(client, "CHK-1", { ...VALID, mailboxes: ["hello"] }));
    ok(again === null, "the order's own previous domain is not a conflict");
  }

  section("optional logoUrl: only an https link is kept");
  {
    const client = makeMockFrappe(orderSeed());
    const keep = await saveMailSetup(client, "CHK-1", { ...VALID, logoUrl: "https://cdn.example.com/logo.png" });
    ok(keep.logoUrl === "https://cdn.example.com/logo.png", "an https logo is kept");
    const drop = await saveMailSetup(client, "CHK-1", { ...VALID, logoUrl: "javascript:alert(1)" });
    ok(drop.logoUrl === undefined, "a non-https logo is dropped");
  }

  section("getMailSetup finds the setup by its invoice");
  {
    const client = makeMockFrappe(orderSeed());
    await saveMailSetup(client, "CHK-1", VALID);
    const found = await getMailSetup(client, "PINV-1");
    ok(found && found.orderName === "CHK-1" && found.setup.domain === "acme.com", "returns the order name and its setup");
    ok((await getMailSetup(client, "PINV-404")) === null, "an unknown invoice returns null");
  }

  section("setProgress is idempotent");
  {
    const client = makeMockFrappe(orderSeed());
    await saveMailSetup(client, "CHK-1", VALID);
    await setProgress(client, "CHK-1", "payment", "done");
    const afterFirst = client.store["Checkout Order"]["CHK-1"].config_json;
    await setProgress(client, "CHK-1", "payment", "done");
    ok(client.store["Checkout Order"]["CHK-1"].config_json === afterFirst, "repeating the same progress write leaves the order unchanged");
    ok(configOf(client, "CHK-1").mailSetup.progress.payment === "done", "payment is done");
    ok(configOf(client, "CHK-1").mailSetup.progress.domain === "pending", "other stages are untouched");
    ok((await rejects(setProgress(client, "CHK-1", "billing", "done"))) !== null, "an unknown stage is rejected");
    ok((await rejects(setProgress(client, "CHK-1", "mail", "maybe"))) !== null, "an unknown progress state is rejected");
  }

  section("setMailState is idempotent");
  {
    const client = makeMockFrappe(orderSeed());
    await saveMailSetup(client, "CHK-1", VALID);
    await setMailState(client, "CHK-1", "paid");
    const afterFirst = client.store["Checkout Order"]["CHK-1"].config_json;
    await setMailState(client, "CHK-1", "paid");
    ok(client.store["Checkout Order"]["CHK-1"].config_json === afterFirst, "repeating the same state leaves the order unchanged");
    ok(configOf(client, "CHK-1").mailSetup.state === "paid", "state is paid");
    ok((await rejects(setMailState(client, "CHK-1", "exploded"))) !== null, "an unknown state is rejected");
    await setMailState(client, "CHK-1", "needs_attention");
    ok(configOf(client, "CHK-1").mailSetup.state === "needs_attention", "needs_attention is a valid state");
  }

  section("listTakenMailDomains");
  {
    const client = makeMockFrappe(orderSeed());
    await saveMailSetup(client, "CHK-1", VALID);
    const all = await listTakenMailDomains(client);
    ok(all.has("acme.com") && all.has("other.co.uk") && all.size === 2, "every order's mail domain is taken");
    const others = await listTakenMailDomains(client, { exceptOrderName: "CHK-1" });
    ok(!others.has("acme.com") && others.has("other.co.uk"), "excluding the order being saved drops only its own domain");
  }

  section("waitForDomain: own domain returns at once");
  {
    const client = { get: async () => { throw new Error("must not read domains for an own domain"); } };
    const threw = await rejects(waitForDomain(client, { webAccount: "WA-1", domain: "acme.com", domainMode: "own" }));
    ok(threw === null, "domainMode own resolves without consulting customer domains");
  }

  section("waitForDomain: new domain gate");
  {
    const row = (status, domain = "acme.com") => ({
      "Customer Domain": { "CD-1": { name: "CD-1", web_account: "WA-1", domain_name: domain, status, kind: "registered" } },
    });
    const opts = { webAccount: "WA-1", domain: "acme.com", domainMode: "new" };

    const p = await rejects(waitForDomain(makeMockFrappe(row("pending")), opts));
    ok(p instanceof Error && p.permanent !== true, "a pending domain is retryable (no permanent flag)");

    const n = await rejects(waitForDomain(makeMockFrappe({}), opts));
    ok(n instanceof Error && n.permanent !== true, "a domain with no row yet is retryable");

    const a = await rejects(waitForDomain(makeMockFrappe(row("active")), opts));
    ok(a === null, "an active domain lets the order proceed");

    const f = await rejects(waitForDomain(makeMockFrappe(row("failed")), opts));
    ok(f && f.permanent === true && /register/i.test(f.message), "a failed domain is permanent and tells staff to register it");

    const c = await rejects(waitForDomain(makeMockFrappe(row("cancelled")), opts));
    ok(c && c.permanent === true, "a cancelled domain is permanent (it cannot become active)");

    const k = await rejects(waitForDomain(makeMockFrappe({}), { webAccount: "WA-1", domain: "acme.co.ke", domainMode: "new" }));
    ok(k && k.permanent === true && /register/i.test(k.message), ".co.ke is permanent: staff must register it by hand");
    const ke = await rejects(waitForDomain(makeMockFrappe({}), { webAccount: "WA-1", domain: "acme.ke", domainMode: "new" }));
    ok(ke && ke.permanent === true, ".ke is permanent");

    const coActive = await rejects(waitForDomain(makeMockFrappe(row("active", "acme.co.ke")), { webAccount: "WA-1", domain: "acme.co.ke", domainMode: "new" }));
    ok(coActive === null, "an active .co.ke row (staff registered it, then activated it) resolves on requeue");
    const keActive = await rejects(waitForDomain(makeMockFrappe(row("active", "acme.ke")), { webAccount: "WA-1", domain: "acme.ke", domainMode: "new" }));
    ok(keActive === null, "an active .ke row resolves too");
  }
  section("paid or closed orders cannot change their mail setup");
  {
    const client = makeMockFrappe(orderSeed({ "CHK-1": { status: "Paid" } }));
    const before = client.store["Checkout Order"]["CHK-1"].config_json;
    const e = await rejects(saveMailSetup(client, "CHK-1", VALID));
    ok(e && e.statusCode === 409, "a Paid order refuses a mail setup (409)");
    ok(client.store["Checkout Order"]["CHK-1"].config_json === before && configOf(client, "CHK-1").mailSetup === undefined, "a refused Paid order's config is untouched");

    const inv = makeMockFrappe({ ...orderSeed(), "Portal Invoice": { "PINV-1": { name: "PINV-1", status: "Paid" } } });
    const e2 = await rejects(saveMailSetup(inv, "CHK-1", VALID));
    ok(e2 && e2.statusCode === 409, "a Draft whose linked invoice is already paid is refused (409)");
    ok(configOf(inv, "CHK-1").mailSetup === undefined, "and its mailSetup is not written");
  }

  section("who holds a domain: live orders of other accounts only");
  {
    const holdSeed = () => makeMockFrappe({
      "Checkout Order": {
        "CHK-1": { name: "CHK-1", web_account: "WA-1", status: "Draft", reservation_expires_at: LIVE, invoice_doc_name: "", config_json: JSON.stringify({ mailSetup: { domain: "mine.com", state: "awaiting_payment" } }) },
        "CHK-3": { name: "CHK-3", web_account: "WA-1", status: "Draft", reservation_expires_at: EXPIRED, invoice_doc_name: "", config_json: JSON.stringify({ mailSetup: { domain: "retry.com", state: "awaiting_payment" } }) },
        "CHK-4": { name: "CHK-4", web_account: "WA-3", status: "Cancelled", reservation_expires_at: LIVE, invoice_doc_name: "", config_json: JSON.stringify({ mailSetup: { domain: "free.com", state: "awaiting_payment" } }) },
        "CHK-5": { name: "CHK-5", web_account: "WA-2", status: "Draft", reservation_expires_at: LIVE, invoice_doc_name: "", config_json: JSON.stringify({ mailSetup: { domain: "live.com", state: "awaiting_payment" } }) },
        "CHK-8": { name: "CHK-8", web_account: "WA-1", status: "Draft", reservation_expires_at: LIVE, invoice_doc_name: "", config_json: "{}" },
      },
    });

    const retry = await rejects(saveMailSetup(holdSeed(), "CHK-8", { ...VALID, domain: "retry.com" }));
    ok(retry === null, "same account retries after an abandoned (expired) Draft with the same domain");
    const free = await rejects(saveMailSetup(holdSeed(), "CHK-8", { ...VALID, domain: "free.com" }));
    ok(free === null, "a Cancelled order's domain is free again");
    const live = await rejects(saveMailSetup(holdSeed(), "CHK-8", { ...VALID, domain: "live.com" }));
    ok(live && live.errors && live.errors.domain, "another account's live order still blocks the domain");
    const own = await rejects(saveMailSetup(holdSeed(), "CHK-8", { ...VALID, domain: "mine.com" }));
    ok(own === null, "the requesting account's own live order never blocks its retry");
  }

  section("mergeMailSetup merges fields and keeps the rest");
  {
    const client = makeMockFrappe(orderSeed({ "CHK-1": { config_json: JSON.stringify({ shopProgress: { signedIn: true }, mailSetup: { state: "paid", domain: "a.com", progress: { dns: "pending" } } }) } }));
    const recs = [{ type: "MX", name: "@", value: "mail.x.com", priority: 10 }];
    await mergeMailSetup(client, "CHK-1", { dnsRecords: recs });
    await mergeMailSetup(client, "CHK-1", { dnsRecords: recs });
    const cfg = configOf(client, "CHK-1");
    ok(JSON.stringify(cfg.mailSetup.dnsRecords) === JSON.stringify(recs), "records stored (idempotent)");
    ok(cfg.mailSetup.state === "paid" && cfg.mailSetup.domain === "a.com", "other setup fields kept");
    ok(cfg.shopProgress && cfg.shopProgress.signedIn === true, "other config keys kept");
    const e = await rejects(mergeMailSetup(client, "CHK-2b", { x: 1 }));
    ok(e !== null, "unknown order rejected");
  }
})().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
}).catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
