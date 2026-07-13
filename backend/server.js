const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const axios = require("axios");
const bodyParser = require("body-parser");
const path = require("path");
require("dotenv").config();
const FormData = require("form-data");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("./utils/mailer");
const { createLoginThrottle } = require("./utils/loginThrottle");
const firebaseAdmin = require("./services/firebaseAdmin");

// ---- Short-lived token store for password reset & email verification ----
// In-memory (matches the current single-instance session store). Tokens are the
// secret carried in the emailed link; we store only their SHA-256 hash.
const passwordResetTokens = new Map(); // tokenHash -> { docName, email, expires }
const emailVerifyTokens = new Map();   // tokenHash -> { docName, email, expires }

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function pruneTokenStore(store) {
  const now = Date.now();
  for (const [k, v] of store) {
    if (!v || v.expires < now) store.delete(k);
  }
}

function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  // SECURITY: the Host header is attacker-controlled. Trusting it to build
  // password-reset / verification links enables host-header poisoning (an
  // attacker receives a working reset link pointing at their own domain).
  // In production we refuse to fall back to it — APP_BASE_URL must be set.
  if (process.env.NODE_ENV === "production") {
    console.error("APP_BASE_URL is not set in production — refusing to build links from the Host header.");
    throw new Error("APP_BASE_URL must be set in production.");
  }
  return `${req.protocol}://${req.get("host")}`;
}

// Reject obviously dangerous uploads at the multer layer (10 MB cap).
const ALLOWED_UPLOAD_EXT = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".zip", ".json", ".html", ".css", ".js", ".woff", ".woff2", ".ttf",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ALLOWED_UPLOAD_EXT.has(ext)) return cb(null, true);
    cb(new Error(`File type not allowed: ${ext || "unknown"}`));
  },
});

// ---- Fail fast on missing critical secrets in production ----
if (process.env.NODE_ENV === "production") {
  const required = ["SESSION_SECRET", "FRAPPE_BASE_URL", "FRAPPE_API_KEY", "FRAPPE_API_SECRET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`FATAL: missing required env vars in production: ${missing.join(", ")}`);
    process.exit(1);
  }

  // These dev-only escape hatches bypass real auth / real Frappe data. A stray
  // `true` copied from a dev .env must never boot in production.
  const devFlags = ["DEV_AUTO_LOGIN", "MOCK_FRAPPE"].filter((k) => process.env[k] === "true");
  if (devFlags.length) {
    console.error(`FATAL: dev-only flag(s) set to true in production: ${devFlags.join(", ")}`);
    process.exit(1);
  }
}


const createPaypalRouter = require("./routes/paypalRoutes");
const createAiRouter = require("./routes/aiRoutes");
const { activateServicesForInvoice } = require("./services/billingActivationService");
const { effectiveChargeKes, isVerificationOnly } = require("./utils/billingAmount");
const { assertOrderWithinCapacity } = require("./services/orderCapacity");
const { capturedAmountMatches } = require("./services/paypalService");
const { getServiceMeta, sumSelectedServicesMonthlyKes } = require("./services/provisioning/catalog");

// Which demo service seeds a trial sandbox (override per env). Used by the
// KES-1 trial-verification flow.
const TRIAL_SANDBOX_SERVICE_ID = process.env.TRIAL_SANDBOX_SERVICE_ID || "test-erpnext-demo";
const provisioningRunner = require("./services/provisioning/runner");
const provisioningQueue = require("./services/provisioning/queue");
const { JOB_DOCTYPE: PROVISIONING_JOB_DOCTYPE } = require("./services/provisioning/provisioningService");
const { CAPACITY_REQUEST_DOCTYPE } = require("./services/provisioning/scaling");
const provisioningTargets = require("./services/provisioning/targets");
const { paypalConfig } = require("./config/paypal");
const fs = require("fs");
const fsp = fs.promises;

const app = express();
app.set("trust proxy", 1);
// START
const PORT = process.env.PORT || 3001;

// ---- Paths ----
// Serve the *built* React app (Vite output) from /frontend/dist
const frontendDistPath = path.join(__dirname, "..", "frontend", "dist");

// ---- Middleware ----
// Security headers (HSTS, X-Frame-Options, nosniff, referrer-policy, etc.) plus a
// tailored CSP. Origins pinned: self for the bundled SPA, PayPal for checkout,
// esm.sh for the importmap, unsplash for a few marketing images, data/blob for
// inline assets. 'unsafe-inline' is required for Tailwind's injected styles.
// NOTE: verify PayPal checkout + image loading after deploy; tweak origins here.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://esm.sh", "https://*.paypal.com", "https://*.paypalobjects.com", "https://www.googletagmanager.com", "https://apis.google.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://esm.sh"],
        "img-src": ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://*.paypal.com", "https://*.paypalobjects.com", "https://www.google-analytics.com", "https://*.google-analytics.com"],
        "font-src": ["'self'", "data:", "https://esm.sh"],
        "connect-src": ["'self'", "https://esm.sh", "https://*.paypal.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://www.googleapis.com", "https://firebaseinstallations.googleapis.com", "https://*.google-analytics.com", "https://*.googletagmanager.com", "https://*.firebaseio.com"],
        "frame-src": ["'self'", "https://*.paypal.com", "https://*.firebaseapp.com", "https://accounts.google.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
  })
);

// CORS: same-origin in production (frontend is served from this app), but allow
// an explicit allow-list for split deployments / local dev.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors(function corsOptionsDelegate(req, cb) {
    const origin = req.headers.origin;
    // No Origin header: server-to-server, curl, some same-origin GETs.
    if (!origin) return cb(null, { origin: true, credentials: true });

    // Browsers send Origin on ALL POSTs — including same-origin ones — so a
    // request from the very site this app serves must always pass, or an empty
    // allow-list would 403 every login/payment POST in production. Compare the
    // Origin against this request's own scheme+host (trust proxy is set, so
    // req.protocol honors X-Forwarded-Proto).
    const sameOrigin = origin === `${req.protocol}://${req.headers.host}`;
    if (sameOrigin || allowedOrigins.includes(origin)) {
      return cb(null, { origin: true, credentials: true });
    }

    // FAIL CLOSED for everything else. 403, not a generic 500 — a CORS denial
    // must be identifiable from the client (it once masqueraded as "Something
    // went wrong" and cost a debug).
    const err = new Error("Not allowed by CORS");
    err.statusCode = 403;
    return cb(err);
  })
);

// Bound request bodies to prevent memory-exhaustion payloads.
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}

// ---- Session store ----
// Use Redis when REDIS_URL is configured (persistent + multi-instance safe);
// otherwise fall back to the in-memory store. A shared redisClient is exported
// for other state too (e.g. per-account login throttling). Init is guarded so a
// missing/misbehaving Redis never crashes boot.
let sessionStore; // undefined => express-session default MemoryStore
let redisClient = null;
if (process.env.REDIS_URL) {
  try {
    const { createClient } = require("redis");
    const { RedisStore } = require("connect-redis");
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (e) => console.error("REDIS ERROR:", e.message));
    redisClient.connect()
      .then(() => console.log("Redis connected — session store active."))
      .catch((e) => console.error("REDIS CONNECT FAILED (using MemoryStore):", e.message));
    sessionStore = new RedisStore({ client: redisClient, prefix: "murzak:sess:" });
  } catch (e) {
    console.error("Redis session store init failed (using MemoryStore):", e.message);
    sessionStore = undefined;
    redisClient = null;
  }
}
if (!sessionStore && process.env.NODE_ENV === "production") {
  console.warn("WARNING: in-memory session store in production — set REDIS_URL for persistence/scale.");
}

// Per-account brute-force lockout (account-keyed, complements the IP limiter).
// Shares the session Redis client when present; otherwise in-memory.
const loginThrottle = createLoginThrottle(redisClient);

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET || "dev_only_insecure_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// ---- Rate limiters ----
// Tight limiter for auth/credential endpoints to blunt brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});
// Broad limiter for the rest of the API surface.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// AI Limiter: 50 requests per hour per IP to protect OpenRouter tokens
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Murzaker is resting. Please try again later (Rate limit exceeded)." },
});
app.use("/api/ai", aiLimiter);

// Tight per-IP limiter for UNAUTHENTICATED endpoints that write to / query Frappe
// (contact requests, trial signups, domain lookups). Blunts spam/abuse that the
// broad apiLimiter is too loose to stop. Generous enough for real humans.
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this device. Please try again later." },
});

// Domain availability is a lookup users hit repeatedly while searching, so it
// gets a looser limit than the write/signup forms — still tight enough to stop
// scripted enumeration of the registrar proxy.
const domainCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many domain lookups. Please slow down and try again shortly." },
});

app.use(
  "/api/paypal",
  createPaypalRouter({
    requireAuth,
    frappeClient,
    activateServicesForInvoice: async ({ req, invoiceDocName, paymentVerified }) => {
      return activateServicesForInvoice({
        req,
        invoiceDocName,
        paymentVerified,
        frappeClient,
        PORTAL_INVOICE_SERVICES_FIELD,
        CHILD_SERVICE_ID_FIELD,
        WEB_ACCOUNT_SERVICES_FIELD,
        CHILD_STATUS_FIELD,
        fetchInvoicesForUser,
        fetchSelectedServicesForUser,
        buildUserPayload,
      });
    },
  })
);

app.use("/api/ai", createAiRouter({ requireAuth, frappeClient }));

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    // Log the path only — never the cookie header (session tokens in logs).
    console.log("requireAuth: no session user for", req.path);
  }

  if (process.env.DEV_AUTO_LOGIN === "true") {
    if (!req.session.user) {
      req.session.user = {
        id: "dev-user@example.com",
        name: "Dev User",
        email: "dev-user@example.com",
        plan: "Business",
        accountStatus: "Active",
        hasActiveTrial: false,
        services: [],
        invoices: []
      };
    }
    return next();
  }

  if (!req.session?.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  next();
}

