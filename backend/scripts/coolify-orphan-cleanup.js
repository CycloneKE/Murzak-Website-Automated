/**
 * coolify-orphan-cleanup.js
 *
 * Deletes Coolify resources that NO Provisioning Job claims. The companion to
 * services/provisioning/orphans.js, which deliberately only ever reports — this
 * is the one place in the codebase allowed to remove unowned infrastructure,
 * and it is a hand-run script rather than anything the app can trigger.
 *
 *   node backend/scripts/coolify-orphan-cleanup.js            # DRY RUN (default)
 *   node backend/scripts/coolify-orphan-cleanup.js --confirm  # actually delete
 *
 * MUST BE RUN ON THE VPS. Coolify's API is IP-allowlisted to the box; from
 * anywhere else every call returns 403 "You are not allowed to access the API."
 *
 * WHY THIS EXISTS (2026-08-15): an audit found 18 unowned tenant containers —
 * four copies each of two web-hosting tenants, three each of three more
 * families. provision()'s idempotency check could not see them (it read the
 * services list as `data.data` only, so a bare-array response collapsed to []),
 * so every runner retry created another. That bug is fixed in the lane; this
 * script clears what it already left behind. Six of the seven Provisioning Jobs
 * sit at needs_human with an EMPTY external_ref, which is why nothing claims
 * these containers.
 *
 * FOUR GUARDRAILS, because this deletes production infrastructure:
 *
 *  1. NAME ALLOWLIST. Only resources matching TENANT_NAME_RE are ever
 *     considered. Ownership alone is NOT sufficient — murzak-website-automated
 *     (the live storefront) and murzak-redis have no Provisioning Job either,
 *     so an ownership-only rule would delete the company's own website.
 *     orphans.js flags them; this script must never act on them.
 *  2. OWNERSHIP. Anything referenced by any coolify-lane job's external_ref is
 *     skipped, re-read live at run time so a job that has since acquired a ref
 *     is protected.
 *  3. FAIL CLOSED. If the Frappe read fails we cannot prove what is owned, so
 *     the script aborts rather than guessing.
 *  4. DRY RUN BY DEFAULT. Nothing is deleted without --confirm.
 */

require("dotenv").config();
const axios = require("axios");
const coolify = require("../services/provisioning/lanes/coolify");
const targets = require("../services/provisioning/targets");
const { JOB_DOCTYPE } = require("../services/provisioning/constants");

const CONFIRM = process.argv.includes("--confirm");

/**
 * Tenant resources are named `{web_account}-{service_id}` by
 * coolify.resourceName(), and every web account id looks like
 * USER-YY-MM-DD-NNNN. Nothing else on the box can match this shape — which is
 * precisely the point: platform infrastructure and third-party apps
 * (murzak-website-automated, murzak-redis, hermes-agent-*, appsmith-*) cannot
 * be matched by accident no matter what the ownership data says.
 */
const TENANT_NAME_RE = /^user-\d{2}-\d{2}-\d{2}-\d{4}-/i;

/**
 * Pure partition of a resource list into what gets deleted and why it doesn't.
 * Exported and unit-tested (test/coolifyOrphanCleanup.test.js) because getting
 * this wrong deletes the company's live website — this is the one function in
 * the repo where a false positive is unrecoverable.
 */
function classifyResources(all, ownedRefs) {
  return {
    doomed: all.filter((r) => TENANT_NAME_RE.test(r.name) && !ownedRefs.has(r.uuid)),
    protectedByName: all.filter((r) => !TENANT_NAME_RE.test(r.name)),
    protectedByOwner: all.filter((r) => TENANT_NAME_RE.test(r.name) && ownedRefs.has(r.uuid)),
  };
}

function die(msg) {
  console.error(`\nABORTED: ${msg}`);
  process.exit(1);
}

function frappeClient() {
  const base = (process.env.FRAPPE_BASE_URL || "").replace(/\/+$/, "");
  const key = process.env.FRAPPE_API_KEY;
  const secret = process.env.FRAPPE_API_SECRET;
  if (!base || !key || !secret) die("FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET must all be set.");
  return axios.create({
    baseURL: base,
    headers: { Authorization: `token ${key}:${secret}` },
    timeout: 30000,
  });
}

