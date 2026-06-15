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
}


const createPaypalRouter = require("./routes/paypalRoutes");
const { activateServicesForInvoice } = require("./services/billingActivationService");
const { effectiveChargeKes, isVerificationOnly } = require("./utils/billingAmount");
const { assertOrderWithinCapacity } = require("./services/orderCapacity");
const { capturedAmountMatches } = require("./services/paypalService");
const { getServiceMeta } = require("./services/provisioning/catalog");

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
  cors({
    origin(origin, cb) {
      // Same-origin / server-to-server requests have no Origin header.
      if (!origin) return cb(null, true);
      // FAIL CLOSED: with no allow-list, deny all cross-origin (prod is same-origin).
      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
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

function requireAuth(req, res, next) {
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

app.post("/api/subscription/upgrade", requireAuth, async (req, res) => {
  try {
    const { newPlan } = req.body || {};
    if (!newPlan) return res.status(400).json({ error: "Missing newPlan." });

    const client = frappeClient();

    const webAccountName = req.session?.user?.web_account || req.session?.user?.webAccountName;
    if (!webAccountName) return res.status(401).json({ error: "Missing web account in session." });

    const record = await fetchWebAccount(client, webAccountName);
    const currentPlan = record?.plan || "None";

    if (currentPlan === "None") {
      // no plan yet → treat as apply plan normally
      await applyPlanAndCreateInvoice(client, webAccountName, newPlan, { force: true, creditKes: 0 });
      const invoices = await fetchInvoicesForUser(client, webAccountName);
      const fresh = await fetchWebAccount(client, webAccountName);
      return res.json({ ok: true, user: buildUserPayload({ record: fresh, invoices }) });
    }

    if (currentPlan === newPlan) {
      return res.status(400).json({ error: `You are already on ${newPlan}. Add services instead.` });
    }

    // Optional: credit based on latest paid subscription invoice
    const latestPaid = await findLatestPaidSubscriptionInvoice(client, webAccountName);
    const creditKes = latestPaid ? computeProratedCreditKes(latestPaid) : 0;

    // Upgrade: set plan to newPlan and create invoice (minus credit)
    await applyPlanAndCreateInvoice(client, webAccountName, newPlan, { force: true, creditKes });

    // IMPORTANT: keep services, but set them Awaiting Payment until new plan paid
    // (You can decide to wipe or keep; you wanted keep files + likely reset services)
    // Here we keep services but mark them awaiting unless you want to clear them:
    const refreshed = await fetchWebAccount(client, webAccountName);
    const rows = asArray(refreshed?.[WEB_ACCOUNT_SERVICES_FIELD]).map((r) =>
      normalizeChildRow({ ...r, status: SERVICE_STATUS_AWAITING })
    );
    await updateWebAccountServices(client, webAccountName, rows);

    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);

    const user = buildUserPayload({ record: fresh, invoices, selectedServices });
    req.session.user = user;

    return res.json({ ok: true, creditKes, user });
  } catch (err) {
    console.error("UPGRADE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to upgrade subscription." });
  }
});

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

function computeAddonInvoiceAmount(selectedServices = [], includedRemaining = 0) {
  const norm = normalizeSelectedServices(selectedServices);

  const freeCount = Math.max(0, Number(includedRemaining || 0));
  const chargeable = norm.slice(freeCount);

  return chargeable.reduce(
    (sum, s) => sum + Number(ADDON_PRICING_BY_SERVICE_ID[s.serviceId] || 0),
    0
  );
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

const ADDON_PRICING_BY_SERVICE_ID = {
  // example; fill with real values
  "starter-email": 2000,
  "starter-storage": 1500,
  "starter-hrpay": 5000,
  "starter-erp-light": 8000,
  "starter-db-light": 6000,

  "biz-web-hosting": 12000,
  "biz-crm-helpdesk": 15000,
  "biz-accounting": 12000,
  "biz-db-medium": 18000,
  "biz-email-large": 6000,
  "biz-pos-inventory": 20000,
  "biz-webapps": 15000,
  "biz-docs": 18000,
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

    const { services, includedRemaining } = req.body || {};
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

    // Optional: ensure all are priced
    for (const s of norm) {
      if (!ADDON_PRICING_BY_SERVICE_ID[s.serviceId]) {
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

    const amount = computeAddonInvoiceAmount(norm, includedRemaining);

    // If everything fits in free included slots, we don't create an Addon invoice.
    if (amount <= 0) {
      return res.json({ ok: true, message: "Added within included slots. No add-on invoice created." });
    }

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

      // For open unpaid add-on invoice, all rows should be chargeable add-ons
      const mergedAmount = computeAddonInvoiceAmount(mergedServices, 0);

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

  // Create invoice only if amount > 0
  let amount = PLAN_PRICING[planKey] ?? 0;
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
// and suspend the trial sandbox service. Best-effort; silent if Frappe is down.
async function expireStaleTrials() {
  try {
    const client = frappeClient();
    const nowSql = new Date().toISOString().slice(0, 19).replace("T", " ");
    const res = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([["status", "=", "Active"], ["trial_end", "<", nowSql]]),
        fields: JSON.stringify(["name", "web_account"]),
        limit_page_length: 50,
      },
    });
    const expired = res.data?.data || [];
    for (const t of expired) {
      try {
        await client.put(`/api/resource/Test Plan Invoice/${encodeURIComponent(t.name)}`, { status: "Expired" });
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
    const existingRows = accRes.data?.data?.selected_services || [];

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

app.delete("/api/account/services/:serviceId", requireAuth, async (req, res) => {
  try {
    const serviceId = String(req.params.serviceId || "").trim();
    const { confirmText } = req.body || {};  

    if (!serviceId) return res.status(400).json({ error: "Missing serviceId." });

    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const client = frappeClient();
    const record = await fetchWebAccount(client, webAccountName);

    const existingRows = asArray(record?.[WEB_ACCOUNT_SERVICES_FIELD]).map(normalizeChildRow);

    const row = existingRows.find((r) => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim() === serviceId);
    if (!row) return res.status(404).json({ error: "Service not found on your account." });

    const status = String(row?.[CHILD_STATUS_FIELD] || "").toLowerCase();
    const isPaid = status.includes("active") || status.includes("paid");

    if (isPaid && String(confirmText || "").trim() !== "DELETE") {
      return res.status(409).json({
        error: "This is a paid service. Type DELETE to confirm removal.",
        requiresConfirm: true,
      });
    }

    // 1) Remove from Web Account selected services
    const filtered = existingRows.filter(
      (r) => String(r?.[CHILD_SERVICE_ID_FIELD] || "").trim() !== serviceId
    );

    await updateWebAccountServices(client, webAccountName, filtered);

    // 2) Remove from addon_service_ids on parent, if present
    let currentAddonIds = [];
    try {
      currentAddonIds = JSON.parse(record?.addon_service_ids || "[]");
    } catch {
      currentAddonIds = [];
    }

    const filteredAddonIds = (Array.isArray(currentAddonIds) ? currentAddonIds : [])
      .map((id) => String(id || "").trim())
      .filter((id) => !!id && id !== serviceId);

    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
      addon_service_ids: JSON.stringify(filteredAddonIds),
    });

    // 3) Remove from unpaid invoices and recalculate add-on totals
    await reconcileServiceDeletionAgainstInvoices(client, webAccountName, serviceId);

    const svcName = row?.[CHILD_SERVICE_NAME_FIELD] || serviceId;
    const svcTier = row?.[CHILD_TIER_FIELD] || "";

    await logPortalUpdate(client, webAccountName, {
      type: "info",
      engineer: "Murzak System",
      content: `Service removed: ${svcName}${svcTier ? ` (${svcTier})` : ""}.`,
    });

    // 4) Refresh session payload
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const fresh = await fetchWebAccount(client, webAccountName);

    const user = buildUserPayload({ record: fresh, invoices, selectedServices });
    req.session.user = user;

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("DELETE SERVICE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to delete service." });
  }
});

app.post("/api/account/services/update", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });

    const { plan, selectedServices } = req.body;
    if (!plan) return res.status(400).json({ error: "Missing plan." });
    if (!Array.isArray(selectedServices)) return res.status(400).json({ error: "selectedServices must be an array." });

    assertWithinPlanLimit(plan, selectedServices);

    const client = frappeClient();

    // Read parent doc so we can update its child table safely
    const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const account = accRes.data?.data || {};

    // Build child rows (status default Awaiting Payment)
    const childRows = selectedServices.map((s) => ({
      doctype: WEB_ACCOUNT_SERVICE_CHILD_DOCTYPE,
      [CHILD_SERVICE_ID_FIELD]: s.serviceId,
      [CHILD_SERVICE_NAME_FIELD]: s.serviceName || "",
      [CHILD_TIER_FIELD]: s.tier || "",
      [CHILD_DOMAIN_CHOICE_FIELD]: s.domainChoice || "",
      [CHILD_STATUS_FIELD]: s.status || "Awaiting Payment",
    }));

    // Update Web Account: plan + services table
    await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
      plan,
      [WEB_ACCOUNT_SERVICES_FIELD]: childRows,
    });

    const ids = selectedServices.map(s => s.serviceId).filter(Boolean);
    await logPortalUpdate(client, webAccountName, {
      type: "technical",
      engineer: "Murzak System",
      content: `Services updated (${ids.length}): ${ids.join(", ")}`,
    });

    // Upsert invoice snapshot (and amount)
    await applyPlanAndCreateInvoice(client, webAccountName, plan, selectedServices);

    // Return fresh payload bits
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selected = await fetchSelectedServicesForUser(client, webAccountName);

    // refresh session user (so portal updates without reload)
    const userRec = (await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`)).data?.data;
    const userPayload = buildUserPayload({ record: userRec, invoices, selectedServices: selected });
    req.session.user = userPayload;

    return res.json({ ok: true, selectedServices: selected, invoices, user: userPayload });
  } catch (err) {
    console.error("SERVICES UPDATE ERROR:", err.response?.data || err.message);
    const code = err.statusCode || 500;
    return res.status(code).json({ error: err.message || "Failed to update services." });
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
      payload.amount = computeAddonInvoiceAmount(filteredServices, 0);
    }

    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceName)}`, payload);
  }
}

