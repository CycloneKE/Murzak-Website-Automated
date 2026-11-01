/**
 * Stalwart management client: the one place the Murzak backend talks to the
 * Stalwart mail server. Idempotent ensure* helpers for domains and mailboxes.
 *
 * Env: STALWART_URL, STALWART_API_KEY, STALWART_DNS_SERVER_ID,
 *      STALWART_AUTH=bearer|basic (default bearer), STALWART_API_USER (basic only).
 * STALWART_MOCK=1 swaps in an in-memory store with the same surface (no network).
 *
 * Secrets: the mailbox password is generated here with crypto.randomBytes and is
 * never returned, logged, or put into an error message. The API key is masked in
 * every log line, and a JMAP error contributes only its type, never its description.
 */
const crypto = require("crypto");

/* ---------------------------------------------------------------------------
 * API_SHAPES: every JMAP method name, argument builder and response parser this
 * module uses. Nothing outside this table knows the wire format.
 *
 * UNVERIFIED-LIVE: confirm against the real server in the Task 15 dry run.
 * Stalwart 0.16+ removed the REST management API; management is JMAP at
 * POST {STALWART_URL}/jmap with server-object methods prefixed "x:".
 * The argument and response shapes below follow standard JMAP /get and /set
 * semantics and the field names in the Task 3 brief. Stalwart's docs could not be
 * fetched, so none of it is confirmed. accountId is omitted, and so are the
 * exact "x:Domain/get" properties. If any of that differs, only this table changes.
 * Samples these shapes are based on: backend/test/fixtures/stalwart/.
 * ------------------------------------------------------------------------- */
const arr = (v) => (Array.isArray(v) ? v : []);

// Create/update/destroy results of a JMAP /set. A notCreated/notUpdated/notDestroyed
// entry carries a type; "alreadyExists" is treated as a conflict, anything else throws.
// The description is never included, because it may echo request data.
function parseCreate(result, key) {
  const ok = result && result.created && result.created[key];
  if (ok) return { id: ok.id };
  const nc = result && result.notCreated && result.notCreated[key];
  if (nc && nc.type === "alreadyExists") return { conflict: true };
  throw new Error(`Stalwart create failed: ${(nc && nc.type) || "unknown"}`);
}
function assertUpdated(result, id) {
  const nu = result && result.notUpdated && result.notUpdated[id];
  if (nu) throw new Error(`Stalwart update failed: ${nu.type || "unknown"}`);
}

const API_SHAPES = Object.freeze({
  // UNVERIFIED-LIVE: JMAP envelope. Methods with a server-object "x:" prefix.
  endpoint: "/jmap",
  using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],

  // UNVERIFIED-LIVE
  domainGet: {
    method: "x:Domain/get",
    args: () => ({ ids: null }),
    parse: (r) => arr(r.list).map((d) => ({ id: d.id, name: d.name })),
  },
  // UNVERIFIED-LIVE
  domainCreate: {
    method: "x:Domain/set",
    args: ({ name, description, dnsServerId }) => ({
      create: {
        k1: {
          name,
          description,
          dkimManagement: { "@type": "Automatic" },
          dnsManagement: { "@type": "Automatic", dnsServerId },
        },
      },
    }),
    parse: (r) => parseCreate(r, "k1"),
  },
  // UNVERIFIED-LIVE
  accountGet: {
    method: "x:Account/get",
    args: () => ({ ids: null }),
    parse: (r) =>
      arr(r.list).map((a) => ({
        id: a.id,
        name: a.name,
        domainId: a.domainId,
        address: a.emailAddress,
        quotaBytes: a.quotas && a.quotas.maxDiskQuota,
      })),
  },
  // UNVERIFIED-LIVE
  accountCreate: {
    method: "x:Account/set",
    args: ({ localPart, domainId, secret, quotaBytes }) => ({
      create: {
        k1: {
          name: localPart,
          domainId,
          credentials: { 0: { "@type": "Password", secret } },
          quotas: { maxDiskQuota: quotaBytes },
        },
      },
    }),
    parse: (r) => parseCreate(r, "k1"),
  },
  // UNVERIFIED-LIVE: update map keyed by account id
  accountUpdate: {
    method: "x:Account/set",
    args: (id, patch) => ({ update: { [id]: patch } }),
    parse: (r, id) => assertUpdated(r, id),
    passwordPatch: ({ secret }) => ({ credentials: { 0: { "@type": "Password", secret } } }),
    outboundPatch: ({ perHour }) => ({ outboundRateLimit: { perHour } }),
  },
  // UNVERIFIED-LIVE
  accountDestroy: {
    method: "x:Account/set",
    args: (id) => ({ destroy: [id] }),
    parse: (r, id) => {
      const nd = r && r.notDestroyed && r.notDestroyed[id];
      if (nd) throw new Error(`Stalwart destroy failed: ${nd.type || "unknown"}`);
    },
  },
  // UNVERIFIED-LIVE: DKIM record read from the domain object
  domainDkim: {
    method: "x:Domain/get",
    args: (id) => ({ ids: [id] }),
    parse: (r) => {
      const d = arr(r.list)[0];
      const rec = d && d.dkimRecord;
      if (!rec) throw new Error("Stalwart domain has no DKIM record");
      return { name: rec.name, type: rec.type, value: rec.value };
    },
  },
});

