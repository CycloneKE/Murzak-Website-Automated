/**
 * Domain registration automation — hostingerDomains.js and the
 * attemptLiveRegistration step wired into domainPurchaseFulfilment.js.
 *
 * See docs/domain-registration-automation.md for the research this codifies:
 * only .com/.org/.net/.io are ever attempted (Hostinger's catalog sells
 * nothing else of Murzak's seven TLDs), the wire format is snake_case (not
 * the SDK docs' camelCase), and the registrant identity is cloned from a
 * profile already live on the account, never invented.
 *
 * No live HTTP call is made anywhere in this file — hostingerDomains's
 * exported functions are stubbed at the module level, the same pattern used
 * for hostingerMail in emailHostingProvisioning.test.js.
 *   node test/domainRegistrationAutomation.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const hostingerDomains = require("../services/hostingerDomains");
const { attemptLiveRegistration, fulfilPurchasedDomains } = require("../services/domainPurchaseFulfilment");

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

async function withStubs(stubs, fn) {
  const saved = [];
  for (const [mod, name, impl] of stubs) {
    saved.push([mod, name, mod[name]]);
    mod[name] = impl;
  }
  try { return await fn(); }
  finally { for (const [mod, name, orig] of saved) mod[name] = orig; }
}

const HD = hostingerDomains;

(async () => {
  section("attemptLiveRegistration: not configured -> ok:false, never throws");
  await withEnv({ HOSTINGER_API_TOKEN: "" }, async () => {
    const r = await attemptLiveRegistration("acme.com", ".com");
    ok(r.ok === false, "refused");
    ok(/HOSTINGER_API_TOKEN/.test(r.reason), "reason names the missing config");
  });

  section("attemptLiveRegistration: TLD Hostinger doesn't sell -> ok:false, not an error");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    await withStubs([[HD, "findDomainCatalogItem", async () => null]], async () => {
      const r = await attemptLiveRegistration("duka.co.ke", ".co.ke");
      ok(r.ok === false, "refused");
      ok(/does not sell/.test(r.reason), "reason explains it's a coverage gap, not a failure");
    });
  });

  section("attemptLiveRegistration: no usable payment method -> ok:false");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    await withStubs([
      [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
      [HD, "hasUsablePaymentMethod", async () => false],
    ], async () => {
      const r = await attemptLiveRegistration("acme.com", ".com");
      ok(r.ok === false && /payment method/.test(r.reason), "refused, names the missing payment method");
    });
  });

  section("attemptLiveRegistration: WHOIS profile step fails -> ok:false, not thrown");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    await withStubs([
      [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
      [HD, "hasUsablePaymentMethod", async () => true],
      [HD, "ensureWhoisProfile", async () => { throw new Error("no reference profile"); }],
    ], async () => {
      const r = await attemptLiveRegistration("acme.com", ".com");
      ok(r.ok === false && /no reference profile/.test(r.reason), "propagates the WHOIS failure as a refusal, not a throw");
    });
  });

  section("attemptLiveRegistration: purchase call fails -> ok:false with the API's own detail");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    await withStubs([
      [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
      [HD, "hasUsablePaymentMethod", async () => true],
      [HD, "ensureWhoisProfile", async () => 15270696],
      [HD, "purchaseDomain", async () => { const e = new Error("boom"); e.response = { data: { message: "domain already taken" } }; throw e; }],
    ], async () => {
      const r = await attemptLiveRegistration("acme.com", ".com");
      ok(r.ok === false && /domain already taken/.test(r.reason), "surfaces the specific registrar rejection reason");
    });
  });

  section("attemptLiveRegistration: success -> ok:true, white-labeled, never names Hostinger");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    let privacyCalledWith = null;
    await withStubs([
      [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
      [HD, "hasUsablePaymentMethod", async () => true],
      [HD, "ensureWhoisProfile", async () => 15270696],
      [HD, "purchaseDomain", async () => ({ expires_at: "2027-08-17T00:00:00Z" })],
      [HD, "enablePrivacyProtection", async (d) => { privacyCalledWith = d; }],
    ], async () => {
      const r = await attemptLiveRegistration("acme.com", ".com");
      ok(r.ok === true, "registration succeeds");
      ok(r.registrar === "Murzak Cloud", "white-label: registrar field never says Hostinger");
      ok(r.expiresOn === "2027-08-17T00:00:00Z", "carries the real expiry through");
      ok(privacyCalledWith === "acme.com", "privacy protection is enabled on the newly registered domain");
    });
  });

  section("attemptLiveRegistration: privacy-protection failure does NOT undo a successful purchase");
  await withEnv({ HOSTINGER_API_TOKEN: "tok" }, async () => {
    await withStubs([
      [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
      [HD, "hasUsablePaymentMethod", async () => true],
      [HD, "ensureWhoisProfile", async () => 15270696],
      [HD, "purchaseDomain", async () => ({})],
      [HD, "enablePrivacyProtection", async () => { throw new Error("privacy API down"); }],
    ], async () => {
      const r = await attemptLiveRegistration("acme.com", ".com");
      ok(r.ok === true, "the domain is still registered even though privacy protection failed");
    });
  });

  section("findDomainCatalogItem: exact-name match only (not Domain Transfer / .EMAIL Domain siblings)");
  {
    const axios = require("axios");
    const origCreate = axios.create;
    const catalog = [
      { id: "hostingercom-domain-com", category: "DOMAIN", name: ".COM Domain", prices: [{ period: 1, period_unit: "year", price: 1999 }] },
      { id: "hostingercom-domaintransfer-com", category: "DOMAIN", name: "Domain Transfer", prices: [] },
      { id: "hostingercom-domain-email", category: "DOMAIN", name: ".EMAIL Domain", prices: [] },
    ];
    axios.create = () => ({ get: async () => ({ data: catalog }) });
    try {
      const item = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.findDomainCatalogItem(".com"));
      ok(item?.itemId === "hostingercom-domain-com", "matches the exact .COM Domain item, not a same-category sibling");
      ok(item?.priceUsdCents === 1999, "carries the yearly price through");
      const missing = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.findDomainCatalogItem(".xyz"));
      ok(missing === null, "an unsold TLD returns null, not a throw or a wrong match");
    } finally {
      axios.create = origCreate;
    }
  }

  section("hasUsablePaymentMethod: expired/suspended methods are ignored, one good one is enough");
  {
    const axios = require("axios");
    const origCreate = axios.create;
    try {
      axios.create = () => ({ get: async () => ({ data: [] }) });
      ok((await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.hasUsablePaymentMethod())) === false, "no methods at all -> false");

      axios.create = () => ({ get: async () => ({ data: [{ is_expired: true, expires_at: "2020-01-01" }] }) });
      ok((await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.hasUsablePaymentMethod())) === false, "an is_expired method doesn't count");

      axios.create = () => ({ get: async () => ({ data: [{ expires_at: "2020-01-01T00:00:00Z" }] }) });
      ok((await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.hasUsablePaymentMethod())) === false, "a past expires_at doesn't count even if is_expired lied");

      axios.create = () => ({ get: async () => ({ data: [{ is_suspended: true, expires_at: "2099-01-01T00:00:00Z" }] }) });
      ok((await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.hasUsablePaymentMethod())) === false, "a suspended method doesn't count");

      axios.create = () => ({ get: async () => ({ data: [
        { is_expired: true, expires_at: "2020-01-01" },
        { expires_at: "2099-01-01T00:00:00Z", is_default: true },
      ] }) });
      ok((await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.hasUsablePaymentMethod())) === true, "one good method among bad ones is enough");
    } finally {
      axios.create = origCreate;
    }
  }

  section("ensureWhoisProfile: reuses an existing per-TLD profile without creating one");
  {
    const axios = require("axios");
    const origCreate = axios.create;
    let postCalled = false;
    try {
      axios.create = () => ({
        get: async () => ({ data: [{ id: 999, tld: "net" }] }),
        post: async () => { postCalled = true; throw new Error("should not be called"); },
      });
      const id = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.ensureWhoisProfile(".net"));
      ok(id === 999, "returns the existing profile's id");
      ok(postCalled === false, "never calls create when a profile already exists for this TLD");
    } finally {
      axios.create = origCreate;
    }
  }

  section("ensureWhoisProfile: clones the reference profile's REAL contact data onto a missing TLD, snake_case wire format");
  {
    const axios = require("axios");
    const origCreate = axios.create;
    let createBody = null;
    try {
      axios.create = () => ({
        get: async () => ({
          data: [{
            id: 15270696, tld: "com", country: "KE", entity_type: "individual",
            whois_details: { first_name: "Joe", last_name: "Mugoh", email: "murzaktech@gmail.com" },
          }],
        }),
        post: async (url, body) => { createBody = body; return { data: { id: 424242 } }; },
      });
      const id = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.ensureWhoisProfile(".org"));
      ok(id === 424242, "returns the newly created profile's id");
      ok(createBody.tld === "org", "tld sent bare, without the leading dot");
      ok(createBody.entity_type === "individual", "wire format is snake_case entity_type, not camelCase entityType");
      ok(createBody.whois_details.email === "murzaktech@gmail.com", "clones the REAL contact data from the existing profile, invents nothing");
      ok(createBody.country === "KE", "country carried over from the reference profile");
    } finally {
      axios.create = origCreate;
    }
  }

  section("ensureWhoisProfile: no reference profile anywhere -> a clear, actionable error");
  {
    const axios = require("axios");
    const origCreate = axios.create;
    try {
      axios.create = () => ({ get: async () => ({ data: [] }) });
      let err = null;
      try { await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () => HD.ensureWhoisProfile(".io")); }
      catch (e) { err = e; }
      ok(!!err && /hPanel/.test(err.message), "tells a human where to create the first profile by hand");
    } finally {
      axios.create = origCreate;
    }
  }

  section("fulfilPurchasedDomains: end-to-end — a successful automated registration flips status and syncs the intake");
  {
    const makeClient = () => ({
      puts: [],
      existingRequests: [],
      existingDomains: [],
      async get(url) {
        if (/Purchase%20Request|Purchase Request/.test(url)) return { data: { data: this.existingRequests } };
        return { data: { data: this.existingDomains } };
      },
      async post(url, body) {
        return { data: { data: { name: "PR-1", ...body } } };
      },
      async put(url, body) {
        this.puts.push({ url, body });
        return { data: { data: {} } };
      },
    });
    const client = makeClient();
    const summary = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () =>
      withStubs([
        [HD, "isConfigured", () => true],
        [HD, "configError", () => null],
        [HD, "findDomainCatalogItem", async () => ({ itemId: "hostingercom-domain-com" })],
        [HD, "hasUsablePaymentMethod", async () => true],
        [HD, "ensureWhoisProfile", async () => 15270696],
        [HD, "purchaseDomain", async () => ({ expires_at: "2027-08-17T00:00:00Z" })],
        [HD, "enablePrivacyProtection", async () => {}],
      ], () => fulfilPurchasedDomains(client, "ACC-1", [{ serviceId: "domain-com", domainChoice: "acme.com" }]))
    );
    ok(summary.domains === 1, "fulfilment record still created as always");
    ok(summary.registered === 1, "counted as an automated registration");
    const statusPut = client.puts.find((p) => p.body?.status === "active");
    ok(!!statusPut, "CustomerDomain flipped to active");
    ok(statusPut.body.registrar === "Murzak Cloud", "registrar written white-labeled, never Hostinger");
    ok(statusPut.body.expires_on === "2027-08-17T00:00:00Z", "expiry carried onto the record");
    const intakePut = client.puts.find((p) => p.body?.status === "connected");
    ok(!!intakePut, "purchase-request intake synced to 'connected' — the SAME word a human's manual fulfilment uses");
  }

  section("fulfilPurchasedDomains: a re-synced ALREADY-active domain is never registered a second time");
  {
    const makeClient = () => ({
      puts: [],
      existingRequests: [{ name: "PR-9", status: "connected" }],
      existingDomains: [{ name: "CD-9", domain_name: "acme.com", kind: "registered", status: "active" }],
      async get(url) {
        if (/Purchase%20Request|Purchase Request/.test(url)) return { data: { data: this.existingRequests } };
        return { data: { data: this.existingDomains } };
      },
      async post() { throw new Error("should not create anything on a re-sync"); },
      async put(url, body) { this.puts.push({ url, body }); return { data: { data: {} } }; },
    });
    const client = makeClient();
    let purchaseCalled = false;
    const summary = await withEnv({ HOSTINGER_API_TOKEN: "tok" }, () =>
      withStubs([[HD, "purchaseDomain", async () => { purchaseCalled = true; return {}; }]],
        () => fulfilPurchasedDomains(client, "ACC-1", [{ serviceId: "domain-com", domainChoice: "acme.com" }]))
    );
    ok(summary.skipped === 1, "the purchase-request re-sync path is untouched");
    ok(purchaseCalled === false, "registration is never attempted for a domain that's already active");
    ok(client.puts.length === 0, "no writes at all on an already-fulfilled re-sync");
  }

  section("fulfilPurchasedDomains: registration failure leaves the domain exactly where it already was — pending");
  {
    const makeClient = () => ({
      puts: [],
      existingRequests: [],
      existingDomains: [],
      async get(url) {
        if (/Purchase%20Request|Purchase Request/.test(url)) return { data: { data: this.existingRequests } };
        return { data: { data: this.existingDomains } };
      },
      async post(url, body) { return { data: { data: { name: "PR-1", ...body } } }; },
      async put(url, body) { this.puts.push({ url, body }); return { data: { data: {} } }; },
    });
    const client = makeClient();
    const summary = await withEnv({ HOSTINGER_API_TOKEN: "" }, () =>
      fulfilPurchasedDomains(client, "ACC-1", [{ serviceId: "domain-coke", domainChoice: "duka.co.ke" }])
    );
    ok(summary.domains === 1, "fulfilment record still created — registration failing must never block this");
    ok(summary.registered === 0, "not counted as registered");
    ok(summary.errors.length === 0, "NOT reported as a fulfilment error — staying pending is the normal, unremarkable outcome");
    ok(client.puts.length === 0, "no status was written — the record is exactly the pre-automation 'pending' default");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.error("\nFailures:\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("ALL GREEN");
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