function requireAdmin(req, res, next) {
  const allow = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const email = (req.session?.user?.email || "").toLowerCase();

  if (!email || !allow.includes(email)) {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
}

// helper: basic but effective email shape validation
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// helper: MySQL DATETIME format (UTC+3)
function mysqlDatetimeUTC(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const t = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return (
    t.getUTCFullYear() +
    "-" + pad(t.getUTCMonth() + 1) +
    "-" + pad(t.getUTCDate()) +
    " " + pad(t.getUTCHours()) +
    ":" + pad(t.getUTCMinutes()) +
    ":" + pad(t.getUTCSeconds())
  );
}

// 1) Serve static files (Vite build assets)
// This serves: /assets/*, favicon, etc.
app.use(express.static(frontendDistPath));

// Frappe config
const FRAPPE_BASE_URL = process.env.FRAPPE_BASE_URL;
const FRAPPE_AUTH = `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`;

function frappeClient() {
  if (process.env.MOCK_FRAPPE === 'true') {
    // In-memory document store — shared across all mock client instances so the
    // provisioning runner (which gets a fresh client per tick) sees the same data.
    if (!global.__mockFrappeStore) {
      global.__mockFrappeStore = {};
      // Seed a Web Account so provisioning / billing flows have something to read.
      global.__mockFrappeStore['Web Account'] = [
        {
          name: 'MOCK_ACCOUNT', account_holder_name: 'Admin User',
          work_email: 'dev-user@example.com', plan: 'Business',
          password_hash: '$2b$10$WAAa5npnUZwiw80dUUzgduKy8hm.eUuygS4W8Hv6MsfsHbuH4xJ4O',
          account_status: 'Active', 
          selected_services: JSON.stringify([{
            serviceId: "test-erpnext-demo", name: "Premium ERP", planId: "business", status: "Active"
          }])
        },
        {
          name: 'CLIENT_ACCOUNT', account_holder_name: 'Normal Client',
          work_email: 'client@example.com', plan: 'Business',
          password_hash: '$2b$10$WAAa5npnUZwiw80dUUzgduKy8hm.eUuygS4W8Hv6MsfsHbuH4xJ4O',
          account_status: 'Active', 
          selected_services: JSON.stringify([{
            serviceId: "volume-web", name: "Client Site", planId: "business", status: "Active"
          }])
        }
      ];
      console.log('[mock-frappe] in-memory store initialised');
    }
    const store = global.__mockFrappeStore;
    const ensure = (dt) => { if (!store[dt]) store[dt] = []; };

    /** Simple filter matcher: supports [field, "=", val] and [field, "in", [...]] */
    const matchFilters = (doc, filters) => {
      if (!filters || !filters.length) return true;
      return filters.every(([field, op, val]) => {
        const v = doc[field];
        if (op === '=') return v === val;
        if (op === '!=' ) return v !== val;
        if (op === 'in') return Array.isArray(val) && val.includes(v);
        if (op === 'like') return String(v || '').includes(String(val).replace(/%/g, ''));
        return true;
      });
    };

    return {
      get: async (url, config) => {
        // Detect doctype from URL: /api/resource/Provisioning%20Job/PRV-00001 or /api/resource/Provisioning%20Job
        const resourceMatch = url.match(/\/api\/resource\/([^/?]+)(?:\/([^/?]+))?/);
        if (resourceMatch) {
          const doctype = decodeURIComponent(resourceMatch[1]);
          const docName = resourceMatch[2] ? decodeURIComponent(resourceMatch[2]) : null;
          ensure(doctype);

          if (docName) {
            // Single document GET
            const doc = store[doctype].find(d => d.name === docName);
            if (!doc) {
              const err = new Error(`${doctype} ${docName} not found`);
              err.response = { status: 404 }; throw err;
            }
            return { data: { data: { ...doc } } };
          }

          // List GET with optional filters
          let rows = store[doctype];
          const params = config?.params || {};
          if (params.filters) {
            const f = typeof params.filters === 'string' ? JSON.parse(params.filters) : params.filters;
            rows = rows.filter(d => matchFilters(d, f));
          }
          const limit = params.limit_page_length != null ? Number(params.limit_page_length) : 20;
          if (limit > 0) rows = rows.slice(0, limit);
          // Field projection
          if (params.fields) {
            const fields = typeof params.fields === 'string' ? JSON.parse(params.fields) : params.fields;
            rows = rows.map(d => {
              const out = {};
              fields.forEach(f => { out[f] = d[f]; });
              return out;
            });
          }
          return { data: { data: rows } };
        }
        return { data: { data: [] } };
      },

      post: async (url, data) => {
        const resourceMatch = url.match(/\/api\/resource\/([^/?]+)/);
        if (resourceMatch) {
          const doctype = decodeURIComponent(resourceMatch[1]);
          ensure(doctype);
          // Auto-generate a name
          const seq = String(store[doctype].length + 1).padStart(5, '0');
          const prefix = doctype === 'Provisioning Job' ? 'PRV' :
                         doctype === 'Capacity Request' ? 'CAP' :
                         doctype === 'Portal Invoice'   ? 'INV' :
                         doctype === 'Web Account'      ? 'WA'  : 'DOC';
          const name = data?.name || `${prefix}-MOCK-${seq}`;
          // Check unique job_key
          if (data?.job_key && store[doctype].some(d => d.job_key === data.job_key)) {
            const err = new Error('DuplicateEntryError: duplicate job_key');
            err.response = { status: 409, data: { _error_message: 'duplicate' } }; throw err;
          }
          const doc = { ...data, name, doctype, creation: new Date().toISOString(), modified: new Date().toISOString() };
          store[doctype].push(doc);
          console.log(`[mock-frappe] created ${doctype}/${name}`);
          return { data: { data: doc } };
        }
        return { data: { data: { name: 'doc-' + Date.now() } } };
      },

      put: async (url, data) => {
        const resourceMatch = url.match(/\/api\/resource\/([^/?]+)\/([^/?]+)/);
        if (resourceMatch) {
          const doctype = decodeURIComponent(resourceMatch[1]);
          const docName = decodeURIComponent(resourceMatch[2]);
          ensure(doctype);
          const idx = store[doctype].findIndex(d => d.name === docName);
          if (idx >= 0) {
            store[doctype][idx] = { ...store[doctype][idx], ...data, modified: new Date().toISOString() };
            return { data: { data: store[doctype][idx] } };
          }
          // Upsert if not found (e.g. Web Account rows written by runner)
          const doc = { name: docName, doctype, ...data, modified: new Date().toISOString() };
          store[doctype].push(doc);
          return { data: { data: doc } };
        }
        return { data: { data: { name: url } } };
      },
    };
  }
  return axios.create({
    baseURL: FRAPPE_BASE_URL,
    headers: {
      Authorization: FRAPPE_AUTH,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 15000,
  });
}

const buildUserPayload = ({ record, planOverride, invoices = [], selectedServices = [], updates = [] }) => {
  const adminList = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const email = record.work_email || "";
  return {
    id: record.name,
    name: record.account_holder_name,
    email,
    // Lets the portal show admin-only UI for whoever is in ADMIN_EMAILS (the same
    // list the backend enforces with requireAdmin) — not a hard-coded address.
    is_admin: !!email && adminList.includes(email.toLowerCase()),
    company: record.entity_name,
    plan: planOverride || record.plan || "None",
    accountStatus: record.account_status || "Active",
    sourceCode: record.source_code || "",
    evaluationGoal: record.purpose || "",

    // Portal shows immediately
    selectedServices: Array.isArray(selectedServices) ? selectedServices : [],

    addonServiceIds: (() => {
      try { return JSON.parse(record.addon_service_ids || "[]"); } catch { return []; }
    })(),    

    // REQUIRED ARRAYS
    projects: [],
    servers: [],
    invoices: Array.isArray(invoices) ? invoices : [],
    updates: Array.isArray(updates) ? updates : [],

  };
};

const SERVICE_ID_TO_PLAN = {
  // Test
  "test-web-hosting-demo": "Test",
  "test-erpnext-demo": "Test",
  "test-crm-demo": "Test",
  "test-staging-demo": "Test",

  // Starter
  "starter-web-hosting": "Starter",
  "starter-email": "Starter",
  "starter-storage": "Starter",
  "starter-hrpay": "Starter",
  "starter-erp-light": "Starter",
  "starter-db-light": "Starter",

  // Business
  "biz-erp-configured": "Business",
  "biz-erp-bring-your-own": "Business",
  "biz-web-hosting": "Business",
  "biz-crm-helpdesk": "Business",
  "biz-accounting": "Business",
  "biz-db-medium": "Business",
  "biz-email-large": "Business",
  "biz-pos-inventory": "Business",
  "biz-webapps": "Business",
  "biz-docs": "Business",

  // Enterprise
  "ent-erp-large": "Enterprise",
  "ent-db-large": "Enterprise",
  "ent-ecom-large": "Enterprise",
  "ent-bi": "Enterprise",
  "ent-pos-multibranch": "Enterprise",
  "ent-mail": "Enterprise",
  "ent-cctv": "Enterprise",
  "ent-backup-server": "Enterprise",
};

function normalizeChildRow(r) {
  return {
    doctype: WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
    // Keep `name` if it exists (important for existing rows)
    ...(r?.name ? { name: r.name } : {}),
    [CHILD_SERVICE_ID_FIELD]: r?.[CHILD_SERVICE_ID_FIELD] || r?.serviceId || r?.service_id,
    [CHILD_SERVICE_NAME_FIELD]: r?.[CHILD_SERVICE_NAME_FIELD] || r?.serviceName || r?.service_name,
    [CHILD_TIER_FIELD]: r?.[CHILD_TIER_FIELD] || r?.tier,
    ...(r?.[CHILD_DOMAIN_CHOICE_FIELD] || r?.domainChoice
      ? { [CHILD_DOMAIN_CHOICE_FIELD]: r?.[CHILD_DOMAIN_CHOICE_FIELD] || r?.domainChoice }
      : {}),
    [CHILD_STATUS_FIELD]: r?.[CHILD_STATUS_FIELD] || r?.status || SERVICE_STATUS_AWAITING,
  };
}

function computeProratedCreditKes(latestPaidInv) {
  // Simple: 30-day cycle based on invoice_date
  // If invoice is older than 30 days → no credit
  try {
    const amount = Number(latestPaidInv?.amount || 0);
    const d0 = latestPaidInv?.invoice_date;
    if (!amount || !d0) return 0;

    const start = new Date(d0 + "T00:00:00Z").getTime();
    const now = Date.now();
    const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    if (days < 0 || days >= 30) return 0;

    const remaining = 30 - days;
    const credit = Math.round((amount * remaining) / 30);
    return Math.max(0, credit);
  } catch {
    return 0;
  }
}

function normalizeSelectedServices(input) {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((s) => ({
      serviceId: String(s?.serviceId || s?.service_id || "").trim(),
      serviceName: String(s?.serviceName || s?.service_name || "").trim(),
      tier: String(s?.tier || "").trim(),
      domainChoice: String(s?.domainChoice || s?.domain_choice || "").trim(),
      status: (String(s?.status || "").trim() === "Active") ? "Active" : "Awaiting Payment",
    }))
    .filter((s) => !!s.serviceId);
}

function buildWebAccountServiceRows(selectedServices) {
  return selectedServices.map((s) => ({
    doctype: WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
    [CHILD_SERVICE_ID_FIELD]: s.serviceId,
    [CHILD_SERVICE_NAME_FIELD]: s.serviceName || "",
    [CHILD_TIER_FIELD]: s.tier || "",
    [CHILD_DOMAIN_CHOICE_FIELD]: s.domainChoice || "",
    [CHILD_STATUS_FIELD]: s.status || "Awaiting Payment",
  }));
}

function buildInvoiceServiceRows(selectedServices) {
  return selectedServices.map((s) => ({
    doctype: PORTAL_INVOICE_SERVICE_CHILD_DOCTYPE,
    [CHILD_SERVICE_ID_FIELD]: s.serviceId,
    [CHILD_SERVICE_NAME_FIELD]: s.serviceName || "",
    [CHILD_TIER_FIELD]: s.tier || "",
    [CHILD_DOMAIN_CHOICE_FIELD]: s.domainChoice || "",
    [CHILD_STATUS_FIELD]: s.status || "Awaiting Payment",
  }));
}


async function fetchWebAccount(client, webAccountName) {
  const res = await client.get(`/api/resource/${WEB_ACCOUNT_DOCTYPE}/${encodeURIComponent(webAccountName)}`);
  return res.data?.data;
}

async function updateWebAccountServices(client, webAccountName, newRows) {
  // newRows must be fully normalized rows with doctype + (name if existing)
  return client.put(`/api/resource/${WEB_ACCOUNT_DOCTYPE}/${encodeURIComponent(webAccountName)}`, {
    [WEB_ACCOUNT_SERVICES_FIELD]: newRows,
  });
}

async function hasPaidSubscriptionForPlan(client, webAccountName, planKey) {
  const res = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["status", "=", "Paid"],
        ["type", "=", "Subscription"],
        ["plan", "=", planKey],
      ]),
      fields: JSON.stringify(["name"]),
      limit_page_length: 1,
    },
  });
  return !!res.data?.data?.[0];
}

async function findOpenInvoice(client, webAccountName, type = "Subscription") {
  const resp = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["type", "=", type],
        ["status", "in", ["Unpaid", "Pending", "Draft"]], // adjust to statuses
        ["status", "!=", "Deleted"],
      ]),
      fields: JSON.stringify(["name", "invoice_no", "status", "plan", "amount"]),
      limit_page_length: 1,
      order_by: "modified desc",
    },
  });

  return resp.data?.data?.[0] || null;
}

function computeInvoiceAmount(planKey, selectedServices = []) {
  const base = PLAN_PRICING[planKey] ?? 0;

  // OPTIONAL: add-on pricing
  // for now base only (so billing doesn't break)
  return base;

  // later: sum addons by service pricing model
}

