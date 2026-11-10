
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
import { Page, User } from '../types';
import { SkeletonHero, SkeletonGrid } from '../components/Skeleton';
import OptimizedImage from '../components/OptimizedImage';
import { useLocation, useNavigate } from "react-router-dom";
import SalesModal from "../components/SalesModal";
import PlanServicesModal from "../components/PlanServicesModal";
import ManagedComparison from "../components/ManagedComparison";
import Faq, { type FaqItem } from "../components/Faq";
import PlanAdvisor from "../components/PlanAdvisor";
import { ANNUAL_DISCOUNT_PCT, PLAN_META, getService, planForService, type PlanCode } from "../config/serviceCatalog";
import { BUSINESS_OFFERS, CLOUD_OFFERS, offerPrice, offerPriceLabel, offerSetupLabel } from "../config/storefront";
import { APP_CHECKOUT } from "../config/appCheckout";
import { Button } from "../components/ui/Button";
import { PageHero, PageMain } from "../components/ui/Page";
import { toSafeJsonLdString } from "../utils/jsonLd";
import { toUserMessage } from "../services/errors";

interface PricingProps {
  onNavigate: (page: Page | string) => void;
  onSelectPlan?: (plan: string, returnTo?: string) => void;
  isLoading?: boolean;
  isLoggedIn?: boolean;
  user?: User | null;
  onUserUpdate?: (user: User) => void;
}

