/**
 * No undeclared runtime dependencies; the Node version is pinned.
 *   node test/undeclaredDependency.test.js
 *
 * services/byoaService.js required 'node-fetch' at module scope, but it was
 * NOT listed in backend/package.json -- only present because npm happened to
 * install it transitively. server.js requires routes/byoaRoutes.js at
 * top-level module scope (app.use), which requires byoaService.js at ITS top
 * level, so this sits directly on the SERVER BOOT PATH: a routine dependency
 * bump that drops the transitive package would crash the entire server at
 * require-time, not just BYOA calls. Node 18+ (this project runs Node 22, see
 * the Dockerfile) has a stable global `fetch` -- node-fetch is not needed at
 * all.
 *
 * Also: package.json had no `engines` field, so nothing pins the runtime a
 * clean install is validated against.
 */
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

(async () => {
  section("no source file in backend/ requires node-fetch");
  {
    const backendDir = path.resolve(__dirname, "..");
    const offenders = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".js")) continue;
        const src = fs.readFileSync(full, "utf8");
        if (/require\(\s*['"]node-fetch['"]\s*\)/.test(src)) offenders.push(full);
      }
    })(backendDir);
    ok(offenders.length === 0, `no file requires node-fetch (found: ${offenders.join(", ") || "none"})`);
  }

  section("global fetch is what's actually used, and byoaService still works on its mock paths");
  {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete require.cache[require.resolve("../services/byoaService")];
    let svc;
    let threw = null;
    try { svc = require("../services/byoaService"); } // exports a singleton instance
    catch (e) { threw = e; }
    ok(threw === null, `byoaService.js loads cleanly (got ${threw?.message})`);

    const token = await svc.exchangeGithubCode("any-code");
    ok(token === "mock_github_token_12345", "the mock OAuth path still works with no network call");

    const repos = await svc.fetchGithubRepos(token);
    ok(Array.isArray(repos) && repos.length > 0, "the mock repos path still works with no network call");
  }

  section("global fetch exists on this Node runtime (sanity check for the replacement)");
  {
    ok(typeof fetch === "function", "global fetch is available -- node-fetch is redundant on this runtime");
  }

  section("package.json pins the Node version the Dockerfile actually uses");
  {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    ok(!!pkg.engines?.node, "an engines.node field exists");
    // Dockerfile uses node:22-alpine at every stage (FROM node:22-alpine, all 3 build stages).
    ok(/22/.test(pkg.engines?.node || ""), `engines.node reflects the Dockerfile's node:22 base image (got "${pkg.engines?.node}")`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error("UNCAUGHT:", e); process.exit(1); });
