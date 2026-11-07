#!/usr/bin/env node
/**
 * mail-dryrun-check.js — READ-ONLY preflight for the Stalwart business-email feature.
 *
 * Run it on a machine that has the real backend/.env (your laptop for the
 * Stalwart/Hostinger/Frappe/SMTP checks, the VPS for Coolify, port 25 and PTR):
 *
 *   cd backend
 *   node scripts/mail-dryrun-check.js                 # everything that can run here
 *   node scripts/mail-dryrun-check.js --vps           # also port 25 + PTR (run ON the VPS)
 *   node scripts/mail-dryrun-check.js --only=env,stalwart
 *   node scripts/mail-dryrun-check.js --zone=murzaktech.tech
 *
 * NOTE: it loads backend/.env from the CURRENT DIRECTORY (dotenv), so it uses your
 * real credentials. Run it yourself; do not hand it to a tool or paste its input.
 * Set MAIL_DRYRUN_NO_DOTENV=1 to skip loading .env and use only the real environment.
 *
 * It only READS: JMAP /get calls, a DNS zone GET, a Coolify service/env GET, Frappe
 * metadata GETs, an SMTP login test (no mail is sent) and TCP/DNS lookups. It
 * creates, changes and deletes nothing, and makes no payment.
 *
 * Output is PASS / WARN / FAIL / SKIP lines. Secrets are never printed: only
 * whether they are set. Any error text is scrubbed of every secret value before it
 * is shown. Exit code 1 if anything FAILed, else 0. A PASS here proves only that the
 * thing it names matches what the code assumes; it does not replace the real
 * payment and phone checks in docs/runbooks/email-hosting.md.
 */
"use strict";

if (process.env.MAIL_DRYRUN_NO_DOTENV !== "1") {
  try { require("dotenv").config(); } catch { /* dotenv missing: rely on the real environment */ }
}

