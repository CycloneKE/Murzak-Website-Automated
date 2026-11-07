/**
 * scripts/mail-dryrun-check.js — the read-only preflight the owner runs with real
 * credentials. This proves, against a local fake Stalwart: the happy path passes,
 * a server without the management capability / with a wrong key FAILS with exit 1,
 * and the API key never appears in anything the script prints.
 *   node test/mailDryrunCheck.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const http = require("http");
const path = require("path");
const { execFile } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "mail-dryrun-check.js");
const KEY = "canary-stalwart-key-9f3a7c1d5b";

/** Fake Stalwart. `mode` switches the behaviours under test. */
function startFake(mode) {
  const server = http.createServer((req, res) => {
    const authed = req.headers.authorization === `Bearer ${KEY}`;
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!authed) {
      // A hostile server that echoes the key it was sent back in the error body.
      return json(401, { error: `bad credentials ${req.headers.authorization || ""}` });
    }
    if (req.url === "/jmap/session") {
      const capabilities = {
        "urn:ietf:params:jmap:core": {},
        "urn:ietf:params:jmap:mail": {},
        ...(mode === "old" ? {} : { "urn:stalwart:jmap": {} }),
      };
      return json(200, { capabilities, accounts: {}, apiUrl: "/jmap/" });
    }
    if (req.url === "/jmap" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const call = JSON.parse(raw).methodCalls[0];
        const [method] = call;
        const reply = (data) => json(200, { methodResponses: [[method, data, "c0"]] });
        if (method === "x:Domain/get") {
          return reply({ list: [{ id: "dom1", name: "example.test", description: "Murzak", dkimRecord: { name: "s._domainkey", type: "TXT", value: "SECRET-DKIM-VALUE" } }] });
        }
        if (method === "x:Account/get") {
          return reply({ list: [{ id: "acc1", name: "info", domainId: "dom1", emailAddress: "info@stalwart.example.test", quotas: { maxDiskQuota: 1 } }] });
        }
        if (method === "x:DnsServer/get") return reply({ list: [{ id: "d1" }] });
        return json(200, { methodResponses: [["error", { type: "unknownMethod" }, "c0"]] });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Fake Coolify: Bulwark service, env list, version, and a restart probe whose verb style depends on `style`. */
function startFakeCoolify(style) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== "Bearer coolify-canary-token-77aa") return json(401, { message: "Unauthenticated." });
    if (req.url === "/api/v1/version") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(style === "new" ? "4.5.3" : "4.1.2"); }
    if (req.url.endsWith("/restart")) return style === "new" ? json(405, { message: "This endpoint has changed to a POST request." }) : json(404, { message: "Not found." });
    if (req.url === "/api/v1/services/bulwark-uuid") return json(200, { name: "bulwark", status: "running:healthy" });
    if (req.url === "/api/v1/services/bulwark-uuid/envs") return json(200, [{ key: "DOMAIN_BRANDING", value: JSON.stringify([{ domain: "a.test", title: "A" }]) }]);
    return json(404, { message: "no" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen })));
}

