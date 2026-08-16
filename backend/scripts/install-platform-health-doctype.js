/**
 * install-platform-health-doctype.js
 *
 * One-time setup: imports the "Platform Health Check" DocType (see
 * docs/superpowers/specs/2026-08-15-platform-maintenance-automation-design.md)
 * into the connected Frappe instance, using the same credentials as
 * install-provisioning-doctype.js. Idempotent — safe to re-run.
 *
 *   node backend/scripts/install-platform-health-doctype.js
 *
 * Until this exists, the orphan-reconciliation and capacity-snapshot sweeps
 * still run and still email admins on attention — they just fail (silently,
 * logged) to persist a row, so the admin dashboard has nothing to show.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DOCTYPE_PATH = path.resolve(__dirname, "../data/doctype-platform-health-check.json");

async function installOne(client, doctypePath) {
  const doctype = JSON.parse(fs.readFileSync(doctypePath, "utf8"));

  try {
    await client.get(`/api/resource/DocType/${encodeURIComponent(doctype.name)}`);
    console.log(`✓ DocType "${doctype.name}" already exists — nothing to do.`);
    return;
  } catch (e) {
    const status = e.response?.status;
    if (status !== 404 && status !== 417) {
      console.error(`Unexpected error checking for "${doctype.name}":`, e.response?.data || e.message);
      process.exitCode = 1;
      return;
    }
  }

  try {
    await client.post("/api/resource/DocType", doctype);
    console.log(`✓ Installed DocType "${doctype.name}" (${doctype.fields.length} fields).`);
  } catch (e) {
    console.error(`✗ Failed to install DocType "${doctype.name}":`, e.response?.data || e.message);
    console.error(
      "\nIf this is a permissions error, the API key needs System Manager (or DocType create) " +
      `rights, or import it manually via Frappe Desk → DocType → Import, or ` +
      `\`bench --site <site> import-doc ${path.relative(process.cwd(), doctypePath)}\`.`
    );
    process.exitCode = 1;
  }
}

async function main() {
  const { FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET } = process.env;
  if (!FRAPPE_BASE_URL || !FRAPPE_API_KEY || !FRAPPE_API_SECRET) {
    console.error("Missing FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET in backend/.env.");
    process.exit(1);
  }

  const client = axios.create({
    baseURL: FRAPPE_BASE_URL,
    headers: {
      Authorization: `token ${FRAPPE_API_KEY}:${FRAPPE_API_SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 20000,
  });

  console.log(`Target Frappe: ${FRAPPE_BASE_URL}`);
  await installOne(client, DOCTYPE_PATH);
}

main();
