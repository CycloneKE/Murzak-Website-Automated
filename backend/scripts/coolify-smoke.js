/**
 * coolify-smoke.js — read-mostly probe of the live Coolify v4 API.
 *
 * The coolify lane was written against Coolify's documented API but most of
 * its endpoints have never been exercised against the real instance (the API
 * is IP-restricted to the VPS). This script confirms, endpoint by endpoint,
 * the exact field names and status vocabulary the lane depends on, so the
 * deploy-wait/domain/lifecycle code paths are wired from OBSERVED shapes,
 * not guesses.
 *
 * Run FROM THE VPS (or wherever can reach the Coolify API):
 *
 *   node backend/scripts/coolify-smoke.js                 # read-only probes
 *   node backend/scripts/coolify-smoke.js --create        # + create/deploy/delete
 *   node backend/scripts/coolify-smoke.js --create --keep # leave the test app up
 *
 * Uses the same COOLIFY_* env the lane uses (backend/.env or shell env):
 *   COOLIFY_BASE_URL, COOLIFY_TOKEN, COOLIFY_PROJECT_UUID, COOLIFY_SERVER_UUID
 * Optional: COOLIFY_ENV_NAME (default "production"), SMOKE_REPO
 *   (default https://github.com/coollabsio/coolify-examples#nodejs-fastify),
 *   SMOKE_DOMAIN (e.g. https://smoke-test.apps.murzaktech.tech to probe the
 *   domains PATCH — omit to skip that probe).
 *
 * Every probe prints the raw response shape (trimmed) and the full JSON for
 * the objects whose field names the lane depends on. Nothing here is imported
 * by the app — it's an operator tool.
 */

require("dotenv").config();
const axios = require("axios");

const CREATE = process.argv.includes("--create");
const KEEP = process.argv.includes("--keep");
const SMOKE_NAME = "murzak-smoke-test";
const SMOKE_REPO =
  process.env.SMOKE_REPO || "https://github.com/coollabsio/coolify-examples#nodejs-fastify";

const cfg = {
  baseUrl: (process.env.COOLIFY_BASE_URL || "").replace(/\/+$/, ""),
  token: process.env.COOLIFY_TOKEN,
  project: process.env.COOLIFY_PROJECT_UUID,
  server: process.env.COOLIFY_SERVER_UUID,
  env: process.env.COOLIFY_ENV_NAME || "production",
};

function die(msg) {
  console.error(`\nFATAL: ${msg}`);
  process.exit(1);
}

if (!cfg.baseUrl || !cfg.token) die("COOLIFY_BASE_URL / COOLIFY_TOKEN not set.");
if (CREATE && (!cfg.project || !cfg.server))
  die("--create needs COOLIFY_PROJECT_UUID / COOLIFY_SERVER_UUID too.");

const client = axios.create({
  baseURL: cfg.baseUrl,
  headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
  timeout: 30000,
  // We want to SEE 4xx bodies, not throw on them.
  validateStatus: () => true,
});

/** Print a trimmed view of a response: status + top-level keys + small values. */
function show(label, res) {
  const body = res.data;
  let summary;
  if (Array.isArray(body)) {
    summary =
      `array[${body.length}]` + (body[0] ? ` first-keys=${Object.keys(body[0]).join(",")}` : "");
  } else if (body && typeof body === "object") {
    const keys = Object.keys(body);
    summary = `keys=${keys.join(",")}`;
    // One level deeper for the common {data: ...} envelope.
    if (body.data !== undefined) {
      const d = body.data;
      summary += Array.isArray(d)
        ? ` data=array[${d.length}]${d[0] ? ` first-keys=${Object.keys(d[0]).join(",")}` : ""}`
        : d && typeof d === "object"
        ? ` data-keys=${Object.keys(d).join(",")}`
        : ` data=${JSON.stringify(d)}`;
    }
  } else {
    summary = JSON.stringify(body)?.slice(0, 200);
  }
  console.log(`\n[${res.status}] ${label}\n  ${summary}`);
  return body;
}