/** Mask an API key for logs: first 4 and last 2 characters, never the whole key. */
function maskKey(key) {
  if (!key) return "(none)";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 4)}...${key.slice(-2)}`;
}

/** Remove any occurrence of the API key from a string before it is logged. */
function redact(text, apiKey) {
  const s = String(text);
  if (!apiKey) return s;
  return s.split(apiKey).join(maskKey(apiKey));
}

/** Default HTTP transport, using Node's global fetch. Tests inject their own. */
async function fetchHttp({ method, url, headers, body }) {
  const init = { method, headers: { Accept: "application/json", ...headers } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(15000);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

function newSecret() {
  // 24 random bytes -> 32 url-safe characters.
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Build a client. Options:
 *   http        injectable transport: ({method, url, path, headers, body}) -> {status, body}
 *   baseUrl     Stalwart base URL (the JMAP endpoint is baseUrl + /jmap)
 *   apiKey      management API key (masked in logs)
 *   authMode    "bearer" (default) or "basic" (user:key)
 *   apiUser     user name for basic auth
 *   dnsServerId default DNS server id for new domains
 *   mock        true for the in-memory store (no network)
 *   log         log sink; every line passes through redact()
 */
function createStalwartClient(opts = {}) {
  const http = opts.http || fetchHttp;
  const baseUrl = (opts.baseUrl || "").replace(/\/+$/, "");
  const apiKey = opts.apiKey || "";
  const authMode = (opts.authMode || "bearer").toLowerCase();
  const apiUser = opts.apiUser || "";
  const dnsServerId = opts.dnsServerId || "";
  const mock = !!opts.mock;
  const log = opts.log || ((m) => console.log(m));
  const say = (m) => log(redact(m, apiKey));

  function authHeaders() {
    if (authMode === "basic") {
      return { Authorization: `Basic ${Buffer.from(`${apiUser}:${apiKey}`).toString("base64")}` };
    }
    return { Authorization: `Bearer ${apiKey}` };
  }

  function isConfigured() {
    if (mock) return true;
    return configError() === "";
  }
  function configError() {
    if (mock) return "";
    const missing = [];
    if (!baseUrl) missing.push("STALWART_URL");
    if (!apiKey) missing.push("STALWART_API_KEY");
    if (!dnsServerId) missing.push("STALWART_DNS_SERVER_ID");
    if (authMode === "basic" && !apiUser) missing.push("STALWART_API_USER");
    if (authMode !== "bearer" && authMode !== "basic") return "STALWART_AUTH must be bearer or basic";
    return missing.length ? `Missing ${missing.join(", ")}` : "";
  }

  /** One JMAP method call through the envelope. Throws without any request data. */
  async function jmap(methodName, args) {
    const body = { using: API_SHAPES.using, methodCalls: [[methodName, args, "c0"]] };
    let res;
    try {
      res = await http({
        method: "POST",
        url: `${baseUrl}${API_SHAPES.endpoint}`,
        path: API_SHAPES.endpoint,
        headers: authHeaders(),
        body,
      });
    } catch (e) {
      // Transport error. Its message may contain the URL, so report only the method.
      say(`[stalwart] ${methodName} transport error`);
      throw new Error(`Stalwart ${methodName} transport error`);
    }
    if (res.status >= 400) {
      say(`[stalwart] ${methodName} failed: HTTP ${res.status}`);
      const err = new Error(`Stalwart ${methodName} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const mr = res.body && Array.isArray(res.body.methodResponses) ? res.body.methodResponses[0] : null;
    if (!mr) throw new Error(`Stalwart ${methodName}: malformed JMAP response`);
    if (mr[0] === "error") {
      // Only the error type is surfaced. The description is never included.
      const type = (mr[1] && mr[1].type) || "error";
      say(`[stalwart] ${methodName} error: ${type}`);
      throw new Error(`Stalwart ${methodName} failed: ${type}`);
    }
    return mr[1];
  }

  /* ---------------- live implementation ---------------- */
  const live = {
    async listDomains() {
      const s = API_SHAPES.domainGet;
      return s.parse(await jmap(s.method, s.args()));
    },
    // Read-only: resolves a domain name to its id without creating anything.
    async findDomain(name) {
      const want = String(name).toLowerCase();
      const hit = (await live.listDomains()).find((d) => String(d.name).toLowerCase() === want);
      return hit ? { id: hit.id } : null;
    },
    async ensureDomain({ name, description, dnsServerId: dns }) {
      const want = String(name).toLowerCase();
      const existing = (await live.listDomains()).find((d) => String(d.name).toLowerCase() === want);
      if (existing) return { id: existing.id, created: false };
      const s = API_SHAPES.domainCreate;
      const r = s.parse(await jmap(s.method, s.args({ name: want, description, dnsServerId: dns || dnsServerId })));
      if (!r.conflict) return { id: r.id, created: true };
      const again = (await live.listDomains()).find((d) => String(d.name).toLowerCase() === want);
      if (again) return { id: again.id, created: false };
      throw new Error("Stalwart domain conflicts but cannot be found");
    },
    async listAccounts(domainId) {
      const s = API_SHAPES.accountGet;
      return s.parse(await jmap(s.method, s.args()))
        .filter((a) => a.domainId === domainId)
        .map((a) => ({ id: a.id, address: a.address, quotaBytes: a.quotaBytes }));
    },
    async ensureAccount({ domainId, localPart, quotaBytes }) {
      const s = API_SHAPES.accountGet;
      const findIt = async () => s.parse(await jmap(s.method, s.args())).find((a) => a.domainId === domainId && a.name === localPart);
      const found = await findIt();
      if (found) return { id: found.id, created: false };
      const c = API_SHAPES.accountCreate;
      const secret = newSecret(); // generated, sent once, never returned or logged
      const r = c.parse(await jmap(c.method, c.args({ localPart, domainId, secret, quotaBytes })));
      if (!r.conflict) return { id: r.id, created: true };
      const again = await findIt();
      if (again) return { id: again.id, created: false };
      throw new Error("Stalwart account conflicts but cannot be found");
    },
    async setPassword(accountId, password) {
      const u = API_SHAPES.accountUpdate;
      const patch = u.passwordPatch({ secret: password });
      u.parse(await jmap(u.method, u.args(accountId, patch)), accountId);
    },
    async findAccount(address) {
      const want = String(address).toLowerCase();
      const s = API_SHAPES.accountGet;
      const hit = s.parse(await jmap(s.method, s.args())).find((a) => String(a.address || "").toLowerCase() === want);
      return hit ? { id: hit.id } : null;
    },
    async deleteAccount(accountId) {
      const d = API_SHAPES.accountDestroy;
      d.parse(await jmap(d.method, d.args(accountId)), accountId);
    },
    async setOutboundLimit(accountId, perHour) {
      const u = API_SHAPES.accountUpdate;
      u.parse(await jmap(u.method, u.args(accountId, u.outboundPatch({ perHour }))), accountId);
    },
    async getDkimRecord(domainId) {
      const s = API_SHAPES.domainDkim;
      return s.parse(await jmap(s.method, s.args(domainId)));
    },
  };

  /* ---------------- mock implementation (in-memory, idempotent) ---------------- */
  const domains = new Map(); // id -> { id, name }
  const accounts = new Map(); // id -> { id, address, domainId, localPart, quotaBytes, outboundPerHour, passwordSet }
  let seq = 0;
  const mockStore = {
    async ensureDomain({ name }) {
      const want = String(name).toLowerCase();
      for (const d of domains.values()) if (d.name === want) return { id: d.id, created: false };
      const id = `mock-domain-${++seq}`;
      domains.set(id, { id, name: want });
      return { id, created: true };
    },
    async findDomain(name) {
      const want = String(name).toLowerCase();
      for (const d of domains.values()) if (d.name === want) return { id: d.id };
      return null;
    },
    async ensureAccount({ domainId, localPart, quotaBytes }) {
      const dom = domains.get(domainId);
      if (!dom) throw new Error(`Stalwart mock: unknown domain ${domainId}`);
      for (const a of accounts.values()) if (a.domainId === domainId && a.localPart === localPart) return { id: a.id, created: false };
      const id = `mock-account-${++seq}`;
      accounts.set(id, { id, address: `${localPart}@${dom.name}`, domainId, localPart, quotaBytes, outboundPerHour: null, passwordSet: true });
      return { id, created: true };
    },
    async listAccounts(domainId) {
      return [...accounts.values()].filter((a) => a.domainId === domainId).map((a) => ({ id: a.id, address: a.address, quotaBytes: a.quotaBytes }));
    },
    async setPassword(accountId) {
      const a = accounts.get(accountId);
      if (!a) throw new Error("Stalwart mock: unknown account");
      a.passwordSet = true;
    },
    async findAccount(address) {
      const want = String(address).toLowerCase();
      for (const a of accounts.values()) if (a.address === want) return { id: a.id };
      return null;
    },
    async deleteAccount(accountId) {
      accounts.delete(accountId);
    },
    async setOutboundLimit(accountId, perHour) {
      const a = accounts.get(accountId);
      if (!a) throw new Error("Stalwart mock: unknown account");
      a.outboundPerHour = perHour;
    },
    async getDkimRecord(domainId) {
      const dom = domains.get(domainId);
      if (!dom) throw new Error(`Stalwart mock: unknown domain ${domainId}`);
      return { name: `default._domainkey.${dom.name}`, type: "TXT", value: "v=DKIM1; k=ed25519; p=MOCK" };
    },
  };

  const impl = mock ? mockStore : live;

  // Live mode refuses to run unconfigured: a clear error naming the missing env vars,
  // and no request (never a relative URL). Mock mode needs no config.
  const guard = (fn) => async (...args) => {
    if (!mock) {
      const problem = configError();
      if (problem) throw new Error(`Stalwart not configured: ${problem}`);
    }
    return fn(...args);
  };

  return {
    isConfigured,
    configError,
    ensureDomain: guard((args) => impl.ensureDomain({ ...args, dnsServerId: args && args.dnsServerId })),
    findDomain: guard((name) => impl.findDomain(name)),
    ensureAccount: guard((args) => impl.ensureAccount(args)),
    setPassword: guard((id, pw) => impl.setPassword(id, pw)),
    findAccount: guard((addr) => impl.findAccount(addr)),
    deleteAccount: guard((id) => impl.deleteAccount(id)),
    setOutboundLimit: guard((id, perHour) => impl.setOutboundLimit(id, perHour)),
    listAccounts: guard((domainId) => impl.listAccounts(domainId)),
    getDkimRecord: guard((domainId) => impl.getDkimRecord(domainId)),
  };
}

