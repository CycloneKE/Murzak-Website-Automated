/**
 * Stalwart management client: the one place the Murzak backend talks to the
 * Stalwart mail server. Idempotent ensure* helpers for domains and mailboxes.
 *
 * Env: STALWART_URL, STALWART_API_KEY, STALWART_DNS_SERVER_ID.
 * STALWART_MOCK=1 swaps in an in-memory store with the same surface (no network).
 *
 * Secrets: the mailbox password is generated here with crypto.randomBytes and is
 * never returned, logged, or put into an error message. The API key is masked in
 * every log line.
 */
const crypto = require("crypto");

/* ---------------------------------------------------------------------------
 * API_SHAPES: every HTTP path, method, request body and response-parsing rule
 * this module uses. Nothing outside this table knows the wire format.
 *
 * UNVERIFIED-LIVE: confirm against the real server in the Task 15 dry run.
 * These shapes are guesses from the field names in the Task 3 brief, not from a
 * live Stalwart. Stalwart's docs pages could not be fetched, and a search
 * suggested that 0.16+ manages objects over JMAP (x:Domain/get, x:Account/set at
 * /jmap) rather than the REST paths below. If that holds, only this table changes.
 * Samples the shapes are based on: backend/test/fixtures/stalwart/.
 * ------------------------------------------------------------------------- */
