// Portal data layer — every piece of state, effect, derived value and handler
// the portal screens share. Extracted verbatim from the old 3,195-line
// Portal.tsx so the screens could become separate files; the logic itself is
// unchanged. Consumers reach it through usePortal() (see PortalContext.tsx),
// never by prop-drilling ~100 values through the shell.
//
// NEXT: this is still one large unit. The natural follow-up is to split it by
// domain (services, invoices, updates, resource ops, uploads) — deliberately
// not done in the same pass as the file split, to keep that change reviewable.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  CreditCard,
  Headphones,
  LayoutDashboard,
  Plus,
  Server,
  ShieldCheck,
  Terminal,
  User as UserIcon,
} from "lucide-react";

import { ProjectUpdate, type SelectedServiceView, type ServiceStatus } from "../../types";
import Contact from "../Contact";
import ResourceAdminPanel from "../../components/portal/cloud/ResourceAdminPanel";
import ResourceUtilizationCard from "../../components/portal/ResourceUtilizationCard";
import { adminUnreadCount } from "../../services/adminChat";
import { type CommandAction } from "../../components/portal/CommandPalette";
import {
  fetchServiceActivity,
  fetchServiceDeployments,
  fetchDeploymentLog,
  requestRedeploy,
  ProvisioningActivityEntry,
  DeploymentEntry,
} from "../../services/serviceActivity";
import { PLAN_LIMITS, SERVICE_CATALOG, type PlanCode } from "../../config/serviceCatalog";
import { allowedAddonTiers, normalizePlanToCode } from "./helpers";
import { isTab, type PortalProps, type Tab } from "./types";

