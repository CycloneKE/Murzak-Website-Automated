import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Receipt,
  Shield,
  Terminal,
  Timer,
  Zap,
} from "lucide-react";

import { Banner, Modal, PButton, SideNav, TopBar, UserMenu, inputClass } from "../../components/portal/ui";
import { useTheme } from "../../context/ThemeContext";
import Contact from "../Contact";
import AddonsModal from "../../components/AddonsModal";
import AdminTabs from "../admin/AdminTabs";
import CommandPalette from "../../components/portal/CommandPalette";
import ConciergeWidget from "../../components/ConciergeWidget";
import LogConsole from "../../components/portal/LogConsole";
import OnboardingWizard from "../../components/portal/OnboardingWizard";
import { ScalingSettings } from "../../components/portal/ScalingSettings";
import { Database as DatabaseIcon, HardDrive } from "lucide-react";
import { usePortal } from "./PortalContext";
import OverviewTab from "./tabs/OverviewTab";
import PortalLanding from "./tabs/PortalLanding";
import CloudTab from "./tabs/CloudTab";
import DomainsTab from "./tabs/DomainsTab";
import ResourceListTab from "./tabs/ResourceListTab";
import SupportTab from "./tabs/SupportTab";
import DeploymentsTab from "./tabs/DeploymentsTab";
import BillingTab from "./tabs/BillingTab";
import ProfileTab from "./tabs/ProfileTab";

/**
 * The portal chrome: sidebar nav, header, the single status-banner slot, the
 * route table, and every portal-level modal. Screen content lives in ./tabs.
 */