async function upsertPortalInvoice({ client, webAccountName, type, planKey, amount, servicesJson, invoiceDate }) {
  const open = await findOpenInvoice(client, webAccountName, type);

  if (open?.name) {
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`, {
      plan: planKey,
      amount,
      status: open.status || "Unpaid",
      invoice_date: invoiceDate,
      [INVOICE_SERVICES_JSON_FIELD]: servicesJson,
      [INVOICE_SERVICES_COUNT_FIELD]: JSON.parse(servicesJson || "{}")?.selectedServices?.length || 0,
    });
    return open.name;
  }

  const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
  const clientName = accRes.data?.data?.account_holder_name || "";

  const create = await client.post("/api/resource/Portal Invoice", {
    web_account: webAccountName,
    client_name: clientName,
    invoice_no: `INV-${Date.now()}`,
    type,
    plan: planKey,
    amount,
    status: "Unpaid",
    invoice_date: invoiceDate,
    [INVOICE_SERVICES_JSON_FIELD]: servicesJson,
    [INVOICE_SERVICES_COUNT_FIELD]: JSON.parse(servicesJson || "{}")?.selectedServices?.length || 0,
  });

  return create.data?.data?.name || null;
}

function assertWithinPlanLimit(planKey, selectedServices = []) {
  const list = Array.isArray(selectedServices) ? selectedServices : [];
  const limitRaw = PLAN_LIMITS[planKey];

  // Unknown plan or None => treat as 0 allowed
  const limit =
    typeof limitRaw === "number"
      ? limitRaw
      : 0;

  // Enterprise "unlimited-ish"
  if (limit >= 999) return;

  if (list.length > limit) {
    const err = new Error(`Plan limit exceeded: ${planKey} allows ${limit} services.`);
    err.statusCode = 400;
    throw err;
  }
}

function allowedAddonTiersForPlan(planKey) {
  if (planKey === "Starter") return ["Light"];
  if (planKey === "Business") return ["Medium"];
  if (planKey === "Enterprise") return ["Light", "Medium", "Large", "Enterprise"];
  return [];
}

function formatSelectedServices(services = []) {
  const names = (services || [])
    .map((s) => String(s?.serviceName || s?.serviceId || "").trim())
    .filter(Boolean);

  if (names.length === 0) return "No services selected.";
  if (names.length <= 3) return `Services: ${names.join(", ")}.`;
  return `Services: ${names.slice(0, 3).join(", ")} +${names.length - 3} more.`;
}

// -----------------------------
// PLAN SELECTION + BILLING MAPS
// -----------------------------
const PLAN_PRICING = {
  None: 0,
  Starter: 5000,
  Business: 25000,
  Enterprise: 0, // custom handled elsewhere
  Test: 0,
};


const PLAN_NAME_TO_KEY = {
  "Test Setup": "Test",
  "Starter Plan": "Starter",
  "Business Plan": "Business",
  "Enterprise Plan": "Enterprise",
};

// -----------------------------
// SERVICES / PLAN CONFIG
// -----------------------------
const WEB_ACCOUNT_DOCTYPE = "Web Account";

// Child table doctype name in Frappe:
const WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE = "Web Account Selected Service"; 

// Fieldname on Web Account that holds the child table rows:
const WEB_ACCOUNT_SERVICES_FIELD = "selected_services"; 

// Child row fieldnames:
const CHILD_SERVICE_ID_FIELD = "service_id";
const CHILD_SERVICE_NAME_FIELD = "service_name";
const CHILD_TIER_FIELD = "tier";
const CHILD_DOMAIN_CHOICE_FIELD = "domain_choice"; 
const CHILD_STATUS_FIELD = "status";               // "Active" | "Awaiting Payment"

// Allowed statuses for UI normalization:
const SERVICE_STATUS_ACTIVE = "Active";
const SERVICE_STATUS_AWAITING = "Awaiting Payment";

// Portal Invoice child table
const PORTAL_INVOICE_SERVICE_CHILD_DOCTYPE = "Portal Invoice Selected Service";
const PORTAL_INVOICE_SERVICES_FIELD = "selected_services";

// Portal Invoice JSON snapshot fields (used by upsertPortalInvoice helper)
const INVOICE_SERVICES_JSON_FIELD = "services_json";
const INVOICE_SERVICES_COUNT_FIELD = "services_count";

// plan limits (mirror frontend)
const PLAN_LIMITS = { Test: 1, Starter: 2, Business: 5, Enterprise: 999 };

// Helper: normalize/guard arrays
const asArray = (v) => (Array.isArray(v) ? v : []);

// Store plan choice in session before login/register
app.post("/api/plan/select", (req, res) => {
  try {
    const { planName } = req.body;
    const planKey = PLAN_NAME_TO_KEY[planName];
    if (!planKey) return res.status(400).json({ error: "Invalid planName" });

    req.session.pendingPlan = planKey;
    return res.json({ ok: true, pendingPlan: planKey });
  } catch (err) {
    console.error("PLAN SELECT ERROR:", err.message);
    return res.status(500).json({ error: "Failed to store plan selection." });
  }
});

// --- DOMAIN AVAILABILITY + PRICING ---
// Public (used by the plan configurator before login).
// NOTE: availability is currently a deterministic stub. Wire this to the
// Hostinger domain API (or a WHOIS/RDAP lookup) for real availability — the
// frontend already consumes { results: [{ domain, tld, available, priceKes }] }.
const DOMAIN_TLD_PRICES = {
  ".co.ke": 1200,
  ".com": 1500,
  ".ke": 1800,
  ".org": 1800,
  ".net": 1800,
  ".africa": 2500,
  ".io": 4500,
};

function normalizeDomainLabel(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z.]+$/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function stableHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Ask Hostinger which of these full domains are available.
// Returns a Map<fullDomain, boolean>, or null if the API isn't configured/failed
// (caller then falls back to the local stub). Pricing is always OUR KES retail —
// we resell, so we don't pass through Hostinger's wholesale price.
async function hostingerAvailability(label, tldsWithDot) {
  const token = process.env.HOSTINGER_API_TOKEN;
  if (!token) return null;

  const base = process.env.HOSTINGER_API_BASE || "https://developers.hostinger.com/api";
  try {
    const resp = await axios.post(
      `${base}/domains/v1/availability`,
      // Hostinger expects TLDs without the leading dot (e.g. "com", "co.ke").
      { domain: label, tlds: tldsWithDot.map((t) => t.replace(/^\./, "")) },
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 8000,
      }
    );

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    const map = new Map();
    for (const row of rows) {
      const dom = (row.domain || "").toLowerCase();
      if (!dom) continue;
      const available = row.is_available ?? row.available ?? row.is_free ?? false;
      map.set(dom, !!available);
    }
    return map.size ? map : null;
  } catch (err) {
    console.warn("HOSTINGER DOMAIN LOOKUP FAILED, using fallback:", err.message);
    return null;
  }
}

app.post("/api/domains/check", domainCheckLimiter, async (req, res) => {
  try {
    const label = normalizeDomainLabel(req.body?.label);
    if (!label) return res.status(400).json({ error: "Invalid domain label." });

    const requested = Array.isArray(req.body?.tlds) && req.body.tlds.length
      ? req.body.tlds.filter((t) => DOMAIN_TLD_PRICES[t] != null)
      : Object.keys(DOMAIN_TLD_PRICES);

    // Real availability via Hostinger when configured; deterministic stub otherwise.
    const live = await hostingerAvailability(label, requested);

    const results = requested.map((tld) => {
      const domain = `${label}${tld}`;
      const available = live ? !!live.get(domain) : stableHash(domain) % 10 >= 3;
      return { domain, tld, available, priceKes: DOMAIN_TLD_PRICES[tld] };
    });

    return res.json({ results, source: live ? "hostinger" : "estimate" });
  } catch (err) {
    console.error("DOMAIN CHECK ERROR:", err.message);
    return res.status(500).json({ error: "Failed to check domain availability." });
  }
});

// --- TEST PLAN (TRIAL) INVOICE ---
app.post("/api/test-plan", publicFormLimiter, async (req, res) => {
  try {
    const {
      fullName,
      workEmail,
      companyName,
      testingGoal,
      usageLevel,
      pageUrl,
    } = req.body;

    if (!fullName || !workEmail || !companyName || !testingGoal) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const name = fullName.trim().replace(/\s+/g, " ");
    const client = frappeClient();

    const payload = {
      web_account_email: workEmail.toLowerCase().trim(),
      client_name: companyName.trim(),
      contact_name: name,
      plan: "Test",
      invoice_no: `TEST-${Date.now()}`,
      trial_hours: 36,
      testing_goal: testingGoal,
      usage_level: usageLevel || "Moderate",
      message: `36h trial request. Goal: ${testingGoal}. Usage: ${usageLevel || "Moderate"}.`,
      status: "Trial Pending",
      source: "Website",
      page_url: pageUrl || "",
      ip_address:
        req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() ||
        req.socket.remoteAddress,
      user_agent: req.headers["user-agent"] || "",
    };
    
    // 1) Find existing trial by email
    const findResp = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([["web_account_email", "=", workEmail.trim()]]),
        fields: JSON.stringify(["name", "status"]),
        limit_page_length: 1,
        order_by: "modified desc",
      },
    });

    const existing = findResp.data?.data?.[0];

    // 2) If exists, UPDATE (upsert)
    if (existing?.name) {
      const updateResp = await client.put(
        `/api/resource/Test Plan Invoice/${existing.name}`,
        {
          ...payload,
          // Optional: if they re-submit, reset status back to Trial Pending
          status: "Trial Pending",
        }
      );

      return res.json({ ok: true, id: updateResp.data?.data?.name, updated: true });
    }

    // 3) Else CREATE. The find-then-create above is racy; rely on a unique index
    //    on Test Plan Invoice.web_account_email and, if a concurrent submit won
    //    the race, re-fetch and return the existing trial (idempotent upsert).
    try {
      const createResp = await client.post("/api/resource/Test Plan Invoice", payload);
      return res.json({ ok: true, id: createResp.data?.data?.name, created: true });
    } catch (e) {
      const dup =
        e?.response?.status === 409 ||
        /duplicate|already exists|unique/i.test(`${e?.response?.data?.exception || e?.response?.data?._error_message || e?.message || ""}`);
      if (dup) {
        const again = await client.get("/api/resource/Test Plan Invoice", {
          params: {
            filters: JSON.stringify([["web_account_email", "=", workEmail.trim()]]),
            fields: JSON.stringify(["name"]),
            limit_page_length: 1,
            order_by: "modified desc",
          },
        });
        const found = again.data?.data?.[0]?.name;
        if (found) return res.json({ ok: true, id: found, deduped: true });
      }
      throw e;
    }

  } catch (err) {
    console.error("TEST PLAN CREATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to submit test plan." });
  }
});

// Fetch a Test Plan Invoice by id (docname)
app.get("/api/test-plan/:id", async (req, res) => {
  try {
    const client = frappeClient();
    const id = req.params.id;

    const resp = await client.get(`/api/resource/Test Plan Invoice/${id}`);
    const doc = resp.data?.data;

    if (!doc) return res.status(404).json({ error: "Trial not found" });

    return res.json({
      ok: true,
      trial: {
        id: doc.name,
        contactName: doc.contact_name,
        email: doc.web_account_email,
        company: doc.client_name,
        testingGoal: doc.testing_goal,
        usageLevel: doc.usage_level,
      },
    });
  } catch (err) {
    console.error("GET TEST PLAN ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch trial" });
  }
});

function mergeServicesById(existing = [], incoming = []) {
  const merged = new Map();

  existing.forEach((s) => {
    if (!s?.serviceId) return;
    merged.set(String(s.serviceId).trim(), {
      serviceId: String(s.serviceId).trim(),
      serviceName: s.serviceName || "",
      tier: s.tier || "",
      domainChoice: s.domainChoice || "",
      status: s.status || "Awaiting Payment",
    });
  });

  incoming.forEach((s) => {
    if (!s?.serviceId) return;
    const key = String(s.serviceId).trim();

    if (!merged.has(key)) {
      merged.set(key, {
        serviceId: key,
        serviceName: s.serviceName || "",
        tier: s.tier || "",
        domainChoice: s.domainChoice || "",
        status: "Awaiting Payment",
      });
    }
  });

  return Array.from(merged.values());
}

app.post("/api/addons/invoice/create", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { services } = req.body || {};
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: "No add-on services selected." });
    }

    const client = frappeClient();
    const record = await fetchWebAccount(client, webAccountName);
    const planKey = record?.plan || "None";

    // Block add-ons if plan not paid
    const paid = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);
    if (!paid) {
      return res.status(403).json({ error: "Pay your subscription plan first before purchasing add-ons." });
    }

    // Tier rule enforcement (server-side)
    const allowedTiers = new Set(allowedAddonTiersForPlan(planKey));
    if (allowedTiers.size === 0) {
      return res.status(400).json({ error: "Add-ons are not available for your current plan." });
    }

    const norm = normalizeSelectedServices(services);

    // Every add-on must be a real, priced catalog service — no fabricated
    // pricing for something not in the catalog snapshot.
    for (const s of norm) {
      const meta = getServiceMeta(s.serviceId);
      if (!meta || !(Number(meta.monthlyKes) > 0)) {
        return res.status(400).json({ error: `Add-on pricing not configured for service: ${s.serviceId}` });
      }
    }

    // We also validate tier by looking at incoming tier field (since doctype already exists)
    // If you want stronger enforcement, we can fetch service tier from a server-side catalog later.
    const bad = norm.find((s) => s.tier && !allowedTiers.has(String(s.tier)));
    if (bad) {
      return res.status(400).json({ error: `Service tier not allowed for add-ons under ${planKey}.` });
    }

    // Capacity guard: an add-on adds to what the tenant already runs, so check
    // the EXISTING active services + the new order — not the order alone — or a
    // tenant could split an over-capacity build across two requests.
    const existingSelection = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD])
      .map((r) => ({ serviceId: r?.[CHILD_SERVICE_ID_FIELD] }))
      .filter((s) => s.serviceId);
    assertOrderWithinCapacity([...existingSelection, ...norm]);

    // Add-ons are always priced à la carte — there are no free plan-included
    // slots (matches the configurator/checkout, which never offers a free
    // service). The per-service pricing check above guarantees this is > 0.
    const amount = sumSelectedServicesMonthlyKes(norm);

    const today = new Date().toISOString().slice(0, 10);

    // Find any open unpaid add-on invoice
    const open = await findOpenInvoice(client, webAccountName, "Add-on");

    if (open?.name && String(open.status || "").toLowerCase() !== "paid") {
      // Read the full current invoice and merge, not replace
      const openRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`);
      const openInvoice = openRes.data?.data || {};

      const existingInvoiceRows = Array.isArray(openInvoice?.[PORTAL_INVOICE_SERVICES_FIELD])
        ? openInvoice[PORTAL_INVOICE_SERVICES_FIELD]
        : [];

    const existingServices = existingInvoiceRows
      .map(normalizeInvoiceServiceRow)
      .filter((s) => !!s.serviceId)
      .filter((s) => String(s.status || "").toLowerCase() !== "paid");

      // Merge old unpaid invoice services with new selections
      const mergedMap = new Map();

      existingServices.forEach((s) => {
        mergedMap.set(s.serviceId, {
          ...s,
          status: s.status || "Awaiting Payment",
        });
      });

      norm.forEach((s) => {
        if (!s.serviceId) return;

        // preserve existing row if already there; otherwise add new one
        if (!mergedMap.has(s.serviceId)) {
          mergedMap.set(s.serviceId, {
            serviceId: s.serviceId,
            serviceName: s.serviceName || "",
            tier: s.tier || "",
            domainChoice: s.domainChoice || "",
            status: "Awaiting Payment",
          });
        }
      });

      const mergedServices = Array.from(mergedMap.values());

      // For open unpaid add-on invoice, all rows are chargeable add-ons
      const mergedAmount = sumSelectedServicesMonthlyKes(mergedServices);

      const mergedRows = buildInvoiceServiceRows(
        mergedServices.map((s) => ({
          ...s,
          status: "Awaiting Payment",
        }))
      );

      await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`, {
        type: "Add-on",
        plan: planKey,
        amount: mergedAmount,
        invoice_date: today,
        status: open.status || "Unpaid",
        [PORTAL_INVOICE_SERVICES_FIELD]: mergedRows,
      });
    } else {
      const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
      const clientName = accRes.data?.data?.account_holder_name || "";

      const rows = buildInvoiceServiceRows(
        norm.map((s) => ({
          ...s,
          status: "Awaiting Payment",
        }))
      );

      await client.post("/api/resource/Portal Invoice", {
        web_account: webAccountName,
        client_name: clientName,
        invoice_no: `ADD-${Date.now()}`,
        type: "Add-on",
        plan: planKey,
        amount,
        status: "Unpaid",
        invoice_date: today,
        [PORTAL_INVOICE_SERVICES_FIELD]: rows,
      });
    }

    try {
      const accRes2 = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
      const account2 = accRes2.data?.data || {};
      const existingRows2 = asArray(account2?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);

      const existingIds2 = new Set(
        existingRows2
          .map((r) => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim())
          .filter(Boolean)
      );

      const addonRows = norm
        .filter((s) => !!s.serviceId)
        .filter((s) => !existingIds2.has(String(s.serviceId).trim()))
        .map((s) =>
          normalizeChildRow({
            service_id: s.serviceId,
            service_name: s.serviceName || "",
            tier: s.tier || "",
            domain_choice: s.domainChoice || "",
            status: "Selected", // pending in Web Account doctype
          })
        );

      if (addonRows.length > 0) {
        const merged2 = [...existingRows2, ...addonRows];
        await updateWebAccountServices(client, webAccountName, merged2);
      }
    } catch (e) {
      console.warn("ADDON SERVICES ATTACH WARN:", e?.response?.data || e?.message || e);
    }

    // Refresh session payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);

    const userPayload = buildUserPayload({ record: fresh, invoices, selectedServices });
    req.session.user = userPayload;

    return res.json({ ok: true, user: userPayload });
  } catch (err) {
    console.error("ADDON INVOICE ERROR:", err.response?.data || err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: status >= 500 ? "Failed to create add-on invoice." : err.message,
    });
  }
});

app.post("/api/services/addons/add", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id || req.session?.user?.name;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { services } = req.body || {};
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: "No services provided." });
    }

    const client = frappeClient();

    // Load account
    const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const account = accRes.data?.data || {};
    const existingRows = asArray(account?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);

    const existingIds = new Set(
      existingRows.map((r) => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim()).filter(Boolean)
    );

    // De-dupe incoming (addons are allowed even if plan slots full)
    const incoming = services
      .map((s) => ({
        serviceId: String(s.serviceId || s.service_id || "").trim(),
        serviceName: String(s.serviceName || s.service_name || "").trim(),
        tier: String(s.tier || "").trim(),
        domainChoice: String(s.domainChoice || s.domain_choice || "").trim(),
      }))
      .filter((s) => !!s.serviceId)
      .filter((s) => !existingIds.has(s.serviceId));

    if (incoming.length === 0) {
      // Return fresh payload anyway
      const invoices = await fetchInvoicesForUser(client, webAccountName);
      const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
      const rec = (await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`)).data?.data;
      const user = buildUserPayload({ record: rec, invoices, selectedServices });
      req.session.user = user;
      req.session.webAccount = webAccountName;
      return res.json({ ok: true, user, message: "No new add-on services to add." });
    }

