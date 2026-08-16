import React from "react";
import { ArrowUpCircle, Crown, Download, Loader2, Lock, Plus, Receipt, Server, Terminal, Trash2, Zap } from "lucide-react";
import EmptyState from "../../../components/portal/EmptyState";
import { deleteInvoice } from "../../../services/invoices";
import { downloadInvoicePdf, downloadAllInvoicesZip } from "../../../services/invoicesDownload";
import { usePortal } from "../PortalContext";

const BillingTab: React.FC = () => {
  const {
    deletingId,
    downloadingAll,
    downloadingId,
    goToAddServices,
    goToUpgrade,
    includedSelectedCount,
    localInvoices,
    monthlyBurnKes,
    navigate,
    onRequestDelete,
    onTabClick,
    openAddonsModal,
    selectedServices,
    setDeletingId,
    setDeveloperUpsellSvc,
    setDownloadingAll,
    setDownloadingId,
    setLocalInvoices,
    user,
  } = usePortal();

  return (
    <div className="space-y-12 animate-fade-in max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-4 px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">
            Billing & Plans
          </h2>
          <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mt-4">
            Manage your subscription, services and invoices
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left Column: Plan + Actions */}
        <div className="xl:col-span-2 space-y-8">
          
          {/* Plan Card */}
          <div className="glass-card rounded-[3rem] p-8 sm:p-10 relative overflow-hidden group border border-murzak-border">
            <div className="absolute inset-0 bg-gradient-to-br from-murzak-ink to-murzak-ink/90 z-0"></div>
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-murzak-accent/20 blur-3xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none z-0"></div>
            
            <div className="absolute top-8 right-8 opacity-10 group-hover:scale-110 transition-transform duration-700 z-0">
              <Crown className="w-24 h-24 sm:w-32 sm:h-32 text-slate-100" />
            </div>

            {/* This card's background (above) is an unconditional dark gradient —
                a "black card" treatment that does not switch with the site theme.
                Its text must therefore always use the light palette; a `dark:`
                variant here means "near-black on near-black in light mode",
                which is what made the plan name and these two buttons
                unreadable in light mode. */}
            <div className="relative z-10 flex flex-col md:flex-row gap-8 justify-between">
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-black/5 rounded-full border border-white/20 mb-6 backdrop-blur-md">
                  <div className={`w-2 h-2 rounded-full ${user.accountStatus === 'Active' ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-orange-400 shadow-[0_0_8px_#fb923c]'}`}></div>
                  <span className="text-micro font-black uppercase text-slate-100">
                    {user.accountStatus} Subscription
                  </span>
                </div>

                <h3 className="text-4xl sm:text-5xl font-[900] tracking-tighter mb-2 uppercase text-slate-100">
                  {user.plan}
                </h3>
                <p className="text-micro font-bold text-slate-400 uppercase mb-8">
                  Monthly Billing • Next cycle in 14 days
                </p>

                <div className="flex gap-4">
                  <button onClick={goToUpgrade} className="px-6 py-4 rounded-2xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase shadow-[0_0_20px_rgba(0,189,252,0.3)] hover:scale-105 transition-all flex items-center gap-2">
                    <ArrowUpCircle className="w-4 h-4" /> Change Plan
                  </button>
                  <button onClick={() => openAddonsModal("billing")} className="px-6 py-4 rounded-2xl bg-black/5 text-slate-100 border border-white/20 font-black text-micro uppercase hover:bg-white/20 transition-all flex items-center gap-2 backdrop-blur-md">
                    <Plus className="w-4 h-4" /> Add Services
                  </button>
                </div>
              </div>

              <div className="bg-black/5 border border-murzak-border rounded-3xl p-6 backdrop-blur-md self-start min-w-[200px]">
                <p className="text-micro font-black uppercase text-slate-400 mb-2">Monthly Burn</p>
                <p className="text-3xl font-black text-murzak-accent tracking-tighter">KES {monthlyBurnKes.toLocaleString()}</p>
                <div className="mt-4 pt-4 border-t border-murzak-border flex justify-between items-center">
                  <span className="text-micro font-black uppercase text-slate-400">Services</span>
                  <span className="text-micro font-black text-slate-100">{includedSelectedCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Included Services List */}
          <div className="glass-panel rounded-[3rem] p-8 sm:p-10 border border-murzak-border">
            <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-800 dark:text-slate-100 mb-8 flex items-center gap-3">
              <Server className="w-5 h-5 text-murzak-accent" /> Provisioned Services
            </h3>

            <div className="space-y-4">
              {selectedServices.length === 0 ? (
                <EmptyState
                  icon={<Server size={22} />}
                  title="No services attached yet"
                  description="Add a service to this plan and it'll show up here with live status and billing."
                  actionLabel="Add Services"
                  onAction={goToAddServices}
                />
              ) : (
                selectedServices.map((s) => (
                  <div key={s.serviceId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-[2rem] bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border hover:border-murzak-accent/30 transition-colors group">
                    <div className="flex items-start sm:items-center gap-4">
                      <div className={`p-3 rounded-2xl ${s.status === 'Active' ? 'bg-murzak-accent/10 text-murzak-accent' : 'bg-orange-500/10 text-orange-500'}`}>
                        {s.status === 'Active' ? <Zap className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                      </div>
                      <div>
                        <button
                          type="button"
                          disabled={s.status !== "Active"}
                          onClick={() => {
                            if (s.status !== "Active") return;
                            onTabClick("cloud");
                            navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                          }}
                          className={`text-left text-sm font-black ${
                            s.status === "Active" ? "hover:text-murzak-accent" : "cursor-not-allowed"
                          } text-murzak-ink transition-colors`}
                        >
                          {s.name}
                        </button>
                        <p className="text-micro font-bold uppercase text-slate-600 dark:text-slate-400 mt-1">
                          {s.category || "Service"} {s.tier ? `• ${s.tier}` : ""} {s.domainChoice ? `• Domain: ${s.domainChoice}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <div className="flex items-center gap-3">
                        {/* bg-murzak-ink is a solid dark pill even in light mode
                            (only dark mode fades it to a transparent outline),
                            so its text must stay light in both — text-murzak-ink
                            in light mode was near-black on that near-black pill. */}
                        <button onClick={() => setDeveloperUpsellSvc(s.serviceId)} className="px-3 py-1.5 rounded-full bg-murzak-ink dark:bg-black/5 text-slate-100 border border-slate-200 dark:border-white/20 text-micro font-black uppercase flex items-center gap-1.5 hover:bg-slate-800 dark:hover:bg-white/20 transition shadow-[0_0_15px_rgba(0,189,252,0.15)] group-hover:shadow-[0_0_20px_rgba(0,189,252,0.3)]">
                          <Terminal className="w-3 h-3 text-murzak-accent" /> Developer Access
                        </button>
                        
                        {s.status === "Active" ? (
                          <span className="px-3 py-1.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 text-micro font-black uppercase flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> Active
                          </span>
                        ) : s.status === "Setting up" ? (
                          <span className="px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 text-micro font-black uppercase flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div> Setting Up
                          </span>
                        ) : (
                          <span className="px-3 py-1.5 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 text-micro font-black uppercase flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div> {s.status || "Pending"}
                          </span>
                        )}
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => onRequestDelete(s, "billing")}
                        className="p-2.5 rounded-xl bg-white/20 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-slate-500 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                        title="Remove service"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Invoices */}
        <div className="xl:col-span-1">
          <div className="glass-panel rounded-[3rem] p-8 border border-murzak-border h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-[12px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-widest flex items-center gap-3">
                <Receipt className="w-5 h-5 text-murzak-accent" /> Invoices
              </h3>
              <button
                onClick={async () => {
                  try {
                    setDownloadingAll(true);
                    await downloadAllInvoicesZip();
                  } catch (e: any) {
                    alert(e?.message || "Failed to download invoices.");
                  } finally {
                    setDownloadingAll(false);
                  }
                }}
                disabled={downloadingAll || localInvoices.length === 0}
                className="p-2 rounded-xl bg-white/20 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent hover:border-murzak-accent/30 hover:bg-murzak-accent/10 transition-all disabled:opacity-50"
                title="Download All"
              >
                {downloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar max-h-[600px]">
              {localInvoices.length === 0 ? (
                <EmptyState
                  icon={<Receipt size={22} />}
                  title="No transactions yet"
                  description="Invoices and payment history will show up here once your first bill is issued."
                />
              ) : (
                localInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-5 rounded-[1.75rem] bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border hover:border-murzak-accent/20 transition-all group relative overflow-hidden"
                  >
                    {/* Status accent line */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${inv.status === 'Paid' ? 'bg-green-500/50' : 'bg-orange-500/50'}`}></div>
                    
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-1">
                          {inv.date}
                        </p>
                        <p className="text-xs font-black text-murzak-ink dark:text-slate-100">
                          {(inv.type || "").toLowerCase().replace(/[^a-z]/g, "").includes("addon") ? "Add-on Invoice" : inv.type}
                        </p>
                        {inv.plan && (
                          <p className="text-micro font-bold text-murzak-accent uppercase mt-1">
                            {inv.plan}
                          </p>
                        )}
                      </div>
                      
                      <div className="text-right">
                        <p className="text-lg font-black tracking-tighter">
                          KES {Number(inv.amount || 0).toLocaleString()}
                        </p>
                        <span className={`inline-block mt-1 px-2.5 py-1 rounded-full text-micro font-black uppercase border ${
                          inv.status === 'Paid' 
                            ? 'bg-green-500/10 text-green-500 border-green-500/20' 
                            : 'bg-orange-500/10 text-orange-500 border-orange-500/20'
                        }`}>
                          {inv.status === 'Paid' ? 'Settled' : 'Pending'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t border-slate-200 dark:border-murzak-border">
                      {inv.status !== "Paid" && (
                        <button
                          onClick={() => navigate(`/payment/${encodeURIComponent(inv.docName)}`)}
                          className="flex-1 py-2.5 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-[1.02] transition-all text-center"
                        >
                          Pay Now
                        </button>
                      )}
                      
                      <button
                        type="button"
                        disabled={downloadingId === inv.id}
                        onClick={async () => {
                          try {
                            setDownloadingId(inv.id);
                            await downloadInvoicePdf(inv.docName);
                          } catch (e: any) {
                            alert(e?.message || "Failed to download invoice.");
                          } finally {
                            setDownloadingId(null);
                          }
                        }}
                        className={`p-2.5 rounded-xl border border-slate-200 dark:border-murzak-border bg-white/20 dark:bg-black/5 hover:border-murzak-accent/40 hover:bg-murzak-accent/10 transition-all ${inv.status === 'Paid' ? 'flex-1 flex justify-center items-center gap-2' : ''}`}
                      >
                        {downloadingId === inv.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                        ) : (
                          <>
                            <Download className="w-4 h-4 text-slate-500" />
                            {inv.status === 'Paid' && <span className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Download</span>}
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={deletingId === inv.id}
                        onClick={async () => {
                          const ok = window.confirm(`Delete invoice ${inv.id}?`);
                          if (!ok) return;

                          const prev = localInvoices;
                          setDeletingId(inv.id);
                          setLocalInvoices((xs) => xs.filter((x) => x.id !== inv.id));

                          try {
                            await deleteInvoice(inv.id);
                          } catch (e: any) {
                            setLocalInvoices(prev);
                            alert(e?.message || "Failed to delete invoice.");
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-murzak-border bg-white/20 dark:bg-black/5 hover:border-red-500/40 hover:bg-red-500/10 transition-all text-slate-500 hover:text-red-500"
                      >
                        {deletingId === inv.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillingTab;