/* ---------------- module-level defaults, bound to env ---------------- */
// One default client per process. It is rebuilt only when the relevant env values
// change, so the STALWART_MOCK in-memory store survives across module-level calls.
let defaultInstance = null;
let defaultFingerprint = null;

function defaultClient() {
  const env = {
    mock: process.env.STALWART_MOCK === "1",
    url: process.env.STALWART_URL || "",
    key: process.env.STALWART_API_KEY || "",
    auth: process.env.STALWART_AUTH || "bearer",
    user: process.env.STALWART_API_USER || "",
    dns: process.env.STALWART_DNS_SERVER_ID || "",
  };
  const fingerprint = JSON.stringify(env);
  if (!defaultInstance || fingerprint !== defaultFingerprint) {
    defaultInstance = createStalwartClient({
      http: fetchHttp,
      baseUrl: env.url,
      apiKey: env.key,
      authMode: env.auth,
      apiUser: env.user,
      dnsServerId: env.dns,
      mock: env.mock,
    });
    defaultFingerprint = fingerprint;
  }
  return defaultInstance;
}

/** Test hook: drop the default client and its in-memory mock store. */
function __resetMockForTests() {
  defaultInstance = null;
  defaultFingerprint = null;
}

const isConfigured = () => defaultClient().isConfigured();
const configError = () => defaultClient().configError();
const ensureDomain = (args) => defaultClient().ensureDomain(args);
const findDomain = (name) => defaultClient().findDomain(name);
const ensureAccount = (args) => defaultClient().ensureAccount(args);
const setPassword = (id, pw) => defaultClient().setPassword(id, pw);
const findAccount = (addr) => defaultClient().findAccount(addr);
const deleteAccount = (id) => defaultClient().deleteAccount(id);
const setOutboundLimit = (id, perHour) => defaultClient().setOutboundLimit(id, perHour);
const listAccounts = (domainId) => defaultClient().listAccounts(domainId);
const getDkimRecord = (domainId) => defaultClient().getDkimRecord(domainId);

module.exports = {
  API_SHAPES,
  createStalwartClient,
  isConfigured,
  configError,
  ensureDomain,
  findDomain,
  ensureAccount,
  setPassword,
  findAccount,
  deleteAccount,
  setOutboundLimit,
  listAccounts,
  getDkimRecord,
  __resetMockForTests,
};
