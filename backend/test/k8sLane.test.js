/**
 * k8s lane quarantine — the lane has no real cluster behind it (no build
 * pipeline, no registry). isConfigured() must require a real kubeconfig
 * everywhere (not just in production), and getContainerImage() must refuse
 * rather than fabricate a registry URL for a repo_url job that was never
 * actually built.
 *   node test/k8sLane.test.js   (or: npm test)
 */
let passed = 0;
let failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok:", msg); }
  else { failed++; fails.push(msg); console.error("  FAIL:", msg); }
}
function section(name) { console.log(`\n# ${name}`); }

const k8s = require("../services/provisioning/lanes/k8s");

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

(async () => {
  section("isConfigured: requires a real KUBECONFIG_BASE64, no NODE_ENV fallback");
  withEnv({ KUBECONFIG_BASE64: "", NODE_ENV: "development" }, () => {
    ok(k8s.isConfigured() === false, "not configured in development with no kubeconfig (used to fall back to true here)");
  });
  withEnv({ KUBECONFIG_BASE64: "", NODE_ENV: "" }, () => {
    ok(k8s.isConfigured() === false, "not configured with NODE_ENV unset either");
  });
  withEnv({ KUBECONFIG_BASE64: "", NODE_ENV: "production" }, () => {
    ok(k8s.isConfigured() === false, "not configured in production with no kubeconfig");
  });
  withEnv({ KUBECONFIG_BASE64: "ZmFrZQ==", NODE_ENV: "development" }, () => {
    ok(k8s.isConfigured() === true, "configured once a real KUBECONFIG_BASE64 is set");
  });

  section("configError: names the missing var only when unconfigured");
  withEnv({ KUBECONFIG_BASE64: "" }, () => {
    ok(/KUBECONFIG_BASE64/.test(k8s.configError() || ""), "explains what's missing");
  });
  withEnv({ KUBECONFIG_BASE64: "ZmFrZQ==" }, () => {
    ok(k8s.configError() === null, "no error once configured");
  });

  section("getContainerImage: refuses a repo_url job instead of fabricating a registry URL");
  {
    const job = { web_account: "WA", service_id: "ent-webapps", repo_url: "https://github.com/cust/app" };
    let threw = null;
    try {
      await k8s.getContainerImage(job);
    } catch (e) {
      threw = e;
    }
    ok(!!threw, "throws rather than returning a made-up image URL");
    ok(/no build pipeline/i.test(threw?.message || ""), "error explains why (no build pipeline exists)");
  }

  section("getContainerImage: a pre-built docker_image is still servable (not a fabrication)");
  {
    const job = { web_account: "WA", service_id: "ent-webapps", docker_image: "ghcr.io/cust/app:v1" };
    const image = await k8s.getContainerImage(job);
    ok(image === "ghcr.io/cust/app:v1", "returns the caller-provided, already-built image as-is");
  }

  section("getContainerImage: no repo_url and no docker_image falls back to the documented placeholder");
  {
    const job = { web_account: "WA", service_id: "ent-webapps" };
    const image = await k8s.getContainerImage(job);
    ok(image === "nginx:alpine", "falls back to nginx:alpine, not a fabricated registry URL");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { fails.forEach((f) => console.error(" -", f)); process.exit(1); }
})();
