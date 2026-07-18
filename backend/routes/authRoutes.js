
const express = require('express');

module.exports = function(ctx) {
  const { 
    WEB_ACCOUNT_SERVICES_FIELD,
    appBaseUrl,
    applyPlanAndCreateInvoice,
    assertOrderWithinCapacity,
    assertWithinPlanLimit,
    authLimiter,
    bcrypt,
    buildUserPayload,
    buildWebAccountServiceRows,
    crypto,
    emailVerifyTokens,
    fetchInvoicesForUser,
    fetchSelectedServicesForUser,
    firebaseAdmin,
    frappeClient,
    hashToken,
    isValidEmail,
    loginThrottle,
    normalizeSelectedServices,
    passwordResetTokens,
    pruneTokenStore,
    requireAuth,
    sendPasswordResetEmail,
    sendVerificationEmail,
    setupTrialVerification 
  } = ctx;

  const router = express.Router();

// -------------

// --- REGISTER ---
// -------------
router.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = req.body.name ?? req.body.accountHolderName;
    const company = req.body.company ?? req.body.entityName;
    const emailRaw = req.body.email ?? req.body.workEmail;
    const password = req.body.password;
    const purpose = req.body.purpose ?? "";
    const sourceCode = req.body.sourceCode ?? "";
    const email = (emailRaw || "").toLowerCase().trim();
    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Please enter a valid email address."
      });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters."
      });
    }
    const sessionPlan = req.session.pendingPlan;
    const bodyPlan = req.body.plan ?? "None";
    let resolvedPlan = sessionPlan || bodyPlan || "None";
    const bodyServices = normalizeSelectedServices(req.body.selectedServices);
    const sessionServices = normalizeSelectedServices(req.session.pendingServices);
    const resolvedServices = bodyServices.length ? bodyServices : sessionServices;
    if (!name || !company || !email || !password) {
      return res.status(400).json({
        error: "Missing required fields."
      });
    }
    assertWithinPlanLimit(resolvedPlan, resolvedServices);
    assertOrderWithinCapacity(resolvedServices);
    const client = frappeClient();

    // --- Claim Test Plan Invoice by email (1 email = 1 trial) ---
    const trialLookup = await client.get("/api/resource/Test Plan Invoice", {
      params: {
        filters: JSON.stringify([["web_account_email", "=", email], ["status", "in", ["New", "Trial Pending", "Active"]]]),
        fields: JSON.stringify(["name", "status"]),
        limit_page_length: 1,
        order_by: "modified desc"
      }
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
        limit_page_length: 1
      }
    });
    if (query.data?.data?.length) {
      return res.status(409).json({
        error: "Email already in use."
      });
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
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(resolvedServices.map(s => ({
          ...s,
          status: s.status || "Awaiting Payment"
        })))
      });
    } catch (e) {
      const dup = e?.response?.status === 409 || /duplicate|already exists|unique/i.test(`${e?.response?.data?.exception || e?.response?.data?._error_message || e?.message || ""}`);
      if (dup) return res.status(409).json({
        error: "Email already in use."
      });
      throw e;
    }
    const docName = createResp.data?.data?.name;
    if (!docName) {
      return res.status(500).json({
        error: "Registration failed: missing doc id."
      });
    }

    // If a trial existed, link it to this Web Account (optional but recommended)
    if (existingTrial?.name) {
      await client.put(`/api/resource/Test Plan Invoice/${existingTrial.name}`, {
        web_account: docName,
        status: "Trial Pending" // keep pending until activation, or set "Active" if you activate instantly
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
      account_status: "Active"
    };
    const userPayload = buildUserPayload({
      record,
      planOverride: resolvedPlan,
      invoices,
      selectedServices
    });
    // Regenerate session to ensure a cookie is sent (just like login)
    return req.session.regenerate(regenErr => {
      if (regenErr) {
        console.error("REGISTER SESSION REGEN ERROR:", regenErr);
      }
      req.session.user = userPayload;
      req.session.webAccount = userPayload.id;
      req.session.pendingPlan = null;
      req.session.pendingServices = null;

      req.session.save(saveErr => {
        if (saveErr) console.error("REGISTER SESSION SAVE ERROR:", saveErr);

        // Send email verification link (best-effort, non-blocking).
        try {
          pruneTokenStore(emailVerifyTokens);
          const vToken = crypto.randomBytes(32).toString("hex");
          emailVerifyTokens.set(hashToken(vToken), {
            docName,
            email,
            expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
          });
          const verifyUrl = `${appBaseUrl(req)}/api/auth/verify-email?token=${vToken}`;
          sendVerificationEmail({
            to: email,
            clientName: name,
            verifyUrl
          }).catch(mailErr => console.error("REGISTER VERIFY EMAIL ERROR:", mailErr.message));
        } catch (mailErr) {
          console.error("REGISTER VERIFY EMAIL SETUP ERROR:", mailErr.message);
        }

        return res.json({
          ok: true,
          id: docName,
          user: userPayload
        });
      });
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err.response?.data || err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: status >= 500 ? "Registration failed." : err.message
    });
  }
});

