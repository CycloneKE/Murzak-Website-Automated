
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Globe,
  HardDrive,
  LifeBuoy,
  Link as LinkIcon,
  Loader2,
  Network,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Upload,
  Wand2,
} from "lucide-react";
import {
  createDomainPurchaseRequest,
  createExternalDomainConnection,
  createHostingSubdomain,
  createHostingSupportRequest,
  createMurzakSubdomain,
  fetchHostingDashboard,
  requestDeployment,
  uploadHostingFile,
} from "../../../../services/hostingPortal";
import type {
  HostingDashboardPayload,
  HostingDeployment,
  HostingDomainChoice,
  HostingFile,
} from "../../../../types/hosting";
import ResourceUtilizationCard from "../../ResourceUtilizationCard";
import ServiceHealthCard from "../../ServiceHealthCard";
import { toUserMessage } from "../../../../services/errors";

type SetupTab = "overview" | "setup" | "requests";
type LiveTab = "overview" | "files" | "deployments" | "subdomains" | "requests" | "activity";

const cardClass =
  "rounded-lg border border-p-border bg-p-panel p-5 sm:p-6";

const inputClass =
  "w-full rounded-lg border border-p-border bg-p-panel px-4 py-3 outline-hidden text-p-text placeholder:text-p-muted focus:border-p-accent focus:ring-2 focus:ring-p-accent/40 transition-all";

const textareaClass =
  "w-full min-h-[120px] rounded-lg border border-p-border bg-p-panel px-4 py-3 outline-hidden text-p-text placeholder:text-p-muted focus:border-p-accent focus:ring-2 focus:ring-p-accent/40 transition-all";

const primaryBtnClass =
  "px-4 py-3 rounded-lg bg-p-accent text-p-accent-fg font-semibold text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all ";

const secondaryBtnClass =
  "px-4 py-3 rounded-lg border border-p-border bg-p-panel text-p-text font-semibold text-xs transition-all hover:border-p-accent disabled:opacity-50 disabled:cursor-not-allowed";

const tabClass = (active: boolean) =>
  `px-4 py-2.5 rounded-lg text-xs font-semibold border transition-all ${
    active
      ? "bg-p-accent text-p-accent-fg border-p-accent/40 "
      : "bg-p-panel border-p-border border-2 text-p-muted hover:border-p-accent"
  }`;

const formatDateTime = (value?: string) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

const formatMb = (value?: number) => {
  const n = Number(value || 0);
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
  return `${n.toFixed(2)} MB`;
};

const getFileTypeLabel = (file: HostingFile) => {
  if (file.fileType) return file.fileType;
  const parts = String(file.fileName || "").split(".");
  return parts.length > 1 ? `.${parts.pop()}` : "file";
};

function normalizeChoice(v: string | null | undefined): HostingDomainChoice | null {
  const value = String(v || "").trim();
  if (value === "Use Murzak Subdomain") return "Use Murzak Subdomain";
  if (value === "Bring My Domain") return "Bring My Domain";
  if (value === "Register New Domain") return "Register New Domain";
  return null;
}

function statusTone(status: string | undefined): "green" | "orange" | "blue" | "slate" {
  const s = String(status || "").toLowerCase();
  if (
    s.includes("active") ||
    s.includes("connected") ||
    s.includes("purchased") ||
    s.includes("resolved") ||
    s.includes("success") ||
    s.includes("completed")
  ) {
    return "green";
  }
  if (
    s.includes("pending") ||
    s.includes("awaiting") ||
    s.includes("verifying") ||
    s.includes("quoted") ||
    s.includes("processing")
  ) {
    return "orange";
  }
  if (s.includes("open") || s.includes("progress") || s.includes("uploaded")) {
    return "blue";
  }
  return "slate";
}

const badgeClass = (tone: "green" | "orange" | "blue" | "slate") => {
  if (tone === "green") {
    return "px-3 py-1 rounded-full text-xs font-semibold bg-p-success-soft text-p-success border border-p-success/40";
  }
  if (tone === "orange") {
    return "px-3 py-1 rounded-full text-xs font-semibold bg-p-warning-soft text-p-warning border border-p-warning/40";
  }
  if (tone === "blue") {
    return "px-3 py-1 rounded-full text-xs font-semibold bg-p-accent-soft text-p-accent-text border border-p-accent/40";
  }
  return "px-3 py-1 rounded-full text-xs font-semibold bg-p-panel-2 text-p-muted border border-p-border ";
};

function choiceMeta(choice: HostingDomainChoice | null) {
  if (choice === "Register New Domain") {
    return {
      title: "Register New Domain",
      description:
        "Request a new domain for Murzak Tech to purchase, configure and activate on your hosting environment.",
      icon: Globe,
      tone: "blue" as const,
    };
  }

  if (choice === "Use Murzak Subdomain") {
    return {
      title: "Use Murzak Subdomain",
      description:
        "Host your site on a Murzak-managed subdomain and move into full hosting once provisioning is complete.",
      icon: Wand2,
      tone: "green" as const,
    };
  }

  if (choice === "Bring My Domain") {
    return {
      title: "Bring My Domain",
      description:
        "Connect a domain you already own and let Murzak Tech complete DNS, SSL and hosting activation.",
      icon: LinkIcon,
      tone: "orange" as const,
    };
  }

  return {
    title: "Setup Type Missing",
    description:
      "Your hosting account does not yet have a domain setup option attached. Please contact support.",
    icon: AlertCircle,
    tone: "slate" as const,
  };
}