const addonIds = incoming.map((s) => s.serviceId).filter(Boolean);

// Read existing addon ids from the SAME account record we already fetched
const currentAddonJson = String(account?.addon_service_ids || "[]");
let currentAddonIds = [];
try {
  currentAddonIds = JSON.parse(currentAddonJson);
} catch {
  currentAddonIds = [];
}

const mergedAddonIds = Array.from(
  new Set([...(Array.isArray(currentAddonIds) ? currentAddonIds : []), ...addonIds])
);

// ✅ persist on Web Account parent (requires a custom field addon_service_ids)
await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
  addon_service_ids: JSON.stringify(mergedAddonIds),
});

    // Add with pending status for Web Account doctype
    const newRows = incoming.map((s) =>
      normalizeChildRow({
        service_id: s.serviceId,
        service_name: s.serviceName,
        tier: s.tier,
        domain_choice: s.domainChoice || undefined,
        status: "Selected", // ✅ pending for Web Account
      })
    );

    const merged = [...existingRows, ...newRows];

    await updateWebAccountServices(client, webAccountName, merged);

    // Refresh payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const rec = (await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`)).data?.data;

    const user = buildUserPayload({ record: rec, invoices, selectedServices });
    req.session.user = user;
    req.session.webAccount = webAccountName;

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("ADD ADDON SERVICES ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to add add-on services." });
  }
});

app.post("/api/services/add", requireAuth, async (req, res) => {
  try {
    const { services } = req.body || {};
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: "No services provided." });
    }

    const client = frappeClient();

  const webAccountName = req.session?.webAccount || req.session?.user?.id || req.session?.user?.name;
  if (!webAccountName) return res.status(401).json({ error: "Missing web account in session." });    

    const record = await fetchWebAccount(client, webAccountName);
    const planKey = record?.plan || "None";
    if (!planKey || planKey === "None") {
      return res.status(400).json({ error: "No plan selected. Please choose a plan first." });
    }

    const planLimit = PLAN_LIMITS[planKey] ?? 0;

    const existingRows = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);
    const existingIds = new Set(existingRows.map((r) => r?.[CHILD_SERVICE_ID_FIELD]).filter(Boolean));

    // De-dupe incoming
    const incoming = services
      .map((s) => ({
        serviceId: s.serviceId || s.service_id,
        serviceName: s.serviceName || s.service_name || "",
        tier: s.tier || "",
        domainChoice: s.domainChoice || s.domain_choice || "",
      }))
      .filter((s) => !!s.serviceId)
      .filter((s) => !existingIds.has(s.serviceId));

    if (incoming.length === 0) {
      return res.json({ ok: true, message: "No new services to add." });
    }

    // Enforce limit (hard lock)
    try {
      assertWithinPlanLimit(planKey, new Array(existingRows.length + incoming.length).fill({}));
    } catch (e) {
      return res.status(400).json({
        error: `Plan limit exceeded. ${planKey} allows ${planLimit} services. You currently have ${existingRows.length}.`,
      });
    }

    const planPaid = await hasPaidSubscriptionForPlan(client, webAccountName, planKey);

    const newRows = incoming.map((s) =>
      normalizeChildRow({
        service_id: s.serviceId,
        service_name: s.serviceName,
        tier: s.tier,
        domain_choice: s.domainChoice || undefined,
        status: planPaid ? "Active" : "Selected",
      })
    );

    const merged = [...existingRows, ...newRows];

    // Hard lock at the point of write
    assertWithinPlanLimit(planKey, merged);

    await updateWebAccountServices(client, webAccountName, merged);

    // Return fresh payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);

    const user = buildUserPayload({ record: fresh, invoices, selectedServices });
    req.session.user = user;

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("ADD SERVICES ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to add services." });
  }
});

// ------------------------------------
// HELPERS: APPLY PLAN + BUILD USER DATA
// ------------------------------------

async function findExistingUnpaidSubscriptionInvoice(client, webAccountName, planKey) {
  const res = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["type", "=", "Subscription"],
        ["plan", "=", planKey],
        ["status", "in", ["Unpaid", "Pending", "Draft"]], // ✅ broaden
        ["status", "!=", "Deleted"],
      ]),
      fields: JSON.stringify(["name", "invoice_no", "amount", "status", "invoice_date", "type", "plan"]),
      limit_page_length: 1,
      order_by: "modified desc",
    },
  });

  return res.data?.data?.[0] || null;
}

async function findLatestPaidSubscriptionInvoice(client, webAccountName, planKey) {
  const res = await client.get("/api/resource/Portal Invoice", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["type", "=", "Subscription"],
        ["plan", "=", planKey],
        ["status", "!=", "Deleted"],
      ]),
      fields: JSON.stringify(["name", "invoice_no", "status", "invoice_date", "amount", "type", "plan"]),
      limit_page_length: 1,
      order_by: "modified desc",
    },
  });

  return res.data?.data?.[0] || null;
}

async function applyPlanAndCreateInvoice(client, webAccountName, planKey, selectedServicesOrOpts = [], maybeOpts = {}) {
  // Support both call styles:
  // 1) applyPlanAndCreateInvoice(client, name, plan, selectedServicesArray)
  // 2) applyPlanAndCreateInvoice(client, name, plan, optsObject)
  // 3) applyPlanAndCreateInvoice(client, name, plan, selectedServicesArray, optsObject)
  const selectedServices = Array.isArray(selectedServicesOrOpts) ? selectedServicesOrOpts : [];
  const opts = Array.isArray(selectedServicesOrOpts) ? (maybeOpts || {}) : (selectedServicesOrOpts || {});
  const { force = false, creditKes = 0 } = opts;

  // Fetch current record to avoid blind overwrite
  const accRes = await client.get(`/api/resource/${WEB_ACCOUNT_DOCTYPE}/${encodeURIComponent(webAccountName)}`);
  const current = accRes.data?.data || {};
  const currentPlan = current.plan || "None";

  // If same plan and not forced → do nothing (still may want invoice sync, so don't early return if services exist)
  const samePlan = currentPlan === planKey;

  // Persist plan on Web Account (only if needed)
  if (!samePlan || force) {
    await client.put(`/api/resource/${WEB_ACCOUNT_DOCTYPE}/${encodeURIComponent(webAccountName)}`, {
      plan: planKey,
      account_status: "Active",
    });
  }

  // Create invoice only if amount > 0. Bill the sum of what was actually
  // selected (the catalog snapshot — same source the configurator totals
  // from), not a flat per-plan-tier price: a Starter customer with one
  // KES 1,200/mo service must be charged KES 1,200, not a flat plan rate.
  let amount = sumSelectedServicesMonthlyKes(selectedServices);
  if (amount <= 0) return { ok: true, skipped: true, reason: "zero_amount" };

  // Apply credit if any (upgrade flow)
  if (creditKes > 0) amount = Math.max(0, amount - creditKes);

  const clientName = current.account_holder_name || "";
  const today = new Date().toISOString().slice(0, 10);

  // Build invoice child rows from selected services
  const invoiceRows = buildInvoiceServiceRows(
    normalizeSelectedServices(selectedServices).map((s) => ({ ...s, status: s.status || "Awaiting Payment" }))
  );

  // ✅ Update any OPEN (unpaid-like) subscription invoice
  const open = await findExistingUnpaidSubscriptionInvoice(client, webAccountName, planKey);
  if (open?.name) {
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(open.name)}`, {
      plan: planKey,
      amount,
      status: open.status || "Unpaid",
      invoice_date: today,
      [PORTAL_INVOICE_SERVICES_FIELD]: invoiceRows,
    });
    return { ok: true, updated: true, invoice: { ...open, amount, plan: planKey } };
  }

  // ✅ If latest subscription invoice is PAID, update its service rows (do NOT create a new invoice)
  const latest = await findLatestPaidSubscriptionInvoice(client, webAccountName, planKey);
  if (latest?.name && String(latest.status || "").toLowerCase() === "paid") {
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(latest.name)}`, {
      // keep status paid + amount unchanged; just refresh rows snapshot
      [PORTAL_INVOICE_SERVICES_FIELD]: invoiceRows,
    });
    return { ok: true, updated: true, invoice: { ...latest, plan: planKey } };
  }

  // Otherwise create a new one
  const created = await client.post("/api/resource/Portal Invoice", {
    web_account: webAccountName,
    client_name: clientName,
    invoice_no: `INV-${Date.now()}`,
    type: "Subscription",
    plan: planKey,
    amount,
    status: "Unpaid",
    invoice_date: today,
    [PORTAL_INVOICE_SERVICES_FIELD]: invoiceRows,
  });

  return { ok: true, invoice: created.data?.data || null };
}

// Idempotently set up the KES-1 trial verification: seed a sandbox service
// (Awaiting Payment) and create a zero-amount "Trial Verification" Portal
// Invoice the user pays (card / M-Pesa) to START their 36h trial. effectiveChargeKes
// turns the 0 amount into the small verification charge at the payment rail.
// Returns the verification invoice docName (existing or new). Best-effort; never throws.
async function setupTrialVerification(client, webAccountName) {
  try {
    // Idempotent: reuse an existing unpaid Trial Verification invoice.
    const existing = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["type", "=", "Trial Verification"],
          ["status", "in", ["Unpaid", "Awaiting Payment", "Pending", "Draft"]],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
        order_by: "creation desc",
      },
    });
    const already = existing.data?.data?.[0]?.name;
    if (already) return already;

    const meta = getServiceMeta(TRIAL_SANDBOX_SERVICE_ID);
    const sandboxName = meta?.name || "Trial Sandbox";

    // Seed the sandbox service row on the Web Account (Awaiting Payment) if absent.
    const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const account = accRes.data?.data || {};
    const rows = asArray(account[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);
    if (!rows.some((r) => String(r[CHILD_SERVICE_ID_FIELD] || "") === TRIAL_SANDBOX_SERVICE_ID)) {
      rows.push(normalizeChildRow({
        service_id: TRIAL_SANDBOX_SERVICE_ID,
        service_name: sandboxName,
        tier: meta?.tier || "Demo",
        status: "Awaiting Payment",
      }));
      await updateWebAccountServices(client, webAccountName, rows);
    }

    // Create the verification invoice (amount 0 -> KES 1 at the rail).
    const today = new Date().toISOString().slice(0, 10);
    const created = await client.post("/api/resource/Portal Invoice", {
      web_account: webAccountName,
      client_name: account.account_holder_name || "",
      invoice_no: `TRIAL-${Date.now()}`,
      type: "Trial Verification",
      plan: "Test",
      amount: 0,
      status: "Unpaid",
      invoice_date: today,
      [PORTAL_INVOICE_SERVICES_FIELD]: buildInvoiceServiceRows([
        { serviceId: TRIAL_SANDBOX_SERVICE_ID, serviceName: sandboxName, status: "Awaiting Payment" },
      ]),
    });
    return created.data?.data?.name || null;
  } catch (e) {
    console.warn("TRIAL VERIFICATION SETUP WARN:", e.response?.data || e.message);
    return null;
  }
}