// ----------
// --- LOGIN ---
// ----------
router.post("/api/login", authLimiter, async (req, res) => {
  try {
    const emailRaw = req.body.email;
    const password = req.body.password;
    const email = (emailRaw || "").toLowerCase().trim();
    if (!email || !password) return res.status(400).json({
      error: "Missing email or password."
    });

    // Account-keyed brute-force lockout (defends against IP-rotating attacks
    // that spread guesses across many IPs against one account).
    const lock = await loginThrottle.check(email);
    if (lock.locked) {
      res.set("Retry-After", String(lock.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many failed attempts for this account. Please try again later or reset your password."
      });
    }
    const client = frappeClient();

    // Find account by email FIRST
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify(["name", "work_email", "password_hash", "account_holder_name", "entity_name", "purpose", "source_code", "plan", "account_status", WEB_ACCOUNT_SERVICES_FIELD]),
        limit_page_length: 1
      }
    });
    const record = query.data?.data?.[0];
    if (!record) {
      await loginThrottle.recordFailure(email);
      return res.status(401).json({
        error: "Login failed. Please check your credentials."
      });
    }
    const match = record.password_hash ? await bcrypt.compare(password, record.password_hash) : false;
    if (!match) {
      await loginThrottle.recordFailure(email);
      return res.status(401).json({
        error: "Login failed. Please check your credentials."
      });
    }

    // Successful credential check — clear the failure counter.
    await loginThrottle.reset(email);
    const docName = record.name;

    // --- Claim Test Plan on login (safety net) AFTER record exists---
    try {
      const emailNorm = (email || "").trim().toLowerCase();
      const trialLookup = await client.get("/api/resource/Test Plan Invoice", {
        params: {
          filters: JSON.stringify([["web_account_email", "=", emailNorm], ["status", "in", ["New", "Trial Pending", "Active"]]]),
          fields: JSON.stringify(["name", "status", "web_account"]),
          limit_page_length: 1,
          order_by: "modified desc"
        }
      });
      const existingTrial = trialLookup.data?.data?.[0];
      if (existingTrial?.name) {
        // Update account plan if needed
        if (record.plan !== "Test") {
          await client.put(`/api/resource/Web Account/${docName}`, {
            plan: "Test"
          });
          record.plan = "Test"; // keep your in-memory record consistent for payload
        }

        // Link trial -> account if not linked
        if (!existingTrial.web_account) {
          await client.put(`/api/resource/Test Plan Invoice/${existingTrial.name}`, {
            web_account: docName
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
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(pendingServices.map(s => ({
          ...s,
          status: "Awaiting Payment"
        }))),
        account_status: record.account_status || "Active"
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
        plan: planOverride || record.plan
      },
      planOverride: planOverride || null,
      invoices,
      selectedServices
    });

    // Regenerate the session ID on privilege change to prevent session fixation.
    return req.session.regenerate(regenErr => {
      if (regenErr) {
        console.error("LOGIN SESSION REGEN ERROR:", regenErr);
        return res.status(500).json({
          error: "Login failed."
        });
      }
      req.session.user = userPayload;
      req.session.webAccount = userPayload.id;
      req.session.save(saveErr => {
        if (saveErr) {
          console.error("LOGIN SESSION SAVE ERROR:", saveErr);
          return res.status(500).json({
            error: "Login failed."
          });
        }
        return res.json({
          ok: true,
          user: userPayload
        });
      });
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Login failed."
    });
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

// ----------
// --- GOOGLE SIGN-IN ---
// ----------
// The browser performs the Google popup (Firebase Auth) and sends us the signed
// ID token. We verify it server-side, then find-or-create the matching Frappe
// Web Account by verified email and establish the SAME Express session the
// password flow uses. Frappe + the session cookie remain the source of truth;
// Firebase is only the identity provider.
router.post("/api/auth/google", authLimiter, async (req, res) => {
  try {
    if (!firebaseAdmin.isConfigured()) {
      console.warn("GOOGLE AUTH unavailable:", firebaseAdmin.configError());
      return res.status(503).json({
        error: "Google sign-in is not available right now."
      });
    }
    const idToken = req.body?.idToken;
    let decoded;
    try {
      decoded = await firebaseAdmin.verifyIdToken(idToken);
    } catch (e) {
      console.warn("GOOGLE AUTH token verify failed:", e.code || e.message);
      return res.status(401).json({
        error: "Could not verify Google sign-in. Please try again."
      });
    }
    const email = (decoded.email || "").toLowerCase().trim();
    if (!email || decoded.email_verified !== true) {
      return res.status(401).json({
        error: "Your Google account has no verified email."
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Invalid email from Google."
      });
    }
    const displayName = decoded.name && String(decoded.name).trim() || email.split("@")[0];
    const client = frappeClient();

    // 1) Find existing Web Account by verified email.
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify(["name", "work_email", "account_holder_name", "entity_name", "purpose", "source_code", "plan", "account_status", WEB_ACCOUNT_SERVICES_FIELD]),
        limit_page_length: 1
      }
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
        account_status: "Active"
      });
      const docName = createResp.data?.data?.name;
      if (!docName) {
        return res.status(500).json({
          error: "Sign-in failed: could not create account."
        });
      }
      record = {
        name: docName,
        work_email: email,
        account_holder_name: displayName,
        entity_name: displayName,
        purpose: "",
        source_code: "",
        plan: "None",
        account_status: "Active"
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
        [WEB_ACCOUNT_SERVICES_FIELD]: buildWebAccountServiceRows(pendingServices.map(s => ({
          ...s,
          status: "Awaiting Payment"
        }))),
        account_status: record.account_status || "Active"
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
      record: {
        ...record,
        plan: planOverride || record.plan
      },
      planOverride: planOverride || null,
      invoices,
      selectedServices
    });

    // Regenerate the session ID on login to prevent session fixation.
    return req.session.regenerate(regenErr => {
      if (regenErr) {
        console.error("GOOGLE AUTH SESSION REGEN ERROR:", regenErr);
        return res.status(500).json({
          error: "Sign-in failed."
        });
      }
      req.session.user = userPayload;
      req.session.webAccount = userPayload.id;
      req.session.save(saveErr => {
        if (saveErr) {
          console.error("GOOGLE AUTH SESSION SAVE ERROR:", saveErr);
          return res.status(500).json({
            error: "Sign-in failed."
          });
        }
        return res.json({
          ok: true,
          user: userPayload
        });
      });
    });
  } catch (err) {
    console.error("GOOGLE AUTH ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Sign-in failed."
    });
  }
});