app.post("/api/billing/activate-services", requireAuth, async (req, res) => {
  try {
    const { invoiceDocName } = req.body;

    const result = await activateServicesForInvoice({
      req,
      invoiceDocName,
      frappeClient,
      PORTAL_INVOICE_SERVICES_FIELD,
      CHILD_SERVICE_ID_FIELD,
      WEB_ACCOUNT_SERVICES_FIELD,
      CHILD_STATUS_FIELD,
      fetchInvoicesForUser,
      fetchSelectedServicesForUser,
      buildUserPayload,
    });

    return res.json(result);
  } catch (err) {
    console.error("ACTIVATE SERVICES ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: "Failed to activate services." });
  }
});

app.get("/api/billing/invoice/:docName", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });

    const { docName } = req.params;
    if (!docName) return res.status(400).json({ error: "Missing docName." });

    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(docName)}`);
    const inv = invRes.data?.data;
    if (!inv) return res.status(404).json({ error: "Invoice not found." });

    if (inv.web_account !== webAccountName) {
      return res.status(403).json({ error: "Invoice not yours." });
    }

    return res.json({
      ok: true,
      invoice: {
        docName: inv.name,
        invoiceNo: inv.invoice_no || inv.name,
        amount: Number(inv.amount || 0),
        paypalAmountUsd: convertKesToPaypalAmount(inv.amount),
        status: inv.status,
        type: inv.type,
        plan: inv.plan,
        date: inv.invoice_date,
      },
    });
  } catch (err) {
    console.error("GET INVOICE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch invoice." });
  }
});

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
app.post("/api/billing/mpesa/stk-push", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { phoneNumber, invoiceDocName } = req.body || {};

    if (!phoneNumber || !invoiceDocName) {
      return res.status(400).json({ error: "Missing phoneNumber or invoiceDocName." });
    }

    const phone = normalizeMpesaPhone(phoneNumber);
    if (!phone) {
      return res.status(400).json({ error: "Invalid M-Pesa phone number. Use format 07xx or 01xx." });
    }

    if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_CONSUMER_SECRET) {
      console.error("MPESA MISSING ENV: MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set.");
      return res.status(503).json({ error: "M-Pesa payment is not configured. Please use PayPal or contact support." });
    }

    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`);
    const inv = invRes.data?.data;

    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (inv.web_account !== webAccountName) return res.status(403).json({ error: "Invoice not yours." });
    if (String(inv.status || "").toLowerCase() === "paid") {
      return res.status(409).json({ error: "Invoice is already paid." });
    }

    // Free / zero-amount invoices push the small verification charge so the
    // trial is activated against a real M-Pesa transaction ("for free").
    const amountKes = Math.ceil(effectiveChargeKes(inv.amount));
    if (amountKes <= 0) return res.status(400).json({ error: "Invoice amount must be greater than 0." });

    const mpesaEnv = (process.env.MPESA_ENV || "sandbox").toLowerCase();
    const darajaBase =
      mpesaEnv === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    const shortcode   = process.env.MPESA_SHORTCODE;
    const passkey     = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!shortcode || !passkey || !callbackUrl) {
      console.error("MPESA MISSING ENV: MPESA_SHORTCODE / MPESA_PASSKEY / MPESA_CALLBACK_URL");
      return res.status(503).json({ error: "M-Pesa payment is not fully configured. Please contact support." });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14);

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const token = await getMpesaAccessToken();

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amountKes,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: inv.invoice_no || invoiceDocName,
      TransactionDesc: `Murzak ${inv.invoice_no || invoiceDocName}`,
    };

    const stkResp = await axios.post(
      `${darajaBase}/mpesa/stkpush/v1/processrequest`,
      stkPayload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    const stkData = stkResp.data || {};

    if (stkData.ResponseCode !== "0") {
      console.error("STK PUSH FAILED:", stkData);
      return res.status(502).json({
        error: stkData.ResponseDescription || stkData.errorMessage || "STK push failed.",
      });
    }

    // Persist checkoutRequestID so the callback can match it
    await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`, {
      mpesa_checkout_request_id: stkData.CheckoutRequestID,
    });

    return res.json({
      ok: true,
      checkoutRequestID: stkData.CheckoutRequestID,
      merchantRequestID: stkData.MerchantRequestID,
      message: "STK push sent. Please check your phone and enter your M-Pesa PIN.",
    });
  } catch (err) {
    console.error("MPESA STK PUSH ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to initiate M-Pesa payment." });
  }
});

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
app.post("/api/billing/mpesa/callback", async (req, res) => {
  try {
    // 1) Shared-secret check. FAIL CLOSED: in production an unconfigured secret
    //    would leave this endpoint open to forged payment confirmations.
    const expectedToken = process.env.MPESA_CALLBACK_SECRET;
    if (!expectedToken) {
      if (process.env.NODE_ENV === "production") {
        console.error("MPESA CALLBACK: rejected — MPESA_CALLBACK_SECRET not configured.");
        return res.status(503).json({ ResultCode: 1, ResultDesc: "Callback not configured" });
      }
    } else {
      const provided = String(req.query.token || req.headers["x-callback-token"] || "");
      if (provided !== expectedToken) {
        console.warn("MPESA CALLBACK: rejected — bad/missing token from", req.ip);
        return res.status(401).json({ ResultCode: 1, ResultDesc: "Unauthorized" });
      }
    }

    const body = req.body?.Body?.stkCallback || req.body;
    const resultCode = Number(body?.ResultCode ?? 1);
    const checkoutRequestID = String(body?.CheckoutRequestID || "").trim();

    // Always respond 200 immediately (Safaricom spec requirement)
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });

    if (resultCode !== 0 || !checkoutRequestID) {
      console.warn("MPESA CALLBACK: payment not successful or missing ID", { resultCode, checkoutRequestID });
      return;
    }

    const client = frappeClient();
    const searchRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([["mpesa_checkout_request_id", "=", checkoutRequestID]]),
        fields: JSON.stringify(["name", "web_account", "status", "amount"]),
        limit_page_length: 1,
      },
    });

    const inv = searchRes.data?.data?.[0];
    if (!inv?.name) {
      console.warn("MPESA CALLBACK: no invoice found for checkoutRequestID:", checkoutRequestID);
      return;
    }

    if (String(inv.status || "").toLowerCase() === "paid") {
      console.log("MPESA CALLBACK: invoice already paid:", inv.name);
      return;
    }

    // 2) Verify the amount actually paid matches what we billed.
    //    Reject if the amount is missing or below the billed amount (fail closed).
    const paidAmount = Number(mpesaMetaValue(body, "Amount") || 0);
    const expectedAmount = Math.ceil(effectiveChargeKes(inv.amount));
    if (expectedAmount > 0 && (!(paidAmount > 0) || paidAmount < expectedAmount)) {
      console.error("MPESA CALLBACK: amount missing or underpaid — rejected", {
        invoice: inv.name, paidAmount, expectedAmount,
      });
      return;
    }

    // 3) Record the receipt number for reconciliation (best-effort).
    const receipt = mpesaMetaValue(body, "MpesaReceiptNumber");
    if (receipt) {
      try {
        await client.put(`/api/resource/Portal Invoice/${encodeURIComponent(inv.name)}`, {
          mpesa_receipt_number: String(receipt),
        });
      } catch (e) {
        console.warn("MPESA CALLBACK: could not store receipt number:", e.response?.data || e.message);
      }
    }

    await activateServicesForInvoice({
      req: { session: { webAccount: inv.web_account, user: { id: inv.web_account } } },
      invoiceDocName: inv.name,
      // Trusted rail: the callback verified the shared secret and that the paid
      // amount meets the invoice's expected charge before reaching this point.
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

    console.log("MPESA CALLBACK: services activated for invoice:", inv.name);
  } catch (err) {
    console.error("MPESA CALLBACK ERROR:", err.response?.data || err.message);
  }
});

// Poll payment status — frontend polls this after sending STK push
app.get("/api/billing/mpesa/status/:invoiceDocName", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { invoiceDocName } = req.params;
    const client = frappeClient();
    const invRes = await client.get(`/api/resource/Portal Invoice/${encodeURIComponent(invoiceDocName)}`);
    const inv = invRes.data?.data;

    if (!inv) return res.status(404).json({ error: "Invoice not found." });
    if (inv.web_account !== webAccountName) return res.status(403).json({ error: "Invoice not yours." });

    return res.json({
      ok: true,
      status: inv.status,
      paid: String(inv.status || "").toLowerCase() === "paid",
    });
  } catch (err) {
    console.error("MPESA STATUS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to check payment status." });
  }
});

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
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = req.body.name ?? req.body.accountHolderName;
    const company = req.body.company ?? req.body.entityName;
    const emailRaw = req.body.email ?? req.body.workEmail;
    const password = req.body.password;
    const purpose = req.body.purpose ?? "";
    const sourceCode = req.body.sourceCode ?? "";

    const email = (emailRaw || "").toLowerCase().trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const sessionPlan = req.session.pendingPlan;
    const bodyPlan = req.body.plan ?? "None";
    let resolvedPlan = sessionPlan || bodyPlan || "None";

    const bodyServices = normalizeSelectedServices(req.body.selectedServices);
    const sessionServices = normalizeSelectedServices(req.session.pendingServices);
    const resolvedServices = bodyServices.length ? bodyServices : sessionServices;

    if (!name || !company || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    assertWithinPlanLimit(resolvedPlan, resolvedServices);
    assertOrderWithinCapacity(resolvedServices);

    const client = frappeClient();

    // --- Claim Test Plan Invoice by email (1 email = 1 trial) ---
    const trialLookup = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account_email", "=", email],
          ["status", "in", ["New", "Trial Pending", "Active"]],
        ]),
        fields: JSON.stringify(["name", "status"]),
        limit_page_length: 1,
        order_by: "modified desc",
      },
    });

    const existingTrial = trialLookup.data?.data?.[0];
    if (existingTrial?.name) {
      resolvedPlan = "Test"; // override whatever came from session/body
    }

    // 1) Check if email already exists
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 1,
      },
    });

    if (query.data?.data?.length) {
      return res.status(409).json({ error: "Email already in use." });
    }

    // 2) Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // 3) Create Web Account doc. The existence check above is racy on its own
    //    (two concurrent submits both pass it), so we ALSO rely on a unique index
    //    on Web Account.work_email and treat a duplicate-insert as 409 — making
    //    registration idempotent under double-submit / concurrent requests.
    let createResp;
    try {
      createResp = await client.post("/api/resource/Web Account", {
        account_holder_name: name,
        entity_name: company,
        work_email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        purpose,
        source_code: sourceCode,

        // persist plan at creation (recommended)
        plan: resolvedPlan,
        account_status: "Active",
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(
          resolvedServices.map((s) => ({ ...s, status: s.status || "Awaiting Payment" }))
        ),
      });
    } catch (e) {
      const dup =
        e?.response?.status === 409 ||
        /duplicate|already exists|unique/i.test(`${e?.response?.data?.exception || e?.response?.data?._error_message || e?.message || ""}`);
      if (dup) return res.status(409).json({ error: "Email already in use." });
      throw e;
    }

    const docName = createResp.data?.data?.name;
    if (!docName) {
      return res.status(500).json({ error: "Registration failed: missing doc id." });
    }

    // If a trial existed, link it to this Web Account (optional but recommended)
    if (existingTrial?.name) {
      await client.put(`/api/resource/Test Plan Invoice/${existingTrial.name}`, {
        web_account: docName,
        status: "Trial Pending", // keep pending until activation, or set "Active" if you activate instantly
      });
    }

    // 4) Create invoice if needed. Paid plans → a subscription invoice; the free
    //    trial → a KES-1 verification invoice the user pays to start the 36h trial.
    if (resolvedPlan !== "Test") {
      await applyPlanAndCreateInvoice(client, docName, resolvedPlan, resolvedServices);
    } else {
      await setupTrialVerification(client, docName);
    }

    // 5) Fetch invoices for portal display
    const invoices = await fetchInvoicesForUser(client, docName);
    const selectedServices = await fetchSelectedServicesForUser(client, docName);

    // 6) Read back record fields we care about (so payload is consistent)
    const record = {
      name: docName,
      account_holder_name: name,
      entity_name: company,
      work_email: email,
      purpose,
      source_code: sourceCode,
      plan: resolvedPlan,
      account_status: "Active",
    };

    const userPayload = buildUserPayload({ record, planOverride: resolvedPlan, invoices, selectedServices });

    req.session.user = userPayload;
    req.session.webAccount = userPayload.id;
    req.session.pendingPlan = null; // clear pending plan
    req.session.pendingServices = null;

    // Send email verification link (best-effort, non-blocking).
    try {
      pruneTokenStore(emailVerifyTokens);
      const vToken = crypto.randomBytes(32).toString("hex");
      emailVerifyTokens.set(hashToken(vToken), {
        docName,
        email,
        expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });
      const verifyUrl = `${appBaseUrl(req)}/api/auth/verify-email?token=${vToken}`;
      await sendVerificationEmail({ to: email, clientName: name, verifyUrl });
    } catch (mailErr) {
      console.error("REGISTER VERIFY EMAIL ERROR:", mailErr.message);
    }

    return res.json({ ok: true, id: docName, user: userPayload });
  } catch (err) {
    console.error("REGISTER ERROR:", err.response?.data || err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: status >= 500 ? "Registration failed." : err.message });
  }
});

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
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const emailRaw = req.body.email;
    const password = req.body.password;

    const email = (emailRaw || "").toLowerCase().trim();
    if (!email || !password) return res.status(400).json({ error: "Missing email or password." });

    // Account-keyed brute-force lockout (defends against IP-rotating attacks
    // that spread guesses across many IPs against one account).
    const lock = await loginThrottle.check(email);
    if (lock.locked) {
      res.set("Retry-After", String(lock.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many failed attempts for this account. Please try again later or reset your password.",
      });
    }

    const client = frappeClient();

    // Find account by email FIRST
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify([
          "name",
          "work_email",
          "password_hash",
          "account_holder_name",
          "entity_name",
          "purpose",
          "source_code",
          "plan",
          "account_status",
          WEB_ACCOUNT_SERVICES_FIELD,
        ]),
        limit_page_length: 1,
      },
    });

    const record = query.data?.data?.[0];
    if (!record) {
      await loginThrottle.recordFailure(email);
      return res.status(401).json({ error: "Login failed. Please check your credentials." });
    }

    const match = record.password_hash
      ? await bcrypt.compare(password, record.password_hash)
      : false;
    if (!match) {
      await loginThrottle.recordFailure(email);
      return res.status(401).json({ error: "Login failed. Please check your credentials." });
    }

    // Successful credential check — clear the failure counter.
    await loginThrottle.reset(email);

    const docName = record.name;

    // --- Claim Test Plan on login (safety net) AFTER record exists---
    try {
      const emailNorm = (email || "").trim().toLowerCase();

      const trialLookup = await client.get("/api/resource/Test Plan Invoice", {
        params: {
          filters: JSON.stringify([
            ["web_account_email", "=", emailNorm],
            ["status", "in", ["New", "Trial Pending", "Active"]],
          ]),
          fields: JSON.stringify(["name", "status", "web_account"]),
          limit_page_length: 1,
          order_by: "modified desc",
        },
      });

      const existingTrial = trialLookup.data?.data?.[0];

      if (existingTrial?.name) {
        // Update account plan if needed
        if (record.plan !== "Test") {
          await client.put(`/api/resource/Web Account/${docName}`, {
            plan: "Test",
          });
          record.plan = "Test"; // keep your in-memory record consistent for payload
        }

        // Link trial -> account if not linked
        if (!existingTrial.web_account) {
          await client.put(`/api/resource/Test Plan Invoice/${existingTrial.name}`, {
            web_account: docName,
          });
        }

        // Ensure the KES-1 verification invoice exists (idempotent) so the trial
        // isn't a dead-end — the portal prompts the user to verify and start.
        if (String(existingTrial.status || "").toLowerCase() !== "active") {
          await setupTrialVerification(client, docName);
        }
      }
    } catch (e) {
      console.warn("LOGIN TRIAL CLAIM WARN:", e.response?.data || e.message);
    }

    // Apply pending plan/services (pricing -> login flow)
    const pendingPlan = req.session.pendingPlan;
    const pendingServices = normalizeSelectedServices(req.session.pendingServices);

    let planOverride = null;

    if (pendingPlan) {
      assertWithinPlanLimit(pendingPlan, pendingServices);

      // persist web account services as Awaiting Payment
      await client.put(`/api/resource/Web Account/${encodeURIComponent(docName)}`, {
        plan: pendingPlan,
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(
          pendingServices.map((s) => ({ ...s, status: "Awaiting Payment" }))
        ),
        account_status: record.account_status || "Active",
      });

      // update/create invoice (upsert)
      if (pendingPlan !== "Test") {
        await applyPlanAndCreateInvoice(client, docName, pendingPlan, pendingServices);
      }

      planOverride = pendingPlan;
      record.plan = pendingPlan;
      req.session.pendingPlan = null;
      req.session.pendingServices = null;
    }    
    // Fetch invoices for portal display
    const invoices = await fetchInvoicesForUser(client, record.name);
    const selectedServices = await fetchSelectedServicesForUser(client, docName);

    const userPayload = buildUserPayload({
      record: {
        ...record,
        plan: planOverride || record.plan,
      },
      planOverride: planOverride || null,
      invoices,
      selectedServices,
    });

    // Regenerate the session ID on privilege change to prevent session fixation.
    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error("LOGIN SESSION REGEN ERROR:", regenErr);
        return res.status(500).json({ error: "Login failed." });
      }
      req.session.user = userPayload;
      req.session.webAccount = userPayload.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("LOGIN SESSION SAVE ERROR:", saveErr);
          return res.status(500).json({ error: "Login failed." });
        }
        return res.json({ ok: true, user: userPayload });
      });
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Login failed." });
  }
});

// ----------
// --- GOOGLE SIGN-IN ---
// ----------
// The browser performs the Google popup (Firebase Auth) and sends us the signed
// ID token. We verify it server-side, then find-or-create the matching Frappe
// Web Account by verified email and establish the SAME Express session the
// password flow uses. Frappe + the session cookie remain the source of truth;
// Firebase is only the identity provider.
app.post("/api/auth/google", authLimiter, async (req, res) => {
  try {
    if (!firebaseAdmin.isConfigured()) {
      console.warn("GOOGLE AUTH unavailable:", firebaseAdmin.configError());
      return res.status(503).json({ error: "Google sign-in is not available right now." });
    }

    const idToken = req.body?.idToken;
    let decoded;
    try {
      decoded = await firebaseAdmin.verifyIdToken(idToken);
    } catch (e) {
      console.warn("GOOGLE AUTH token verify failed:", e.code || e.message);
      return res.status(401).json({ error: "Could not verify Google sign-in. Please try again." });
    }

    const email = (decoded.email || "").toLowerCase().trim();
    if (!email || decoded.email_verified !== true) {
      return res.status(401).json({ error: "Your Google account has no verified email." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email from Google." });
    }

    const displayName =
      (decoded.name && String(decoded.name).trim()) || email.split("@")[0];

    const client = frappeClient();

    // 1) Find existing Web Account by verified email.
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify([
          "name",
          "work_email",
          "account_holder_name",
          "entity_name",
          "purpose",
          "source_code",
          "plan",
          "account_status",
          WEB_ACCOUNT_SERVICES_FIELD,
        ]),
        limit_page_length: 1,
      },
    });

    let record = query.data?.data?.[0] || null;

    // 2) First-time Google user → provision a passwordless Web Account.
    if (!record) {
      const createResp = await client.post("/api/resource/Web Account", {
        account_holder_name: displayName,
        entity_name: displayName,
        work_email: email,
        // No password_hash: this is a federated (Google-only) account. The
        // password login path already treats a missing hash as "no match".
        purpose: "",
        source_code: "",
        plan: "None",
        account_status: "Active",
      });
      const docName = createResp.data?.data?.name;
      if (!docName) {
        return res.status(500).json({ error: "Sign-in failed: could not create account." });
      }
      record = {
        name: docName,
        work_email: email,
        account_holder_name: displayName,
        entity_name: displayName,
        purpose: "",
        source_code: "",
        plan: "None",
        account_status: "Active",
      };
    }

    const docName = record.name;

    // 3) Apply any pending plan/services chosen before sign-in (mirrors /api/login).
    const pendingPlan = req.session.pendingPlan;
    const pendingServices = normalizeSelectedServices(req.session.pendingServices);
    let planOverride = null;

    if (pendingPlan) {
      assertWithinPlanLimit(pendingPlan, pendingServices);
      await client.put(`/api/resource/Web Account/${encodeURIComponent(docName)}`, {
        plan: pendingPlan,
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(
          pendingServices.map((s) => ({ ...s, status: "Awaiting Payment" }))
        ),
        account_status: record.account_status || "Active",
      });
      if (pendingPlan !== "Test") {
        await applyPlanAndCreateInvoice(client, docName, pendingPlan, pendingServices);
      }
      planOverride = pendingPlan;
      record.plan = pendingPlan;
      req.session.pendingPlan = null;
      req.session.pendingServices = null;
    }

    const invoices = await fetchInvoicesForUser(client, docName);
    const selectedServices = await fetchSelectedServicesForUser(client, docName);

    const userPayload = buildUserPayload({
      record: { ...record, plan: planOverride || record.plan },
      planOverride: planOverride || null,
      invoices,
      selectedServices,
    });

    // Regenerate the session ID on login to prevent session fixation.
    return req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error("GOOGLE AUTH SESSION REGEN ERROR:", regenErr);
        return res.status(500).json({ error: "Sign-in failed." });
      }
      req.session.user = userPayload;
      req.session.webAccount = userPayload.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("GOOGLE AUTH SESSION SAVE ERROR:", saveErr);
          return res.status(500).json({ error: "Sign-in failed." });
        }
        return res.json({ ok: true, user: userPayload });
      });
    });
  } catch (err) {
    console.error("GOOGLE AUTH ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Sign-in failed." });
  }
});

// ----------
// --- FORGOT PASSWORD ---
// ----------
// Always responds 200 with a generic message to avoid leaking which emails exist.
app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const genericOk = {
    ok: true,
    message: "If an account exists for that email, a reset link has been sent.",
  };
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!isValidEmail(email)) return res.json(genericOk); // don't reveal validity

    const client = frappeClient();
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify(["name", "work_email", "account_holder_name"]),
        limit_page_length: 1,
      },
    });
    const record = query.data?.data?.[0];

    if (record?.name) {
      pruneTokenStore(passwordResetTokens);
      const token = crypto.randomBytes(32).toString("hex");
      passwordResetTokens.set(hashToken(token), {
        docName: record.name,
        email,
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });

      const resetUrl = `${appBaseUrl(req)}/login?reset=${token}`;
      try {
        await sendPasswordResetEmail({
          to: email,
          clientName: record.account_holder_name,
          resetUrl,
        });
      } catch (mailErr) {
        console.error("FORGOT PASSWORD EMAIL ERROR:", mailErr.message);
      }
    }

    return res.json(genericOk);
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err.response?.data || err.message);
    return res.json(genericOk); // still generic
  }
});

// ----------
// --- RESET PASSWORD ---
// ----------
app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");

    if (!token) return res.status(400).json({ error: "Missing reset token." });
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    pruneTokenStore(passwordResetTokens);
    const entry = passwordResetTokens.get(hashToken(token));
    if (!entry || entry.expires < Date.now()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const client = frappeClient();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(entry.docName)}`, {
      password_hash,
    });

    // Single-use: invalidate the token after success.
    passwordResetTokens.delete(hashToken(token));

    return res.json({ ok: true, message: "Your password has been reset. You can now log in." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Could not reset password. Please try again." });
  }
});