/** Every external_ref claimed by a coolify-lane job, or null if undeterminable. */
async function ownedExternalRefs(client) {
  try {
    const res = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([["lane", "=", "coolify"]]),
        fields: JSON.stringify(["name", "external_ref", "status"]),
        limit_page_length: 0,
      },
    });
    const rows = res.data?.data || [];
    const owned = new Set(rows.map((r) => String(r.external_ref || "").trim()).filter(Boolean));
    return { owned, jobCount: rows.length };
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`Coolify orphan cleanup — ${CONFIRM ? "LIVE (will delete)" : "DRY RUN"}\n`);

  const client = frappeClient();
  const ownership = await ownedExternalRefs(client);
  if (!ownership) {
    die("could not read Provisioning Job external_refs — refusing to guess what is owned.");
  }
  console.log(`Provisioning Jobs (coolify lane): ${ownership.jobCount}`);
  console.log(`Claimed external_refs: ${ownership.owned.size ? [...ownership.owned].join(", ") : "(none)"}\n`);

  const targetList = targets.listTargets().filter((t) => coolify.isConfigured({ target: t }));
  if (!targetList.length) die("no configured Coolify target — check COOLIFY_BASE_URL / COOLIFY_TOKEN.");

  let deleted = 0;
  let failed = 0;

  for (const t of targetList) {
    const opts = { target: t };
    let apps, services;
    try {
      [apps, services] = await Promise.all([coolify.listApplications(opts), coolify.listServices(opts)]);
    } catch (e) {
      // A target we cannot list is a target we cannot reason about. Skip it
      // rather than deleting based on a partial picture.
      console.error(`[${t.id}] SKIPPED — could not list resources: ${e.response?.status || ""} ${e.message}`);
      failed++;
      continue;
    }

    const all = [
      ...apps.map((a) => ({ ...a, kind: "application" })),
      ...services.map((s) => ({ ...s, kind: "service" })),
    ];

    const { doomed, protectedByName, protectedByOwner } = classifyResources(all, ownership.owned);

    console.log(`[${t.id}] ${all.length} resources: ${doomed.length} orphaned, ${protectedByOwner.length} owned, ${protectedByName.length} not tenant-shaped`);
    protectedByName.forEach((r) => console.log(`   KEEP (not a tenant resource) ${r.kind}/${r.uuid}  ${r.name}`));
    protectedByOwner.forEach((r) => console.log(`   KEEP (claimed by a job)      ${r.kind}/${r.uuid}  ${r.name}`));
    console.log("");

    for (const r of doomed) {
      if (!CONFIRM) {
        console.log(`   would delete ${r.kind}/${r.uuid}  ${r.name}`);
        continue;
      }
      try {
        await coolify.destroy(r.uuid, { ...opts, kind: r.kind });
        deleted++;
        console.log(`   DELETED ${r.kind}/${r.uuid}  ${r.name}`);
      } catch (e) {
        // 404 means it's already gone — the goal state, not a failure.
        if (e.response?.status === 404) {
          console.log(`   already gone ${r.kind}/${r.uuid}  ${r.name}`);
          continue;
        }
        failed++;
        console.error(`   FAILED ${r.kind}/${r.uuid}  ${r.name}: ${e.response?.status || ""} ${e.response?.data?.message || e.message}`);
      }
    }
  }

  console.log(`\n${CONFIRM ? `Deleted ${deleted}` : "Dry run — nothing deleted"}${failed ? `, ${failed} failure(s)` : ""}.`);
  if (!CONFIRM) console.log("Re-run with --confirm to apply.");
  else console.log("Re-check with GET /api/admin/provisioning/orphans.");
}

module.exports = { TENANT_NAME_RE, classifyResources };

// Only run when invoked directly — requiring this file (from the test) must
// never start deleting anything.
if (require.main === module) {
  main().catch((e) => die(e.stack || e.message));
}
