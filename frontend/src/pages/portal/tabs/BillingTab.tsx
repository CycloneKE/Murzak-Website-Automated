import React from "react";
import { ArrowUpCircle, Download, Plus, Receipt, Server, Trash2 } from "lucide-react";
import { DataTable, Empty, PageHeader, Panel, PButton, StatusPill, statusTone } from "../../../components/portal/ui";
import { servicePath } from "../helpers";
import { deleteInvoice } from "../../../services/invoices";
import { downloadInvoicePdf, downloadAllInvoicesZip } from "../../../services/invoicesDownload";
import { usePortal } from "../PortalContext";
import { toUserMessage } from "../../../services/errors";

const BillingTab: React.FC = () => {
  const {
    deletingId,
    downloadingAll,
    downloadingId,
    dueSubscriptionInvoice,
    goToAddServices,
    goToUpgrade,
    includedSelectedCount,
    localInvoices,
    monthlyBurnKes,
    navigate,
    openAddonsModal,
    selectedServices,
    setDeletingId,
    setDownloadingAll,
    setDownloadingId,
    setLocalInvoices,
    user,
  } = usePortal();

  // Honest billing-cycle line: this app has no confirmed renewal-date field on
  // the user record, and the exact server cycle length (RENEWAL_CYCLE_DAYS) is
  // a backend env var never sent to the client — so "renews in N days" would
  // be a guess dressed up as a fact. What IS real: whether a subscription
  // invoice is currently due, and when the account was last billed.
  const lastPaidSubscription = (localInvoices || [])
    .filter((inv: any) => String(inv?.type || "").toLowerCase().includes("subscription") && inv?.status === "Paid")
    .sort((a: any, b: any) => String(b?.date || "").localeCompare(String(a?.date || "")))[0];
  const billingCycleLine = dueSubscriptionInvoice
    ? "A subscription invoice is due. See Invoices below."
    : lastPaidSubscription
      ? `Billed monthly · last billed ${lastPaidSubscription.date}`
      : "Billed monthly";

  const invoiceLabel = (inv: any) =>
    (inv.type || "").toLowerCase().replace(/[^a-z]/g, "").includes("addon") ? "Add-on invoice" : inv.type;

  const downloadOne = async (inv: any) => {
    try {
      setDownloadingId(inv.id);
      await downloadInvoicePdf(inv.docName);
    } catch (e: any) {
      alert(toUserMessage(e, "Failed to download invoice."));
    } finally {
      setDownloadingId(null);
    }
  };

  const removeOne = async (inv: any) => {
    const ok = window.confirm(`Delete invoice ${inv.id}?`);
    if (!ok) return;
    const prev = localInvoices;
    setDeletingId(inv.id);
    setLocalInvoices((xs) => xs.filter((x) => x.id !== inv.id));
    try {
      await deleteInvoice(inv.id);
    } catch (e: any) {
      setLocalInvoices(prev);
      alert(toUserMessage(e, "Failed to delete invoice."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Billing" description="Your plan, what you're paying for, and your invoices." />

      <Panel
        title={
          <span className="inline-flex items-center gap-2.5">
            {user.plan} plan
            <StatusPill tone={statusTone(user.accountStatus)}>{user.accountStatus}</StatusPill>
          </span>
        }
        description={billingCycleLine}
        actions={
          <>
            <PButton icon={<Plus className="w-4 h-4" />} onClick={() => openAddonsModal("billing")}>
              Add services
            </PButton>
            <PButton variant="primary" icon={<ArrowUpCircle className="w-4 h-4" />} onClick={goToUpgrade}>
              Change plan
            </PButton>
          </>
        }
        flush
      >
        <dl className="grid grid-cols-2 divide-x divide-p-border">
          <div className="px-4 sm:px-5 py-3.5">
            <dt className="text-[13px] text-p-muted">Monthly cost</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">KES {monthlyBurnKes.toLocaleString()}</dd>
          </div>
          <div className="px-4 sm:px-5 py-3.5">
            <dt className="text-[13px] text-p-muted">Services</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{includedSelectedCount}</dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title="Invoices"
        flush
        actions={
          <PButton
            icon={<Download className="w-4 h-4" />}
            loading={downloadingAll}
            disabled={localInvoices.length === 0}
            onClick={async () => {
              try {
                setDownloadingAll(true);
                await downloadAllInvoicesZip();
              } catch (e: any) {
                alert(toUserMessage(e, "Failed to download invoices."));
              } finally {
                setDownloadingAll(false);
              }
            }}
          >
            Download all
          </PButton>
        }
      >
        <DataTable
          rows={localInvoices as any[]}
          rowKey={(inv) => inv.id}
          empty={
            <Empty
              icon={<Receipt />}
              title="No invoices yet"
              description="Invoices and payment history will show up here once your first bill is issued."
            />
          }
          columns={[
            {
              key: "what",
              header: "Invoice",
              primary: true,
              cell: (inv) => (
                <span>
                  {invoiceLabel(inv)}
                  {inv.plan ? <span className="font-normal text-p-muted"> · {inv.plan}</span> : null}
                </span>
              ),
            },
            { key: "date", header: "Date", className: "w-32", cell: (inv) => inv.date },
            {
              key: "amount",
              header: "Amount",
              className: "w-32",
              cell: (inv) => <span className="tabular-nums text-p-text">KES {Number(inv.amount || 0).toLocaleString()}</span>,
            },
            {
              key: "status",
              header: "Status",
              className: "w-28",
              cell: (inv) => (
                <StatusPill tone={inv.status === "Paid" ? "ok" : "warn"}>{inv.status === "Paid" ? "Paid" : "Unpaid"}</StatusPill>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              className: "w-56",
              cell: (inv) => (
                <span className="inline-flex items-center gap-1.5">
                  {inv.status !== "Paid" && (
                    <PButton size="sm" variant="primary" onClick={() => navigate(`/payment/${encodeURIComponent(inv.docName)}`)}>
                      Pay now
                    </PButton>
                  )}
                  <PButton
                    size="sm"
                    variant="ghost"
                    loading={downloadingId === inv.id}
                    icon={<Download className="w-4 h-4" />}
                    aria-label={`Download invoice ${inv.id}`}
                    title="Download PDF"
                    onClick={() => downloadOne(inv)}
                  />
                  <PButton
                    size="sm"
                    variant="ghost"
                    loading={deletingId === inv.id}
                    icon={<Trash2 className="w-4 h-4" />}
                    aria-label={`Delete invoice ${inv.id}`}
                    title="Delete invoice"
                    onClick={() => removeOne(inv)}
                  />
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title="What you're paying for" flush>
        <DataTable
          rows={selectedServices}
          rowKey={(s) => s.serviceId}
          rowLabel={(s) => `Open ${s.name}`}
          onRowClick={(s) => {
            if (s.status === "Active") navigate(servicePath(s.serviceId));
          }}
          empty={
            <Empty
              icon={<Server />}
              title="No services attached yet"
              description="Add a service to this plan and it'll show up here with its status."
              actionLabel="Add services"
              onAction={goToAddServices}
            />
          }
          columns={[
            { key: "name", header: "Service", primary: true, cell: (s) => <span title={s.name}>{s.name}</span> },
            {
              key: "type",
              header: "Type",
              cell: (s) =>
                [s.category || "Service", s.tier, s.domainChoice ? `Domain: ${s.domainChoice}` : ""].filter(Boolean).join(" · "),
            },
            {
              key: "status",
              header: "Status",
              className: "w-44",
              cell: (s) => (
                <StatusPill tone={statusTone(s.status)}>
                  {s.status === "Awaiting Payment" ? "Awaiting payment" : s.status || "Pending"}
                </StatusPill>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
};

export default BillingTab;
