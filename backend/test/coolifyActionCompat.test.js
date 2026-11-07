/**
 * Coolify start / restart / stop across server versions.
 *
 * Coolify 4.1.2 (verified live) only knows GET for these. Newer Coolify (4.5.x, read
 * in the fork's source) answers a GET with 405 "This endpoint has changed to a POST
 * request" and only acts on POST. The lane must work on both: GET first, and on a 405
 * repeat the same path as POST; any other failure is not retried.
 *   node test/coolifyActionCompat.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const fs = require("fs");
const path = require("path");
const axios = require("axios");

process.env.COOLIFY_BASE_URL = "http://coolify.test";
process.env.COOLIFY_TOKEN = "test-token-not-real";
process.env.COOLIFY_PROJECT_UUID = "proj";
process.env.COOLIFY_SERVER_UUID = "srv";

const coolify = require("../services/provisioning/lanes/coolify");

function httpError(status) {
  const e = new Error(`Request failed with status code ${status}`);
  e.response = { status, data: { message: status === 405 ? "This endpoint has changed to a POST request." : "x" } };
  return e;
}

/** A fake axios instance that records calls. `mode` decides how the server behaves. */
function fakeServer(mode) {
  const calls = [];
  const client = {
    async get(url) {
      calls.push(["GET", url]);
      if (mode === "old") return { data: { message: "Restart request queued.", via: "get" } };
      if (mode === "new") throw httpError(405);
      if (mode === "broken") throw httpError(500);
      if (mode === "missing") throw httpError(404);
      throw new Error("bad mode");
    },
    async post(url, body) {
      calls.push(["POST", url, body]);
      return { data: { message: "Restart request queued.", via: "post" } };
    },
  };
  return { client, calls };
}

async function withClient(client, fn) {
  const orig = axios.create;
  axios.create = () => client;
  try { return await fn(); } finally { axios.create = orig; }
}

(async () => {
  section("old server (GET works): behaviour is unchanged, no POST is sent");
  {
    const { client, calls } = fakeServer("old");
    const r = await withClient(client, () => coolify.restart("svc-1", { kind: "service" }));
    ok(r && r.via === "get", "restart returns the GET response");
    ok(calls.length === 1 && calls[0][0] === "GET", "exactly one GET");
    ok(calls[0][1] === "/api/v1/services/svc-1/restart", "service restart path is unchanged");
  }

  section("new server (GET answers 405): the same path is repeated as POST");
  for (const [fn, verb] of [["restart", "restart"], ["start", "start"], ["stop", "stop"]]) {
    const { client, calls } = fakeServer("new");
    const r = await withClient(client, () => coolify[fn]("svc-2", { kind: "service" }));
    ok(r && r.via === "post", `${fn} returns the POST response`);
    ok(calls.length === 2 && calls[0][0] === "GET" && calls[1][0] === "POST", `${fn}: GET then POST`);
    ok(calls[1][1] === `/api/v1/services/svc-2/${verb}`, `${fn}: POST goes to the same path`);
    ok(JSON.stringify(calls[1][2]) === "{}", `${fn}: POST sends an empty JSON body`);
  }

  section("applications use the applications path on both versions");
  {
    const { client, calls } = fakeServer("new");
    await withClient(client, () => coolify.restart("app-1", { kind: "application" }));
    ok(calls[1][1] === "/api/v1/applications/app-1/restart", "application restart POST path");
  }

  section("other failures are not retried as POST");
  {
    const { client, calls } = fakeServer("broken");
    let err = null;
    try { await withClient(client, () => coolify.restart("svc-3", { kind: "service" })); } catch (e) { err = e; }
    ok(err && err.response.status === 500, "a 500 is thrown unchanged");
    ok(calls.length === 1, "no POST after a 500");
  }
  {
    const { client, calls } = fakeServer("missing");
    let err = null;
    try { await withClient(client, () => coolify.stop("svc-4", { kind: "service" })); } catch (e) { err = e; }
    ok(err && err.response.status === 404, "a 404 is thrown unchanged (a wrong uuid is not retried)");
    ok(calls.length === 1, "no POST after a 404");
  }

  section("the two other call sites use the same helper (source pin)");
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "services", "provisioning", "lanes", "coolify.js"), "utf8");
    const raw = src.match(/client\.get\(\s*[`"'][^`"']*\/(start|restart|stop)[`"']/g) || [];
    ok(raw.length === 0, `no raw client.get(.../start|restart|stop) is left (found ${raw.length})`);
    ok((src.match(/runResourceAction\(/g) || []).length >= 4, "the helper is used by start, restart-after-attach and resourceAction");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
