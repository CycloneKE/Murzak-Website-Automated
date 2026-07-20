const fetch = require('node-fetch');

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'mock_github_client_id';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'mock_github_client_secret';

class ByoaService {
  /**
   * GitHub OAuth - Exchange code for token
   */
  async exchangeGithubCode(code) {
    if (GITHUB_CLIENT_ID === 'mock_github_client_id') {
      console.warn('[ByoaService] Using MOCK GitHub OAuth Token. Missing GITHUB_CLIENT_ID/SECRET env vars.');
      return 'mock_github_token_12345';
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
  }

  /**
   * Fetch user's GitHub repositories
   */
  async fetchGithubRepos(token) {
    if (token === 'mock_github_token_12345') {
      return [
        { id: 1, name: 'mock-react-app', fullName: 'user/mock-react-app', url: 'https://github.com/user/mock-react-app', private: false, updatedAt: new Date().toISOString() },
        { id: 2, name: 'nextjs-saas-starter', fullName: 'user/nextjs-saas-starter', url: 'https://github.com/user/nextjs-saas-starter', private: true, updatedAt: new Date().toISOString() },
        { id: 3, name: 'express-api', fullName: 'user/express-api', url: 'https://github.com/user/express-api', private: false, updatedAt: new Date().toISOString() }
      ];
    }

    const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) throw new Error('Failed to fetch repositories from GitHub');
    const repos = await res.json();
    
    return repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      private: repo.private,
      updatedAt: repo.updated_at,
      defaultBranch: repo.default_branch
    }));
  }

  /**
   * Analyze Repository Stack (Uses Coolify or fallback rules)
   */
  async analyzeRepository(repoUrl, token) {
    console.log(`[ByoaService] Analyzing repository: ${repoUrl}`);
    
    // In a full implementation, we could ask Coolify to inspect the repo.
    // However, Coolify typically detects the stack upon Application Creation (Nixpacks/Buildpacks).
    // For BYOA UX, we'll do a quick mock/heuristic based on repo name for the MVP, 
    // or fetch package.json via GitHub API if we have the token.
    
    let framework = 'Vite + React';
    let language = 'TypeScript';
    let buildCommand = 'npm run build';
    let installCommand = 'npm install';
    let outputDirectory = 'dist';

    if (repoUrl.includes('nextjs')) {
      framework = 'Next.js';
      buildCommand = 'npm run build';
      outputDirectory = '.next';
    } else if (repoUrl.includes('express') || repoUrl.includes('api') || repoUrl.includes('node')) {
      framework = 'Node.js Express';
      language = 'JavaScript';
      buildCommand = ''; // Node apps often don't need a build step
      outputDirectory = '';
      installCommand = 'npm install --production';
    } else if (repoUrl.includes('vue') || repoUrl.includes('nuxt')) {
      framework = 'Vue.js';
      outputDirectory = 'dist';
    }

    return {
      framework,
      language,
      buildCommand,
      installCommand,
      outputDirectory
    };
  }

  // NOTE: this class used to also own startCoolifyDeployment() — a second,
  // independent Coolify-calling path (create app + set envs + trigger
  // deploy) that duplicated and drifted from the tested lane in
  // provisioning/lanes/coolify.js (wrong env var names, wrong endpoint
  // paths, a hardcoded unregistered domain — see murzaktech-byoa-app-hosting
  // memory). Removed 2026-07-20: byoaRoutes.js's /deploy now writes the
  // selected repo onto the account and (re)queues the SAME Provisioning Job
  // the repo-URL/checkout pipeline uses, so there is exactly one
  // Coolify-calling code path for BYOA deploys, not two.
}

module.exports = new ByoaService();
