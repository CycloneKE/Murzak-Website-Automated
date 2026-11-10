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
  getService,
  planForService,
} from "../config/serviceCatalog";
import { toUserMessage } from "../services/errors";
import { acceptsDatabaseCompanion, gateCompanions, isDatabaseCompanionId } from "../services/bundles";
import { useAvailability } from "./AvailabilityNotice";

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
  const [capacityFull, setCapacityFull] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  // A database to launch together with app hosting ("" = none).
  const [databaseId, setDatabaseId] = useState("");
  const availability = useAvailability();

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
    setCapacityFull(false);
    setWaitlistSubmitting(false);
    setWaitlistJoined(false);
    setDatabaseId("");
  }, [isOpen]);

  if (!isOpen) return null;

  const servicesForCategory = catalog[category] || [];
  const selected = servicesForCategory.find((s) => s.id === selectedId) || null;

  // Databases this order may include: only with app hosting, only what the
  // server currently allows (it re-validates on order creation).
  const databaseOptions =
    selected && availability && acceptsDatabaseCompanion(selected.id)
      ? availability.allowedCompanionIds
          .filter(isDatabaseCompanionId)
          .map((id) => getService(id))
          .filter((s): s is ServiceItem => !!s)
      : [];
  const database = databaseOptions.find((d) => d.id === databaseId) || null;
  const totalMonthlyKes = selected ? (selected.pricing.monthlyKes || 0) + (database?.pricing.monthlyKes || 0) : null;
  const companionsFor = async () => (selected && database ? gateCompanions(selected.id, [database.id], "") : []);

  const handlePickCategory = (cat: CloudLaunchCategory) => {
    setCategory(cat);
    const first = catalog[cat][0];
    setSelectedId(first?.id || "");
    setRepoUrl("");
    setAppPort("");
    setDomainChoice("Use Murzak Subdomain");
    setDatabaseId("");
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

    // Save the repo URL BEFORE creating the order (unchanged rationale: a
    // repo-save failure aborts cleanly with nothing else created).
    await attachRepoIfNeeded();
    const companions = await companionsFor();

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        serviceId: selected.id,
        planKey: planForService(selected.id) || "Starter",
        source: "CloudLaunch",
        config: {
          domainChoice: selected.requiresDomainChoice ? domainChoice : "",
          ...(selected.requiresRepo ? { repoUrl } : {}),
          ...(appPort.trim() ? { appPort: Number(appPort.trim()) } : {}),
        },
        ...(companions.length ? { companions } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data?.code === "CAPACITY") {
      setCapacityFull(true);
      return;
    }
    if (!res.ok) throw new Error(data?.error || "Failed to start checkout.");
    onClose();
    onNavigate(`/checkout/${data.order.id}`);
  };

  const joinWaitlist = async () => {
    if (!selected) return;
    setWaitlistSubmitting(true);
    try {
      const res = await fetch("/api/orders/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serviceId: selected.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to join the waitlist.");
      setWaitlistJoined(true);
    } catch (e: any) {
      setErr(toUserMessage(e, "Failed to join the waitlist."));
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  // Deliberately NOT the same "murzak_plan_selection_pending" key/shape
  // PlanServicesModal/Pricing use — that flow POSTs to
  // /api/plan/attach-selection, which creates an invoice for the whole PLAN
  // TIER (Starter/Business base price), not for this one addon-priced
  // resource. A logged-out visitor picking a single Cloud resource must
  // resolve through the SAME Checkout Order flow launchLoggedIn() below
  // uses (POST /api/orders) — otherwise their purchase intent silently
  // turns into the wrong invoice (or none at all) once they finish signing
  // up, and they land on the dashboard with no purchase in progress. See
  // attachPendingCloudLaunch() in Login.tsx, which redeems this key.
  const launchLoggedOut = async () => {
    if (!selected) return;
    const companions = await companionsFor();
    const payload = {
      serviceId: selected.id,
      planKey: planForService(selected.id) || "Starter",
      source: "CloudLaunch",
      config: {
        domainChoice: selected.requiresDomainChoice ? domainChoice : "",
        ...(selected.requiresRepo ? { repoUrl } : {}),
        ...(appPort.trim() ? { appPort: Number(appPort.trim()) } : {}),
      },
      ...(companions.length ? { companions } : {}),
    };
    localStorage.setItem("murzak_cloud_launch_pending", JSON.stringify(payload));
    onClose();
    onNavigate("/login");
  };

  const handleLaunch = async () => {
    setErr("");
    setCapacityFull(false);
    setWaitlistJoined(false);
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
      await launchLoggedOut();
      return;
    }

    try {
      setSubmitting(true);
      await launchLoggedIn();
    } catch (e: any) {
      setErr(toUserMessage(e, "Failed to launch resource."));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-140">
      <div className="absolute inset-0 bg-murzak-ink/60" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] bg-white dark:bg-[#10141b] rounded-2xl overflow-hidden border border-murzak-border flex flex-col min-h-0 shadow-2xl">
          <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-murzak-accent/20 bg-murzak-ink text-white flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-300">
                Murzak Cloud
              </p>
              <h3 className="text-lg sm:text-xl font-extrabold text-white mt-0.5">
                What do you want to launch?
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
                  className={`px-4 py-2 rounded-full text-sm font-bold border transition-all ${
                    category === cat
                      ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                      : "border-murzak-border dark:border-white/15 text-slate-600 dark:text-slate-400 hover:border-murzak-accent/50"
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
                  className={`text-left rounded-2xl p-5 border transition-colors ${
                    selectedId === svc.id
                      ? "border-murzak-accent bg-murzak-accent/10"
                      : "border-murzak-border dark:border-white/10 hover:border-murzak-accent/50"
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
                <label className="text-sm font-bold text-murzak-ink dark:text-slate-100">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/app"
                  className="mt-2 w-full rounded-xl px-4 py-3 bg-white dark:bg-white/5 border border-murzak-border dark:border-white/15 text-murzak-ink dark:text-slate-100 font-bold focus:outline-hidden focus:ring-2 focus:ring-murzak-accent"
                />
                <details className="mt-3">
                  <summary className="text-sm font-bold text-murzak-ink dark:text-slate-100 cursor-pointer select-none">
                    Advanced: app port
                  </summary>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={appPort}
                    onChange={(e) => setAppPort(e.target.value)}
                    placeholder="3000"
                    className="mt-2 w-full sm:w-48 rounded-xl px-4 py-3 bg-white dark:bg-white/5 border border-murzak-border dark:border-white/15 text-murzak-ink dark:text-slate-100 font-bold focus:outline-hidden focus:ring-2 focus:ring-murzak-accent"
                  />
                  <p className="mt-2 text-label text-slate-600 dark:text-slate-400 font-medium">
                    The port your app listens on inside its container. Leave blank if it uses 3000.
                  </p>
                </details>
              </div>
            )}

            {databaseOptions.length > 0 && (
              <div data-testid="launch-database">
                <p className="text-sm font-bold text-murzak-ink dark:text-slate-100">Add a database</p>
                <p className="mt-0.5 text-label text-slate-600 dark:text-slate-400 font-medium">
                  Optional. It is set up with your app and billed on the same invoice.
                </p>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[null, ...databaseOptions].map((d) => {
                    const on = (d?.id || "") === databaseId;
                    return (
                      <button
                        key={d?.id || "none"}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDatabaseId(d?.id || "")}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          on
                            ? "border-murzak-accent bg-murzak-accent/10"
                            : "border-murzak-border hover:border-murzak-accent/50"
                        }`}
                      >
                        <span className="block text-sm font-bold text-murzak-ink dark:text-slate-100">
                          {d ? d.name.replace(/ Database$/, "") : "No database"}
                        </span>
                        <span className="block text-label font-medium text-slate-600 dark:text-slate-400">
                          {d ? `+ ${formatKes(d.pricing.monthlyKes)}/mo` : "App only"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selected?.requiresDomainChoice && (
              <div>
                <label className="text-sm font-bold text-murzak-ink dark:text-slate-100">
                  Domain
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DOMAIN_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setDomainChoice(choice)}
                      className={`px-4 py-2 rounded-full text-sm font-bold border ${
                        domainChoice === choice
                          ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                          : "border-murzak-border dark:border-white/15 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {capacityFull && (
              <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 flex flex-col gap-3 text-sm font-bold">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" /> We're at capacity right now.
                </div>
                {waitlistJoined ? (
                  <p className="text-slate-600 dark:text-slate-400 font-medium">
                    You're on the list. We'll email you the moment a slot opens.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={joinWaitlist}
                    disabled={waitlistSubmitting}
                    className="self-start px-4 py-2 rounded-full text-sm font-bold bg-murzak-accent text-murzak-ink disabled:opacity-50"
                  >
                    {waitlistSubmitting ? "Joining…" : "Join the waitlist"}
                  </button>
                )}
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
              <p className="text-label font-bold text-slate-600 dark:text-slate-400">
                {database ? `${selected?.name} + ${database.name}` : "Monthly total"}
              </p>
              <p className="text-xl font-black text-murzak-ink dark:text-slate-100">
                {totalMonthlyKes != null ? formatKes(totalMonthlyKes) : "—"}/mo
              </p>
            </div>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={submitting || !selected}
              className="px-6 py-3 rounded-full font-bold text-sm bg-murzak-accent text-murzak-ink flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {submitting ? "Starting…" : "Continue to checkout"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