const arr = (b) => (Array.isArray(b) ? b : []);
const API_SHAPES = Object.freeze({
  // UNVERIFIED-LIVE
  listDomains: {
    method: "GET",
    path: () => "/api/domain",
    parse: (b) => arr(b).map((d) => ({ id: d.id, name: d.name })),
  },
  // UNVERIFIED-LIVE
  createDomain: {
    method: "POST",
    path: () => "/api/domain",
    body: ({ name, description, dnsServerId }) => ({
      name,
      description,
      dkimManagement: { "@type": "Automatic" },
      dnsManagement: { "@type": "Automatic", dnsServerId },
    }),
    parse: (b) => ({ id: b.id }),
    conflictStatus: 409,
  },
  // UNVERIFIED-LIVE
  listAccounts: {
    method: "GET",
    path: () => "/api/account",
    parse: (b) =>
      arr(b).map((a) => ({
        id: a.id,
        name: a.name,
        domainId: a.domainId,
        address: a.emailAddress,
        quotaBytes: a.quotas && a.quotas.maxDiskQuota,
      })),
  },
  // UNVERIFIED-LIVE
  createAccount: {
    method: "POST",
    path: () => "/api/account",
    body: ({ localPart, domainId, secret, quotaBytes }) => ({
      "@type": "Individual",
      name: localPart,
      domainId,
      credentials: { 0: { "@type": "Password", secret } },
      quotas: { maxDiskQuota: quotaBytes },
    }),
    parse: (b) => ({ id: b.id }),
    conflictStatus: 409,
  },
  // UNVERIFIED-LIVE
  patchAccount: {
    method: "PATCH",
    path: (id) => `/api/account/${encodeURIComponent(id)}`,
    passwordBody: ({ secret }) => ({ credentials: { 0: { "@type": "Password", secret } } }),
    outboundLimitBody: ({ perHour }) => ({ outboundRateLimit: { perHour } }),
  },
  // UNVERIFIED-LIVE
  deleteAccount: {
    method: "DELETE",
    path: (id) => `/api/account/${encodeURIComponent(id)}`,
  },
  // UNVERIFIED-LIVE
  getDkim: {
    method: "GET",
    path: (domainId) => `/api/domain/${encodeURIComponent(domainId)}/dkim`,
    parse: (b) => ({ name: b.name, type: b.type, value: b.value }),
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
 *   baseUrl     Stalwart management base URL
 *   apiKey      management API key (masked in logs)
 *   dnsServerId default DNS server id for new domains
 *   mock        true for the in-memory store (no network)
 *   log         log sink; every line passes through redact()
 */
function createStalwartClient(opts = {}) {
  const http = opts.http || fetchHttp;
  const baseUrl = (opts.baseUrl || "").replace(/\/+$/, "");
  const apiKey = opts.apiKey || "";
  const dnsServerId = opts.dnsServerId || "";
  const mock = !!opts.mock;
  const log = opts.log || ((m) => console.log(m));
  const say = (m) => log(redact(m, apiKey));

  function isConfigured() {
    if (mock) return true;
    return !!(baseUrl && apiKey && dnsServerId);
  }
  function configError() {
    if (mock) return "";
    const missing = [];
    if (!baseUrl) missing.push("STALWART_URL");
    if (!apiKey) missing.push("STALWART_API_KEY");
    if (!dnsServerId) missing.push("STALWART_DNS_SERVER_ID");
    return missing.length ? `Missing ${missing.join(", ")}` : "";
  }

  /** One HTTP call through API_SHAPES. Throws without the response body. */
  async function call(method, path, body, { allow = [] } = {}) {
    let res;
    try {
      res = await http({
        method,
        url: `${baseUrl}${path}`,
        path,
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
      });
    } catch (e) {
      // Transport error. Its message may contain the URL, so report only the method and path.
      say(`[stalwart] ${method} ${path} transport error`);
      throw new Error(`Stalwart ${method} ${path} transport error`);
    }
    if (res.status >= 400 && !allow.includes(res.status)) {
      say(`[stalwart] ${method} ${path} failed: HTTP ${res.status}`);
      const err = new Error(`Stalwart ${method} ${path} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /* ---------------- live implementation ---------------- */
  const live = {
    async listDomains() {
      const res = await call(API_SHAPES.listDomains.method, API_SHAPES.listDomains.path());
      return API_SHAPES.listDomains.parse(res.body);
    },
    async ensureDomain({ name, description, dnsServerId: dns }) {
      const want = String(name).toLowerCase();
      const existing = (await live.listDomains()).find((d) => String(d.name).toLowerCase() === want);
      if (existing) return { id: existing.id, created: false };
      const s = API_SHAPES.createDomain;
      const res = await call(s.method, s.path(), s.body({ name: want, description, dnsServerId: dns || dnsServerId }), { allow: [s.conflictStatus] });
      if (res.status === s.conflictStatus) {
        const again = (await live.listDomains()).find((d) => String(d.name).toLowerCase() === want);
        if (again) return { id: again.id, created: false };
        throw new Error(`Stalwart domain ${want} conflicts but cannot be found`);
      }
      return { id: s.parse(res.body).id, created: true };
    },
    async listAccounts(domainId) {
      const res = await call(API_SHAPES.listAccounts.method, API_SHAPES.listAccounts.path());
      return API_SHAPES.listAccounts.parse(res.body)
        .filter((a) => a.domainId === domainId)
        .map((a) => ({ id: a.id, address: a.address, quotaBytes: a.quotaBytes }));
    },
    async ensureAccount({ domainId, localPart, quotaBytes }) {
      const all = API_SHAPES.listAccounts.parse((await call(API_SHAPES.listAccounts.method, API_SHAPES.listAccounts.path())).body);
      const found = all.find((a) => a.domainId === domainId && a.name === localPart);
      if (found) return { id: found.id, created: false };
      const s = API_SHAPES.createAccount;
      const secret = newSecret(); // generated, sent once, never returned or logged
      const res = await call(s.method, s.path(), s.body({ localPart, domainId, secret, quotaBytes }), { allow: [s.conflictStatus] });
      if (res.status === s.conflictStatus) {
        const again = API_SHAPES.listAccounts.parse((await call(API_SHAPES.listAccounts.method, API_SHAPES.listAccounts.path())).body)
          .find((a) => a.domainId === domainId && a.name === localPart);
        if (again) return { id: again.id, created: false };
        throw new Error("Stalwart account conflicts but cannot be found");
      }
      return { id: s.parse(res.body).id, created: true };
    },
    async setPassword(accountId, password) {
      const s = API_SHAPES.patchAccount;
      await call(s.method, s.path(accountId), s.passwordBody({ secret: password }));
    },
    async findAccount(address) {
      const want = String(address).toLowerCase();
      const all = API_SHAPES.listAccounts.parse((await call(API_SHAPES.listAccounts.method, API_SHAPES.listAccounts.path())).body);
      const hit = all.find((a) => String(a.address || "").toLowerCase() === want);
      return hit ? { id: hit.id } : null;
    },
    async deleteAccount(accountId) {
      const s = API_SHAPES.deleteAccount;
      await call(s.method, s.path(accountId));
    },
    async setOutboundLimit(accountId, perHour) {
      const s = API_SHAPES.patchAccount;
      await call(s.method, s.path(accountId), s.outboundLimitBody({ perHour }));
    },
    async getDkimRecord(domainId) {
      const s = API_SHAPES.getDkim;
      const res = await call(s.method, s.path(domainId));
      return s.parse(res.body);
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
  if (mock) {
    impl.listDomains = async () => [...domains.values()].map((d) => ({ id: d.id, name: d.name }));
  }
  return {
    isConfigured,
    configError,
    ensureDomain: (args) => impl.ensureDomain({ ...args, dnsServerId: args && args.dnsServerId }),
    ensureAccount: (args) => impl.ensureAccount(args),
    setPassword: (id, pw) => impl.setPassword(id, pw),
    findAccount: (addr) => impl.findAccount(addr),
    deleteAccount: (id) => impl.deleteAccount(id),
    setOutboundLimit: (id, perHour) => impl.setOutboundLimit(id, perHour),
    listAccounts: (domainId) => impl.listAccounts(domainId),
    getDkimRecord: (domainId) => impl.getDkimRecord(domainId),
  };
}

/* ---------------- module-level defaults, bound to env at call time ---------------- */
function defaultClient() {
  const mock = process.env.STALWART_MOCK === "1";
  return createStalwartClient({
    http: fetchHttp,
    baseUrl: process.env.STALWART_URL,
    apiKey: process.env.STALWART_API_KEY,
    dnsServerId: process.env.STALWART_DNS_SERVER_ID,
    mock,
  });
}

const isConfigured = () => defaultClient().isConfigured();
const configError = () => defaultClient().configError();
const ensureDomain = (args) => defaultClient().ensureDomain(args);
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
  ensureAccount,
  setPassword,
  findAccount,
  deleteAccount,
  setOutboundLimit,
  listAccounts,
  getDkimRecord,
};
