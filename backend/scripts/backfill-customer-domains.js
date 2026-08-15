/**
 * backfill-customer-domains.js
 *
 * Creates the Customer Domain record for every domain an account already
 * holds, reading the three intake doctypes that used to BE the domain:
 *
 *   Hosting Domain Purchase Request     -> kind "registered"
 *   Hosting External Domain Connection  -> kind "external"
 *   Hosting Murzak Subdomain            -> kind "murzak_subdomain"
 *
 * Safe to re-run: ensureCustomerDomain is idempotent on
 * (web_account, normalized domain_name), so a second pass writes nothing.
 * Run install-missing-doctypes.js first so the doctype exists.
 *
 * Usage:
 *   node backend/scripts/backfill-customer-domains.js [--dry-run]
 */

require("dotenv").config();
const axios = require("axios");
const customerDomains = require("../services/customerDomains");

const DRY_RUN = process.argv.includes("--dry-run");

const FRAPPE_BASE_URL = process.env.FRAPPE_BASE_URL;
const FRAPPE_API_KEY = process.env.FRAPPE_API_KEY;
const FRAPPE_API_SECRET = process.env.FRAPPE_API_SECRET;

function frappeClient() {
  if (!FRAPPE_BASE_URL || !FRAPPE_API_KEY || !FRAPPE_API_SECRET) {
    throw new Error("FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET must be set.");
  }
  return axios.create({
    baseURL: FRAPPE_BASE_URL,
    headers: { Authorization: `token ${FRAPPE_API_KEY}:${FRAPPE_API_SECRET}` },
    timeout: 30000,
  });
}

/**
 * Each source: which doctype, which field holds the hostname, and the extra
 * columns worth carrying across. `status` is deliberately NOT copied — the
 * intake vocabularies differ from the Customer Domain one, and a domain whose
 * registration is still being fulfilled is "pending" by definition.
 */
const SOURCES = [
  {
    doctype: "Hosting Domain Purchase Request",
    hostField: "full_domain",
    extraFields: ["notes"],
    kind: customerDomains.DOMAIN_KINDS.REGISTERED,
  },
  {
    doctype: "Hosting External Domain Connection",
    hostField: "domain_name",
    extraFields: ["registrar", "verification_notes"],
    kind: customerDomains.DOMAIN_KINDS.EXTERNAL,
  },
  {
    doctype: "Hosting Murzak Subdomain",
    hostField: "full_subdomain",
    extraFields: ["notes"],
    kind: customerDomains.DOMAIN_KINDS.MURZAK_SUBDOMAIN,
  },
];

async function readAll(client, source) {
  const rows = [];
  const pageSize = 100;
  for (let start = 0; ; start += pageSize) {
    const res = await client.get(`/api/resource/${encodeURIComponent(source.doctype)}`, {
      params: {
        fields: JSON.stringify(["name", "web_account", source.hostField, ...source.extraFields]),
        limit_start: start,
        limit_page_length: pageSize,
        order_by: "creation asc",
      },
    });
    const page = res.data?.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

(async () => {
  const client = frappeClient();
  const totals = { created: 0, existing: 0, skipped: 0, failed: 0 };

  for (const source of SOURCES) {
    let rows;
    try {
      rows = await readAll(client, source);
    } catch (e) {
      // A site that never used a given intake type simply won't have the
      // doctype — not an error worth failing the whole backfill over.
      console.warn(`- ${source.doctype}: unreadable (${e.response?.status || e.message}) — skipping.`);
      continue;
    }
    console.log(`- ${source.doctype}: ${rows.length} row(s)`);

    for (const row of rows) {
      const host = row[source.hostField];
      const webAccount = row.web_account;
      if (!webAccount || !customerDomains.isValidDomainName(host)) {
        totals.skipped++;
        console.warn(`    skip ${row.name}: account=${webAccount || "?"} host=${JSON.stringify(host)}`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`    would ensure ${customerDomains.normalizeDomainName(host)} (${source.kind}) for ${webAccount}`);
        continue;
      }
      try {
        const { created } = await customerDomains.ensureCustomerDomain(client, {
          webAccount,
          domainName: host,
          kind: source.kind,
          status: "pending",
          registrar: row.registrar,
          sourceDoctype: source.doctype,
          sourceName: row.name,
          notes: row.notes || row.verification_notes || "",
        });
        if (created) {
          totals.created++;
          console.log(`    + ${customerDomains.normalizeDomainName(host)} (${source.kind}) -> ${webAccount}`);
        } else {
          totals.existing++;
        }
      } catch (e) {
        totals.failed++;
        console.error(`    ! ${row.name}: ${e.response?.data?.exception || e.message}`);
      }
    }
  }

  // --- Link existing Hosting Sites to the domain they serve ---
  // ensurePendingHostingSiteForRequest only sets customer_domain when a
  // request touches the site, so sites created before domains were
  // account-owned would stay orphaned indefinitely. Their primary_host is the
  // same hostname, so they can be matched here once.
  console.log("\n- Hosting Site: linking to owned domains");
  const linkTotals = { linked: 0, already: 0, unmatched: 0, failed: 0 };
  try {
    const sites = await client.get("/api/resource/Hosting Site", {
      params: {
        fields: JSON.stringify(["name", "web_account", "primary_host", "customer_domain"]),
        limit_page_length: 500,
      },
    });
    for (const site of sites.data?.data || []) {
      if (site.customer_domain) { linkTotals.already++; continue; }
      const host = customerDomains.normalizeDomainName(site.primary_host);
      if (!site.web_account || !host) { linkTotals.unmatched++; continue; }

      if (DRY_RUN) {
        console.log(`    would link site ${site.name} (${host}) -> the ${host} domain for ${site.web_account}`);
        continue;
      }
      try {
        const domain = await customerDomains.findCustomerDomainByName(client, site.web_account, host);
        if (!domain) {
          linkTotals.unmatched++;
          console.warn(`    ? ${site.name}: no owned domain matches ${host}`);
          continue;
        }
        await client.put(`/api/resource/Hosting Site/${encodeURIComponent(site.name)}`, {
          customer_domain: domain.id,
        });
        linkTotals.linked++;
        console.log(`    ~ ${site.name} (${host}) -> ${domain.id}`);
      } catch (e) {
        linkTotals.failed++;
        console.error(`    ! ${site.name}: ${e.response?.data?.exception || e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  Hosting Site unreadable (${e.response?.status || e.message}) — skipping link pass.`);
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] " : ""}domains: created=${totals.created} already-present=${totals.existing} ` +
      `skipped=${totals.skipped} failed=${totals.failed}`
  );
  console.log(
    `${DRY_RUN ? "[dry run] " : ""}sites:   linked=${linkTotals.linked} already-linked=${linkTotals.already} ` +
      `unmatched=${linkTotals.unmatched} failed=${linkTotals.failed}`
  );
  if (totals.failed > 0 || linkTotals.failed > 0) process.exit(1);
})().catch((e) => {
  console.error("BACKFILL FAILED:", e.response?.data || e.message);
  process.exit(1);
});