function FileList({
  files,
  emptyText,
}: {
  files: HostingFile[];
  emptyText: string;
}) {
  if (!files.length) {
    return <p className="text-sm text-p-muted">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div
          key={file.id}
          className="rounded-lg border border-p-border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-p-text break-all">
                {file.fileName}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={badgeClass("slate")}>{file.uploadCategory || "file"}</span>
                <span className={badgeClass(statusTone(file.status))}>{file.status}</span>
                {file.isActiveBuild ? <span className={badgeClass("green")}>Active Build</span> : null}
              </div>
              <p className="mt-3 text-xs text-p-muted">
                {getFileTypeLabel(file)} • {formatMb(file.fileSizeMb)} • {formatDateTime(file.createdAt)}
              </p>
              {file.filePath ? (
                <p className="mt-2 text-xs text-p-muted break-all">{file.filePath}</p>
              ) : null}
              {file.notes ? (
                <p className="mt-2 text-sm text-p-muted ">{file.notes}</p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeploymentList({
  deployments,
  emptyText,
}: {
  deployments: HostingDeployment[];
  emptyText: string;
}) {
  if (!deployments.length) {
    return <p className="text-sm text-p-muted">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {deployments.map((dep) => (
        <div
          key={dep.id}
          className="rounded-lg border border-p-border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-p-text ">
                {dep.sourceFile || "Deployment Request"}
              </p>
              <p className="text-xs text-p-muted mt-1">
                {dep.deploymentType || "manual"}
              </p>
              {dep.targetPath ? (
                <p className="mt-2 text-xs text-p-muted break-all">Target: {dep.targetPath}</p>
              ) : null}
              {dep.notes ? (
                <p className="mt-2 text-sm text-p-muted ">{dep.notes}</p>
              ) : null}
              <p className="mt-2 text-xs text-p-muted">{formatDateTime(dep.createdAt)}</p>
            </div>
            <span className={badgeClass(statusTone(dep.status))}>{dep.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const WebsiteHostingDashboard: React.FC = () => {
  const [payload, setPayload] = useState<HostingDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [bannerSuccess, setBannerSuccess] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [setupTab, setSetupTab] = useState<SetupTab>("overview");
  const [liveTab, setLiveTab] = useState<LiveTab>("overview");

  const [domainForm, setDomainForm] = useState({
    requestedName: "",
    requestedTld: ".com",
    notes: "",
  });

  const [murzakForm, setMurzakForm] = useState({
    requestedLabel: "",
    targetType: "folder",
    targetValue: "",
    notes: "",
  });

  const [externalForm, setExternalForm] = useState({
    domainName: "",
    registrar: "",
    notes: "",
  });

  const [supportForm, setSupportForm] = useState({
    category: "support",
    title: "",
    description: "",
  });

  const [subdomainForm, setSubdomainForm] = useState({
    subdomainLabel: "",
    targetType: "folder",
    targetValue: "",
    notes: "",
  });

  const [deploymentForm, setDeploymentForm] = useState({
    sourceFile: "",
    deploymentType: "manual",
    notes: "",
  });

  const [uploadForm, setUploadForm] = useState({
    uploadCategory: "deployment",
    notes: "",
    file: null as File | null,
  });

  // Usage-triggered upsell: one-click "more storage" request once usage crosses
  // the threshold. Files a normal hosting support request the team already sees.
  const [storageUpsell, setStorageUpsell] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setPageError("");
      const data = await fetchHostingDashboard();
      setPayload(data);
    } catch (err: any) {
      setPageError(toUserMessage(err, "Failed to load Website Hosting dashboard."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (!bannerError && !bannerSuccess) return;
    const t = window.setTimeout(() => {
      setBannerError("");
      setBannerSuccess("");
    }, 7000);
    return () => window.clearTimeout(t);
  }, [bannerError, bannerSuccess]);

  const domainChoice = normalizeChoice(payload?.service?.domainChoice);
  const choiceDetails = choiceMeta(domainChoice);
  const ChoiceIcon = choiceDetails.icon;

  const isLiveMode =
  !!payload?.activeSite &&
  String(payload?.activeSite?.status || "").toLowerCase() === "active";

  const activeSite = payload?.activeSite || null;

  const openRequestsCount = useMemo(() => {
    return (payload?.requests || []).filter((r) => {
      const s = String(r.status || "").toLowerCase();
      return s === "open" || s === "in_progress" || s === "in progress";
    }).length;
  }, [payload]);

  const setupSubmitted = useMemo(() => {
    if (!payload || !domainChoice) return false;
    if (domainChoice === "Register New Domain") return payload.registerNewDomainRequests.length > 0;
    if (domainChoice === "Use Murzak Subdomain") return payload.murzakSubdomains.length > 0;
    if (domainChoice === "Bring My Domain") return payload.externalDomains.length > 0;
    return false;
  }, [payload, domainChoice]);

  const setupProgress = useMemo(() => {
    if (!payload) return 0;
    if (payload.activeSite) return 100;

    const steps = [
      !!domainChoice,
      setupSubmitted,
      openRequestsCount >= 0,
    ];

    const completed = steps.filter(Boolean).length;
    return Math.round((completed / steps.length) * 100);
  }, [payload, domainChoice, setupSubmitted, openRequestsCount]);

  const murzakPreview = useMemo(() => {
    const label = String(murzakForm.requestedLabel || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    // The root domain here is a preview only — the request is fulfilled
    // server-side against whatever FREE_SUBDOMAIN_ROOT_DOMAIN is actually
    // configured to (see resolveFreeSubdomainRoot in customerDomains.js).
    // This used to say "murzaktech.com", which has no DNS at all.
    return label ? `${label}.murzaktech.tech` : "yourname.murzaktech.tech";
  }, [murzakForm.requestedLabel]);

  const liveSubdomainPreview = useMemo(() => {
    const label = String(subdomainForm.subdomainLabel || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    const parent = activeSite?.primaryHost || "yourdomain.com";
    return label ? `${label}.${parent}` : `blog.${parent}`;
  }, [subdomainForm.subdomainLabel, activeSite?.primaryHost]);

  const storageLimit = Number(activeSite?.storageLimitMb || 0);
  const storageUsed = Number(activeSite?.storageUsedMb || 0);
  const isUnlimitedStorage = storageLimit <= 0;

  const rawStoragePercent =
    !isUnlimitedStorage && storageLimit > 0
      ? (storageUsed / storageLimit) * 100
      : null;

  const storagePercent =
    rawStoragePercent === null
      ? null
      : storageUsed > 0 && rawStoragePercent > 0 && rawStoragePercent < 1
      ? 1
      : Math.min(100, Math.round(rawStoragePercent));    

  const primaryFiles = useMemo(
    () => (payload?.files || []).filter((f) => f.uploadCategory === "deployment"),
    [payload]
  );

  const latestFileName = useMemo(() => payload?.files?.[0]?.fileName || "", [payload]);

  const latestActiveBuild = useMemo(
    () => (payload?.files || []).find((f) => f.isActiveBuild),
    [payload]
  );

  const runAction = async (key: string, fn: () => Promise<void>) => {
    try {
      setActionLoading(key);
      setBannerError("");
      setBannerSuccess("");
      await fn();
    } catch (err: any) {
      setBannerError(toUserMessage(err, "Action failed."));
    } finally {
      setActionLoading(null);
    }
  };

  const submitDomainPurchase = async () => {
    await runAction("domain-request", async () => {
      await createDomainPurchaseRequest({
        requestedName: domainForm.requestedName.trim(),
        requestedTld: domainForm.requestedTld,
        notes: domainForm.notes.trim(),
      });
      setBannerSuccess("Your domain purchase request has been submitted.");
      setDomainForm({ requestedName: "", requestedTld: ".com", notes: "" });
      await loadDashboard();
      setSetupTab("setup");
    });
  };

  const submitMurzakSubdomain = async () => {
    await runAction("murzak-request", async () => {
      await createMurzakSubdomain({
        requestedLabel: murzakForm.requestedLabel.trim().toLowerCase(),
        targetType: murzakForm.targetType,
        targetValue: murzakForm.targetValue.trim(),
        notes: murzakForm.notes.trim(),
      });
      setBannerSuccess("Your Murzak subdomain request has been submitted.");
      setMurzakForm({
        requestedLabel: "",
        targetType: "folder",
        targetValue: "",
        notes: "",
      });
      await loadDashboard();
      setSetupTab("setup");
    });
  };

  const submitExternalDomain = async () => {
    await runAction("external-domain", async () => {
      await createExternalDomainConnection({
        domainName: externalForm.domainName.trim().toLowerCase(),
        registrar: externalForm.registrar.trim(),
        notes: externalForm.notes.trim(),
      });
      setBannerSuccess("Your external domain connection request has been submitted.");
      setExternalForm({ domainName: "", registrar: "", notes: "" });
      await loadDashboard();
      setSetupTab("setup");
    });
  };

  const submitSupportRequest = async () => {
    await runAction("support-request", async () => {
      await createHostingSupportRequest({
        category: supportForm.category,
        title: supportForm.title.trim(),
        description: supportForm.description.trim(),
      });
      setBannerSuccess("Your hosting request has been submitted.");
      setSupportForm({ category: "support", title: "", description: "" });
      await loadDashboard();
      if (isLiveMode) setLiveTab("requests");
      else setSetupTab("requests");
    });
  };

  const submitHostingSubdomain = async () => {
    if (!activeSite?.primaryHost) return;
    await runAction("hosting-subdomain", async () => {
      await createHostingSubdomain({
        subdomainLabel: subdomainForm.subdomainLabel.trim().toLowerCase(),
        parentHost: activeSite.primaryHost,
        targetType: subdomainForm.targetType,
        targetValue: subdomainForm.targetValue.trim(),
        notes: subdomainForm.notes.trim(),
      });
      setBannerSuccess("Subdomain request submitted.");
      setSubdomainForm({
        subdomainLabel: "",
        targetType: "folder",
        targetValue: "",
        notes: "",
      });
      await loadDashboard();
      setLiveTab("subdomains");
    });
  };

  const submitDeploymentRequest = async () => {
    await runAction("deployment-request", async () => {
      await requestDeployment({
        sourceFile: deploymentForm.sourceFile.trim(),
        deploymentType: deploymentForm.deploymentType,
        notes: deploymentForm.notes.trim(),
      });
      setBannerSuccess("Deployment request submitted.");
      setDeploymentForm({
        sourceFile: "",
        deploymentType: "manual",
        notes: "",
      });
      await loadDashboard();
      setLiveTab("deployments");
    });
  };

  const submitUpload = async () => {
    if (!uploadForm.file) {
      setBannerError("Please choose a file to upload.");
      return;
    }

    await runAction("file-upload", async () => {
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      formData.append("uploadCategory", uploadForm.uploadCategory);
      formData.append("notes", uploadForm.notes);

      await uploadHostingFile(formData);

      setBannerSuccess("File uploaded successfully.");
      setUploadForm({
        uploadCategory: "deployment",
        notes: "",
        file: null,
      });

      await loadDashboard();
      setLiveTab("files");
    });
  };

  if (loading) {
    return (
      <div className={`${cardClass} flex items-center justify-center py-16`}>
        <Loader2 className="w-5 h-5 animate-spin mr-3" />
        <span className="text-sm font-medium">Loading Website Hosting...</span>
      </div>
    );
  }

  if (pageError || !payload) {
    return (
      <div className="rounded-lg border border-p-danger/40 bg-p-danger-soft p-6 text-red-700">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5" />
          <div>
            <h3 className="font-semibold text-lg">Website Hosting dashboard unavailable</h3>
            <p className="mt-2 text-sm">{pageError || "Failed to load dashboard data."}</p>
            <button onClick={loadDashboard} className={`${secondaryBtnClass} mt-4`}>
              <RefreshCw className="w-4 h-4 inline-block mr-2" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderSetupOverview = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Setup Type
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text ">
            {choiceDetails.title}
          </h3>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Tier
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text ">
            {payload.service.tier || "Standard"}
          </h3>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Open Requests
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text ">
            {openRequestsCount}
          </h3>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Setup Progress
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text ">
            {setupProgress}%
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-lg border border-p-accent/40 bg-p-accent-soft p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <ChoiceIcon className="w-20 h-20" />
          </div>

          <div className="relative z-10">
            <div className="flex flex-wrap gap-3 items-center">
              <span className={badgeClass("green")}>Hosting Purchased</span>
              <span className={badgeClass(choiceDetails.tone)}>
                {payload.service.domainChoice || "No Option"}
              </span>
              <span className={badgeClass(statusTone(payload.hostingStatus))}>
                {payload.hostingStatus}
              </span>
            </div>

            <h3 className="mt-5 text-2xl sm:text-3xl font-semibold text-p-text ">
              Finish setup to activate your hosting
            </h3>

            <p className="mt-3 max-w-2xl text-sm sm:text-base text-p-muted ">
              {choiceDetails.description}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => setSetupTab("setup")} className={primaryBtnClass}>
                Continue Setup
              </button>
              <button onClick={() => setSetupTab("requests")} className={secondaryBtnClass}>
                Submit Request
              </button>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">Quick Status</h3>

          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 mt-0.5 text-p-success" />
              <div>
                <p className="font-medium text-p-text ">
                  Hosting service active
                </p>
                <p className="text-xs text-p-muted mt-1">
                  Your hosting plan is active and waiting for final setup.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              {setupSubmitted ? (
                <CheckCircle2 className="w-5 h-5 mt-0.5 text-p-success" />
              ) : (
                <Clock3 className="w-5 h-5 mt-0.5 text-p-muted" />
              )}
              <div>
                <p className="font-medium text-p-text ">
                  Domain setup submitted
                </p>
                <p className="text-xs text-p-muted mt-1">
                  Submit your chosen domain or subdomain setup request to proceed.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 mt-0.5 text-p-muted" />
              <div>
                <p className="font-medium text-p-text ">
                  Activation pending
                </p>
                <p className="text-xs text-p-muted mt-1">
                  Murzak Tech will finalize DNS, SSL and provisioning before the dashboard switches into live hosting mode.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold text-p-text ">Setup Checklist</h3>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            {domainChoice ? (
              <CheckCircle2 className="w-5 h-5 text-p-success" />
            ) : (
              <Clock3 className="w-5 h-5 text-p-muted" />
            )}
            <span className="font-semibold text-p-text ">
              Domain setup type identified
            </span>
          </div>

          <div className="flex items-center gap-3">
            {setupSubmitted ? (
              <CheckCircle2 className="w-5 h-5 text-p-success" />
            ) : (
              <Clock3 className="w-5 h-5 text-p-muted" />
            )}
            <span className="font-semibold text-p-text ">
              Initial setup request submitted
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Clock3 className="w-5 h-5 text-p-muted" />
            <span className="font-semibold text-p-text ">
              DNS / infrastructure configuration
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Clock3 className="w-5 h-5 text-p-muted" />
            <span className="font-semibold text-p-text ">
              Site activation and hosting control panel
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRegisterNewDomainPanel = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Request a Domain Purchase
          </h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Choose the name and extension you want. Murzak Tech will review availability,
          purchase it, and connect it to your hosting setup.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Domain Name
            </label>
            <input
              value={domainForm.requestedName}
              onChange={(e) =>
                setDomainForm((p) => ({
                  ...p,
                  requestedName: e.target.value.replace(/\s+/g, "").toLowerCase(),
                }))
              }
              placeholder="e.g. acmecompany"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Domain Extension
            </label>
            <select
              value={domainForm.requestedTld}
              onChange={(e) => setDomainForm((p) => ({ ...p, requestedTld: e.target.value }))}
              className={inputClass}
            >
              <option value=".com">.com</option>
              <option value=".co.ke">.co.ke</option>
              <option value=".net">.net</option>
              <option value=".org">.org</option>
              <option value=".online">.online</option>
              <option value=".biz">.biz</option>
            </select>
          </div>

          <div className="rounded-lg border border-p-accent/40 bg-p-accent-soft px-4 py-3">
            <p className="text-xs font-semibold text-p-muted ">
              Full Domain Preview
            </p>
            <p className="mt-2 text-lg font-semibold text-p-text break-all">
              {domainForm.requestedName
                ? `${domainForm.requestedName}${domainForm.requestedTld}`
                : `yourdomain${domainForm.requestedTld}`}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={domainForm.notes}
              onChange={(e) => setDomainForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Describe the domain purpose, alternatives, or any special instructions..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "domain-request" || !domainForm.requestedName.trim()}
            onClick={submitDomainPurchase}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "domain-request" ? "Submitting..." : "Submit Domain Request"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">
            Your Domain Requests
          </h3>

          <div className="mt-4 space-y-3">
            {payload.registerNewDomainRequests.length === 0 ? (
              <p className="text-sm text-p-muted">No domain purchase requests yet.</p>
            ) : (
              payload.registerNewDomainRequests.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-p-border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-p-text break-all">
                        {r.fullDomain}
                      </p>
                      <p className="text-xs text-p-muted mt-1">
                        Provider: {r.provider || "Murzak Cloud"}
                      </p>
                      {r.notes ? (
                        <p className="text-sm text-p-muted mt-2">
                          {r.notes}
                        </p>
                      ) : null}
                    </div>
                    <span className={badgeClass(statusTone(r.status))}>{r.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">
            What Happens Next
          </h3>
          <div className="mt-4 space-y-2 text-sm text-p-muted">
            <p>1. Murzak Tech reviews availability.</p>
            <p>2. Domain purchase and setup are completed.</p>
            <p>3. Hosting environment is linked and activated.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMurzakSubdomainPanel = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <Wand2 className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Choose Your Murzak Subdomain
          </h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Your website can be hosted under a Murzak-owned subdomain such as
          <span className="font-semibold text-p-text "> example.murzaktech.tech</span>.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Subdomain Name
            </label>
            <input
              value={murzakForm.requestedLabel}
              onChange={(e) =>
                setMurzakForm((p) => ({
                  ...p,
                  requestedLabel: e.target.value.replace(/\s+/g, "").toLowerCase(),
                }))
              }
              placeholder="e.g. acme"
              className={inputClass}
            />
          </div>

          <div className="rounded-lg border border-p-success/40 bg-p-success-soft px-4 py-3">
            <p className="text-xs font-semibold text-p-muted ">
              Subdomain Preview
            </p>
            <p className="mt-2 text-lg font-semibold text-p-text break-all">
              {murzakPreview}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Target Type
            </label>
            <select
              value={murzakForm.targetType}
              onChange={(e) => setMurzakForm((p) => ({ ...p, targetType: e.target.value }))}
              className={inputClass}
            >
              <option value="folder">Folder</option>
              <option value="app">App</option>
              <option value="redirect">Redirect</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Target Value
            </label>
            <input
              value={murzakForm.targetValue}
              onChange={(e) => setMurzakForm((p) => ({ ...p, targetValue: e.target.value }))}
              placeholder="e.g. /public_html/site or app name"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={murzakForm.notes}
              onChange={(e) => setMurzakForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Add setup notes or intended website use..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "murzak-request" || !murzakForm.requestedLabel.trim()}
            onClick={submitMurzakSubdomain}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "murzak-request" ? "Submitting..." : "Request Subdomain"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">
            Your Murzak Subdomains
          </h3>

          <div className="mt-4 space-y-3">
            {payload.murzakSubdomains.length === 0 ? (
              <p className="text-sm text-p-muted">No Murzak subdomains requested yet.</p>
            ) : (
              payload.murzakSubdomains.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-p-border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-p-text break-all">
                        {s.fullSubdomain}
                      </p>
                      <p className="text-xs text-p-muted mt-1">
                        {s.targetType || "folder"} {s.targetValue ? `• ${s.targetValue}` : ""}
                      </p>
                      {s.notes ? (
                        <p className="text-sm text-p-muted mt-2">
                          {s.notes}
                        </p>
                      ) : null}
                    </div>
                    <span className={badgeClass(statusTone(s.status))}>{s.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">Best Practice</h3>
          <div className="mt-4 space-y-2 text-sm text-p-muted">
            <p>Choose a short, memorable label.</p>
            <p>Avoid spaces and special characters.</p>
            <p>Murzak Tech will provision and point the subdomain for you.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderBringMyDomainPanel = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <LinkIcon className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Connect Your Existing Domain
          </h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Enter the domain you already own. Murzak Tech will review the domain and guide
          or complete the connection to your hosting environment.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Domain Name
            </label>
            <input
              value={externalForm.domainName}
              onChange={(e) =>
                setExternalForm((p) => ({
                  ...p,
                  domainName: e.target.value.replace(/\s+/g, "").toLowerCase(),
                }))
              }
              placeholder="e.g. mybusiness.com"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Registrar
            </label>
            <input
              value={externalForm.registrar}
              onChange={(e) => setExternalForm((p) => ({ ...p, registrar: e.target.value }))}
              placeholder="e.g. Truehost, Namecheap, GoDaddy"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={externalForm.notes}
              onChange={(e) => setExternalForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Add DNS or access notes, registrar readiness, or anything Murzak Tech should know..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "external-domain" || !externalForm.domainName.trim()}
            onClick={submitExternalDomain}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "external-domain" ? "Submitting..." : "Start Domain Connection"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">
            Connected / Pending Domains
          </h3>

          <div className="mt-4 space-y-3">
            {payload.externalDomains.length === 0 ? (
              <p className="text-sm text-p-muted">No external domains submitted yet.</p>
            ) : (
              payload.externalDomains.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-p-border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-p-text break-all">
                        {d.domainName}
                      </p>
                      <p className="text-xs text-p-muted mt-1">
                        {d.registrar || "Registrar not provided"}
                      </p>
                      {d.verificationNotes ? (
                        <p className="text-sm text-p-muted mt-2">
                          {d.verificationNotes}
                        </p>
                      ) : null}
                    </div>
                    <span className={badgeClass(statusTone(d.status))}>{d.status}</span>
                  </div>

                  {(d.nameserver1 || d.nameserver2 || d.aRecord) && (
                    <div className="mt-4 rounded-lg bg-p-panel-2 border border-p-border p-3 text-xs text-p-muted">
                      {d.nameserver1 ? <p>NS1: {d.nameserver1}</p> : null}
                      {d.nameserver2 ? <p>NS2: {d.nameserver2}</p> : null}
                      {d.aRecord ? <p>A Record: {d.aRecord}</p> : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">
            DNS Connection Notes
          </h3>
          <div className="mt-4 space-y-2 text-sm text-p-muted">
            <p>Keep your registrar account accessible during connection.</p>
            <p>Murzak Tech may request nameserver or DNS record changes.</p>
            <p>Once verified, the dashboard will switch into live hosting mode.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSetupPanel = () => {
    if (domainChoice === "Register New Domain") return renderRegisterNewDomainPanel();
    if (domainChoice === "Use Murzak Subdomain") return renderMurzakSubdomainPanel();
    if (domainChoice === "Bring My Domain") return renderBringMyDomainPanel();

    return (
      <div className="rounded-lg border border-p-warning/40 bg-p-warning-soft p-6 text-orange-700">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5" />
          <div>
            <h3 className="font-semibold text-lg">Domain setup type missing</h3>
            <p className="mt-2 text-sm">
              This hosting service does not yet have a saved domain setup option. Please
              contact Murzak Tech support.
            </p>
            <button onClick={() => setSetupTab("requests")} className={`${secondaryBtnClass} mt-4`}>
              Go to Requests
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderRequests = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <LifeBuoy className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Submit Hosting Request
          </h3>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Category
            </label>
            <select
              value={supportForm.category}
              onChange={(e) => setSupportForm((p) => ({ ...p, category: e.target.value }))}
              className={inputClass}
            >
              <option value="support">General Support</option>
              <option value="domain">Domain</option>
              <option value="dns_change">DNS Change</option>
              <option value="ssl">SSL Request</option>
              <option value="deployment">Deployment</option>
              <option value="migration">Migration</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Title
            </label>
            <input
              value={supportForm.title}
              onChange={(e) => setSupportForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Request title"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Description
            </label>
            <textarea
              value={supportForm.description}
              onChange={(e) => setSupportForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe what you need help with..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={
              actionLoading === "support-request" ||
              !supportForm.title.trim() ||
              !supportForm.description.trim()
            }
            onClick={submitSupportRequest}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "support-request" ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold text-p-text ">Request History</h3>

        <div className="mt-4 space-y-3">
          {payload.requests.length === 0 ? (
            <p className="text-sm text-p-muted">No hosting requests submitted yet.</p>
          ) : (
            payload.requests.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-p-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-p-text ">{r.title}</p>
                    <p className="text-xs text-p-muted mt-1">
                      {r.category}
                    </p>
                    <p className="text-sm text-p-muted mt-2">
                      {r.description}
                    </p>
                    <p className="text-xs text-p-muted mt-2">{formatDateTime(r.createdAt)}</p>
                  </div>
                  <span className={badgeClass(statusTone(r.status))}>{r.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderLiveOverview = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Active Host
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text break-all">
            {activeSite?.primaryHost || "—"}
          </h3>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Hosting Status
          </p>
          <div className="mt-3">
            <span className={badgeClass(statusTone(activeSite?.status))}>{activeSite?.status || "—"}</span>
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            SSL Status
          </p>
          <div className="mt-3">
            <span className={badgeClass(statusTone(activeSite?.sslStatus))}>
              {activeSite?.sslStatus || "none"}
            </span>
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-semibold text-p-muted ">
            Storage Used
          </p>
          <h3 className="mt-3 text-lg font-semibold text-p-text ">
            {formatMb(storageUsed)} / {isUnlimitedStorage ? "Unlimited" : formatMb(storageLimit)}
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-lg border border-p-success/40 bg-p-success-soft p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Server className="w-20 h-20" />
          </div>

          <div className="relative z-10">
            <div className="flex flex-wrap gap-3 items-center">
              <span className={badgeClass("green")}>Live Hosting Mode</span>
              <span className={badgeClass(statusTone(activeSite?.sslStatus))}>
                SSL {activeSite?.sslStatus || "none"}
              </span>
              {latestActiveBuild ? <span className={badgeClass("green")}>Build Active</span> : null}
            </div>

            <h3 className="mt-5 text-2xl sm:text-3xl font-semibold text-p-text break-all">
              {activeSite?.primaryHost}
            </h3>

            <p className="mt-3 max-w-2xl text-sm sm:text-base text-p-muted ">
              Your hosting setup is active. You can now manage storage, files, deployments,
              subdomains, support requests and activity from this dashboard.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => setLiveTab("files")} className={primaryBtnClass}>
                Upload Files
              </button>
              <button onClick={() => setLiveTab("deployments")} className={secondaryBtnClass}>
                Request Deployment
              </button>
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">Quick Status</h3>

          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 mt-0.5 text-p-success" />
              <div>
                <p className="font-medium text-p-text ">Site active</p>
                <p className="text-xs text-p-muted mt-1">
                  Your domain or subdomain is provisioned and linked to hosting.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <HardDrive className="w-5 h-5 mt-0.5 text-p-accent-text" />
              <div>
                <p className="font-medium text-p-text ">Storage usage</p>
                <p className="text-xs text-p-muted mt-1">
                  {formatMb(storageUsed)} used out of {isUnlimitedStorage ? "Unlimited" : formatMb(storageLimit)}.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Rocket className="w-5 h-5 mt-0.5 text-p-muted" />
              <div>
                <p className="font-medium text-p-text ">Latest deployment</p>
                <p className="text-xs text-p-muted mt-1">
                  {payload.deployments[0]
                    ? `${payload.deployments[0].status} • ${formatDateTime(payload.deployments[0].createdAt)}`
                    : "No deployment requests yet."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <ResourceUtilizationCard
          diskUsagePercent={storagePercent ?? 0}
        />
        <ServiceHealthCard
          service={{
            id: activeSite?.id || '',
            name: activeSite?.primaryHost || 'Website',
            type: 'Website Hosting',
            status: activeSite?.status === 'active' ? 'online' : 'offline',
          }}
          onAction={() => {}}
        />
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-p-text ">Storage Usage</h3>
            <p className="mt-2 text-sm text-p-muted">
              Monitor how much hosting storage is being used by your uploaded site files.
            </p>
          </div>
          <span className={badgeClass(storagePercent >= 85 ? "orange" : "blue")}>
            {storagePercent}% Used
          </span>
        </div>

        <div className="mt-5">
          <div className="w-full h-4 rounded-full bg-p-panel-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-p-accent transition-all duration-700"
              style={{ width: `${storagePercent ?? 0}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-p-muted">
            <span>{isUnlimitedStorage ? "Unlimited total" : `${formatMb(storageLimit)} total`}</span>
            <span
              className={badgeClass(
                storagePercent !== null && storagePercent >= 85 ? "orange" : "blue"
              )}
            >
              {storagePercent !== null
                ? `${storagePercent}% Used`
                : storageUsed > 0
                ? `${formatMb(storageUsed)} Used`
                : "No Limit"}
            </span>
          </div>

          {!isUnlimitedStorage && storagePercent !== null && storagePercent >= 80 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-p-warning/40 bg-p-warning-soft p-4">
              <AlertCircle size={18} className="text-p-warning shrink-0" />
              <p className="grow text-sm font-medium text-p-warning ">
                You've used {storagePercent}% of your {formatMb(storageLimit)} storage.
                {storageUpsell === "sent"
                  ? " Request received. Our team will reach out with upgrade options."
                  : " Add more before uploads start failing."}
              </p>
              {storageUpsell !== "sent" && (
                <button
                  type="button"
                  disabled={storageUpsell === "sending"}
                  onClick={async () => {
                    setStorageUpsell("sending");
                    try {
                      await createHostingSupportRequest({
                        category: "upgrade",
                        title: "Storage upgrade request",
                        description: `Automatic request from the storage meter: site is at ${storagePercent}% of ${formatMb(storageLimit)} (${formatMb(storageUsed)} used). Please advise on the next storage tier.`,
                      });
                      setStorageUpsell("sent");
                    } catch {
                      setStorageUpsell("error");
                    }
                  }}
                  className={primaryBtnClass + " whitespace-nowrap"}
                >
                  {storageUpsell === "sending" ? "Sending…" : "Request more storage"}
                </button>
              )}
              {storageUpsell === "error" && (
                <p className="text-xs font-medium text-p-danger">Could not send. Try again or use the Requests tab.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">Site Details</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-p-muted">Plan</span>
              <span className="font-semibold text-p-text ">
                {activeSite?.planName || payload.service.tier || "Standard"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-p-muted">Tier</span>
              <span className="font-semibold text-p-text ">
                {activeSite?.tier || payload.service.tier || "Standard"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-p-muted">Site Type</span>
              <span className="font-semibold text-p-text ">
                {activeSite?.siteType || "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-p-muted">Document Root</span>
              <span className="font-semibold text-p-text break-all text-right">
                {activeSite?.documentRoot || "—"}
              </span>
            </div>
          </div>
          {activeSite?.notes ? (
            <div className="mt-4 rounded-lg border border-p-border p-4 text-sm text-p-muted ">
              {activeSite.notes}
            </div>
          ) : null}
        </div>

        <div className={cardClass}>
          <h3 className="text-lg font-semibold text-p-text ">Recent Activity</h3>
          <div className="mt-4 space-y-3">
            {payload.activity.length === 0 ? (
              <p className="text-sm text-p-muted">No recent activity yet.</p>
            ) : (
              payload.activity.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-p-border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-p-text ">{item.title}</p>
                      {item.description ? (
                        <p className="mt-1 text-sm text-p-muted">{item.description}</p>
                      ) : null}
                    </div>
                    <span className={badgeClass("slate")}>{item.eventType || "event"}</span>
                  </div>
                  <p className="mt-2 text-xs text-p-muted">{formatDateTime(item.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderLiveFiles = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <Upload className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">Upload Files</h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Upload deployment packages, migration archives, project assets or website files into your hosting space.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Upload Category
            </label>
            <select
              value={uploadForm.uploadCategory}
              onChange={(e) => setUploadForm((p) => ({ ...p, uploadCategory: e.target.value }))}
              className={inputClass}
            >
              <option value="deployment">Deployment</option>
              <option value="migration">Migration</option>
              <option value="assets">Assets</option>
              <option value="documents">Documents</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              File
            </label>
            <input
              type="file"
              onChange={(e) =>
                setUploadForm((p) => ({
                  ...p,
                  file: e.target.files?.[0] || null,
                }))
              }
              className={inputClass}
            />
            {uploadForm.file ? (
              <p className="mt-2 text-xs text-p-muted">
                Selected: {uploadForm.file.name} • {(uploadForm.file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={uploadForm.notes}
              onChange={(e) => setUploadForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Add context for this file upload..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "file-upload" || !uploadForm.file}
            onClick={submitUpload}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "file-upload" ? "Uploading..." : "Upload File"}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold text-p-text ">Uploaded Files</h3>
        <div className="mt-4">
          <FileList files={payload.files} emptyText="No files uploaded yet." />
        </div>
      </div>
    </div>
  );

  const renderLiveDeployments = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <Rocket className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Request Deployment
          </h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Submit a deployment request after uploading your build files or when you need Murzak Tech to deploy changes.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Source File
            </label>
            <input
              value={deploymentForm.sourceFile}
              onChange={(e) => setDeploymentForm((p) => ({ ...p, sourceFile: e.target.value }))}
              placeholder={latestFileName || "e.g. website-build.zip"}
              className={inputClass}
            />
            {latestFileName ? (
              <p className="mt-2 text-xs text-p-muted">
                Latest uploaded file: {latestFileName}
              </p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Deployment Type
            </label>
            <select
              value={deploymentForm.deploymentType}
              onChange={(e) =>
                setDeploymentForm((p) => ({ ...p, deploymentType: e.target.value }))
              }
              className={inputClass}
            >
              <option value="manual">Manual</option>
              <option value="initial_launch">Initial Launch</option>
              <option value="update">Update</option>
              <option value="hotfix">Hotfix</option>
              <option value="migration">Migration</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={deploymentForm.notes}
              onChange={(e) => setDeploymentForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Describe what should be deployed and any special instructions..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "deployment-request"}
            onClick={submitDeploymentRequest}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "deployment-request" ? "Submitting..." : "Request Deployment"}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold text-p-text ">
          Deployment History
        </h3>
        <div className="mt-4">
          <DeploymentList
            deployments={payload.deployments}
            emptyText="No deployments requested yet."
          />
        </div>
      </div>
    </div>
  );

  const renderLiveSubdomains = () => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className={cardClass}>
        <div className="flex items-center gap-3">
          <Network className="w-5 h-5 text-p-accent-text" />
          <h3 className="text-lg font-semibold text-p-text ">
            Request a Subdomain
          </h3>
        </div>

        <p className="mt-3 text-sm text-p-muted">
          Create additional subdomains under your active host for apps, blogs, landing pages or redirects.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Subdomain Label
            </label>
            <input
              value={subdomainForm.subdomainLabel}
              onChange={(e) =>
                setSubdomainForm((p) => ({
                  ...p,
                  subdomainLabel: e.target.value.replace(/\s+/g, "").toLowerCase(),
                }))
              }
              placeholder="e.g. blog"
              className={inputClass}
            />
          </div>

          <div className="rounded-lg border border-p-accent/40 bg-p-accent-soft px-4 py-3">
            <p className="text-xs font-semibold text-p-muted ">
              Subdomain Preview
            </p>
            <p className="mt-2 text-lg font-semibold text-p-text break-all">
              {liveSubdomainPreview}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Target Type
            </label>
            <select
              value={subdomainForm.targetType}
              onChange={(e) => setSubdomainForm((p) => ({ ...p, targetType: e.target.value }))}
              className={inputClass}
            >
              <option value="folder">Folder</option>
              <option value="app">App</option>
              <option value="redirect">Redirect</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Target Value
            </label>
            <input
              value={subdomainForm.targetValue}
              onChange={(e) => setSubdomainForm((p) => ({ ...p, targetValue: e.target.value }))}
              placeholder="e.g. /blog, app name or destination URL"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-p-muted mb-2">
              Notes
            </label>
            <textarea
              value={subdomainForm.notes}
              onChange={(e) => setSubdomainForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Any additional instructions for this subdomain..."
              className={textareaClass}
            />
          </div>

          <button
            disabled={actionLoading === "hosting-subdomain" || !subdomainForm.subdomainLabel.trim()}
            onClick={submitHostingSubdomain}
            className={`${primaryBtnClass} w-full`}
          >
            {actionLoading === "hosting-subdomain" ? "Submitting..." : "Request Subdomain"}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h3 className="text-lg font-semibold text-p-text ">Subdomains</h3>
        <div className="mt-4 space-y-3">
          {payload.murzakSubdomains.length === 0 ? (
            <p className="text-sm text-p-muted">No subdomains created for this site yet.</p>
          ) : (
            payload.murzakSubdomains.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-p-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-p-text break-all">
                      {item.fullSubdomain}
                    </p>
                    <p className="text-xs text-p-muted mt-1">
                      {item.targetType || "folder"} {item.targetValue ? `• ${item.targetValue}` : ""}
                    </p>
                    {item.notes ? (
                      <p className="mt-2 text-sm text-p-muted ">
                        {item.notes}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-p-muted">{formatDateTime(item.createdAt)}</p>
                  </div>
                  <span className={badgeClass(statusTone(item.status))}>{item.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderLiveActivity = () => (
    <div className={cardClass}>
      <h3 className="text-lg font-semibold text-p-text ">Hosting Activity</h3>
      <div className="mt-4 space-y-3">
        {payload.activity.length === 0 ? (
          <p className="text-sm text-p-muted">No hosting activity yet.</p>
        ) : (
          payload.activity.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-p-border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-p-text ">{item.title}</p>
                  {item.description ? (
                    <p className="mt-2 text-sm text-p-muted ">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <span className={badgeClass("slate")}>{item.eventType || "event"}</span>
              </div>
              <p className="mt-2 text-xs text-p-muted">{formatDateTime(item.createdAt)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div
        className={`rounded-lg border p-6 sm:p-8 relative overflow-hidden ${
          isLiveMode
            ? "border-p-success/40 bg-p-success-soft"
            : "border-p-accent/40 bg-p-accent-soft"
        }`}
      >
        <div className="absolute top-0 right-0 p-6 opacity-10">
          {isLiveMode ? <Server className="w-20 h-20" /> : <ChoiceIcon className="w-20 h-20" />}
        </div>

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-p-muted ">
              Website Hosting • {payload.service.tier || "Standard"}
            </p>

            <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-p-text ">
              {isLiveMode ? "Hosting Control Panel" : "Website Hosting Setup"}
            </h2>

            <p className="mt-3 max-w-2xl text-sm text-p-muted ">
              {isLiveMode
                ? "Your hosting is active. Manage domain access, storage, uploads, deployments, subdomains and support from one place."
                : "Complete your domain or subdomain setup. Once Murzak Tech finishes provisioning, this dashboard will automatically switch into live hosting mode."}
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <span className={badgeClass("green")}>Service Active</span>
              {!isLiveMode ? (
                <span className={badgeClass(choiceDetails.tone)}>
                  {payload.service.domainChoice || "No Setup Type"}
                </span>
              ) : null}
              <span className={badgeClass(statusTone(payload.hostingStatus))}>
                {payload.hostingStatus}
              </span>
              {isLiveMode && activeSite?.primaryHost ? (
                <span className={badgeClass("blue")}>{activeSite.primaryHost}</span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 min-w-[270px]">
            <button
              onClick={() => (isLiveMode ? setLiveTab("overview") : setSetupTab("setup"))}
              className={primaryBtnClass}
            >
              {isLiveMode ? "Open Hosting" : "Continue Setup"}
            </button>
            <button onClick={loadDashboard} className={secondaryBtnClass}>
              <RefreshCw className="w-4 h-4 inline-block mr-2" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {(bannerError || bannerSuccess) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
            bannerError
              ? "bg-p-danger-soft border-p-danger/40 text-red-700"
              : "bg-p-success-soft border-p-success/40 text-green-700"
          }`}
        >
          {bannerError || bannerSuccess}
        </div>
      )}

      {!isLiveMode ? (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setSetupTab("overview")}
              className={tabClass(setupTab === "overview")}
            >
              Overview
            </button>
            <button
              onClick={() => setSetupTab("setup")}
              className={tabClass(setupTab === "setup")}
            >
              Setup
            </button>
            <button
              onClick={() => setSetupTab("requests")}
              className={tabClass(setupTab === "requests")}
            >
              Requests
            </button>
          </div>

          {setupTab === "overview" && renderSetupOverview()}
          {setupTab === "setup" && renderSetupPanel()}
          {setupTab === "requests" && renderRequests()}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setLiveTab("overview")} className={tabClass(liveTab === "overview")}>
              Overview
            </button>
            <button onClick={() => setLiveTab("files")} className={tabClass(liveTab === "files")}>
              Files
            </button>
            <button
              onClick={() => setLiveTab("deployments")}
              className={tabClass(liveTab === "deployments")}
            >
              Deployments
            </button>
            <button
              onClick={() => setLiveTab("subdomains")}
              className={tabClass(liveTab === "subdomains")}
            >
              Subdomains
            </button>
            <button onClick={() => setLiveTab("requests")} className={tabClass(liveTab === "requests")}>
              Requests
            </button>
            <button onClick={() => setLiveTab("activity")} className={tabClass(liveTab === "activity")}>
              Activity
            </button>
          </div>

          {liveTab === "overview" && renderLiveOverview()}
          {liveTab === "files" && renderLiveFiles()}
          {liveTab === "deployments" && renderLiveDeployments()}
          {liveTab === "subdomains" && renderLiveSubdomains()}
          {liveTab === "requests" && renderRequests()}
          {liveTab === "activity" && renderLiveActivity()}
        </>
      )}

      <div className="rounded-lg border border-p-border bg-p-panel p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-p-muted ">
              Need help next?
            </p>
            <h3 className="mt-2 text-lg font-semibold text-p-text ">
              {isLiveMode
                ? "Use requests for DNS, SSL, deployments and support"
                : "Murzak Tech will complete provisioning after setup"}
            </h3>
            <p className="mt-2 text-sm text-p-muted">
              {isLiveMode
                ? "Open a request whenever you need deployment help, DNS changes, SSL assistance or site support."
                : "After your setup request is submitted, Murzak Tech will handle domain connection, infrastructure provisioning and activation."}
            </p>
          </div>

          <button
            onClick={() => (isLiveMode ? setLiveTab("requests") : setSetupTab("requests"))}
            className={primaryBtnClass}
          >
            Open Requests <ArrowRight className="w-4 h-4 inline-block ml-2" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WebsiteHostingDashboard;