function fullDump(label, value) {
  console.log(`\n--- ${label} (full) ---`);
  console.log(JSON.stringify(value, null, 2)?.slice(0, 4000));
  console.log(`--- end ${label} ---`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Coolify smoke probe → ${cfg.baseUrl} (create=${CREATE}, keep=${KEEP})`);

  // ---- Probe 1: version / auth sanity --------------------------------------
  const ver = await client.get("/api/v1/version");
  show("GET /api/v1/version (auth + reachability)", ver);
  if (ver.status === 401) die("Token rejected (401). Check COOLIFY_TOKEN.");

  // ---- Probe 2: list applications — envelope + name/uuid fields ------------
  const list = await client.get("/api/v1/applications");
  const listBody = show("GET /api/v1/applications", list);
  const apps = Array.isArray(listBody) ? listBody : listBody?.data || [];
  if (apps[0]) fullDump("first application object", apps[0]);

  // ---- Probe 3: lifecycle-route shape (bogus uuid: 404 body tells us the
  // route EXISTS without touching a real app; 405 would mean wrong verb) -----
  const routeProbe = await client.get("/api/v1/applications/00000000-route-probe/restart");
  show(
    "GET /api/v1/applications/{bogus}/restart (404=route exists, 405/422=wrong verb/shape)",
    routeProbe
  );
  const svcRouteProbe = await client.get("/api/v1/services/00000000-route-probe/restart");
  show("GET /api/v1/services/{bogus}/restart (compare services route)", svcRouteProbe);

  if (!CREATE) {
    console.log(
      "\nRead-only probes done. Re-run with --create to exercise create → deploy-status → domains → delete."
    );
    return;
  }

  // ---- Probe 4: create application (NO instant deploy) ---------------------
  const hash = SMOKE_REPO.indexOf("#");
  const repoUrl = hash === -1 ? SMOKE_REPO : SMOKE_REPO.slice(0, hash);
  const repoBranch = hash === -1 ? "main" : SMOKE_REPO.slice(hash + 1);
  const createPayload = {
    project_uuid: cfg.project,
    server_uuid: cfg.server,
    environment_name: cfg.env,
    name: SMOKE_NAME,
    git_repository: repoUrl,
    git_branch: repoBranch,
    build_pack: "nixpacks",
    ports_exposes: "3000",
    instant_deploy: false,
    ...(process.env.SMOKE_DOMAIN ? { domains: process.env.SMOKE_DOMAIN } : {}),
  };
  const created = await client.post("/api/v1/applications/public", createPayload);
  const createdBody = show("POST /api/v1/applications/public (instant_deploy:false)", created);
  fullDump("create response", createdBody);
  const appUuid =
    createdBody?.uuid || createdBody?.data?.uuid || createdBody?.id || createdBody?.data?.id;
  if (!appUuid) die("Could not extract app uuid from create response — see dump above.");
  console.log(`\nApp uuid: ${appUuid}`);

  try {
    // ---- Probe 5: GET the app — which of fqdn/domains carries the URL? -----
    const app = await client.get(`/api/v1/applications/${appUuid}`);
    show("GET /api/v1/applications/{uuid}", app);
    fullDump("application object (fqdn/domains fields!)", app.data?.data || app.data);

    // ---- Probe 6: trigger a deploy — response shape (deployment_uuid?) -----
    const dep = await client.post(`/api/v1/deploy?uuid=${appUuid}`);
    const depBody = show("POST /api/v1/deploy?uuid={app}", dep);
    fullDump("deploy response", depBody);
    const deployments = depBody?.deployments || depBody?.data?.deployments || [];
    const deploymentUuid =
      deployments[0]?.deployment_uuid ||
      depBody?.deployment_uuid ||
      depBody?.data?.deployment_uuid;
    console.log(`\nDeployment uuid: ${deploymentUuid || "NOT FOUND — see dump"}`);

    // ---- Probe 7: poll the deployment — status vocabulary + logs shape -----
    if (deploymentUuid) {
      for (let i = 0; i < 20; i++) {
        await sleep(10000);
        const d = await client.get(`/api/v1/deployments/${deploymentUuid}`);
        const dBody = d.data?.data || d.data || {};
        const status = dBody.status || dBody.deployment_status || "?";
        console.log(
          `  poll ${i + 1}: [${d.status}] status="${status}" keys=${Object.keys(dBody).join(",")}`
        );
        if (/finished|failed|success|error|cancelled/i.test(String(status))) {
          fullDump("terminal deployment object (status + logs field!)", dBody);
          break;
        }
      }
    }

    // ---- Probe 8: PATCH domains (only if SMOKE_DOMAIN set) ------------------
    if (process.env.SMOKE_DOMAIN) {
      const patch = await client.patch(`/api/v1/applications/${appUuid}`, {
        domains: process.env.SMOKE_DOMAIN,
      });
      show(`PATCH /api/v1/applications/{uuid} {domains:"${process.env.SMOKE_DOMAIN}"}`, patch);
      const after = await client.get(`/api/v1/applications/${appUuid}`);
      fullDump("application after domains PATCH (did fqdn change?)", after.data?.data || after.data);
    }

    // ---- Probe 9: lifecycle actions on the real app -------------------------
    for (const action of ["stop", "start", "restart"]) {
      const r = await client.get(`/api/v1/applications/${appUuid}/${action}`);
      show(`GET /api/v1/applications/{uuid}/${action}`, r);
      await sleep(3000);
    }
  } finally {
    // ---- Cleanup -------------------------------------------------------------
    if (KEEP) {
      console.log(
        `\n--keep: leaving "${SMOKE_NAME}" (${appUuid}) in place. Delete it from the Coolify UI when done.`
      );
    } else {
      const del = await client.delete(`/api/v1/applications/${appUuid}`);
      show("DELETE /api/v1/applications/{uuid} (cleanup)", del);
    }
  }

  console.log("\nSmoke probe complete. Paste this full output back into the dev session.");
}

main().catch((e) => die(e.stack || e.message));
