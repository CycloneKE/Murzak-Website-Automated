/**
 * Unit tests for the shared Hostinger API host resolver — runs without network.
 *   node test/hostingerApi.test.js   (or: npm test)
 *
 * Why this exists: HOSTINGER_API_BASE used to be read by three consumers that
 * each appended paths differently, so NO single env value was correct for all of
 * them. server.js wanted the base to INCLUDE /api; scaling.js and aiService.js
 * wanted it to EXCLUDE /api and both defaulted to api.hostinger.com, which is
 * not the API host at all (it answers 530 on every path) — so those calls had
 * never once worked, and the failures were swallowed by catch blocks.
 *
 * The fix is one resolver that normalizes the env var to a bare host, with every
 * caller appending the full documented "/api/<group>/v1/..." path. These tests
 * pin the EXACT url each consumer sends for every form the env var takes in the
 * wild — including the known-bad api.hostinger.com — by stubbing axios, so a
 * future "tidy-up" of either the resolver or a call site can't silently
 * reintroduce a base/path mismatch.
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg}${actual === expected ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}
function section(name) { console.log(`\n# ${name}`); }

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { resolveHost, apiUrl, PATHS, DEFAULT_HOST, checkDomainAvailability } = require("../services/hostingerApi");
const { triggerHostingerProvision } = require("../services/provisioning/scaling");
const hostingerMail = require("../services/hostingerMail");

const DEV_HOST = "https://developers.hostinger.com";

// Every shape HOSTINGER_API_BASE is known to arrive in, and the bare host each
// must collapse to. The first three are the forms the old consumers disagreed
// about; the api.hostinger.com rows are the value .env.example used to ship.
const ENV_FORMS = [
  { label: "unset", value: undefined, host: DEV_HOST },
  { label: "empty string", value: "", host: DEV_HOST },
  { label: "bare host", value: "https://developers.hostinger.com", host: DEV_HOST },
  { label: "host + /api (what server.js wanted)", value: "https://developers.hostinger.com/api", host: DEV_HOST },
  { label: "host + /api + trailing slash", value: "https://developers.hostinger.com/api/", host: DEV_HOST },
  { label: "host + trailing slashes", value: "https://developers.hostinger.com//", host: DEV_HOST },
  { label: "surrounding whitespace", value: "  https://developers.hostinger.com/api  ", host: DEV_HOST },
  { label: "the bad api.hostinger.com (530s on every path)", value: "https://api.hostinger.com", host: DEV_HOST },
  { label: "the bad api.hostinger.com + /api", value: "https://api.hostinger.com/api", host: DEV_HOST },
  { label: "the bad api.hostinger.com, mixed case + slash", value: "https://API.Hostinger.com/", host: DEV_HOST },
  { label: "a local mock host", value: "http://127.0.0.1:9099", host: "http://127.0.0.1:9099" },
  { label: "a local mock host + /api", value: "http://127.0.0.1:9099/api", host: "http://127.0.0.1:9099" },
];

function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "HOSTINGER_API_BASE");
  const prev = process.env.HOSTINGER_API_BASE;
  if (value === undefined) delete process.env.HOSTINGER_API_BASE;
  else process.env.HOSTINGER_API_BASE = value;
  try {
    return fn();
  } finally {
    if (had) process.env.HOSTINGER_API_BASE = prev;
    else delete process.env.HOSTINGER_API_BASE;
  }
}

// Capture the url each consumer actually hands to axios. Consumers call either
// axios.post directly or axios.create().get(), so patch both — the recorded
// `config` folds an instance's baseURL in with the per-request config, which is
// what makes the mail wrapper's baseURL+path split assertable. Patching the
// shared module object is enough: no require-cache surgery, and every line of
// the consumer's own code still runs.
function captureAxios(response) {
  const calls = [];
  const real = { post: axios.post, get: axios.get, create: axios.create };
  const bodyMethods = new Set(["post", "put", "patch"]);
  function recorder(method, instanceConfig) {
    return async (url, a, b) => {
      const withBody = bodyMethods.has(method);
      calls.push({
        method,
        url,
        body: withBody ? a : undefined,
        config: { ...(instanceConfig || {}), ...((withBody ? b : a) || {}) },
      });
      return response;
    };
  }
  axios.post = recorder("post");
  axios.get = recorder("get");
  axios.create = (instanceConfig) => ({
    get: recorder("get", instanceConfig),
    post: recorder("post", instanceConfig),
    patch: recorder("patch", instanceConfig),
    delete: recorder("delete", instanceConfig),
  });
  return {
    calls,
    restore() { axios.post = real.post; axios.get = real.get; axios.create = real.create; },
  };
}

(async () => {
  section("resolveHost — one bare host, whatever the env var says");
  eq(DEFAULT_HOST, DEV_HOST, "DEFAULT_HOST is the real API host (developers.hostinger.com)");
  for (const form of ENV_FORMS) {
    withEnv(form.value, () => eq(resolveHost(), form.host, `${form.label} -> ${form.host}`));
  }
  withEnv("https://api.hostinger.com", () =>
    ok(resolveHost() !== "https://api.hostinger.com", "never returns api.hostinger.com — it is not the API host")
  );

  section("apiUrl — callers append the full documented /api/... path");
  withEnv(undefined, () => {
    eq(apiUrl("/api/dns/v1/zones/example.co.ke"), `${DEV_HOST}/api/dns/v1/zones/example.co.ke`, "joins a leading-slash path");
    eq(apiUrl("api/dns/v1/zones"), `${DEV_HOST}/api/dns/v1/zones`, "tolerates a path with no leading slash");
    eq(apiUrl(""), DEV_HOST, "empty path is just the host");
  });
  withEnv("https://developers.hostinger.com/api", () =>
    eq(apiUrl("/api/billing/v1/catalog"), `${DEV_HOST}/api/billing/v1/catalog`, "does not double the /api segment")
  );

  section("PATHS — the documented paths, spelled once");
  eq(PATHS.domainAvailability, "/api/domains/v1/availability", "domain availability path");
  eq(PATHS.vpsVirtualMachines, "/api/vps/v1/virtual-machines", "VPS create path");

  section("consumer: domain availability (was server.js) posts the exact url");
  for (const form of ENV_FORMS) {
    const cap = captureAxios({ data: { data: [{ domain: "murzak.co.ke", is_available: true }] } });
    let result;
    try {
      result = await withEnv(form.value, () => {
        process.env.HOSTINGER_API_TOKEN = "test-token";
        return checkDomainAvailability("murzak", [".co.ke"]);
      });
    } finally {
      cap.restore();
      delete process.env.HOSTINGER_API_TOKEN;
    }
    eq(cap.calls[0]?.url, `${form.host}/api/domains/v1/availability`, `availability url with env=${form.label}`);
    ok(result instanceof Map && result.get("murzak.co.ke") === true, `availability still parses the response (env=${form.label})`);
  }

  section("consumer: autoscale VPS create (scaling.js) posts the exact url");
  for (const form of ENV_FORMS) {
    const cap = captureAxios({ data: { data: { id: 4242 } } });
    let result;
    try {
      result = await withEnv(form.value, () => {
        process.env.HOSTINGER_API_TOKEN = "test-token";
        process.env.PROVISIONING_AUTOSCALE = "true";
        return triggerHostingerProvision({ reason: "unit test" });
      });
    } finally {
      cap.restore();
      delete process.env.HOSTINGER_API_TOKEN;
      delete process.env.PROVISIONING_AUTOSCALE;
    }
    eq(cap.calls[0]?.url, `${form.host}/api/vps/v1/virtual-machines`, `VPS create url with env=${form.label}`);
    ok(result.triggered === true && result.ref === "4242", `VPS create still returns the ref (env=${form.label})`);
  }

  section("consumer: domain availability sends auth + the documented body");
  {
    const cap = captureAxios({ data: { data: [] } });
    try {
      await withEnv(undefined, () => {
        process.env.HOSTINGER_API_TOKEN = "test-token";
        return checkDomainAvailability("murzak", [".co.ke", ".com"]);
      });
    } finally {
      cap.restore();
      delete process.env.HOSTINGER_API_TOKEN;
    }
    eq(cap.calls[0]?.config?.headers?.Authorization, "Bearer test-token", "sends the bearer token");
    eq(cap.calls[0]?.body?.domain, "murzak", "sends the bare label");
    eq(JSON.stringify(cap.calls[0]?.body?.tlds), JSON.stringify(["co.ke", "com"]), "strips the leading dot from tlds");
  }

  section("consumer: mail provisioning (hostingerMail.js) resolves the same host");
  for (const form of ENV_FORMS) {
    withEnv(form.value, () =>
      eq(hostingerMail.resolveHost(), form.host, `mail resolveHost with env=${form.label}`)
    );
  }
  {
    // hostingerMail builds its urls through an axios instance's baseURL, so pin
    // the joined result rather than the host alone — a bare-host baseURL plus a
    // "/api/mail/v1/..." path is the only combination that lands on the API.
    const cap = captureAxios({ data: { data: [] } });
    let orders;
    try {
      orders = await withEnv("https://api.hostinger.com", () => {
        process.env.HOSTINGER_API_TOKEN = "test-token";
        return hostingerMail.listOrders();
      });
    } finally {
      cap.restore();
      delete process.env.HOSTINGER_API_TOKEN;
    }
    const call = cap.calls[0];
    eq(
      `${call?.config?.baseURL || ""}${call?.url || ""}`,
      `${DEV_HOST}/api/mail/v1/orders`,
      "mail order listing lands on the real host even from a stale api.hostinger.com"
    );
    ok(Array.isArray(orders), "mail order listing still returns an array");
  }

  section("no consumer reads HOSTINGER_API_BASE directly any more");
  // Reading the env var is what's banned, not naming it — the comments that
  // explain the contract should keep saying it out loud.
  const root = path.join(__dirname, "..");
  for (const rel of ["server.js", "services/provisioning/scaling.js", "services/aiService.js", "services/hostingerMail.js"]) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    ok(!src.includes("process.env.HOSTINGER_API_BASE"), `${rel} resolves the host through the shared helper`);
  }
  const helper = fs.readFileSync(path.join(root, "services/hostingerApi.js"), "utf8");
  eq(
    (helper.match(/process\.env\.HOSTINGER_API_BASE/g) || []).length,
    1,
    "the helper is the one and only reader of the env var"
  );

  section("aiService no longer fabricates infrastructure metrics");
  const ai = fs.readFileSync(path.join(root, "services/aiService.js"), "utf8");
  ok(!/disk_usage_percent/.test(ai), "no invented disk_usage_percent in the AI tool result");
  ok(!/cpu_usage_percent/.test(ai), "no invented cpu_usage_percent in the AI tool result");
  ok(!/upsell demo/i.test(ai), "the hardcoded upsell-demo values are gone");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.error("\nFailures:");
    for (const f of fails) console.error(" -", f);
    process.exit(1);
  }
})().catch((e) => {
  console.error("test harness crashed:", e);
  process.exit(1);
});
