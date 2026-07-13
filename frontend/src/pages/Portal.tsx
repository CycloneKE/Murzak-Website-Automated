
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
  Crown,
  Calendar,
  Bell,
  UserCircle,
  Settings,
  Receipt,
  Database
} from "lucide-react";


import { User, Page, ProjectUpdate } from "../types";
import Logo from "../components/Logo";
import Contact from "../pages/Contact";
import { Trash2, Loader2, ArrowUpCircle } from "lucide-react";
import { deleteInvoice } from "../services/invoices";
import { downloadInvoicePdf, downloadAllInvoicesZip } from "../services/invoicesDownload";
import AdminTabs from "./admin/AdminTabs";
import AddonsModal from "../components/AddonsModal";
import { deleteService } from "../services/account";
import WebsiteHostingDashboard from "../components/portal/cloud/website-hosting/WebsiteHostingDashboard";
import ChangePasswordCard from "../components/portal/ChangePasswordCard";
import OnboardingWizard from "../components/portal/OnboardingWizard";
import MetricCard from "../components/portal/MetricCard";
import ActivityTimeline, { TimelineEvent } from "../components/portal/ActivityTimeline";
import ServiceHealthCard, { ServiceHealth } from "../components/portal/ServiceHealthCard";
import TopologyMap from "../components/portal/TopologyMap";
import CommandPalette, { CommandAction } from "../components/portal/CommandPalette";
import LogConsole from "../components/portal/LogConsole";
import ConciergeWidget from "../components/ConciergeWidget";
import ResourceUtilizationCard from "../components/portal/ResourceUtilizationCard";
import SecurityOverviewCard from "../components/portal/SecurityOverviewCard";
import { PLAN_LIMITS, SERVICE_CATALOG, type PlanCode } from "../config/serviceCatalog";
import { type SelectedServiceView, type ServiceStatus } from "../types";

type Tab = "overview" | "cloud" | "billing" | "profile";

interface PortalProps {
  user: User;
  onLogout: () => void;
  onNavigate: (page: Page) => void;
  onUserUpdate: (user: User) => void;
}

const isTab = (v: string | undefined): v is Tab =>
  v === "overview" ||
  v === "cloud" ||
  v === "billing" ||
  v === "profile";

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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeLogServiceId, setActiveLogServiceId] = useState<string | null>(null);

  const [developerUpsellSvc, setDeveloperUpsellSvc] = useState<string | null>(null);
  const [requestingDeveloper, setRequestingDeveloper] = useState(false);
  const [developerUpsellError, setDeveloperUpsellError] = useState("");

  const handleDeveloperUpsell = async () => {
    if (!developerUpsellSvc) return;
    setRequestingDeveloper(true); setDeveloperUpsellError("");
    try {
      const s = selectedServices.find(x => x.serviceId === developerUpsellSvc);
      const svcName = s ? s.name : developerUpsellSvc;
      const res = await fetch("/api/portal/requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          subject: `Developer Access Request: ${svcName}`,
          message: `I would like to upgrade my managed service (${svcName}) to the Developer Tier to get Administrator UI, DB access, and Jailed SSH access. Please arrange this upgrade.`,
          pageUrl: window.location.href,
          attachments: ""
        })
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || "Failed to submit request.");
      setDeveloperUpsellSvc(null);
      setPlanAttachBanner("Developer access request submitted! Our team will follow up via the Support tab shortly.");
    } catch (e: any) {
      setDeveloperUpsellError(e.message || "Something went wrong.");
    } finally {
      setRequestingDeveloper(false);
    }
  };

  useEffect(() => {
    const handleGlobalK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalK);
    return () => window.removeEventListener("keydown", handleGlobalK);
  }, []);
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

  // Trial (KES-1 verification flow) state, derived from the invoices the portal
  // already receives: the unpaid verification invoice the user pays to START,
  // and the trial itself once active/expired.
  const trialVerifyInvoice = (localInvoices || []).find(
    (i: any) =>
      String(i?.type || "").toLowerCase() === "trial verification" &&
      String(i?.status || "").toLowerCase() !== "paid"
  );
  const trialInvoice = (localInvoices || []).find(
    (i: any) => String(i?.type || "").toLowerCase() === "trial"
  );
  const trialStatus = String(trialInvoice?.status || "").toLowerCase();
  const trialActive = trialStatus === "active";
  const trialExpired = trialStatus === "expired";
  const trialEndStr = trialInvoice?.meta?.trialEnd
    ? new Date(String(trialInvoice.meta.trialEnd).replace(" ", "T")).toLocaleString()
    : null;
  const needsTrialVerify = isTestUser && !!trialVerifyInvoice && !trialActive;

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