// ----------
// --- CHANGE PASSWORD (logged in) ---
// ----------
app.post("/api/auth/change-password", requireAuth, authLimiter, async (req, res) => {
  try {
    const docName = req.session?.webAccount || req.session?.user?.id;
    if (!docName) return res.status(401).json({ error: "Not authenticated." });

    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const client = frappeClient();
    const recRes = await client.get(
      `/api/resource/Web Account/${encodeURIComponent(docName)}`,
      { params: { fields: JSON.stringify(["name", "password_hash"]) } }
    );
    const record = recRes.data?.data;
    if (!record?.password_hash) {
      return res.status(400).json({ error: "Account has no password set." });
    }

    const match = await bcrypt.compare(currentPassword, record.password_hash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect." });

    const password_hash = await bcrypt.hash(newPassword, 12);
    await client.put(`/api/resource/Web Account/${encodeURIComponent(docName)}`, {
      password_hash,
    });

    return res.json({ ok: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Could not update password." });
  }
});

// ----------
// --- VERIFY EMAIL ---
// ----------
// Best-effort: marks email_verified on the Web Account if the field exists in the
// doctype. Login is not blocked on verification to avoid locking out existing users.
app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    pruneTokenStore(emailVerifyTokens);
    const entry = token && emailVerifyTokens.get(hashToken(token));
    if (!entry || entry.expires < Date.now()) {
      return res.redirect("/login?verify=invalid");
    }

    const client = frappeClient();
    try {
      await client.put(`/api/resource/Web Account/${encodeURIComponent(entry.docName)}`, {
        email_verified: 1,
      });
    } catch (e) {
      // Field may not exist yet in the Frappe doctype; log and continue.
      console.warn("VERIFY EMAIL: could not persist email_verified:", e.response?.data || e.message);
    }

    emailVerifyTokens.delete(hashToken(token));
    return res.redirect("/login?verify=success");
  } catch (err) {
    console.error("VERIFY EMAIL ERROR:", err.response?.data || err.message);
    return res.redirect("/login?verify=invalid");
  }
});

