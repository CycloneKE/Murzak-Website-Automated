import React from "react";
import { AlertCircle, ChevronRight, Download, FileText, Headphones, Plus, Server, UploadCloud, X } from "lucide-react";
import ActivityTimeline, { TimelineEvent } from "../../../components/portal/ActivityTimeline";
import ResourceList from "../../../components/portal/ResourceList";
import ResourceUtilizationCard from "../../../components/portal/ResourceUtilizationCard";
import SecurityOverviewCard from "../../../components/portal/SecurityOverviewCard";
import CompleteSetupCards from "../../../components/CompleteSetupCards";
import { Empty, PageHeader, Panel, PButton, StatusPill, statusTone } from "../../../components/portal/ui";
import { classifyActivity, servicePath } from "../helpers";
import { usePortal } from "../PortalContext";
import { formatKes, getService, isYearlyBilled } from "../../../config/serviceCatalog";

// Concrete "getting started" suggestions for the zero-service empty state
// below: a small, fixed set of real catalog ids (a hosting product, a managed
// business system, a domain) so a brand-new account sees specific next steps
// instead of one generic button. Every name/price rendered from these is
// resolved live via getService() from serviceCatalog.ts, so nothing here is
// invented copy or a hardcoded number.
const EMPTY_STATE_SUGGESTION_IDS = ["starter-web-hosting", "biz-erp-light", "domain-com"];