const dns = require("dns").promises;
const net = require("net");

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const ONLY = (opt("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const wants = (group) => ONLY.length === 0 || ONLY.includes(group);
const ZONE = (opt("zone", "") || "").toLowerCase();

/* ------------------------- secrets + output helpers ------------------------- */
const SECRET_KEYS = [
  "STALWART_API_KEY", "MAIL_LINK_SECRET", "HOSTINGER_API_TOKEN", "COOLIFY_TOKEN",
  "SMTP_PASS", "FRAPPE_API_SECRET", "FRAPPE_API_KEY", "SESSION_SECRET",
];
function scrub(text) {
  let s = String(text == null ? "" : text);
  for (const k of SECRET_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 6) s = s.split(v).join(`[${k}]`);
  }
  return s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
}

const results = [];
function out(level, label, detail) {
  results.push(level);
  const tag = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL", SKIP: "SKIP" }[level];
  console.log(`${tag}  ${label}${detail ? `\n      ${scrub(detail).split("\n").join("\n      ")}` : ""}`);
}
const pass = (l, d) => out("PASS", l, d);
const warn = (l, d) => out("WARN", l, d);
const fail = (l, d) => out("FAIL", l, d);
const skip = (l, d) => out("SKIP", l, d);
const section = (name) => console.log(`\n== ${name} ==`);

const env = (k) => (process.env[k] || "").trim();
const has = (k) => env(k) !== "";

async function timed(fn, ms = 20000) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/* --------------------------------- 1. env ---------------------------------- */
function checkEnv() {
  section("1. Settings (names only; secret values are never shown)");

  const sweep = process.env.MAIL_LIVE_SWEEP_MS;
  if (sweep === undefined || sweep.trim() === "") {
    fail("MAIL_LIVE_SWEEP_MS is NOT set", "The go-live sweep is ON by default. Set MAIL_LIVE_SWEEP_MS=0 until the dry run passes.");
  } else if (sweep.trim() === "0") {
    pass("MAIL_LIVE_SWEEP_MS=0 (sweep is off, as required before the dry run)");
  } else {
    warn(`MAIL_LIVE_SWEEP_MS=${sweep.trim()} (sweep is ON)`, "Fine once the dry run has passed; set 0 until then.");
  }

  if (env("STALWART_MOCK") === "1") fail("STALWART_MOCK=1 is set", "That is the in-memory fake. It must not be set for the dry run.");
  else pass("STALWART_MOCK is not set");

  if (env("MAIL_NEW_DOMAIN_ENABLED") === "1") warn("MAIL_NEW_DOMAIN_ENABLED=1", "New-domain orders are not billed yet. Keep this off.");
  else pass("MAIL_NEW_DOMAIN_ENABLED is off");

  const required = [
    ["STALWART_URL", false], ["STALWART_API_KEY", true], ["STALWART_DNS_SERVER_ID", false],
    ["MAIL_HOST", false], ["MAIL_LINK_SECRET", true], ["APP_BASE_URL", false],
    ["BULWARK_SERVICE_UUID", false], ["MAIL_DISK_GB", false],
    ["HOSTINGER_API_TOKEN", true], ["COOLIFY_BASE_URL", false], ["COOLIFY_TOKEN", true],
    ["SMTP_HOST", false], ["SMTP_USER", false], ["SMTP_PASS", true],
    ["FRAPPE_BASE_URL", false], ["FRAPPE_API_KEY", true], ["FRAPPE_API_SECRET", true],
  ];
  // Only these few non-secret values are ever echoed; everything else is just "set".
  const SHOW_VALUE = new Set(["STALWART_URL", "MAIL_HOST", "APP_BASE_URL", "MAIL_DISK_GB"]);
  for (const [k] of required) {
    if (has(k)) pass(`${k} is set`, SHOW_VALUE.has(k) ? `value: ${env(k)}` : undefined);
    else fail(`${k} is NOT set`);
  }
  if (has("MAIL_LINK_SECRET") && env("MAIL_LINK_SECRET").length < 24) warn("MAIL_LINK_SECRET is short", "Use at least 24 random characters.");
  if (has("MAIL_STACK_RAM_MB")) pass("MAIL_STACK_RAM_MB is set");
  else warn("MAIL_STACK_RAM_MB is not set", "Measure the running mail stack and set it before real orders.");

  // Cross-checks that the code assumes.
  if (has("STALWART_URL")) {
    let host = "";
    try { host = new URL(env("STALWART_URL")).host.toLowerCase(); } catch { fail("STALWART_URL is not a valid URL"); }
    if (host && has("MAIL_HOST") && host !== env("MAIL_HOST").toLowerCase()) {
      warn("STALWART_URL host differs from MAIL_HOST", `STALWART_URL host: ${host}\nMAIL_HOST: ${env("MAIL_HOST")}\n(Allowed if the management API is on another name; MAIL_HOST must be the MX/IMAP/SMTP name.)`);
    }
  }
  if (has("APP_BASE_URL") && !/^https:\/\//i.test(env("APP_BASE_URL"))) warn("APP_BASE_URL is not https", "Status links in emails should be https.");
  if (process.env.NODE_ENV !== "production") warn(`NODE_ENV=${process.env.NODE_ENV || "(unset)"}`, "Fine for a laptop run. On the server it should be production.");
}

/* -------------------------------- 2. Stalwart ------------------------------- */
async function jmapCall(base, headers, using, method, argsObj) {
  const res = await fetch(`${base}/jmap`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ using, methodCalls: [[method, argsObj, "c0"]] }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.status >= 400) return { error: `HTTP ${res.status}` };
  const mr = body && Array.isArray(body.methodResponses) ? body.methodResponses[0] : null;
  if (!mr) return { error: "malformed JMAP response" };
  if (mr[0] === "error") return { error: `JMAP error: ${(mr[1] && mr[1].type) || "unknown"}` };
  return { result: mr[1] };
}

async function checkStalwart() {
  section("2. Stalwart management API (JMAP, read-only)");
  if (!has("STALWART_URL") || !has("STALWART_API_KEY")) { skip("Stalwart checks", "STALWART_URL / STALWART_API_KEY not set."); return; }
  const { API_SHAPES } = require("../services/email/stalwartClient");
  const base = env("STALWART_URL").replace(/\/+$/, "");
  const mode = (env("STALWART_AUTH") || "bearer").toLowerCase();
  const headers = mode === "basic"
    ? { Authorization: `Basic ${Buffer.from(`${env("STALWART_API_USER")}:${env("STALWART_API_KEY")}`).toString("base64")}` }
    : { Authorization: `Bearer ${env("STALWART_API_KEY")}` };

  // Version: the authenticated session lists the management capability on 0.16+.
  let session = null;
  try {
    const res = await timed(() => fetch(`${base}/jmap/session`, { headers: { ...headers, Accept: "application/json" } }));
    if (res.status === 401 || res.status === 403) { fail("JMAP session rejected the API key", `HTTP ${res.status}. Check STALWART_API_KEY and STALWART_AUTH (${mode}).`); return; }
    if (res.status >= 400) { fail("JMAP session failed", `HTTP ${res.status}`); return; }
    session = await res.json();
  } catch (e) { fail("Could not reach Stalwart", e.message); return; }

  const caps = Object.keys((session && session.capabilities) || {});
  if (caps.includes("urn:stalwart:jmap")) pass("Stalwart management capability present (urn:stalwart:jmap): version is 0.16 or newer");
  else fail("urn:stalwart:jmap capability NOT in the authenticated session", `Capabilities seen: ${caps.join(", ")}\nIf Stalwart is older than 0.16, API_SHAPES needs a REST adapter. Otherwise the key may lack management rights.`);

  // Domains.
  const dg = API_SHAPES.domainGet;
  const d = await timed(() => jmapCall(base, headers, API_SHAPES.using, dg.method, dg.args()), 30000).catch((e) => ({ error: e.message }));
  let domains = [];
  if (d.error) {
    fail(`${dg.method} failed`, `${d.error}\nThe method name, 'using' list or arguments in API_SHAPES.domainGet are wrong for this server.`);
  } else {
    const list = Array.isArray(d.result.list) ? d.result.list : null;
    if (!list) fail(`${dg.method} returned no 'list'`, `Response keys: ${Object.keys(d.result).join(", ")}`);
    else {
      domains = list;
      pass(`${dg.method} works`, `${list.length} domain(s): ${list.map((x) => x.name).filter(Boolean).slice(0, 12).join(", ")}`);
      const sample = list[0] || {};
      const keys = Object.keys(sample);
      pass("Domain object property names", keys.join(", "));
      if (list.length && !("description" in sample)) warn("Domain objects have no 'description' property", "The ownership marker (murzak-order:<order>) cannot be read back; the lane then relies on mailSetup.stalwartDomainId only. Acceptable, but record it.");
      else if (list.length) pass("Domain 'description' is readable (ownership marker can be verified)");
      if (list.length && !("dkimRecord" in sample)) warn("Domain objects have no 'dkimRecord' property", "API_SHAPES.domainDkim reads d.dkimRecord. Find where this server exposes the DKIM TXT record and change that one entry.");
      else if (list.length) pass("Domain 'dkimRecord' property exists (value not shown)");
    }
  }

  // Accounts.
  const ag = API_SHAPES.accountGet;
  const a = await timed(() => jmapCall(base, headers, API_SHAPES.using, ag.method, ag.args()), 30000).catch((e) => ({ error: e.message }));
  if (a.error) fail(`${ag.method} failed`, a.error);
  else if (!Array.isArray(a.result.list)) fail(`${ag.method} returned no 'list'`, `Response keys: ${Object.keys(a.result).join(", ")}`);
  else {
    const list = a.result.list;
    pass(`${ag.method} works`, `${list.length} account(s)`);
    const sample = list[0] || {};
    pass("Account object property names", Object.keys(sample).join(", ") || "(no accounts to inspect)");
    for (const prop of ["emailAddress", "domainId", "quotas"]) {
      if (list.length && !(prop in sample)) warn(`Account objects have no '${prop}' property`, "API_SHAPES.accountGet reads this property; adjust the table.");
    }
  }

  // DNS server id the domains attach to.
  if (has("STALWART_DNS_SERVER_ID")) {
    const r = await timed(() => jmapCall(base, headers, API_SHAPES.using, "x:DnsServer/get", { ids: null }), 30000).catch((e) => ({ error: e.message }));
    if (r.error) warn("Could not list DNS servers to confirm STALWART_DNS_SERVER_ID", `${r.error}\n(The method name x:DnsServer/get is a guess. Confirm the id in the Stalwart admin UI instead.)`);
    else {
      const ids = (r.result.list || []).map((x) => String(x.id));
      if (ids.includes(env("STALWART_DNS_SERVER_ID"))) pass("STALWART_DNS_SERVER_ID matches a DNS server in Stalwart");
      else fail("STALWART_DNS_SERVER_ID matches no DNS server", `Ids found: ${ids.join(", ") || "(none)"}`);
    }
  }

  // The Murzak domain itself should exist and be healthy.
  const mailHostDomain = env("MAIL_HOST").split(".").slice(-2).join(".").toLowerCase();
  if (mailHostDomain && domains.length) {
    if (domains.some((x) => String(x.name || "").toLowerCase() === mailHostDomain)) pass(`Domain ${mailHostDomain} exists in Stalwart (reserved: customers cannot take it)`);
    else warn(`Domain ${mailHostDomain} not found in Stalwart`, "Expected for a Murzak mail host. Check MAIL_HOST.");
  }
}

/* ------------------------- 3. Hostinger DNS zone read ----------------------- */
async function checkHostingerDns() {
  section("3. Hostinger DNS zone (read-only GET)");
  if (!has("HOSTINGER_API_TOKEN")) { skip("Hostinger DNS", "HOSTINGER_API_TOKEN not set."); return; }
  const zone = ZONE || env("MAIL_HOST").split(".").slice(-2).join(".").toLowerCase();
  if (!zone) { skip("Hostinger DNS", "No --zone given and MAIL_HOST is not set."); return; }
  const hostingerApi = require("../services/hostingerApi");
  const { DNS_SHAPES } = require("../services/email/mailDns");
  const url = hostingerApi.apiUrl(`${hostingerApi.PATHS.dnsZones}/${encodeURIComponent(zone)}`);
  try {
    const res = await timed(() => fetch(url, { headers: { ...hostingerApi.authHeaders(), Accept: "application/json" } }));
    if (res.status === 401 || res.status === 403) { fail("Hostinger rejected the token for the DNS read", `HTTP ${res.status}`); return; }
    if (res.status === 404) { warn(`Zone ${zone} not found in this Hostinger account`, "Pass --zone=<a domain that IS in the account>. (Customer domains elsewhere are expected to fail and be tolerated.)"); return; }
    if (res.status >= 400) { fail("Hostinger DNS read failed", `HTTP ${res.status}`); return; }
    const body = await res.json();
    const shape = Array.isArray(body) ? "bare array" : `object with keys: ${Object.keys(body || {}).join(", ")}`;
    const entries = DNS_SHAPES.readEntries(body);
    if (entries.length) {
      const byType = {};
      for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
      pass(`GET zone ${zone} parses with DNS_SHAPES.readEntries`, `response shape: ${shape}\n${entries.length} record(s): ${Object.entries(byType).map(([t, n]) => `${t}x${n}`).join(", ")}`);
      const mx = entries.filter((e) => e.type === "MX").length;
      const hasWebmail = entries.some((e) => /^webmail(\.|$)/i.test(String(e.name || "")));
      pass(`${mx} MX record(s) present`);
      if (hasWebmail) pass("A 'webmail' record already exists in this zone (ensureWebmailCname would leave it if it matches)");
    } else {
      fail(`GET zone ${zone} returned nothing DNS_SHAPES.readEntries understands`, `response shape: ${shape}\nChange only DNS_SHAPES.readEntries in backend/services/email/mailDns.js.`);
    }
  } catch (e) { fail("Could not reach Hostinger", e.message); }
}

/* ---------------------------------- 4. Coolify ------------------------------ */
async function checkCoolify() {
  section("4. Coolify / Bulwark webmail (read-only GET) — run this on the VPS if your IP is not allow-listed");
  if (!has("COOLIFY_BASE_URL") || !has("COOLIFY_TOKEN") || !has("BULWARK_SERVICE_UUID")) { skip("Coolify checks", "COOLIFY_BASE_URL / COOLIFY_TOKEN / BULWARK_SERVICE_UUID not set."); return; }
  const base = env("COOLIFY_BASE_URL").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${env("COOLIFY_TOKEN")}`, Accept: "application/json" };
  const svc = encodeURIComponent(env("BULWARK_SERVICE_UUID"));
  const get = async (path) => {
    const res = await timed(() => fetch(`${base}${path}`, { headers }));
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body };
  };
  try {
    const s = await get(`/api/v1/services/${svc}`);
    if (s.status === 401 || s.status === 403) { fail("Coolify rejected the token", `HTTP ${s.status}. If this is a 403 from the network, your IP is probably not allow-listed: run on the VPS.`); return; }
    if (s.status === 404) { fail("BULWARK_SERVICE_UUID not found in Coolify", "HTTP 404"); return; }
    if (s.status >= 400) { fail("Coolify service read failed", `HTTP ${s.status}`); return; }
    const status = s.body && (s.body.status || (s.body.service && s.body.service.status));
    pass("Bulwark service found in Coolify", `name: ${(s.body && s.body.name) || "(unknown)"}\nstatus: ${status || "(not shown)"}`);
    if (status && !/running/i.test(String(status))) warn("Bulwark service is not 'running'", String(status));

    // Version and verb style. Newer Coolify only accepts POST for start/restart/stop (a
    // GET answers 405); older ones only accept GET. The lane handles both (GET, then POST
    // on a 405). The probe uses a uuid that cannot exist, so nothing is restarted.
    try {
      const vr = await timed(() => fetch(`${base}/api/v1/version`, { headers }));
      const vtxt = vr.status === 200 ? (await vr.text()).trim().replace(/["\s]/g, "").slice(0, 30) : "";
      if (vtxt) pass(`Coolify version ${vtxt}`);
      else warn("Could not read the Coolify version", `HTTP ${vr.status}`);
    } catch (e) { warn("Could not read the Coolify version", e.message); }
    const probe = await get("/api/v1/services/00000000-0000-0000-0000-000000000000/restart");
    if (probe.status === 405) pass("Restart/start/stop need POST on this Coolify (newer style)", "The lane tries GET, gets 405, and repeats as POST automatically.");
    else if (probe.status === 404) pass("Restart/start/stop still work with GET on this Coolify (older style)");
    else warn(`Unexpected answer to the restart-verb probe: HTTP ${probe.status}`);

    // Which address-list PATCH form is available?
    if (has("BULWARK_APP_UUID")) {
      const a = await get(`/api/v1/services/${svc}/applications/${encodeURIComponent(env("BULWARK_APP_UUID"))}`);
      if (a.status === 200) pass("Application form is available (GET services/<uuid>/applications/<app>)", `property names: ${Object.keys(a.body || {}).join(", ")}`);
      else warn("Application form GET did not return 200", `HTTP ${a.status}. The code falls back to the service 'urls' PATCH form if BULWARK_APP_UUID is unset; check which one Coolify 4.1.2 accepts.`);
    } else {
      warn("BULWARK_APP_UUID not set", "The lane will use the service 'urls' PATCH form (the form proven in this repo for other services).");
    }

    // Env keys (names only; values can hold client names, so they are not printed).
    const e = await get(`/api/v1/services/${svc}/envs`);
    if (e.status >= 400) { fail("Coolify env list failed", `HTTP ${e.status}`); return; }
    const rows = Array.isArray(e.body) ? e.body : (e.body && Array.isArray(e.body.data) ? e.body.data : []);
    const keys = rows.map((r) => r.key);
    pass("Env list readable", `${keys.length} variable(s)`);
    const brand = rows.find((r) => r.key === "DOMAIN_BRANDING");
    if (!brand) warn("DOMAIN_BRANDING is not set yet", "Expected before the first mail order: the lane creates it. Confirm Bulwark really reads a variable of this name.");
    else {
      try {
        const parsed = JSON.parse(brand.value);
        pass("DOMAIN_BRANDING is valid JSON", Array.isArray(parsed) ? `a list of ${parsed.length} client(s)${parsed[0] ? `; entry property names: ${Object.keys(parsed[0]).join(", ")}` : ""}` : `an object with keys: ${Object.keys(parsed).join(", ")}`);
        if (!Array.isArray(parsed)) warn("DOMAIN_BRANDING is not a list", "webmailBranding.js writes and reads a LIST of {domain,title,logoUrl}. The format Bulwark actually reads must be confirmed before the first order.");
      } catch { fail("DOMAIN_BRANDING exists but is not valid JSON", "webmailBranding.js would refuse to shrink or rewrite it."); }
    }
    pass(`DOMAIN_BRANDING_APPLIED ${keys.includes("DOMAIN_BRANDING_APPLIED") ? "exists" : "does not exist yet (created on first restart)"}`);
  } catch (err) { fail("Could not reach Coolify", err.message); }
}

/* ------------------------------ 5. Frappe doctypes -------------------------- */
async function checkFrappe() {
  section("5. Frappe doctype fields the feature writes (metadata GET)");
  if (!has("FRAPPE_BASE_URL") || !has("FRAPPE_API_KEY") || !has("FRAPPE_API_SECRET")) { skip("Frappe checks", "FRAPPE_* not set."); return; }
  const base = env("FRAPPE_BASE_URL").replace(/\/+$/, "");
  const headers = { Authorization: `token ${env("FRAPPE_API_KEY")}:${env("FRAPPE_API_SECRET")}`, Accept: "application/json" };
  async function meta(doctype) {
    const res = await timed(() => fetch(`${base}/api/method/frappe.desk.form.load.getdoctype?doctype=${encodeURIComponent(doctype)}`, { headers }));
    if (res.status >= 400) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    const docs = (body.docs || (body.message && body.message.docs) || []);
    return { docs };
  }
  const fieldsOf = (docs, name) => { const d = docs.find((x) => x.name === name); return d ? d.fields || [] : null; };
  const selectHas = (fields, fieldname, option) => {
    const f = (fields || []).find((x) => x.fieldname === fieldname);
    if (!f) return `field '${fieldname}' does not exist`;
    if (f.fieldtype !== "Select") return null; // free text: any value is accepted
    return String(f.options || "").split("\n").map((s) => s.trim()).includes(option) ? null : `'${option}' is not one of: ${String(f.options || "").split("\n").join(" | ")}`;
  };
  try {
    const t = await meta("Portal Users Requests");
    if (t.error) warn("Could not read 'Portal Users Requests' metadata", t.error);
    else {
      const f = fieldsOf(t.docs, "Portal Users Requests");
      if (!f) fail("'Portal Users Requests' doctype not found");
      else {
        const problems = [];
        for (const name of ["portal_user", "email", "subject", "status", "source", "messages"]) if (!f.some((x) => x.fieldname === name)) problems.push(`missing field '${name}'`);
        const st = selectHas(f, "status", "Waiting on Admin"); if (st) problems.push(`status: ${st}`);
        const so = selectHas(f, "source", "Portal"); if (so) problems.push(`source: ${so}`);
        const child = t.docs.find((x) => x.name !== "Portal Users Requests" && (x.fields || []).some((c) => c.fieldname === "sender_type"));
        if (!child) problems.push("could not find the message child table with sender_type");
        else for (const name of ["sender_type", "sender", "message"]) if (!child.fields.some((x) => x.fieldname === name)) problems.push(`child table missing '${name}'`);
        if (problems.length) fail("Staff ticket fields do not all match what mailLiveSweep.js writes (a real ticket would get a 417)", problems.join("\n"));
        else pass("Staff ticket fields match (status 'Waiting on Admin', source 'Portal', messages[])");
      }
    }
    const inv = await meta("Portal Invoice");
    if (inv.error) warn("Could not read 'Portal Invoice' metadata", inv.error);
    else {
      const f = fieldsOf(inv.docs, "Portal Invoice");
      if (!f) fail("'Portal Invoice' doctype not found");
      else {
        const p = selectHas(f, "status", "Paid");
        if (p) fail("Portal Invoice status 'Paid' check failed (mailSetupStore.saveMailSetup relies on it)", p);
        else pass("Portal Invoice has status 'Paid'");
      }
    }
    const job = await meta("Provisioning Job");
    if (job.error) warn("Could not read 'Provisioning Job' metadata", job.error);
    else {
      const f = fieldsOf(job.docs, "Provisioning Job") || [];
      const need = ["web_account", "service_id", "status", "external_ref", "access", "invoice", "error"];
      const miss = need.filter((n) => !f.some((x) => x.fieldname === n));
      if (miss.length) fail("Provisioning Job is missing fields the lane or portal read", miss.join(", "));
      else pass("Provisioning Job has the fields the mail lane and portal read");
    }
  } catch (e) { fail("Could not reach Frappe", e.message); }
}

/* ---------------------------------- 6. SMTP --------------------------------- */
async function checkSmtp() {
  section("6. Outgoing email for hand-over and codes (login test only; nothing is sent)");
  if (!has("SMTP_HOST") || !has("SMTP_USER") || !has("SMTP_PASS")) { skip("SMTP", "SMTP_* not set."); return; }
  let nodemailer;
  try { nodemailer = require("nodemailer"); } catch { skip("SMTP", "nodemailer is not installed here."); return; }
  const port = Number(env("SMTP_PORT") || 587);
  const t = nodemailer.createTransport({
    host: env("SMTP_HOST"), port, secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") }, connectionTimeout: 15000, greetingTimeout: 15000,
  });
  try { await timed(() => t.verify(), 30000); pass(`SMTP login works (${env("SMTP_HOST")}:${port})`); }
  catch (e) { fail("SMTP login failed", e.message); }
}

/* ------------------------- 7. VPS-only: port 25 + PTR ------------------------ */
function tcpBanner(host, port, ms = 10000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = "";
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.setTimeout(ms, () => done({ ok: false, why: `timed out after ${ms / 1000}s` }));
    sock.on("error", (e) => done({ ok: false, why: e.code || e.message }));
    sock.on("data", (d) => { buf += d.toString("utf8"); if (buf.includes("\n")) done({ ok: true, banner: buf.split(/\r?\n/)[0].slice(0, 100) }); });
  });
}

async function checkVps() {
  section("7. Sending reputation basics (only meaningful when run ON the VPS)");
  if (!flag("vps")) { skip("Outbound port 25 and PTR", "Run this script on the VPS with --vps. From another machine the answers say nothing about the server."); return; }
  const r = await tcpBanner("gmail-smtp-in.l.google.com", 25);
  if (r.ok) pass("Outbound port 25 works from this machine", r.banner);
  else fail("Outbound port 25 is blocked from this machine", `${r.why}\nAsk the provider to open outbound port 25, or mail to other servers will not leave.`);
  if (!has("MAIL_HOST")) { skip("PTR", "MAIL_HOST not set."); return; }
  try {
    const ips = await dns.resolve4(env("MAIL_HOST"));
    pass(`MAIL_HOST resolves`, ips.join(", "));
    for (const ip of ips) {
      try {
        const names = (await dns.reverse(ip)).map((n) => n.toLowerCase().replace(/\.$/, ""));
        if (names.includes(env("MAIL_HOST").toLowerCase())) pass(`PTR of ${ip} matches MAIL_HOST`);
        else fail(`PTR of ${ip} does not match MAIL_HOST`, `PTR says: ${names.join(", ")}\nSet the reverse DNS for this IP to ${env("MAIL_HOST")} at the VPS provider.`);
      } catch (e) { fail(`No PTR record for ${ip}`, e.code || e.message); }
    }
  } catch (e) { fail("MAIL_HOST does not resolve", e.code || e.message); }
}

/* ---------------------------------- main ------------------------------------ */
async function main() {
  console.log("Mail dry-run preflight (read-only). Nothing is created, changed, deleted or paid.");
  const groups = [
    ["env", checkEnv], ["stalwart", checkStalwart], ["dns", checkHostingerDns],
    ["coolify", checkCoolify], ["frappe", checkFrappe], ["smtp", checkSmtp], ["vps", checkVps],
  ];
  for (const [name, fn] of groups) {
    if (!wants(name) && !(name === "vps" && flag("vps") && ONLY.length === 0)) continue;
    try { await fn(); } catch (e) { fail(`${name} check crashed`, e && e.message); }
  }
  const n = (l) => results.filter((x) => x === l).length;
  console.log(`\nSummary: ${n("PASS")} pass, ${n("WARN")} warn, ${n("FAIL")} fail, ${n("SKIP")} skipped.`);
  console.log("Still needs a human: the real M-Pesa payment, the QR scan on a phone, Gmail SPF/DKIM/DMARC headers, GA DebugView, nginx access-log check, backup restore drill.");
  process.exit(n("FAIL") > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error(`mail-dryrun-check crashed: ${scrub(e && e.message)}`); process.exit(2); });
}

module.exports = { scrub };
