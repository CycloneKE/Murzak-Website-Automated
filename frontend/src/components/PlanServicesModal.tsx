
import React, { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import {
  X, CheckCircle2, AlertCircle, ArrowRight, Sparkles, ChevronDown,
  ShieldCheck, Server, Headphones, CreditCard, Plus, Check, Search,
  Globe, Mail, Database, HardDrive, Boxes, ShoppingCart, Lock, Zap, BarChart3, Video, LayoutGrid,
} from "lucide-react";
import DomainSearch from "./DomainSearch";
import {
  configuratorServices,
  PlanCode,
  DomainChoice,
  ServiceCategory,
  formatKes,
  isQuoteOnly,
  isManagedSetup,
  exceedsSelfServeCap,
  SELF_SERVE_ORDER_RAM_CAP_MB,
  SELF_SERVE_ORDER_DISK_CAP_GB,
  type ServiceItem,
} from "../config/serviceCatalog";

// Icon per category for the filter bar + section headers.
const CATEGORY_ICON: Record<string, React.ReactNode> = {
  "Website Hosting": <Globe size={14} />,
  "App Hosting": <Server size={14} />,
  "ERP Hosting": <Boxes size={14} />,
  "CRM & Helpdesk": <Headphones size={14} />,
  "Email Hosting": <Mail size={14} />,
  "Database Hosting": <Database size={14} />,
  "Storage": <HardDrive size={14} />,
  "Apps": <LayoutGrid size={14} />,
  "Security & Backup": <Lock size={14} />,
  "POS & Inventory": <ShoppingCart size={14} />,
  "Analytics": <BarChart3 size={14} />,
  "CCTV": <Video size={14} />,
  "Domains & SSL": <ShieldCheck size={14} />,
  "Performance": <Zap size={14} />,
  "Support & SLA": <Headphones size={14} />,
};

export type SelectedService = {
  serviceId: string;
  domainChoice?: DomainChoice;

  serviceName?: string;
  category?: string;
  tier?: string;
  monthlyKes?: number;
  setupKes?: number;
  domainYearlyKes?: number;
  registeredDomain?: string;
  specs?: {
    ram?: string;
    storage?: string;
    cpu?: string;
    backups?: string;
    sla?: string;
    bandwidth?: string;
  };
};

interface Props {
  isOpen: boolean;
  planCode: PlanCode | null;
  planLabel?: string;
  onClose: () => void;

  /** Service ids to pre-select when the modal opens (e.g. from the Plan Advisor). */
  preselectServiceIds?: string[];

  onProceedLogin: () => void;
  onProceedPortal: () => void;
  onProceedEnterpriseQuote?: () => void;
}

function buildSelection(svc: ServiceItem): SelectedService {
  return {
    serviceId: svc.id,
    serviceName: svc.name,
    category: svc.category,
    tier: svc.tier,
    monthlyKes: svc.pricing.monthlyKes,
    setupKes: svc.pricing.setupKes,
    specs: svc.specs,
    domainChoice: svc.requiresDomainChoice ? "Use Murzak Subdomain" : undefined,
  };
}

const domainChoices: DomainChoice[] = [
  "Use Murzak Subdomain",
  "Bring My Domain",
  "Register New Domain",
];

function SpecChip({ label, value }: { label: string; value?: string }) {
  if (!value || value === "N/A") return null;
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border px-3 py-2 text-micro font-black uppercase text-slate-600 dark:text-slate-600">
      {label}: <span className="text-murzak-ink">{value}</span>
    </div>
  );
}

