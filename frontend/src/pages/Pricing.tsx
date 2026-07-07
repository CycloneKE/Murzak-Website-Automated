
import React, { useState, useRef, useEffect } from 'react';
import {
  Check,
  ShieldCheck,
  ArrowRight,
  Wand2,
  Server,
  Headphones,
  Smartphone,
  Lock,
  HardDrive,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Page } from '../types';
import { SkeletonHero, SkeletonGrid } from '../components/Skeleton';
import OptimizedImage from '../components/OptimizedImage';
import { useLocation, useNavigate } from "react-router-dom";
import SalesModal from "../components/SalesModal";
import PlanServicesModal from "../components/PlanServicesModal";
import ManagedComparison from "../components/ManagedComparison";
import Faq, { type FaqItem } from "../components/Faq";
import PlanAdvisor from "../components/PlanAdvisor";
import { PLAN_META, formatKes, planForService, type PlanCode } from "../config/serviceCatalog";
import { Button } from "../components/ui/Button";

interface PricingProps {
  onNavigate: (page: Page | string) => void;
  onSelectPlan?: (plan: string, returnTo?: string) => void;
  isLoading?: boolean;
  isLoggedIn?: boolean;
  user?: User | null;
  onUserUpdate?: (user: User) => void;
}

const Pricing: React.FC<PricingProps> = ({ onNavigate, onSelectPlan, isLoading, isLoggedIn, user, onUserUpdate }) => {
  const [selectedPlans, setSelectedPlans] = useState<string[]>(['None']); 
  const gridRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const returnTo = params.get("returnTo") || "/portal/billing";
  const [salesOpen, setSalesOpen] = useState(false);
  const [salesInitialMode, setSalesInitialMode] = useState<'select' | 'demo' | 'quote'>('select');
  const [servicesOpen, setServicesOpen] = useState(false);
  const [servicesPlanCode, setServicesPlanCode] = useState<PlanCode | null>(null);
  const [servicesPlanLabel, setServicesPlanLabel] = useState<string>("");
  const [preselectIds, setPreselectIds] = useState<string[]>([]);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  useEffect(() => {
    if (location.hash === "#pricing-plans") {
      // wait for layout/paint
      requestAnimationFrame(() => {
        const el = document.getElementById("pricing-plans");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [location.hash]);

  // Deep-link from elsewhere (e.g. a Products card): /pricing?configure=<serviceId>
  // opens the configurator on the right plan with that product pre-selected.
  // Also handles /pricing?mode=add-services&plan=Business from Portal.
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const productId = searchParams.get("configure");
    const mode = searchParams.get("mode");
    const plan = searchParams.get("plan") as PlanCode | null;

    if (mode === "add-services" && plan && plan !== "Enterprise") {
      setServicesPlanCode(plan);
      setServicesPlanLabel(PLAN_META[plan].label);
      setServicesOpen(true);
      navigate("/pricing", { replace: true });
      return;
    }

    if (!productId) return;
    const prodPlan = planForService(productId);
    if (prodPlan && prodPlan !== "Enterprise") {
      setPreselectIds([productId]);
      setServicesPlanCode(prodPlan);
      setServicesPlanLabel(PLAN_META[prodPlan].label);
      setServicesOpen(true);
    }
    // Strip the param so a refresh/back doesn't reopen the modal.
    navigate("/pricing", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Cards are derived from the single catalog source (PLAN_META) so prices never drift.
  const planImages: Record<PlanCode, string> = {
    Test: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa',
    Starter: 'https://images.unsplash.com/photo-1563986768609-322da13575f3',
    Business: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1',
    Enterprise: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b',
  };

  const plans = (Object.values(PLAN_META)).map((m) => ({
    code: m.code,
    name: m.label,
    price: m.startingKes == null ? 'Custom' : m.startingKes === 0 ? 'Free' : formatKes(m.startingKes),
    pricePrefix: m.startingKes && m.startingKes > 0 ? 'from' : '',
    period: m.period,
    description: m.blurb,
    bestFor: m.bestFor,
    isFeatured: m.featured,
    cta: m.cta,
    img: planImages[m.code],
    features: m.features,
  }));

  const faqItems: FaqItem[] = [
    { q: "How do I pay — and in what currency?", a: "Everything is billed in Kenyan Shillings (KES). Pay by M-Pesa STK push or card from your client portal. No forex surprises." },
    { q: "Can I use my own domain or register a new one?", a: "Both. Point an existing domain to us, use a free Murzak subdomain to start, or search and register a brand-new domain right inside the plan configurator — we handle the setup." },
    { q: "What does 'managed' actually include?", a: "We provision and configure the server, install and tune your apps (ERPNext, POS, CRM, websites), set up SSL, run daily backups, patch security, and support you from Nairobi. You focus on your business." },
    { q: "Can I add services or upgrade later?", a: "Yes — add services anytime from your portal. Each one is a clearly-priced add-on billed in KES, so you only ever pay for what you actually use." },
    { q: "What happens if I outgrow my plan?", a: "Larger ERPs, databases and high-load platforms move to dedicated capacity. We size it, quote it, and migrate you with no downtime." },
    { q: "How fast is setup?", a: "Most websites and standard apps go live the same day. Configured ERPNext with data migration is scoped during onboarding and typically takes a few days." },
    { q: "Are my data and site backed up?", a: "Yes. Daily backups are included on paid plans, with SSL and security hardening as standard. Disaster-recovery options are available on dedicated plans." },
  ];

  if (isLoading) {
    return (
      <div className="bg-transparent">
        <SkeletonHero />
        <section className="py-24 lg:py-48 max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <SkeletonGrid count={4} />
        </section>
      </div>
    );
  }

const handleCtaClick = (plan: typeof plans[0]) => {
  // Free trial — straight to the trial request flow.
  if (plan.code === "Test") {
    onNavigate("test-request");
    return;
  }

  // Enterprise is dedicated/quote-based — route to a sales conversation, not self-serve checkout.
  if (plan.code === "Enterprise") {
    setSalesInitialMode("quote");
    setSalesOpen(true);
    return;
  }

  // Self-serve plans: open the configurator, then proceed to checkout/login.
  setPreselectIds([]);
  setServicesPlanCode(plan.code);
  setServicesPlanLabel(plan.name);
  setServicesOpen(true);
};

// Advisor recommended a plan — open the configurator with services pre-selected.
const handleAdvisorChoose = (planCode: PlanCode, serviceIds: string[]) => {
  setPreselectIds(serviceIds);
  setServicesPlanCode(planCode);
  setServicesPlanLabel(PLAN_META[planCode].label);
  setServicesOpen(true);
};

  return (
    <div className="bg-transparent min-h-screen">


      {/* Hero / CTA landing — now ABOVE the plan grid */}
      <section className="relative pt-10 sm:pt-16 lg:pt-24 pb-16 sm:pb-24 lg:pb-28 overflow-hidden bg-transparent">
        {/* Background intentionally removed — the universal site backdrop
            (body image in index.css) now shows through this transparent hero. */}

        <div className="max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-16 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-murzak-cyan/10 rounded-full border border-murzak-cyan/20 mb-6 sm:mb-8 backdrop-blur-md">
            <ShieldCheck size={16} className="text-murzak-cyan w-3 h-3 sm:w-4 sm:h-4" />
            <span className="font-mono text-[8px] sm:text-[10px] font-black text-murzak-cyan uppercase tracking-widest">Priced in shillings · no hidden fees</span>
          </div>
          <h1 className="text-[clamp(2.2rem,10vw,7.5rem)] font-[900] text-white mb-6 tracking-tighter leading-[0.9] sm:leading-[0.85] drop-shadow-2xl text-balance">
            Pay for what you use. <br /><span className="text-murzak-cyan">See it first.</span>
          </h1>
          <p className="text-base sm:text-xl lg:text-2xl text-slate-100 max-w-3xl mx-auto mb-10 font-bold opacity-95 leading-relaxed drop-shadow-md">
            Pick your services, watch the total add up in shillings, and start. No quotes to chase, no surprises on the invoice.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button onClick={() => document.getElementById("pricing-plans")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              View the plans <ArrowRight size={16} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => setAdvisorOpen(true)}>
              <Wand2 size={16} className="text-murzak-cyan" /> Not sure? Help me choose
            </Button>
          </div>
        </div>
      </section>

      {/* Main Pricing Grid — now BELOW the CTA landing */}
      <section id="pricing-plans" ref={gridRef} className="relative scroll-mt-24 py-12 sm:py-20 lg:py-24 max-w-[1440px] mx-auto px-6 sm:px-10 lg:px-16 xl:px-24">
        <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-4">Choose your solution</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight text-murzak-navy dark:text-white">
            Infrastructure & SaaS
          </h2>
          <p className="mt-4 text-sm sm:text-base text-slate-500 dark:text-slate-400 font-medium">
            Start with a core product, then add exactly the services you need in the configurator.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 lg:gap-8 items-stretch relative z-10">
          {plans.map((plan) => {
            const isSelected = selectedPlans.includes(plan.name);
            return (
              <article 
                key={plan.name}
                className={`flex flex-col glass-card rounded-[2rem] sm:rounded-[2.5rem] relative cursor-pointer group ${
                  isSelected 
                    ? 'border-murzak-cyan ring-[4px] sm:ring-[8px] ring-murzak-cyan/10 scale-[1.02] z-10 shadow-[0_0_40px_rgba(46,166,255,0.15)]' 
                    : 'hover:border-white/20 hover:-translate-y-1'
                }`}
                onClick={() => setSelectedPlans([plan.name])}
              >
                <div className="h-40 sm:h-44 relative overflow-hidden rounded-t-[2rem] sm:rounded-t-[2.5rem]">
                  <OptimizedImage 
                    src={plan.img} 
                    alt={plan.name} 
                    className="w-full h-full grayscale transition-all duration-1000 group-hover:scale-110 group-hover:grayscale-0"
                    aspectRatio="16/9"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-murzak-navy/90 to-transparent"></div>
                </div>

                <div className="p-6 sm:p-8 flex-grow flex flex-col">
                  <h3 className="text-lg sm:text-xl font-black text-white mb-1 tracking-tight">{plan.name}</h3>
                  <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-murzak-cyan mb-3">{plan.bestFor}</p>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    {plan.pricePrefix && (
                      <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-slate-400">{plan.pricePrefix}</span>
                    )}
                    <div className="text-xl sm:text-2xl font-black text-white">{plan.price}</div>
                    <div className="text-slate-500 text-[7px] sm:text-[8px] font-black uppercase tracking-widest">{plan.period}</div>
                  </div>
                  <p className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 leading-snug mb-4 sm:mb-6">{plan.description}</p>
                  
                  <ul className="space-y-2 sm:space-y-3 mb-6 sm:mb-8 flex-grow">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-slate-300 leading-tight">
                        <Check size={12} className="text-murzak-cyan flex-shrink-0 mt-0.5 w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCtaClick(plan);
                    }}
                    className={`w-full py-4 sm:py-5 lg:py-6 rounded-xl font-black text-[9px] sm:text-[10px] lg:text-[11px] uppercase tracking-[0.15em] sm:tracking-[0.2em] transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 ${
                      isSelected 
                        ? 'bg-murzak-cyan text-murzak-navy shadow-[0_0_20px_rgba(46,166,255,0.3)]' 
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {plan.cta} <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Included in every paid plan */}
      <section className="py-16 sm:py-24 relative z-20">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-4">Included, not extra</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight text-white">
              “Managed” means we actually do the work.
            </h2>
            <p className="mt-5 text-base sm:text-lg text-slate-400 font-medium leading-relaxed">
              Every paid plan comes fully set up and looked after. No hidden setup fees, no “that’s an add-on” surprises for the essentials.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <Server size={20} />, t: 'Setup & configuration', s: 'We provision the server and install, tune and secure your apps for you.' },
              { icon: <RefreshCw size={20} />, t: 'Data migration', s: 'Moving from spreadsheets or another host? We bring your data across.' },
              { icon: <HardDrive size={20} />, t: 'Daily backups', s: 'Automatic daily backups so a bad day never becomes a lost week.' },
              { icon: <Lock size={20} />, t: 'SSL & security', s: 'Free SSL, firewall rules and security patching kept up to date.' },
              { icon: <Smartphone size={20} />, t: 'M-Pesa & KES billing', s: 'Pay in shillings by M-Pesa STK push or card. No forex math.' },
              { icon: <Headphones size={20} />, t: 'Nairobi support', s: 'Real people in your time zone, usually replying the same business day.' },
            ].map((c) => (
              <div key={c.t} className="glass-panel rounded-3xl p-7 hover:-translate-y-1 transition-transform">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5 shadow-[0_0_15px_rgba(46,166,255,0.15)]">{c.icon}</div>
                <h3 className="text-lg font-black text-white mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Managed vs DIY comparison */}
      <section className="py-16 sm:py-24 bg-white dark:bg-transparent relative z-20">
        <ManagedComparison />
      </section>

      {/* How billing & add-ons work */}
      <section className="py-16 sm:py-24 relative z-20">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-4">No surprises</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight text-white">
              How billing actually works.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { n: '01', icon: <SlidersHorizontal size={20} />, t: 'Pick your services', s: 'Use the configurator to choose exactly what you need. The total adds up in shillings as you go.' },
              { n: '02', icon: <Sparkles size={20} />, t: 'See the total in shillings', s: 'Every service shows its price as you add it and the total updates live — what the configurator shows is exactly what you pay at checkout.' },
              { n: '03', icon: <ArrowRight size={20} />, t: 'Add or upgrade anytime', s: 'Need more later? Add services from your portal as a clearly-priced add-on. Outgrow the plan and we migrate you with no downtime.' },
            ].map((step) => (
              <div key={step.n} className="glass-panel relative rounded-3xl p-7 lg:p-8 hover:-translate-y-1 transition-transform">
                <span className="absolute top-6 right-6 font-mono text-[11px] font-black text-slate-300 dark:text-white/15">{step.n}</span>
                <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5 shadow-[0_0_15px_rgba(46,166,255,0.15)]">{step.icon}</div>
                <h3 className="text-lg font-black text-white mb-2">{step.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{step.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24 bg-murzak-surface/30 border-y border-white/5 relative z-20">
        <Faq items={faqItems} />
      </section>

      {/* Final CTA */}
      <section className="relative py-20 sm:py-28 overflow-hidden z-20">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-white/10" />
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-white">Still weighing it up?</h2>
          <p className="mt-4 text-base sm:text-lg text-white/85 font-medium">
            Take it for a spin with a free 36-hour trial, or let us recommend the right plan in a minute.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="onDark" onClick={() => onNavigate('test-request')}>
              Start free trial <ArrowRight size={17} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => setAdvisorOpen(true)}>
              <Wand2 size={16} /> Help me choose
            </Button>
          </div>
        </div>
      </section>

      <SalesModal
        isOpen={salesOpen}
        onClose={() => setSalesOpen(false)}
        initialMode={salesInitialMode}
      />
      <PlanAdvisor
        isOpen={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        onChoosePlan={handleAdvisorChoose}
        onTalkToSales={() => {
          setSalesInitialMode("quote");
          setSalesOpen(true);
        }}
      />
      <PlanServicesModal
        isOpen={servicesOpen}
        planCode={servicesPlanCode}
        planLabel={servicesPlanLabel}
        preselectServiceIds={preselectIds}
        onClose={() => setServicesOpen(false)}
        onProceedLogin={async () => {
          if (!isLoggedIn) {
            setServicesOpen(false);
            onNavigate("login");
            return;
          }

          // User is already logged in, so we attach the selection directly
          const pendingRaw = localStorage.getItem("murzak_plan_selection_pending");
          if (!pendingRaw) return;
          const pending = JSON.parse(pendingRaw);

          try {
            const res = await fetch("/api/plan/attach-selection", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                planKey: pending.plan || "None",
                selectedServices: pending.selectedServices || [],
                upgradeIntent: !!pending.upgradeIntent,
                upgradeMode: pending.upgradeMode || "",
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data?.message || data?.error || "Failed to attach selection.");
            }
            if (data?.user && onUserUpdate) onUserUpdate(data.user);
            localStorage.removeItem("murzak_plan_selection_pending");
            setServicesOpen(false);
            
            // If the backend generated an invoice for checkout, navigate to payment
            if (data.invoiceId) {
              onNavigate(`/payment/${data.invoiceId}`);
            } else {
              onNavigate("/portal/billing");
            }
          } catch (e: any) {
            console.error("Failed to attach selection directly:", e);
            alert(e.message || "Failed to attach selection.");
          }
        }}
        onProceedPortal={() => {
          setServicesOpen(false);
          onNavigate("/portal");
        }}
        onProceedEnterpriseQuote={() => {
          // Over-capacity self-serve build → dedicated capacity conversation.
          setServicesOpen(false);
          setSalesInitialMode("quote");
          setSalesOpen(true);
        }}
      />
    </div>
  );
};

export default Pricing;
