/**
 * External TCP port allocator for Database Hosting jobs (phase 2 — see
 * docs/superpowers/specs/2026-08-16-database-remote-access-phase2-design.md).
 * node test/dbPortAllocator.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

async function withEnvAsync(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const { allocatePort, rangeStart, rangeEnd } = require("../services/provisioning/dbPortAllocator");

(async () => {
  section("range defaults and overrides");
  {
    ok(rangeStart() === 33000, "default range start is 33000");
    ok(rangeEnd() === 33999, "default range end is 33999");
    await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "40000", DB_EXTERNAL_PORT_RANGE_END: "40002" }, () => {
      ok(rangeStart() === 40000 && rangeEnd() === 40002, "env vars override the default range");
    });
  }

  section("allocatePort — picks the lowest free port, skipping ones already in use");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33005" }, async () => {
    const client = {
      get: async () => ({
        data: {
          data: [
            { external_port: 33000 },
            { external_port: 33001 },
            { external_port: 0 }, // never-allocated rows report 0 — must not be treated as "port 0 in use"
          ],
        },
      }),
    };
    const port = await allocatePort(client);
    ok(port === 33002, `first free port after 33000/33001 are taken (got ${port})`);
  });

  section("allocatePort — honors the exclude set (same-batch reservations)");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33002" }, async () => {
    const client = { get: async () => ({ data: { data: [] } }) };
    const port = await allocatePort(client, { exclude: new Set([33000, 33001]) });
    ok(port === 33002, `skips ports reserved earlier in the same enqueue batch (got ${port})`);
  });

  section("allocatePort — range exhausted -> null, never reuses a port");
  await withEnvAsync({ DB_EXTERNAL_PORT_RANGE_START: "33000", DB_EXTERNAL_PORT_RANGE_END: "33001" }, async () => {
    const client = { get: async () => ({ data: { data: [{ external_port: 33000 }, { external_port: 33001 }] } }) };
    const port = await allocatePort(client);
    ok(port === null, "exhausted range returns null, doesn't wrap around or double-assign");
  });

  section("allocatePort — a failed query fails closed, never throws");
  {
    const client = { get: async () => { throw new Error("frappe down"); } };
    let threw = false;
    let port;
    try { port = await allocatePort(client); } catch { threw = true; }
    ok(!threw, "a query failure does not throw");
    ok(port === null, "a query failure returns null (cannot prove a port is free, so cannot safely hand one out)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
})();