// ------------------------
// INVOICE DELETE (SOFT)
// ------------------------
const { sendInvoiceDeletedEmail } = require("./utils/mailer");

app.post("/api/invoices/:invoiceNo/delete", requireAuth, async (req, res) => {
  try {
    const { invoiceNo } = req.params;
    const webAccountName = req.session?.user?.id || req.session?.webAccountName;

    if (!webAccountName) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const client = frappeClient();

    // Helper function to lookup in a doctype
    async function lookupDoc(doctype) {
      const response = await client.get(`/api/resource/${doctype}`, {
        params: {
          filters: JSON.stringify([["web_account", "=", webAccountName]]),
          or_filters: JSON.stringify([
            ["name", "=", invoiceNo],
            ["invoice_no", "=", invoiceNo],
          ]),
          fields: JSON.stringify([
            "name",
            "invoice_no",
            "web_account_email",
            "client_name"
          ]),
          limit_page_length: 1,
        },
      });

      return response.data?.data?.[0] || null;
    }

    // Try first doctype
    let doc = await lookupDoc("Portal Invoice");
    let doctypeUsed = "Portal Invoice";

    // If not found → try second doctype
    if (!doc) {
      doc = await lookupDoc("Test Plan Invoice");
      doctypeUsed = "Test Plan Invoice";
    }

    if (!doc) {
      return res.status(404).json({ error: "Invoice not found in any doctype." });
    }

    const now = new Date();
    const mysqlDatetime = now.toISOString().slice(0, 19).replace("T", " ");

    // Soft delete
    await client.put(
      `/api/resource/${doctypeUsed}/${encodeURIComponent(doc.name)}`,
      {
        status: "Deleted",
        deleted_at: mysqlDatetime,
        deleted_by: webAccountName,
      }
    );

    if (doc.web_account_email) {
      await sendInvoiceDeletedEmail({
        to: doc.web_account_email,
        clientName: doc.client_name || "",
        invoiceNo: doc.invoice_no || doc.name,
      });
      console.log("DELETE INVOICE:", doc.invoice_no || doc.name);
    }

    return res.json({
      ok: true,
      deleted: doc.invoice_no || doc.name,
      doctype: doctypeUsed,
    });

  } catch (err) {
    console.error("INVOICE DELETE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to delete invoice." });
  }
});