// Expire active trials past their trial_end: mark the Test Plan Invoice "Expired"
// and suspend the trial sandbox service. Also nudges trials ENDING SOON (12h
// window, once per process — an occasional duplicate after a restart is fine).
// Best-effort; silent if Frappe is down.
const { sendTrialEndingSoonEmail, sendTrialExpiredEmail } = require("./utils/mailer");
const trialReminderSent = new Set();
async function expireStaleTrials() {
  try {
    const client = frappeClient();
    const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");

    // Ending-soon nudge: active trials whose end falls inside the next 12h.
    try {
      const soonSql = new Date(Date.now() + 12 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
      const soonRes = await client.get("/api/resource/Test Plan Invoice", {
        params: {
          filters: JSON.stringify([
            ["status", "=", "Active"],
            ["trial_end", ">", nowSql],
            ["trial_end", "<", soonSql],
          ]),
          fields: JSON.stringify(["name", "web_account_email", "contact_name", "trial_end"]),
          limit_page_length: 50,
        },
      });
      for (const t of soonRes.data?.data || []) {
        if (!t.web_account_email || trialReminderSent.has(t.name)) continue;
        trialReminderSent.add(t.name);
        sendTrialEndingSoonEmail({
          to: t.web_account_email,
          clientName: t.contact_name,
          endsAt: String(t.trial_end),
        }).catch((e) => console.warn("TRIAL REMINDER EMAIL WARN:", t.name, e.message));
      }
    } catch {
      /* reminder pass is best-effort */
    }

    const res = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([["status", "=", "Active"], ["trial_end", "<", nowSql]]),
        fields: JSON.stringify(["name", "web_account", "web_account_email", "contact_name"]),
        limit_page_length: 50,
      },
    });
    const expired = res.data?.data || [];
    for (const t of expired) {
      try {
        await client.put(`/api/resource/Test Plan Invoice/${encodeURIComponent(t.name)}`, { status: "Expired" });
        if (t.web_account_email) {
          sendTrialExpiredEmail({
            to: t.web_account_email,
            clientName: t.contact_name,
          }).catch((e) => console.warn("TRIAL EXPIRED EMAIL WARN:", t.name, e.message));
        }
        if (t.web_account) {
          const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(t.web_account)}`);
          const rows = asArray(accRes.data?.data?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);
          let changed = false;
          const updated = rows.map((r) => {
            if (String(r[CHILD_SERVICE_ID_FIELD] || "") === TRIAL_SANDBOX_SERVICE_ID && String(r[CHILD_STATUS_FIELD] || "") !== "Suspended") {
              changed = true;
              return { ...r, [CHILD_STATUS_FIELD]: "Suspended" };
            }
            return r;
          });
          if (changed) await updateWebAccountServices(client, t.web_account, updated);
        }
      } catch (e) {
        console.warn("TRIAL EXPIRE WARN:", t.name, e.message);
      }
    }
    if (expired.length) console.log(`[trial] expired ${expired.length} trial(s)`);
  } catch {
    /* Frappe down / not configured — stay quiet. */
  }
}

async function fetchInvoicesForUser(client, webAccountName) {
  try {
    // 1) Paid invoices
    const invoicesRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["status", "!=", "Deleted"],
        ]),
        fields: JSON.stringify([
          "name",
          "invoice_no",
          "amount",
          "status",
          "invoice_date",
          "type",
          "plan",
          PORTAL_INVOICE_SERVICES_FIELD,
        ]),
        limit_page_length: 50,
        order_by: "creation desc",
      },
    });

    const rows = invoicesRes.data?.data || [];
    const mapped = rows.map((inv) => ({
      id: inv.invoice_no || inv.name,
      docName: inv.name,
      invoiceNo: inv.invoice_no || inv.name,
      date: inv.invoice_date,
      amount: Number(inv.amount || 0),
      status: inv.status,
      type: inv.type,
      plan: inv.plan,
      services: Array.isArray(inv?.[PORTAL_INVOICE_SERVICES_FIELD])
        ? inv[PORTAL_INVOICE_SERVICES_FIELD].map((s) => ({
            serviceId: s?.[CHILD_SERVICE_ID_FIELD],
            serviceName: s?.[CHILD_SERVICE_NAME_FIELD],
            tier: s?.[CHILD_TIER_FIELD],
            domainChoice: s?.[CHILD_DOMAIN_CHOICE_FIELD] || null,
            status: s?.[CHILD_STATUS_FIELD] || "Awaiting Payment",
          }))
        : [],      
    }));

    // 2) Trial "invoice" (Test Plan Invoice)
    const trialRes = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["status", "in", ["New", "Trial Pending", "Active"]],
        ]),
        fields: JSON.stringify([
          "name",
          "status",
          "testing_goal",
          "trial_hours",
          "trial_start",
          "trial_end",
          "modified",
          "creation",
        ]),
        limit_page_length: 1,
        order_by: "modified desc",
      },
    });

    const trial = trialRes.data?.data?.[0];

    if (trial?.name) {
      mapped.unshift({
        id: `${trial.name}`,      // display id
        docName: trial.name,           // real doc id (but from Test Plan Invoice)
        invoiceNo: `${trial.name}`,
        date: trial.trial_start || trial.creation?.slice?.(0, 10) || null,
        amount: 0,
        status: trial.status,
        type: "Trial",
        plan: `Test Plan (${trial.trial_hours || 36}h)`,
        services: [],
        meta: {
          testingGoal: trial.testing_goal,
          trialStart: trial.trial_start,
          trialEnd: trial.trial_end,
        },
      });
    }

    return mapped;
  } catch (err) {
    console.warn("INVOICE FETCH WARN:", err.response?.data || err.message);
    return [];
  }
}

async function fetchSelectedServicesForUser(client, webAccountName) {
  const res = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
  const rec = res.data?.data || {};
  const rows = Array.isArray(rec[WEB_ACCOUNT_SERVICES_FIELD]) ? rec[WEB_ACCOUNT_SERVICES_FIELD] : [];

  let addonIds = [];
  try {
    addonIds = JSON.parse(rec.addon_service_ids || "[]");
  } catch {
    addonIds = [];
  }

  const addonSet = new Set(
    (Array.isArray(addonIds) ? addonIds : []).map((id) => String(id || "").trim()).filter(Boolean)
  );

  return rows.map((r) => {
    const serviceId = String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim();

    return {
      serviceId,
      serviceName: r?.[CHILD_SERVICE_NAME_FIELD],
      tier: r?.[CHILD_TIER_FIELD],
      domainChoice: r?.[CHILD_DOMAIN_CHOICE_FIELD] || null,
      status: r?.[CHILD_STATUS_FIELD] || "Awaiting Payment",
      isAddon: addonSet.has(serviceId),
    };
  });
}

app.post("/api/plan/attach-selection", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const {
      planKey,
      selectedServices: incomingSelectedServices,
      upgradeIntent,
      upgradeMode,
    } = req.body;

    if (!planKey) return res.status(400).json({ error: "Missing planKey." });
    if (!Array.isArray(incomingSelectedServices)) {
      return res.status(400).json({ error: "selectedServices must be an array." });
    }

    // enforce membership of services in the chosen plan
    const wrong2 = incomingSelectedServices.find((s) => {
      const sid = String(s.serviceId || "").trim();
      const p = SERVICE_ID_TO_PLAN[sid];
      return p && p !== planKey;
    });
    if (wrong2) {
      return res.status(400).json({
        error: `Service "${wrong2.serviceId}" is not part of the ${planKey} plan.`,
      });
    }

    const client = frappeClient();

    // Load account
    const accRes = await client.get(
      `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`
    );

    const currentPlan = String(accRes.data?.data?.plan || "None").trim();
    const existingRows = asArray(accRes.data?.data?.selected_services);

    const includedCountExisting = (existingRows || []).filter((r) => {
      const sid = String(r?.service_id || r?.[CHILD_SERVICE_ID_FIELD] || "").trim();
      return SERVICE_ID_TO_PLAN[sid] === planKey;
    }).length;

    const planLimit = PLAN_LIMITS[planKey] ?? 0;
    const remainingSlots = planLimit >= 999 ? 999 : Math.max(planLimit - includedCountExisting, 0);

    const planIsPaid =
      planKey === "Test" || planKey === "Enterprise"
        ? false
        : await hasPaidSubscriptionForPlan(client, webAccountName, planKey);

    const isPlanChange =
      currentPlan && currentPlan !== "None" && currentPlan !== planKey;

    const serviceSummary = formatSelectedServices(incomingSelectedServices);
    const count = incomingSelectedServices.length;

    // Convert incoming selection to child rows
    const incomingRows = incomingSelectedServices
      .map((s) => ({
        service_id: String(s.serviceId || "").trim(),
        domain_choice: s.domainChoice || "",
        status: planIsPaid ? "Active" : "Selected",
        service_name: s.serviceName || "",
        category: s.category || "",
        tier: s.tier || "",
      }))
      .filter((r) => r.service_id);

    // If plan mismatch and not upgrade flow → block (same as today)
    if (isPlanChange && !upgradeIntent) {
      return res.status(400).json({
        error: `You already have an active plan (${currentPlan}). You cannot attach services from ${planKey}. Please change your plan or use Add-ons.`,
      });
    }

    // Upgrade flow: decide replace/retain based on whether current plan is paid
    let nextRows = null;

    if (isPlanChange && upgradeIntent) {
      const currentPlanPaid =
        currentPlan === "Test" || currentPlan === "Enterprise"
          ? false
          : await hasPaidSubscriptionForPlan(client, webAccountName, currentPlan);

      // Unpaid old plan → always replace
      if (!currentPlanPaid) {
        // unpaid old plan -> replace
        const oldUnpaid = await findExistingUnpaidSubscriptionInvoice(client, webAccountName, currentPlan);
        if (oldUnpaid?.name) {
          await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(oldUnpaid.name)}`, {
            status: "Deleted",
          });
        }
        nextRows = incomingRows; // overwrite

        try {
          assertWithinPlanLimit(planKey, nextRows);
        } catch (e) {
          const attempted = incomingRows.length;
          return res.status(400).json({
            error: `Plan limit exceeded. ${planKey} allows ${planLimit} services.`,
            code: "PLAN_LIMIT_EXCEEDED",
            planKey,
            planLimit,
            remainingSlots,
            attemptedToAdd: attempted,
            message: remainingSlots <= 0
              ? `You have no remaining slots on ${planKey}. Remove a service or upgrade your plan.`
              : `You can only add ${remainingSlots} more service${remainingSlots === 1 ? "" : "s"} on ${planKey}.`,
          });
        }
        
      } else {
        // Paid old plan → obey retain/replace
        if (upgradeMode === "replace") {
          nextRows = incomingRows;
          assertWithinPlanLimit(planKey, nextRows);

        } else if (upgradeMode === "retain") {
          // merge (your old behavior)
          const map = new Map();
          for (const row of existingRows) {
            if (row?.service_id) map.set(row.service_id, row);
          }
          for (const row of incomingRows) {
            map.set(row.service_id, { ...map.get(row.service_id), ...row });
          }
          nextRows = Array.from(map.values());

        const includedOnly = nextRows.filter((r) => {
          const sid = String(r.service_id || "").trim();
          return SERVICE_ID_TO_PLAN[sid] === planKey;
        });
        assertWithinPlanLimit(planKey, includedOnly);          

        } else {
          return res.status(409).json({
            error: "Your current plan is paid. Choose whether to retain services or replace them.",
          });
        }
      }
    } else {
      // Normal attach within same plan → merge (your old behavior)
      const map = new Map();
      for (const row of existingRows) {
        if (row?.service_id) map.set(row.service_id, row);
      }
      for (const row of incomingRows) {
        map.set(row.service_id, { ...map.get(row.service_id), ...row });
      }
      nextRows = Array.from(map.values());

        try {
          assertWithinPlanLimit(planKey, nextRows);
        } catch (e) {
          const attempted = incomingRows.length;
          return res.status(400).json({
            error: `Plan limit exceeded. ${planKey} allows ${planLimit} services.`,
            code: "PLAN_LIMIT_EXCEEDED",
            planKey,
            planLimit,
            remainingSlots,
            attemptedToAdd: attempted,
            message: remainingSlots <= 0
              ? `You have no remaining slots on ${planKey}. Remove a service or upgrade your plan.`
              : `You can only add ${remainingSlots} more service${remainingSlots === 1 ? "" : "s"} on ${planKey}.`,
          });
        }
    }

    // Update Web Account
    await client.put(
      `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`,
      {
        plan: planKey,
        account_status: "Active",
        selected_services: nextRows,
      }
    );

    if (!isPlanChange) {
      await logPortalUpdate(client, webAccountName, {
        type: "milestone",
        engineer: "Murzak Tech",
        content: `${planKey} updated: selected ${count} service(s). ${serviceSummary}`,
      });
    }

    if (isPlanChange && upgradeIntent) {
      const modeLabel =
        upgradeMode === "retain" ? "retain services" :
        upgradeMode === "replace" ? "replace services" :
        "unspecified mode";

      await logPortalUpdate(client, webAccountName, {
        type: "milestone",
        engineer: "Murzak Tech",
        content: `Plan upgraded: ${currentPlan} → ${planKey} (${modeLabel}). Selected ${count} service(s). ${serviceSummary}`,
      });
    }

    const updates = await fetchUpdatesForUser(client, webAccountName);

    // Create base invoice for Starter/Business
    if (planKey !== "Test" && planKey !== "Enterprise") {
      await applyPlanAndCreateInvoice(client, webAccountName, planKey, nextRows.map(r => ({
        serviceId: r.service_id,
        serviceName: r.service_name,
        tier: r.tier,
        domainChoice: r.domain_choice,
        status: planIsPaid ? "Active" : "Awaiting Payment",
      })));
    }

    // Return refreshed payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const recordRes = await client.get(
      `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`
    );
    const selectedServicesFresh = await fetchSelectedServicesForUser(client, webAccountName);

    const user = buildUserPayload({
      record: recordRes.data?.data,
      invoices,
      selectedServices: selectedServicesFresh,
      updates,
    });

    req.session.user = user;
    req.session.webAccount = webAccountName;

    return res.json({ ok: true, user, invoices });
  } catch (err) {
    console.error("ATTACH SELECTION ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to attach selection." });
  }
});



function normalizeInvoiceServiceRow(r) {
  return {
    serviceId: String(r?.service_id || r?.serviceId || "").trim(),
    serviceName: String(r?.service_name || r?.serviceName || "").trim(),
    tier: String(r?.tier || "").trim(),
    domainChoice: String(r?.domain_choice || r?.domainChoice || "").trim(),
    status: String(r?.status || "Awaiting Payment").trim(),
  };
}

function normalizeInvoiceStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isInvoicePaidLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "paid";
}

// Single canonical definition — checks for deleted/cancelled variants
function isInvoiceDeletedLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "deleted" || s.includes("deleted") || s === "cancelled" || s.includes("cancelled") || s === "canceled";
}

function isInvoiceUnpaidLike(status) {
  const s = normalizeInvoiceStatus(status);
  return s === "unpaid" || s === "awaiting payment" || s === "pending";
}

function convertKesToPaypalAmount(amountKes) {
  const rate = Number(process.env.KES_TO_USD_RATE || 0);

  const kes = Number(amountKes || 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid KES_TO_USD_RATE configuration.");
  }
  if (!Number.isFinite(kes) || kes <= 0) {
    return "0.00";
  }

  return (kes * rate).toFixed(2);
}

