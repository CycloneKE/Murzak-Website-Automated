import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Database,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Shield,
  Terminal,
  Timer,
  X,
  Zap,
} from "lucide-react";

import Logo from "../../components/Logo";
import Contact from "../Contact";
import AddonsModal from "../../components/AddonsModal";
import AdminTabs from "../admin/AdminTabs";
import CommandPalette from "../../components/portal/CommandPalette";
import ConciergeWidget from "../../components/ConciergeWidget";
import LogConsole from "../../components/portal/LogConsole";
import OnboardingWizard from "../../components/portal/OnboardingWizard";
import { ScalingSettings } from "../../components/portal/ScalingSettings";
import { usePortal } from "./PortalContext";
import OverviewTab from "./tabs/OverviewTab";
import CloudTab from "./tabs/CloudTab";
import DomainsTab from "./tabs/DomainsTab";
import BillingTab from "./tabs/BillingTab";
import ProfileTab from "./tabs/ProfileTab";

/**
 * The portal chrome: sidebar nav, header, the single status-banner slot, the
 * route table, and every portal-level modal. Screen content lives in ./tabs.
 */
const PortalShell: React.FC = () => {
  const {
    accountSuspended, activeLogServiceId, activeTab, addonCandidates, addonsDisabledReason,
    addonsOpen, addonsSourceTab, adminUnread, allMenuItems, applyAddonsSelection, commandActions,
    deleteConfirmText, deleteError, deleteLoading, deleteTarget, developerUpsellError,
    developerUpsellSvc, dismissOnboarding, dueSubscriptionInvoice, handleDelete,
    handleDeveloperUpsell, isAdmin, isCommandPaletteOpen, isContactOpen, isSidebarOpen,
    isSystemsNavOpen, isTestUser, navigate, navigateToPricingUpgrade, needsTrialVerify,
    onLogout, onTabClick, openAddonsModal, performServiceAction, planAttachBanner,
    planAttachBannerTone, requestingDeveloper, scalingServiceId, selectedServices,
    setActiveLogServiceId, setAddonsOpen, setAdminUnread, setDeleteConfirmText, setDeleteTarget,
    setDeveloperUpsellSvc, setIsCommandPaletteOpen, setIsContactOpen, setIsSidebarOpen,
    setIsSystemsNavOpen, setScalingServiceId, setStopConfirmService, setUpgradePromptOpen,
    showOnboarding, stopConfirmService, trialActive, trialEndStr, trialExpired,
    trialVerifyInvoice, upgradePromptOpen, user,
  } = usePortal();

  return (
    <div className="h-[100dvh] bg-transparent flex overflow-hidden">
      {/* Sidebar */}
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-[100] w-72 sm:w-80 bg-white/95 dark:bg-murzak-ink/95 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl
                    border-r border-slate-100 dark:border-murzak-border/50 flex flex-col transition-transform duration-500 lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 sm:px-7 pt-6 sm:pt-8 pb-4 flex items-center justify-between">
          <Logo className="h-7 sm:h-8" />
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-500 p-2">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* User profile */}
        <button
          onClick={() => onTabClick("profile")}
          className="mx-4 sm:mx-6 mb-2 flex items-center gap-3 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-3 text-left hover:border-murzak-accent/40 transition-all"
        >
          <div className="shrink-0 w-11 h-11 rounded-xl bg-murzak-accent/15 text-sky-700 dark:text-murzak-accent flex items-center justify-center font-black text-sm">
            {(user.name || "U").split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-murzak-ink dark:text-slate-100 truncate">{user.name}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-murzak-accent/10 text-sky-700 dark:text-murzak-accent text-micro font-black uppercase">
                {user.plan || "No plan"}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${user.accountStatus === "Active" ? "bg-green-500" : "bg-orange-400"}`} />
              <span className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 truncate">{user.accountStatus}</span>
            </div>
          </div>
        </button>

        <nav className="flex-grow px-4 sm:px-6 space-y-1.5 mt-3 overflow-y-auto">
          {allMenuItems.map((item) => {
            if (item.id !== "cloud") {
              return (
                <button
                  key={item.id}
                  onClick={() => onTabClick(item.id)}
                  className={`w-full flex items-center gap-3.5 px-4 sm:px-5 py-3 sm:py-3.5 rounded-2xl text-micro sm:text-label font-black uppercase transition-all ${
                    activeTab === item.id
                      ? "bg-murzak-accent text-murzak-ink shadow-md sm:shadow-lg shadow-murzak-accent/20"
                      : "text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-black/5 hover:text-murzak-ink"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="flex-grow text-left">{item.label}</span>
                  {!!item.badge && (
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </button>
              );
            }

            // "My Systems" — expands to the account's real provisioned services
            // (selectedServices, derived above from the Frappe web account —
            // never fabricated). Sub-items reuse the same navigate(?service=)
            // pattern already used by the service cards in the Cloud tab.
            const hasServices = selectedServices.length > 0;
            return (
              <div key={item.id}>
                <button
                  onClick={() => {
                    onTabClick("cloud");
                    if (hasServices) setIsSystemsNavOpen((v) => activeTab === "cloud" ? !v : true);
                  }}
                  className={`w-full flex items-center gap-3.5 px-4 sm:px-5 py-3 sm:py-3.5 rounded-2xl text-micro sm:text-label font-black uppercase transition-all ${
                    activeTab === item.id
                      ? "bg-murzak-accent text-murzak-ink shadow-md sm:shadow-lg shadow-murzak-accent/20"
                      : "text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-black/5 hover:text-murzak-ink"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {hasServices && (
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSystemsNavOpen ? "rotate-90" : ""}`}
                    />
                  )}
                </button>

                {hasServices && isSystemsNavOpen && (
                  <div className="ml-[1.35rem] mt-1 mb-1 pl-4 border-l-2 border-slate-100 dark:border-murzak-border space-y-0.5">
                    {selectedServices.map((s) => (
                      <button
                        key={s.serviceId}
                        type="button"
                        disabled={s.status !== "Active"}
                        onClick={() => {
                          onTabClick("cloud");
                          navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                        }}
                        title={s.status !== "Active" ? `${s.name} — ${s.status || "pending"}` : s.name}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-micro font-bold text-left tracking-wide truncate transition-colors ${
                          s.status === "Active"
                            ? "text-slate-500 hover:bg-slate-100 dark:hover:bg-black/5 hover:text-murzak-ink"
                            : "text-slate-300 cursor-not-allowed"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            s.status === "Active" ? "bg-green-500" : s.status === "Setting up" ? "bg-blue-500" : "bg-orange-400"
                          }`}
                        />
                        <span className="truncate">{s.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
          <div className="mt-auto px-4 sm:px-6 pb-10 pt-4 border-t border-slate-100 dark:border-murzak-border flex items-center gap-3">
            <button
              onClick={onLogout}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 rounded-2xl
                text-red-500 border border-red-500/20 bg-red-500/10 hover:bg-red-500/15 transition-all
                font-black text-micro uppercase"
              title="Log out"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
      </aside>

      {/* Main */}
      <main
        id="portal-scroll"
        className="flex-1 min-h-0 lg:ml-80 p-5 sm:p-8 lg:p-14 relative z-10 w-full overflow-y-auto overscroll-contain pb-24"
        style={{
          WebkitOverflowScrolling: "touch",
          paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-white/70 via-cyan-50/40 to-white/60 backdrop-blur-md sm:backdrop-blur-xl" />
        <div className="absolute inset-0 -z-10 opacity-50 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.25),transparent_55%),radial-gradient(circle_at_85%_25%,rgba(59,130,246,0.2),transparent_55%)]" />

        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 sm:mb-14 gap-4 sm:gap-8">
          <div className="flex-grow">
            <h1 className="text-2xl sm:text-4xl font-[900] text-murzak-ink dark:text-slate-100 tracking-tighter uppercase leading-none">
              Welcome back, {(user.name || "User").split(" ")[0]}
            </h1>
            <p className="text-micro sm:text-micro font-black text-slate-600 dark:text-slate-400 uppercase sm:mt-3 sm:mt-4">
              {user.company} • {isTestUser ? "Free trial" : `${user.plan} plan`} • Nairobi
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden fixed top-5 right-5 z-[140] p-3 bg-white dark:bg-murzak-ink rounded-xl shadow-lg flex items-center justify-center border border-slate-100 dark:border-murzak-border"
            aria-label="Open menu"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        {/* Billing / trial status banner — one slot, highest-priority state wins.
            (The trial states were computed but unrendered after the portal
            redesign; this restores the verify-to-start prompt.) */}
        {(() => {
          const banner = (tone: "red" | "amber" | "cyan", icon: React.ReactNode, text: React.ReactNode, cta?: { label: string; onClick: () => void }) => {
            const tones = {
              red: "border-red-500/30 bg-red-500/10",
              amber: "border-amber-400/30 bg-amber-400/10",
              cyan: "border-murzak-accent/30 bg-murzak-accent/10",
            } as const;
            return (
              <div className={`max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center gap-4 rounded-3xl border p-5 sm:p-6 ${tones[tone]}`}>
                <div className="shrink-0">{icon}</div>
                <p className="flex-grow text-sm font-bold text-murzak-ink dark:text-slate-100 leading-relaxed">{text}</p>
                {cta && (
                  <button
                    type="button"
                    onClick={cta.onClick}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-murzak-accent text-murzak-ink font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
                  >
                    {cta.label} <ArrowRight size={14} />
                  </button>
                )}
              </div>
            );
          };

          // Highest priority: direct feedback on an action the customer just
          // took (a signup/login-time plan attach, or a developer-access
          // request) — more urgent than passive account-status banners below.
          if (planAttachBanner) {
            return banner(
              planAttachBannerTone === "success" ? "cyan" : "red",
              planAttachBannerTone === "success"
                ? <CheckCircle2 size={22} className="text-murzak-accent" />
                : <AlertCircle size={22} className="text-red-500" />,
              <>{planAttachBanner}</>
            );
          }
          if (accountSuspended && dueSubscriptionInvoice) {
            return banner(
              "red",
              <AlertCircle size={22} className="text-red-500" />,
              <>Your services are paused because invoice {dueSubscriptionInvoice.invoiceNo || dueSubscriptionInvoice.id} is unpaid. Pay it and everything is restored right away — your data is safe.</>,
              { label: "Pay & restore", onClick: () => navigate(`/payment/${encodeURIComponent(dueSubscriptionInvoice.docName)}`) }
            );
          }
          if (needsTrialVerify && trialVerifyInvoice?.docName) {
            return banner(
              "cyan",
              <Zap size={22} className="text-murzak-accent" />,
              <>Your free trial is ready. A one-time KES 1 verification confirms your payment method and starts your 36-hour sandbox immediately.</>,
              { label: "Verify & start trial", onClick: () => navigate(`/payment/${encodeURIComponent(trialVerifyInvoice.docName)}`) }
            );
          }
          if (trialExpired) {
            return banner(
              "amber",
              <Timer size={22} className="text-amber-500" />,
              <>Your trial has ended and the sandbox is paused. Your data is held for 7 days — choose a plan to restore it exactly as you left it.</>,
              { label: "Choose a plan", onClick: () => navigate("/pricing") }
            );
          }
          if (dueSubscriptionInvoice) {
            return banner(
              "amber",
              <Receipt size={22} className="text-amber-500" />,
              <>Your {dueSubscriptionInvoice.plan || user.plan} plan invoice ({dueSubscriptionInvoice.invoiceNo || dueSubscriptionInvoice.id}) is due — KES {Number(dueSubscriptionInvoice.amount || 0).toLocaleString()}. Pay it to keep services running without interruption.</>,
              { label: "Pay now", onClick: () => navigate(`/payment/${encodeURIComponent(dueSubscriptionInvoice.docName)}`) }
            );
          }
          if (trialActive && trialEndStr) {
            return banner(
              "cyan",
              <CheckCircle2 size={22} className="text-murzak-accent" />,
              <>Trial sandbox live — ends {trialEndStr}. Pick a plan before then to keep everything you build.</>,
              { label: "Choose a plan", onClick: () => navigate("/pricing") }
            );
          }
          return null;
        })()}

        <div className="max-w-7xl mx-auto">
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<OverviewTab />} />
            <Route path="cloud" element={<CloudTab />} />
            <Route path="domains" element={<DomainsTab />} />
            <Route path="billing" element={<BillingTab />} />
            <Route path="profile" element={<ProfileTab />} />
            <Route
              path="admin"
              element={isAdmin ? <AdminTabs onUnreadChange={setAdminUnread} /> : <Navigate to="/portal/overview" replace />}
            />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </div>
      </main>
      <AddonsModal
        isOpen={addonsOpen}
        planLabel={user.plan}
        disabledReason={addonsDisabledReason}
        addons={addonCandidates}
        onClose={() => {
          setAddonsOpen(false);
          onTabClick(addonsSourceTab);
        }}
        onApplySelection={applyAddonsSelection}
      />

      <Contact
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
        user={{ email: user?.email ?? "", fullName: user?.name ?? "" }}
      />
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        actions={commandActions}
        user={user}
      />
      
      <LogConsole
        serviceId={activeLogServiceId}
        onClose={() => setActiveLogServiceId(null)}
        services={selectedServices}
      />

      {stopConfirmService && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" onClick={() => setStopConfirmService(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-murzak-ink rounded-[2rem] border border-slate-200 dark:border-murzak-border p-7 shadow-2xl">
            <p className="text-micro font-black uppercase text-orange-500">Stop service</p>
            <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mt-2">
              Stop {stopConfirmService.name}?
            </h3>
            <p className="text-[12px] font-medium text-slate-500 dark:text-slate-500 mt-3 leading-relaxed">
              This takes your service offline until you start it again. Visitors won't be able to reach it while stopped.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStopConfirmService(null)}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-murzak-border text-micro font-black uppercase hover:bg-slate-50 dark:hover:bg-black/5 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const svc = stopConfirmService;
                  setStopConfirmService(null);
                  performServiceAction("stop", svc.id);
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-red-500 text-murzak-ink dark:text-slate-100 text-micro font-black uppercase hover:bg-red-600 transition"
              >
                Stop it
              </button>
            </div>
          </div>
        </div>
      )}

      <OnboardingWizard
        isOpen={showOnboarding}
        user={user}
        onClose={dismissOnboarding}
        onChooseServices={() => openAddonsModal("overview")}
        onGoTab={(tab) => onTabClick(tab)}
        onOpenSupport={() => setIsContactOpen(true)}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-[200]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" onClick={() => !deleteLoading && setDeleteTarget(null)} />
            <div className="relative max-w-lg mx-auto mt-24 bg-white dark:bg-murzak-ink rounded-[2rem] border border-slate-200 dark:border-murzak-border p-6 shadow-2xl">
              <p className="text-micro font-black uppercase text-red-500">
                Paid service deletion
              </p>

              <p className="mt-3 text-sm font-black text-murzak-ink dark:text-slate-100">
                You are about to delete a paid service: {deleteTarget.name}
              </p>

              <p className="mt-2 text-label font-medium text-slate-600 dark:text-slate-400">
                This shuts down and destroys the service itself, not just its listing here — its
                container, configuration and any data inside it are removed and cannot be restored.
              </p>

              <p className="mt-2 text-label font-bold text-slate-600 dark:text-slate-400">
                Type <span className="font-black text-red-500">DELETE</span> to confirm removal.
              </p>

              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="mt-4 w-full rounded-xl border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-black/5 px-4 py-3 text-sm font-bold text-murzak-ink dark:text-slate-100"
                placeholder="Type DELETE"
              />

              {deleteError && (
                <p className="mt-3 text-micro font-black uppercase text-red-500">
                  {deleteError}
                </p>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  disabled={deleteLoading}
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-murzak-border text-slate-600 dark:text-slate-400 font-black text-micro uppercase"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={deleteLoading || deleteConfirmText.trim() !== "DELETE"}
                  onClick={() => void handleDelete(deleteTarget.serviceId, deleteConfirmText)}
                  className={`flex-1 py-3 rounded-xl font-black text-micro uppercase ${
                    deleteConfirmText.trim() === "DELETE"
                      ? "bg-red-500 text-murzak-ink dark:text-slate-100"
                      : "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  {deleteLoading ? "Deleting..." : "Confirm Delete"}
                </button>
              </div>
            </div>
          </div>
      )}

      {upgradePromptOpen && (
        <div className="fixed inset-0 z-[220]">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-2xl"
            onClick={() => setUpgradePromptOpen(false)}
          />
          <div className="relative max-w-xl mx-auto mt-24 bg-white dark:bg-murzak-ink rounded-[2rem] border border-slate-200 dark:border-murzak-border p-6 shadow-2xl">
            <p className="text-micro font-black uppercase text-murzak-accent">
              Upgrade plan
            </p>

            <p className="mt-3 text-sm font-black text-murzak-ink dark:text-slate-100">
              Your current plan is already paid.
            </p>

            <p className="mt-2 text-label font-bold text-slate-600 dark:text-slate-400">
              Do you want to retain your current services as you switch plans?
            </p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem("murzak_upgrade_mode", "retain");
                  setUpgradePromptOpen(false);
                  navigateToPricingUpgrade();
                }}
                className="py-3 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase"
              >
                Retain services
              </button>

              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem("murzak_upgrade_mode", "replace");
                  setUpgradePromptOpen(false);
                  navigateToPricingUpgrade();
                }}
                className="py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 font-black text-micro uppercase"
              >
                Replace services
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scaling Settings Modal */}
      {scalingServiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <ScalingSettings serviceId={scalingServiceId} onClose={() => setScalingServiceId(null)} />
        </div>
      )}

      {/* Developer Upsell Modal */}
      {developerUpsellSvc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-murzak-ink/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-murzak-ink w-full max-w-lg rounded-[2rem] p-8 shadow-2xl border border-slate-100 dark:border-murzak-border relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-murzak-accent/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3"></div>
            
            <button onClick={() => !requestingDeveloper && setDeveloperUpsellSvc(null)} className="absolute top-6 right-6 p-2 rounded-full bg-slate-100 dark:bg-black/5 hover:bg-slate-200 dark:hover:bg-black/5 transition z-10 text-slate-500">
              <X className="w-5 h-5" />
            </button>
            
            <div className="relative z-10">
              <div className="inline-flex p-4 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-6">
                <Terminal className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-[900] tracking-tighter text-murzak-ink dark:text-slate-100 mb-2">Unlock Developer Tier</h3>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-500 mb-6">
                Need more control? Upgrade this service to the Developer Tier to get raw programmatic access while maintaining our managed infrastructure.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-black/5 border border-slate-100 dark:border-murzak-border/50">
                  <Terminal className="w-5 h-5 text-murzak-accent shrink-0" />
                  <div>
                    <h4 className="text-label font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100 mb-1">Jailed SSH Access</h4>
                    <p className="text-xs text-slate-500">Secure shell access directly into your service environment.</p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-black/5 border border-slate-100 dark:border-murzak-border/50">
                  <Database className="w-5 h-5 text-murzak-accent shrink-0" />
                  <div>
                    <h4 className="text-label font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100 mb-1">Direct DB Connection</h4>
                    <p className="text-xs text-slate-500">Read/Write access to your isolated MariaDB instance.</p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-black/5 border border-slate-100 dark:border-murzak-border/50">
                  <Shield className="w-5 h-5 text-murzak-accent shrink-0" />
                  <div>
                    <h4 className="text-label font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100 mb-1">Full Platform Administrator</h4>
                    <p className="text-xs text-slate-500">Create custom data models, server scripts, and UI tweaks.</p>
                  </div>
                </div>
              </div>

              {developerUpsellError && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {developerUpsellError}
                </div>
              )}

              <button 
                onClick={handleDeveloperUpsell} 
                disabled={requestingDeveloper}
                className="w-full px-6 py-4 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100"
              >
                {requestingDeveloper ? "Submitting Request..." : "Request Upgrade"}
              </button>
              <p className="text-micro font-bold text-slate-600 dark:text-slate-400 text-center uppercase mt-4">
                Submitting creates a high-priority ticket with our engineering team.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI Concierge Widget - Only show if user has active service */}
      {user.plan !== "None" && user.selectedServices && user.selectedServices.length > 0 && (
        <ConciergeWidget />
      )}
    </div>
  );
};

export default PortalShell;