// ----------
// --- FORGOT PASSWORD ---
// ----------
// Always responds 200 with a generic message to avoid leaking which emails exist.

// ----------
// --- FORGOT PASSWORD ---
// ----------
// Always responds 200 with a generic message to avoid leaking which emails exist.
router.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const genericOk = {
    ok: true,
    message: "If an account exists for that email, a reset link has been sent."
  };
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    if (!isValidEmail(email)) return res.json(genericOk); // don't reveal validity

    const client = frappeClient();
    const query = await client.get("/api/resource/Web Account", {
      params: {
        filters: JSON.stringify([["work_email", "=", email]]),
        fields: JSON.stringify(["name", "work_email", "account_holder_name"]),
        limit_page_length: 1
      }
    });
    const record = query.data?.data?.[0];
    if (record?.name) {
      pruneTokenStore(passwordResetTokens);
      const token = crypto.randomBytes(32).toString("hex");
      passwordResetTokens.set(hashToken(token), {
        docName: record.name,
        email,
        expires: Date.now() + 60 * 60 * 1000 // 1 hour
      });
      const resetUrl = `${appBaseUrl(req)}/login?reset=${token}`;
      try {
        await sendPasswordResetEmail({
          to: email,
          clientName: record.account_holder_name,
          resetUrl
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

// ----------
// --- RESET PASSWORD ---
// ----------
router.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (!token) return res.status(400).json({
      error: "Missing reset token."
    });
    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters."
      });
    }
    pruneTokenStore(passwordResetTokens);
    const entry = passwordResetTokens.get(hashToken(token));
    if (!entry || entry.expires < Date.now()) {
      return res.status(400).json({
        error: "This reset link is invalid or has expired."
      });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const client = frappeClient();
    await client.put(`/api/resource/Web Account/${encodeURIComponent(entry.docName)}`, {
      password_hash
    });

    // Single-use: invalidate the token after success.
    passwordResetTokens.delete(hashToken(token));
    return res.json({
      ok: true,
      message: "Your password has been reset. You can now log in."
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Could not reset password. Please try again."
    });
  }
});

