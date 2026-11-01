/**
 * Webmail (Bulwark) branding queue.
 *
 * Bulwark is one Coolify service shared by every business-email client. Adding
 * a client means: (a) rewrite the service's full comma-separated address list,
 * (b) PATCH-or-POST the DOMAIN_BRANDING env built from EVERY active client,
 * (c) restart the service, (d) poll https://webmail.<domain> for the cert.
 *
 * A restart takes webmail offline for everyone, so all writes go through one
 * in-process queue: orders that arrive together share a merge window and one
 * restart. A partial list would erase other clients' branding, so the queue
 * refuses to write anything that would shrink the stored list.
 *
 * Convergence: after a SUCCESSFUL restart the queue persists DOMAIN_BRANDING_APPLIED,
 * a hash of the branding and address list that is actually running. A retry
 * after a failed restart therefore sees a stale marker and restarts again.
 *
 * Env: BULWARK_SERVICE_UUID (required), BULWARK_APP_UUID (optional),
 *      BULWARK_MERGE_MS (default 20000), BULWARK_CONTAINER_NAME (optional, fallback path only).
 *
 * Secrets: nothing here logs env values or tokens. Domains and titles are logged.
 */
const crypto = require("crypto");
const axios = require("axios");
const { ORDER_DOCTYPE } = require("../checkout/orderStore");

const BRANDING_KEY = "DOMAIN_BRANDING";
const APPLIED_KEY = "DOMAIN_BRANDING_APPLIED";
const ACTIVE_STATES = new Set(["provisioned", "live", "active"]);
const POLL_INTERVAL_MS = 15000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10000;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function mergeWindowMs() {
  const n = Number(process.env.BULWARK_MERGE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 20000;
}

function normalizeDomain(raw) {
  const d = String(raw || "").trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) throw new Error(`webmail branding: invalid domain "${String(raw).slice(0, 80)}"`);
  return d;
}

function normalizeClient(c) {
  const domain = normalizeDomain(c?.domain);
  const title = String(c?.title || "").trim() || domain;
  const out = { domain, title };
  const logo = String(c?.logoUrl || "").trim();
  if (logo) out.logoUrl = logo;
  return out;
}

/**
 * Addresses (comma-separated `webmail.<domain>`) and branding JSON for a set of
 * clients. Stable: sorted by domain, one entry per domain (first one wins).
 */
function buildBranding(clients) {
  const byDomain = new Map();
  for (const c of clients || []) {
    const n = normalizeClient(c);
    if (!byDomain.has(n.domain)) byDomain.set(n.domain, n);
  }
  const sorted = [...byDomain.values()].sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  return {
    addresses: sorted.map((c) => `webmail.${c.domain}`).join(","),
    brandingJson: JSON.stringify(sorted),
  };
}

/** Short fingerprint of what is actually running: branding value plus address list. */
function appliedMarker(addresses, brandingJson) {
  return crypto.createHash("sha256").update(`${addresses}\n${brandingJson}`).digest("hex").slice(0, 16);
}

