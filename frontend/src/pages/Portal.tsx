
// src/pages/Portal.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  CreditCard,
  LogOut,
  Activity,
  ChevronRight,
  CheckCircle2,
  Clock,
  User as UserIcon,
  Menu,
  BarChart,
  DollarSign,
  X,
  ArrowRight,
  HardDrive,
  Navigation,
  Zap,
  Shield,
  Terminal,
  ListChecks,
  AlertCircle,
  Timer,
  Headphones,
  MessageSquare,
  Download,
  ExternalLink,
  UploadCloud,
  Lock,
  Plus,
  Crown
} from "lucide-react";

import { User, Page, ProjectUpdate } from "../types";
import Logo from "../components/Logo";
import Contact from "../pages/Contact";
import { Trash2, Loader2 } from "lucide-react";
import { deleteInvoice } from "../services/invoices";
import { downloadInvoicePdf, downloadAllInvoicesZip } from "../services/invoicesDownload";
import AdminTabs from "./admin/AdminTabs";
import AddonsModal from "../components/AddonsModal";
import { deleteService } from "../services/account";
import WebsiteHostingDashboard from "../components/portal/cloud/website-hosting/WebsiteHostingDashboard";
import ChangePasswordCard from "../components/portal/ChangePasswordCard";
import OnboardingWizard from "../components/portal/OnboardingWizard";

import { PLAN_LIMITS, SERVICE_CATALOG, type PlanCode } from "../config/serviceCatalog";

type Tab = "overview" | "sync" | "cloud" | "billing" | "profile" | "roadmap";

interface PortalProps {
  user: User;
  onLogout: () => void;
  onNavigate: (page: Page) => void;
  onUserUpdate: (user: User) => void;
}

const isTab = (v: string | undefined): v is Tab =>
  v === "overview" ||
  v === "sync" ||
  v === "cloud" ||
  v === "billing" ||
  v === "profile" ||
  v === "roadmap";

function normalizePlanToCode(plan: string | undefined | null): PlanCode {
  const p = (plan || "None").toLowerCase();
  if (p.includes("test")) return "Test";
  if (p.includes("starter")) return "Starter";
  if (p.includes("business")) return "Business";
  if (p.includes("enterprise")) return "Enterprise";
  // fall back
  return "Starter";
}

function allowedAddonTiers(plan: PlanCode): Array<string> {
  if (plan === "Starter") return ["Light"];
  if (plan === "Business") return ["Medium"];
  if (plan === "Enterprise") return ["Light", "Medium", "Large", "Enterprise"];
  if (plan === "Test") return []; // no addons on trial
  return [];
}

type SelectedServiceView = {
  serviceId: string;
  name: string;
  tier?: string;
  category?: string;
  domainChoice?: string;
  status: "Active" | "Awaiting Payment";
  isAddon: boolean;
};

const Portal: React.FC<PortalProps> = ({ user, onLogout, onNavigate, onUserUpdate }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState(0);
  const [localUpdates, setLocalUpdates] = useState<ProjectUpdate[]>(user.updates || []);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesSort, setUpdatesSort] = useState<"newest" | "oldest" | "alpha" | "type">("newest");

  const [isContactOpen, setIsContactOpen] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const [localInvoices, setLocalInvoices] = useState<any[]>(user.invoices || []);
  const [planAttachBanner, setPlanAttachBanner] = useState<string>("");

  // Upload UI
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);

  const [addonsOpen, setAddonsOpen] = useState(false);
  const [addonsSourceTab, setAddonsSourceTab] = useState<"overview" | "cloud" | "billing">("overview");
  const [addonsError, setAddonsError] = useState<string>("");
  const [addonsLoading, setAddonsLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SelectedServiceView | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const [deleteSourceTab, setDeleteSourceTab] = useState<"overview" | "billing">("overview");

  // First-run onboarding (once per account, persisted to localStorage).
  const onboardKey = `murzak_onboarded_${user?.id || user?.email || "anon"}`;
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(onboardKey)) setShowOnboarding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardKey]);
  const dismissOnboarding = () => {
    try { localStorage.setItem(onboardKey, "1"); } catch {}
    setShowOnboarding(false);
  };

  // Prefer the backend-provided flag (driven by ADMIN_EMAILS, the same list the
  // API enforces) so admin UI shows for whoever you configure — with the legacy
  // hard-coded address kept as a fallback.
  const isAdmin =
    Boolean((user as any)?.is_admin) ||
    (user?.email || "").toLowerCase() === "murzaktechnologies@gmail.com";

  const isTestUser =
    user.plan === "Test" ||
    user.accountStatus === "Evaluating" ||
    user.accountStatus === "Provisioning";

  const activeTab: Tab = useMemo(() => {
    const last = location.pathname.split("/").filter(Boolean).pop();
    return isTab(last) ? last : "overview";
  }, [location.pathname]);

  const onTabClick = (tab: Tab) => {
    navigate(`/portal/${tab}`);
    setIsSidebarOpen(false);
  };

  const cloudServiceId = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return sp.get("service") || null;
  }, [location.search]);