// ----------
// --- CHANGE PASSWORD (logged in) ---
// ----------

// ----------
// --- CHANGE PASSWORD (logged in) ---
// ----------
router.post("/api/auth/change-password", requireAuth, authLimiter, async (req, res) => {
  try {
    const docName = req.session?.webAccount || req.session?.user?.id;
    if (!docName) return res.status(401).json({
      error: "Not authenticated."
    });
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters."
      });
    }
    const client = frappeClient();
    const recRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(docName)}`, {
      params: {
        fields: JSON.stringify(["name", "password_hash"])
      }
    });
    const record = recRes.data?.data;
    if (!record?.password_hash) {
      return res.status(400).json({
        error: "Account has no password set."
      });
    }
    const match = await bcrypt.compare(currentPassword, record.password_hash);
    if (!match) return res.status(401).json({
      error: "Current password is incorrect."
    });
    const password_hash = await bcrypt.hash(newPassword, 12);
    await client.put(`/api/resource/Web Account/${encodeURIComponent(docName)}`, {
      password_hash
    });
    return res.json({
      ok: true,
      message: "Password updated successfully."
    });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Could not update password."
    });
  }
});

// ----------
// --- VERIFY EMAIL ---
// ----------
// Best-effort: marks email_verified on the Web Account if the field exists in the
// doctype. Login is not blocked on verification to avoid locking out existing users.

// ----------
// --- VERIFY EMAIL ---
// ----------
// Best-effort: marks email_verified on the Web Account if the field exists in the
// doctype. Login is not blocked on verification to avoid locking out existing users.
router.get("/api/auth/verify-email", async (req, res) => {
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
        email_verified: 1
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

// --- LOGOUT ---
router.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

router.get("/api/auth/me", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  // DEV_AUTO_LOGIN seeds the SESSION identity only, then falls through to the
  // same read path as production — same rule as the MOCK_FRAPPE note below.
  // The old early-return here served a hardcoded user with empty services/
  // invoices, so a dev-mode portal could never show anything purchased through
  // the mock store (masked every populated-dashboard state from local E2E).
  if (process.env.DEV_AUTO_LOGIN === "true" && !req.session?.webAccount) {
    req.session.webAccount = "dev-user@example.com";
    req.session.user = { id: "dev-user@example.com", name: "Dev User", email: "dev-user@example.com" };
  }
  // NOTE: no MOCK_FRAPPE short-circuit here. Mock mode must exercise the same
  // read path as production (frappeClient() already returns the mock store) —
  // a session-only fast path that force-flipped "Setting up" to "Active" was
  // masking the managed-setup state machine from every E2E run.
  try {
    const webAccountName = req.session?.webAccount || req.session?.user?.id || req.session?.user?.name;
    if (!webAccountName) {
      return res.status(401).json({
        ok: false
      });
    }
    const client = frappeClient();
    const recordRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`);
    const invoices = await fetchInvoicesForUser(client, webAccountName);
    const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
    const user = buildUserPayload({
      record: recordRes.data.data,
      invoices,
      selectedServices
    });

    // keep session fresh
    req.session.user = user;
    req.session.webAccount = webAccountName;
    return res.json({
      ok: true,
      user
    });
  } catch (err) {
    console.error("AUTH ME ERROR:", err.response?.data || err.message);
    // Last-resort DEV convenience: with auto-login on but NO data source
    // behind it (e.g. MOCK_FRAPPE off and no reachable Frappe), keep the dev
    // session usable with an explicitly-empty user instead of a 401 loop.
    if (process.env.DEV_AUTO_LOGIN === "true") {
      const devUser = {
        id: "dev-user@example.com", name: "Dev User", email: "dev-user@example.com",
        plan: "Business", accountStatus: "Active", hasActiveTrial: false,
        services: [], invoices: []
      };
      req.session.user = devUser;
      return res.json({ ok: true, user: devUser });
    }
    return res.status(401).json({
      ok: false
    });
  }
});

// ---- Provisioning (admin) ----
// List provisioning jobs, optionally filtered by status.

  return router;
};