export function usePortalState({ user, onLogout, onNavigate, onUserUpdate }: PortalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSystemsNavOpen, setIsSystemsNavOpen] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState(0);
  const [localUpdates, setLocalUpdates] = useState<ProjectUpdate[]>(user.updates || []);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesSort, setUpdatesSort] = useState<"newest" | "oldest" | "alpha" | "type">("newest");

  const [isContactOpen, setIsContactOpen] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const [localInvoices, setLocalInvoices] = useState<any[]>(user.invoices || []);
  // NOTE: this state was set from 3 call sites but never rendered anywhere —
  // a failed plan/service attach after signup/login, or a submitted developer-
  // access request, gave the customer zero feedback. Wired into the existing
  // priority banner slot below. Tone tracked alongside since the same state
  // carries both a success message (line ~252) and error messages.
  const [planAttachBanner, setPlanAttachBanner] = useState<string>("");
  const [planAttachBannerTone, setPlanAttachBannerTone] = useState<"error" | "success">("error");

  // Upload UI
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const [uploadsLoaded, setUploadsLoaded] = useState(false);

  // BYOA project repository (Web Account.source_code) — shown + editable on
  // My Account so the repo App Hosting deploys from is never write-only.
  const [repoDraft, setRepoDraft] = useState<string>(user.sourceCode || "");
  const [repoSaving, setRepoSaving] = useState(false);
  const [repoMsg, setRepoMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  // Restart/Stop/Start (Phase 2 of the resource-management dashboard). These
  // deliberately never touch service status/health elsewhere in the portal —
  // success only means the action was accepted by Coolify, not that the
  // service is verified healthy. See how-does-one-create-deep-kazoo.md.
  const [pendingServiceAction, setPendingServiceAction] = useState<{ id: string; action: string } | null>(null);
  const [stopConfirmService, setStopConfirmService] = useState<{ id: string; name: string } | null>(null);
  const [serviceActionNotice, setServiceActionNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const performServiceAction = async (action: "restart" | "start" | "stop", id: string) => {
    setPendingServiceAction({ id, action });
    setServiceActionNotice(null);
    try {
      const res = await fetch(`/api/portal/services/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to ${action} this service.`);
      setServiceActionNotice({ type: "success", text: data?.message || `${action[0].toUpperCase()}${action.slice(1)} requested.` });
    } catch (e: any) {
      setServiceActionNotice({ type: "error", text: e?.message || `Failed to ${action} this service.` });
    } finally {
      setPendingServiceAction(null);
    }
  };

  const handleServiceHealthAction = (action: string, id: string) => {
    if (action === "manage") {
      onTabClick("cloud");
      navigate(`/portal/cloud?service=${encodeURIComponent(id)}`);
      return;
    }
    if (action === "stop") {
      const svc = selectedServices.find((s) => s.serviceId === id);
      setStopConfirmService({ id, name: svc?.name || "this service" });
      return;
    }
    if (action === "restart" || action === "start") {
      performServiceAction(action, id);
    }
    if (action === "scale") {
      setScalingServiceId(id);
    }
  };

  const [scalingServiceId, setScalingServiceId] = useState<string | null>(null);

  const [developerUpsellSvc, setDeveloperUpsellSvc] = useState<string | null>(null);
  // Set by ResourceAdminPanel once every gate passes — the "fully managed, no
  // console to babysit" promise below is only true while it's false.
  const [resourceAdminActive, setResourceAdminActive] = useState(false);
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
      setPlanAttachBannerTone("success");
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

  useEffect(() => {
    if (activeTab === "cloud") setIsSystemsNavOpen(true);
  }, [activeTab]);

  const onTabClick = (tab: Tab) => {
    navigate(`/portal/${tab}`);
    setIsSidebarOpen(false);
  };

  const cloudServiceId = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return sp.get("service") || null;
  }, [location.search]);

  // Real site URL + honest provisioning state for the generic (non-website-
  // hosting) service panel. The backend only ever returns the CUSTOMER's URL
  // (never an internal/admin one) and a server-derived statusDetail so this
  // panel can say "build failed" / "add your repo" instead of showing nothing.
  const [cloudAccessUrl, setCloudAccessUrl] = useState<string>("");
  const [cloudJob, setCloudJob] = useState<ProvisioningActivityEntry | null>(null);
  useEffect(() => {
    setCloudAccessUrl("");
    setCloudJob(null);
    if (!cloudServiceId || cloudServiceId === "biz-web-hosting") return;
    let cancelled = false;
    fetchServiceActivity(cloudServiceId)
      .then((jobs) => {
        if (cancelled) return;
        const withUrl = jobs.find((j) => j.accessUrl);
        setCloudAccessUrl(withUrl?.accessUrl || "");
        setCloudJob(jobs[0] || null);
      })
      .catch(() => {
        if (!cancelled) {
          setCloudAccessUrl("");
          setCloudJob(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cloudServiceId]);

  // Deployment history (Milestone 2) — only applicable to git-sourced apps;
  // available:false hides the whole section, so non-app services see nothing.
  const [deployments, setDeployments] = useState<DeploymentEntry[]>([]);
  const [deploymentsAvailable, setDeploymentsAvailable] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployNote, setRedeployNote] = useState("");
  const [deployLogView, setDeployLogView] = useState<{ uuid: string; logs: string; loading: boolean } | null>(null);
  const refreshDeployments = (serviceId: string) =>
    fetchServiceDeployments(serviceId)
      .then((d) => {
        setDeploymentsAvailable(d.available);
        setDeployments(d.deployments);
      })
      .catch(() => {
        setDeploymentsAvailable(false);
        setDeployments([]);
      });
  useEffect(() => {
    setDeployments([]);
    setDeploymentsAvailable(false);
    setRedeployNote("");
    setDeployLogView(null);
    if (!cloudServiceId || cloudServiceId === "biz-web-hosting") return;
    let cancelled = false;
    fetchServiceDeployments(cloudServiceId)
      .then((d) => {
        if (cancelled) return;
        setDeploymentsAvailable(d.available);
        setDeployments(d.deployments);
      })
      .catch(() => {
        if (!cancelled) setDeploymentsAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudServiceId]);

  const handleRedeploy = async () => {
    if (!cloudServiceId || redeploying) return;
    setRedeploying(true);
    setRedeployNote("");
    try {
      const r = await requestRedeploy(cloudServiceId);
      setRedeployNote(r.message || "Redeploy started.");
      await refreshDeployments(cloudServiceId);
    } catch (e: any) {
      setRedeployNote(e?.message || "Failed to start the redeploy.");
    } finally {
      setRedeploying(false);
    }
  };

  const openDeployLog = async (uuid: string) => {
    if (!cloudServiceId) return;
    setDeployLogView({ uuid, logs: "", loading: true });
    try {
      const r = await fetchDeploymentLog(cloudServiceId, uuid);
      setDeployLogView({ uuid, logs: r.logs || "(no log recorded for this deployment)", loading: false });
    } catch (e: any) {
      setDeployLogView({ uuid, logs: e?.message || "Couldn't load this log.", loading: false });
    }
  };

  // Self-service domain attach (Phase 4). Reset whenever the user navigates
  // to a different service so a stale success/error message from a previous
  // service never lingers.
  const [domainInput, setDomainInput] = useState("");
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [domainResult, setDomainResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    setDomainInput("");
    setDomainResult(null);
  }, [cloudServiceId]);

  const submitDomainAttach = async () => {
    if (!cloudServiceId || !domainInput.trim()) return;
    setDomainSubmitting(true);
    setDomainResult(null);
    try {
      const res = await fetch(`/api/portal/services/${encodeURIComponent(cloudServiceId)}/domain`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to connect this domain.");
      setDomainResult({ type: "success", text: data?.message || "Domain connected." });
    } catch (e: any) {
      setDomainResult({ type: "error", text: e?.message || "Failed to connect this domain." });
    } finally {
      setDomainSubmitting(false);
    }
  };


  // Admins LAND on the inbox, but are not trapped there. This used to fire on
  // every render pass, so any attempt to visit another tab bounced straight
  // back to /portal/admin and staff could never see the customer-side portal.
  const adminLandingDone = useRef(false);
  useEffect(() => {
    if (!isAdmin || adminLandingDone.current) return;
    adminLandingDone.current = true;
    // Only redirect from the default entry point — a deep link is honoured.
    const entry = location.pathname.replace(/\/+$/, "");
    if (entry === "/portal" || entry === "/portal/overview") {
      navigate("/portal/admin", { replace: true });
    }
  }, [isAdmin, location.pathname, navigate]);

  // Staff unread badge — the counterpart to the customer's unread count.
  // Polled here (not in the inbox) so the sidebar badge is live from any tab.
  const [adminUnread, setAdminUnread] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const tick = () => {
      adminUnreadCount()
        .then((n) => { if (!cancelled) setAdminUnread(n); })
        .catch(() => {});
    };
    tick();
    const h = window.setInterval(tick, 30000);
    return () => { cancelled = true; window.clearInterval(h); };
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

  // "Couldn't attach your plan/services" banner: Login.tsx surfaces this via
  // two different channels depending on which flow failed — location.state
  // (login/Google sign-in, tied to the navigation that just happened) or
  // sessionStorage (signup, since that flow's navigate() call carries no
  // state). Merged into ONE effect with an explicit precedence — location.state
  // wins as the fresher source — so the outcome never depends on which of two
  // separate effects happened to run second (previously effect-declaration
  // order decided the winner, an easy thing to invert by accident later).
  useEffect(() => {
    const fromState = (location.state as any)?.attachError;
    const fromStorage = sessionStorage.getItem("murzak_pending_attach_error");
    // Always consume the stored one so it never resurfaces on a later visit,
    // whether or not it's the message actually shown this time.
    if (fromStorage) sessionStorage.removeItem("murzak_pending_attach_error");

    const msg = fromState || fromStorage;
    if (!msg) return;

    setPlanAttachBannerTone("error");
    setPlanAttachBanner(msg);
    if (fromState) {
      // Clear it from history so a refresh doesn't show it again.
      window.history.replaceState({}, document.title);
    }

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



  const allMenuItems: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-5 h-5" /> },
    { id: "cloud", label: "My Systems", icon: <Server className="w-5 h-5" /> },
    { id: "billing", label: "Billing", icon: <CreditCard className="w-5 h-5" /> },
    { id: "profile", label: "My Account", icon: <UserIcon className="w-5 h-5" /> },
    // Staff only. Carries the support badge so an unanswered customer is
    // visible from anywhere in the portal, not just inside the inbox.
    ...(isAdmin
      ? [{ id: "admin" as Tab, label: "Admin", icon: <ShieldCheck className="w-5 h-5" />, badge: adminUnread }]
      : []),
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
      const capacityClass = svc?.capacityClass;
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
        capacityClass,
      };
    });
  }, [user, catalogLookup, addonServiceIds]);

  // Real usage metrics (Phase 3) for the Overview ResourceUtilizationCard —
  // the account-level card shows usage for the first Active service, since
  // that card isn't per-service. Degrades to "not available" (undefined
  // fields) on any error, missing service, or if Coolify doesn't expose
  // usage data — never fabricates a number.
  const [serviceUsage, setServiceUsage] = useState<{
    diskUsagePercent?: number;
    ramUsagePercent?: number;
  }>({});
  useEffect(() => {
    const primary = selectedServices.find((s) => s.status === "Active");
    if (!primary) {
      setServiceUsage({});
      return;
    }
    let cancelled = false;
    fetch(`/api/portal/services/${encodeURIComponent(primary.serviceId)}/usage`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.available) return;
        const diskUsagePercent =
          typeof data.diskUsedGb === "number" && typeof data.diskLimitGb === "number" && data.diskLimitGb > 0
            ? Math.round((data.diskUsedGb / data.diskLimitGb) * 100)
            : undefined;
        const ramUsagePercent =
          typeof data.ramUsedMb === "number" && typeof data.ramLimitMb === "number" && data.ramLimitMb > 0
            ? Math.round((data.ramUsedMb / data.ramLimitMb) * 100)
            : undefined;
        setServiceUsage({ diskUsagePercent, ramUsagePercent });
      })
      .catch(() => {
        if (!cancelled) setServiceUsage({});
      });
    return () => {
      cancelled = true;
    };
  }, [selectedServices]);

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
  // Files are attached to the Web Account server-side (see POST
  // /api/portal/upload), so the list survives reloads — fetch it once on
  // mount and re-fetch after every successful upload rather than relying on
  // session-only optimistic state.
  const fetchUploads = React.useCallback(async () => {
    try {
      const res = await fetch("/api/portal/uploads", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && Array.isArray(data.files)) {
        setUploadedFiles(data.files.map((f: any) => ({ name: f.name, url: f.url })));
      }
    } catch {
      // Leave whatever's already in state — a failed refresh isn't worth an error banner.
    } finally {
      setUploadsLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const handleGeneralUpload = async (file: File) => {
    setUploadErr("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/portal/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      await fetchUploads();
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
  const saveRepo = async () => {
    setRepoSaving(true);
    setRepoMsg(null);
    try {
      const res = await fetch("/api/portal/account/repo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repoUrl: repoDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save.");
      onUserUpdate({ ...user, sourceCode: data.sourceCode });
      setRepoMsg({ ok: true, text: "Saved. New App Hosting orders deploy from this repository." });
    } catch (e: any) {
      setRepoMsg({ ok: false, text: e?.message || "Failed to save." });
    } finally {
      setRepoSaving(false);
    }
  };

  return {
    accountSuspended,
    activeLogServiceId,
    activeTab,
    addonCandidates,
    addonsDisabledReason,
    addonsOpen,
    addonsSourceTab,
    adminUnread,
    allMenuItems,
    applyAddonsSelection,
    cloudAccessUrl,
    cloudJob,
    cloudServiceId,
    commandActions,
    deleteConfirmText,
    deleteError,
    deleteLoading,
    deleteTarget,
    deletingId,
    deployLogView,
    deployments,
    deploymentsAvailable,
    developerUpsellError,
    developerUpsellSvc,
    dismissOnboarding,
    domainInput,
    domainResult,
    domainSubmitting,
    downloadingAll,
    downloadingId,
    dueSubscriptionInvoice,
    goToAddServices,
    goToUpgrade,
    handleDelete,
    handleDeveloperUpsell,
    handleGeneralUpload,
    handleRedeploy,
    handleServiceHealthAction,
    includedSelectedCount,
    isAdmin,
    isCommandPaletteOpen,
    isContactOpen,
    isSidebarOpen,
    isSystemsNavOpen,
    isTestUser,
    localInvoices,
    localUpdates,
    monthlyBurnKes,
    navigate,
    navigateToPricingUpgrade,
    needsTrialVerify,
    onLogout,
    onNavigate,
    onRequestDelete,
    onTabClick,
    onUserUpdate,
    openAddonsModal,
    openDeployLog,
    pendingServiceAction,
    performServiceAction,
    planAttachBanner,
    planAttachBannerTone,
    planLimit,
    provisionProgress,
    redeployNote,
    redeploying,
    remainingSlots,
    repoDraft,
    repoMsg,
    repoSaving,
    requestingDeveloper,
    resourceAdminActive,
    saveRepo,
    scalingServiceId,
    selectedServices,
    serviceActionNotice,
    serviceUsage,
    setActiveLogServiceId,
    setAddonsError,
    setAddonsOpen,
    setAdminUnread,
    setDeleteConfirmText,
    setDeleteTarget,
    setDeletingId,
    setDeployLogView,
    setDeveloperUpsellSvc,
    setDomainInput,
    setDownloadingAll,
    setDownloadingId,
    setIsCommandPaletteOpen,
    setIsContactOpen,
    setIsSidebarOpen,
    setIsSystemsNavOpen,
    setLocalInvoices,
    setRepoDraft,
    setRepoMsg,
    setResourceAdminActive,
    setScalingServiceId,
    setServiceActionNotice,
    setShowOnboarding,
    setStopConfirmService,
    setUpgradePromptOpen,
    showOnboarding,
    stopConfirmService,
    submitDomainAttach,
    trialActive,
    trialEndStr,
    trialExpired,
    trialVerifyInvoice,
    upgradePromptOpen,
    uploadErr,
    uploadedFiles,
    uploading,
    user,
  };
}

/** The full shape usePortal() hands to the shell and every tab. */
export type PortalValue = ReturnType<typeof usePortalState>;
