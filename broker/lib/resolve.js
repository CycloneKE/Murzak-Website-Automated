/**
 * Container ownership resolution — the security-critical core of the broker.
 *
 * The whole terminal feature's tenant isolation reduces to one question:
 * "does this container belong to the tenant the token was minted for?" A bug
 * here = exec into the WRONG tenant's container. So the matching is:
 *   - EXACT, never prefix/substring (tenant `acme-shop` must NOT match
 *     `acme-shop-admin` or `acme-shop-db`).
 *   - Against the ownership name the backend baked into the token at mint
 *     time (`resourceName(job)` = `${web_account}-${service_id}` slugified),
 *     which is what the coolify lane names/labels the container with.
 *
 * These are pure functions with no Docker/network/env access so they can be
 * unit-tested exhaustively — the dangerous logic must be the tested logic.
 */

/**
 * The label keys Coolify/Docker Compose stamp on a managed container. We check
 * the container NAME and these labels; a match on any ONE is only accepted if
 * it is an EXACT string equality with the expected ownership name.
 */
const OWNERSHIP_LABEL_KEYS = [
  "coolify.name",
  "coolify.serviceName",
  "com.docker.compose.service",
  "com.docker.compose.project",
];

/** Docker container names come back from the API prefixed with "/". */
function normalizeContainerNames(names) {
  return (Array.isArray(names) ? names : [])
    .map((n) => String(n || "").replace(/^\/+/, ""))
    .filter(Boolean);
}

/**
 * Does this container (as returned by GET /containers/json) belong to
 * `expectedName`? EXACT match on name or a known ownership label only.
 * Returns true/false — never "close enough".
 */
function containerMatchesOwner(container, expectedName) {
  if (!container || typeof expectedName !== "string" || !expectedName) return false;

  const names = normalizeContainerNames(container.Names);
  if (names.includes(expectedName)) return true;

  const labels = container.Labels || {};
  for (const key of OWNERSHIP_LABEL_KEYS) {
    if (labels[key] !== undefined && labels[key] === expectedName) return true;
  }
  return false;
}

/**
 * From a list of containers (GET /containers/json output), find the ONE that
 * exactly owns `expectedName`. Returns { id } on a unique match, or throws —
 * ambiguity (0 or >1 matches) is a hard failure, never a guess, because both
 * "none" and "several" mean we cannot prove ownership.
 */
function resolveOwnedContainerId(containers, expectedName) {
  const matches = (Array.isArray(containers) ? containers : []).filter((c) =>
    containerMatchesOwner(c, expectedName)
  );
  if (matches.length === 0) {
    const err = new Error(`No container found for "${expectedName}".`);
    err.code = "NO_MATCH";
    throw err;
  }
  if (matches.length > 1) {
    // Multiple exact matches must never be silently picked — refuse.
    const err = new Error(`Ambiguous ownership: ${matches.length} containers match "${expectedName}".`);
    err.code = "AMBIGUOUS";
    throw err;
  }
  const id = matches[0].Id || matches[0].id;
  if (!id) {
    const err = new Error(`Matched container for "${expectedName}" has no id.`);
    err.code = "NO_ID";
    throw err;
  }
  return { id: String(id) };
}

module.exports = {
  OWNERSHIP_LABEL_KEYS,
  normalizeContainerNames,
  containerMatchesOwner,
  resolveOwnedContainerId,
};