const PortalShell: React.FC = () => {
  const {
    accountSuspended, activeLogServiceId, activeTab, addonCandidates, addonsDisabledReason,
    addonsOpen, addonsPreselectId, addonsSourceTab, adminUnread, allMenuItems, applyAddonsSelection, commandActions,
    deleteConfirmText, deleteError, deleteLoading, deleteTarget, developerUpsellError,
    developerUpsellSvc, dismissOnboarding, dueSubscriptionInvoice, handleDelete,
    handleDeveloperUpsell, isAdmin, isCommandPaletteOpen, isContactOpen, isSidebarOpen,
    isSystemsNavOpen, isTestUser, navigate, navigateToPricingUpgrade, needsTrialVerify,
    onLogout, onTabClick, openAddonsModal, performServiceAction, planAttachBanner,
    planAttachBannerTone, requestingDeveloper, scalingServiceId, selectedServices,
    setActiveLogServiceId, setAddonsOpen, setAdminUnread, setDeleteConfirmText, setDeleteTarget,
    setDeveloperUpsellSvc, setIsCommandPaletteOpen, setIsContactOpen, setIsSidebarOpen,
    setIsSystemsNavOpen, setScalingServiceId, databaseServices, storageServices, setStopConfirmService, setUpgradePromptOpen,
    showOnboarding, stopConfirmService, trialActive, trialEndStr, trialExpired,
    trialVerifyInvoice, upgradePromptOpen, user,
    navGroups, navCollapsed, setNavCollapsed, topBar,
  } = usePortal();
  const { effective: theme, toggle: toggleTheme } = useTheme();

  // Crumbs: Home / <current tab>, unless the page supplied its own.
  const activeItem = navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab);
  const defaultCrumbs =
    activeTab === "overview" || !activeItem
      ? [{ label: "Home" }]
      : [{ label: "Home", to: "/portal/overview" }, { label: activeItem.label }];

  // Billing / trial status banner — one slot, highest-priority state wins.
  const statusBanner = (() => {
    // Highest priority: direct feedback on an action the customer just took
    // (a signup/login-time plan attach, or a developer-access request) — more
    // urgent than the passive account-status banners below.
    if (planAttachBanner) {
      return planAttachBannerTone === "success" ? (
        <Banner tone="success" icon={<CheckCircle2 size={18} />}>{planAttachBanner}</Banner>
      ) : (
        <Banner tone="danger" icon={<AlertCircle size={18} />}>{planAttachBanner}</Banner>
      );
    }
    if (accountSuspended && dueSubscriptionInvoice) {
      return (
        <Banner
          tone="danger"
          icon={<AlertCircle size={18} />}
          action={{ label: "Pay & restore", onClick: () => navigate(`/payment/${encodeURIComponent(dueSubscriptionInvoice.docName)}`) }}
        >
          Your services are paused because invoice {dueSubscriptionInvoice.invoiceNo || dueSubscriptionInvoice.id} is unpaid. Pay it and everything is restored right away. Your data is safe.
        </Banner>
      );
    }
    if (needsTrialVerify && trialVerifyInvoice?.docName) {
      return (
        <Banner
          tone="info"
          icon={<Zap size={18} />}
          action={{ label: "Verify & start trial", onClick: () => navigate(`/payment/${encodeURIComponent(trialVerifyInvoice.docName)}`) }}
        >
          Your free trial is ready. A one-time KES 1 verification confirms your payment method and starts your 36-hour sandbox immediately.
        </Banner>
      );
    }
    if (trialExpired) {
      return (
        <Banner tone="warning" icon={<Timer size={18} />} action={{ label: "Choose a plan", onClick: () => navigate("/pricing") }}>
          Your trial has ended and the sandbox is paused. Your data is held for 7 days. Choose a plan to restore it exactly as you left it.
        </Banner>
      );
    }
    if (dueSubscriptionInvoice) {
      return (
        <Banner
          tone="warning"
          icon={<Receipt size={18} />}
          action={{ label: "Pay now", onClick: () => navigate(`/payment/${encodeURIComponent(dueSubscriptionInvoice.docName)}`) }}
        >
          Your {dueSubscriptionInvoice.plan || user.plan} plan invoice ({dueSubscriptionInvoice.invoiceNo || dueSubscriptionInvoice.id}) is due: KES {Number(dueSubscriptionInvoice.amount || 0).toLocaleString()}. Pay it to keep services running without interruption.
        </Banner>
      );
    }
    if (trialActive && trialEndStr) {
      return (
        <Banner tone="info" icon={<CheckCircle2 size={18} />} action={{ label: "Choose a plan", onClick: () => navigate("/pricing") }}>
          Trial sandbox live, ends {trialEndStr}. Pick a plan before then to keep everything you build.
        </Banner>
      );
    }
    return null;
  })();

  return (
    <div className="portal h-dvh flex overflow-hidden">
      <SideNav
        groups={navGroups}
        activeId={activeTab}
        onSelect={(id) => onTabClick(id as typeof activeTab)}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed(!navCollapsed)}
        onSearch={() => {
          setIsSidebarOpen(false);
          setIsCommandPaletteOpen(true);
        }}
        open={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        footer={
          <UserMenu
            name={user.name || "Account"}
            email={user.email}
            plan={isTestUser ? "Free trial" : `${user.plan} plan`}
            accountStatus={user.accountStatus}
            theme={theme === "dark" ? "dark" : "light"}
            onToggleTheme={toggleTheme}
            onSettings={() => onTabClick("profile")}
            onLogout={onLogout}
            compact={navCollapsed}
          />
        }
      />

      <main
        id="portal-scroll"
        className={`flex-1 min-w-0 min-h-0 ${navCollapsed ? "lg:ml-16" : "lg:ml-58"} overflow-y-auto overscroll-contain`}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <TopBar
          crumbs={topBar?.crumbs || defaultCrumbs}
          status={topBar?.status}
          actions={topBar?.actions}
          onOpenMenu={() => setIsSidebarOpen(true)}
        />

        <div
          className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6"
          style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}
        >
          {statusBanner && <div className="mb-5">{statusBanner}</div>}

          <Routes>
            <Route index element={<PortalLanding />} />
            <Route path="overview" element={<OverviewTab />} />
            <Route path="cloud" element={<CloudTab />} />
            <Route path="cloud/:serviceId" element={<CloudTab />} />
            <Route path="cloud/:serviceId/:section" element={<CloudTab />} />
            <Route path="domains" element={<DomainsTab />} />
            <Route
              path="databases"
              element={
                <ResourceListTab
                  title="Databases"
                  subtitle="Managed database instances on your account."
                  services={databaseServices}
                  icon={<DatabaseIcon className="w-6 h-6" />}
                  emptyTitle="No databases yet"
                  emptyDescription="Add a managed MySQL, PostgreSQL, MongoDB or Redis instance. We run it, back it up and keep it patched."
                />
              }
            />
            <Route
              path="storage"
              element={
                <ResourceListTab
                  title="Storage"
                  subtitle="File storage and drives on your account."
                  services={storageServices}
                  icon={<HardDrive className="w-6 h-6" />}
                  emptyTitle="No storage yet"
                  emptyDescription="Add a private cloud drive for files and team sharing, with access controls and backups."
                />
              }
            />
            <Route path="support" element={<SupportTab />} />
            <Route path="deployments" element={<DeploymentsTab />} />
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
        preselectedId={addonsPreselectId}
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

      <Modal
        open={!!stopConfirmService}
        onClose={() => setStopConfirmService(null)}
        title={`Stop ${stopConfirmService?.name || "this service"}?`}
        size="sm"
        footer={
          <>
            <PButton onClick={() => setStopConfirmService(null)}>Cancel</PButton>
            <PButton
              variant="danger"
              onClick={() => {
                const svc = stopConfirmService;
                setStopConfirmService(null);
                if (svc) performServiceAction("stop", svc.id);
              }}
            >
              Stop it
            </PButton>
          </>
        }
      >
        <p className="text-sm text-p-muted">
          This takes your service offline until you start it again. Visitors won't be able to reach it while stopped.
        </p>
      </Modal>

      <OnboardingWizard
        isOpen={showOnboarding}
        user={user}
        onClose={dismissOnboarding}
        onChooseServices={() => openAddonsModal("overview")}
        onGoTab={(tab) => onTabClick(tab)}
        onOpenSupport={() => setIsContactOpen(true)}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        busy={deleteLoading}
        title={`Delete ${deleteTarget?.name || "service"}`}
        footer={
          <>
            <PButton disabled={deleteLoading} onClick={() => setDeleteTarget(null)}>Cancel</PButton>
            <PButton
              variant="danger"
              loading={deleteLoading}
              disabled={deleteConfirmText.trim() !== "DELETE"}
              onClick={() => deleteTarget && void handleDelete(deleteTarget.serviceId, deleteConfirmText)}
            >
              {deleteLoading ? "Deleting..." : "Confirm Delete"}
            </PButton>
          </>
        }
      >
        <p className="text-sm font-medium text-p-text">
          You are about to delete a paid service: {deleteTarget?.name}
        </p>
        <p className="mt-2 text-sm text-p-muted">
          This shuts down and destroys the service itself, not just its listing here. Its
          container, configuration and any data inside it are removed and cannot be restored.
        </p>
        <label htmlFor="delete-confirm" className="mt-4 block text-[13px] font-medium text-p-text">
          Type <span className="font-semibold text-p-danger">DELETE</span> to confirm removal.
        </label>
        <input
          id="delete-confirm"
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          className={`mt-1.5 ${inputClass}`}
          placeholder="Type DELETE"
          autoComplete="off"
        />
        {deleteError && <p role="alert" className="mt-3 text-[13px] text-p-danger">{deleteError}</p>}
      </Modal>

      <Modal
        open={upgradePromptOpen}
        onClose={() => setUpgradePromptOpen(false)}
        title="Change plan"
        footer={
          <>
            <PButton
              variant="danger"
              onClick={() => {
                sessionStorage.setItem("murzak_upgrade_mode", "replace");
                setUpgradePromptOpen(false);
                navigateToPricingUpgrade();
              }}
            >
              Replace services
            </PButton>
            <PButton
              variant="primary"
              onClick={() => {
                sessionStorage.setItem("murzak_upgrade_mode", "retain");
                setUpgradePromptOpen(false);
                navigateToPricingUpgrade();
              }}
            >
              Retain services
            </PButton>
          </>
        }
      >
        <p className="text-sm font-medium text-p-text">Your current plan is already paid.</p>
        <p className="mt-2 text-sm text-p-muted">
          Do you want to retain your current services as you switch plans?
        </p>
      </Modal>

      {/* Scaling Settings Modal */}
      {scalingServiceId && (
        <div className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60">
          <ScalingSettings serviceId={scalingServiceId} onClose={() => setScalingServiceId(null)} />
        </div>
      )}

      <Modal
        open={!!developerUpsellSvc}
        onClose={() => setDeveloperUpsellSvc(null)}
        busy={requestingDeveloper}
        title="Unlock Developer Tier"
        footer={
          <PButton variant="primary" loading={requestingDeveloper} onClick={handleDeveloperUpsell}>
            {requestingDeveloper ? "Submitting Request..." : "Request Upgrade"}
          </PButton>
        }
      >
        <p className="text-sm text-p-muted">
          Need more control? Upgrade this service to the Developer Tier to get raw programmatic access while maintaining our managed infrastructure.
        </p>
        <ul className="mt-4 divide-y divide-p-border rounded-lg border border-p-border">
          {[
            { icon: <Terminal className="w-4 h-4" />, title: "Jailed SSH access", text: "Secure shell access directly into your service environment." },
            { icon: <Database className="w-4 h-4" />, title: "Direct database connection", text: "Read/Write access to your isolated MariaDB instance." },
            { icon: <Shield className="w-4 h-4" />, title: "Full platform administrator", text: "Create custom data models, server scripts, and UI tweaks." },
          ].map((f) => (
            <li key={f.title} className="flex gap-3 p-3.5">
              <span className="shrink-0 mt-0.5 text-p-accent-text">{f.icon}</span>
              <div>
                <p className="text-sm font-medium text-p-text">{f.title}</p>
                <p className="text-[13px] text-p-muted">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
        {developerUpsellError && (
          <p role="alert" className="mt-4 flex items-center gap-2 text-[13px] text-p-danger">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {developerUpsellError}
          </p>
        )}
        <p className="mt-4 text-[13px] text-p-muted">
          Submitting creates a high-priority ticket with our engineering team.
        </p>
      </Modal>

      {/* AI Concierge Widget - Only show if user has active service */}
      {user.plan !== "None" && user.selectedServices && user.selectedServices.length > 0 && (
        <ConciergeWidget />
      )}
    </div>
  );
};

export default PortalShell;
