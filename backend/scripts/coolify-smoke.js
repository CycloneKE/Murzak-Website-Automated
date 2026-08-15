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
 *   node backend/scripts/coolify-smoke.js --inspect=<uuid>
 *     # Dumps the RAW GET /api/v1/services/{uuid} and /api/v1/applications/{uuid}
 *     # response for one existing resource, then exits. Use when
 *     # ensureServiceRunning()/serviceStatus() (coolify.js) disagrees with what
 *     # the Coolify UI shows for a real resource — e.g. the UI says "Running"
 *     # and the container logs are clean, but a Provisioning Job keeps landing
 *     # on "Permanent failure: coolify: service failed to start (status=exited)"
 *     # on every retry. That function does `String(d.status || "").split(":")[0]`
 *     # — this prints the actual `d.status` (and everything else in the object)
 *     # so you can see whether that assumption holds for a compose-based
 *     # SERVICE the way it's only ever been confirmed for an APPLICATION.
 *     # Get the uuid from the Coolify UI's resource URL
 *     # (.../service/<uuid> or .../application/<uuid>).
 *   node backend/scripts/coolify-smoke.js --create --hardening --keep
 *     # BYOA hardening-gap check (see provisioning/README.md "custom_docker_options"):
 *     # sets custom_docker_options on create, confirms the API accepts it (no 422),
 *     # confirms it's echoed back on GET, deploys, and confirms the app still
 *     # reaches a running/healthy status. --keep is recommended so you can then
 *     # run, on the VPS shell itself (this script cannot — no docker socket
 *     # access from the API):
 *     #   docker inspect <container> --format \
 *     #     '{{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}} {{.HostConfig.PidsLimit}}'
 *     # to confirm the flags actually reached the running container, then
 *     # delete the test app from the Coolify UI when done.
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
const HARDENING = process.argv.includes("--hardening");
const INSPECT = (process.argv.find((a) => a.startsWith("--inspect=")) || "").slice("--inspect=".length);
const SMOKE_NAME = HARDENING ? "murzak-smoke-hardening" : "murzak-smoke-test";
const SMOKE_REPO =
  process.env.SMOKE_REPO || "https://github.com/coollabsio/coolify-examples#nodejs-fastify";
