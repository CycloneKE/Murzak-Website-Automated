/**
 * Connection-details parsing for the database connection route — the pure
 * part (safely reading engine/host/port/database/username/password out of a
 * job's stored `access` JSON, including the "password unknown" recovery
 * case) split out so it's testable without an Express harness (this
 * codebase has none). node test/databaseConnectionRoutes.test.js
 */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}

const { parseDbConnectionAccess } = require("../services/storage/dbConnection");

console.log("# parseDbConnectionAccess — normal case");
{
  const access = JSON.stringify({
    lane: "coolify", engine: "mysql", host: "acct1-db-mysql", port: 3306,
    database: "app", username: "root", password: "sekret123",
  });
  const r = parseDbConnectionAccess(access);
  ok(r.engine === "mysql" && r.port === 3306 && r.password === "sekret123", "full connection details round-trip");
}

console.log("# parseDbConnectionAccess — recovered service, password unknown");
{
  const access = JSON.stringify({ lane: "coolify", host: "acct1-db-mysql", uuid: "EXISTING-1" });
  const r = parseDbConnectionAccess(access);
  ok(r === null || r.password == null, "no engine/password on a recovered-without-db-fields access blob -> never fabricates a credential");
}

console.log("# parseDbConnectionAccess — malformed/missing access never throws");
{
  ok(parseDbConnectionAccess("") === null, "empty string -> null, not a throw");
  ok(parseDbConnectionAccess("not json") === null, "malformed JSON -> null, not a throw");
  ok(parseDbConnectionAccess(undefined) === null, "undefined -> null");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL GREEN");
