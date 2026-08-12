/**
 * install-custom-fields.js
 *
 * One-time setup: imports every Custom Field fixture in backend/data/ —
 * currently the M-Pesa payment-matching fields on Portal Invoice and the
 * developer-terminal consent fields on Web Account — into the connected
 * Frappe instance via the REST API, using the same FRAPPE_BASE_URL /
 * FRAPPE_API_KEY / FRAPPE_API_SECRET credentials the app already uses.
 * Idempotent — safe to re-run; skips fields that already exist.
 *
 *   node backend/scripts/install-custom-fields.js
 *
 * See docs/operations-workbook.md Part 6 for what breaks (silently) while
 * each of these is missing:
 *   - Portal Invoice M-Pesa fields: paid services never activate — the
 *     STK-push callback can't match the payment back to its invoice.
 *   - Web Account terminal-consent fields: Developer Access approvals and
 *     disclosure acceptance silently persist nothing.
 *
 * CACHING NOTE: a freshly-created Custom Field can take a short while to
 * appear in Frappe's cached runtime meta even though the record was created
 * correctly — a document fetched right after this script runs may not show
 * the new field yet. If it's still missing well after running this, that's
 * a cache-propagation issue on the Frappe side (bench clear-cache / a worker
 * restart), not evidence the field wasn't created — verify against the
 * Custom Field record itself (Frappe Desk → Customize Form → <doctype>),
 * not just a live document read.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const FIXTURE_PATHS = [
  path.resolve(__dirname, "../data/custom-fields-portal-invoice-mpesa.json"),
  path.resolve(__dirname, "../data/custom-fields-web-account.json"),
];

// Checks BOTH shapes a field can already exist in: NATIVE (baked directly
// into the target DocType's own definition — true for every field on
// Murzak's own custom doctypes, e.g. Web Account.app_port,
// Portal Invoice.mpesa_checkout_request_id) and EXTENSION (a separate
// "Custom Field" record bolted on afterward). Checking only "Custom Field"
// misses every native field and wrongly tries to re-create it — caught live
// 2026-08-11: Frappe correctly rejected the duplicate, but the check itself
// was wrong and would have reported these as "not installed" forever.
async function fieldExists(client, dt, fieldname) {
  try {
    const dtRes = await client.get(`/api/resource/DocType/${encodeURIComponent(dt)}`);
    const nativeFields = (dtRes.data?.data?.fields || []).map((f) => f.fieldname);
    if (nativeFields.includes(fieldname)) return true;
  } catch {
    // fall through to the Custom Field check
  }
  const res = await client.get("/api/resource/Custom Field", {
    params: {
      filters: JSON.stringify([["dt", "=", dt], ["fieldname", "=", fieldname]]),
      fields: JSON.stringify(["name"]),
      limit_page_length: 1,
    },
  });
  return (res.data?.data || []).length > 0;
}

async function installFixture(client, fixturePath) {
  const fields = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  let ok = true;
  for (const field of fields) {
    const { dt, fieldname } = field;
    try {
      if (await fieldExists(client, dt, fieldname)) {
        console.log(`✓ Custom Field "${dt}.${fieldname}" already exists — nothing to do.`);
        continue;
      }
      await client.post("/api/resource/Custom Field", field);
      console.log(`✓ Installed Custom Field "${dt}.${fieldname}".`);
    } catch (e) {
      ok = false;
      console.error(`✗ Failed to install Custom Field "${dt}.${fieldname}":`, e.response?.data || e.message);
      console.error(
        "\nIf this is a permissions error, the API key needs System Manager rights, or import it " +
        `manually via Frappe Desk → Customize Form → ${dt} → add "${fieldname}", or ` +
        `\`bench --site <site> import-doc ${path.relative(process.cwd(), fixturePath)}\`.`
      );
    }
  }
  return ok;
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
  for (const p of FIXTURE_PATHS) {
    if (!fs.existsSync(p)) {
      console.log(`(skip) ${path.basename(p)} not found in backend/data/.`);
      continue;
    }
    ok = (await installFixture(client, p)) && ok;
  }
  if (!ok) process.exit(1);
}

main();
