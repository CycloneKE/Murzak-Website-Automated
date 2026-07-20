const express = require('express');
const byoaService = require('../services/byoaService');

// SKU this wizard deploys against — same catalog entry the repo-URL/checkout
// pipeline uses (see provisioning/provisioningService.js's requiresRepo gate).
// Keeps this a PAID feature instead of a free, unmetered Coolify-calling path.
const BYOA_APP_HOSTING_SERVICE_ID = 'starter-app-hosting';
const ACTIVE_STATUSES = new Set(['Active', 'Setting up']);

// Same https/git@ + optional #branch validation as PUT /api/portal/account/repo
// (portalRoutes.js) — kept in sync deliberately, this is the SAME field.
function isValidRepoUrl(raw) {
  return /^(https?:\/\/|git@)\S+$/i.test(raw);
}

module.exports = (routeContext) => {
  const router = express.Router();
  // NOTE: routeContext exposes requireAuth directly (see every other route
  // file) — there is no routeContext.authMiddleware wrapper. The previous
  // `const { authMiddleware } = routeContext; router.use(authMiddleware.requireAuth)`
  // dereferenced undefined and threw synchronously at server startup,
  // crashing the ENTIRE backend the moment this router was mounted
  // (`app.use('/api/byoa', require('./routes/byoaRoutes')(routeContext))`
  // in server.js runs before app.listen()). Reproduced: calling this factory
  // with a realistic routeContext threw
  // "Cannot read properties of undefined (reading 'requireAuth')".
  const {
    requireAuth,
    frappeClient,
    fetchSelectedServicesForUser,
    provisioningRunner,
    PROVISIONING_JOB_DOCTYPE,
  } = routeContext;

  // Middleware to ensure user is logged in
  router.use(requireAuth);

  /**
   * Start GitHub OAuth Flow
   */
  router.get('/github/auth', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID || 'mock_github_client_id';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/byoa/github/callback`;
    const scope = 'repo read:user';
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;
    res.redirect(authUrl);
  });

  /**
   * GitHub OAuth Callback
   */
  router.get('/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
      const token = await byoaService.exchangeGithubCode(code);
      // Store token in user's session securely
      req.session.githubToken = token;
      await new Promise(resolve => req.session.save(resolve));
      // Redirect back to the frontend deployment wizard
      res.redirect('/deploy');
    } catch (error) {
      console.error('[ByoaRoutes] GitHub Callback Error:', error);
      res.redirect('/deploy?error=github_auth_failed');
    }
  });

  /**
   * Fetch Repositories
   */
  router.get('/github/repos', async (req, res) => {
    try {
      const token = req.session.githubToken || 'mock_github_token_12345';
      const repos = await byoaService.fetchGithubRepos(token);
      res.json({ ok: true, repos });
    } catch (error) {
      console.error('[ByoaRoutes] Fetch Repos Error:', error);
      res.status(500).json({ ok: false, error: 'Failed to fetch repositories' });
    }
  });

  /**
   * Analyze Repository Stack
   */
  router.post('/analyze', async (req, res) => {
    try {
      const { repoUrl } = req.body;
      const token = req.session.githubToken;
      const analysis = await byoaService.analyzeRepository(repoUrl, token);
      res.json({ ok: true, analysis });
    } catch (error) {
      console.error('[ByoaRoutes] Analyze Repo Error:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * Trigger Deployment.
   *
   * UNIFIED (2026-07-20): this used to call Coolify directly from the request
   * handler (byoaService.startCoolifyDeployment), completely bypassing the
   * tested Provisioning Job queue/runner/retry/appDomain machinery that the
   * repo-URL-on-signup pipeline already uses (see provisioning/lanes/coolify.js,
   * provisioningService.js). That meant two independent, drifting
   * Coolify-calling code paths. Now this wizard just feeds the SAME pipeline:
   * write the selected repo onto the account, (re)queue the existing
   * Provisioning Job for this service, and kick the runner. Build status is
   * then read from the SAME endpoint the portal dashboard already uses
   * (GET /api/portal/services/:serviceId/activity) — no separate log/SSE
   * plumbing needed.
   */
  router.post('/deploy', async (req, res) => {
    try {
      // Gate on a PAID App Hosting service — without this, any logged-in
      // account could deploy unlimited apps through this wizard for free,
      // bypassing the KES/catalog billing model entirely. Re-fetches fresh
      // from Frappe rather than trusting req.session.user (which can be
      // stale relative to a purchase made moments ago in another tab).
      const webAccountName = req.session?.webAccount || req.session?.user?.id;
      if (!webAccountName) return res.status(401).json({ ok: false, error: 'No session account.' });

      const client = frappeClient();
      const selectedServices = await fetchSelectedServicesForUser(client, webAccountName);
      const hasAppHosting = (selectedServices || []).some(
        (s) => s.serviceId === BYOA_APP_HOSTING_SERVICE_ID && ACTIVE_STATUSES.has(s.status)
      );
      if (!hasAppHosting) {
        return res.status(402).json({
          ok: false,
          error: 'App Hosting is a paid service. Add it to your plan before deploying.',
          requiresPurchase: true,
          serviceId: BYOA_APP_HOSTING_SERVICE_ID,
        });
      }

      const { config } = req.body || {};
      const repoUrl = String(config?.repository?.url || '').trim();
      if (!repoUrl || !isValidRepoUrl(repoUrl)) {
        return res.status(400).json({ ok: false, error: 'No valid repository selected.' });
      }
      const branch = String(config?.branch || '').trim();
      const sourceCode = branch && branch !== 'main' ? `${repoUrl}#${branch}` : repoUrl;

      // Same field the portal's "My Account -> Project repository" writes —
      // the runner reads this at enqueue time (and we're re-triggering below).
      // app_port isn't set here: the wizard doesn't currently detect it, and
      // the customer can already set it via that same account field if their
      // app doesn't listen on the lane's default port.
      await client.put(`/api/resource/Web Account/${encodeURIComponent(webAccountName)}`, {
        source_code: sourceCode,
      });

      // Find the Provisioning Job created when this service was purchased.
      // (enqueueProvisioningForInvoice runs at invoice-paid time — the gate
      // above already confirmed the service is Active/Setting-up, so a job
      // should exist. If the account had no repo on file at purchase time it
      // was born `needs_human`; requeue it now that the repo is set.)
      const jobRes = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
        params: {
          filters: JSON.stringify([
            ['web_account', '=', webAccountName],
            ['service_id', '=', BYOA_APP_HOSTING_SERVICE_ID],
          ]),
          fields: JSON.stringify(['name', 'status']),
          order_by: 'modified desc',
          limit_page_length: 1,
        },
      });
      const job = jobRes.data?.data?.[0];
      if (!job?.name) {
        // Honest degrade — don't fabricate a job here and risk skipping the
        // capacity gate / invoice linkage enqueueProvisioningForInvoice
        // normally applies. This should be rare (billing gate above already
        // requires the service to be Active/Setting-up).
        return res.status(409).json({
          ok: false,
          error: 'Your App Hosting service is not queued for provisioning yet. Contact support.',
        });
      }

      await client.put(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(job.name)}`, {
        status: 'queued',
        attempts: 0,
        next_run_at: null,
        error: '',
        repo_url: sourceCode,
      });

      // Kick the runner immediately instead of waiting for the poll/cron
      // cycle — fire-and-forget, a real build can take minutes (build-wait
      // has its own multi-minute timeout) so this must never block the
      // response. The frontend polls job status separately.
      provisioningRunner.processQueue(client).catch((e) => {
        console.error('[ByoaRoutes] processQueue after deploy failed:', e.message);
      });

      res.json({ ok: true, payload: { jobId: job.name } });
    } catch (error) {
      console.error('[ByoaRoutes] Deployment Error:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
};
