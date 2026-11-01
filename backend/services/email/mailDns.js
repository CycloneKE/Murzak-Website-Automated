/**
 * Mail DNS for bring-your-own domains: the records a customer's domain must
 * carry for Stalwart mail, a resolver-based check that they are live, and the
 * idempotent `webmail` CNAME written through the Hostinger DNS API.
 *
 * Records produced here (the DKIM TXT is NOT produced here: the caller appends
 * the value Stalwart reports via getDkimRecord):
 *   MX     @        -> mailHost, priority 10
 *   TXT    @        v=spf1 mx ~all
 *   TXT    _dmarc   v=DMARC1; p=none; rua=mailto:postmaster@<domain>
 *   CNAME  webmail  -> webmailTarget (default webmail.cloud.murzaktech.tech)
 *
 * Names are relative to the zone ('@' is the apex), matching the Hostinger
 * zone API the certbot hook already drives.
 *
 * Only the webmail CNAME is ever written here. Stalwart writes MX/SPF/DKIM/
 * DMARC itself, and this module never replaces an existing record.
 *   node test/mailDns.test.js   (or: npm test)
 */

const dns = require("dns");
const axios = require("axios");
const hostingerApi = require("../hostingerApi");

const DEFAULT_WEBMAIL_TARGET = "webmail.cloud.murzaktech.tech";
const WEBMAIL_TTL = 300;
const TIMEOUT_MS = 30000;

/**
 * Hostinger DNS request/response shapes.
 *
 * The WRITE body is verified: it is the same PUT contract that
 * deploy/vps/bin/certbot-hostinger-dns uses in production
 * (PUT /api/dns/v1/zones/{zone} with overwrite:false, records as [{content}]).
 * Its use for a CNAME is the same contract but not yet exercised live.
 *
 * The READ shape is UNVERIFIED-LIVE. It is not in the repo, so readEntries()
 * accepts the plausible wrappers (a bare array, {data:[]} or {zone:[]}) and
 * flattens each entry to {name, type, content}. If the live API differs,
 * change only this block.
 */
const DNS_SHAPES = {
  // VERIFIED (certbot-hostinger-dns PUT contract), CNAME use UNVERIFIED-LIVE.
  writeBody(name, type, ttl, content) {
    return { overwrite: false, zone: [{ name, type, ttl, records: [{ content }] }] };
  },
  // UNVERIFIED-LIVE: GET /api/dns/v1/zones/{zone} response shape.
  readEntries(body) {
    let list = [];
    if (Array.isArray(body)) list = body;
    else if (body && Array.isArray(body.data)) list = body.data;
    else if (body && Array.isArray(body.zone)) list = body.zone;
    const flat = [];
    for (const entry of list) {
      if (!entry) continue;
      const type = String(entry.type || "").toUpperCase();
      const name = entry.name;
      if (Array.isArray(entry.records)) {
        for (const rec of entry.records) {
          flat.push({ name, type, content: rec && rec.content });
        }
      } else if (entry.content !== undefined) {
        flat.push({ name, type, content: entry.content });
      }
    }
    return flat;
  },
};

function normHost(value) {
  return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}

function normDomain(domain) {
  return normHost(domain);
}

function assertDomain(zone) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(zone)) {
    throw new Error(`invalid domain: ${zone || "(empty)"}`);
  }
}

/**
 * Zone-relative name for a record name as the API returns it: "@" for the
 * apex, otherwise the label with the zone suffix removed.
 */
function relativeName(name, zone) {
  const n = normHost(name);
  if (!n || n === "@" || n === zone) return "@";
  if (n.endsWith(`.${zone}`)) return n.slice(0, -(zone.length + 1));
  return n;
}

/** The records a BYO domain must carry for Stalwart mail. */
function requiredRecords(domain, { mailHost, webmailTarget = DEFAULT_WEBMAIL_TARGET } = {}) {
  const zone = normDomain(domain);
  assertDomain(zone);
  const mx = normHost(mailHost);
  if (!mx) throw new Error("requiredRecords: mailHost is required");
  return [
    { type: "MX", name: "@", value: mx, priority: 10 },
    { type: "TXT", name: "@", value: "v=spf1 mx ~all" },
    { type: "TXT", name: "_dmarc", value: `v=DMARC1; p=none; rua=mailto:postmaster@${zone}` },
    { type: "CNAME", name: "webmail", value: normHost(webmailTarget) },
  ];
}

// Resolver lookups treat "no such record" as an empty answer; a DNS failure
// also counts as missing, so verification fails closed rather than passing.
async function lookup(fn) {
  try {
    const out = await fn();
    return Array.isArray(out) ? out : [];
  } catch (_) {
    return [];
  }
}

