// services/renewalService.js
//
// Recurring billing for a subscription business that (until now) only had
// one-shot invoices. A periodic sweep:
//   1. finds each account's LATEST Paid Subscription invoice,
//   2. when it is older than the billing cycle FOR THAT ACCOUNT'S TERM (see
//      billingTerm.js — "monthly" is 30 days by default, "annual" is 365
//      days at a 20% prepay discount; an account with no `billing_term` at
//      all is treated as monthly, which is every pre-existing customer) and
//      the account has no open Subscription invoice, creates the renewal
//      invoice (Unpaid), logs a portal alert and emails the customer
//      (best-effort),
//   3. optionally (RENEWAL_SUSPEND_ENABLED=true) suspends services when a
//      renewal stays unpaid past the grace window.
//
// Idempotency: the "no open Subscription invoice" check is the guard — the
// sweep can run any number of times without stacking invoices. Suspension is
// OFF by default so going live never surprises anyone with an automated
// cut-off; enable it once the renewal email flow is proven.

const { sendMail } = require("../utils/mailer");
const { sumSelectedServicesMonthlyKes, getServiceMeta } = require("./provisioning/catalog");
const {
  cycleDaysForTerm,
  renewalAmountForTerm,
  ANNUAL_CYCLE_DAYS,
} = require("./billingTerm");
const { readInvoiceBillingTerm } = require("./checkoutBillingTerm");

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

// DELIBERATE EXCLUSION, not an oversight — see the module docblock's billing
// note. Domain-registration products are priced and sold YEARLY per TLD
// (catalog `monthlyKes` on a domain row actually holds the yearly price — see
// frontend/src/config/serviceCatalog.ts's DOMAIN_CATALOG comment). This sweep
// bills every RENEWAL_CYCLE_DAYS (~30 days), so summing a domain row in here
// would re-charge a full year's price every month (~12x overcharge) and, with
// RENEWAL_SUSPEND_ENABLED, suspend the customer for not paying it.
//
// Domain fulfillment is manual in this phase (see design docs) and there is
// no real yearly-renewal billing pipeline yet — excluding domains from the
// automated monthly sweep is the safe interim behavior. A future phase must
// add real yearly-renewal handling for these; until then, do NOT remove this
// filter to "fix" a domain that looks like it's never being rebilled — that
// is the point.
function excludeDomainRegistrations(serviceRows) {
  return (Array.isArray(serviceRows) ? serviceRows : []).filter(
    (s) => getServiceMeta(s?.serviceId)?.category !== "Domain Registration"
  );
}

// rows: Paid Subscription invoices, any order. Returns Map<web_account, row>
// keeping only the newest invoice_date per account. On a same-day tie,
// breaks by `name` descending — the same tie-break
// checkoutBillingTerm.js's findLastPaidSubscriptionInvoice applies via its
// own order_by, so the two call sites can never disagree about which
// invoice is "the" last paid one for an account.
function latestPaidByAccount(rows) {
  const latest = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const acc = r?.web_account;
    if (!acc) continue;
    const prev = latest.get(acc);
    if (!prev) {
      latest.set(acc, r);
      continue;
    }
    const rDate = String(r.invoice_date || "");
    const prevDate = String(prev.invoice_date || "");
    if (rDate > prevDate || (rDate === prevDate && String(r.name || "") > String(prev.name || ""))) {
      latest.set(acc, r);
    }
  }
  return latest;
}