/** Active mail clients from Checkout Orders (mailSetup.state provisioned | live | active). */
async function loadActiveClients(client) {
  const res = await client.get(`/api/resource/${ORDER_DOCTYPE}`, {
    params: {
      fields: JSON.stringify(["name", "status", "config_json"]),
      limit_page_length: 0,
    },
  });
  const rows = res.data?.data || [];
  const out = [];
  for (const row of rows) {
    let mailSetup = null;
    try {
      const cfg = typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json;
      mailSetup = cfg?.mailSetup || null;
    } catch (_) {
      continue; // unreadable order config: not an active client we can brand
    }
    if (!mailSetup || !ACTIVE_STATES.has(mailSetup.state)) continue;
    try {
      out.push(normalizeClient({
        domain: mailSetup.domain,
        title: mailSetup.businessName,
        logoUrl: mailSetup.logoUrl,
      }));
    } catch (_) {
      continue; // malformed domain on an active row: skip, never brand a bad host
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ *
 * Address list on the Bulwark service.
 *
 * UNVERIFIED-LIVE. Nothing here has been exercised against the real Coolify
 * instance (it is IP-allowlisted to the VPS). Two forms are in play:
 *   1. The spec form, when BULWARK_APP_UUID is set:
 *      PATCH /api/v1/services/{uuid}/applications/{app_uuid}  { fqdn }
 *   2. The repo-verified form (attachServiceUrl in lanes/coolify.js):
 *      PATCH /api/v1/services/{uuid}  { urls: [{ name, url }] }
 * Confirm the right one on the box before the first real client. To swap the
 * implementation, change only setBulwarkAddresses / the two helpers below.
 * ------------------------------------------------------------------------ */
function coolifyHttp() {
  return axios.create({
    baseURL: String(process.env.COOLIFY_BASE_URL || "").replace(/\/+$/, ""),
    headers: {
      Authorization: `Bearer ${process.env.COOLIFY_TOKEN || ""}`,
      "Content-Type": "application/json",
    },
    timeout: Number(process.env.COOLIFY_TIMEOUT_MS || 30000),
  });
}

async function patchServiceApplicationFqdns(serviceUuid, appUuid, fqdnCsv) {
  await coolifyHttp().patch(
    `/api/v1/services/${encodeURIComponent(serviceUuid)}/applications/${encodeURIComponent(appUuid)}`,
    { fqdn: fqdnCsv }
  );
}

async function patchServiceUrls(serviceUuid, fqdnCsv) {
  const name = process.env.BULWARK_CONTAINER_NAME || "bulwark";
  await coolifyHttp().patch(`/api/v1/services/${encodeURIComponent(serviceUuid)}`, {
    urls: [{ name, url: fqdnCsv }],
  });
}

/** UNVERIFIED-LIVE: see the block comment above. `addresses` is "webmail.a,webmail.b". */
async function setBulwarkAddresses(serviceUuid, addresses, { appUuid } = {}) {
  if (!addresses) return; // never send an empty list: that would strip every address
  const fqdnCsv = addresses.split(",").map((a) => `https://${a}`).join(",");
  if (appUuid) return patchServiceApplicationFqdns(serviceUuid, appUuid, fqdnCsv);
  return patchServiceUrls(serviceUuid, fqdnCsv);
}

function resolveDeps(deps = {}) {
  const d = {
    coolify: deps.coolify || require("../provisioning/lanes/coolify"),
    loadActiveClients: deps.loadActiveClients || loadActiveClients,
    fetch: deps.fetch || ((url, init) => fetch(url, init)),
    sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    clock: deps.clock || (() => Date.now()),
    serviceUuid: deps.serviceUuid ?? process.env.BULWARK_SERVICE_UUID,
    appUuid: deps.appUuid ?? process.env.BULWARK_APP_UUID,
    mergeMs: deps.mergeMs ?? mergeWindowMs(),
    pollIntervalMs: deps.pollIntervalMs ?? POLL_INTERVAL_MS,
    pollTimeoutMs: deps.pollTimeoutMs ?? POLL_TIMEOUT_MS,
  };
  d.setBulwarkAddresses = deps.setBulwarkAddresses
    || ((uuid, addresses) => setBulwarkAddresses(uuid, addresses, { appUuid: d.appUuid }));
  return d;
}

/** Stored domains, raw DOMAIN_BRANDING value and the applied marker. Throws if unreadable. */
async function readStoredBranding(d) {
  const rows = await d.coolify.listEnvs(d.serviceUuid);
  const row = rows.find((e) => e.key === BRANDING_KEY) || null;
  const appliedRow = rows.find((e) => e.key === APPLIED_KEY) || null;
  const applied = appliedRow?.value || "";
  if (!row || !row.value) return { row, appliedRow, domains: [], brandingJson: "", applied };
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch (_) {
    throw new Error("webmail branding: refusing to shrink branding: stored DOMAIN_BRANDING is unreadable");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("webmail branding: refusing to shrink branding: stored DOMAIN_BRANDING is not a list");
  }
  const domains = parsed.map((c) => String(c?.domain || "").toLowerCase()).filter(Boolean);
  return { row, appliedRow, domains, brandingJson: row.value, applied };
}

async function writeEnvValue(d, key, value, existingRow) {
  const payload = { key, value };
  if (existingRow) await d.coolify.updateEnv(d.serviceUuid, payload);
  else await d.coolify.createEnv(d.serviceUuid, payload);
}

async function certReady(domain, d) {
  const url = `https://webmail.${domain}`;
  const start = d.clock();
  for (;;) {
    try {
      const res = await d.fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined,
      });
      if (res && res.status >= 200 && res.status < 400) return true;
    } catch (_) {
      // TLS not issued yet, or the route is not up: keep polling.
    }
    if (d.clock() - start >= d.pollTimeoutMs) return false;
    await d.sleep(d.pollIntervalMs);
  }
}

/**
 * Runs one merged write under the lock: read, guard, write, restart, marker.
 * Returns { restarted } and does NOT poll the cert (that happens after the lock
 * is released). A throw from the restart propagates and leaves the applied
 * marker stale, so the next call restarts again.
 */
async function runBatch(items, client, d) {
  const stored = await readStoredBranding(d);
  const active = await d.loadActiveClients(client);

  // Merge: explicit new records replace any active entry for the same domain.
  const incoming = new Map(items.map((c) => [c.domain, c]));
  const merged = [...(active || []).filter((c) => !incoming.has(c.domain)), ...incoming.values()];
  const mergedDomains = new Set(merged.map((c) => c.domain));

  if (stored.domains.length > 0 && (!active || active.length === 0)) {
    throw new Error("webmail branding: refusing to shrink branding: no active clients loaded but Bulwark already has entries");
  }
  const dropped = stored.domains.filter((x) => !mergedDomains.has(x));
  if (merged.length < stored.domains.length || dropped.length > 0) {
    throw new Error(
      `webmail branding: refusing to shrink branding (${merged.length} would replace ${stored.domains.length} stored)`
    );
  }

  const { addresses, brandingJson } = buildBranding(merged);
  const applied = appliedMarker(addresses, brandingJson);
  if (stored.brandingJson === brandingJson && stored.applied === applied) {
    console.log(`[webmail] branding already applied for ${items.map((c) => c.domain).join(", ")}; no restart`);
    return { restarted: false };
  }

  await d.setBulwarkAddresses(d.serviceUuid, addresses);
  await writeEnvValue(d, BRANDING_KEY, brandingJson, stored.row);
  await d.coolify.restart(d.serviceUuid); // a throw here skips the marker below
  await writeEnvValue(d, APPLIED_KEY, applied, stored.appliedRow);
  console.log(`[webmail] restarted Bulwark for ${items.map((c) => c.domain).join(", ")}`);
  return { restarted: true };
}

// In-process queue state. `openBatch` collects orders during the merge window;
// `chain` serialises the locked writes so two restarts never overlap.
let openBatch = null;
let chain = Promise.resolve();

/**
 * Queue a client's domain for Bulwark branding. Orders arriving within the merge
 * window share one restart. Rejects (and writes nothing) if the result would
 * shrink the stored branding. Resolves { restarted, certReady } and never throws
 * because a cert is slow.
 *
 * ORDERING CONTRACT: the caller must set mailSetup.state = 'provisioned' on the
 * order BEFORE calling enqueueDomain (provisioned = mailboxes exist and webmail
 * is pending). The explicit record is merged in, but every other stored domain
 * must already be active. If one is missing from loadActiveClients the guard
 * refuses, by design: a partial list would erase that client's branding.
 *
 * Fails fast if BULWARK_SERVICE_UUID is unset, before any merge window.
 * The cert poll runs after the lock is released, so the next batch's writes
 * are not held up by it.
 */
async function enqueueDomain(client, record, deps) {
  const item = normalizeClient(record);
  const d = resolveDeps(deps);
  if (!d.serviceUuid) throw new Error("webmail branding: BULWARK_SERVICE_UUID is not set");

  if (!openBatch) {
    const batch = { items: [], promise: null };
    openBatch = batch;
    batch.promise = (async () => {
      await d.sleep(d.mergeMs);
      // Close the window synchronously so late arrivals start a new batch.
      if (openBatch === batch) openBatch = null;
      const items = batch.items.slice();
      const run = chain.then(() => runBatch(items, client, d));
      chain = run.then(() => {}, () => {}); // next batch waits for the write, not the poll
      const result = await run;
      const ready = new Map();
      if (result.restarted) {
        for (const c of items) ready.set(c.domain, await certReady(c.domain, d));
        for (const [domain, ok] of ready) {
          if (!ok) console.warn(`[webmail] cert for webmail.${domain} not ready after 5 minutes; recheck later`);
        }
      }
      return { restarted: result.restarted, ready };
    })();
  }
  openBatch.items.push(item);
  const result = await openBatch.promise;
  const ready = result.ready.has(item.domain) ? result.ready.get(item.domain) : null;
  return { restarted: result.restarted, certReady: result.restarted ? ready : null };
}

module.exports = {
  buildBranding,
  loadActiveClients,
  enqueueDomain,
  mergeWindowMs,
  BRANDING_KEY,
  APPLIED_KEY,
};