export default function PlanServicesModal({
  isOpen,
  planCode,
  planLabel,
  onClose,
  preselectServiceIds,
  onProceedLogin,
  onProceedPortal,
  onProceedEnterpriseQuote,
}: Props) {
  const [selected, setSelected] = useState<Record<string, SelectedService>>({});
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false); // mobile
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<ServiceCategory | "All">("All");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollYRef = useRef(0);
  const catRowRef = useRef<HTMLDivElement | null>(null);
  // Category tabs overflow horizontally with the scrollbar hidden — these
  // drive edge fades + arrow buttons so "more categories" is discoverable
  // instead of a swipe no one knows to try (mobile has no scrollbar at all).
  const [catCanScrollLeft, setCatCanScrollLeft] = useState(false);
  const [catCanScrollRight, setCatCanScrollRight] = useState(false);

  const updateCatScrollState = () => {
    const el = catRowRef.current;
    if (!el) return;
    setCatCanScrollLeft(el.scrollLeft > 4);
    setCatCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  const scrollCatRow = (dir: -1 | 1) => {
    catRowRef.current?.scrollBy({ left: dir * 180, behavior: "smooth" });
  };

  const services = useMemo<ServiceItem[]>(() => {
    if (!planCode) return [];
    return configuratorServices(planCode);
  }, [planCode]);

  // Categories present in this plan's catalog (in first-seen order).
  const categories = useMemo<ServiceCategory[]>(() => {
    const seen: ServiceCategory[] = [];
    for (const s of services) if (!seen.includes(s.category)) seen.push(s.category);
    return seen;
  }, [services]);

  useEffect(() => {
    updateCatScrollState();
    const el = catRowRef.current;
    if (!el) return;
    const onResize = () => updateCatScrollState();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length]);

  // Apply search + category filter, then group by category for display.
  const grouped = useMemo<{ category: ServiceCategory; items: ServiceItem[] }[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: ServiceItem) =>
      (activeCat === "All" || s.category === activeCat) &&
      (!q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.highlights || []).some((h) => h.toLowerCase().includes(q)));
    const out: { category: ServiceCategory; items: ServiceItem[] }[] = [];
    for (const cat of categories) {
      const items = services
        .filter((s) => s.category === cat && match(s))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      if (items.length) out.push({ category: cat, items });
    }
    return out;
  }, [services, categories, query, activeCat]);

  const visibleCount = useMemo(() => grouped.reduce((n, g) => n + g.items.length, 0), [grouped]);

  const selectedList = useMemo<SelectedService[]>(
    () => Object.values(selected),
    [selected]
  );

  const quoteMode = planCode === "Enterprise";

  // ---- live totals ----
  const totals = useMemo(() => {
    let monthly = 0;
    let setup = 0;
    let domainYearly = 0;
    for (const sel of selectedList) {
      const svc = services.find((s) => s.id === sel.serviceId);
      if (!svc) continue;
      monthly += svc.pricing.monthlyKes || 0;
      setup += svc.pricing.setupKes || 0;
      if (sel.domainChoice === "Register New Domain") {
        // use the real price of the chosen domain once picked, else the catalog estimate
        domainYearly += sel.domainYearlyKes ?? svc.pricing.domainAddonKes ?? 0;
      }
    }
    return { monthly, setup, domainYearly };
  }, [selectedList, services]);

  // ---- capacity guard ----
  // A single self-serve order can't consume more than one shared tenant's worth
  // of the box; beyond the cap it's a dedicated/Enterprise conversation.
  const selectedSvcItems = useMemo<ServiceItem[]>(
    () =>
      selectedList
        .map((s) => services.find((x) => x.id === s.serviceId))
        .filter(Boolean) as ServiceItem[],
    [selectedList, services]
  );
  const capacity = useMemo(() => exceedsSelfServeCap(selectedSvcItems), [selectedSvcItems]);
  const overCap = !quoteMode && capacity.over;
  const ramPct = Math.min(100, Math.round((capacity.ramMb / SELF_SERVE_ORDER_RAM_CAP_MB) * 100));
  const diskPct = Math.min(100, Math.round((capacity.diskGb / SELF_SERVE_ORDER_DISK_CAP_GB) * 100));

  // reset on open / plan switch — seed with any pre-selected services (from the advisor)
  useEffect(() => {
    if (!isOpen) return;
    const seed: Record<string, SelectedService> = {};
    for (const id of preselectServiceIds ?? []) {
      const svc = services.find((s) => s.id === id);
      if (svc) seed[id] = buildSelection(svc);
    }
    setSelected(seed);
    setExpandedId(null);
    setError("");
    setQuery("");
    setActiveCat("All");
    setSummaryOpen(Object.keys(seed).length > 0);
  }, [isOpen, planCode, preselectServiceIds, services]);

  // scroll lock + reset to top
  useLayoutEffect(() => {
    if (!isOpen) return;
    const y = window.scrollY || 0;
    scrollYRef.current = y;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    });
    return () => {
      document.documentElement.style.overflow = prevOverflow;
      window.scrollTo({ top: scrollYRef.current || 0, left: 0, behavior: "instant" as ScrollBehavior });
    };
  }, [isOpen, planCode]);

  if (!isOpen || !planCode) return null;

  const toggleService = (svc: ServiceItem) => {
    setError("");
    setSelected((prev) => {
      const next = { ...prev };
      if (next[svc.id]) {
        delete next[svc.id];
        return next;
      }
      next[svc.id] = {
        serviceId: svc.id,
        serviceName: svc.name,
        category: svc.category,
        tier: svc.tier,
        monthlyKes: svc.pricing.monthlyKes,
        setupKes: svc.pricing.setupKes,
        specs: svc.specs,
        // auto-pick a sensible default domain so users aren't blocked
        domainChoice: svc.requiresDomainChoice ? "Use Murzak Subdomain" : undefined,
      };
      return next;
    });
    // open mobile summary on first add
    if (!selected[svc.id]) setSummaryOpen(true);
  };

  const setDomainChoice = (svc: ServiceItem, choice: DomainChoice) => {
    setError("");
    setSelected((prev) => ({
      ...prev,
      [svc.id]: {
        ...(prev[svc.id] ?? { serviceId: svc.id }),
        domainChoice: choice,
        // clear any previously registered domain when switching away
        registeredDomain: choice === "Register New Domain" ? prev[svc.id]?.registeredDomain : undefined,
        domainYearlyKes: choice === "Register New Domain" ? prev[svc.id]?.domainYearlyKes : 0,
      },
    }));
  };

  const setRegisteredDomain = (svc: ServiceItem, domain: string, priceKes: number) => {
    setSelected((prev) => ({
      ...prev,
      [svc.id]: {
        ...(prev[svc.id] ?? { serviceId: svc.id }),
        domainChoice: "Register New Domain",
        registeredDomain: domain,
        domainYearlyKes: priceKes,
      },
    }));
  };

  const removeService = (id: string) =>
    setSelected((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const canContinue = selectedList.length > 0 && !overCap;

  const persistSelection = () => {
    const upgradeIntent = sessionStorage.getItem("murzak_upgrade_intent") === "1";
    const upgradeMode = sessionStorage.getItem("murzak_upgrade_mode") || "";

    const payload = {
      plan: planCode,
      planLabel: planLabel || planCode,
      selectedServices: selectedList,
      monthlyTotalKes: totals.monthly,
      setupTotalKes: totals.setup,
      domainYearlyTotalKes: totals.domainYearly,
      status: "Pending",
      selectedAt: new Date().toISOString(),
      source: "Configurator",
      upgradeIntent,
      upgradeMode,
    };
    localStorage.setItem("murzak_plan_selection_pending", JSON.stringify(payload));
  };

  const handleContinue = () => {
    setError("");
    if (overCap) {
      // The capacity meter already shows the red "needs dedicated capacity"
      // warning, so don't flash a duplicate error. Persist the selection first
      // so the sales/quote flow has the exact stack the user configured.
      if (onProceedEnterpriseQuote) {
        persistSelection();
        onProceedEnterpriseQuote();
      } else {
        setError("This configuration needs dedicated capacity — remove a service or contact sales.");
        setSummaryOpen(true);
      }
      return;
    }
    if (!canContinue) {
      setError("Add at least one service to continue.");
      setSummaryOpen(true);
      return;
    }
    persistSelection();
    if (quoteMode && onProceedEnterpriseQuote) {
      onProceedEnterpriseQuote();
    } else {
      onProceedLogin();
    }
  };

  const headerSubtitle = quoteMode
    ? "Pick what you need — we’ll scope and quote dedicated capacity for your stack."
    : "Build your plan. Prices update live — no surprises at checkout.";

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-murzak-ink/50 backdrop-blur-xl" onClick={onClose} />

      <div className="relative w-full h-full bg-white/90 dark:bg-murzak-ink/95 backdrop-blur-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-murzak-ink text-white border-b border-murzak-border">
          <div className="px-5 sm:px-10 py-4 sm:py-5 flex items-start sm:items-center justify-between gap-4 max-w-[1400px] mx-auto w-full">
            <div className="min-w-0">
              <div className="text-micro font-black uppercase text-murzak-accent flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Configure your plan
              </div>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-white mt-1 truncate">
                {planLabel || planCode}
              </h3>
              <p className="text-label font-bold text-slate-600 mt-1.5 max-w-2xl">
                {headerSubtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-xl p-3 border border-murzak-border text-slate-600 hover:text-murzak-accent hover:border-murzak-accent transition-all"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto lg:overflow-hidden overscroll-contain"
        >
          <div className="max-w-[1400px] mx-auto w-full px-5 sm:px-10 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-[calc(100vh-92px)]">
            {/* Services list */}
            <div className="lg:col-span-8 lg:min-h-0 lg:overflow-y-auto lg:pr-2 overscroll-contain">
              {/* Search + category filter */}
              <div className="sticky top-0 z-10 -mx-1 px-1 pb-3 pt-1 bg-white/90 dark:bg-murzak-ink/95 backdrop-blur-xl">
                <div className="relative mb-3">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search services — email, backups, CDN…"
                    className="w-full rounded-2xl border border-slate-200 dark:border-murzak-border bg-slate-50 dark:bg-black/5 pl-11 pr-4 py-3 text-sm font-bold text-murzak-ink placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                  />
                </div>
                <div className="relative">
                  <div
                    ref={catRowRef}
                    onScroll={updateCatScrollState}
                    className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <button
                      onClick={() => setActiveCat("All")}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-micro font-black uppercase transition-all ${
                        activeCat === "All"
                          ? "bg-murzak-accent text-murzak-ink"
                          : "border border-slate-200 dark:border-murzak-border text-slate-500 dark:text-slate-500 hover:border-murzak-accent"
                      }`}
                    >
                      <LayoutGrid size={14} /> All ({services.length})
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCat(cat)}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-micro font-black uppercase transition-all ${
                          activeCat === cat
                            ? "bg-murzak-accent text-murzak-ink"
                            : "border border-slate-200 dark:border-murzak-border text-slate-500 dark:text-slate-500 hover:border-murzak-accent"
                        }`}
                      >
                        {CATEGORY_ICON[cat]} {cat}
                      </button>
                    ))}
                  </div>

                  {/* Edge fades + arrows — the row has no visible scrollbar, so
                      without these the cut-off categories look like the end of
                      the list rather than a swipeable/scrollable row. */}
                  {catCanScrollLeft && (
                    <>
                      <div className="pointer-events-none absolute left-0 top-0 bottom-1 w-8 bg-gradient-to-r from-white dark:from-murzak-ink to-transparent" />
                      <button
                        type="button"
                        aria-label="Scroll categories left"
                        onClick={() => scrollCatRow(-1)}
                        className="hidden sm:flex absolute left-0.5 top-1/2 -translate-y-1/2 items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-murzak-ink border border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-300 shadow-sm"
                      >
                        <ChevronDown size={12} className="rotate-90" />
                      </button>
                    </>
                  )}
                  {catCanScrollRight && (
                    <>
                      <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-white dark:from-murzak-ink to-transparent" />
                      <button
                        type="button"
                        aria-label="Scroll categories right"
                        onClick={() => scrollCatRow(1)}
                        className="hidden sm:flex absolute right-0.5 top-1/2 -translate-y-1/2 items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-murzak-ink border border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-300 shadow-sm"
                      >
                        <ChevronDown size={12} className="-rotate-90" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {grouped.map((group) => (
                <div key={group.category} className="mb-6">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <span className="text-murzak-accent">{CATEGORY_ICON[group.category]}</span>
                    <h4 className="text-label font-black uppercase tracking-widest text-murzak-ink">{group.category}</h4>
                    <span className="text-micro font-bold text-slate-600">({group.items.length})</span>
                    <div className="flex-1 h-px bg-slate-100 dark:bg-black/5 ml-2" />
                  </div>
                  <div className="space-y-3">
                  {group.items.map((svc) => {
                const isSelected = !!selected[svc.id];
                const isExpanded = expandedId === svc.id;
                const quote = isQuoteOnly(svc);
                const domainRequired = !!svc.requiresDomainChoice;

                return (
                  <div
                    key={svc.id}
                    className={`group relative rounded-3xl border transition-all duration-300 overflow-hidden ${
                      isSelected
                        ? "border-murzak-accent bg-murzak-accent/5 dark:bg-murzak-accent/10 shadow-lg shadow-murzak-accent/10"
                        : "border-slate-200 dark:border-murzak-border bg-white dark:bg-murzak-surface/60 hover:border-murzak-accent/50"
                    }`}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-4">
                        {/* left: name + price */}
                        <button
                          type="button"
                          onClick={() => setExpandedId((p) => (p === svc.id ? null : svc.id))}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="text-micro font-black uppercase text-slate-600">
                            {svc.category} • {svc.tier}
                          </div>
                          <div className="text-base sm:text-lg font-black text-murzak-ink mt-1 leading-tight">
                            {svc.name}
                          </div>
                          {isManagedSetup(svc) && (
                            <span className="inline-flex items-center gap-1 mt-2 rounded-full bg-amber-400/10 text-amber-500 border border-amber-400/20 px-2.5 py-1 text-micro font-black uppercase">
                              <Server size={11} /> Managed setup
                            </span>
                          )}
                          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                            {quote ? (
                              <span className="text-lg font-black text-murzak-accent">Custom quote</span>
                            ) : (
                              <>
                                <span className="text-lg sm:text-xl font-black text-murzak-ink">
                                  {(svc.pricing.monthlyKes ?? 0) === 0 ? "Free" : formatKes(svc.pricing.monthlyKes)}
                                </span>
                                <span className="text-micro font-black uppercase text-slate-600">/mo</span>
                                {!!svc.pricing.setupKes && (
                                  <span className="text-micro font-bold uppercase text-slate-600">
                                    + {formatKes(svc.pricing.setupKes)} setup
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          <div className="mt-2 inline-flex items-center gap-1 text-micro font-black uppercase text-slate-600 group-hover:text-murzak-accent transition-colors">
                            Details <ChevronDown size={13} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </div>
                        </button>

                        {/* right: add/remove */}
                        <button
                          type="button"
                          onClick={() => toggleService(svc)}
                          className={`shrink-0 rounded-2xl px-4 py-3 font-black text-micro uppercase transition-all flex items-center gap-2 ${
                            isSelected
                              ? "bg-murzak-accent text-murzak-ink shadow-lg shadow-murzak-accent/20"
                              : "border-2 border-murzak-accent text-murzak-accent hover:bg-murzak-accent hover:text-murzak-ink"
                          }`}
                        >
                          {isSelected ? <><Check size={14} /> Added</> : <><Plus size={14} /> Add</>}
                        </button>
                      </div>

                      {/* expanded */}
                      {isExpanded && (
                        <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border animate-fade-in">
                          {svc.description && (
                            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-600 mb-4 leading-relaxed">
                              {svc.description}
                            </p>
                          )}

                          {!!svc.highlights?.length && (
                            <div className="flex flex-wrap gap-2 mb-4">
                              {svc.highlights.map((h) => (
                                <span key={h} className="inline-flex items-center gap-1.5 rounded-full bg-murzak-accent/10 text-murzak-accent px-3 py-1 text-micro font-black uppercase">
                                  <CheckCircle2 size={12} /> {h}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            <SpecChip label="RAM" value={svc.specs?.ram} />
                            <SpecChip label="Storage" value={svc.specs?.storage} />
                            <SpecChip label="CPU" value={svc.specs?.cpu} />
                            <SpecChip label="Backups" value={svc.specs?.backups} />
                            <SpecChip label="SLA" value={svc.specs?.sla} />
                            <SpecChip label="Bandwidth" value={svc.specs?.bandwidth} />
                          </div>

                          {domainRequired && isSelected && (
                            <div className="mt-5">
                              <div className="text-micro font-black uppercase text-slate-600 mb-2.5">
                                Domain option
                              </div>
                              <div className="flex flex-wrap gap-2.5">
                                {domainChoices.map((c) => {
                                  const active = selected[svc.id]?.domainChoice === c;
                                  const isRegister = c === "Register New Domain";
                                  return (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => setDomainChoice(svc, c)}
                                      className={`px-3.5 py-2 rounded-xl border text-micro font-black uppercase transition-all ${
                                        active
                                          ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                                          : "border-slate-200 dark:border-murzak-border text-slate-500 dark:text-slate-500 hover:border-murzak-accent"
                                      }`}
                                    >
                                      {c}
                                      {isRegister && svc.pricing.domainAddonKes ? (
                                        <span className="ml-1 opacity-80">(+{formatKes(svc.pricing.domainAddonKes)}/yr)</span>
                                      ) : null}
                                    </button>
                                  );
                                })}
                              </div>

                              {selected[svc.id]?.domainChoice === "Register New Domain" && (
                                <DomainSearch
                                  selectedDomain={selected[svc.id]?.registeredDomain}
                                  onSelect={(domain, priceKes) => setRegisteredDomain(svc, domain, priceKes)}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
                  })}
                  </div>
                </div>
              ))}

              {services.length > 0 && visibleCount === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-murzak-border p-10 text-center">
                  <p className="text-label font-bold text-slate-600">No services match “{query}”.</p>
                  <button
                    onClick={() => { setQuery(""); setActiveCat("All"); }}
                    className="mt-3 text-micro font-black uppercase text-murzak-accent hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {services.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-murzak-border p-10 text-center text-label font-bold text-slate-600">
                  No services available for this plan yet.
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="lg:col-span-4 lg:min-h-0">
              {/* mobile toggle */}
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                className="lg:hidden w-full mb-3 rounded-2xl px-5 py-4 bg-murzak-ink text-white border border-murzak-accent/40 flex items-center justify-between font-black text-label uppercase tracking-widest"
              >
                <span>Your plan ({selectedList.length})</span>
                <span className="flex items-center gap-3">
                  <span className="text-murzak-accent">{quoteMode ? "Quote" : formatKes(totals.monthly) + "/mo"}</span>
                  <ChevronDown size={16} className={`transition-transform ${summaryOpen ? "rotate-180" : ""}`} />
                </span>
              </button>

              <div className={`${summaryOpen ? "block" : "hidden"} lg:block lg:sticky lg:top-6`}>
                <div className="glass-card shadow-2xl overflow-hidden border border-murzak-border">
                  <div className="bg-gradient-to-r from-murzak-brand1/20 to-murzak-accent/20 px-5 py-4 border-b border-murzak-border backdrop-blur-sm">
                    <div className="text-micro font-black uppercase text-murzak-ink/80">Your plan</div>
                    <div className="text-sm font-black text-murzak-ink mt-0.5">{planLabel || planCode}</div>
                  </div>

                  <div className="p-5">
                    {/* selected list */}
                    {selectedList.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-murzak-border p-6 text-center">
                        <p className="text-label font-bold text-slate-600 dark:text-slate-600">No services added yet.</p>
                        <p className="text-micro text-slate-600 mt-2">Tap <span className="font-black text-murzak-accent">Add</span> on a service to build your plan.</p>
                      </div>
                    ) : (
                      <ul className="space-y-2.5 max-h-[34vh] lg:max-h-[30vh] overflow-y-auto pr-1 overscroll-contain">
                        {selectedList.map((s) => {
                          const svc = services.find((x) => x.id === s.serviceId);
                          return (
                            <li key={s.serviceId} className="glass-panel p-3.5 mb-2 rounded-2xl">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[12px] font-black text-murzak-ink leading-tight">{s.serviceName}</div>
                                  {s.domainChoice && (
                                    <div className="text-micro font-bold uppercase text-slate-600 mt-1">
                                      {s.registeredDomain || s.domainChoice}
                                    </div>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-[12px] font-black text-murzak-ink">
                                    {svc && isQuoteOnly(svc) ? "Quote" : (s.monthlyKes ?? 0) === 0 ? "Free" : formatKes(s.monthlyKes)}
                                  </div>
                                  <button
                                    onClick={() => removeService(s.serviceId)}
                                    className="text-micro font-black uppercase text-red-400 hover:text-red-600 mt-1"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* totals */}
                    {!quoteMode && selectedList.length > 0 && (
                      <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-label font-bold text-slate-600 dark:text-slate-600">Monthly</span>
                          <span className="text-2xl font-black text-murzak-gradient">{formatKes(totals.monthly)}</span>
                        </div>
                        {totals.setup > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-label font-bold text-slate-600 dark:text-slate-600">One-time setup</span>
                            <span className="text-sm font-black text-murzak-ink">{formatKes(totals.setup)}</span>
                          </div>
                        )}
                        {totals.domainYearly > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-label font-bold text-slate-600 dark:text-slate-600">Domain (yearly)</span>
                            <span className="text-sm font-black text-murzak-ink">{formatKes(totals.domainYearly)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* capacity meter — keeps a single shared order within the box.
                        Shows BOTH RAM and disk; either dimension can trip overCap. */}
                    {!quoteMode && selectedList.length > 0 && (
                      <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border">
                        <div className="text-micro font-black uppercase text-slate-600 mb-2">
                          Capacity
                        </div>
                        {[
                          { label: "RAM", used: (capacity.ramMb / 1024).toFixed(1), cap: (SELF_SERVE_ORDER_RAM_CAP_MB / 1024).toFixed(0), unit: "GB", pct: ramPct, over: capacity.ramOver },
                          { label: "Disk", used: capacity.diskGb, cap: SELF_SERVE_ORDER_DISK_CAP_GB, unit: "GB", pct: diskPct, over: capacity.diskOver },
                        ].map((row) => (
                          <div key={row.label} className="mb-2.5 last:mb-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-micro font-bold uppercase text-slate-600">{row.label}</span>
                              <span className={`text-micro font-black uppercase ${row.over ? "text-red-500" : "text-slate-600 dark:text-slate-600"}`}>
                                {row.used} / {row.cap} {row.unit}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-black/40 overflow-hidden shadow-inner">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden ${
                                  row.over 
                                    ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" 
                                    : "bg-murzak-accent shadow-[0_0_10px_rgba(0,189,252,0.5)]"
                                }`}
                                style={{ width: `${row.pct}%` }}
                              >
                                <div className="absolute inset-0 bg-white/20 w-full animate-shimmer" />
                              </div>
                            </div>
                          </div>
                        ))}
                        {overCap && (
                          <div className="mt-3 text-micro font-bold text-red-500 flex items-start gap-2 leading-relaxed">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            This build needs dedicated capacity. Remove a service, or continue to a dedicated quote.
                          </div>
                        )}
                      </div>
                    )}

                    {quoteMode && selectedList.length > 0 && (
                      <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border text-label font-bold text-slate-600 dark:text-slate-600">
                        We’ll size dedicated capacity and send you a tailored quote.
                      </div>
                    )}

                    {error && (
                      <div className="mt-4 text-micro font-black uppercase text-red-500 flex items-center gap-2">
                        <AlertCircle size={14} /> {error}
                      </div>
                    )}

                    {/* CTA — enabled once something is selected; an over-capacity
                        build routes to a dedicated quote instead of checkout. */}
                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={selectedList.length === 0}
                      className={`mt-5 w-full py-4 rounded-2xl font-black text-label uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                        selectedList.length === 0
                          ? "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
                          : "bg-murzak-accent text-murzak-ink hover:scale-[1.02] shadow-lg shadow-murzak-accent/20"
                      }`}
                    >
                      {overCap ? "Get a dedicated quote" : quoteMode ? "Proceed to quote" : "Continue to checkout"} <ArrowRight size={16} />
                    </button>

                    <p className="text-micro font-bold text-slate-600 leading-relaxed mt-3 text-center">
                      You’ll log in next so we can attach this to your account. No charge yet.
                    </p>

                    {selectedSvcItems.some(isManagedSetup) && (
                      <p className="text-micro font-bold text-amber-500 leading-relaxed mt-3 text-center flex items-center justify-center gap-1.5">
                        <Server size={12} /> Managed apps (ERP / POS / CRM) are configured by our team — live within a short setup window, not instantly.
                      </p>
                    )}

                    {/* managed vs DIY reassurance */}
                    <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border space-y-2.5">
                      <div className="text-micro font-black uppercase text-slate-600">Every plan includes</div>
                      {[
                        { icon: <Server size={13} />, t: "Fully managed setup & hosting" },
                        { icon: <CreditCard size={13} />, t: "M-Pesa & card billing in KES" },
                        { icon: <ShieldCheck size={13} />, t: "Daily backups, SSL & hardening" },
                        { icon: <Headphones size={13} />, t: "Nairobi-based support" },
                      ].map((b) => (
                        <div key={b.t} className="flex items-center gap-2.5 text-label font-bold text-slate-600 dark:text-slate-600">
                          <span className="text-murzak-accent">{b.icon}</span> {b.t}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
