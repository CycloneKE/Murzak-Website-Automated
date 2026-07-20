import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, AlertCircle, Rocket } from "lucide-react";
import {
  cloudLaunchCatalog,
  CLOUD_LAUNCH_CATEGORIES,
  CloudLaunchCategory,
  ServiceItem,
  DomainChoice,
  formatKes,
  planForService,
  PLAN_META,
} from "../config/serviceCatalog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  onNavigate: (path: string) => void;
  initialServiceId?: string;
};

const DOMAIN_CHOICES: DomainChoice[] = [
  "Use Murzak Subdomain",
  "Bring My Domain",
  "Register New Domain",
];

function findServiceCategory(
  catalog: Record<CloudLaunchCategory, ServiceItem[]>,
  serviceId: string
): CloudLaunchCategory | null {
  for (const cat of CLOUD_LAUNCH_CATEGORIES) {
    if (catalog[cat].some((s) => s.id === serviceId)) return cat;
  }
  return null;
}

export default function CloudLaunchModal({
  isOpen,
  onClose,
  isLoggedIn,
  onNavigate,
  initialServiceId,
}: Props) {
  const catalog = useMemo(() => cloudLaunchCatalog(), []);

  const [category, setCategory] = useState<CloudLaunchCategory>("App Hosting");
  const [selectedId, setSelectedId] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState("");
  const [appPort, setAppPort] = useState("");
  const [domainChoice, setDomainChoice] = useState<DomainChoice>("Use Murzak Subdomain");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (initialServiceId) {
      const cat = findServiceCategory(catalog, initialServiceId);
      if (cat) {
        setCategory(cat);
        setSelectedId(initialServiceId);
        return;
      }
    }
    setCategory("App Hosting");
    setSelectedId(catalog["App Hosting"][0]?.id || "");
  }, [isOpen, initialServiceId, catalog]);

  useEffect(() => {
    if (!isOpen) return;
    setErr("");
    setSubmitting(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const servicesForCategory = catalog[category] || [];
  const selected = servicesForCategory.find((s) => s.id === selectedId) || null;

  const handlePickCategory = (cat: CloudLaunchCategory) => {
    setCategory(cat);
    const first = catalog[cat][0];
    setSelectedId(first?.id || "");
    setRepoUrl("");
    setAppPort("");
    setDomainChoice("Use Murzak Subdomain");
    setErr("");
  };

  const attachRepoIfNeeded = async () => {
    if (!selected?.requiresRepo) return;
    const res = await fetch("/api/portal/account/repo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        repoUrl,
        ...(appPort.trim() ? { appPort: Number(appPort.trim()) } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to save repository URL.");
  };

  const launchLoggedIn = async () => {
    if (!selected) return;

    // Save the repo URL BEFORE creating any invoice: a repo-save failure
    // aborts cleanly with nothing created, while an invoice failure after a
    // successful repo save leaves only harmless account metadata — never a
    // stranded paid order without its repo.
    await attachRepoIfNeeded();

    // Try the existing-customer add-on path first — the backend is the
    // single source of truth on whether this account has a paid plan yet.
    const addonRes = await fetch("/api/addons/invoice/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        services: [
          {
            serviceId: selected.id,
            serviceName: selected.name,
            tier: selected.tier,
            domainChoice: selected.requiresDomainChoice ? domainChoice : "",
          },
        ],
      }),
    });
    const addonData = await addonRes.json().catch(() => ({}));

    if (addonRes.ok) {
      onNavigate(`/payment/${addonData.invoiceId}`);
      return;
    }

    // Not paid on any plan yet (first-ever order) -> establish it via the
    // same call the bundled configurator already makes for a first Starter
    // order. Any other rejection (e.g. genuine plan conflict) surfaces as-is.
    const planNotPaid =
      addonData?.code === "PLAN_NOT_PAID" ||
      /pay your subscription plan first/i.test(addonData?.error || "");
    if (!planNotPaid) {
      throw new Error(addonData?.error || "Failed to launch resource.");
    }

    const attachRes = await fetch("/api/plan/attach-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        planKey: planForService(selected.id) || "Starter",
        selectedServices: [
          {
            serviceId: selected.id,
            serviceName: selected.name,
            category: selected.category,
            tier: selected.tier,
            domainChoice: selected.requiresDomainChoice ? domainChoice : "",
          },
        ],
      }),
    });
    const attachData = await attachRes.json().catch(() => ({}));
    if (!attachRes.ok) throw new Error(attachData?.error || "Failed to launch resource.");

    const unpaid = (attachData?.invoices || []).find((inv: any) => inv.status === "Unpaid");
    if (!unpaid) throw new Error("Order created but no invoice was generated — contact support.");
    onNavigate(`/payment/${unpaid.docName || unpaid.name}`);
  };

  const launchLoggedOut = () => {
    if (!selected) return;
    const plan = planForService(selected.id) || "Starter";
    const payload = {
      plan,
      planLabel: PLAN_META[plan].label,
      selectedServices: [
        {
          serviceId: selected.id,
          serviceName: selected.name,
          category: selected.category,
          tier: selected.tier,
          domainChoice: selected.requiresDomainChoice ? domainChoice : "",
        },
      ],
      monthlyTotalKes: selected.pricing.monthlyKes || 0,
      setupTotalKes: selected.pricing.setupKes || 0,
      domainYearlyTotalKes: 0,
      status: "Pending",
      selectedAt: new Date().toISOString(),
      source: "CloudLaunch",
      upgradeIntent: false,
      upgradeMode: "",
      repoUrl: selected.requiresRepo ? repoUrl : undefined,
    };
    localStorage.setItem("murzak_plan_selection_pending", JSON.stringify(payload));
    onClose();
    onNavigate("/login");
  };

  const handleLaunch = async () => {
    setErr("");
    if (!selected) {
      setErr("Pick a resource to continue.");
      return;
    }
    if (selected.requiresRepo && !/^(https?:\/\/|git@)\S+$/i.test(repoUrl.trim())) {
      setErr("Enter a valid repository URL (e.g. https://github.com/you/app).");
      return;
    }
    if (selected.requiresRepo && appPort.trim()) {
      const port = Number(appPort.trim());
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setErr("App port must be a whole number between 1 and 65535 (leave blank for 3000).");
        return;
      }
    }

    if (!isLoggedIn) {
      launchLoggedOut();
      return;
    }

    try {
      setSubmitting(true);
      await launchLoggedIn();
    } catch (e: any) {
      setErr(e?.message || "Failed to launch resource.");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div className="absolute inset-0 bg-murzak-ink/50 backdrop-blur-xl" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] bg-white/95 dark:bg-murzak-ink/95 backdrop-blur-xl rounded-2xl sm:rounded-[2.5rem] overflow-hidden border border-murzak-border flex flex-col min-h-0 shadow-2xl">
          <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-murzak-accent/20 bg-murzak-ink text-white flex items-start justify-between gap-3">
            <div>
              <p className="text-micro font-black uppercase text-murzak-accent/90">
                Murzak Cloud
              </p>
              <h3 className="text-lg sm:text-2xl font-black tracking-tighter text-white mt-1">
                Launch a cloud resource
              </h3>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-xl p-2 border border-white/15 text-white/80 hover:text-murzak-accent hover:border-murzak-accent bg-black/5 hover:bg-black/5"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-8 space-y-6">
            <div className="flex flex-wrap gap-2">
              {CLOUD_LAUNCH_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handlePickCategory(cat)}
                  className={`px-4 py-2 rounded-full text-label font-black uppercase tracking-widest border transition-all ${
                    category === cat
                      ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                      : "border-white/15 text-slate-600 dark:text-slate-400 hover:border-murzak-accent/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {servicesForCategory.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => setSelectedId(svc.id)}
                  className={`text-left rounded-3xl p-5 border transition-all ${
                    selectedId === svc.id
                      ? "border-murzak-accent bg-murzak-accent/10"
                      : "border-murzak-border bg-black/5 hover:border-murzak-accent/40"
                  }`}
                >
                  <p className="text-sm font-black text-murzak-ink dark:text-slate-100">{svc.name}</p>
                  <p className="text-label text-slate-600 dark:text-slate-400 font-medium mt-1 leading-relaxed">
                    {svc.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-micro font-bold text-slate-600 dark:text-slate-400">
                    <span>{svc.specs.ram} RAM</span>
                    <span>·</span>
                    <span>{svc.specs.storage}</span>
                  </div>
                  <p className="mt-3 text-lg font-black text-murzak-accent">
                    {formatKes(svc.pricing.monthlyKes)}/mo
                  </p>
                </button>
              ))}
              {servicesForCategory.length === 0 && (
                <p className="text-sm font-bold text-slate-500 col-span-2">
                  No resources available in this category yet.
                </p>
              )}
            </div>

            {selected?.requiresRepo && (
              <div>
                <label className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/app"
                  className="mt-2 w-full rounded-2xl px-5 py-4 bg-black/20 border border-murzak-border text-murzak-ink dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                />
                <details className="mt-3">
                  <summary className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest cursor-pointer select-none">
                    Advanced — app port
                  </summary>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={appPort}
                    onChange={(e) => setAppPort(e.target.value)}
                    placeholder="3000"
                    className="mt-2 w-full sm:w-48 rounded-2xl px-5 py-3 bg-black/20 border border-murzak-border text-murzak-ink dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                  />
                  <p className="mt-2 text-label text-slate-600 dark:text-slate-400 font-medium">
                    The port your app listens on inside its container. Leave blank if it uses 3000.
                  </p>
                </details>
              </div>
            )}

            {selected?.requiresDomainChoice && (
              <div>
                <label className="text-label font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                  Domain
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DOMAIN_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setDomainChoice(choice)}
                      className={`px-4 py-2 rounded-full text-label font-black border ${
                        domainChoice === choice
                          ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                          : "border-white/15 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {err && (
              <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 flex items-start gap-2 text-sm font-bold">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {err}
              </div>
            )}
          </div>

          <div className="p-5 sm:p-6 border-t border-murzak-border flex items-center justify-between gap-4">
            <div>
              <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Total</p>
              <p className="text-xl font-black text-murzak-ink dark:text-slate-100">
                {selected ? formatKes(selected.pricing.monthlyKes) : "—"}/mo
              </p>
            </div>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={submitting || !selected}
              className="px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-murzak-accent text-murzak-ink flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {submitting ? "Launching…" : "Launch now"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