const renderCloudSystemsGrid = () => null;

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
    setPlanAttachBanner(msg);
    
    // Clear it from history so refresh doesn't show it again
    window.history.replaceState({}, document.title);

    const t = window.setTimeout(() => setPlanAttachBanner(""), 10000);
    return () => window.clearTimeout(t);
  }, [location.state]);

  // Poll for provisioning status if any service is "Setting up"
  useEffect(() => {
    const hasProvisioning = user?.selectedServices?.some(s => s.status === "Setting up");
    if (!hasProvisioning) return;

    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (!res.ok || !mounted) return;
        const data = await res.json();
        if (data.ok && data.user) {
          onUserUpdate(data.user);
        }
      } catch (e) {
        // ignore network errors during poll
      }
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user?.selectedServices, onUserUpdate]);

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
    const t = setInterval(() => { void refreshChatUnread(); }, 25000);
    return () => clearInterval(t);
  }, []);

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
      const name = s.name || s.serviceName || s.service_name || svc?.name || serviceId;
      const tier = s.tier || svc?.tier;
      const category = svc?.category;
      const statusRaw = String(s.status || "").toLowerCase();

      const status: ServiceStatus =
        statusRaw.includes("setting up") || statusRaw.includes("provision") || statusRaw.includes("configuring")
          ? "Setting up"
          : statusRaw.includes("active") || statusRaw.includes("paid")
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

  const commandActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      { id: "nav-overview", title: "Go to Overview", subtitle: "Dashboard home", icon: <LayoutDashboard className="w-4 h-4" />, onSelect: () => onTabClick("overview") },
      { id: "nav-systems", title: "Go to My Systems", subtitle: "View active services and servers", icon: <Server className="w-4 h-4" />, onSelect: () => onTabClick("cloud") },
      { id: "nav-billing", title: "Go to Billing", subtitle: "Manage invoices and payment methods", icon: <CreditCard className="w-4 h-4" />, onSelect: () => onTabClick("billing") },
      { id: "nav-profile", title: "Go to Profile", subtitle: "Account settings", icon: <UserIcon className="w-4 h-4" />, onSelect: () => onTabClick("profile") },
      { id: "action-support", title: "Contact Support", subtitle: "Get help from our Nairobi team", icon: <Headphones className="w-4 h-4" />, onSelect: () => setIsContactOpen(true) },
      { id: "action-deploy", title: "Deploy New Service", subtitle: "Add a new system to your infrastructure", icon: <Plus className="w-4 h-4" />, onSelect: () => openAddonsModal("overview") },
    ];
    selectedServices.forEach(s => {
      actions.push({
        id: `sys-${s.serviceId}`,
        title: `Manage ${s.name}`,
        subtitle: `${s.category} System`,
        icon: <Terminal className="w-4 h-4" />,
        onSelect: () => {
          onTabClick("cloud");
          navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
        }
      });
    });
    return actions;
  }, [selectedServices, navigate]);

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
    chargeable,
  }: {
    chargeable: any[];
  }) => {
    try {
      // Create invoice + attach the selected add-ons (always billed — there
      // are no free plan-included slots, matching checkout).
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
  // Only TRUE awaiting-payment services trigger the "payment required" banner —
  // "Setting up" services are paid and being configured, not unpaid.
  const pendingServices = selectedServices.filter((s) => s.status === "Awaiting Payment");

  const serviceIdToPlan = useMemo(() => {
    const m = new Map<string, PlanCode>();
    (Object.keys(SERVICE_CATALOG) as PlanCode[]).forEach((p) => {
      (SERVICE_CATALOG[p] || []).forEach((svc) => m.set(svc.id, p));
    });
    return m;
  }, []);

  // Same destination as every other "Add Services" entry point in the portal
  // (openAddonsModal) — Test plan is the one real exception: it allows a
  // single trial service with no add-on mechanism, so growing means picking
  // a real plan on the public Pricing page, not buying an add-on.
  const goToAddServices = () => {
    if (planCode === "Test") {
      onNavigate(`/pricing#pricing-plans` as any);
      return;
    }
    openAddonsModal("overview");
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

  // First payable subscription invoice (new plan OR renewal) — drives the
  // portal-wide "invoice due" banner with a direct Pay CTA.
  const dueSubscriptionInvoice = useMemo(() => {
    return (localInvoices || []).find((inv: any) => {
      const type = String(inv?.type || "").toLowerCase();
      const status = String(inv?.status || "").toLowerCase();
      return (
        type.includes("subscription") &&
        !!inv?.docName &&
        (status === "unpaid" || status === "pending" || status === "overdue")
      );
    });
  }, [localInvoices]);

  const accountSuspended = String(user?.accountStatus || "").toLowerCase() === "suspended";

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
      type: u.content.toLowerCase().includes('payment') ? 'payment' : u.content.toLowerCase().includes('support') ? 'support' : 'system',
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
    }));

    return (
      <div className="space-y-8 animate-fade-in pb-12">
        {/* Welcome Hero */}
        <div className="glass-card rounded-[3rem] p-10 relative overflow-hidden group border border-white/10">
          <div className="absolute inset-0 bg-gradient-to-r from-murzak-navy to-transparent opacity-90 dark:opacity-50"></div>
          <div className="absolute right-0 top-0 w-1/2 h-full opacity-20 bg-[url('/portal-hero-bg.png')] bg-cover mix-blend-overlay blur-sm transition-transform duration-1000 group-hover:scale-105"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/20 mb-6 backdrop-blur-md">
                <Crown className="w-4 h-4 text-murzak-cyan" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white">
                  {user.plan} Plan
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tighter uppercase leading-[0.9] text-white">
                Welcome back,<br />
                <span className="text-murzak-cyan">{(user.name || "User").split(' ')[0]}</span>.
              </h2>
            </div>
            
            <div className="flex flex-wrap gap-4">
              {healthServices.filter(s => s.status === 'online').slice(0, 2).map((s) => (
                <button 
                  key={`quick-${s.id}`}
                  onClick={() => onTabClick("cloud")} 
                  className="px-6 py-4 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan font-black text-[10px] uppercase tracking-widest border border-murzak-cyan/20 hover:bg-murzak-cyan hover:text-murzak-navy hover:shadow-[0_0_20px_rgba(46,166,255,0.3)] hover:scale-105 transition-all flex items-center gap-2 backdrop-blur-md"
                >
                  <ArrowRight className="w-4 h-4" /> Open {s.name.split(' ')[0]}
                </button>
              ))}
              <button onClick={() => setIsContactOpen(true)} className="px-6 py-4 rounded-2xl bg-white/10 text-white font-black text-[10px] uppercase tracking-widest border border-white/20 hover:bg-white/20 transition-all flex items-center gap-2 backdrop-blur-md">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Dashboard Area */}
          <div className="lg:col-span-2 space-y-8">
            {/* System Health */}
            <div className="glass-panel p-8 rounded-[3rem] border border-white/10">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-[12px] font-black uppercase tracking-widest text-white">System Health</h3>
                  <p className="text-[10px] font-medium text-slate-400 mt-1">Live status of your active infrastructure</p>
                </div>
                <button onClick={() => onTabClick("cloud")} className="text-murzak-cyan hover:text-white transition-colors p-2">
                  <ArrowRight size={20} />
                </button>
              </div>

              {healthServices.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {healthServices.map(service => (
                    <ServiceHealthCard 
                      key={service.id} 
                      service={service} 
                      onAction={(action, id) => {
                        if (action === "manage") {
                          onTabClick("cloud");
                          navigate(`/portal/cloud?service=${encodeURIComponent(id)}`);
                        }
                      }} 
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 rounded-[2rem] border border-dashed border-white/10 bg-white/5">
                  <Server className="w-8 h-8 text-slate-500 mx-auto mb-4" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">No Active Services</p>
                  <p className="text-[10px] text-slate-500 max-w-xs mx-auto mb-6">You don't have any infrastructure running yet.</p>
                  <button onClick={goToAddServices} className="px-6 py-3 rounded-xl bg-murzak-cyan text-murzak-navy font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all inline-flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Deploy Services
                  </button>
                </div>
              )}
            </div>

            {/* New Insights Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <SecurityOverviewCard />
              <ResourceUtilizationCard />
            </div>

            {/* General Upload */}
            <div className="glass-panel p-8 rounded-[3rem] border border-white/10">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-[12px] font-black uppercase tracking-widest text-white">Project Files</h3>
                  <p className="text-[10px] font-medium text-slate-400 mt-1">Upload assets for engineers</p>
                </div>
                <label className="cursor-pointer px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-[10px] uppercase tracking-widest transition-all inline-flex items-center gap-2">
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
                <div className="mb-4 text-[10px] font-black uppercase tracking-widest text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {uploadErr}
                </div>
              )}

              {uploadedFiles.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {uploadedFiles.map((f) => (
                    <a
                      key={f.url}
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="glass-card p-3 rounded-xl flex items-center gap-2 hover:border-murzak-cyan/50 transition-colors group"
                    >
                      <div className="p-2 bg-white/5 rounded-lg group-hover:bg-murzak-cyan/10 group-hover:text-murzak-cyan transition-colors">
                        <Download size={14} />
                      </div>
                      <span className="text-[10px] font-bold text-slate-300 truncate">{f.name}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] font-bold text-slate-500 text-center py-6">No files uploaded yet.</p>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            {/* Activity Timeline */}
            <div className="glass-panel p-8 rounded-[3rem] border border-white/10 h-full">
              <h3 className="text-[12px] font-black uppercase tracking-widest text-white mb-8">Activity Hub</h3>
              <ActivityTimeline events={timelineEvents} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBilling = () => (
    <div className="space-y-12 animate-fade-in max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-4 px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">
            Billing & Plans
          </h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            Manage your subscription, services and invoices
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left Column: Plan + Actions */}
        <div className="xl:col-span-2 space-y-8">
          
          {/* Plan Card */}
          <div className="glass-card rounded-[3rem] p-8 sm:p-10 relative overflow-hidden group border border-white/10">
            <div className="absolute inset-0 bg-gradient-to-br from-murzak-navy to-murzak-navy/90 z-0"></div>
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-murzak-cyan/20 blur-3xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none z-0"></div>
            
            <div className="absolute top-8 right-8 opacity-10 group-hover:scale-110 transition-transform duration-700 z-0">
              <Crown className="w-24 h-24 sm:w-32 sm:h-32 text-white" />
            </div>

            <div className="relative z-10 flex flex-col md:flex-row gap-8 justify-between">
              <div>
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 rounded-full border border-white/20 mb-6 backdrop-blur-md">
                  <div className={`w-2 h-2 rounded-full ${user.accountStatus === 'Active' ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-orange-400 shadow-[0_0_8px_#fb923c]'}`}></div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-white">
                    {user.accountStatus} Subscription
                  </span>
                </div>

                <h3 className="text-4xl sm:text-5xl font-[900] tracking-tighter mb-2 uppercase text-white">
                  {user.plan}
                </h3>
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-8">
                  Monthly Billing • Next cycle in 14 days
                </p>

                <div className="flex gap-4">
                  <button onClick={goToUpgrade} className="px-6 py-4 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[10px] uppercase tracking-widest shadow-[0_0_20px_rgba(46,166,255,0.3)] hover:scale-105 transition-all flex items-center gap-2">
                    <ArrowUpCircle className="w-4 h-4" /> Change Plan
                  </button>
                  <button onClick={() => openAddonsModal("billing")} className="px-6 py-4 rounded-2xl bg-white/10 text-white border border-white/20 font-black text-[10px] uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-2 backdrop-blur-md">
                    <Plus className="w-4 h-4" /> Add Services
                  </button>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-md self-start min-w-[200px]">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Monthly Burn</p>
                <p className="text-3xl font-black text-murzak-cyan tracking-tighter">KES {monthlyBurnKes.toLocaleString()}</p>
                <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Slots used</span>
                  <span className="text-[10px] font-black text-white">{planLimit >= 999 ? includedSelectedCount : `${includedSelectedCount}/${planLimit}`}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Included Services List */}
          <div className="glass-panel rounded-[3rem] p-8 sm:p-10 border border-white/10">
            <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-800 dark:text-white mb-8 flex items-center gap-3">
              <Server className="w-5 h-5 text-murzak-cyan" /> Provisioned Services
            </h3>

            <div className="space-y-4">
              {selectedServices.length === 0 ? (
                <div className="text-center py-12 rounded-[2rem] border border-dashed border-white/10 bg-white/5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    No services attached to this plan yet.
                  </p>
                </div>
              ) : (
                selectedServices.map((s) => (
                  <div key={s.serviceId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-[2rem] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-murzak-cyan/30 transition-colors group">
                    <div className="flex items-start sm:items-center gap-4">
                      <div className={`p-3 rounded-2xl ${s.status === 'Active' ? 'bg-murzak-cyan/10 text-murzak-cyan' : 'bg-orange-500/10 text-orange-500'}`}>
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
                            s.status === "Active" ? "hover:text-murzak-cyan" : "cursor-not-allowed"
                          } text-murzak-navy dark:text-white transition-colors`}
                        >
                          {s.name}
                        </button>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mt-1">
                          {s.category || "Service"} {s.tier ? `• ${s.tier}` : ""} {s.domainChoice ? `• Domain: ${s.domainChoice}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setDeveloperUpsellSvc(s.serviceId)} className="px-3 py-1.5 rounded-full bg-murzak-navy dark:bg-white/10 text-white border border-slate-200 dark:border-white/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-slate-800 dark:hover:bg-white/20 transition shadow-[0_0_15px_rgba(46,166,255,0.15)] group-hover:shadow-[0_0_20px_rgba(46,166,255,0.3)]">
                          <Terminal className="w-3 h-3 text-murzak-cyan" /> Developer Access
                        </button>
                        
                        {s.status === "Active" ? (
                          <span className="px-3 py-1.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> Active
                          </span>
                        ) : s.status === "Setting Up" || s.status === "Provisioning" ? (
                          <span className="px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div> Setting Up
                          </span>
                        ) : (
                          <span className="px-3 py-1.5 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div> {s.status || "Pending"}
                          </span>
                        )}
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => onRequestDelete(s, "billing")}
                        className="p-2.5 rounded-xl bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 hover:text-red-500 hover:border-red-500/30 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
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
          <div className="glass-panel rounded-[3rem] p-8 border border-white/10 h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-[12px] font-black text-slate-800 dark:text-white uppercase tracking-widest flex items-center gap-3">
                <Receipt className="w-5 h-5 text-murzak-cyan" /> Invoices
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
                className="p-2 rounded-xl bg-white/50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:text-murzak-cyan hover:border-murzak-cyan/30 hover:bg-murzak-cyan/10 transition-all disabled:opacity-50"
                title="Download All"
              >
                {downloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar max-h-[600px]">
              {localInvoices.length === 0 ? (
                <div className="text-center py-16">
                  <Receipt className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-4 opacity-50" />
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    No transactions yet.
                  </p>
                </div>
              ) : (
                localInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-5 rounded-[1.75rem] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-murzak-cyan/20 transition-all group relative overflow-hidden"
                  >
                    {/* Status accent line */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${inv.status === 'Paid' ? 'bg-green-500/50' : 'bg-orange-500/50'}`}></div>
                    
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                          {inv.date}
                        </p>
                        <p className="text-xs font-black text-murzak-navy dark:text-white">
                          {(inv.type || "").toLowerCase().replace(/[^a-z]/g, "").includes("addon") ? "Add-on Invoice" : inv.type}
                        </p>
                        {inv.plan && (
                          <p className="text-[9px] font-bold text-murzak-cyan uppercase tracking-widest mt-1">
                            {inv.plan}
                          </p>
                        )}
                      </div>
                      
                      <div className="text-right">
                        <p className="text-lg font-black tracking-tighter">
                          KES {Number(inv.amount || 0).toLocaleString()}
                        </p>
                        <span className={`inline-block mt-1 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${
                          inv.status === 'Paid' 
                            ? 'bg-green-500/10 text-green-500 border-green-500/20' 
                            : 'bg-orange-500/10 text-orange-500 border-orange-500/20'
                        }`}>
                          {inv.status === 'Paid' ? 'Settled' : 'Pending'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t border-slate-200 dark:border-white/10">
                      {inv.status !== "Paid" && (
                        <button
                          onClick={() => navigate(`/payment/${encodeURIComponent(inv.docName)}`)}
                          className="flex-1 py-2.5 rounded-xl bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy font-black text-[9px] uppercase tracking-widest hover:scale-[1.02] transition-all text-center"
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
                        className={`p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:border-murzak-cyan/40 hover:bg-murzak-cyan/10 transition-all ${inv.status === 'Paid' ? 'flex-1 flex justify-center items-center gap-2' : ''}`}
                      >
                        {downloadingId === inv.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        ) : (
                          <>
                            <Download className="w-4 h-4 text-slate-500" />
                            {inv.status === 'Paid' && <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Download</span>}
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
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:border-red-500/40 hover:bg-red-500/10 transition-all text-slate-500 hover:text-red-500"
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

  const renderSyncHub = () => (
    <div className="space-y-12 animate-fade-in max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4 px-1 sm:px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">Updates &amp; support</h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            Messages from our Nairobi team — and your support thread
          </p>
        </div>
        <div className="bg-murzak-cyan/10 text-murzak-cyan px-4 py-2 rounded-xl border border-murzak-cyan/20 text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-[0_0_15px_rgba(46,166,255,0.15)] flex items-center gap-2">
          <Clock className="w-4 h-4" /> Usually replies same day
        </div>
      </div>

      {/* Main Support CTA */}
      <div
        className="glass-card rounded-[3rem] p-8 sm:p-10 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-8 group cursor-pointer relative overflow-hidden"
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
        <div className="absolute inset-0 bg-gradient-to-r from-murzak-navy to-murzak-navy/90 z-0"></div>
        <div className="absolute -right-24 top-1/2 -translate-y-1/2 w-64 h-64 bg-murzak-cyan/20 blur-3xl rounded-full opacity-50 group-hover:opacity-80 transition-opacity duration-700 z-0"></div>

        <div className="relative z-10 flex items-center gap-6 w-full md:w-auto">
          <div className="p-4 sm:p-5 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl relative shadow-lg group-hover:scale-110 transition-transform duration-500">
            <Headphones className="w-8 h-8 text-white" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[24px] h-[24px] px-1 rounded-full bg-murzak-cyan text-murzak-navy text-[11px] font-black flex items-center justify-center shadow-[0_0_10px_rgba(46,166,255,0.5)] border-2 border-murzak-navy animate-pulse">
                {unreadChatCount}
              </span>
            )}
          </div>

          <div>
            <h4 className="text-xl sm:text-2xl font-black tracking-tight text-white group-hover:text-murzak-cyan transition-colors">
              Need a hand with something?
            </h4>
            <p className="text-[10px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest mt-1">
              Open your support thread with our engineering team
            </p>
          </div>
        </div>

        <div className="relative z-10 w-full md:w-auto flex justify-end">
          <div className="p-4 rounded-full bg-white/5 border border-white/10 group-hover:bg-murzak-cyan/20 group-hover:border-murzak-cyan/50 transition-all duration-300">
            <ChevronRight className="w-6 h-6 text-murzak-cyan group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
      </div>      

      <div className="glass-panel rounded-[3rem] p-8 border border-white/10">
        {/* Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-800 dark:text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-murzak-cyan" /> Notifications
          </h3>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-grow sm:flex-grow-0">
              <select
                value={updatesSort}
                onChange={(e) => setUpdatesSort(e.target.value as any)}
                className="w-full appearance-none px-4 py-2.5 pr-10 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:border-murzak-cyan/50 focus:ring-1 focus:ring-murzak-cyan/50"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="alpha">A–Z</option>
                <option value="type">By Type</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                <ChevronRight className="w-4 h-4 rotate-90" />
              </div>
            </div>

            <button
              onClick={selectAll}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Select all
            </button>

            <button
              onClick={clearSelection}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Clear
            </button>
            
            <button
              onClick={bulkDelete}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
            </button>
          </div>
        </div>
      
        <div className="space-y-4">
          {sortedUpdates.map((update) => {
            const isOpen = expandedId === update.id;
            const title = (update as any).title || `${update.engineer} — ${update.type}`;
            const isUnread = !update.acknowledged;

            return (
              <div key={update.id} className={`glass-card rounded-[2rem] border transition-all duration-300 ${
                isUnread ? 'border-murzak-cyan/30 shadow-[0_0_15px_rgba(46,166,255,0.1)]' : 'border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]'
              } ${isOpen ? 'p-6' : 'p-4'}`}>
                {/* row: checkbox + header + single delete */}
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(update.id)}
                      onChange={() => toggleSelected(update.id)}
                      className="w-5 h-5 rounded border-slate-300 dark:border-white/20 text-murzak-cyan focus:ring-murzak-cyan/50 cursor-pointer appearance-none bg-white dark:bg-white/10 checked:bg-murzak-cyan checked:border-murzak-cyan transition-all peer"
                    />
                    <CheckCircle2 className="w-3.5 h-3.5 text-murzak-navy absolute pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : update.id)}
                    className="flex-1 text-left group"
                  >
                    {/* collapsed title line */}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                      <div className="flex items-center gap-3">
                        {isUnread && <div className="w-2 h-2 rounded-full bg-murzak-cyan shadow-[0_0_8px_#2ea6ff] animate-pulse"></div>}
                        <span className={`text-[11px] font-black uppercase tracking-widest ${isUnread ? 'text-murzak-cyan' : 'text-slate-600 dark:text-slate-300'} group-hover:text-murzak-cyan transition-colors`}>
                          {title}
                        </span>
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-5 sm:ml-0">
                        <Calendar className="w-3 h-3" />
                        {new Date(update.timestamp).toLocaleDateString()} •{" "}
                        {new Date(update.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteOneUpdate(update.id)}
                    className="p-2.5 rounded-xl hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete notification"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : update.id)}
                    className={`p-2 rounded-full hover:bg-white/10 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <ChevronRight className="w-5 h-5 rotate-90" />
                  </button>
                </div>

                {/* expanded details */}
                <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100 mt-6' : 'grid-rows-[0fr] opacity-0'}`}>
                  <div className="overflow-hidden pl-9 pr-14">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed bg-white/50 dark:bg-white/5 p-5 rounded-2xl border border-slate-100 dark:border-white/5">
                      {update.content}
                    </p>

                    <div className="flex justify-end pt-5 mt-5 border-t border-slate-100 dark:border-white/10">
                      {!update.acknowledged ? (
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
                          className="bg-murzak-cyan text-murzak-navy px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-[0_0_15px_rgba(46,166,255,0.3)] flex items-center gap-2"
                        >
                          Mark as read <CheckCircle2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" /> Read
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {sortedUpdates.length === 0 && (
            <div className="text-center py-20 bg-slate-50 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10">
              <div className="w-20 h-20 rounded-full bg-slate-200/50 dark:bg-white/5 flex items-center justify-center mx-auto mb-6">
                <Bell className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">
                No updates yet
              </p>
              <p className="text-[10px] font-bold text-slate-400 mt-2">
                We'll notify you here when there's news about your systems.
              </p>
            </div>
          )}
        </div>
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

      {!cloudServiceId && (
        <div className="space-y-8">
          <TopologyMap 
            services={selectedServices} 
            onNodeClick={(id) => {
              const svc = selectedServices.find(s => s.serviceId === id);
              if (svc?.status === "Awaiting Payment") {
                navigate("/portal/billing");
              } else {
                setActiveLogServiceId(id);
              }
            }}
          />
        </div>
      )}

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
                onClick={() => setIsContactOpen(true)}
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
    <div className="space-y-12 animate-fade-in max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4 px-1 sm:px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">Account Profile</h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            Manage your personal information, security and active plans
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {/* Personal Information */}
        <div className="glass-card bg-white/80 dark:bg-murzak-navy/80 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-white/5 p-8 sm:p-10 rounded-[3rem] shadow-lg sm:shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-700 pointer-events-none">
            <UserIcon className="w-24 h-24 text-murzak-cyan" />
          </div>
          
          <h3 className="text-[12px] font-black text-slate-800 dark:text-white uppercase tracking-widest mb-8 flex items-center gap-3 relative z-10">
            <UserCircle className="w-5 h-5 text-murzak-cyan" /> Personal Information
          </h3>
          
          <div className="space-y-8 relative z-10">
            <div className="group/item">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-cyan/50 group-hover/item:bg-murzak-cyan transition-colors"></span> Full Name
              </p>
              <p className="text-xl sm:text-2xl font-black text-murzak-navy dark:text-white break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-cyan/30 transition-all">
                {user.name}
              </p>
            </div>
            
            <div className="group/item">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-cyan/50 group-hover/item:bg-murzak-cyan transition-colors"></span> Email Address
              </p>
              <p className="text-lg sm:text-xl font-black text-murzak-navy dark:text-white break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-cyan/30 transition-all">
                {user.email}
              </p>
            </div>
            
            <div className="group/item">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-murzak-cyan/50 group-hover/item:bg-murzak-cyan transition-colors"></span> Business Name
              </p>
              <p className="text-xl sm:text-2xl font-black text-murzak-navy dark:text-white break-words pl-3 border-l-2 border-transparent group-hover/item:border-murzak-cyan/30 transition-all">
                {user.company}
              </p>
            </div>
          </div>
        </div>

        {/* Service Plan */}
        <div className="glass-card bg-murzak-navy text-white p-8 sm:p-10 rounded-[3rem] border border-white/10 shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-transparent to-murzak-cyan/5 z-0 pointer-events-none"></div>
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-murzak-cyan/10 blur-3xl rounded-full opacity-50 group-hover:opacity-80 transition-opacity duration-700 pointer-events-none z-0"></div>

          <div className="relative z-10">
            <h3 className="text-[12px] font-black text-white uppercase tracking-widest mb-8 flex items-center gap-3">
              <Shield className="w-5 h-5 text-murzak-cyan" /> Service Plan
            </h3>
            
            <div className="flex flex-col gap-2 mb-8">
              <p className="text-4xl sm:text-5xl font-[900] tracking-tighter uppercase text-white">
                {user.plan || "None"}
              </p>
              <div className="inline-flex self-start items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/20 backdrop-blur-md">
                <div className={`w-1.5 h-1.5 rounded-full ${user.accountStatus === 'Active' ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-orange-400 shadow-[0_0_8px_#fb923c]'}`}></div>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
                  Status: {user.accountStatus}
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm group-hover:bg-white/10 transition-colors">
              <div className="flex justify-between items-center mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">
                  Provisioned Services
                </p>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <Server className="w-4 h-4 text-white" />
                </div>
              </div>
              
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black">{selectedServices.length}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pb-1">
                  Active
                </span>
              </div>
              
              <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-center">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Available Slots</span>
                <span className="text-[10px] font-black text-white">{remainingSlots}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 mt-8 relative z-10">
            <button
              onClick={() => {
                setAddonsError("");
                setAddonsOpen(true);
              }}
              className="w-full bg-murzak-cyan text-murzak-navy rounded-xl font-black text-[10px] uppercase tracking-widest py-3 sm:py-4 hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(46,166,255,0.2)] flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Services
            </button>

            <button
              onClick={goToUpgrade}
              className="w-full bg-white/5 border border-white/15 text-white rounded-xl font-black text-[10px] uppercase tracking-widest py-3 sm:py-4 hover:bg-white/10 transition-all backdrop-blur-md flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 text-murzak-cyan" /> Upgrade Plan
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel p-8 sm:p-10 rounded-[3rem] border border-white/10">
        <h3 className="text-[12px] font-black text-slate-800 dark:text-white uppercase tracking-widest mb-8 flex items-center gap-3">
          <Settings className="w-5 h-5 text-murzak-cyan" /> Account Preferences
        </h3>
        
        <div className="space-y-6">
          <ChangePasswordCard />
          
          <div className="pt-8 mt-8 border-t border-slate-200 dark:border-white/10 flex flex-col sm:flex-row justify-between items-center gap-6">
            <div>
              <h4 className="text-sm font-black text-murzak-navy dark:text-white">Welcome Tour</h4>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Re-run the onboarding experience</p>
            </div>
            <button
              onClick={() => setShowOnboarding(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 text-murzak-navy dark:text-white font-black text-[10px] uppercase tracking-widest hover:border-murzak-cyan hover:bg-murzak-cyan/5 transition-all"
            >
              <Activity className="w-4 h-4 text-murzak-cyan" /> Replay Tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRoadmap = () => (
    <div className="space-y-12 animate-fade-in max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 mb-4 px-1 sm:px-2">
        <div>
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase leading-none">Product Roadmap</h2>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">
            See what we're building and what's coming next
          </p>
        </div>
      </div>

      <div className="glass-card bg-murzak-navy text-white p-8 sm:p-12 lg:p-16 rounded-[3rem] border border-white/10 shadow-2xl relative overflow-hidden group min-h-[400px] flex items-center justify-center text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-murzak-navy to-murzak-navy/80 z-0"></div>
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-murzak-cyan/20 blur-3xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none z-0"></div>
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-500/20 blur-3xl rounded-full opacity-50 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none z-0"></div>

        <div className="relative z-10 max-w-lg mx-auto">
          <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-8 shadow-xl relative group-hover:scale-110 transition-transform duration-700">
            <div className="absolute inset-0 border border-murzak-cyan/30 rounded-full animate-ping opacity-20"></div>
            <Navigation className="w-10 h-10 sm:w-12 sm:h-12 text-murzak-cyan" />
          </div>
          
          <h3 className="text-3xl sm:text-4xl font-[900] tracking-tighter uppercase mb-4 text-white">
            Charting the Future
          </h3>
          
          <p className="text-sm sm:text-base font-medium text-slate-400 leading-relaxed mb-10">
            Our engineering team is hard at work building the next generation of enterprise tools. The roadmap module will launch here shortly with interactive feature voting and progress tracking.
          </p>

          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-murzak-cyan shadow-[0_0_8px_#2ea6ff] animate-pulse"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
              Module currently in development
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTab = (tab: Tab) => {
    switch (tab) {
      case "overview":
        return renderOverview();
      case "cloud":
        return renderCloud();
      case "billing":
        return renderBilling();
      case "profile":
        return renderProfile();
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
              Welcome back, {(user.name || "User").split(" ")[0]}
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

        {/* Billing / trial status banner — one slot, highest-priority state wins.
            (The trial states were computed but unrendered after the portal
            redesign; this restores the verify-to-start prompt.) */}
        {(() => {
          const banner = (tone: "red" | "amber" | "cyan", icon: React.ReactNode, text: React.ReactNode, cta?: { label: string; onClick: () => void }) => {
            const tones = {
              red: "border-red-500/30 bg-red-500/10",
              amber: "border-amber-400/30 bg-amber-400/10",
              cyan: "border-murzak-cyan/30 bg-murzak-cyan/10",
            } as const;
            return (
              <div className={`max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center gap-4 rounded-3xl border p-5 sm:p-6 ${tones[tone]}`}>
                <div className="shrink-0">{icon}</div>
                <p className="flex-grow text-sm font-bold text-murzak-navy dark:text-white leading-relaxed">{text}</p>
                {cta && (
                  <button
                    type="button"
                    onClick={cta.onClick}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
                  >
                    {cta.label} <ArrowRight size={14} />
                  </button>
                )}
              </div>
            );
          };

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
              <Zap size={22} className="text-murzak-cyan" />,
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
              <CheckCircle2 size={22} className="text-murzak-cyan" />,
              <>Trial sandbox live — ends {trialEndStr}. Pick a plan before then to keep everything you build.</>,
              { label: "Choose a plan", onClick: () => navigate("/pricing") }
            );
          }
          return null;
        })()}

        <div className="max-w-7xl mx-auto">
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={renderTab("overview")} />
            <Route path="cloud" element={renderTab("cloud")} />
            <Route path="billing" element={renderTab("billing")} />
            <Route path="profile" element={renderTab("profile")} />
            <Route path="admin" element={isAdmin ? <AdminTabs /> : <Navigate to="/portal/overview" replace />} />
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

      {/* Developer Upsell Modal */}
      {developerUpsellSvc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-murzak-navy/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-murzak-navy w-full max-w-lg rounded-[2rem] p-8 shadow-2xl border border-slate-100 dark:border-white/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-murzak-cyan/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/3"></div>
            
            <button onClick={() => !requestingDeveloper && setDeveloperUpsellSvc(null)} className="absolute top-6 right-6 p-2 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition z-10 text-slate-500">
              <X className="w-5 h-5" />
            </button>
            
            <div className="relative z-10">
              <div className="inline-flex p-4 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-6">
                <Terminal className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-[900] tracking-tighter text-murzak-navy dark:text-white mb-2">Unlock Developer Tier</h3>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-6">
                Need more control? Upgrade this service to the Developer Tier to get raw programmatic access while maintaining our managed infrastructure.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                  <Terminal className="w-5 h-5 text-murzak-cyan shrink-0" />
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-murzak-navy dark:text-white mb-1">Jailed SSH Access</h4>
                    <p className="text-xs text-slate-500">Secure shell access directly into your service environment.</p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                  <Database className="w-5 h-5 text-murzak-cyan shrink-0" />
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-murzak-navy dark:text-white mb-1">Direct DB Connection</h4>
                    <p className="text-xs text-slate-500">Read/Write access to your isolated MariaDB instance.</p>
                  </div>
                </div>
                <div className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                  <Shield className="w-5 h-5 text-murzak-cyan shrink-0" />
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-murzak-navy dark:text-white mb-1">Full Frappe Administrator</h4>
                    <p className="text-xs text-slate-500">Create custom doctypes, server scripts, and UI tweaks.</p>
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
                className="w-full px-6 py-4 rounded-xl bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100"
              >
                {requestingDeveloper ? "Submitting Request..." : "Request Upgrade"}
              </button>
              <p className="text-[9px] font-bold text-slate-400 text-center uppercase tracking-widest mt-4">
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

export default Portal;
