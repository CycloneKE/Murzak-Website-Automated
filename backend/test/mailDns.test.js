/**
 * Mail DNS records, verification and the webmail CNAME for bring-your-own
 * domains. No network: the DNS resolver and the Hostinger HTTP client are
 * injected.
 *   node test/mailDns.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const mailDns = require("../services/email/mailDns");
const hostingerApi = require("../services/hostingerApi");
const { requiredRecords, verifyRecords, ensureWebmailCname } = mailDns;

// A resolver where every lookup fails with the given error code, like a broken
// or unreachable nameserver would.
function failingResolver(code) {
  const boom = async () => { const e = new Error(`simulated ${code}`); e.code = code; throw e; };
  return { resolveMx: boom, resolveTxt: boom, resolveCname: boom };
}

const DOMAIN = "example.co.ke";
const MAIL_HOST = "mail.cloud.murzaktech.tech";

// Fake node dns.promises-style resolver. Maps name -> answer; unknown names
// behave like NODATA (throw ENODATA), exactly as node does.
function fakeResolver({ mx = {}, txt = {}, cname = {} } = {}) {
  const miss = () => { const e = new Error("ENODATA"); e.code = "ENODATA"; throw e; };
  const norm = (n) => String(n).toLowerCase().replace(/\.$/, "");
  const pick = (table, name) => {
    const key = Object.keys(table).find((k) => norm(k) === norm(name));
    if (key === undefined) miss();
    return table[key];
  };
  return {
    resolveMx: async (name) => pick(mx, name),
    resolveTxt: async (name) => pick(txt, name),
    resolveCname: async (name) => pick(cname, name),
  };
}

// Records a correctly configured domain would have.
function goodResolver(overrides = {}) {
  return fakeResolver({
    mx: { [DOMAIN]: [{ exchange: MAIL_HOST, priority: 10 }] },
    txt: {
      [DOMAIN]: [["v=spf1 mx ~all"]],
      [`_dmarc.${DOMAIN}`]: [[`v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}`]],
    },
    cname: { [`webmail.${DOMAIN}`]: [`webmail.cloud.murzaktech.tech`] },
    ...overrides,
  });
}

// In-memory Hostinger DNS zone for the ensureWebmailCname tests. Mirrors the
// certbot contract: PUT with overwrite:false adds records and never replaces
// existing ones; GET returns the zone's record list.
function fakeHostinger(initial = []) {
  const state = { zone: initial.map((r) => ({ ...r })), puts: [], gets: [], urls: [] };
  const http = {
    async get(url) {
      state.gets.push(url);
      state.urls.push(url);
      return { data: state.zone.map((r) => ({ ...r, records: r.records.map((c) => ({ ...c })) })) };
    },
    async put(url, body) {
      state.puts.push(body);
      state.urls.push(url);
      for (const entry of body.zone) {
        state.zone.push({ name: entry.name, type: entry.type, ttl: entry.ttl, records: entry.records });
      }
      return { data: { data: state.zone } };
    },
  };
  return { http, state };
}

(async () => {
  // Make the no-network guarantee explicit: no real token or host override in the environment.
  delete process.env.HOSTINGER_API_TOKEN;
  delete process.env.HOSTINGER_API_BASE;

  section("requiredRecords: the four always-present records");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const byType = (t) => recs.filter((r) => r.type === t);
    ok(byType("MX").length === 1, "exactly one MX record");
    ok(byType("TXT").filter((r) => r.name === "@" && r.value.startsWith("v=spf1")).length === 1, "exactly one SPF TXT at @");
    ok(byType("TXT").filter((r) => r.name === "_dmarc").length === 1, "exactly one DMARC TXT at _dmarc");
    ok(byType("CNAME").filter((r) => r.name === "webmail").length === 1, "exactly one webmail CNAME");
    ok(recs.length === 4, "four records in total (DKIM is appended by the caller)");
    const mx = byType("MX")[0];
    ok(mx && mx.value === MAIL_HOST && mx.priority === 10 && mx.name === "@", "MX points at mailHost with priority 10 at @");
    const spf = byType("TXT").find((r) => r.name === "@");
    ok(spf && spf.value === "v=spf1 mx ~all", "SPF is exactly 'v=spf1 mx ~all'");
    const dmarc = byType("TXT").find((r) => r.name === "_dmarc");
    ok(dmarc && dmarc.value === `v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}`, "DMARC is p=none with rua to postmaster@domain");
    const web = byType("CNAME").find((r) => r.name === "webmail");
    ok(web && web.value === "webmail.cloud.murzaktech.tech", "webmail CNAME defaults to webmail.cloud.murzaktech.tech");
    const custom = requiredRecords(DOMAIN, { mailHost: MAIL_HOST, webmailTarget: "web.example.net" })
      .find((r) => r.type === "CNAME");
    ok(custom && custom.value === "web.example.net", "webmailTarget overrides the default");
    let threw = false;
    try { requiredRecords(DOMAIN, {}); } catch (_) { threw = true; }
    ok(threw, "missing mailHost throws rather than guessing an MX target");
  }

  section("verifyRecords: all records present");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, { resolver: goodResolver() });
    ok(res.ok === true, "ok:true when every required record resolves");
    ok(Array.isArray(res.missing) && res.missing.length === 0, "missing is empty");
  }

  section("verifyRecords: missing MX reports label MX");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, {
      resolver: goodResolver({ mx: {} }),
    });
    ok(res.ok === false, "ok:false when MX is absent");
    ok(JSON.stringify(res.missing) === JSON.stringify(["MX"]), "missing is exactly ['MX']");
  }

  section("verifyRecords: missing several records reports each label once");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, {
      resolver: fakeResolver({ mx: { [DOMAIN]: [{ exchange: MAIL_HOST, priority: 10 }] } }),
    });
    ok(res.ok === false, "ok:false when SPF, DMARC and webmail are absent");
    ok(res.missing.includes("SPF") && res.missing.includes("DMARC") && res.missing.includes("webmail"),
      "missing names SPF, DMARC and webmail");
    ok(!res.missing.includes("MX"), "MX is not reported when present");
  }

  section("SPF: order- and whitespace-insensitive, tolerates extra includes");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const spfOk = async (txt) => (await verifyRecords(DOMAIN, recs, {
      resolver: goodResolver({ txt: { [DOMAIN]: [[txt]], [`_dmarc.${DOMAIN}`]: [[`v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}`]] } }),
    })).missing.includes("SPF") === false;
    ok(await spfOk("  v=spf1   mx    ~all "), "extra and irregular whitespace still matches");
    ok(await spfOk("~all mx v=spf1"), "reordered tokens still match");
    ok(await spfOk("v=spf1 include:_spf.google.com mx ~all"), "an extra include is tolerated");
    ok(await spfOk("v=spf1 include:spf.example.net mx include:_spf.x.org ~all"), "several extra includes are tolerated");
    ok(!(await spfOk("v=spf1 mx -all")), "a different all-mechanism (-all) is NOT a match");
    ok(!(await spfOk("v=spf1 include:spf.example.net ~all")), "SPF without mx is NOT a match");
  }

  section("verifyRecords: hostnames compare case-insensitively and ignore a trailing dot");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, {
      resolver: goodResolver({
        mx: { [DOMAIN]: [{ exchange: "MAIL.Cloud.Murzaktech.Tech.", priority: 10 }] },
        cname: { [`webmail.${DOMAIN}`]: ["Webmail.Cloud.Murzaktech.Tech."] },
      }),
    });
    ok(res.ok === true, "MX and CNAME targets match despite case and trailing dot");
  }

  section("verifyRecords: DKIM value appended by the caller is checked too");
  {
    const dkimValue = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";
    const recs = [...requiredRecords(DOMAIN, { mailHost: MAIL_HOST }),
      { type: "TXT", name: "stalwart._domainkey", value: dkimValue }];
    const pass = await verifyRecords(DOMAIN, recs, {
      resolver: goodResolver({ txt: { [DOMAIN]: [["v=spf1 mx ~all"]], [`_dmarc.${DOMAIN}`]: [[`v=DMARC1; p=none; rua=mailto:postmaster@${DOMAIN}`]], [`stalwart._domainkey.${DOMAIN}`]: [[dkimValue.slice(0, 40), dkimValue.slice(40)]] } }),
    });
    ok(pass.ok === true, "DKIM split across TXT chunks matches the value");
    const fail = await verifyRecords(DOMAIN, recs, { resolver: goodResolver() });
    ok(fail.ok === false && fail.missing.includes("DKIM"), "missing DKIM is reported as DKIM");
  }

  section("ensureWebmailCname: writes once, second call is a no-op");
  {
    const { http, state } = fakeHostinger([
      { name: "@", type: "MX", ttl: 300, records: [{ content: MAIL_HOST, priority: 10 }] },
      { name: "www", type: "A", ttl: 300, records: [{ content: "203.0.113.5" }] },
    ]);
    await ensureWebmailCname(DOMAIN, { http, webmailTarget: "webmail.cloud.murzaktech.tech" });
    await ensureWebmailCname(DOMAIN, { http, webmailTarget: "webmail.cloud.murzaktech.tech" });
    ok(state.puts.length === 1, "second call does not write again (one PUT total)");
    ok(state.gets.length === 2, "second call reads the zone and finds the record");
    const put = state.puts[0];
    ok(put && put.overwrite === false, "PUT sends overwrite:false");
    ok(put && put.zone.length === 1 && put.zone[0].name === "webmail" && put.zone[0].type === "CNAME",
      "PUT writes only the webmail CNAME");
    ok(put && put.zone[0].records[0].content === "webmail.cloud.murzaktech.tech", "CNAME points at the webmail target");
    const names = state.zone.map((r) => `${r.name}/${r.type}`);
    ok(names.includes("@/MX") && names.includes("www/A") && names.includes("webmail/CNAME"),
      "existing MX and A records are preserved alongside the new CNAME");
    const zoneUrl = hostingerApi.apiUrl(`${hostingerApi.PATHS.dnsZones}/${DOMAIN}`);
    ok(state.urls.length > 0 && state.urls.every((u) => u === zoneUrl),
      "all calls go to /api/dns/v1/zones/{domain} on the resolved host");
  }

  section("ensureWebmailCname: a conflicting webmail CNAME is refused, not overwritten");
  {
    const { http, state } = fakeHostinger([
      { name: "webmail", type: "CNAME", ttl: 300, records: [{ content: "old.host.example" }] },
    ]);
    let threw = false;
    try { await ensureWebmailCname(DOMAIN, { http, webmailTarget: "webmail.cloud.murzaktech.tech" }); }
    catch (_) { threw = true; }
    ok(threw, "throws when webmail already points somewhere else");
    ok(state.puts.length === 0, "no PUT is sent for a conflicting record");
  }

  section("ensureWebmailCname: refuses to call Hostinger without a token");
  {
    let called = false;
    const http = { async get() { called = true; return { data: [] }; }, async put() { called = true; return {}; } };
    let threw = false;
    try { await ensureWebmailCname(DOMAIN, { webmailTarget: "webmail.cloud.murzaktech.tech" }); }
    catch (_) { threw = true; }
    ok(threw, "throws when no HOSTINGER_API_TOKEN and no injected client");
    ok(!called, "no HTTP call is made");
  }

  section("verifyRecords: ENODATA/ENOTFOUND are a real empty answer, not an error");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    for (const code of ["ENODATA", "ENOTFOUND"]) {
      const res = await verifyRecords(DOMAIN, recs, { resolver: failingResolver(code) });
      ok(res.ok === false, `${code} on every lookup -> ok:false`);
      ok(res.missing.includes("MX") && res.missing.includes("SPF") && res.missing.includes("DMARC") && res.missing.includes("webmail"),
        `${code} -> every record reported missing`);
      ok(Array.isArray(res.errors) && res.errors.length === 0, `${code} -> no errors entries`);
    }
  }

  section("verifyRecords: resolver failures are missing AND reported with their code");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    for (const code of ["ESERVFAIL", "ETIMEOUT", "ECONNREFUSED"]) {
      const res = await verifyRecords(DOMAIN, recs, { resolver: failingResolver(code) });
      ok(res.ok === false, `${code} -> ok:false (fails closed)`);
      ok(res.missing.includes("MX") && res.missing.includes("webmail"), `${code} -> records reported missing`);
      ok(res.errors.some((e) => e.label === "MX" && e.code === code), `${code} -> errors has {label:MX, code}`);
      ok(res.errors.some((e) => e.label === "webmail" && e.code === code), `${code} -> errors has {label:webmail, code}`);
      ok(res.errors.every((e) => Object.keys(e).sort().join(",") === "code,label" && typeof e.code === "string"),
        `${code} -> errors entries carry only label and code, no message`);
    }
  }

  section("verifyRecords: one broken lookup among good ones");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, {
      resolver: {
        ...goodResolver(),
        resolveMx: async () => { const e = new Error("x"); e.code = "ESERVFAIL"; throw e; },
      },
    });
    ok(JSON.stringify(res.missing) === JSON.stringify(["MX"]), "only MX is missing");
    ok(JSON.stringify(res.errors) === JSON.stringify([{ label: "MX", code: "ESERVFAIL" }]),
      "errors is exactly [{label:MX, code:ESERVFAIL}]");
  }

  section("verifyRecords: all good -> ok:true, no errors");
  {
    const recs = requiredRecords(DOMAIN, { mailHost: MAIL_HOST });
    const res = await verifyRecords(DOMAIN, recs, { resolver: goodResolver() });
    ok(res.ok === true && res.errors.length === 0, "ok:true with an empty errors list");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error("Failures:\n - " + fails.join("\n - "));
    process.exit(1);
  }
})().catch((e) => {
  console.error("CRASH", e);
  process.exit(1);
});
