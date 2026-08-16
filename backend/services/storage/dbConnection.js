/**
 * Pure parsing of a Provisioning Job's stored `access` JSON into the shape
 * the connection-details route returns. Split out of the route so the "does
 * this access blob actually carry database credentials" logic is
 * independently testable — a job recovered after a crash (see
 * coolify.js provision()'s idempotency path) may have NO db fields at all,
 * and this must degrade honestly, never fabricate a credential.
 */
function parseDbConnectionAccess(accessJson) {
  if (!accessJson) return null;
  let access;
  try {
    access = JSON.parse(accessJson);
  } catch {
    return null;
  }
  if (!access || typeof access !== "object" || !access.engine) return null;
  return {
    engine: access.engine,
    host: access.host || null,
    port: access.port || null,
    database: access.database || null,
    username: access.username || null,
    password: access.password || null,
  };
}

module.exports = { parseDbConnectionAccess };
