/**
 * install-provisioning-doctype.js
 *
 * One-time setup: imports the "Provisioning Job" DocType into the connected
 * Frappe instance via the REST API, using the same FRAPPE_BASE_URL /
 * FRAPPE_API_KEY / FRAPPE_API_SECRET credentials the app already uses
 * (server.js frappeClient()). Idempotent — safe to re-run.
 *
 *   node backend/scripts/install-provisioning-doctype.js
 *
 * Until this doctype exists, provisioning runs in degraded "notify-only"
 * mode (see services/provisioning/README.md) — staff get an email but no
 * job record, and the Admin > Provisioning panel shows "not installed".
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DOCTYPE_PATH = path.resolve(__dirname, "../data/doctype-provisioning-job.json");

async function main() {
  const { FRAPPE_BASE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET } = process.env;
  if (!FRAPPE_BASE_URL || !FRAPPE_API_KEY || !FRAPPE_API_SECRET) {
    console.error("Missing FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET in backend/.env.");
    process.exit(1);
  }

  const doctype = JSON.parse(fs.readFileSync(DOCTYPE_PATH, "utf8"));
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

  // Already installed?
  try {
    await client.get(`/api/resource/DocType/${encodeURIComponent(doctype.name)}`);
    console.log(`✓ DocType "${doctype.name}" already exists — nothing to do.`);
    return;
  } catch (e) {
    const status = e.response?.status;
    if (status !== 404 && status !== 417) {
      console.error("Unexpected error checking for existing DocType:", e.response?.data || e.message);
      process.exit(1);
    }
    // 404/417 == not installed yet, proceed to create it.
  }

  try {
    await client.post("/api/resource/DocType", doctype);
    console.log(`✓ Installed DocType "${doctype.name}" (${doctype.fields.length} fields).`);
  } catch (e) {
    console.error(`✗ Failed to install DocType "${doctype.name}":`, e.response?.data || e.message);
    console.error(
      "\nIf this is a permissions error, the API key needs System Manager (or DocType create) " +
      "rights, or import it manually via Frappe Desk → DocType → Import, or " +
      "`bench --site <site> import-doc backend/data/doctype-provisioning-job.json`."
    );
    process.exit(1);
  }
}

main();