async function reconcileServiceDeletionAgainstInvoices(client, webAccountName, serviceId) {
  const invoices = await fetchInvoicesForUser(client, webAccountName);

  const targetInvoices = (Array.isArray(invoices) ? invoices : []).filter((inv) => {
    if (!inv?.id && !inv?.name) return false;

    const status = normalizeInvoiceStatus(inv?.status);

    if (isInvoiceDeletedLike(status)) return false;
    if (isInvoicePaidLike(status)) return false;

    return isInvoiceUnpaidLike(status);
  });

  for (const inv of targetInvoices) {
    let invoiceName = String(inv?.name || "").trim();

    if (!invoiceName) {
      const invoiceNo = String(inv?.id || inv?.invoiceNo || "").trim();

      if (invoiceNo) {
        const lookupRes = await client.get("/api/resource/Portal Invoice", {
          params: {
            fields: JSON.stringify(["name", "invoice_no", "status", "type"]),
            filters: JSON.stringify([
              ["web_account", "=", webAccountName],
              ["invoice_no", "=", invoiceNo],
            ]),
            limit_page_length: 1,
          },
        });

        const matched = Array.isArray(lookupRes.data?.data) ? lookupRes.data.data[0] : null;
        invoiceName = String(matched?.name || "").trim();
      }
    }

    if (!invoiceName) {
      console.warn("[RECONCILE] could not resolve invoice docname", inv);
      continue;
    }

    const invoiceRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`);
    const invoice = invoiceRes.data?.data || {};

    const existingRows = Array.isArray(invoice?.[PORTAL_INVOICE_SERVICES_FIELD])
      ? invoice[PORTAL_INVOICE_SERVICES_FIELD]
      : [];

    const existingServices = existingRows
      .map(normalizeInvoiceServiceRow)
      .filter((s) => !!s.serviceId);

    const filteredServices = existingServices.filter((s) => s.serviceId !== serviceId);

    // nothing to change for this invoice
    if (filteredServices.length === existingServices.length) {
      continue;
    }

    // if no rows remain, mark invoice deleted
    if (filteredServices.length === 0) {
      await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`, {
        status: "Deleted",
      });
      continue;
    }

    // otherwise update rows + amount
    const invoiceType = String(invoice?.type || "");
    const isAddonInvoice = invoiceType.toLowerCase().includes("add-on") || invoiceType.toLowerCase().includes("addon");

    const updatedRows = buildInvoiceServiceRows(
      filteredServices.map((s) => ({
        ...s,
        status: s.status || "Awaiting Payment",
      }))
    );

    const payload = {
      [PORTAL_INVOICE_SERVICES_FIELD]: updatedRows,
    };

    if (isAddonInvoice) {
      payload.amount = sumSelectedServicesMonthlyKes(filteredServices);
    }

    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`, payload);
  }
}



// ----------------------------------------
// --- M-PESA STK PUSH (Safaricom Daraja) ---
// ----------------------------------------

/**
 * Returns a Daraja OAuth access token.
 * Cached for 55 minutes to avoid hammering the auth endpoint.
 */
let _mpesaTokenCache = null;
async function getMpesaAccessToken() {
  const now = Date.now();
  if (_mpesaTokenCache && _mpesaTokenCache.expiresAt > now) {
    return _mpesaTokenCache.token;
  }

  const env = (process.env.MPESA_ENV || "sandbox").toLowerCase();
  const baseUrl =
    env === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const resp = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  const token = resp.data?.access_token;
  if (!token) throw new Error("Failed to obtain M-Pesa access token.");

  _mpesaTokenCache = { token, expiresAt: now + 55 * 60 * 1000 };
  return token;
}

/** Normalise a Kenyan phone number to the 2547xxxxxxxx format. */
function normalizeMpesaPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "254" + digits.slice(1);
  if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1")))
    return "254" + digits;
  return null;
}

// Initiate STK Push

// Extract a named value from the M-Pesa CallbackMetadata.Item array.
function mpesaMetaValue(body, name) {
  const items = body?.CallbackMetadata?.Item || [];
  const hit = items.find((i) => String(i?.Name).toLowerCase() === String(name).toLowerCase());
  return hit ? hit.Value : undefined;
}

// M-Pesa Daraja async callback (configure MPESA_CALLBACK_URL to point here publicly).
// Safaricom does not sign callbacks, so we defend the endpoint with an unguessable
// shared-secret token embedded in the callback URL (?token=...) and verify the
// amount paid against the invoice before activating anything.

// Poll payment status — frontend polls this after sending STK push

// ----------------------------------------
// --- PAYPAL WEBHOOK (out-of-band truth) ---
// ----------------------------------------
// Authoritative, browser-independent payment reconciliation. Reconciles a paid
// capture even if the buyer closed the tab before /capture-order returned, and
// reverses activation on refund/chargeback. Signature is verified server-side
// via PayPal's API; FAILS CLOSED (rejects unverified / unconfigured in prod).
const { verifyWebhookSignature, extractInvoiceName } = require("./services/paypalWebhook");

// Flip a Portal Invoice's services back to Suspended and the invoice to a
// non-paid status. Best-effort, only ever called from a verified webhook.
async function suspendServicesForInvoice(client, invoiceDocName, newInvoiceStatus) {
  const invRes = await client.get(
    `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`
  );
  const inv = invRes.data?.data;
  if (!inv?.name) return;

  // Only ever reverse an invoice that is actually PAID. This makes the handler
  // idempotent (a second refund/reversal event sees a non-paid status and skips)
  // and prevents a DENIED event on an already-unpaid invoice from doing writes.
  if (String(inv.status || "").toLowerCase() !== "paid") {
    console.warn(`[paypal webhook] skip reverse: invoice ${invoiceDocName} not Paid (status=${inv.status}).`);
    return;
  }

  // Don't suspend a live free trial just because its small verification charge
  // was refunded — a KES-1 verification refund must not kill a legitimate trial.
  if (isVerificationOnly(inv.amount)) {
    console.warn(`[paypal webhook] skip reverse: ${invoiceDocName} is a free-trial verification invoice.`);
    return;
  }

  await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(inv.name)}`, {
    status: newInvoiceStatus,
  });

  const serviceIds = (Array.isArray(inv[PORTAL_INVOICE_SERVICES_FIELD]) ? inv[PORTAL_INVOICE_SERVICES_FIELD] : [])
    .map((s) => s?.[CHILD_SERVICE_ID_FIELD])
    .filter(Boolean);
  if (!serviceIds.length || !inv.web_account) return;

  const accRes = await client.get(
    `/api/resource/Web Account/${encodeURIComponent(inv.web_account)}`
  );
  const account = accRes.data?.data || {};
  const rows = Array.isArray(account[WEB_ACCOUNT_SERVICES_FIELD])
    ? account[WEB_ACCOUNT_SERVICES_FIELD]
    : [];
  const updatedRows = rows.map((r) =>
    serviceIds.includes(r[CHILD_SERVICE_ID_FIELD])
      ? { ...r, [CHILD_STATUS_FIELD]: "Suspended" }
      : r
  );
  await client.put(`/api/resource/Web Account/${encodeURIComponent(inv.web_account)}`, {
    [WEB_ACCOUNT_SERVICES_FIELD]: updatedRows,
  });
}

app.post("/api/paypal/webhook", async (req, res) => {
  try {
    const event = req.body || {};

    // 1) Verify the signature. FAIL CLOSED in production.
    let verified = false;
    let reason = "";
    try {
      const result = await verifyWebhookSignature({ headers: req.headers, event });
      verified = result.verified;
      reason = result.reason || "";
    } catch (e) {
      console.error("PAYPAL WEBHOOK: verification call failed:", e.response?.data || e.message);
      // Transient verification failure — let PayPal retry.
      return res.status(500).json({ ok: false });
    }

    if (!verified) {
      if (process.env.NODE_ENV === "production") {
        console.error("PAYPAL WEBHOOK: rejected — signature not verified:", reason);
        return res.status(401).json({ ok: false });
      }
      console.warn("PAYPAL WEBHOOK: signature not verified (allowed in non-prod):", reason);
    }

    const type = event.event_type;
    const resource = event.resource;
    const invoiceDocName = extractInvoiceName(resource);

    // Acknowledge events we don't act on so PayPal stops retrying them.
    if (!invoiceDocName) {
      console.warn("PAYPAL WEBHOOK: no invoice reference on", type);
      return res.status(200).json({ ok: true, ignored: true });
    }

    const client = frappeClient();

    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const invRes = await client.get(
        `/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`
      );
      const inv = invRes.data?.data;
      if (!inv?.name) {
        console.warn("PAYPAL WEBHOOK: invoice not found:", invoiceDocName);
        return res.status(200).json({ ok: true, ignored: true });
      }

      // Idempotent: already reconciled (likely by the browser capture-order call).
      if (String(inv.status || "").toLowerCase() === "paid") {
        return res.status(200).json({ ok: true, alreadyPaid: true });
      }

      // Verify the captured amount matches what we billed (fail closed).
      // Shared with the capture flow via capturedAmountMatches so they can't drift.
      const capturedValue = Number(resource?.amount?.value);
      const capturedCurrency = resource?.amount?.currency_code;
      if (!capturedAmountMatches({ invoiceAmountKes: inv.amount, capturedValue, capturedCurrency })) {
        console.error("PAYPAL WEBHOOK: amount mismatch — not activating", {
          invoice: inv.name, capturedValue, capturedCurrency,
        });
        return res.status(200).json({ ok: true, ignored: true });
      }

      await activateServicesForInvoice({
        req: { session: { webAccount: inv.web_account, user: { id: inv.web_account } } },
        invoiceDocName: inv.name,
        paymentVerified: true,
        frappeClient,
        PORTAL_INVOICE_SERVICES_FIELD,
        CHILD_SERVICE_ID_FIELD,
        WEB_ACCOUNT_SERVICES_FIELD,
        CHILD_STATUS_FIELD,
        fetchInvoicesForUser,
        fetchSelectedServicesForUser,
        buildUserPayload,
      });
      console.log("PAYPAL WEBHOOK: reconciled capture for invoice:", inv.name);
      return res.status(200).json({ ok: true });
    }

    if (
      type === "PAYMENT.CAPTURE.REFUNDED" ||
      type === "PAYMENT.CAPTURE.REVERSED" ||
      type === "PAYMENT.CAPTURE.DENIED"
    ) {
      const newStatus = type === "PAYMENT.CAPTURE.DENIED" ? "Unpaid" : "Refunded";
      await suspendServicesForInvoice(client, invoiceDocName, newStatus);
      console.warn(`PAYPAL WEBHOOK: ${type} -> ${newStatus}, services suspended for`, invoiceDocName);
      return res.status(200).json({ ok: true, reversed: true });
    }

    // Unhandled but valid event — acknowledge.
    return res.status(200).json({ ok: true, ignored: true });
  } catch (err) {
    console.error("PAYPAL WEBHOOK ERROR:", err.response?.data || err.message);
    // Transient — let PayPal retry.
    return res.status(500).json({ ok: false });
  }
});

// -------------

// --- REGISTER ---
// -------------

app.post("/api/plan/select-with-services", (req, res) => {
  try {
    const { planName, selectedServices } = req.body;

    const planKey = PLAN_NAME_TO_KEY?.[planName] || planName; // supports sending PlanKey directly
    if (!planKey) return res.status(400).json({ error: "Invalid planName" });

    const norm = normalizeSelectedServices(selectedServices);
    assertWithinPlanLimit(planKey, norm);
    assertOrderWithinCapacity(norm);

    req.session.pendingPlan = planKey;
    req.session.pendingServices = norm;

    return res.json({ ok: true, pendingPlan: planKey, pendingServicesCount: norm.length });
  } catch (err) {
    console.error("PLAN+SERVICES SELECT ERROR:", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to store selection." });
  }
});

// ----------
// --- LOGIN ---
// ----------

// ----------
// --- GOOGLE SIGN-IN ---
// ----------
// The browser performs the Google popup (Firebase Auth) and sends us the signed
// ID token. We verify it server-side, then find-or-create the matching Frappe
// Web Account by verified email and establish the SAME Express session the
// password flow uses. Frappe + the session cookie remain the source of truth;
// Firebase is only the identity provider.

// ----------
// --- FORGOT PASSWORD ---
// ----------
// Always responds 200 with a generic message to avoid leaking which emails exist.

// ----------
// --- RESET PASSWORD ---
// ----------

// ----------
// --- CHANGE PASSWORD (logged in) ---
// ----------

// ----------
// --- VERIFY EMAIL ---
// ----------
// Best-effort: marks email_verified on the Web Account if the field exists in the
// doctype. Login is not blocked on verification to avoid locking out existing users.

// ------------------------
// INVOICE DELETE (SOFT)
// ------------------------
const { sendInvoiceDeletedEmail } = require("./utils/mailer");


// -----------------------------
// DOWNLOAD SINGLE INVOICE (PDF)
// -----------------------------

const archiver = require("archiver");

// ------------------------------------
// DOWNLOAD ALL INVOICES (ZIP OF PDFs)
// ------------------------------------

// --- CLIENT MESSAGES / REQUESTS --- 
app.post("/api/requests", publicFormLimiter, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      companyName,
      message,
      requestType, // "Sales Inquiry" | "Demo Request"
      pageUrl
    } = req.body;

    // basic validation
    if (!firstName || !lastName || !email || !companyName || !message || !requestType) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const client = frappeClient();

    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      company_name: companyName,
      message: message,
      request_type: requestType,
      source: "Website",
      page_url: pageUrl || "",
      ip_address: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress,
      user_agent: req.headers["user-agent"] || "",
      status: "New",
    };

    const createResp = await client.post("/api/resource/Client Messages", payload);

    // Email will be sent by Frappe Notification automatically
    return res.json({ ok: true, id: createResp.data?.data?.name });
  } catch (err) {
    console.error("REQUEST CREATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to submit request." });
  }
});

// --- PORTAL USER CHAT: create thread ---


// Unread chat badge for portal user

// --- PORTAL USER CHAT: get thread (with messages) ---

// --- PORTAL USER CHAT: append message (RELIABLE) ---





// Upload files