// -----------------------------
// DOWNLOAD SINGLE INVOICE (PDF)
// -----------------------------
app.get("/api/invoices/:docName/download", async (req, res) => {
  try {
    const { docName } = req.params;

    const webAccountName =
      req.session?.webAccount || req.session?.user?.id || req.session?.user?.name;

    if (!webAccountName) return res.status(401).json({ error: "Not authenticated" });

    const client = frappeClient();

    // 1) Load the exact invoice doc by docName
    const invResp = await client.get(
      `/api/resource/Portal Invoice/${encodeURIComponent(docName)}`
    );

    const inv = invResp.data?.data;
    if (!inv) return res.status(404).json({ error: "Invoice not found." });

    // 2) Ownership check
    if (inv.web_account !== webAccountName || inv.status === "Deleted") {
      return res.status(404).json({ error: "Invoice not found." });
    }

    // 3) Render PDF using the same docName
    const pdfResp = await client.get("/api/method/frappe.utils.print_format.download_pdf", {
      params: {
        doctype: "Portal Invoice",
        name: docName,
        format: "Murzak Portal Invoice",
        no_letterhead: 0,
      },
      responseType: "arraybuffer",
    });

    const filename = `${inv.invoice_no || docName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(Buffer.from(pdfResp.data));
  } catch (err) {
    console.error("INVOICE DOWNLOAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to download invoice." });
  }
});

const archiver = require("archiver");

// ------------------------------------
// DOWNLOAD ALL INVOICES (ZIP OF PDFs)
// ------------------------------------
app.get("/api/invoices/download-all", async (req, res) => {
  try {
    const webAccountName =
      req.session?.user?.id || req.session?.user?.name || req.session?.webAccountName;

    if (!webAccountName) return res.status(401).json({ error: "Not authenticated" });

    const client = frappeClient();

    // 1) Fetch all invoices for this user (exclude deleted)
    const invoicesRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["status", "!=", "Deleted"],
        ]),
        fields: JSON.stringify(["name", "invoice_no"]),
        limit_page_length: 200,
        order_by: "creation desc",
      },
    });

    const rows = invoicesRes.data?.data || [];
    if (!rows.length) return res.status(404).json({ error: "No invoices found." });

    // 2) Prepare ZIP stream
    const zipName = `invoices-${webAccountName}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (e) => {
      console.error("ZIP ERROR:", e);
      // if headers already sent, just end
      try { res.status(500).end(); } catch {}
    });

    archive.pipe(res);

    // 3) For each invoice, fetch PDF and append into ZIP
    for (const r of rows) {
      const docName = r.name;
      const invoiceNo = r.invoice_no || docName;

      const pdfResp = await client.get("/api/method/frappe.utils.print_format.download_pdf", {
        params: {
          doctype: "Portal Invoice",
          name: docName,
          format: "Murzak Portal Invoice",
          no_letterhead: 0,
        },
        responseType: "arraybuffer",
      });

      archive.append(Buffer.from(pdfResp.data), { name: `${invoiceNo}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    console.error("DOWNLOAD ALL ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to download invoices." });
  }
});

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
app.post("/api/portal/requests", requireAuth, async (req, res) => {
  try {
    const { message, pageUrl, attachments } = req.body;

    // Identity comes from the session, never the request body.
    const email = String(req.session?.user?.email || "").trim();

    if (!email || !message) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const client = frappeClient();
    const webAcc = await getWebAccountByEmail(client, email);
    const portalUserId = webAcc?.name || null;

    const payload = {
      portal_user: portalUserId,
      email: email,
      full_name: webAcc?.account_holder_name || email,
      company_name: webAcc?.entity_name || "",
      subject: "Technical Sync Request",
      status: "New",
      source: "Portal",
      last_message_at: mysqlDatetimeUTC(),
      page_url: pageUrl || "",
      messages: [
        {
          sender_type: "User",
          sender: email,
          message: message,
          attachments: attachments || "",
        },
      ],
    };

    const createResp = await client.post("/api/resource/Portal Users Requests", payload);
    return res.json({ ok: true, id: createResp.data?.data?.name });
  } catch (err) {
    console.error("PORTAL REQUEST CREATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to create request." });
  }
});

app.get("/api/portal/requests/my-thread", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    // Always the session user's own thread — ignore any query email.
    const email = String(req.session?.user?.email || "").trim();
    if (!email) return res.status(400).json({ error: "Missing email." });

    // find newest thread for user
    const listResp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([["email", "=", email]]),
        order_by: "modified desc",
        limit_page_length: 1,
      },
    });

    const rows = listResp.data?.data || [];
    if (rows.length) {
      return res.json({ ok: true, id: rows[0].name, existed: true });
    }

    // no thread yet
    return res.json({ ok: true, id: null, existed: false });
  } catch (err) {
    console.error("MY THREAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to get thread." });
  }
});

// Unread chat badge for portal user
app.get("/api/portal/requests/unread-count", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });

    const client = frappeClient();

    // Find user's email (from session user is easiest)
    const email = String(req.session?.user?.email || "").trim();
    if (!email) return res.json({ ok: true, count: 0 });

    // Pull threads for this email; only those waiting on user
    const r = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify(["name", "status", "last_message_at", "user_last_read_at"]),
        filters: JSON.stringify([
          ["email", "=", email],
          ["status", "=", "Waiting on User"],
        ]),
        order_by: "last_message_at desc",
        limit_page_length: 200,
      },
    });

    const rows = Array.isArray(r.data?.data) ? r.data.data : [];

    const count = rows.filter((t) => {
      const last = t.last_message_at ? new Date(t.last_message_at) : null;
      const read = t.user_last_read_at ? new Date(t.user_last_read_at) : null;
      if (!last) return false;
      if (!read) return true;
      return last.getTime() > read.getTime();
    }).length;

    return res.json({ ok: true, count });
  } catch (err) {
    console.error("UNREAD COUNT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch unread count." });
  }
});

// --- PORTAL USER CHAT: get thread (with messages) ---
app.get("/api/portal/requests/:id", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;

    const resp = await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`);
    const doc = resp.data?.data;
    if (!doc) return res.status(404).json({ error: "Thread not found." });

    // Authorization: only the thread owner may read it.
    const email = String(req.session?.user?.email || "").trim().toLowerCase();
    if (!email || String(doc.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({ error: "Not allowed." });
    }

    return res.json({ ok: true, data: doc });
  } catch (err) {
    console.error("PORTAL REQUEST READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load messages." });
  }
});

// --- PORTAL USER CHAT: append message (RELIABLE) ---
app.post("/api/portal/requests/:id/messages", requireAuth, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    const { message, attachments } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 1) confirm thread exists
    const current = await client.get(
      `/api/resource/Portal Users Requests/${encodeURIComponent(id)}`
    );
    const doc = current.data?.data;
    if (!doc) return res.status(404).json({ error: "Thread not found." });

    // Authorization: only the thread owner may post to it.
    const email = String(req.session?.user?.email || "").trim().toLowerCase();
    if (!email || String(doc.email || "").trim().toLowerCase() !== email) {
      return res.status(403).json({ error: "Not allowed." });
    }

    // 2) insert child row — sender identity is derived from the session,
    //    NEVER from the request body (prevents Admin impersonation).
    await client.post("/api/method/frappe.client.insert", {
      doc: {
        doctype: "Portal Users Request Messages",
        parent: id,
        parenttype: "Portal Users Requests",
        parentfield: "messages",
        sender_type: "User",
        sender: req.session.user.email,
        message,
        attachments: attachments || "",
        sent_at: mysqlDatetimeUTC(),
      },
    });

    // 3) update parent “last_message_at” safely (MySQL format)
    await client.put(
      `/api/resource/Portal Users Requests/${encodeURIComponent(id)}`,
      {
        last_message_at: mysqlDatetimeUTC(),
        status: "Waiting on Admin",
      }
    );

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("PORTAL REQUEST MSG ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to send message." });
  }
});