function portalBillingUrl() {
  if (!process.env.APP_BASE_URL && process.env.NODE_ENV === "production") {
    console.error("APP_BASE_URL is not set in production — renewal payment-link emails will link to the wrong domain.");
  }
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
        // Secondary tie-break so two paid Subscription invoices dated the
        // same day for the same account can never resolve inconsistently
        // between this bulk query and checkoutBillingTerm.js's
        // findLastPaidSubscriptionInvoice, which applies the same
        // name-desc tie-break — latestPaidByAccount below applies the same
        // rule in its own JS-side comparison as a second line of defense.
        order_by: "invoice_date desc, name desc",
      },
    });

    const latest = latestPaidByAccount(paidRes.data?.data);

    for (const [webAccount, lastPaid] of latest) {
      try {
        // Cheap pre-filter using the SHORTEST cycle across every billing term
        // (today: monthly 30d < annual 365d) — an account not yet due under
        // the shortest possible cycle cannot be due under ANY term, so this
        // is safe to run before we know the account's real term at all. This
        // restores the old fetch volume (one Web Account GET only for
        // accounts that could plausibly be due) instead of fetching every
        // account with a paid Subscription invoice on every sweep.
        // Math.min(...) IS THE POINT and is NOT the double-charge bug this
        // file already fixed once (see the comment below) — it only ever
        // makes the filter MORE permissive (checked against the shortest
        // cycle), never causes an early bill. Do NOT "simplify" this to
        // cfg.cycleDays alone — that would reject annual accounts here,
        // before the real, term-aware due-check below ever runs.
        if (!isDueForRenewal(lastPaid.invoice_date, Math.min(cfg.cycleDays, ANNUAL_CYCLE_DAYS))) continue;

        // The billing term no longer lives on the account at all — it's read
        // independently below via readInvoiceBillingTerm(client, lastPaid.name),
        // a single-document GET on the last paid invoice itself. This account
        // fetch exists only to get what invoice creation actually needs from
        // the account record (plan, selected_services, account_holder_name,
        // account_status) — it has no bearing on term correctness, so its
        // position relative to the real due-check below is no longer
        // load-bearing the way it once was.
        const accRes = await client.get(`/api/resource/Web Account/${encodeURIComponent(webAccount)}`);
        const account = accRes.data?.data;
        if (!account) continue;

        // The ONE safe read of this account's billing term: a
        // single-document GET on the last paid Subscription invoice itself,
        // never the bulk list query above (an unrecognized `billing_term`
        // column there would fail the query for every account in the sweep
        // — see C4). Used for BOTH the due-check cycle and the billed
        // amount below — there is no second, independently-read term to
        // disagree with it, which is what makes C2 structurally impossible
        // here now.
        const term = await readInvoiceBillingTerm(client, lastPaid.name);
        if (!isDueForRenewal(lastPaid.invoice_date, cycleDaysForTerm(term, cfg.cycleDays))) continue;

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

        const plan = account.plan || lastPaid.plan;
        const allServiceRows = (Array.isArray(account[WEB_ACCOUNT_SERVICES_FIELD]) ? account[WEB_ACCOUNT_SERVICES_FIELD] : [])
          .map((r) => ({
            serviceId: r?.[CHILD_SERVICE_ID_FIELD],
            serviceName: r?.[CHILD_SERVICE_NAME_FIELD] || "",
            tier: r?.[CHILD_TIER_FIELD] || "",
            domainChoice: r?.[CHILD_DOMAIN_CHOICE_FIELD] || "",
            status: r?.[CHILD_STATUS_FIELD] || "Active",
          }))
          .filter((s) => s.serviceId);

        // Domain-registration rows are deliberately excluded from the
        // automated monthly sum — see excludeDomainRegistrations() above.
        const serviceRows = excludeDomainRegistrations(allServiceRows);

        // Bill the sum of what's actually on the account (catalog snapshot —
        // same source the configurator/checkout price from), not a flat
        // per-plan-tier rate. Test/Enterprise/None have no self-serve price
        // (their services aren't in the volume/premium catalog) — never
        // auto-bill them.
        const monthlySum = sumSelectedServicesMonthlyKes(serviceRows);
        if (!(monthlySum > 0)) continue;
        // Annual-term accounts pay the discounted year up front; monthly-term
        // (and every legacy account with no billing_term) pay the monthly sum.
        const amount = renewalAmountForTerm(term, monthlySum);
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
          // Persisted so this invoice carries its own historical record of
          // the term it was billed under — a later change to the account's
          // CURRENT term (a future paid invoice with a different term) can
          // never retroactively alter what this one was actually billed as.
          billing_term: term,
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
  excludeDomainRegistrations,
};
