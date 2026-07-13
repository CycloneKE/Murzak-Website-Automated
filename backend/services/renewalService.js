// services/renewalService.js
//
// Recurring billing for a subscription business that (until now) only had
// one-shot invoices. A periodic sweep:
//   1. finds each account's LATEST Paid Subscription invoice,
//   2. when it is older than the billing cycle (default 30 days) and the
//      account has no open Subscription invoice, creates the renewal invoice
//      (Unpaid), logs a portal alert and emails the customer (best-effort),
//   3. optionally (RENEWAL_SUSPEND_ENABLED=true) suspends services when a
//      renewal stays unpaid past the grace window.
//
// Idempotency: the "no open Subscription invoice" check is the guard — the
// sweep can run any number of times without stacking invoices. Suspension is
// OFF by default so going live never surprises anyone with an automated
// cut-off; enable it once the renewal email flow is proven.

const { sendMail } = require("../utils/mailer");
const { sumSelectedServicesMonthlyKes } = require("./provisioning/catalog");

const DAY_MS = 24 * 60 * 60 * 1000;

function renewalConfig() {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    enabled: process.env.RENEWAL_ENABLED !== "false",
    cycleDays: num(process.env.RENEWAL_CYCLE_DAYS, 30),
    graceDays: num(process.env.RENEWAL_GRACE_DAYS, 7),
    suspendEnabled: process.env.RENEWAL_SUSPEND_ENABLED === "true",
    intervalMs: Math.max(15 * 60 * 1000, num(process.env.RENEWAL_INTERVAL_MS, 6 * 60 * 60 * 1000)),
  };
}

// Days elapsed since a Frappe date string ("YYYY-MM-DD" or datetime).
// Returns null when the date is missing/unparseable (treat as not due —
// never bill off garbage data).
function daysSince(dateStr, nowMs = Date.now()) {
  if (!dateStr) return null;
  const iso = String(dateStr).slice(0, 10);
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

function isDueForRenewal(lastPaidDateStr, cycleDays, nowMs = Date.now()) {
  const days = daysSince(lastPaidDateStr, nowMs);
  return days != null && days >= cycleDays;
}

function isPastGrace(invoiceDateStr, graceDays, nowMs = Date.now()) {
  const days = daysSince(invoiceDateStr, nowMs);
  return days != null && days > graceDays;
}

// rows: Paid Subscription invoices, any order. Returns Map<web_account, row>
// keeping only the newest invoice_date per account.
function latestPaidByAccount(rows) {
  const latest = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const acc = r?.web_account;
    if (!acc) continue;
    const prev = latest.get(acc);
    if (!prev || String(r.invoice_date || "") > String(prev.invoice_date || "")) {
      latest.set(acc, r);
    }
  }
  return latest;
}

function portalBillingUrl() {
  const base = (process.env.APP_BASE_URL || "https://murzaktech.com").replace(/\/$/, "");
  return `${base}/portal`;
}

async function sendRenewalEmail({ to, clientName, plan, amountKes, invoiceNo }) {
  const subject = `Your Murzak ${plan} plan renewal — KES ${Number(amountKes).toLocaleString()}`;
  const url = portalBillingUrl();
  const text = `Hello ${clientName || "there"},

Your ${plan} plan is due for renewal. Invoice ${invoiceNo} for KES ${Number(amountKes).toLocaleString()} is ready in your portal.

Pay in a minute with M-Pesa or card: ${url}

Your services stay active while the invoice is open. If anything looks wrong, just reply to this email.

— Murzak Technologies`;
  await sendMail({ to, subject, text });
}

async function sendOverdueEmail({ to, clientName, plan, amountKes, invoiceNo, suspended }) {
  const subject = suspended
    ? `Action needed: your Murzak ${plan} services are paused`
    : `Reminder: your Murzak ${plan} renewal is overdue`;
  const url = portalBillingUrl();
  const text = `Hello ${clientName || "there"},

Invoice ${invoiceNo} (KES ${Number(amountKes).toLocaleString()}) for your ${plan} plan is still unpaid.
${suspended
  ? "Your services have been paused. Pay the invoice and they will be restored right away — your data is safe."
  : "Please settle it to keep your services running without interruption."}

Pay with M-Pesa or card: ${url}

— Murzak Technologies`;
  await sendMail({ to, subject, text });
}