const OverviewTab: React.FC = () => {
  const {
    goToAddServices,
    handleGeneralUpload,
    isTestUser,
    localInvoices,
    localUpdates,
    navigate,
    onTabClick,
    openAddonsModal,
    buyOfferedDomain,
    provisionProgress,
    selectedServices,
    serviceActionNotice,
    serviceUsage,
    setIsContactOpen,
    setServiceActionNotice,
    uploadErr,
    uploadedFiles,
    uploading,
    user,
  } = usePortal();

  const firstName = (user.name || "there").split(" ")[0];

  if (user.accountStatus === "Provisioning" && provisionProgress < 100) {
    return (
      <div>
        <PageHeader title="Setting up your system" description="This usually takes a few minutes. You can leave this page open." />
        <Panel>
          <div className="flex items-end justify-between mb-2">
            <span className="text-sm text-p-muted">Preparing…</span>
            <span className="text-2xl font-semibold tabular-nums">{provisionProgress}%</span>
          </div>
          <div
            className="h-2 w-full bg-p-panel-2 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={provisionProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-p-accent transition-all duration-500 ease-out" style={{ width: `${provisionProgress}%` }} />
          </div>
        </Panel>
      </div>
    );
  }

  const onlineServiceCount = selectedServices.filter((s) => s.status === "Active").length;
  // Sums every currently Active service's real catalog price — NOT
  // localInvoices[0]?.amount, which only ever read the FIRST invoice ever
  // issued. Uses the same 'Active' predicate as onlineServiceCount above so
  // the two numbers never disagree about what's actually running.
  const monthlySpendKes = selectedServices
    .filter((s) => s.status === "Active")
    .reduce((sum, s) => sum + (getService(s.serviceId)?.pricing.monthlyKes || 0), 0);

  // Next-invoice estimate uses the same 30-day billing cycle the backend
  // already assumes for prorated credit (see computeProratedCreditKes in
  // server.js) — a real derivation from the last paid invoice's date, not a
  // hardcoded countdown.
  function nextInvoiceLabel(): string {
    const latest = localInvoices[0];
    if (!latest) return "—";
    if (latest.status === "Unpaid" || latest.status === "Overdue") return "Due now";
    const paidDate = new Date(latest.date);
    if (Number.isNaN(paidDate.getTime())) return "—";
    const daysSincePaid = Math.floor((Date.now() - paidDate.getTime()) / 86400000);
    const daysRemaining = Math.max(0, 30 - daysSincePaid);
    return daysRemaining === 0 ? "Due now" : `In ${daysRemaining} days`;
  }
  const nextInvoice = nextInvoiceLabel();

  const stats: { label: string; value: React.ReactNode; action?: { label: string; onClick: () => void } }[] = [
    { label: "Services running", value: selectedServices.length ? `${onlineServiceCount} of ${selectedServices.length}` : "0" },
    { label: "Monthly cost", value: `KES ${monthlySpendKes.toLocaleString()}` },
    {
      label: "Next invoice",
      value: nextInvoice,
      action: nextInvoice === "Due now" ? { label: "Pay now", onClick: () => onTabClick("billing") } : undefined,
    },
  ];

  // Anything that isn't simply running: unpaid, still being set up, or stopped.
  const needsAttention = selectedServices.filter((s) => s.status !== "Active");

  const timelineEvents: TimelineEvent[] = localUpdates.slice(0, 5).map((u) => ({
    id: u.id,
    type: classifyActivity(u),
    title: u.engineer,
    description: u.content,
    timestamp: "Recent",
    status: "success",
  }));
  if (timelineEvents.length === 0) {
    timelineEvents.push({
      id: "welcome",
      type: "account",
      title: "Account created",
      description: "Welcome to Murzak Technologies. Your account is ready.",
      timestamp: "Just now",
      status: "success",
    });
  }

  // Resolved from the catalog every render (not hardcoded) so a suggestion
  // can never show a stale name/price if the catalog changes; filters out
  // any id that stops resolving instead of rendering a broken chip.
  const emptyStateSuggestions = EMPTY_STATE_SUGGESTION_IDS
    .map((id) => getService(id))
    .filter((svc): svc is NonNullable<ReturnType<typeof getService>> => Boolean(svc));

  const openService = (id: string) => {
    const svc = selectedServices.find((s) => s.serviceId === id);
    navigate(svc?.status === "Awaiting Payment" ? "/portal/billing" : servicePath(id));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={[user.company, isTestUser ? "Free trial" : `${user.plan} plan`].filter(Boolean).join(" · ")}
        actions={
          <>
            <PButton icon={<Headphones className="w-4 h-4" />} onClick={() => setIsContactOpen(true)}>
              Get help
            </PButton>
            <PButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => openAddonsModal("overview")}>
              Add a service
            </PButton>
          </>
        }
      />

      <dl className="grid grid-cols-1 sm:grid-cols-3 rounded-lg border border-p-border bg-p-panel divide-y sm:divide-y-0 sm:divide-x divide-p-border">
        {stats.map((s) => (
          <div key={s.label} className="px-4 sm:px-5 py-3.5">
            <dt className="text-[13px] text-p-muted">{s.label}</dt>
            <dd className="mt-1 flex items-center gap-3">
              <span className="text-lg font-semibold tabular-nums text-p-text">{s.value}</span>
              {s.action && (
                <PButton size="sm" variant="primary" onClick={s.action.onClick}>{s.action.label}</PButton>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {serviceActionNotice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            serviceActionNotice.type === "success"
              ? "border-p-success/40 bg-p-success-soft text-p-text"
              : "border-p-danger/40 bg-p-danger-soft text-p-text"
          }`}
        >
          <span>{serviceActionNotice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setServiceActionNotice(null)} className="p-1 rounded-md text-p-muted hover:text-p-text">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {needsAttention.length > 0 && (
        <Panel title="Needs your attention" flush>
          <ul className="divide-y divide-p-border">
            {needsAttention.map((s) => (
              <li key={s.serviceId}>
                <button
                  type="button"
                  onClick={() => openService(s.serviceId)}
                  className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-p-panel-2"
                >
                  <span className="min-w-0 grow">
                    <span className="block text-sm font-medium text-p-text truncate">{s.name}</span>
                    <span className="block text-[13px] text-p-muted">
                      {s.status === "Awaiting Payment"
                        ? "Pay its invoice to start it."
                        : s.status === "Setting up"
                          ? "We're setting this up. Nothing for you to do."
                          : "Open it to see what's needed."}
                    </span>
                  </span>
                  <StatusPill tone={statusTone(s.status)}>{s.status === "Awaiting Payment" ? "Awaiting payment" : s.status}</StatusPill>
                  <ChevronRight className="w-4 h-4 shrink-0 text-p-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <CompleteSetupCards onChoose={(serviceId) => openAddonsModal("overview", serviceId)} onChooseDomain={buyOfferedDomain} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          {selectedServices.length > 0 ? (
            <ResourceList title="Your services" services={selectedServices} onSelect={openService} />
          ) : (
            <Panel title="Your services">
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto mb-3 rounded-md border border-p-border bg-p-panel-2 text-p-muted flex items-center justify-center">
                  <Server className="w-5 h-5" />
                </div>
                <p className="text-sm font-semibold text-p-text">No Active Services</p>
                <p className="mt-1 text-[13px] text-p-muted">Your account is ready. Here's what you can add.</p>

                {emptyStateSuggestions.length > 0 && (
                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
                    {emptyStateSuggestions.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={goToAddServices}
                        title={svc.description}
                        className="text-left px-4 py-3 rounded-lg border border-p-border bg-p-panel hover:border-p-accent"
                      >
                        <span className="block text-sm font-medium text-p-text truncate">{svc.name}</span>
                        <span className="block text-[13px] text-p-accent-text mt-0.5">
                          {formatKes(svc.pricing.monthlyKes)}{svc.pricing.monthlyKes != null ? (isYearlyBilled(svc) ? "/yr" : "/mo") : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <PButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={goToAddServices} className="mt-5">
                  Browse all services
                </PButton>
              </div>
            </Panel>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <SecurityOverviewCard />
            <ResourceUtilizationCard
              diskUsagePercent={serviceUsage.diskUsagePercent}
              ramUsagePercent={serviceUsage.ramUsagePercent}
            />
          </div>

          <Panel
            title="Project files"
            description="Share briefs, logos or documents with our engineers."
            actions={
              <label className="p-tap cursor-pointer inline-flex items-center gap-2 rounded-md border border-p-border bg-p-panel px-3.5 text-sm font-medium text-p-text hover:bg-p-panel-2 has-focus-visible:outline-2 has-focus-visible:outline-p-accent">
                <UploadCloud className="w-4 h-4" />
                {uploading ? "Uploading..." : "Upload"}
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    handleGeneralUpload(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            }
          >
            {uploadErr && (
              <p role="alert" className="mb-3 text-[13px] text-p-danger flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {uploadErr}
              </p>
            )}
            {uploadedFiles.length > 0 ? (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {uploadedFiles.map((f) => (
                  <li key={f.url}>
                    <a
                      href={`/api/portal/files?url=${encodeURIComponent(f.url)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-md border border-p-border px-3 py-2 text-sm text-p-text hover:bg-p-panel-2"
                    >
                      <Download className="w-4 h-4 shrink-0 text-p-muted" />
                      <span className="truncate">{f.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty
                icon={<FileText />}
                title="No files uploaded yet"
                description="Uploads stay attached to your account."
              />
            )}
          </Panel>
        </div>

        <Panel title="Recent activity" className="self-start">
          <ActivityTimeline events={timelineEvents} />
        </Panel>
      </div>
    </div>
  );
};

export default OverviewTab;