function tokens(text) {
  return String(text || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function parseTags(text) {
  const tags = {};
  for (const part of String(text || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    if (key) tags[key] = part.slice(idx + 1).trim();
  }
  return tags;
}

/**
 * Check each record against the live DNS. Returns { ok, missing } where
 * `missing` lists the labels of the records that did not resolve (MX, SPF,
 * DMARC, DKIM, webmail, or a generic label for anything else).
 */
async function verifyRecords(domain, records, { resolver = dns.promises } = {}) {
  const zone = normDomain(domain);
  assertDomain(zone);
  const missing = [];
  const miss = (label) => { if (!missing.includes(label)) missing.push(label); };

  for (const rec of records || []) {
    const name = rec.name === "@" ? zone : `${rec.name}.${zone}`;

    if (rec.type === "MX") {
      const answers = await lookup(() => resolver.resolveMx(zone));
      const want = normHost(rec.value);
      const hit = answers.some((a) =>
        normHost(a.exchange) === want &&
        (rec.priority === undefined || Number(a.priority) === Number(rec.priority)));
      if (!hit) miss("MX");
    } else if (rec.type === "TXT") {
      const answers = (await lookup(() => resolver.resolveTxt(name)))
        .map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks)));
      const isSpf = rec.name === "@" && /^v=spf1\b/i.test(rec.value);
      const isDmarc = rec.name === "_dmarc";
      const isDkim = /_domainkey/i.test(rec.name);
      if (isSpf) {
        // Order-, whitespace- and extra-include-insensitive: every required token must appear.
        const need = tokens(rec.value);
        const hit = answers.some((txt) => {
          const have = tokens(txt);
          return need.every((t) => have.includes(t));
        });
        if (!hit) miss("SPF");
      } else if (isDmarc) {
        const need = parseTags(rec.value);
        const hit = answers.some((txt) => {
          const have = parseTags(txt);
          return Object.keys(need).every((k) => have[k] !== undefined && have[k].toLowerCase() === need[k].toLowerCase());
        });
        if (!hit) miss("DMARC");
      } else if (isDkim) {
        // Key material: compare with whitespace removed, case preserved.
        const want = String(rec.value).replace(/\s+/g, "");
        const hit = answers.some((txt) => txt.replace(/\s+/g, "") === want);
        if (!hit) miss("DKIM");
      } else {
        const want = String(rec.value).replace(/\s+/g, " ").trim();
        const hit = answers.some((txt) => txt.replace(/\s+/g, " ").trim() === want);
        if (!hit) miss(`TXT ${rec.name}`);
      }
    } else if (rec.type === "CNAME") {
      const answers = await lookup(() => resolver.resolveCname(name));
      const want = normHost(rec.value);
      const hit = answers.some((a) => normHost(a) === want);
      if (!hit) miss(rec.name === "webmail" ? "webmail" : `CNAME ${rec.name}`);
    } else {
      throw new Error(`verifyRecords: unsupported record type ${rec.type}`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Make sure `webmail.<domain>` is a CNAME to the webmail target.
 *
 * Idempotent: if the CNAME already points at the target, nothing is written.
 * It never overwrites: if `webmail` exists with a different value or type, it
 * throws. The write uses overwrite:false.
 *
 * opts.http is injectable ({ get(url, opts), put(url, body, opts) }); tests
 * use it to avoid the network. The default is axios.
 */
async function ensureWebmailCname(domain, { http, webmailTarget = DEFAULT_WEBMAIL_TARGET } = {}) {
  const zone = normDomain(domain);
  assertDomain(zone);
  const target = normHost(webmailTarget);
  if (!target) throw new Error("ensureWebmailCname: webmailTarget is required");
  if (!http && !hostingerApi.isConfigured()) {
    throw new Error("Hostinger DNS not configured (missing: HOSTINGER_API_TOKEN)");
  }

  const client = http || axios;
  const url = hostingerApi.apiUrl(`${hostingerApi.PATHS.dnsZones}/${encodeURIComponent(zone)}`);
  // Built only when a real call is about to be made, so the token is never read otherwise.
  const opts = () => ({ headers: hostingerApi.authHeaders(), timeout: TIMEOUT_MS });

  let entries;
  try {
    const resp = await client.get(url, opts());
    entries = DNS_SHAPES.readEntries(resp && resp.data);
  } catch (err) {
    throw new Error(`Hostinger DNS read failed for ${zone}: ${err.response?.status || err.message}`);
  }

  const existing = entries.filter((e) => relativeName(e.name, zone) === "webmail");
  if (existing.some((e) => e.type === "CNAME" && normHost(e.content) === target)) return;
  if (existing.length) {
    const types = existing.map((e) => e.type).join(", ");
    throw new Error(`webmail.${zone} already exists (${types}) and does not point at ${target}; not overwriting`);
  }

  try {
    await client.put(url, DNS_SHAPES.writeBody("webmail", "CNAME", WEBMAIL_TTL, target), opts());
  } catch (err) {
    throw new Error(`Hostinger DNS write failed for ${zone}: ${err.response?.status || err.message}`);
  }
}

module.exports = {
  DEFAULT_WEBMAIL_TARGET,
  DNS_SHAPES,
  requiredRecords,
  verifyRecords,
  ensureWebmailCname,
};