// Main sweep. deps carries the server.js helpers/constants so this module
// stays testable and free of duplicated field names.
async function sweepRenewals(deps) {
  const {
    frappeClient,
    PORTAL_INVOICE_SERVICES_FIELD,
    WEB_ACCOUNT_SERVICES_FIELD,
    CHILD_SERVICE_ID_FIELD,
    CHILD_SERVICE_NAME_FIELD,
    CHILD_TIER_FIELD,
    CHILD_DOMAIN_CHOICE_FIELD,
    CHILD_STATUS_FIELD,
    buildInvoiceServiceRows,
    logPortalUpdate,
  } = deps;

  const cfg = renewalConfig();
  if (!cfg.enabled) return { ok: true, skipped: "disabled" };

  const client = frappeClient();
  const summary = { created: 0, suspended: 0, errors: 0 };

  // ---- 1) Create renewal invoices for accounts past the cycle ----
  try {
    const paidRes = await client.get("/api/resource/Portal Invoice", {
      params: {
        filters: JSON.stringify([
          ["type", "=", "Subscription"],
          ["status", "=", "Paid"],
        ]),
        fields: JSON.stringify(["name", "web_account", "plan", "amount", "invoice_date"]),
        limit_page_length: 500,
        order_by: "invoice_date desc",
      },
    });

    const latest = latestPaidByAccount(paidRes.data?.data);

    for (const [webAccount, lastPaid] of latest) {
      try {
        if (!isDueForRenewal(lastPaid.invoice_date, cfg.cycleDays)) continue;

        // Idempotency guard: never stack a second open Subscription invoice.
        const openRes = await client.get("/api/resource/Portal Invoice", {
          params: {
            filters: JSON.stringify([
              ["web_account", "=", webAccount],
              ["type", "=", "Subscription"],
              ["status", "in", ["Unpaid", "Pending", "Draft"]],
            ]),
            fields: JSON.stringify(["name"]),
            limit_page_length: 1,
          },
        });
        if (openRes.data?.data?.[0]) continue;

        const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`);
        const account = accRes.data?.data;
        if (!account) continue;

        const plan = account.plan || lastPaid.plan;
        const serviceRows = (Array.isArray(account[WEB_ACCOUNT_SERVICES_FIELD]) ? account[WEB_ACCOUNT_SERVICES_FIELD] : [])
          .map((r) => ({
            serviceId: r?.[CHILD_SERVICE_ID_FIELD],
            serviceName: r?.[CHILD_SERVICE_NAME_FIELD] || "",
            tier: r?.[CHILD_TIER_FIELD] || "",
            domainChoice: r?.[CHILD_DOMAIN_CHOICE_FIELD] || "",
            status: r?.[CHILD_STATUS_FIELD] || "Active",
          }))
          .filter((s) => s.serviceId);

        // Bill the sum of what's actually on the account (catalog snapshot —
        // same source the configurator/checkout price from), not a flat
        // per-plan-tier rate. Test/Enterprise/None have no self-serve price
        // (their services aren't in the volume/premium catalog) — never
        // auto-bill them.
        const amount = sumSelectedServicesMonthlyKes(serviceRows);
        if (!(amount > 0)) continue;
        if (String(account.account_status || "").toLowerCase() === "cancelled") continue;

        const today = new Date().toISOString().slice(0, 10);

        const invoiceNo = `REN-${today.replace(/-/g, "")}-${String(webAccount).slice(-6)}`;
        const created = await client.post("/api/resource/Portal Invoice", {
          web_account: webAccount,
          client_name: account.account_holder_name || "",
          invoice_no: invoiceNo,
          type: "Subscription",
          plan,
          amount,
          status: "Unpaid",
          invoice_date: today,
          [PORTAL_INVOICE_SERVICES_FIELD]: buildInvoiceServiceRows(serviceRows),
        });
        summary.created++;
        console.log(`[renewal] created ${created.data?.data?.name || invoiceNo} for ${webAccount} (${plan}, KES ${amount})`);

        await logPortalUpdate(client, webAccount, {
          type: "alert",
          engineer: "Murzak Billing",
          content: `Your ${plan} plan renewal invoice is ready — KES ${Number(amount).toLocaleString()}. Pay from the Billing tab to keep services running.`,
        });

        if (account.work_email) {
          try {
            await sendRenewalEmail({
              to: account.work_email,
              clientName: account.account_holder_name,
              plan,
              amountKes: amount,
              invoiceNo,
            });
          } catch (e) {
            console.warn(`[renewal] email failed for ${webAccount}:`, e.message);
          }
        }
      } catch (e) {
        summary.errors++;
        console.warn(`[renewal] account ${webAccount} failed:`, e.response?.data || e.message);
      }
    }
  } catch (e) {
    summary.errors++;
    console.warn("[renewal] paid-invoice scan failed:", e.response?.data || e.message);
  }

  // ---- 2) Grace-window enforcement (opt-in) ----
  if (cfg.suspendEnabled) {
    try {
      const overdueRes = await client.get("/api/resource/Portal Invoice", {
        params: {
          filters: JSON.stringify([
            ["type", "=", "Subscription"],
            ["status", "=", "Unpaid"],
          ]),
          fields: JSON.stringify(["name", "web_account", "plan", "amount", "invoice_no", "invoice_date"]),
          limit_page_length: 200,
        },
      });

      for (const inv of overdueRes.data?.data || []) {
        try {
          if (!inv.web_account || !isPastGrace(inv.invoice_date, cfg.graceDays)) continue;

          const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(inv.web_account)}`);
          const account = accRes.data?.data;
          if (!account) continue;
          if (String(account.account_status || "").toLowerCase() === "suspended") continue; // idempotent

          const rows = Array.isArray(account[WEB_ACCOUNT_SERVICES_FIELD]) ? account[WEB_ACCOUNT_SERVICES_FIELD] : [];
          const updated = rows.map((r) =>
            String(r?.[CHILD_STATUS_FIELD] || "") === "Active"
              ? { ...r, [CHILD_STATUS_FIELD]: "Suspended" }
              : r
          );
          await client.put(`/api/resource/Web Account/${encodeURIComponent(inv.web_account)}`, {
            account_status: "Suspended",
            [WEB_ACCOUNT_SERVICES_FIELD]: updated,
          });
          summary.suspended++;
          console.warn(`[renewal] suspended ${inv.web_account} (invoice ${inv.name} past ${cfg.graceDays}d grace)`);

          await logPortalUpdate(client, inv.web_account, {
            type: "alert",
            engineer: "Murzak Billing",
            content: `Services paused: renewal invoice ${inv.invoice_no || inv.name} is past its grace window. Pay it to restore services immediately — your data is safe.`,
          });
          if (account.work_email) {
            try {
              await sendOverdueEmail({
                to: account.work_email,
                clientName: account.account_holder_name,
                plan: inv.plan,
                amountKes: inv.amount,
                invoiceNo: inv.invoice_no || inv.name,
                suspended: true,
              });
            } catch (e) {
              console.warn(`[renewal] overdue email failed for ${inv.web_account}:`, e.message);
            }
          }
        } catch (e) {
          summary.errors++;
          console.warn(`[renewal] overdue check failed for ${inv.name}:`, e.response?.data || e.message);
        }
      }
    } catch (e) {
      summary.errors++;
      console.warn("[renewal] overdue scan failed:", e.response?.data || e.message);
    }
  }

  if (summary.created || summary.suspended) {
    console.log(`[renewal] sweep done: ${summary.created} invoice(s) created, ${summary.suspended} account(s) suspended`);
  }
  return { ok: true, ...summary };
}

module.exports = {
  sweepRenewals,
  renewalConfig,
  // exported for tests
  daysSince,
  isDueForRenewal,
  isPastGrace,
  latestPaidByAccount,
};