app.get("/api/admin/threads", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();

    const resp = await client.get("/api/resource/Portal Users Requests", {
      params: {
        fields: JSON.stringify([
          "name",
          "email",
          "full_name",
          "status",
        ]),
        order_by: "modified desc",
        limit_page_length: 100,
      },
    });

    return res.json({ ok: true, data: resp.data?.data || [] });
  } catch (err) {
    console.error("ADMIN THREADS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load threads." });
  }
});

app.get("/api/admin/threads/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;

    const resp = await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`);
    return res.json({ ok: true, data: resp.data?.data });
  } catch (err) {
    console.error("ADMIN THREAD READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load thread." });
  }
});

app.post("/api/admin/threads/:id/reply", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    const { message, attachments } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    await client.post("/api/method/frappe.client.insert", {
      doc: {
        doctype: "Portal Users Request Messages",
        parent: id,
        parenttype: "Portal Users Requests",
        parentfield: "messages",
        sender_type: "Admin",
        sender: req.session.user.email,
        message: message.trim(),
        attachments: attachments || "",
        sent_at: mysqlDatetimeUTC(),
      },
    });

    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      last_message_at: mysqlDatetimeUTC(),
      status: "Waiting on User",
    });

    const thread = (await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`)).data?.data;

    if (thread?.portal_user) {
      await logPortalUpdate(client, thread.portal_user, {
        type: "info",
        engineer: "Murzak Tech",
        content: "New message from Murzak Tech.",
        is_chat: true,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN REPLY ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to send reply." });
  }
});

app.post("/api/portal/requests/:id/mark-read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });

    const client = frappeClient();

    const doc = (await client.get(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`)).data?.data;
    if (!doc) return res.status(404).json({ error: "Thread not found." });

    // Safety: only allow marking own thread read
    const email = String(req.session?.user?.email || "").trim();
    if (!email || String(doc.email || "").trim() !== email) {
      return res.status(403).json({ error: "Not allowed." });
    }

    await client.put(`/api/resource/Portal Users Requests/${encodeURIComponent(id)}`, {
      user_last_read_at: mysqlDatetimeUTC(), // your mysql datetime helper
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("MARK READ ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to mark read." });
  }
});

// Upload files
app.post("/api/portal/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    console.log("UPLOAD HIT:", {
      hasFile: !!req.file,
      name: req.file?.originalname,
      size: req.file?.size,
      mimetype: req.file?.mimetype,
      user: req.session?.user?.email,
    });

    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const FormData = require("form-data");
    const client = frappeClient();

    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append("is_private", "1");

    const up = await client.post("/api/method/upload_file", form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const raw = up.data?.message?.file_url || "";
    const fileUrl = raw.startsWith("http") ? raw : `${process.env.FRAPPE_BASE_URL}${raw}`;

    if (!fileUrl) return res.status(500).json({ error: "Upload succeeded but no file_url returned." });

    return res.json({ ok: true, file_url: fileUrl });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Upload failed." });
  }
});

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

app.get("/api/portal/files", requireAuth, async (req, res) => {
  try {
    const fileUrl = (req.query.url || "").toString();
    if (!fileUrl) return res.status(400).send("Missing url");

    // SSRF guard: only allow relative Frappe file paths — never arbitrary
    // absolute URLs (which would let the privileged token hit internal/external
    // hosts) and never path-traversal. Files live under /files or /private/files.
    let pathOnly = fileUrl;
    try {
      // If a full URL slipped in, keep only its path and validate the host.
      if (/^https?:\/\//i.test(fileUrl)) {
        const u = new URL(fileUrl);
        const baseHost = new URL(process.env.FRAPPE_BASE_URL).host;
        if (u.host !== baseHost) return res.status(400).send("Invalid file url");
        pathOnly = u.pathname;
      }
    } catch {
      return res.status(400).send("Invalid file url");
    }

    if (
      !/^\/(private\/files|files)\//.test(pathOnly) ||
      pathOnly.includes("..")
    ) {
      return res.status(400).send("Invalid file path");
    }

    const client = frappeClient();

    // Object-level authz: private files must belong to the session user.
    // Public /files/ are world-readable in Frappe, so no check is needed there.
    if (pathOnly.startsWith("/private/files/")) {
      const allowed = await userOwnsPrivateFile(client, pathOnly, req.session);
      if (!allowed) return res.status(403).send("Not allowed");
    }

    const target = `${process.env.FRAPPE_BASE_URL}${pathOnly}`;

    const r = await client.get(target, { responseType: "stream" });

    // pass through content type + force download if you want
    res.setHeader("Content-Type", r.headers["content-type"] || "application/octet-stream");
    if (r.headers["content-disposition"]) res.setHeader("Content-Disposition", r.headers["content-disposition"]);

    r.data.pipe(res);
  } catch (e) {
    console.error("FILE PROXY ERROR:", e.response?.data || e.message);
    res.status(500).send("Failed to fetch file");
  }
});

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
    timestamp: u.creation || u.created_at || mysqlDatetimeEAT(),
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

app.get("/api/portal/updates", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "No session account." });

    const client = frappeClient();

    const r = await client.get("/api/resource/Portal Update", {
      params: {
        filters: JSON.stringify([
          ["web_account", "=", webAccountName],
          ["is_deleted", "=", 0], // ✅ requires custom field
        ]),
        fields: JSON.stringify([
          "name",
          "type",
          "engineer",
          "content",
          "acknowledged",
          "created_at",
          "is_chat",
        ]),
        order_by: "created_at desc",
        limit_page_length: 200,
      },
    });

    const rows = Array.isArray(r.data?.data) ? r.data.data : [];

    const updates = rows.map((u) => ({
      id: u.name,
      type: u.type || "info",
      engineer: u.engineer || "Murzak Tech",
      content: u.content || "",
      acknowledged: !!u.acknowledged,
      timestamp: u.creation || u.created_at || mysqlDatetimeUTC(),
      is_chat: !!u.is_chat,
    }));

    return res.json({ ok: true, updates });
  } catch (err) {
    console.error("FETCH UPDATES ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load updates." });
  }
});

app.post("/api/portal/updates/ack", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const { id } = req.body || {};
    if (!webAccountName) return res.status(401).json({ error: "No session account." });
    if (!id) return res.status(400).json({ error: "Missing id." });

    const client = frappeClient();
    const doc = (await client.get(`/api/resource/Portal Update/${encodeURIComponent(id)}`)).data?.data;
    if (!doc || doc.web_account !== webAccountName) return res.status(403).json({ error: "Not allowed." });

    await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, { acknowledged: 1 });
    return res.json({ ok: true });
  } catch (err) {
    console.error("ACK UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to acknowledge update." });
  }
});

app.post("/api/portal/updates/delete", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const { id } = req.body || {};
    if (!webAccountName) return res.status(401).json({ error: "No session account." });
    if (!id) return res.status(400).json({ error: "Missing id." });

    const client = frappeClient();

    const doc = (await client.get(`/api/resource/Portal Update/${encodeURIComponent(id)}`)).data?.data;
    if (!doc || doc.web_account !== webAccountName) return res.status(403).json({ error: "Not allowed." });

    await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, {
      is_deleted: 1,
      status: "Deleted",
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to delete update." });
  }
});

app.post("/api/portal/updates/bulk-delete", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    const { ids } = req.body || {};

    if (!webAccountName) return res.status(401).json({ error: "No session account." });
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids." });
    }

    const client = frappeClient();

    let deleted = 0;
    let skipped = 0;

    for (const idRaw of ids) {
      const id = String(idRaw || "").trim();
      if (!id) continue;

      // Safety: ensure update belongs to this user before mutating
      const docRes = await client.get(
        `/api/resource/Portal Update/${encodeURIComponent(id)}`
      );
      const doc = docRes.data?.data;

      if (!doc || doc.web_account !== webAccountName) {
        skipped++;
        continue;
      }

      await client.put(`/api/resource/Portal Update/${encodeURIComponent(id)}`, {
        is_deleted: 1,
        status: "Deleted",
      });

      deleted++;
    }

    return res.json({ ok: true, deleted, skipped });
  } catch (err) {
    console.error("BULK DELETE UPDATE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to bulk delete updates." });
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
    provider: row.provider || "Hostinger",
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
    provider: row.provider || null,
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


app.get("/api/hosting/dashboard", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);

    const site = await fetchHostingSite(client, webAccountName);
    const activeSite = await fetchHostingSite(client, webAccountName);
    const registerNewDomainRequests = await fetchHostingDomainPurchaseRequests(client, webAccountName);
    const murzakSubdomains = await fetchHostingMurzakSubdomains(client, webAccountName);
    const externalDomains = await fetchHostingExternalDomains(client, webAccountName);
    const requests = await fetchHostingSupportRequests(client, webAccountName);

    let files = [];
    let deployments = [];
    let activity = [];

    if (activeSite?.id) {
      await recalculateHostingStorageUsage(client, activeSite.id);
      await ensureHostingSiteStorageAllocation(client, activeSite.id, {
        tier: activeSite.tier || svc.tier || "",
        planName: activeSite.planName || svc.serviceName || "",
      });

    await recalculateHostingStorageUsage(client, activeSite.id);
    const refreshedSite = await fetchHostingSite(client, webAccountName);

      files = await fetchHostingFiles(client, webAccountName, activeSite.id);
      deployments = await fetchHostingDeployments(client, webAccountName, activeSite.id);
      activity = await fetchHostingActivity(client, webAccountName, activeSite.id);

      return res.json({
        ok: true,
        payload: {
          service: {
            serviceId: svc.serviceId,
            serviceName: svc.serviceName || "Website Hosting",
            tier: svc.tier || "Medium",
            status: "active",
            domainChoice: svc.domainChoice || null,
          },
          hostingStatus: refreshedSite?.status || "pending",
          activeSite: refreshedSite,
          registerNewDomainRequests,
          murzakSubdomains: await fetchHostingSubdomains(client, webAccountName, activeSite.id),
          externalDomains,
          requests,
          files,
          deployments,
          activity,
        },
      });
    }

    return res.json({
      ok: true,
      payload: {
        service: {
          serviceId: svc.serviceId,
          serviceName: svc.serviceName || "Website Hosting",
          tier: svc.tier || "Medium",
          status: "active",
          domainChoice: svc.domainChoice || null,
        },
        hostingStatus: site?.status || "pending",
        activeSite: site,
        registerNewDomainRequests,
        murzakSubdomains,
        externalDomains,
        requests,
        files: [],
        deployments: [],
        activity: [],
      },
    });
  } catch (err) {
    console.error("HOSTING DASHBOARD ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to load hosting dashboard.",
    });
  }
});

app.post("/api/hosting/domain-purchase-requests", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { requestedName, requestedTld, notes } = req.body || {};

    const cleanName = String(requestedName || "").trim().toLowerCase();
    const cleanTld = String(requestedTld || "").trim().toLowerCase();
    const fullDomain = `${cleanName}${cleanTld}`;

    if (!cleanName) return res.status(400).json({ error: "Domain name is required." });
    if (!cleanTld.startsWith(".")) return res.status(400).json({ error: "Invalid TLD." });

    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);

    if (String(svc.domainChoice || "").trim() !== "Register New Domain") {
      return res.status(400).json({ error: "Your hosting service is not configured for Register New Domain." });
    }

    const created = await client.post("/api/resource/Hosting Domain Purchase Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_name: cleanName,
      requested_tld: cleanTld,
      full_domain: fullDomain,
      status: "pending",
      provider: "Hostinger",
      notes: String(notes || "").trim(),
      is_primary: 1,
    });

    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "domain",
      primaryHost: fullDomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for domain purchase request: ${fullDomain}`,
    });    

    return res.json({ ok: true, request: created.data?.data || null });
  } catch (err) {
    console.error("DOMAIN PURCHASE REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit domain request." });
  }
});