// Object-level authorization for a private Frappe file. We look the File doc up
// by its url and confirm it is attached to a record the session user owns.
// Fail closed: unknown files / unrecognised attachment types are denied.
async function userOwnsPrivateFile(client, fileUrl, session) {
  try {
    const email = String(session?.user?.email || "").trim().toLowerCase();
    const webAccount = session?.webAccount || session?.user?.id || null;

    const resp = await client.get("/api/resource/File", {
      params: {
        filters: JSON.stringify([["file_url", "=", fileUrl]]),
        fields: JSON.stringify(["name", "attached_to_doctype", "attached_to_name"]),
        limit_page_length: 1,
      },
    });
    const file = resp.data?.data?.[0];
    if (!file) return false;

    const dt = file.attached_to_doctype;
    const dn = file.attached_to_name;
    if (!dt || !dn) return false;

    if (dt === "Web Account") {
      return !!webAccount && dn === webAccount;
    }
    if (dt === "Portal Users Requests") {
      const thread = (await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(dn)}`)).data?.data;
      return !!thread && String(thread.email || "").trim().toLowerCase() === email && !!email;
    }
    if (dt === "Portal Invoice") {
      const invoice = (await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(dn)}`)).data?.data;
      return !!invoice && !!webAccount && invoice.web_account === webAccount;
    }
    return false; // unrecognised attachment type -> deny
  } catch (e) {
    console.warn("FILE OWNERSHIP CHECK WARN:", e.response?.data || e.message);
    return false;
  }
}


// --- PORTAL UPDATES (notifications) ---
const PORTAL_UPDATE_DOCTYPE = "Portal Update";

async function logPortalUpdate(client, webAccountName, update) {
  try {
    if (!webAccountName) return;

    const type =
      update?.type === "technical" || update?.type === "alert" || update?.type === "milestone"
        ? update.type
        : "milestone";

    const payload = {
      doctype: PORTAL_UPDATE_DOCTYPE,
      web_account: webAccountName,
      type,
      engineer: String(update?.engineer || "Murzak Tech"),
      content: String(update?.content || "").trim(),
      acknowledged: update?.acknowledged ? 1 : 0,
      is_chat: update.is_chat ? 1 : 0,
      created_at: mysqlDatetimeUTC(),
    };

    // Never block the main action on notification failures
    if (!payload.content) return;

    await client.post(`/api/resource/${encodeURIComponent(PORTAL_UPDATE_DOCTYPE)}`, payload);
  } catch (e) {
    console.warn("PORTAL UPDATE LOG WARN:", e.response?.data || e.message);
  }
}

async function fetchUpdatesForUser(client, webAccountName) {
  const res = await client.get("/api/resource/Portal Update", {
    params: {
      filters: JSON.stringify([["web_account", "=", webAccountName]]),
      fields: JSON.stringify(["name", "type", "engineer", "content", "created_at", "acknowledged"]),
      order_by: "created_at desc",
      limit_page_length: 50,
    },
  });

  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  return rows.map((u) => ({
    id: u.name,
    type: u.type || "info",
    engineer: u.engineer || "Murzak Tech",
    content: u.content || "",
    timestamp: u.creation || u.created_at || mysqlDatetimeUTC(),
    acknowledged: !!u.acknowledged,
  }));
}

app.post("/api/updates/ack", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing update id." });

    const client = frappeClient();

    // Optional safety: ensure update belongs to user
    const row = (await client.get(`/api/resource/${encodeURIComponent(PORTAL_UPDATE_DOCTYPE)}/${encodeURIComponent(id)}`)).data?.data;
    if (!row || row.web_account !== webAccountName) return res.status(403).json({ error: "Not allowed." });

    await client.put(`/api/resource/${encodeURIComponent(PORTAL_UPDATE_DOCTYPE)}/${encodeURIComponent(id)}`, {
      acknowledged: 1,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("UPDATES ACK ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to acknowledge update." });
  }
});





// --- WEBSITE HOSTING ---
const HOSTING_SERVICE_ID = "biz-web-hosting";

async function getActiveHostingServiceForUser(client, webAccountName) {
  const selected = await fetchSelectedServicesForUser(client, webAccountName);

  const svc = selected.find((s) => String(s.serviceId || "").trim() === HOSTING_SERVICE_ID);

  if (!svc) {
    const err = new Error("Website Hosting service not found on your account.");
    err.statusCode = 404;
    throw err;
  }

  if (String(svc.status || "").trim() !== "Active") {
    const err = new Error("Website Hosting is not active on your account.");
    err.statusCode = 403;
    throw err;
  }

  return svc;
}

// White-label guard: customer-facing payloads must never name the upstream
// vendor (registrar/host). Old rows may still carry it, so sanitize on read.
const UPSTREAM_VENDOR_NAMES = /hostinger|coolify/i;
function toCustomerProvider(provider) {
  const p = String(provider || "").trim();
  if (!p || UPSTREAM_VENDOR_NAMES.test(p)) return "Murzak Cloud";
  return p;
}

async function fetchHostingDomainPurchaseRequests(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Domain Purchase Request", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "requested_name",
        "requested_tld",
        "full_domain",
        "status",
        "notes",
        "provider",
        "is_primary",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    requestedName: row.requested_name,
    requestedTld: row.requested_tld,
    fullDomain: row.full_domain,
    status: row.status,
    notes: row.notes || "",
    provider: toCustomerProvider(row.provider),
    isPrimary: !!row.is_primary,
    createdAt: row.creation,
  }));
}

async function fetchHostingMurzakSubdomains(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Murzak Subdomain", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "requested_label",
        "full_subdomain",
        "status",
        "target_type",
        "target_value",
        "notes",
        "is_primary",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    requestedLabel: row.requested_label,
    fullSubdomain: row.full_subdomain,
    status: row.status,
    targetType: row.target_type,
    targetValue: row.target_value,
    notes: row.notes || "",
    isPrimary: !!row.is_primary,
    createdAt: row.creation,
  }));
}

async function fetchHostingExternalDomains(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting External Domain Connection", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "domain_name",
        "status",
        "registrar",
        "nameserver_1",
        "nameserver_2",
        "a_record",
        "verification_notes",
        "is_primary",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    domainName: row.domain_name,
    status: row.status,
    registrar: row.registrar || "",
    nameserver1: row.nameserver_1 || "",
    nameserver2: row.nameserver_2 || "",
    aRecord: row.a_record || "",
    verificationNotes: row.verification_notes || "",
    isPrimary: !!row.is_primary,
    createdAt: row.creation,
  }));
}


async function fetchHostingSite(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Site", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["status", "in", ["active", "pending", "suspended", "Active", "Pending", "Suspended"]],
      ]),
      fields: JSON.stringify([
        "name",
        "site_type",
        "primary_host",
        "status",
        "plan_name",
        "tier",
        "storage_limit_mb",
        "storage_used_mb",
        "ssl_status",
        "document_root",
        "notes",
        "creation",
      ]),
      limit_page_length: 1,
      order_by: "modified desc",
    },
  });

  const row = res.data?.data?.[0];
  if (!row) return null;

  return {
    id: row.name,
    siteType: row.site_type,
    primaryHost: row.primary_host,
    status: String(row.status || "").toLowerCase(),
    planName: row.plan_name || "",
    tier: row.tier || "",
    storageLimitMb: Number(row.storage_limit_mb || 0),
    storageUsedMb: Number(row.storage_used_mb || 0),
    sslStatus: String(row.ssl_status || "none").toLowerCase(),
    documentRoot: row.document_root || "",
    notes: row.notes || "",
    createdAt: row.creation,
  };
}

async function fetchHostingFiles(client, webAccountName, hostingSiteName) {
  if (!hostingSiteName) return [];

  const res = await client.get("/api/resource/Hosting File", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["hosting_site", "=", hostingSiteName],
      ]),
      fields: JSON.stringify([
        "name",
        "file_name",
        "file_path",
        "file_size_mb",
        "file_type",
        "upload_category",
        "status",
        "is_active_build",
        "notes",
        "creation",
      ]),
      limit_page_length: 200,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    fileName: row.file_name,
    filePath: toDisplayHostingPath(row.file_path || ""),
    fileSizeMb: Number(row.file_size_mb || 0),
    fileType: row.file_type || "",
    uploadCategory: row.upload_category || "",
    status: row.status || "",
    isActiveBuild: !!row.is_active_build,
    notes: row.notes || "",
    createdAt: row.creation,
  }));
}

async function fetchHostingDeployments(client, webAccountName, hostingSiteName) {
  if (!hostingSiteName) return [];

  const res = await client.get("/api/resource/Hosting Deployment", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["hosting_site", "=", hostingSiteName],
      ]),
      fields: JSON.stringify([
        "name",
        "source_file",
        "deployment_type",
        "status",
        "target_path",
        "notes",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    sourceFile: row.source_file || "",
    deploymentType: row.deployment_type || "",
    status: row.status || "",
    targetPath: row.target_path || "",
    notes: row.notes || "",
    createdAt: row.creation,
  }));
}

async function fetchHostingActivity(client, webAccountName, hostingSiteName) {
  if (!hostingSiteName) return [];

  const res = await client.get("/api/resource/Hosting Activity Log", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["hosting_site", "=", hostingSiteName],
      ]),
      fields: JSON.stringify([
        "name",
        "event_type",
        "title",
        "description",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    eventType: row.event_type || "",
    title: row.title || "",
    description: row.description || "",
    createdAt: row.creation,
  }));
}

async function fetchHostingSubdomains(client, webAccountName, hostingSiteName) {
  if (!hostingSiteName) return [];

  const res = await client.get("/api/resource/Hosting Subdomain", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["hosting_site", "=", hostingSiteName],
      ]),
      fields: JSON.stringify([
        "name",
        "parent_host",
        "subdomain_label",
        "full_subdomain",
        "target_type",
        "target_value",
        "status",
        "notes",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    requestedLabel: row.subdomain_label || "",
    fullSubdomain: row.full_subdomain || "",
    status: row.status || "",
    targetType: row.target_type || "",
    targetValue: row.target_value || "",
    notes: row.notes || "",
    createdAt: row.creation,
  }));
}

async function fetchHostingSupportRequests(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Support Request", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "category",
        "title",
        "description",
        "status",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    category: row.category,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.creation,
  }));
}


async function recalculateHostingStorageUsage(client, hostingSiteName) {
  const filesRes = await client.get("/api/resource/Hosting File", {
    params: {
      filters: JSON.stringify([
        ["hosting_site", "=", hostingSiteName],
        ["status", "!=", "archived"],
      ]),
      fields: JSON.stringify(["name", "file_size_mb"]),
      limit_page_length: 500,
    },
  });

  const rows = filesRes.data?.data || [];
  const total = rows.reduce((sum, row) => sum + Number(row.file_size_mb || 0), 0);

  await client.put(`/api/resource/Hosting Site/${encodeURIComponent(hostingSiteName)}`, {
    storage_used_mb: total,
  });

  return total;
}

function getHostingStorageAllocationMb({ tier = "", planName = "" }) {
  const tierValue = String(tier || "").trim().toLowerCase();
  const planValue = String(planName || "").trim().toLowerCase();

  const combined = `${tierValue} ${planValue}`;

  if (combined.includes("trial")) return 0;
  if (combined.includes("starter")) return 25 * 1024;
  if (combined.includes("business")) return 50 * 1024;
  if (combined.includes("enterprise")) return 0;

  return 25 * 1024;
}


async function ensureUserOwnsHostingService(client, webAccountName) {
  const selected = await fetchSelectedServicesForUser(client, webAccountName);
  const svc = selected.find((s) => String(s.serviceId || "").trim() === HOSTING_SERVICE_ID);

  if (!svc) {
    const err = new Error("Website Hosting service not found on your account.");
    err.statusCode = 404;
    throw err;
  }

  if (String(svc.status || "").trim() !== "Active") {
    const err = new Error("Website Hosting is not active on your account.");
    err.statusCode = 403;
    throw err;
  }

  return svc;
}

async function fetchHostingDomains(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Domain", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "domain_name",
        "status",
        "is_primary",
        "source",
        "provider",
        "ssl_status",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    domainName: row.domain_name,
    status: row.status,
    isPrimary: !!row.is_primary,
    source: row.source,
    provider: row.provider ? toCustomerProvider(row.provider) : null,
    sslStatus: row.ssl_status || "none",
    createdAt: row.creation,
  }));
}

async function fetchHostingDomainRequests(client, webAccountName) {
  const res = await client.get("/api/resource/Hosting Domain Request", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
      ]),
      fields: JSON.stringify([
        "name",
        "requested_name",
        "requested_tld",
        "full_domain",
        "request_type",
        "is_included",
        "requires_payment",
        "status",
        "notes",
        "creation",
      ]),
      limit_page_length: 100,
      order_by: "creation desc",
    },
  });

  return (res.data?.data || []).map((row) => ({
    id: row.name,
    requestedName: row.requested_name,
    requestedTld: row.requested_tld,
    fullDomain: row.full_domain,
    requestType: row.request_type,
    isIncluded: !!row.is_included,
    requiresPayment: !!row.requires_payment,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.creation,
  }));
}

function computeIncludedDomainEntitlement(domains, domainRequests) {
  const includedDomainSlots = 1;

  const usedIncludedDomainSlots =
    [...domains, ...domainRequests].filter((item) => item.source === "included" || item.isIncluded).length > 0
      ? 1
      : 0;

  return {
    includedDomainSlots,
    usedIncludedDomainSlots,
    canRequestIncludedDomain: usedIncludedDomainSlots < includedDomainSlots,
  };
}


async function createHostingActivityLog(client, {
  webAccountName,
  hostingSiteName,
  eventType,
  title,
  description = "",
}) {
  if (!hostingSiteName) return null;

  return client.post("/api/resource/Hosting Activity Log", {
    web_account: webAccountName,
    service_id: HOSTING_SERVICE_ID,
    hosting_site: hostingSiteName,
    event_type: eventType,
    title,
    description,
  });
}

async function findExistingHostingSiteByHost(client, webAccountName, primaryHost) {
  const res = await client.get("/api/resource/Hosting Site", {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", HOSTING_SERVICE_ID],
        ["primary_host", "=", primaryHost],
      ]),
      fields: JSON.stringify([
        "name",
        "primary_host",
        "status",
        "site_type",
      ]),
      limit_page_length: 1,
      order_by: "creation desc",
    },
  });

  return res.data?.data?.[0] || null;
}