const Pricing: React.FC<PricingProps> = ({ onNavigate, onSelectPlan, isLoading, isLoggedIn, user, onUserUpdate }) => {
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
    // App tiers are sold on their own page, not in the configurator.
    const appTier = getService(productId);
    if (appTier?.app) {
      navigate(`${APP_CHECKOUT[appTier.app].productPath}#plans`, { replace: true });
      return;
    }
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

  // The page is a price list, grouped the way people shop. Prices are read
  // from the catalog through config/storefront, so they match checkout.
  const priceGroups = [
    { id: "prices-business", title: "Business systems", blurb: "Ready-made software to run the business, hosted and looked after for you.", offers: BUSINESS_OFFERS, planCode: "Business" as PlanCode },
    { id: "prices-cloud", title: "Hosting & cloud", blurb: "Somewhere to put a website, an app, a database or a domain.", offers: CLOUD_OFFERS.filter((o) => o.key !== "email"), planCode: "Starter" as PlanCode },
  ];

  const faqItems: FaqItem[] = [
    { q: "How do I pay, and in what currency?", a: "Everything is billed in Kenyan shillings. Pay by M-Pesa or card at checkout, and for renewals from your portal." },
    { q: "Can I use my own domain or register a new one?", a: "Both. Point an existing domain to us, use a free Murzak subdomain to start, or register a new one from the Domains page. We handle the setup." },
    { q: "Can I buy more than one product?", a: "Yes. Each product is priced separately and they add up on one invoice. Some go together at checkout, such as app hosting with a database, or a business system with a domain." },
    { q: "Can I add more later?", a: "Yes. Add products from your portal whenever you need them, at the prices on this page." },
    { q: "What if I outgrow what I bought?", a: "Larger systems move to dedicated capacity. We size it, quote it and move you across." },
    { q: "How fast is setup?", a: "Most websites and standard apps go live the same day. Configured Murzak ERP with data migration is scoped during onboarding and typically takes a few days." },
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

// Advisor recommended a plan — open the configurator with services pre-selected.
const handleAdvisorChoose = (planCode: PlanCode, serviceIds: string[], productPath?: string) => {
  // App recommendations (e.g. POS) are sold through their own product page, not the configurator.
  if (productPath) {
    navigate(productPath);
    return;
  }
  setPreselectIds(serviceIds);
  setServicesPlanCode(planCode);
  setServicesPlanLabel(PLAN_META[planCode].label);
  setServicesOpen(true);
};

  const pricingJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: priceGroups.flatMap((g) => g.offers).map((offer, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: offer.name,
        description: offer.what,
        offers: {
          "@type": "Offer",
          price: offerPrice(offer) ? String(offerPrice(offer)!.kes) : undefined,
          priceCurrency: "KES",
          url: `${window.location.origin}${offer.path}`,
        },
      },
    })),
  };
  const pricingJsonLdString = toSafeJsonLdString(pricingJsonLd);

  return (
    <PageMain theme="pricing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: pricingJsonLdString }} />

      <PageHero
        onNavigate={onNavigate as (page: string) => void}
        label="Pricing"
        title="Prices"
        lead="Every product has its own monthly price in shillings. Buy one, or several; you only pay for what you pick. There are no tiers to unlock and no quote to wait for."
      >
        <Button onClick={() => document.getElementById('prices-business')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Business systems <ArrowRight size={16} />
        </Button>
        <Button variant="outline" onClick={() => document.getElementById('prices-cloud')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Hosting &amp; cloud
        </Button>
        <Button variant="outline" onClick={() => setAdvisorOpen(true)}>
          <Wand2 size={16} /> Not sure? Help me choose
        </Button>
      </PageHero>

      {/* Price list. id="pricing-plans" is kept: other pages deep-link to it. */}
      <section id="pricing-plans" ref={gridRef} className="scroll-mt-28 max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 pt-12 sm:pt-16 pb-16 sm:pb-20 space-y-12">
        {priceGroups.map((group) => (
          <div key={group.id} id={group.id} className="scroll-mt-28">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-murzak-ink dark:text-slate-100">{group.title}</h2>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{group.blurb}</p>
              </div>
              {/* The multi-item builder: tick several, see one total, check out once. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPreselectIds([]);
                  setServicesPlanCode(group.planCode);
                  setServicesPlanLabel(group.title);
                  setServicesOpen(true);
                }}
              >
                <SlidersHorizontal size={14} /> Buy several together
              </Button>
            </div>
            <ul className="mt-5 rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5 divide-y divide-murzak-border dark:divide-white/10">
              {group.offers.map((o) => {
                const setup = offerSetupLabel(o);
                return (
                  <li key={o.key} data-testid={`price-row-${o.key}`} className="grid sm:grid-cols-12 gap-x-6 gap-y-2 items-center px-5 sm:px-6 py-5">
                    <div className="sm:col-span-6">
                      <h3 className="font-extrabold text-murzak-ink dark:text-slate-100">{o.name}</h3>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{o.what}</p>
                    </div>
                    <div className="sm:col-span-3">
                      <p className="font-extrabold tabular-nums text-murzak-ink dark:text-slate-100">{offerPriceLabel(o)}</p>
                      {setup && <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{setup}</p>}
                    </div>
                    <div className="sm:col-span-3 sm:text-right">
                      <Button size="sm" variant="outline" onClick={() => onNavigate(o.path)}>
                        See options <ArrowRight size={14} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* The two things that are not a monthly price. */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5 p-6">
            <h2 className="font-extrabold text-murzak-ink dark:text-slate-100">Want to try before paying?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Ask for a free 36-hour trial environment. No card needed.
            </p>
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={() => onNavigate('test-request')}>Request a trial</Button>
            </div>
          </div>
          <div className="rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5 p-6">
            <h2 className="font-extrabold text-murzak-ink dark:text-slate-100">Running something large?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Many branches, heavy databases or a dedicated server are quoted individually.
            </p>
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={() => { setSalesInitialMode('quote'); setSalesOpen(true); }}>Get a quote</Button>
            </div>
          </div>
        </div>
      </section>

      {/* What the price covers */}
      <section className="border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-murzak-ink dark:text-slate-100">What the price covers</h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
            {[
              { icon: <Server size={18} />, t: 'Setup', s: 'We install and configure it. Where a one-time setup fee applies, it is shown next to the price.' },
              { icon: <Lock size={18} />, t: 'Security certificate', s: 'Your site or app is served over HTTPS at no extra cost.' },
              { icon: <Smartphone size={18} />, t: 'Paying in shillings', s: 'M-Pesa or card. The amount on this page is the amount on the invoice.' },
              { icon: <Headphones size={18} />, t: 'Support', s: 'Help from people in Nairobi when something needs attention.' },
            ].map((c) => (
              <div key={c.t}>
                <span className="text-slate-500 dark:text-slate-400">{c.icon}</span>
                <h3 className="mt-2 font-extrabold text-murzak-ink dark:text-slate-100">{c.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{c.s}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-slate-600 dark:text-slate-400">
            Paying for a year up front takes {ANNUAL_DISCOUNT_PCT}% off monthly items. You choose monthly or yearly at checkout.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-14 sm:py-20 border-t border-murzak-border dark:border-white/10">
        <Faq items={faqItems} title="Questions about pricing" eyebrow="Before you buy" />
      </section>

      {/* Closing */}
      <section className="border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-murzak-ink dark:text-slate-100">Not sure what to buy?</h2>
            <p className="mt-2 max-w-xl text-slate-600 dark:text-slate-400">
              Answer a few questions and we will suggest what fits, or talk it through with us.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button variant="primary" onClick={() => setAdvisorOpen(true)}>
              <Wand2 size={16} /> Help me choose
            </Button>
            <Button variant="outline" onClick={() => onNavigate('contact')}>
              Talk to us
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
            alert(toUserMessage(e, "Failed to attach selection."));
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
    </PageMain>
  );
};

export default Pricing;