app.post("/api/hosting/murzak-subdomains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { requestedLabel, targetType, targetValue, notes } = req.body || {};

    const cleanLabel = String(requestedLabel || "").trim().toLowerCase();
    if (!cleanLabel) return res.status(400).json({ error: "Subdomain label is required." });

    const fullSubdomain = `${cleanLabel}.murzaktech.com`;

    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);

    if (String(svc.domainChoice || "").trim() !== "Use Murzak Subdomain") {
      return res.status(400).json({ error: "Your hosting service is not configured for Use Murzak Subdomain." });
    }

    const created = await client.post("/api/resource/Hosting Murzak Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_label: cleanLabel,
      full_subdomain: fullSubdomain,
      status: "pending",
      target_type: String(targetType || "folder").trim(),
      target_value: String(targetValue || "").trim(),
      notes: String(notes || "").trim(),
      is_primary: 1,
    });

    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "murzak_subdomain",
      primaryHost: fullSubdomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for Murzak subdomain request: ${fullSubdomain}`,
    });    

    return res.json({ ok: true, subdomain: created.data?.data || null });
  } catch (err) {
    console.error("MURZAK SUBDOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit subdomain request." });
  }
});

app.post("/api/hosting/external-domains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { domainName, registrar, notes } = req.body || {};

    const cleanDomain = String(domainName || "").trim().toLowerCase();
    if (!cleanDomain) return res.status(400).json({ error: "Domain name is required." });

    const client = frappeClient();
    const svc = await getActiveHostingServiceForUser(client, webAccountName);

    if (String(svc.domainChoice || "").trim() !== "Bring My Domain") {
      return res.status(400).json({ error: "Your hosting service is not configured for Bring My Domain." });
    }

    const created = await client.post("/api/resource/Hosting External Domain Connection", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      domain_name: cleanDomain,
      registrar: String(registrar || "").trim(),
      status: "pending",
      verification_notes: String(notes || "").trim(),
      is_primary: 1,
    });

    await ensurePendingHostingSiteForRequest(client, {
      webAccountName,
      siteType: "external_domain",
      primaryHost: cleanDomain,
      serviceTier: svc.tier || "Medium",
      planName: svc.serviceName || "Website Hosting",
      storageLimitMb: 1024,
      notes: `Pending hosting site created for external domain connection: ${cleanDomain}`,
    });

    return res.json({ ok: true, externalDomain: created.data?.data || null });
  } catch (err) {
    console.error("EXTERNAL DOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit domain connection request." });
  }
});

app.post("/api/hosting/subdomains", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { subdomainLabel, parentHost, targetType, targetValue, notes } = req.body || {};

    const cleanLabel = String(subdomainLabel || "").trim().toLowerCase();
    const cleanParent = String(parentHost || "").trim().toLowerCase();

    if (!cleanLabel) return res.status(400).json({ error: "Subdomain label is required." });
    if (!cleanParent) return res.status(400).json({ error: "Parent host is required." });

    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);

    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({ error: "Hosting site is not active yet." });
    }

    const fullSubdomain = `${cleanLabel}.${cleanParent}`;

    const created = await client.post("/api/resource/Hosting Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      parent_host: cleanParent,
      subdomain_label: cleanLabel,
      full_subdomain: fullSubdomain,
      target_type: String(targetType || "folder").trim(),
      target_value: String(targetValue || "").trim(),
      status: "pending",
      notes: String(notes || "").trim(),
    });

    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "subdomain_requested",
      title: "Subdomain request submitted",
      description: fullSubdomain,
    });

    return res.json({
      ok: true,
      subdomain: created.data?.data || null,
    });
  } catch (err) {
    console.error("HOSTING SUBDOMAIN ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to create subdomain request.",
    });
  }
});

app.post("/api/hosting/domains/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { requestedName, requestedTld, requestType, notes } = req.body || {};

    const cleanName = String(requestedName || "").trim().toLowerCase();
    const cleanTld = String(requestedTld || "").trim().toLowerCase();
    const cleanType = String(requestType || "register").trim();

    if (!cleanName) return res.status(400).json({ error: "Domain name is required." });
    if (!cleanTld.startsWith(".")) return res.status(400).json({ error: "Invalid domain extension." });

    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);

    const domains = await fetchHostingDomains(client, webAccountName);
    const domainRequests = await fetchHostingDomainRequests(client, webAccountName);
    const entitlement = computeIncludedDomainEntitlement(domains, domainRequests);

    const fullDomain = `${cleanName}${cleanTld}`;
    const isIncluded = entitlement.canRequestIncludedDomain;
    const requiresPayment = !isIncluded;

    const created = await client.post("/api/resource/Hosting Domain Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      requested_name: cleanName,
      requested_tld: cleanTld,
      full_domain: fullDomain,
      request_type: cleanType,
      is_included: isIncluded ? 1 : 0,
      requires_payment: requiresPayment ? 1 : 0,
      status: requiresPayment ? "awaiting_payment" : "pending",
      notes: String(notes || "").trim(),
    });

    return res.json({
      ok: true,
      request: created.data?.data || null,
      message: isIncluded
        ? "Included domain request submitted."
        : "Additional domain request submitted. Payment may be required before activation.",
    });
  } catch (err) {
    console.error("DOMAIN REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit domain request." });
  }
});

app.post("/api/hosting/subdomains/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { parentDomain, subdomainPrefix, targetType, targetValue } = req.body || {};

    const cleanParent = String(parentDomain || "").trim().toLowerCase();
    const cleanPrefix = String(subdomainPrefix || "").trim().toLowerCase();
    const cleanTargetType = String(targetType || "folder").trim().toLowerCase();
    const cleanTargetValue = String(targetValue || "").trim();

    if (!cleanParent) return res.status(400).json({ error: "Parent domain is required." });
    if (!cleanPrefix) return res.status(400).json({ error: "Subdomain prefix is required." });

    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);

    const fullSubdomain = `${cleanPrefix}.${cleanParent}`;

    const created = await client.post("/api/resource/Hosting Subdomain", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      parent_domain: cleanParent,
      subdomain_prefix: cleanPrefix,
      full_subdomain: fullSubdomain,
      target_type: cleanTargetType,
      target_value: cleanTargetValue,
      status: "pending",
    });

    return res.json({
      ok: true,
      subdomain: created.data?.data || null,
      message: "Subdomain request submitted.",
    });
  } catch (err) {
    console.error("SUBDOMAIN REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit subdomain request." });
  }
});

app.post("/api/hosting/requests", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { category, title, description } = req.body || {};

    const cleanCategory = String(category || "support").trim();
    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();

    if (!cleanTitle) return res.status(400).json({ error: "Title is required." });
    if (!cleanDescription) return res.status(400).json({ error: "Description is required." });

    const client = frappeClient();
    await ensureUserOwnsHostingService(client, webAccountName);

    const created = await client.post("/api/resource/Hosting Support Request", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      category: cleanCategory,
      title: cleanTitle,
      description: cleanDescription,
      status: "open",
    });

    return res.json({
      ok: true,
      request: created.data?.data || null,
      message: "Support request submitted.",
    });
  } catch (err) {
    console.error("HOSTING REQUEST ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to submit request." });
  }
});


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


app.post("/api/hosting/files/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const { uploadCategory = "deployment", notes = "" } = req.body || {};

    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);

    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({ error: "Hosting site is not active yet." });
    }

    const fileSizeMb = Number((req.file.size / (1024 * 1024)).toFixed(2));
    const currentUsed = Number(activeSite.storageUsedMb || 0);
    const limit = Number(activeSite.storageLimitMb || 0);

    if (limit > 0 && currentUsed + fileSizeMb > limit) {
      return res.status(400).json({ error: "Storage full. Upload exceeds your hosting allocation." });
    }

    const dir = buildHostingUploadDir(webAccountName, activeSite.id);
    await fsp.mkdir(dir, { recursive: true });

    const safeName = `${Date.now()}_${ensureSafeFileName(req.file.originalname)}`;
    const relativePath = buildHostingRelativePath(webAccountName, activeSite.id, safeName);
    const absPath = buildHostingAbsolutePath(relativePath);

    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, req.file.buffer);

    const created = await client.post("/api/resource/Hosting File", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      file_name: req.file.originalname,
      file_path: relativePath,
      file_size_mb: fileSizeMb,
      file_type: req.file.mimetype || "",
      upload_category: String(uploadCategory || "deployment").trim(),
      status: "uploaded",
      is_active_build: 0,
      notes: String(notes || "").trim(),
    });

    const updatedUsage = await recalculateHostingStorageUsage(client, activeSite.id);

    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "file_uploaded",
      title: "File uploaded",
      description: `${req.file.originalname} uploaded successfully.`,
    });

    return res.json({
      ok: true,
      file: created.data?.data || null,
      storageUsedMb: updatedUsage,
    });
  } catch (err) {
    console.error("HOSTING FILE UPLOAD ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to upload file.",
    });
  }
});

app.post("/api/hosting/deployments/request", requireAuth, async (req, res) => {
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id;
    if (!webAccountName) return res.status(401).json({ error: "Not authenticated." });

    const { sourceFile = "", deploymentType = "manual", notes = "" } = req.body || {};

    const client = frappeClient();
    await getActiveHostingServiceForUser(client, webAccountName);

    const activeSite = await fetchHostingSite(client, webAccountName);
    if (!activeSite || activeSite.status !== "active") {
      return res.status(400).json({ error: "Hosting site is not active yet." });
    }

    const created = await client.post("/api/resource/Hosting Deployment", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      source_file: String(sourceFile || "").trim(),
      deployment_type: String(deploymentType || "manual").trim(),
      status: "pending",
      target_path: activeSite.documentRoot || "",
      notes: String(notes || "").trim(),
    });

    await client.post("/api/resource/Hosting Activity Log", {
      web_account: webAccountName,
      service_id: HOSTING_SERVICE_ID,
      hosting_site: activeSite.id,
      event_type: "deployment_requested",
      title: "Deployment requested",
      description: sourceFile
        ? `Deployment requested using ${sourceFile}`
        : "Deployment requested.",
    });

    return res.json({
      ok: true,
      deployment: created.data?.data || null,
    });
  } catch (err) {
    console.error("HOSTING DEPLOYMENT ERROR:", err.response?.data || err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to request deployment.",
    });
  }
});

// --- LOGOUT ---
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

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

// --- ME (session check) ---
app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, user: null });
  }
  res.json({ ok: true, user: req.session.user });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const webAccountName =
      req.session?.webAccount ||
      req.session?.user?.id ||
      req.session?.user?.name;

    if (!webAccountName) {
      return res.status(401).json({ ok: false });
    }

    const client = frappeClient();

    const recordRes = await client.get(
      `/api/resource/Web Account/${encodeURIComponent(webAccountName)}`
    );

    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);

    const user = buildUserPayload({
      record: recordRes.data.data,
      invoices,
      selectedServices,
    });

    // keep session fresh
    req.session.user = user;
    req.session.webAccount = webAccountName;

    return res.json({ ok: true, user });
  } catch (err) {
    console.error("AUTH ME ERROR:", err.response?.data || err.message);
    return res.status(401).json({ ok: false });
  }
});

// ---- Provisioning (admin) ----
// List provisioning jobs, optionally filtered by status.
app.get("/api/admin/provisioning/jobs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { status } = req.query;
    const filters = status ? [["status", "=", String(status)]] : [];
    const resp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify(filters),
        fields: JSON.stringify([
          "name", "web_account", "invoice", "service_id", "service_name",
          "category", "lane", "status", "attempts", "ram_mb", "gated",
          "external_ref", "error", "next_run_at", "modified",
        ]),
        order_by: "modified desc",
        limit_page_length: 200,
      },
    });
    return res.json({ ok: true, data: resp.data?.data || [] });
  } catch (err) {
    console.error("ADMIN PROVISIONING LIST ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load provisioning jobs." });
  }
});

// Trigger a single runner pass on demand (does nothing the loop wouldn't, but
// lets an admin push the queue without waiting for the interval).
app.post("/api/admin/provisioning/run", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await provisioningRunner.processQueue(frappeClient());
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("ADMIN PROVISIONING RUN ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to run provisioning queue." });
  }
});

// Re-queue a failed / needs_human job for another runner attempt.
app.post("/api/admin/provisioning/jobs/:id/retry", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const { id } = req.params;
    await client.put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(id)}`, {
      status: "queued",
      attempts: 0,
      next_run_at: null,
      error: "",
    });
    return res.json({ ok: true, name: id });
  } catch (err) {
    console.error("ADMIN PROVISIONING RETRY ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to re-queue job." });
  }
});

