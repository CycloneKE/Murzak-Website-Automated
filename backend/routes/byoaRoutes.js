const express = require('express');
const fetch = require('node-fetch');
const byoaService = require('../services/byoaService');

// SSE Proxy Helper for Coolify Logs
async function proxySSELogs(req, res, deploymentUuid) {
  const COOLIFY_API_URL = process.env.COOLIFY_API_URL || 'http://mock-coolify-api:3000';
  const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN || 'mock_coolify_token';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (COOLIFY_API_TOKEN === 'mock_coolify_token') {
    // Mock SSE Stream
    const mockSteps = [
      'Provisioning infrastructure...',
      'Cloning repository...',
      'Building Nixpacks image...',
      'Deploying container...',
      'Deployment successful!'
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < mockSteps.length) {
        res.write(`data: ${JSON.stringify({ log: mockSteps[i] })}\n\n`);
        i++;
      } else {
        res.write(`data: ${JSON.stringify({ status: 'finished' })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    }, 1500);
    
    req.on('close', () => clearInterval(interval));
    return;
  }

  try {
    const coolifyStream = await fetch(`${COOLIFY_API_URL}/api/v1/deployments/${deploymentUuid}/logs`, {
      headers: {
        'Authorization': `Bearer ${COOLIFY_API_TOKEN}`,
        'Accept': 'text/event-stream'
      }
    });

    if (!coolifyStream.ok) {
      res.write(`data: ${JSON.stringify({ error: 'Failed to connect to Coolify log stream' })}\n\n`);
      return res.end();
    }

    coolifyStream.body.on('data', chunk => {
      // Forward the exact SSE chunk from Coolify to the client
      res.write(chunk);
    });

    coolifyStream.body.on('end', () => {
      res.write(`data: ${JSON.stringify({ status: 'finished' })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      // Clean up connection if client disconnects
      try { coolifyStream.body.destroy(); } catch (e) {}
    });

  } catch (err) {
    console.error('[ByoaRoutes] SSE Proxy Error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

module.exports = (routeContext) => {
  const router = express.Router();
  const { authMiddleware } = routeContext;

  // Middleware to ensure user is logged in
  router.use(authMiddleware.requireAuth);

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
   * Trigger Deployment
   */
  router.post('/deploy', async (req, res) => {
    try {
      const { config } = req.body;
      // Triggers Coolify deployment and returns tracking UUIDs
      const deploymentMeta = await byoaService.startCoolifyDeployment(config);
      
      res.json({ ok: true, payload: deploymentMeta });
    } catch (error) {
      console.error('[ByoaRoutes] Deployment Error:', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * Real-time Deployment Logs (SSE)
   */
  router.get('/deploy/:deploymentUuid/logs', (req, res) => {
    const { deploymentUuid } = req.params;
    proxySSELogs(req, res, deploymentUuid);
  });

  return router;
};
