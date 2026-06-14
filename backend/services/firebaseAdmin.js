// services/firebaseAdmin.js
// Server-side verification of Firebase ID tokens for "Continue with Google".
//
// Firebase Auth is used ONLY as an identity provider: the browser does the
// Google sign-in popup and hands us a signed ID token. We verify that token
// here with the Admin SDK, then map the verified email onto our existing
// Frappe Web Account + Express session — Frappe stays the source of truth.
//
// Env-guarded: with no FIREBASE_SERVICE_ACCOUNT configured the module is inert
// (isConfigured() === false) and the /api/auth/google route 503s cleanly
// instead of crashing boot. The service account JSON is a BACKEND SECRET — keep
// it out of the client bundle and out of git.

let admin = null;
let initError = null;
let initialized = false;

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return null;
  try {
    // Accept either raw JSON or base64-encoded JSON (handy for some env stores).
    const text = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(text);
  } catch (e) {
    initError = `FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${e.message}`;
    return null;
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    if (!initError) initError = "FIREBASE_SERVICE_ACCOUNT not set.";
    return;
  }

  try {
    // Require lazily so the dependency is only touched when configured.
    const firebaseAdmin = require("firebase-admin");
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
      });
    }
    admin = firebaseAdmin;
    initError = null;
  } catch (e) {
    initError = `firebase-admin init failed: ${e.message}`;
    admin = null;
  }
}

function isConfigured() {
  init();
  return !!admin;
}

function configError() {
  init();
  return initError;
}

/**
 * Verify a Firebase ID token. Resolves to the decoded token (uid, email,
 * email_verified, name, ...) or throws a tagged error for the caller to map to
 * a 401/503.
 */
async function verifyIdToken(idToken) {
  init();
  if (!admin) {
    const err = new Error(initError || "Firebase is not configured on the server.");
    err.code = "firebase_unconfigured";
    throw err;
  }
  if (!idToken || typeof idToken !== "string") {
    const err = new Error("Missing ID token.");
    err.code = "missing_token";
    throw err;
  }
  // checkRevoked=true so a disabled/revoked account can't keep signing in.
  return admin.auth().verifyIdToken(idToken, true);
}

module.exports = { isConfigured, configError, verifyIdToken };