// Capacity overview: targets + per-target reserved RAM + open scale-out requests.
app.get("/api/admin/provisioning/capacity", requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = frappeClient();
    const reserved = await provisioningTargets.reservedByTarget(client);
    const targetsView = provisioningTargets.listTargets().map((t) => ({
      id: t.id,
      status: t.status,
      sellableRamMb: t.sellableRamMb,
      reservedRamMb: reserved[t.id] || 0,
      limitRamMb: provisioningTargets.targetLimitMb(t),
    }));
    let requests = [];
    try {
      const r = await client.get(`/api/resource/${encodeURIComponent(CAPACITY_REQUEST_DOCTYPE)}`, {
        params: {
          fields: JSON.stringify(["name", "status", "requested_ram_mb", "reason", "autoscale", "modified"]),
          order_by: "modified desc",
          limit_page_length: 50,
        },
      });
      requests = r.data?.data || [];
    } catch {
      /* Capacity Request doctype may not be installed yet */
    }
    return res.json({ ok: true, targets: targetsView, requests });
  } catch (err) {
    console.error("ADMIN CAPACITY ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to load capacity overview." });
  }
});

// Go-live readiness checklist (what's configured after adding env vars).
app.get("/api/admin/provisioning/readiness", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getReadiness } = require("./services/provisioning/readiness");
    const result = await getReadiness(frappeClient());
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("ADMIN READINESS ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to compute readiness." });
  }
});

// Dispatcher health: mode (poll/bullmq/off) and, in bullmq mode, queue counts.
app.get("/api/admin/provisioning/queue", requireAuth, requireAdmin, async (req, res) => {
  try {
    const h = await provisioningQueue.health();
    return res.json({ ok: true, ...h });
  } catch (err) {
    console.error("ADMIN QUEUE HEALTH ERROR:", err.message);
    return res.status(500).json({ error: "Failed to read queue health." });
  }
});

// ---- Frontend Routes (SPA fallback) ----
// Important: This must be AFTER API routes.
// Any route not matched above will return the React app.
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