// The compose-service lane already had to add these three back after a bare
// cap_drop:ALL crash-looped nginx (nginx's own privilege-drop needs them —
// see commit 1650072). Testing the same set here, not bare ALL, so a failure
// actually tells us something about custom_docker_options rather than
// re-discovering that known issue.
const HARDENING_DOCKER_OPTIONS =
  "--cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID " +
  "--security-opt=no-new-privileges:true --pids-limit=512";

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

  if (INSPECT) {
    console.log(`\n=== INSPECT ${INSPECT} — dumping raw status shape, then exiting ===`);
    const svc = await client.get(`/api/v1/services/${encodeURIComponent(INSPECT)}`);
    const svcBody = show(`GET /api/v1/services/${INSPECT}`, svc);
    if (svc.status === 200) {
      fullDump(
        "service object — this is exactly what serviceStatus()/ensureServiceRunning() in " +
          "services/provisioning/lanes/coolify.js reads via `String(d.status || '').split(':')[0]`",
        svcBody?.data || svcBody
      );
    }
    const app = await client.get(`/api/v1/applications/${encodeURIComponent(INSPECT)}`);
    show(`GET /api/v1/applications/${INSPECT} (sanity check — confirms which resource TYPE this uuid actually is)`, app);
    if (app.status === 200) fullDump("application object", app.data?.data || app.data);
    console.log("\nINSPECT done — paste the full output above back into the dev session.");
    return;
  }

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
    ...(HARDENING ? { custom_docker_options: HARDENING_DOCKER_OPTIONS } : {}),
  };
  if (HARDENING) {
    console.log(`\nHARDENING PROBE: custom_docker_options = "${HARDENING_DOCKER_OPTIONS}"`);
  }
  const created = await client.post("/api/v1/applications/public", createPayload);
  const createdBody = show("POST /api/v1/applications/public (instant_deploy:false)", created);
  fullDump("create response", createdBody);
  if (HARDENING && created.status >= 400) {
    die(
      `Create rejected the payload (status ${created.status}) with custom_docker_options set — ` +
        `see dump above for which field 422'd. Does NOT necessarily mean custom_docker_options ` +
        `itself is the culprit; remove it and re-run --create alone to isolate.`
    );
  }
  const appUuid =
    createdBody?.uuid || createdBody?.data?.uuid || createdBody?.id || createdBody?.data?.id;
  if (!appUuid) die("Could not extract app uuid from create response — see dump above.");
  console.log(`\nApp uuid: ${appUuid}`);

  try {
    // ---- Probe 5: GET the app — which of fqdn/domains carries the URL? -----
    const app = await client.get(`/api/v1/applications/${appUuid}`);
    show("GET /api/v1/applications/{uuid}", app);
    const appObj = app.data?.data || app.data;
    fullDump("application object (fqdn/domains fields!)", appObj);
    if (HARDENING) {
      const echoed = appObj?.custom_docker_options;
      console.log(
        `\nHARDENING PROBE: custom_docker_options echoed back on GET: ${
          echoed ? `"${echoed}"` : "MISSING — API accepted it on create but does not persist/echo it"
        }`
      );
    }

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

    if (HARDENING) {
      // ---- Probe 7a: did the app actually start with the hardening flags? ----
      const after = await client.get(`/api/v1/applications/${appUuid}`);
      const afterObj = after.data?.data || after.data;
      const runningStatus = afterObj?.status || afterObj?.container?.status || "?";
      console.log(
        `\nHARDENING PROBE: application status after deploy: "${runningStatus}" ` +
          `(want something containing "running" — if it's exited/unhealthy, the hardening ` +
          `flags likely need the same cap_add trio the compose lane needed, or a different set)`
      );
      console.log(
        "\nHARDENING PROBE: the API alone cannot confirm the flags reached dockerd — no docker " +
          "socket access over HTTP. On the VPS shell (Hostinger hPanel browser SSH), run:\n" +
          `  docker ps --filter "name=${SMOKE_NAME}" --format '{{.Names}}'\n` +
          "  docker inspect <container-name-from-above> --format " +
          "'{{json .HostConfig.CapDrop}} {{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}} {{.HostConfig.PidsLimit}}'\n" +
          "Expect CapDrop=[\"ALL\"], CapAdd to include CHOWN/SETUID/SETGID, SecurityOpt to include " +
          "no-new-privileges:true, PidsLimit=512. Paste the output back into the dev session."
      );
    }

    // ---- Probe 7b: per-app deployment history — CONFIRMED NOT TO EXIST -----
    // Verified live against Coolify 4.1.2 (2026-07-18): this 404s, and the
    // global GET /api/v1/deployments only lists CURRENTLY RUNNING deployments,
    // not history. Left here (commented, not called) as a record of what was
    // checked — deployment history is self-recorded instead, see
    // services/provisioning/deploymentHistory.js.
    // const hist = await client.get(`/api/v1/applications/${appUuid}/deployments`);

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

    // ---- Probe 10: environment variables (resource-admin panel) --------------
    // These back POST/PATCH/DELETE /api/portal/services/:id/envs. The whole
    // point of this probe is the two things the docs don't settle: whether
    // PATCH addresses the env by KEY on the collection (what lanes/coolify.js
    // assumes) or by uuid in the path, and what the list envelope actually
    // looks like. Read the dumps below before trusting either.
    try {
      const created = await client.post(`/api/v1/applications/${appUuid}/envs`, {
        key: "SMOKE_PROBE",
        value: "hello",
        is_buildtime: false,
        is_literal: false,
      });
      show("POST /api/v1/applications/{uuid}/envs", created);

      const listed = await client.get(`/api/v1/applications/${appUuid}/envs`);
      fullDump("GET envs (confirm the envelope + field names lanes/coolify.js normalizes)", listed.data?.data || listed.data);

      const patched = await client.patch(`/api/v1/applications/${appUuid}/envs`, {
        key: "SMOKE_PROBE",
        value: "goodbye",
        is_buildtime: false,
        is_literal: false,
      });
      show("PATCH /api/v1/applications/{uuid}/envs {key,value} (by KEY, not uuid)", patched);

      const after = await client.get(`/api/v1/applications/${appUuid}/envs`);
      const row = (after.data?.data || after.data || []).find((e) => e.key === "SMOKE_PROBE");
      console.log(
        `\nENV PROBE: SMOKE_PROBE value after PATCH = ${JSON.stringify(row?.value)} ` +
          `(want "goodbye" — if it's still "hello", PATCH-by-key is WRONG and updateEnv must address the uuid)`
      );

      const envUuid = row?.uuid || row?.id;
      if (envUuid) {
        const removed = await client.delete(`/api/v1/applications/${appUuid}/envs/${envUuid}`);
        show("DELETE /api/v1/applications/{uuid}/envs/{env_uuid}", removed);
      } else {
        console.log("ENV PROBE: no uuid on the env row — deleteEnv's path assumption needs rechecking.");
      }
    } catch (e) {
      console.log(`\nENV PROBE FAILED: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
      console.log("  -> the env routes in lanes/coolify.js are wrong for this version. Do NOT ship the panel.");
    }

    // ---- Probe 11: runtime logs (applications only) -------------------------
    // Backs GET /api/portal/services/:id/logs. Coolify documents no service
    // equivalent, which is why the portal gates envs+logs to app-kind jobs.
    try {
      const logs = await client.get(`/api/v1/applications/${appUuid}/logs?lines=50`);
      show("GET /api/v1/applications/{uuid}/logs?lines=50", logs);
      const body = logs.data?.data || logs.data || {};
      console.log(
        `\nLOGS PROBE: typeof logs = ${typeof body.logs} ` +
          `(want "string" — anything else and getLogs' normalization is wrong)`
      );
    } catch (e) {
      console.log(`\nLOGS PROBE FAILED: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
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
