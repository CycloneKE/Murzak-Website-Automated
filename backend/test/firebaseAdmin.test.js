/**
 * services/firebaseAdmin.js against the REAL firebase-admin SDK (no stubs).
 *   node test/firebaseAdmin.test.js
 *
 * The service was written against the old namespaced API
 * (`require("firebase-admin").apps / .credential / .auth()`). In firebase-admin
 * 14.x the root export only carries the modular functions, so init threw
 * "Cannot read properties of undefined (reading 'length')", initError was set,
 * and /api/auth/google answered 503 whenever FIREBASE_SERVICE_ACCOUNT was set.
 * test/authRoutes.test.js stubs the whole module, so nothing caught it.
 *
 * Nothing here talks to a real Firebase project: the service account is built
 * from a throwaway RSA key and project_id "demo-murzak". The forged-token case
 * may try to fetch Google's public keys; offline that fails, and either way
 * the token must be REJECTED, never accepted.
 */
const crypto = require("crypto");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const PROJECT_ID = "demo-murzak";

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function makeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  return {
    pem,
    json: {
      type: "service_account",
      project_id: PROJECT_ID,
      private_key_id: "test-key-id",
      private_key: pem,
      client_email: `firebase-adminsdk-test@${PROJECT_ID}.iam.gserviceaccount.com`,
      client_id: "1234567890",
    },
  };
}

// A well-formed Firebase-style ID token (RS256, kid, correct aud/iss/sub/times)
// signed with a key Google has never heard of. The SDK must never accept it.
function forgeIdToken(pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "forged-kid" };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: "forged-uid",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    email: "attacker@example.com",
    email_verified: true,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), pem);
  return `${signingInput}.${b64url(signature)}`;
}

async function rejection(promise) {
  try {
    const value = await promise;
    return { accepted: true, value };
  } catch (err) {
    return { accepted: false, err };
  }
}

(async () => {
  const { pem, json } = makeServiceAccount();
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(json);

  // Required after the env var is set; the module initialises lazily on first use.
  const firebaseAdmin = require("../services/firebaseAdmin");

  section("init succeeds with the real SDK");
  {
    ok(firebaseAdmin.isConfigured() === true, "isConfigured() is true for a valid service account");
    ok(firebaseAdmin.configError() === null, `configError() is null (got ${JSON.stringify(firebaseAdmin.configError())})`);
  }

  section("init is idempotent (reuses the existing app)");
  {
    ok(firebaseAdmin.isConfigured() === true, "second isConfigured() call still true");
    const { getApps } = require("firebase-admin/app");
    ok(getApps().length === 1, "exactly one Firebase app is registered");
  }

  section("verifyIdToken: empty token");
  {
    const r = await rejection(firebaseAdmin.verifyIdToken(""));
    ok(!r.accepted, "empty token is rejected");
    ok(r.err && r.err.code === "missing_token", `error code is missing_token (got ${r.err && r.err.code})`);
  }

  section("verifyIdToken: malformed token");
  {
    const r = await rejection(firebaseAdmin.verifyIdToken("not-a-jwt"));
    ok(!r.accepted, "malformed token is rejected");
    ok(
      r.err && (r.err.code === "auth/argument-error" || /argument-error/.test(String(r.err.code))),
      `error is an auth/argument-error (got ${r.err && r.err.code})`
    );
  }

  section("verifyIdToken: well-formed JWT signed with our own key");
  {
    const r = await rejection(firebaseAdmin.verifyIdToken(forgeIdToken(pem)));
    ok(!r.accepted, "forged token is never accepted");
    ok(r.err instanceof Error, `rejection is an Error (got ${r.err && r.err.code})`);
    ok(
      r.err && r.err.code !== "firebase_unconfigured" && r.err.code !== "missing_token",
      "rejection comes from the SDK's token check, not from our own guards"
    );
  }

  section("unconfigured service stays inert and reports firebase_unconfigured");
  {
    // Fresh module instance with no service account configured.
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const resolved = require.resolve("../services/firebaseAdmin");
    delete require.cache[resolved];
    const unconfigured = require("../services/firebaseAdmin");
    ok(unconfigured.isConfigured() === false, "isConfigured() is false with no env");
    ok(/not set/i.test(String(unconfigured.configError())), "configError() explains it is not set");
    const r = await rejection(unconfigured.verifyIdToken("anything"));
    ok(!r.accepted && r.err.code === "firebase_unconfigured", "verifyIdToken rejects with firebase_unconfigured");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  // The SDK may keep sockets/timers open after a failed key fetch; exit explicitly.
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
