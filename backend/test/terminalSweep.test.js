/**
 * Retention sweep orchestration test — mocked Frappe + S3, no real network.
 * The underlying isExpired() logic is already exhaustively covered in
 * terminalRetention.test.js; this checks the sweep wires it up correctly:
 * purges what's expired, skips what isn't, survives per-row failures, and
 * degrades gracefully if the doctype doesn't exist yet.
 */

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { sweepExpiredRecordings } = require("../services/terminal/retentionSweep");

function makeMockClient(rows, { failPutFor = new Set() } = {}) {
  const puts = [];
  return {
    get: async () => ({ data: { data: rows } }),
    put: async (url, body) => {
      const name = decodeURIComponent(url.split("/").pop());
      if (failPutFor.has(name)) throw new Error(`simulated PUT failure for ${name}`);
      puts.push({ name, body });
      return { data: { data: {} } };
    },
    _puts: puts,
  };
}

function makeMockS3({ failDeleteFor = new Set() } = {}) {
  const deleted = [];
  return {
    isConfigured: () => true,
    deleteObject: async (key) => {
      if (failDeleteFor.has(key)) throw new Error(`simulated delete failure for ${key}`);
      deleted.push(key);
    },
    _deleted: deleted,
  };
}

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("# sweepExpiredRecordings — purges only what's actually expired");
  {
    const rows = [
      { name: "TERM-A", retention_tier: "routine", expires_at: new Date(NOW - DAY).toISOString(), recording_key: "rec/a.ndjson", purged: 0 }, // expired
      { name: "TERM-B", retention_tier: "routine", expires_at: new Date(NOW + DAY).toISOString(), recording_key: "rec/b.ndjson", purged: 0 }, // not yet
    ];
    const mockClient = makeMockClient(rows);
    const mockS3 = makeMockS3();
    const summary = await sweepExpiredRecordings({ frappeClient: () => mockClient, s3Client: mockS3, now: NOW });

    ok(summary.checked === 2, "checked both candidate rows");
    ok(summary.purged === 1, "purged exactly the one that's actually expired");
    ok(mockS3._deleted.includes("rec/a.ndjson"), "deleted the expired session's S3 object");
    ok(!mockS3._deleted.includes("rec/b.ndjson"), "did NOT delete the not-yet-expired session's object");
    ok(mockClient._puts.some((p) => p.name === "TERM-A" && p.body.purged === 1), "marked TERM-A purged in Frappe");
    ok(!mockClient._puts.some((p) => p.name === "TERM-B"), "did not touch TERM-B's doctype row");
  }

  console.log("# sweepExpiredRecordings — one bad row doesn't block the rest");
  {
    const rows = [
      { name: "TERM-C", retention_tier: "routine", expires_at: new Date(NOW - DAY).toISOString(), recording_key: "rec/c.ndjson", purged: 0 },
      { name: "TERM-D", retention_tier: "routine", expires_at: new Date(NOW - DAY).toISOString(), recording_key: "rec/d.ndjson", purged: 0 },
    ];
    const mockClient = makeMockClient(rows, { failPutFor: new Set(["TERM-C"]) });
    const mockS3 = makeMockS3();
    const summary = await sweepExpiredRecordings({ frappeClient: () => mockClient, s3Client: mockS3, now: NOW });

    ok(summary.errors === 1, "one failure counted");
    ok(summary.purged === 1, "the OTHER row still got purged despite the first one failing");
    ok(mockClient._puts.some((p) => p.name === "TERM-D"), "TERM-D was purged even though TERM-C's write failed");
  }

  console.log("# sweepExpiredRecordings — degrades gracefully if the doctype doesn't exist yet");
  {
    const missingDoctypeClient = {
      get: async () => { const e = new Error("not found"); e.response = { status: 404 }; throw e; },
    };
    const summary = await sweepExpiredRecordings({ frappeClient: () => missingDoctypeClient, s3Client: makeMockS3(), now: NOW });
    ok(summary.errors === 0 && summary.purged === 0, "missing doctype -> empty summary, not a crash");
  }

  console.log(`\nTERMINAL SWEEP TESTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL GREEN");
}

main();