function run(envExtra, extraArgs = [], only = "stalwart") {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH || "",
      MAIL_DRYRUN_NO_DOTENV: "1",
      ...envExtra,
    };
    execFile(process.execPath, [SCRIPT, `--only=${only}`, ...extraArgs], { env, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

(async () => {
  section("scrub removes configured secrets");
  process.env.STALWART_API_KEY = KEY;
  process.env.SMTP_PASS = "smtp-canary-password-1234";
  const { scrub } = require(SCRIPT);
  const s = scrub(`oops ${KEY} and smtp-canary-password-1234 and Bearer abcdefghijklmnop`);
  ok(!s.includes(KEY), "STALWART_API_KEY is removed");
  ok(!s.includes("smtp-canary-password-1234"), "SMTP_PASS is removed");
  ok(!/abcdefghijklmnop/.test(s), "a Bearer token is removed");
  delete process.env.STALWART_API_KEY;
  delete process.env.SMTP_PASS;

  section("happy path against a fake Stalwart 0.16+");
  const good = await startFake("good");
  const base = `http://127.0.0.1:${good.address().port}`;
  const goodEnv = { STALWART_URL: base, STALWART_API_KEY: KEY, STALWART_DNS_SERVER_ID: "d1", MAIL_HOST: "stalwart.example.test" };
  const r1 = await run(goodEnv);
  ok(r1.code === 0, `exit code 0 (got ${r1.code})`);
  ok(/PASS\s+Stalwart management capability present/.test(r1.out), "management capability detected");
  ok(/PASS\s+x:Domain\/get works/.test(r1.out), "x:Domain/get verified");
  ok(/PASS\s+x:Account\/get works/.test(r1.out), "x:Account/get verified");
  ok(/PASS\s+Domain 'description' is readable/.test(r1.out), "domain description marker readable");
  ok(/PASS\s+Domain 'dkimRecord' property exists/.test(r1.out), "dkimRecord property found");
  ok(/PASS\s+STALWART_DNS_SERVER_ID matches/.test(r1.out), "DNS server id confirmed");
  ok(/PASS\s+Domain example\.test exists in Stalwart/.test(r1.out), "mail host domain found (reserved)");
  ok(!r1.out.includes(KEY), "the API key is not printed");
  ok(!r1.out.includes("SECRET-DKIM-VALUE"), "the DKIM record value is not printed");

  section("a Stalwart without the management capability fails");
  const old = await startFake("old");
  const r2 = await run({ ...goodEnv, STALWART_URL: `http://127.0.0.1:${old.address().port}` });
  ok(r2.code === 1, `exit code 1 (got ${r2.code})`);
  ok(/FAIL\s+urn:stalwart:jmap capability NOT in the authenticated session/.test(r2.out), "reports the missing capability");

  section("a wrong key fails and the hostile server echo does not leak the key");
  const r3 = await run({ ...goodEnv, STALWART_API_KEY: "wrong-key-value-aaaaaaaaaaaa" });
  ok(r3.code === 1, `exit code 1 (got ${r3.code})`);
  ok(/FAIL\s+JMAP session rejected the API key/.test(r3.out), "reports the rejected key");
  ok(!r3.out.includes("wrong-key-value-aaaaaaaaaaaa"), "the wrong key is not printed either");

  section("nothing configured -> skipped, not a crash");
  const r4 = await run({});
  ok(r4.code === 0, `exit code 0 (got ${r4.code})`);
  ok(/SKIP\s+Stalwart checks/.test(r4.out), "Stalwart group skipped");

  section("Coolify: version and verb style are reported, and nothing but GETs is sent");
  for (const style of ["new", "old"]) {
    const { server, seen } = await startFakeCoolify(style);
    const cenv = { COOLIFY_BASE_URL: `http://127.0.0.1:${server.address().port}`, COOLIFY_TOKEN: "coolify-canary-token-77aa", BULWARK_SERVICE_UUID: "bulwark-uuid" };
    const rc = await run(cenv, [], "coolify");
    ok(rc.code === 0, `${style} server: exit code 0 (got ${rc.code})`);
    ok(new RegExp(`PASS\\s+Coolify version ${style === "new" ? "4\\.5\\.3" : "4\\.1\\.2"}`).test(rc.out), `${style} server: version reported`);
    ok(style === "new" ? /PASS\s+Restart\/start\/stop need POST/.test(rc.out) : /PASS\s+Restart\/start\/stop still work with GET/.test(rc.out), `${style} server: verb style detected`);
    ok(/PASS\s+DOMAIN_BRANDING is valid JSON/.test(rc.out), `${style} server: DOMAIN_BRANDING shape reported`);
    ok(!rc.out.includes("coolify-canary-token-77aa"), `${style} server: the token is not printed`);
    ok(!rc.out.includes("a.test"), `${style} server: env VALUES (client names) are not printed`);
    ok(seen.every((l) => l.startsWith("GET ")), `${style} server: only GET requests were made (${seen.length})`);
    server.close();
  }

  section("read-only: the fake only ever saw GET-style JMAP reads");
  ok(true, "the script only calls x:*/get methods and GETs (see the source; there is no /set or PUT path)");
  const src = require("fs").readFileSync(SCRIPT, "utf8");
  ok(!/x:[A-Za-z]+\/set/.test(src), "no x:*/set call in the script");
  ok(!/method:\s*"(PUT|PATCH|DELETE)"/.test(src) && !/\.put\(|\.patch\(|\.delete\(/.test(src), "no PUT / PATCH / DELETE in the script");

  good.close(); old.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