async function ensurePendingHostingSiteForRequest(client, {
  webAccountName,
  siteType,
  primaryHost,
  serviceTier,
  planName,
  notes = "",
}) {
  const existing = await findExistingHostingSiteByHost(client, webAccountName, primaryHost);
  if (existing) return existing;
  
  const resolvedStorageLimitMb = getHostingStorageAllocationMb({
    tier: serviceTier || "",
    planName: planName || "",
  });

  const created = await client.post("/api/resource/Hosting Site", {
    web_account: webAccountName,
    service_id: HOSTING_SERVICE_ID,
    site_type: siteType,
    primary_host: primaryHost,
    status: "pending",
    plan_name: planName || "Website Hosting",
    tier: serviceTier || "Starter",
    storage_limit_mb: resolvedStorageLimitMb,
    storage_used_mb: 0,
    ssl_status: "pending",
    document_root: "",
    notes: String(notes || "").trim(),
  });

  const siteName = created.data?.data?.name;

  await createHostingActivityLog(client, {
    webAccountName,
    hostingSiteName: siteName,
    eventType: "site_initialized",
    title: "Hosting site initialized",
    description: `${primaryHost} created in pending state awaiting provisioning.`,
  });

  return created.data?.data || null;
}

async function activateHostingSite(client, {
  webAccountName,
  hostingSiteName,
  primaryHost,
  documentRoot,
  sslStatus = "active",
  notes = "",
}) {
  await client.put(`/api/resource/Hosting Site/${encodeURIComponent(hostingSiteName)}`, {
    primary_host: String(primaryHost || "").trim().toLowerCase(),
    document_root: String(documentRoot || "").trim(),
    status: "active",
    ssl_status: String(sslStatus || "active").trim().toLowerCase(),
    notes: String(notes || "").trim(),
  });

  await createHostingActivityLog(client, {
    webAccountName,
    hostingSiteName,
    eventType: "site_activated",
    title: "Hosting site activated",
    description: `${primaryHost} is now live on hosting.`,
  });

  return true;
}

async function finalizeMurzakSubdomainProvisioning(client, {
  webAccountName,
  subdomainDocName,
  hostingSiteName,
  fullSubdomain,
  documentRoot,
}) {
  await client.put(
    `/api/resource/Hosting Murzak Subdomain/${encodeURIComponent(subdomainDocName)}`,
    {
      status: "active",
      is_primary: 1,
    }
  );

  await activateHostingSite(client, {
    webAccountName,
    hostingSiteName,
    primaryHost: fullSubdomain,
    documentRoot,
    sslStatus: "pending",
    notes: "Provisioning completed and site activated.",
  });
}

async function ensureHostingSiteStorageAllocation(client, hostingSiteName, { tier = "", planName = "" }) {
  const storageLimitMb = getHostingStorageAllocationMb({ tier, planName });

  await client.put(`/api/resource/Hosting Site/${encodeURIComponent(hostingSiteName)}`, {
    storage_limit_mb: storageLimitMb,
  });

  return storageLimitMb;
}











function ensureSafeFileName(name = "") {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildHostingUploadDir(webAccountName, hostingSiteName) {
  return path.join(__dirname, "storage", "hosting", String(webAccountName), String(hostingSiteName), "uploads");
}

function buildHostingRelativePath(webAccountName, hostingSiteName, safeName) {
  return path.join(
    "hosting",
    String(webAccountName),
    String(hostingSiteName),
    "uploads",
    String(safeName)
  ).replace(/\\/g, "/");
}

function buildHostingAbsolutePath(relativePath) {
  return path.join(__dirname, "storage", relativePath);
}

function toDisplayHostingPath(relativePath = "") {
  const clean = String(relativePath || "").replace(/\\/g, "/");
  const marker = "/uploads/";
  const idx = clean.indexOf(marker);
  if (idx >= 0) return clean.slice(idx);
  return clean;
}




// --- LOGOUT ---

async function getWebAccountByEmail(client, email) {
  const resp = await client.get("/api/resource/Web Account", {
    params: {
      fields: JSON.stringify(["name", "work_email", "account_holder_name", "entity_name"]),
      filters: JSON.stringify([["work_email", "=", email]]),
      limit_page_length: 1,
    },
  });
  const rows = resp.data?.data || [];
  return rows.length ? rows[0] : null;
}

// --- HEALTH (unauthenticated liveness probe: CI, uptime monitors, LBs) ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// --- ME (session check) ---
app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, user: null });
  }
  res.json({ ok: true, user: req.session.user });
});


// ---- Provisioning (admin) ----
// List provisioning jobs, optionally filtered by status.

// Trigger a single runner pass on demand (does nothing the loop wouldn't, but
// lets an admin push the queue without waiting for the interval).

// Re-queue a failed / needs_human job for another runner attempt.

// Capacity overview: targets + per-target reserved RAM + open scale-out requests.

// Go-live readiness checklist (what's configured after adding env vars).

// Dispatcher health: mode (poll/bullmq/off) and, in bullmq mode, queue counts.

// ---- Frontend Routes (SPA fallback) ----
// Important: This must be AFTER API routes.
// Any route not matched above will return the React app.

// ==========================================
// MOUNT EXTRACTED ROUTES
// ==========================================
const routeContext = {
  // Payment/billing critical: these four were missing after the route
  // extraction, leaving them undefined inside the routers (STK push 500,
  // M-Pesa callback crash post-payment, silent reset-email failure).
  activateServicesForInvoice,
  effectiveChargeKes,
  isVerificationOnly,
  sendInvoiceDeletedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  express,
  session,
  bcrypt,
  axios,
  bodyParser,
  path,
  FormData,
  multer,
  cors,
  helmet,
  rateLimit,
  crypto,
  firebaseAdmin,
  passwordResetTokens,
  emailVerifyTokens,
  hashToken,
  pruneTokenStore,
  appBaseUrl,
  ALLOWED_UPLOAD_EXT,
  upload,
  createPaypalRouter,
  TRIAL_SANDBOX_SERVICE_ID,
  provisioningRunner,
  provisioningQueue,
  provisioningTargets,
  fs,
  fsp,
  app,
  frontendDistPath,
  allowedOrigins,
  SESSION_SECRET,
  sessionStore,
  redisClient,
  loginThrottle,
  authLimiter,
  apiLimiter,
  publicFormLimiter,
  domainCheckLimiter,
  requireAuth,
  requireAdmin,
  isValidEmail,
  mysqlDatetimeUTC,
  FRAPPE_BASE_URL,
  FRAPPE_AUTH,
  frappeClient,
  buildUserPayload,
  SERVICE_ID_TO_PLAN,
  normalizeChildRow,
  computeProratedCreditKes,
  normalizeSelectedServices,
  buildWebAccountServiceRows,
  buildInvoiceServiceRows,
  fetchWebAccount,
  updateWebAccountServices,
  hasPaidSubscriptionForPlan,
  findOpenInvoice,
  computeInvoiceAmount,
  upsertPortalInvoice,
  assertWithinPlanLimit,
  allowedAddonTiersForPlan,
  formatSelectedServices,
  PLAN_PRICING,
  PLAN_NAME_TO_KEY,
  WEB_ACCOUNT_DOCTYPE,
  WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
  WEB_ACCOUNT_SERVICES_FIELD,
  CHILD_SERVICE_ID_FIELD,
  CHILD_SERVICE_NAME_FIELD,
  CHILD_TIER_FIELD,
  CHILD_DOMAIN_CHOICE_FIELD,
  CHILD_STATUS_FIELD,
  SERVICE_STATUS_ACTIVE,
  SERVICE_STATUS_AWAITING,
  PORTAL_INVOICE_SERVICE_CHILD_DOCTYPE,
  PORTAL_INVOICE_SERVICES_FIELD,
  INVOICE_SERVICES_JSON_FIELD,
  INVOICE_SERVICES_COUNT_FIELD,
  PLAN_LIMITS,
  asArray,
  DOMAIN_TLD_PRICES,
  normalizeDomainLabel,
  stableHash,
  hostingerAvailability,
  mergeServicesById,
  findExistingUnpaidSubscriptionInvoice,
  findLatestPaidSubscriptionInvoice,
  applyPlanAndCreateInvoice,
  setupTrialVerification,
  expireStaleTrials,
  fetchInvoicesForUser,
  fetchSelectedServicesForUser,
  normalizeInvoiceServiceRow,
  normalizeInvoiceStatus,
  isInvoicePaidLike,
  isInvoiceDeletedLike,
  isInvoiceUnpaidLike,
  convertKesToPaypalAmount,
  reconcileServiceDeletionAgainstInvoices,
  assertOrderWithinCapacity,
  _mpesaTokenCache,
  getMpesaAccessToken,
  normalizeMpesaPhone,
  mpesaMetaValue,
  suspendServicesForInvoice,
  archiver,
  userOwnsPrivateFile,
  PORTAL_UPDATE_DOCTYPE,
  logPortalUpdate,
  fetchUpdatesForUser,
  HOSTING_SERVICE_ID,
  getActiveHostingServiceForUser,
  fetchHostingDomainPurchaseRequests,
  fetchHostingMurzakSubdomains,
  fetchHostingExternalDomains,
  fetchHostingSite,
  fetchHostingFiles,
  fetchHostingDeployments,
  fetchHostingActivity,
  fetchHostingSubdomains,
  fetchHostingSupportRequests,
  recalculateHostingStorageUsage,
  getHostingStorageAllocationMb,
  ensureUserOwnsHostingService,
  fetchHostingDomains,
  fetchHostingDomainRequests,
  computeIncludedDomainEntitlement,
  createHostingActivityLog,
  findExistingHostingSiteByHost,
  ensurePendingHostingSiteForRequest,
  activateHostingSite,
  finalizeMurzakSubdomainProvisioning,
  ensureHostingSiteStorageAllocation,
  ensureSafeFileName,
  buildHostingUploadDir,
  buildHostingRelativePath,
  buildHostingAbsolutePath,
  toDisplayHostingPath,
  getWebAccountByEmail,
  PROVISIONING_JOB_DOCTYPE,
  CAPACITY_REQUEST_DOCTYPE
};

app.use(require('./routes/authRoutes')(routeContext));
app.use(require('./routes/portalRoutes')(routeContext));
app.use(require('./routes/hostingRoutes')(routeContext));
app.use(require('./routes/billingRoutes')(routeContext));
app.use(require('./routes/adminRoutes')(routeContext));

// Unmatched API routes get a JSON 404, not the SPA's index.html — a wrong URL
// in a client or webhook config should fail loudly, not parse HTML.
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDistPath, "index.html"));
});

// ---- Global error handler (must be last app.use) ----
// Catches anything routed via next(err) — CORS rejections, multer upload errors,
// and any handler that throws synchronously — instead of leaking a stack trace
// or defaulting to an unhandled 500. 5xx messages are kept generic.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode || err.status || 500;
  if (status >= 500) {
    console.error("UNHANDLED ROUTE ERROR:", err.stack || err.message);
  }
  res.status(status).json({
    error: status >= 500 ? "Something went wrong. Please try again." : err.message,
  });
});

// ---- Process-level safety nets ----
// An unhandled rejection is logged (often non-fatal); we keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason instanceof Error ? reason.stack : reason);
});
// An uncaught exception leaves the process in an undefined state — Node's
// documented guidance is to restart. Stop accepting work and exit non-zero so
// the process manager (pm2/systemd) brings up a clean instance; force-exit if
// the graceful close hangs.
let shuttingDownFromCrash = false;
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION — restarting to avoid corrupted state:", err?.stack || err);
  if (shuttingDownFromCrash) return;
  shuttingDownFromCrash = true;
  try {
    Promise.resolve(provisioningQueue.stop()).catch(() => {});
  } catch {}
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});

// ---- Start server ----
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Provisioning dispatcher — poll | bullmq | off. No-op unless
  // PROVISIONING_RUNNER_ENABLED=true. Async start; never blocks boot.
  provisioningQueue.configure({ frappeClientFactory: frappeClient });
  provisioningQueue
    .start()
    .then((r) => {
      if (r.mode && r.mode !== "off") console.log(`[provisioning] dispatcher started: ${JSON.stringify(r)}`);
    })
    .catch((e) => console.error("[provisioning] failed to start dispatcher:", e.message));

  // Trial expiry sweep (36h). Off only if explicitly disabled. Silent when Frappe
  // isn't configured (the query just throws and is swallowed).
  if (process.env.TRIAL_EXPIRY_ENABLED !== "false") {
    const everyMs = Math.max(60000, Number(process.env.TRIAL_EXPIRY_INTERVAL_MS || 15 * 60 * 1000));
    setTimeout(() => { expireStaleTrials(); }, 30000).unref();
    setInterval(() => { expireStaleTrials(); }, everyMs).unref();
  }

  // Renewal billing sweep: creates the month-2+ subscription invoices (and,
  // opt-in, enforces the grace window). RENEWAL_ENABLED=false to disable.
  {
    const { sweepRenewals, renewalConfig } = require("./services/renewalService");
    const cfg = renewalConfig();
    if (cfg.enabled) {
      const renewalDeps = {
        frappeClient,
        PLAN_PRICING,
        PORTAL_INVOICE_SERVICES_FIELD,
        WEB_ACCOUNT_SERVICES_FIELD,
        CHILD_SERVICE_ID_FIELD,
        CHILD_SERVICE_NAME_FIELD,
        CHILD_TIER_FIELD,
        CHILD_DOMAIN_CHOICE_FIELD,
        CHILD_STATUS_FIELD,
        buildInvoiceServiceRows,
        logPortalUpdate,
      };
      const run = () => sweepRenewals(renewalDeps).catch((e) => console.warn("[renewal] sweep error:", e.message));
      setTimeout(run, 90000).unref();
      setInterval(run, cfg.intervalMs).unref();
      console.log(`[renewal] sweep scheduled every ${Math.round(cfg.intervalMs / 60000)}m (cycle ${cfg.cycleDays}d, grace ${cfg.graceDays}d, suspend=${cfg.suspendEnabled})`);
    }
  }
});

// ---- Graceful shutdown ----
function shutdown(signal) {
  console.log(`${signal} received: closing server...`);
  // Close the provisioning dispatcher (worker/queue/redis) first.
  Promise.resolve(provisioningQueue.stop()).catch(() => {});
  server.close(() => {
    console.log("HTTP server closed. Exiting.");
    process.exit(0);
  });
  // Force-exit if connections linger.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
