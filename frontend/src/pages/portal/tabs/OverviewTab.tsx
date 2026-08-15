import React from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CreditCard,
  Crown,
  DollarSign,
  Download,
  FileText,
  Headphones,
  Plus,
  Server,
  UploadCloud,
  X,
} from "lucide-react";
import ActivityTimeline, { TimelineEvent } from "../../../components/portal/ActivityTimeline";
import EmptyState from "../../../components/portal/EmptyState";
import MetricCard from "../../../components/portal/MetricCard";
import ResourceUtilizationCard from "../../../components/portal/ResourceUtilizationCard";
import SecurityOverviewCard from "../../../components/portal/SecurityOverviewCard";
import ServiceHealthCard, { ServiceHealth } from "../../../components/portal/ServiceHealthCard";
import { classifyActivity } from "../helpers";
import { usePortal } from "../PortalContext";

const OverviewTab: React.FC = () => {
  const {
    goToAddServices,
    handleGeneralUpload,
    handleServiceHealthAction,
    localInvoices,
    localUpdates,
    onTabClick,
    pendingServiceAction,
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

  // Provisioning view unchanged (kept, trimmed)
  if (user.accountStatus === "Provisioning" && provisionProgress < 100) {
    return (
      <div className="space-y-12 animate-fade-in">
        <div className="bg-white/80 dark:bg-white/5 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl shadow-lg sm:shadow-2xl lg:shadow-3xl p-6 sm:p-10 lg:p-16 rounded-[2.25rem] sm:rounded-[3rem] lg:rounded-[4rem] border border-slate-100 dark:border-murzak-border/50 relative overflow-hidden">
          <div className="max-w-4xl relative z-10">
            <div className="inline-flex items-center gap-3 bg-murzak-accent/10 text-murzak-accent px-4 py-2 rounded-full border border-murzak-accent/20 mb-8">
              <Activity className="w-4 h-4 animate-pulse" />
              <span className="text-micro font-black uppercase">Live Launch Progress</span>
            </div>

            <h2 className="text-xl sm:text-2xl lg:text-3xl font-[900] tracking-tighter uppercase leading-[0.9] mb-4">
              Setting up <br />
              <span className="text-murzak-accent">Your System.</span>
            </h2>

            <div className="space-y-4">
              <div className="flex justify-between items-end mb-2">
                <span className="text-micro font-black uppercase text-murzak-accent">
                  Preparing...
                </span>
                <span className="text-2xl sm:text-4xl lg:text-5xl font-[900] tracking-tighter">
                  {provisionProgress}%
                </span>
              </div>
              <div className="h-4 w-full bg-slate-100 dark:bg-black/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-murzak-accent transition-all duration-500 ease-out"
                  style={{ width: `${provisionProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const onlineServiceCount = selectedServices.filter(s => s.status === 'Active').length;
  const hasDegradedService = selectedServices.some(s => s.status !== 'Active' && s.status !== 'Setting up');

  // Next-invoice estimate uses the same 30-day billing cycle the backend
  // already assumes for prorated credit (see computeProratedCreditKes in
  // server.js) — a real derivation from the last paid invoice's date, not a
  // hardcoded countdown.
  function nextInvoiceLabel(): string {
    const latest = localInvoices[0];
    if (!latest) return "—";
    if (latest.status === "Unpaid" || latest.status === "Overdue") return "Due Now";
    const paidDate = new Date(latest.date);
    if (Number.isNaN(paidDate.getTime())) return "—";
    const daysSincePaid = Math.floor((Date.now() - paidDate.getTime()) / 86400000);
    const daysRemaining = Math.max(0, 30 - daysSincePaid);
    return daysRemaining === 0 ? "Due Now" : `${daysRemaining} Days`;
  }

  const metricCards = [
    {
      title: "Active Services",
      value: onlineServiceCount,
      icon: <Server size={20} />
    },
    {
      title: "Monthly Spend",
      value: `KES ${Number(localInvoices.length > 0 && localInvoices[0]?.amount ? localInvoices[0].amount : 0).toLocaleString()}`,
      icon: <DollarSign size={20} />
    },
    {
      title: "Service Status",
      value: selectedServices.length ? `${onlineServiceCount}/${selectedServices.length} Online` : "—",
      icon: <Activity size={20} />,
      trend: selectedServices.length ? (hasDegradedService ? "Attention needed" : "Healthy") : undefined,
      trendUp: !hasDegradedService
    },
    {
      title: "Next Invoice",
      value: nextInvoiceLabel(),
      icon: <CreditCard size={20} />,
      actionLabel: nextInvoiceLabel() === "Due Now" ? "Pay Now" : undefined,
      onAction: nextInvoiceLabel() === "Due Now" ? () => onTabClick("billing") : undefined
    }
  ];

  const timelineEvents: TimelineEvent[] = localUpdates.slice(0, 5).map((u, i) => ({
    id: u.id,
    type: classifyActivity(u),
    title: u.engineer,
    description: u.content,
    timestamp: "Recent",
    status: "success"
  }));
  
  // Add a default welcome event if none
  if (timelineEvents.length === 0) {
    timelineEvents.push({
      id: "welcome",
      type: "account",
      title: "Account Created",
      description: "Welcome to Murzak Technologies. Your account is ready.",
      timestamp: "Just now",
      status: "success"
    });
  }

  const healthServices: ServiceHealth[] = selectedServices.map(s => ({
    id: s.serviceId,
    name: s.name,
    type: s.category || "Service",
    status: s.status === "Active" ? "online" : s.status === "Setting up" ? "provisioning" : "warning",
    capacityClass: s.capacityClass,
  }));

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Status band — the persistent page header already renders the "Welcome
          back" greeting, so this strip focuses on live status + quick actions
          instead of repeating it. */}
      <div className="glass-card rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 relative overflow-hidden group border border-murzak-border">
        <div className="absolute inset-0 bg-gradient-to-r from-murzak-ink to-transparent opacity-90 dark:opacity-50"></div>
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-20 bg-[url('/portal-hero-bg.webp')] bg-cover mix-blend-overlay blur-sm transition-transform duration-1000 group-hover:scale-105"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-black/5 rounded-full border border-white/20 backdrop-blur-md">
              <Crown className="w-4 h-4 text-murzak-accent" />
              <span className="text-micro font-black uppercase text-murzak-ink dark:text-slate-100">
                {user.plan} Plan
              </span>
            </div>
            <p className="text-body font-bold text-murzak-ink dark:text-slate-100">
              {selectedServices.length === 0
                ? "No services deployed yet"
                : hasDegradedService
                  ? `${onlineServiceCount}/${selectedServices.length} services online — some need attention`
                  : `${onlineServiceCount}/${selectedServices.length} services online — all healthy`}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {healthServices.filter(s => s.status === 'online').slice(0, 2).map((s) => (
              <button
                key={`quick-${s.id}`}
                onClick={() => onTabClick("cloud")}
                className="px-5 py-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent font-black text-micro uppercase border border-murzak-accent/20 hover:bg-murzak-accent hover:text-murzak-ink hover:shadow-[0_0_20px_rgba(0,189,252,0.3)] hover:scale-105 transition-all flex items-center gap-2 backdrop-blur-md"
              >
                <ArrowRight className="w-4 h-4" /> Open {s.name.split(' ')[0]}
              </button>
            ))}
            <button onClick={() => setIsContactOpen(true)} className="px-5 py-3 rounded-2xl bg-black/5 text-murzak-ink dark:text-slate-100 font-black text-micro uppercase border border-white/20 hover:bg-white/20 transition-all flex items-center gap-2 backdrop-blur-md">
              <Headphones className="w-4 h-4" /> Get Support
            </button>
          </div>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricCards.map((metric, i) => (
          <MetricCard key={i} {...metric} />
        ))}
      </div>

      {serviceActionNotice && (
        <div className={`px-6 py-4 rounded-2xl border text-label font-bold flex items-center justify-between gap-4 ${
          serviceActionNotice.type === "success"
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-400"
        }`}>
          <span>{serviceActionNotice.text}</span>
          <button onClick={() => setServiceActionNotice(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Dashboard Area */}
        <div className="lg:col-span-2 space-y-8">
          {/* System Health */}
          <div className="glass-panel p-8 rounded-[3rem] border border-murzak-border">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-[12px] font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100">System Health</h3>
                <p className="text-micro font-medium text-slate-600 dark:text-slate-400 mt-1">Live status of your active infrastructure</p>
              </div>
              <button onClick={() => onTabClick("cloud")} className="text-murzak-accent hover:text-murzak-ink transition-colors p-2">
                <ArrowRight size={20} />
              </button>
            </div>

            {healthServices.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {healthServices.map(service => (
                  <ServiceHealthCard
                    key={service.id}
                    service={service}
                    onAction={handleServiceHealthAction}
                    pendingAction={pendingServiceAction?.id === service.id ? pendingServiceAction.action : null}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 rounded-[2rem] border border-dashed border-murzak-border bg-black/5">
                <Server className="w-8 h-8 text-slate-500 mx-auto mb-4" />
                <p className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-2">No Active Services</p>
                <p className="text-micro text-slate-600 dark:text-slate-400 max-w-xs mx-auto mb-6">You don't have any infrastructure running yet.</p>
                <button onClick={goToAddServices} className="px-6 py-3 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-105 transition-all inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Deploy Services
                </button>
              </div>
            )}
          </div>

          {/* New Insights Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <SecurityOverviewCard />
            <ResourceUtilizationCard
              diskUsagePercent={serviceUsage.diskUsagePercent}
              ramUsagePercent={serviceUsage.ramUsagePercent}
            />
          </div>

          {/* General Upload */}
          <div className="glass-panel p-8 rounded-[3rem] border border-murzak-border">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-[12px] font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100">Project Files</h3>
                <p className="text-micro font-medium text-slate-600 dark:text-slate-400 mt-1">Upload assets for engineers</p>
              </div>
              <label className="cursor-pointer px-4 py-2 rounded-xl bg-black/5 hover:bg-white/20 text-murzak-ink dark:text-slate-100 font-black text-micro uppercase transition-all inline-flex items-center gap-2">
                <UploadCloud className="w-4 h-4" />
                {uploading ? "Uploading..." : "Upload"}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    handleGeneralUpload(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            
            {uploadErr && (
              <div className="mb-4 text-micro font-black uppercase text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {uploadErr}
              </div>
            )}

            {uploadedFiles.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {uploadedFiles.map((f) => (
                  <a
                    key={f.url}
                    href={`/api/portal/files?url=${encodeURIComponent(f.url)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-card p-3 rounded-xl flex items-center gap-2 hover:border-murzak-accent/50 transition-colors group"
                  >
                    <div className="p-2 bg-black/5 rounded-lg group-hover:bg-murzak-accent/10 group-hover:text-murzak-accent transition-colors">
                      <Download size={14} />
                    </div>
                    <span className="text-micro font-bold text-slate-600 dark:text-slate-400 truncate">{f.name}</span>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<FileText size={22} />}
                title="No files uploaded yet"
                description="Share configs, briefs, or credentials docs with your engineers — uploads stay attached to your account."
              />
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Activity Timeline */}
          <div className="glass-panel p-8 rounded-[3rem] border border-murzak-border h-full">
            <h3 className="text-[12px] font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100 mb-8">Activity Hub</h3>
            <ActivityTimeline events={timelineEvents} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