const renderCloudSystemsGrid = () => (
  <>
    {selectedServices.length === 0 ? (
      <div className="text-center py-20 bg-slate-50/50 dark:bg-white/5 rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10">
        <Server className="mx-auto w-10 h-10 text-slate-300 mb-5 opacity-60" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          No systems found yet.
        </p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {selectedServices.map((s) => {
          const locked = s.status !== "Active";
          return (
            <button
              key={s.serviceId}
              onClick={() => {
                // Locked = awaiting payment → send them to Billing to clear it (not a dead-end).
                if (locked) {
                  navigate(`/portal/billing`);
                  return;
                }
                navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
              }}
              className={`text-left rounded-[2.25rem] p-6 sm:p-8 border transition-all relative overflow-hidden group hover:scale-[1.01] ${
                locked
                  ? "bg-orange-500/[0.04] border-orange-500/30"
                  : "bg-murzak-cyan/5 border-murzak-cyan/30"
              }`}
            >
              <div className="absolute top-0 right-0 p-6 opacity-10">
                {locked ? <Lock className="w-16 h-16" /> : <Zap className="w-16 h-16" />}
              </div>

              <div className="relative z-10">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {s.category || "Service"} {s.tier ? `• ${s.tier}` : ""}
                </p>

                <h3 className="text-lg sm:text-xl font-black text-murzak-navy dark:text-white mt-2">
                  {s.name}
                </h3>

                <div className="mt-4 flex items-center justify-between">
                  {locked ? (
                    <span className="px-3 py-1 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 text-[9px] font-black uppercase tracking-widest">
                      Awaiting Payment
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 text-[9px] font-black uppercase tracking-widest">
                      Active
                    </span>
                  )}

                  <span className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan flex items-center gap-2">
                    {locked ? "Pay now" : "Open"} <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    )}
  </>
);

  useEffect(() => {
    if (!user?.id) return;
    refreshUpdates();
  }, [user?.id]);

  useEffect(() => {
    if (isAdmin) navigate("/portal/admin", { replace: true });
  }, [isAdmin]);

  useEffect(() => {
    if (user.accountStatus === "Provisioning" && provisionProgress < 100) {
      const interval = setInterval(() => {
        setProvisionProgress((p) => (p >= 100 ? 100 : p + 1));
      }, 300);
      return () => clearInterval(interval);
    }
  }, [user.accountStatus, provisionProgress]);

  useEffect(() => {
    setLocalInvoices(user.invoices || []);
  }, [user.invoices]);

  useEffect(() => {
    const msg = sessionStorage.getItem("murzak_pending_attach_error");
    if (!msg) return;

    setPlanAttachBanner(msg);
    
    sessionStorage.removeItem("murzak_pending_attach_error");

    const t = window.setTimeout(() => setPlanAttachBanner(""), 10000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
  const msg = (location.state as any)?.attachError;
  if (!msg) return;

  setPlanAttachBanner(String(msg));

  // optional auto-hide after 10s
  const t = window.setTimeout(() => setPlanAttachBanner(""), 10000);
  return () => window.clearTimeout(t);
}, [location.key]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/updates", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data?.updates)) {
          setLocalUpdates(data.updates);
        }
      } catch (e) {
        console.warn("Failed to load portal updates", e);
      }
    })();
  }, []);

  useEffect(() => {
    refreshUpdates();

    const t = window.setInterval(() => {
      refreshUpdates();
    }, 15000); // 15s

    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    void refreshChatUnread();
  }, []);

  useEffect(() => {
    if (activeTab !== "sync") return;
    const t = setInterval(() => { void refreshChatUnread(); }, 25000);
    return () => clearInterval(t);
  }, [activeTab]);

  const handleAcknowledge = async (id: string) => {
    try {
      const res = await fetch("/api/updates/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to acknowledge update.");

      // ✅ UI update after server success
      setLocalUpdates((prev) =>
        prev.map((u) => (u.id === id ? { ...u, acknowledged: true } : u))
      );
      void refreshUpdates();
    } catch (e) {
      console.warn("Acknowledge failed:", e);
    }
  };

  const unacknowledgedCount = localUpdates.filter((u) => !u.acknowledged).length;

  const allMenuItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-5 h-5" /> },
    {
      id: "sync",
      label: isAdmin ? "Inbox" : "Updates & support",
      icon: (
        <div className="relative">
          <MessageSquare className="w-5 h-5" />
          {(unacknowledgedCount > 0 || unreadChatCount > 0) && (
            <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-murzak-cyan rounded-full border-2 border-white dark:border-murzak-navy animate-pulse" />
          )}
        </div>
      ),
    },
    { id: "cloud", label: "My Systems", icon: <Server className="w-5 h-5" /> },
    { id: "billing", label: "Billing", icon: <CreditCard className="w-5 h-5" /> },
    { id: "profile", label: "My Account", icon: <UserIcon className="w-5 h-5" /> },
  ];

  const openAddonsModal = (sourceTab: "overview" | "cloud" | "billing") => {
    setAddonsError("");
    setAddonsSourceTab(sourceTab);
    setAddonsOpen(true);
  };

  // --------------------------
  // Services (derived)
  // --------------------------
  const planCode: PlanCode = useMemo(() => normalizePlanToCode(user.plan), [user.plan]);
  const planLimit = PLAN_LIMITS[planCode] ?? 0;

  const catalogLookup = useMemo(() => {
    const all = [
      ...(SERVICE_CATALOG.Test || []),
      ...(SERVICE_CATALOG.Starter || []),
      ...(SERVICE_CATALOG.Business || []),
      ...(SERVICE_CATALOG.Enterprise || []),
    ];
    const map = new Map<string, any>();
    for (const svc of all) map.set(svc.id, svc);
    return map;
  }, []);

  const addonServiceIds = useMemo(() => {
    const ids = new Set<string>();

    // 1) Primary source: persisted on Web Account and returned in user payload
    const accountAddonIds = Array.isArray((user as any)?.addonServiceIds)
      ? (user as any).addonServiceIds
      : [];

    accountAddonIds.forEach((id: any) => {
      const sid = String(id || "").trim();
      if (sid) ids.add(sid);
    });

    // 2) Secondary source: infer from addon invoices
    const norm = (t: any) => String(t || "").toLowerCase().replace(/[^a-z]/g, "");

    (localInvoices || []).forEach((inv: any) => {
      if (!norm(inv?.type).includes("addon")) return;

      const svcRows = Array.isArray(inv?.services) ? inv.services : [];
      svcRows.forEach((s: any) => {
        const sid = String(s?.serviceId || s?.service_id || "").trim();
        if (sid) ids.add(sid);
      });
    });

    return ids;
  }, [user, localInvoices]);  

  const selectedServices: SelectedServiceView[] = useMemo(() => {
    const raw: any[] =
      (user as any)?.selectedServices ||
      (user as any)?.services ||
      [];

    return (Array.isArray(raw) ? raw : []).map((s) => {
      const serviceId = String(s.serviceId || s.service_id || "").trim();
      const svc = catalogLookup.get(s.serviceId);
      const name = s.serviceName || s.service_name || svc?.name || serviceId;
      const tier = s.tier || svc?.tier;
      const category = svc?.category;
      const statusRaw = String(s.status || "").toLowerCase();

      const status: "Active" | "Awaiting Payment" =
        statusRaw.includes("active") || statusRaw.includes("paid")
          ? "Active"
          : "Awaiting Payment";

      const isAddon =
        Boolean(s.isAddon) ||
        Boolean(s.is_addon) ||
        addonServiceIds.has(serviceId);

      return {
        serviceId,
        name,
        tier,
        category,
        domainChoice: s.domainChoice || s.domain_choice || null,
        status,
        isAddon,
      };
    });
  }, [user, catalogLookup, addonServiceIds]);

  const explicitAddonCount = useMemo(() => {
    return selectedServices.filter((s) => s.isAddon).length;
  }, [selectedServices]);

  const totalSelectedCount = selectedServices.length;

  const overflowAddonCount = useMemo(() => {
    if (planLimit >= 999) return 0;
    return Math.max(totalSelectedCount - planLimit, 0);
  }, [totalSelectedCount, planLimit]);  

  const addonCount = useMemo(() => {
    // Prefer exact backend-tagged add-ons.
    // If backend tagging is missing, fall back to overflow.
    return Math.max(explicitAddonCount, overflowAddonCount);
  }, [explicitAddonCount, overflowAddonCount]);

  const includedSelectedCountRaw = useMemo(() => {
    return selectedServices.filter((s) => !s.isAddon).length;
  }, [selectedServices]);

  const includedSelectedCount = useMemo(() => {
    if (planLimit >= 999) {
      return totalSelectedCount - explicitAddonCount;
    }

    // If explicit addon tagging exists, use it.
    if (explicitAddonCount > 0) {
      const included = totalSelectedCount - explicitAddonCount;
      return Math.min(included, planLimit);
    }

    // Fallback: if backend tagging is missing, cap visible included slots at plan limit
    return Math.min(totalSelectedCount, planLimit);
  }, [planLimit, totalSelectedCount, explicitAddonCount]);  

  const remainingSlots = useMemo(() => {
    if (planLimit >= 999) return 999;

    // based on visible included count
    return Math.max(planLimit - includedSelectedCount, 0);
  }, [planLimit, includedSelectedCount]);

  const hasReachedPlanLimit = useMemo(() => {
    return planLimit < 999 && includedSelectedCount >= planLimit;
  }, [planLimit, includedSelectedCount]);  

  const onRequestDelete = (
    s: SelectedServiceView,
    sourceTab: "overview" | "billing" = "overview"
  ) => {
    setDeleteError("");
    setDeleteSourceTab(sourceTab);

    if (s.status === "Active") {
      setDeleteTarget(s);
      setDeleteConfirmText("");
      return;
    }

    void handleDelete(s.serviceId, undefined, sourceTab);
  };

  const handleDelete = async (
    serviceId: string,
    confirmText?: string,
    sourceTab?: "overview" | "billing"
  ) => {
    const targetTab = sourceTab || deleteSourceTab || "overview";

    try {
      setDeleteLoading(true);
      setDeleteError("");

      const data = await deleteServiceApi(serviceId, confirmText);
      if (data?.user) {
        onUserUpdate(data.user);
      }

      // preserve current section after user/state refresh
      onTabClick(targetTab);

      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch (e: any) {
      setDeleteError(e?.message || "Delete failed.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const deleteServiceApi = async (serviceId: string, confirmText?: string) => {
    const res = await fetch(`/api/account/services/${encodeURIComponent(serviceId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ confirmText: confirmText || "" }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to delete service.");
    await refreshUpdates();

    return data;
  };

  const subscriptionIncludedServiceIds = useMemo(() => {
    const norm = (t: any) => String(t || "").toLowerCase().replace(/[^a-z]/g, "");

    // Find latest subscription invoice for this plan
    const subs = (localInvoices || [])
      .filter((inv: any) => norm(inv?.type).includes("subscription"))
      .filter((inv: any) => String(inv?.plan || "").trim() === planCode);

    // pick “latest” by date; fallback to array order if date missing
    const latest = subs
      .slice()
      .sort((a: any, b: any) => {
        const ta = new Date(a?.date || a?.invoice_date || 0).getTime() || 0;
        const tb = new Date(b?.date || b?.invoice_date || 0).getTime() || 0;
        return tb - ta;
      })[0];

    const ids = new Set<string>();
    const svcRows = Array.isArray(latest?.services) ? latest.services : [];
    svcRows.forEach((s: any) => {
      const sid = String(s?.serviceId || "").trim();
      if (sid) ids.add(sid);
    });

    return ids;
  }, [localInvoices, planCode]);

  const addonCandidates = useMemo(() => {
    const tiers = new Set(allowedAddonTiers(planCode));
    if (tiers.size === 0) return [];

    const all = [
      ...(SERVICE_CATALOG.Test || []),
      ...(SERVICE_CATALOG.Starter || []),
      ...(SERVICE_CATALOG.Business || []),
      ...(SERVICE_CATALOG.Enterprise || []),
    ];

    // filter by tier rule + must have addon pricing
    return all
      .filter((s) => tiers.has(s.tier))
      .filter((s) => (s?.pricing?.model || "").toLowerCase() === "addon" && Number(s?.pricing?.monthlyKes || 0) > 0)
      .sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999));
  }, [planCode]);


  const applyAddonsSelection = async ({
    covered,
    chargeable,
  }: {
    covered: any[];
    chargeable: any[];
  }) => {
    try {
      // 1) Add covered services directly to account
      if (covered.length > 0) {
        const res = await fetch("/api/services/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            services: covered.map((s) => ({
              serviceId: s.id,
              serviceName: s.name,
              tier: s.tier,
              domainChoice: "",
            })),
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to add included services.");

        if (data?.user) {
          onUserUpdate(data.user);
          setLocalInvoices(data.user.invoices || []);
        }
      }

      // 2) Create invoice + attach chargeable add-ons
      if (chargeable.length > 0) {
        await createAddonInvoice(chargeable);

        const res2 = await fetch("/api/services/addons/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            services: chargeable.map((s) => ({
              serviceId: s.id,
              serviceName: s.name,
              tier: s.tier,
              domainChoice: "",
            })),
          }),
        });

        const data2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(data2?.error || "Failed to attach add-on services to your account.");

        if (data2?.user) {
          onUserUpdate(data2.user);
          setLocalInvoices(data2.user.invoices || []);
        }
      }

      onTabClick(addonsSourceTab);
      setAddonsOpen(false);
    } catch (err) {
      throw err;
    }
  };

  const activeServices = selectedServices.filter((s) => s.status === "Active");
  const pendingServices = selectedServices.filter((s) => s.status !== "Active");

  const serviceIdToPlan = useMemo(() => {
    const m = new Map<string, PlanCode>();
    (Object.keys(SERVICE_CATALOG) as PlanCode[]).forEach((p) => {
      (SERVICE_CATALOG[p] || []).forEach((svc) => m.set(svc.id, p));
    });
    return m;
  }, []);

  const goToAddServices = () => {
    // This should open pricing and directly open services modal for CURRENT plan
    // You can read query params in Pricing.tsx to auto-open modal (recommended).
    const qp = new URLSearchParams();
    qp.set("returnTo", "/portal/billing");
    qp.set("mode", "add-services");
    qp.set("plan", planCode);
    onNavigate(`/pricing?${qp.toString()}#pricing-plans` as any);
  };

  const goToUpgrade = () => {
    sessionStorage.setItem("murzak_upgrade_intent", "1");
    sessionStorage.removeItem("murzak_upgrade_mode"); // avoid stale retain/replace

    if (subscriptionIsPaid) {
      setUpgradePromptOpen(true);
      return;
    }

    // unpaid subscription -> always replace
    sessionStorage.setItem("murzak_upgrade_mode", "replace");
    navigateToPricingUpgrade();
  };

  const navigateToPricingUpgrade = () => {
    const qp = new URLSearchParams();
    qp.set("returnTo", "/portal/billing");
    qp.set("mode", "upgrade");
    qp.set("current", planCode);
    onNavigate(`/pricing?${qp.toString()}#pricing-plans` as any);
  };

  // --------------------------
  // Upload
  // --------------------------
  const handleGeneralUpload = async (file: File) => {
    setUploadErr("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/portal/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setUploadedFiles((prev) => [{ name: file.name, url: data.file_url }, ...prev].slice(0, 8));
    } catch (e: any) {
      setUploadErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // --------------------------
  // Billing helpers (front-end)
  // --------------------------
  // Real recurring cost: sum the catalog monthly price of the account's ACTIVE
  // services (was hardcoded 5000/25000 magic numbers per plan).
  const monthlyBurnKes = useMemo(() => {
    return selectedServices
      .filter((s) => s.status === "Active")
      .reduce((sum, s) => sum + (catalogLookup.get(s.serviceId)?.pricing?.monthlyKes || 0), 0);
  }, [selectedServices, catalogLookup]);

  const hasUnpaidSubscriptionInvoice = useMemo(() => {
    return (localInvoices || []).some(
      (inv) => (inv?.type || "").toLowerCase().includes("subscription") && inv.status !== "Paid"
    );
  }, [localInvoices]);

  const subscriptionIsPaid = useMemo(() => {
    // If plan is free (Test/Enterprise custom), treat as not eligible for addons here
    if (planCode === "Test") return false;

    const subs = (localInvoices || []).filter((inv) =>
      (inv?.type || "").toLowerCase().includes("subscription")
    );

    // if there is ANY unpaid subscription invoice, block addons
    if (subs.some((inv) => inv.status !== "Paid")) return false;

    // if there is at least one paid subscription invoice matching plan, allow
    return subs.some((inv) => inv.status === "Paid" && (inv?.plan || "") === planCode);
  }, [localInvoices, planCode]);

  const addonsDisabledReason = !subscriptionIsPaid
    ? "You must pay your subscription plan first before purchasing add-ons."
    : null;

  const createAddonInvoice = async (selectedAddons: any[]) => {
    setAddonsLoading(true);
    setAddonsError("");

    const payload = {
      includedRemaining: remainingSlots,
      services: selectedAddons.map((s: any) => ({
        serviceId: s.id,
        serviceName: s.name,
        tier: s.tier,
        domainChoice: "",
      })),
    };

    try {
      const res = await fetch("/api/addons/invoice/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create add-on invoice.");
      }

      if (data?.user?.invoices) {
        setLocalInvoices(data.user.invoices);
      }

      if (data?.user) {
        onUserUpdate(data.user);
        setLocalInvoices(data.user.invoices || []);
      }

      onTabClick(addonsSourceTab);
    } finally {
      setAddonsLoading(false);
    }
  };

  const refreshUpdates = async () => {
    try {
      setUpdatesLoading(true);
      const res = await fetch("/api/portal/updates", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.updates)) {
        setLocalUpdates(data.updates);
      }
    } finally {
      setUpdatesLoading(false);
    }
  }

  const syncHubUpdates = useMemo(() => {
    // Hide chat-only updates from Sync Hub (but they can still exist in localUpdates for Recent Activity)
    return (localUpdates || []).filter((u: any) => !(u as any).is_chat);
  }, [localUpdates]);

  const sortedUpdates = useMemo(() => {
    const arr = (syncHubUpdates || []).slice();

    const ts = (v: any) => {
      const n = new Date(v?.timestamp || "").getTime();
      return Number.isFinite(n) ? n : 0;
    };

    if (updatesSort === "newest") {
      arr.sort((a, b) => ts(b) - ts(a));
    } else if (updatesSort === "oldest") {
      arr.sort((a, b) => ts(a) - ts(b));
    } else if (updatesSort === "alpha") {
      arr.sort((a: any, b: any) =>
        String(a.title || a.content || "").localeCompare(String(b.title || b.content || ""))
      );
    } else if (updatesSort === "type") {
      arr.sort((a: any, b: any) => String(a.type || "").localeCompare(String(b.type || "")));
    }

    return arr;
  }, [syncHubUpdates, updatesSort]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelectedIds(new Set(sortedUpdates.map(u => u.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const deleteOneUpdate = async (id: string) => {
    await fetch("/api/portal/updates/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    await refreshUpdates();
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    await fetch("/api/portal/updates/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ids }),
    });

    clearSelection();
    await refreshUpdates();
  };

  const refreshChatUnread = async () => {
    try {
      const res = await fetch("/api/portal/requests/unread-count", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setUnreadChatCount(Number(data?.count || 0));
    } catch {}
  };

  // --------------------------
  // TAB RENDERS
  // --------------------------
  const renderOverview = () => {
    // Provisioning view unchanged (kept, trimmed)
    if (user.accountStatus === "Provisioning" && provisionProgress < 100) {
      return (
        <div className="space-y-12 animate-fade-in">
          <div className="bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl shadow-lg sm:shadow-2xl lg:shadow-3xl p-6 sm:p-10 lg:p-16 rounded-[2.25rem] sm:rounded-[3rem] lg:rounded-[4rem] border border-slate-100 dark:border-white/5 relative overflow-hidden">
            <div className="max-w-4xl relative z-10">
              <div className="inline-flex items-center gap-3 bg-murzak-cyan/10 text-murzak-cyan px-4 py-2 rounded-full border border-murzak-cyan/20 mb-8">
                <Activity className="w-4 h-4 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">Live Launch Progress</span>
              </div>

              <h2 className="text-xl sm:text-2xl lg:text-3xl font-[900] tracking-tighter uppercase leading-[0.9] mb-4">
                Setting up <br />
                <span className="text-murzak-cyan">Your System.</span>
              </h2>

              <div className="space-y-4">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-murzak-cyan">
                    Preparing...
                  </span>
                  <span className="text-2xl sm:text-4xl lg:text-5xl font-[900] tracking-tighter">
                    {provisionProgress}%
                  </span>
                </div>
                <div className="h-4 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-murzak-cyan transition-all duration-500 ease-out"
                    style={{ width: `${provisionProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-8 animate-fade-in">
        {/* Top row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Node / CTA */}
          <div className="lg:col-span-2 bg-murzak-navy text-white p-6 sm:p-10 rounded-[2.25rem] sm:rounded-[3.5rem] border border-white/10 shadow-3xl relative overflow-hidden group">
            <div className="absolute -bottom-10 -right-10 opacity-10 rotate-12 transition-transform duration-1000 group-hover:rotate-45 group-hover:scale-110">
              <Timer className="w-32 h-32 sm:w-44 sm:h-44 lg:w-60 lg:h-60" />
            </div>
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/20 mb-8">
                {isTestUser ? (
                  <Clock className="w-4 h-4 text-murzak-cyan" />
                ) : (
                  <Shield className="w-4 h-4 text-murzak-cyan" />
                )}
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {isTestUser ? "Free trial" : "Subscription active"}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl lg:text-3xl font-[900] tracking-tighter uppercase leading-[0.9] mb-4">
                Everything's <br />
                <span className="text-murzak-cyan">up and running.</span>
              </h2>

              <p className="text-xs sm:text-sm font-bold text-slate-300 mb-10 max-w-sm leading-relaxed opacity-90">
                {user.evaluationGoal ? (
                  <>What you're working on:{" "}
                    <span className="text-murzak-cyan underline decoration-murzak-cyan/30 underline-offset-4">
                      {user.evaluationGoal}
                    </span>.
                  </>
                ) : (
                  <>You're on the <span className="text-murzak-cyan">{user.plan}</span> plan. Manage your systems, billing and support all from here.</>
                )}
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => onTabClick("cloud")}
                  className="bg-murzak-cyan text-murzak-navy px-8 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-xl flex items-center justify-center gap-3"
                >
                  Open my systems <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  onClick={() => onTabClick("sync")}
                  className="px-8 py-4 rounded-xl border border-white/20 font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-3 backdrop-blur-md"
                >
                  Talk to support <Headphones className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl shadow-lg sm:shadow-2xl lg:shadow-3xl
                           border border-slate-200 dark:border-white/10 p-10 rounded-[3.5rem] flex flex-col justify-between gap-8">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Recent Activity</h3>
            <div className="space-y-4">
              {localUpdates.slice(0, 2).map((u) => (
                <div
                  key={u.id}
                  className="p-4 bg-slate-200 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5"
                >
                  <p className="text-[9px] font-black text-murzak-cyan uppercase tracking-widest mb-1">
                    {u.engineer}
                  </p>
                  <p className="text-[10px] font-bold text-murzak-navy dark:text-slate-300 line-clamp-2">
                    {u.content}
                  </p>
                </div>
              ))}
            </div>
            <button
              onClick={() => onTabClick("sync")}
              className="text-murzak-cyan font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:gap-4 transition-all"
            >
              View all updates <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Services + Upload row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Selected services */}
          <div className="lg:col-span-2 bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl border border-murzak-cyan/15 p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] shadow-lg sm:shadow-xl">
            {planAttachBanner && (
              <div className="mb-5 p-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 text-orange-500 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest">
                    Selection not applied
                  </p>
                  <p className="text-[10px] font-bold text-slate-700 dark:text-slate-200 mt-1 leading-snug">
                    {planAttachBanner}
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Selected Services
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span>
                    Plan: <span className="text-murzak-cyan">{user.plan}</span>
                  </span>

                  <span className="opacity-60">•</span>
 
                  <span className="flex items-center gap-2">
                    <span>Slots:</span>
                    <span className="text-murzak-cyan">
                      {planLimit >= 999 ? includedSelectedCount : `${includedSelectedCount}/${planLimit}`}
                    </span>

                    {addonCount > 0 && (
                      <span className="px-2 py-1 rounded-full bg-murzak-cyan/10 border border-murzak-cyan/20 text-murzak-cyan text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                        +{addonCount}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className="w-full">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
                <button
                  onClick={() => openAddonsModal ("overview")}
                  className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-murzak-cyan text-murzak-navy font-black text-[9px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Services
                </button>

                <button
                  onClick={goToUpgrade}
                  className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-murzak-cyan/30 bg-murzak-cyan/10 text-murzak-cyan font-black text-[9px] uppercase tracking-widest hover:border-murzak-cyan hover:bg-murzak-cyan/15 transition-all flex items-center gap-2"
                >
                  <Crown className="w-4 h-4" /> Upgrade
                </button>
                
                {hasReachedPlanLimit && (
                  <div className="hidden sm:flex flex-1 min-w-[320px] p-4 rounded-2xl border border-murzak-cyan/20 bg-murzak-cyan/10 text-murzak-navy dark:text-murzak-cyan items-start gap-3">
                    <AlertCircle className="w-4 h-4 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest">
                        Maximum services reached
                      </p>
                      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1">
                        You’ve used all included slots for {user.plan}. Add-ons can be purchased separately, or upgrade your plan.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {/* Mobile: compact warning below, wider so it doesn't force button height */}
              {hasReachedPlanLimit && (
                <div className="sm:hidden mt-3 p-3 rounded-2xl border border-murzak-cyan/20 bg-murzak-cyan/10 text-murzak-navy dark:text-murzak-cyan flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest">
                      Max. services reached
                    </p>
                    <p className="text-[9px] font-bold text-slate-600 dark:text-slate-300 mt-1 leading-snug">
                      All free slots used. Add-ons are now billed separately.
                    </p>
                  </div>
                </div>
              )}
            </div>
            </div>

            {selectedServices.length === 0 ? (
              <div className="text-center py-14 bg-slate-50/50 dark:bg-white/5 rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  No services selected yet.
                </p>
                <button
                  onClick={goToAddServices}
                  className="mt-6 px-6 py-3 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[9px] uppercase tracking-widest hover:scale-[1.02] transition-all inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Choose Services
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedServices.map((s) => (
                  <div
                    key={s.serviceId}
                    className={`rounded-[1.75rem] border p-5 transition-all ${
                      s.status === "Active"
                        ? "bg-murzak-cyan/5 border-murzak-cyan/30"
                        : "bg-white/60 dark:bg-white/5 border-slate-200 dark:border-white/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-murzak-cyan/90">
                          {s.category || "Service"} {s.tier ? `• ${s.tier}` : ""}
                        </p>
                        <button
                          type="button"
                          disabled={s.status !== "Active"}
                          onClick={() => {
                            if (s.status !== "Active") return;
                            onTabClick("cloud");
                            navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                          }}
                          className={`text-left text-sm sm:text-base font-black mt-2 ${
                            s.status === "Active" ? "hover:underline" : "cursor-not-allowed"
                          } text-murzak-navy dark:text-white`}
                        >
                          {s.name}
                        </button>                        
                        {s.domainChoice ? (
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2">
                            Domain: {s.domainChoice}
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-3">
                      {s.status === "Active" ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 text-[9px] font-black uppercase tracking-widest">
                            Active
                          </span>
                          <button
                            type="button"
                            onClick={() => onRequestDelete(s, "overview")}
                            className="p-2 rounded-xl border border-slate-200/70 dark:border-white/10 text-slate-500 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all"
                            aria-label={`Delete ${s.name}`}
                            title="Delete service"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                          Awaiting Payment
                        </span>
                        <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onTabClick("billing")}
                          className="px-3 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy
                            font-black text-[9px] sm:text-[10px] uppercase tracking-widest hover:scale-[1.02] sm:hover:scale-105 transition-all"
                          >
                            Pay Now
                        </button>                        

                        <button
                          type="button"
                          onClick={() => onRequestDelete(s)}
                          className="p-2 rounded-xl border border-slate-200/70 dark:border-white/10 text-slate-500 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all"
                          aria-label={`Delete ${s.name}`}
                          title="Delete service"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>  
                      </div>
                      </> 
                      )}                   
                    </div>                    
                  </div>
                  </div>
                ))}
              </div>
            )}

            {pendingServices.length > 0  && (
              <div className="mt-6 p-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 text-orange-500 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest">
                    Payment required
                  </p>
                  <p className="text-[10px] font-bold text-orange-200/90 dark:text-orange-200/80">
                    Some services are locked until you clear your outstanding subscription invoice.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* General upload */}
          <div className="bg-murzak-navy text-white p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] border border-white/10 shadow-lg sm:shadow-xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
              General Upload
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-3">
              Upload project files for engineers to review.
            </p>

            <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <label className="w-full cursor-pointer flex items-center justify-center gap-3 px-5 py-4 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-all">
                <UploadCloud className="w-4 h-4" />
                {uploading ? "Uploading..." : "Upload File"}
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

              {uploadErr && (
                <div className="mt-4 text-[10px] font-black uppercase tracking-widest text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {uploadErr}
                </div>
              )}

              {uploadedFiles.length > 0 && (
                <div className="mt-5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-300 mb-3">
                    Recent uploads
                  </p>
                  <div className="space-y-2">
                    {uploadedFiles.map((f) => (
                      <a
                        key={f.url}
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block px-4 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-[10px] font-bold"
                      >
                        {f.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => onTabClick("sync")}
              className="mt-6 w-full px-5 py-4 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 transition font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Send a message to support <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderBilling = () => (
    <div className="space-y-12 animate-fade-in max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-4 px-2">
        <div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-[900] tracking-tighter uppercase leading-none">
            Billing
          </h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            Your plan, invoices and payments — all in shillings
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Plan + services */}
        <div className="lg:col-span-2 bg-murzak-navy text-white p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] shadow-xl sm:shadow-2xl border border-white/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 sm:p-6 lg:p-8 opacity-10 group-hover:scale-125 transition-transform">
            <DollarSign className="w-12 h-12 sm:w-16 sm:h-16 lg:w-20 lg:h-20" />
          </div>

          <div className="relative z-10">
            <p className="text-[10px] font-black text-murzak-cyan uppercase tracking-widest mb-8">
              Active Subscription
            </p>

            <h3 className="text-3xl sm:text-4xl font-[900] tracking-tighter mb-2 uppercase">
              {user.plan}
            </h3>

            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-8">
              Status: {user.accountStatus}
            </p>

            <div className="rounded-[1.75rem] bg-white border border-slate-200 dark:bg-white/10 dark:border-white/10 p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-murzak-cyan dark:text-slate-300">
                Included Services
              </p>

              <div className="mt-4 space-y-3">
                {selectedServices.length === 0 ? (
                  <p className="text-[10px] font-bold text-slate-300/70">
                    No services selected yet.
                  </p>
                ) : (
                  selectedServices.map((s) => (
                    <div key={s.serviceId} className="flex items-start gap-3">
                      <div>
                        <button
                          type="button"
                          disabled={s.status !== "Active"}
                          onClick={() => {
                            if (s.status !== "Active") return;
                            onTabClick("cloud");
                            navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                          }}
                          className={`text-left text-[10px] font-black ${
                            s.status === "Active" ? "hover:underline" : "cursor-not-allowed"
                          } text-murzak-navy dark:text-white`}
                        >
                          {s.name}
                        </button>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-300 mt-1">
                          {s.tier || "Tier"} {s.domainChoice ? `• Domain: ${s.domainChoice}` : ""}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-2 shrink-0 justify-end">
                        {s.status === "Active" ? (
                          <span className="px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
                            Active
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
                            Awaiting
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onRequestDelete(s, "billing")}
                          className="p-2 rounded-xl border border-slate-200/70 dark:border-white/10 text-slate-500 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all"
                          aria-label={`Delete ${s.name}`}
                          title="Delete service"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>                      
                    </div>
                  ))
                )}
              </div>

              <div className="mt-5 pt-5 border-t border-white/10 flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Slots remaining
                </span>
                <span className="text-[10px] font-black text-murzak-cyan">
                  {remainingSlots}
                </span>
              </div>
            </div>

            <div className="space-y-3 mt-6">
              <button
                onClick={() => openAddonsModal("billing")}
                className="w-full bg-murzak-cyan text-murzak-navy rounded-xl font-black text-[10px] uppercase tracking-widest py-3 sm:py-4 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Services
              </button>

              <button
                onClick={goToUpgrade}
                className="w-full bg-white/5 border border-white/15 text-white rounded-xl font-black text-[10px] uppercase tracking-widest py-3 sm:py-4 hover:bg-white/10 transition-all flex items-center justify-center gap-2"
              >
                <Crown className="w-4 h-4 text-murzak-cyan" /> Upgrade Plan
              </button>

              <div className="pt-4 border-t border-white/10">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black uppercase text-slate-400">Monthly Burn</span>
                  <span className="text-xl font-black text-murzak-cyan">
                    KES {monthlyBurnKes.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Invoices */}
        <div className="lg:col-span-1 bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] shadow-lg sm:shadow-xl border-2 border-murzak-navy/20">
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 sm:gap-4 items-start sm:items-center lg:items-start justify-between mb-6 sm:mb-10">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Settlement History
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
              className="text-[9px] font-black text-murzak-cyan uppercase tracking-widest flex items-center gap-2 disabled:opacity-60 sm:w-auto lg:w-full justify-start"
            >
              {downloadingAll ? "Preparing..." : "Download All"}{" "}
              <Download className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-grow space-y-4">
            {localInvoices.map((inv) => (
              <div
                key={inv.id}
                id={`inv-${inv.id}`}
                data-service-id={(inv as any).serviceId || ""}
                className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-start justify-between bg-slate-200 dark:bg-white/10 border border-slate-100 dark:border-white/10 p-4 sm:p-6 rounded-[1.75rem] sm:rounded-3xl gap-3 sm:gap-4"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`p-3 sm:p-4 lg:p-3 rounded-xl sm:rounded-2xl ${
                      inv.status === "Paid"
                        ? "bg-green-500/10 text-green-500"
                        : "bg-orange-500/10 text-orange-500"
                    }`}
                  >
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {inv.id}
                    </p>
                    <p className="text-sm font-bold text-murzak-navy dark:text-white">
                      {(inv.type || "").toLowerCase().replace(/[^a-z]/g, "").includes("addon") ? "Add-on Invoice" : inv.type} • {inv.date}
                    </p>
                    {inv.plan ? (
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">
                        Plan: {inv.plan}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="w-full sm:w-auto lg:w-full">
                  {/* Row 1: Amount + Status */}
                  <div className="flex items-center justify-between sm:justify-end lg:justify-between gap-3">
                    <p className="text-lg sm:text-2xl lg:text-2xl font-black tracking-tighter">
                      KES {Number(inv.amount || 0).toLocaleString()}
                    </p>

                    {inv.status !== "Paid" ? (
                      <span className="px-3 py-1.5 bg-orange-500/10 text-orange-500 border border-orange-500/20 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                        Pending
                      </span>
                    ) : (
                      <span className="px-3 py-1.5 bg-green-500/10 text-green-500 border border-green-500/20 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
                        Settled
                      </span>
                    )}
                  </div>

                  {/* Row 2: Pay + Icons */}
                  <div className="mt-3 flex items-center gap-2 w-full">
                    {inv.status !== "Paid" ? (
                      <button
                        onClick={() => navigate(`/payment/${encodeURIComponent(inv.docName)}`)}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy
                          font-black text-[9px] uppercase tracking-widest hover:scale-[1.02] transition-all"
                      >
                        Pay Now
                      </button>
                    ) : (
                      <div className="flex-1" />
                    )}

                    {/* Delete */}
                    <button
                      type="button"
                      disabled={deletingId === inv.id}
                      onClick={async () => {
                        const ok = window.confirm(`Delete invoice ${inv.id}? It will be removed from your portal.`);
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
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 hover:border-red-500/40 hover:bg-red-500/10 transition-all disabled:opacity-60"
                      aria-label={`Delete invoice ${inv.id}`}
                      title="Delete"
                    >
                      {deletingId === inv.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>

                    {/* Download */}
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
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 hover:border-murzak-cyan/40 hover:bg-murzak-cyan/10 transition-all disabled:opacity-60"
                      aria-label={`Download invoice ${inv.id}`}
                      title="Download"
                    >
                      {downloadingId === inv.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {localInvoices.length === 0 && (
              <div className="text-center py-20 bg-slate-50/50 dark:bg-white/5 rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10">
                <BarChart size={32} className="mx-auto text-slate-300 mb-4 opacity-50" />
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  No transaction records found.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderSyncHub = () => (
    <div className="space-y-8 animate-fade-in max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4 px-1 sm:px-2">
        <div>
          <h2 className="text-2xl sm:text-3xl font-[900] tracking-tighter uppercase leading-none">Updates &amp; support</h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            Messages from our Nairobi team — and your support thread
          </p>
        </div>
        <div className="bg-murzak-cyan/10 text-murzak-cyan px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl border border-murzak-cyan/20 text-[9px] sm:text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
          Usually replies same day
        </div>
      </div>

      <div
        className="bg-murzak-navy text-white p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] border border-white/10 flex items-center justify-between gap-4 sm:gap-8 group cursor-pointer"
        onClick={async () => {
          if (!user?.email) return;

          setIsContactOpen(true);

          try {
            const my = await fetch(
              `/api/portal/requests/my-thread?email=${encodeURIComponent(user.email)}`,
              { credentials: "include" }
            );
            const myData = await my.json().catch(() => ({}));

            if (my.ok && myData?.id) {
              await fetch(`/api/portal/requests/${encodeURIComponent(myData.id)}/mark-read`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
              });
            }
          } catch (e) {
            console.warn("mark-read failed", e);
          }

          await refreshChatUnread();
        }}
      >
        <div className="flex items-center gap-6">
          <div className="p-3 sm:p-4 bg-white/10 rounded-xl sm:rounded-2xl relative">
            <Headphones className="w-6 h-6" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-murzak-cyan text-murzak-navy text-[10px] font-black flex items-center justify-center">
                {unreadChatCount}
              </span>
            )}
          </div>

          <div>
            <h4 className="text-base sm:text-lg lg:text-xl font-black tracking-tight">
              Need a hand with something?
            </h4>
            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">
              Open your support thread with our team
            </p>
          </div>
        </div>
        <ChevronRight className="w-6 h-6 text-murzak-cyan group-hover:translate-x-3 transition-transform" />
      </div>      

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={updatesSort}
            onChange={(e) => setUpdatesSort(e.target.value as any)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-murzak-navy/80 text-[10px] font-black uppercase tracking-widest"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">A–Z</option>
            <option value="type">Type</option>
          </select>

          <button
            onClick={selectAll}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-murzak-navy/80 text-[10px] font-black uppercase tracking-widest"
          >
            Select all
          </button>

          <button
            onClick={clearSelection}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-murzak-navy/80 text-[10px] font-black uppercase tracking-widest"
          >
            Clear
          </button>
        </div>

        <button
          onClick={bulkDelete}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-widest"
        >
          <Trash2 className="w-4 h-4" /> Delete selected ({selectedIds.size})
        </button>
      </div>
     
      <div className="space-y-6">
        {sortedUpdates.map((update) => {
          const isOpen = expandedId === update.id;
          const title = (update as any).title || `${update.engineer} — ${update.type}`;

          return (
            <div key={update.id} className="relative ...">
              {/* row: checkbox + header + single delete */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(update.id)}
                  onChange={() => toggleSelected(update.id)}
                />

                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : update.id)}
                  className="flex-1 text-left"
                >
                  {/* collapsed title line */}
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">
                      {title}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      {new Date(update.timestamp).toLocaleDateString()} •{" "}
                      {new Date(update.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => deleteOneUpdate(update.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-red-500"
                  title="Delete notification"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* expanded details */}
              {isOpen && (
                <>
                  <div className="mt-4">
                    <p className="text-sm font-bold text-murzak-navy dark:text-white leading-relaxed">
                      {update.content}
                    </p>
                  </div>

                  {!update.acknowledged ? (
                    <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-white/10 mt-4">
                      <button
                        onClick={async () => {
                          // persist ack
                          await fetch("/api/portal/updates/ack", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ id: update.id }),
                          });
                          await refreshUpdates();
                        }}
                        className="bg-murzak-cyan text-murzak-navy px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest"
                      >
                        Mark as read <CheckCircle2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-end pt-4 mt-4">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Read
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {sortedUpdates.length === 0 && (
          <div className="text-center py-16 sm:py-24 bg-slate-50 dark:bg-white/5 rounded-[2.25rem] sm:rounded-[3.5rem] border border-dashed border-slate-200 dark:border-white/10">
            <MessageSquare className="mx-auto w-12 h-12 text-slate-300 mb-6 opacity-50" />
            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">
              No updates yet — we'll post here when there's news.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderCloud = () => (
    <div className="space-y-8 animate-fade-in max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase">
            {cloudServiceId === "biz-web-hosting" ? "Website Hosting" : "My Systems"}
          </h2>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-3">
            {cloudServiceId === "biz-web-hosting"
              ? "Manage your hosting service, domains, subdomains, files and requests"
              : "Systems become active after payment is settled"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {cloudServiceId && (
            <button
              onClick={() => navigate("/portal/cloud")}
              className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-slate-200 font-black text-[9px] uppercase tracking-widest"
            >
              Back to Systems
            </button>
          )}

          {!cloudServiceId && (
            <button
              onClick={() => openAddonsModal("cloud")}
              className="px-5 py-3 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[9px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Services
            </button>
          )}
        </div>
      </div>

      {!cloudServiceId && renderCloudSystemsGrid()}

      {cloudServiceId === "biz-web-hosting" && <WebsiteHostingDashboard />}

      {cloudServiceId && cloudServiceId !== "biz-web-hosting" && (() => {
        const svc = selectedServices.find((s) => s.serviceId === cloudServiceId);
        const isActive = svc?.status === "Active";
        return (
          <div className="rounded-[2.25rem] border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-xl p-7 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan"><Server className="w-6 h-6" /></div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    {svc?.category || "Service"}{svc?.tier ? ` • ${svc.tier}` : ""}
                  </p>
                  <h3 className="text-xl sm:text-2xl font-black text-murzak-navy dark:text-white mt-1">
                    {svc?.name || "Your service"}
                  </h3>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                isActive
                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                  : "bg-orange-500/10 text-orange-500 border-orange-500/20"
              }`}>
                {isActive ? "Active" : "Awaiting payment"}
              </span>
            </div>

            <div className="mt-7 rounded-2xl border border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-5 flex items-start gap-3">
              <Shield className="w-5 h-5 text-murzak-cyan shrink-0 mt-0.5" />
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                This is a fully <span className="font-black text-murzak-navy dark:text-white">managed</span> service — our Nairobi team
                runs, secures and backs it up for you. There’s no console to babysit. Need a change, a report or a hand?
                Message support and we’ll take care of it.
              </p>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => onTabClick("sync")}
                className="px-6 py-3.5 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
              >
                <Headphones className="w-4 h-4" /> Message support
              </button>
              {!isActive && (
                <button
                  onClick={() => onTabClick("billing")}
                  className="px-6 py-3.5 rounded-2xl border border-slate-200 dark:border-white/15 text-murzak-navy dark:text-white font-black text-[10px] uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-white/10 transition-all"
                >
                  Pay & activate
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );

  const renderProfile = () => (
    <div className="space-y-8 animate-fade-in max-w-5xl mx-auto">
      <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase">Account Profile</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
        <div className="bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-white/5 p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] shadow-lg sm:shadow-xl">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-8">
            Personal Information
          </h3>
          <div className="space-y-6">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Full Name</p>
              <p className="text-base sm:text-lg lg:text-xl font-black break-words">{user.name}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Email Address</p>
              <p className="text-base sm:text-lg lg:text-xl font-black break-words">{user.email}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Business Name</p>
              <p className="text-base sm:text-lg lg:text-xl font-black break-words">{user.company}</p>
            </div>
          </div>
        </div>

        <div className="bg-murzak-navy text-white p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] border border-white/10 shadow-lg sm:shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">
              Service Plan
            </h3>
            <div className="flex items-center gap-4 mb-2">
              <Shield className="text-murzak-cyan w-6 h-6" />
              <p className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tighter">
                {user.plan || "None"}
              </p>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Status: {user.accountStatus}
            </p>

            <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-300">
                Services
              </p>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                {selectedServices.length} selected • {remainingSlots} slots remaining
              </p>
            </div>
          </div>

          <div className="space-y-3 mt-6">
            <button
              onClick={() => {
                setAddonsError("");
                setAddonsOpen(true);
              }}
              className="bg-murzak-cyan text-murzak-navy w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Services
            </button>

            <button
              onClick={goToUpgrade}
              className="bg-white/5 border border-white/15 text-white w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl font-black text-[9px] sm:text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 text-murzak-cyan" /> Upgrade Plan
            </button>
          </div>
        </div>
      </div>

      <ChangePasswordCard />

      <button
        onClick={() => setShowOnboarding(true)}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 text-murzak-navy dark:text-white font-black text-[10px] uppercase tracking-widest hover:border-murzak-cyan transition-all"
      >
        <Activity className="w-4 h-4 text-murzak-cyan" /> Replay the welcome tour
      </button>
    </div>
  );

  const renderRoadmap = () => (
    <div className="space-y-8 sm:space-y-12 animate-fade-in max-w-5xl mx-auto">
      <div className="text-center py-20 bg-slate-50/50 dark:bg-white/5 rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10">
        <Navigation className="mx-auto w-10 h-10 text-slate-300 mb-5 opacity-60" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Roadmap module coming next.
        </p>
      </div>
    </div>
  );

  const renderTab = (tab: Tab) => {
    switch (tab) {
      case "overview":
        return renderOverview();
      case "sync":
        return isAdmin ? <AdminTabs /> : renderSyncHub();
      case "cloud":
        return renderCloud();
      case "billing":
        return renderBilling();
      case "profile":
        return renderProfile();
      case "roadmap":
        return renderRoadmap();
      default:
        return renderOverview();
    }
  };

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
        className={`fixed inset-y-0 left-0 z-[100] w-72 sm:w-80 bg-white/95 dark:bg-murzak-navy/95 backdrop-blur-md sm:backdrop-blur-2xl lg:backdrop-blur-3xl
                    border-r border-slate-100 dark:border-white/5 flex flex-col transition-transform duration-500 lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 sm:px-7 pt-6 sm:pt-8 pb-4 flex items-center justify-between">
          <Logo className="h-7 sm:h-8" />
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 p-2">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* User profile */}
        <button
          onClick={() => onTabClick("profile")}
          className="mx-4 sm:mx-6 mb-2 flex items-center gap-3 rounded-2xl border border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03] p-3 text-left hover:border-murzak-cyan/40 transition-all"
        >
          <div className="shrink-0 w-11 h-11 rounded-xl bg-murzak-cyan/15 text-murzak-cyan flex items-center justify-center font-black text-sm">
            {(user.name || "U").split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-murzak-navy dark:text-white truncate">{user.name}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-murzak-cyan/10 text-murzak-cyan text-[8px] font-black uppercase tracking-widest">
                {user.plan || "No plan"}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${user.accountStatus === "Active" ? "bg-green-500" : "bg-orange-400"}`} />
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 truncate">{user.accountStatus}</span>
            </div>
          </div>
        </button>

        <nav className="flex-grow px-4 sm:px-6 space-y-1.5 mt-3 overflow-y-auto">
          {allMenuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabClick(item.id)}
              className={`w-full flex items-center gap-3.5 px-4 sm:px-5 py-3 sm:py-3.5 rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest transition-all ${
                activeTab === item.id
                  ? "bg-murzak-cyan text-murzak-navy shadow-md sm:shadow-lg shadow-murzak-cyan/20"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-murzak-navy dark:hover:text-white"
              }`}
            >
              <span className="shrink-0">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
          <div className="mt-auto px-4 sm:px-6 pb-10 pt-4 border-t border-slate-100 dark:border-white/10 flex items-center gap-3">
            <button
              onClick={onLogout}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 rounded-2xl
                text-red-500 border border-red-500/20 bg-red-500/10 hover:bg-red-500/15 transition-all
                font-black text-[10px] uppercase tracking-widest"
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
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-white/70 via-cyan-50/40 to-white/60 dark:from-murzak-navy/80 dark:via-murzak-deep/70 dark:to-black/90 backdrop-blur-md sm:backdrop-blur-xl" />
        <div className="absolute inset-0 -z-10 opacity-50 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.25),transparent_55%),radial-gradient(circle_at_85%_25%,rgba(59,130,246,0.2),transparent_55%)]" />

        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 sm:mb-14 gap-4 sm:gap-8">
          <div className="flex-grow">
            <h1 className="text-2xl sm:text-4xl font-[900] text-murzak-navy dark:text-white tracking-tighter uppercase leading-none">
              Welcome back, {user.name.split(" ")[0]}
            </h1>
            <p className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] sm:tracking-[0.4em] mt-3 sm:mt-4">
              {user.company} • {isTestUser ? "Free trial" : `${user.plan} plan`} • Nairobi
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden fixed top-5 right-5 z-[140] p-3 bg-white dark:bg-murzak-navy rounded-xl shadow-lg flex items-center justify-center border border-slate-100 dark:border-white/10"
            aria-label="Open menu"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <div className="max-w-7xl mx-auto">
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={renderTab("overview")} />
            <Route path="sync" element={renderTab("sync")} />
            <Route path="cloud" element={renderTab("cloud")} />
            <Route path="billing" element={renderTab("billing")} />
            <Route path="profile" element={renderTab("profile")} />
            <Route path="roadmap" element={renderTab("roadmap")} />
            <Route path="admin" element={isAdmin ? <AdminTabs /> : <Navigate to="/portal/overview" replace />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </div>
      </main>
      <AddonsModal
        isOpen={addonsOpen}
        planLabel={user.plan}
        includedRemaining={remainingSlots}
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

      <OnboardingWizard
        isOpen={showOnboarding}
        user={user}
        onClose={dismissOnboarding}
        onChooseServices={() => openAddonsModal("overview")}
        onGoTab={(tab) => onTabClick(tab)}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-[200]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" onClick={() => !deleteLoading && setDeleteTarget(null)} />
            <div className="relative max-w-lg mx-auto mt-24 bg-white dark:bg-murzak-navy rounded-[2rem] border border-slate-200 dark:border-white/10 p-6 shadow-2xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-red-500">
                Paid service deletion
              </p>

              <p className="mt-3 text-sm font-black text-murzak-navy dark:text-white">
                You are about to delete a paid service: {deleteTarget.name}
              </p>

              <p className="mt-2 text-[11px] font-bold text-slate-500 dark:text-slate-300">
                Type <span className="font-black text-red-500">DELETE</span> to confirm removal.
              </p>

              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="mt-4 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-3 text-sm font-bold text-murzak-navy dark:text-white"
                placeholder="Type DELETE"
              />

              {deleteError && (
                <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-red-500">
                  {deleteError}
                </p>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  disabled={deleteLoading}
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={deleteLoading || deleteConfirmText.trim() !== "DELETE"}
                  onClick={() => void handleDelete(deleteTarget.serviceId, deleteConfirmText)}
                  className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest ${
                    deleteConfirmText.trim() === "DELETE"
                      ? "bg-red-500 text-white"
                      : "bg-slate-100 dark:bg-white/10 text-slate-400 cursor-not-allowed"
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
          <div className="relative max-w-xl mx-auto mt-24 bg-white dark:bg-murzak-navy rounded-[2rem] border border-slate-200 dark:border-white/10 p-6 shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">
              Upgrade plan
            </p>

            <p className="mt-3 text-sm font-black text-murzak-navy dark:text-white">
              Your current plan is already paid.
            </p>

            <p className="mt-2 text-[11px] font-bold text-slate-500 dark:text-slate-300">
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
                className="py-3 rounded-xl bg-murzak-cyan text-murzak-navy font-black text-[10px] uppercase tracking-widest"
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
                className="py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 font-black text-[10px] uppercase tracking-widest"
              >
                Replace services
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portal;
