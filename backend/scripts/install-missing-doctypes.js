/**
 * install-missing-doctypes.js
 *
 * One-time setup: imports every DocType currently missing a dedicated
 * install script — "Checkout Order", "Portal Update", and "Capacity
 * Request" — into the connected Frappe instance via the REST API, using the
 * same FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET credentials the
 * app already uses (server.js frappeClient()). Idempotent — safe to re-run.
 *
 *   node backend/scripts/install-missing-doctypes.js
 *
 * See docs/operations-workbook.md Part 6 for what breaks (silently) while
 * each of these is missing:
 *   - Checkout Order:    ALL self-serve checkout 503s ("Checkout is not configured.")
 *   - Portal Update:     portal "Updates & support" feed + concierge chat break
 *   - Capacity Request:  scale-out requests aren't recorded (still emailed, but
 *                        with no admin-panel trace once the email is missed)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DOCTYPE_PATHS = [
  path.resolve(__dirname, "../data/doctype-checkout-order.json"),
  path.resolve(__dirname, "../data/doctype-portal-update.json"),
  path.resolve(__dirname, "../data/doctype-capacity-request.json"),
  // Support threads. This doctype was hand-created in Frappe and had no
  // fixture, so field drift went undetected; it is captured here so the
  // add-missing-fields path can install admin_last_read_at (and anything
  // else the code expects) without a manual bench edit.
  path.resolve(__dirname, "../data/doctype-portal-users-requests.json"),
];

async function installOne(client, doctypePath) {
  const doctype = JSON.parse(fs.readFileSync(doctypePath, "utf8"));

  // Already installed? Merge any fields the fixture has gained since —
  // idempotent, never modifies/removes existing fields or data.
  try {
    const existingRes = await client.get(`/api/resource/DocType/${encodeURIComponent(doctype.name)}`);
    const existing = existingRes.data?.data || {};
    const existingNames = new Set((existing.fields || []).map((f) => f.fieldname));
    const missing = doctype.fields.filter((f) => f.fieldname && !existingNames.has(f.fieldname));
    if (!missing.length) {
      console.log(`✓ DocType "${doctype.name}" already exists and has every fixture field — nothing to do.`);
      return true;
    }
    await client.put(`/api/resource/DocType/${encodeURIComponent(doctype.name)}`, {
      fields: [...(existing.fields || []), ...missing],
    });
    console.log(
      `✓ DocType "${doctype.name}" updated — added ${missing.length} missing field(s): ` +
        missing.map((f) => f.fieldname).join(", ")
    );
    return true;
  } catch (e) {
    const status = e.response?.status;
    if (status !== 404 && status !== 417) {
      console.error(`✗ Unexpected error checking/updating "${doctype.name}":`, e.response?.data || e.message);
      return false;
    }
    // 404/417 == not installed yet, fall through to create it.
  }

  try {
    await client.post("/api/resource/DocType", doctype);
    console.log(`✓ Installed DocType "${doctype.name}" (${doctype.fields.length} fields).`);
    return true;
  } catch (e) {
    console.error(`✗ Failed to install DocType "${doctype.name}":`, e.response?.data || e.message);
    console.error(
      "\nIf this is a permissions error, the API key needs System Manager (or DocType create) " +
      "rights, or import it manually via Frappe Desk → DocType → Import, or " +
      `\`bench --site <site> import-doc ${path.relative(process.cwd(), doctypePath)}\`.`
    );
    return false;
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
  let ok = true;
  for (const p of DOCTYPE_PATHS) {
    ok = (await installOne(client, p)) && ok;
  }
  if (!ok) process.exit(1);
}

main();
