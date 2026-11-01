import React, { useState } from 'react';
import { ArrowRight, Globe, ShieldCheck, Check, Server, RefreshCw, Smartphone, Key, Lock, Terminal, HelpCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import Breadcrumbs from '../../components/Breadcrumbs';
import DomainSearch from '../../components/DomainSearch';
import { formatKes, domainCatalogIdForTld } from '../../config/serviceCatalog';
import { toUserMessage } from '../../services/errors';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const CloudDomains: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>(undefined);
  const [domainError, setDomainError] = useState('');
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'register' | 'dns' | 'transfer'>('register');

  const handleSelectDomain = async (domain: string, priceKes: number) => {
    setDomainError('');
    if (!isLoggedIn) {
      onNavigate('/login?returnTo=%2Fcloud%2Fdomains');
      return;
    }
    const tld = domain.slice(domain.indexOf('.'));
    const serviceId = domainCatalogIdForTld(tld);
    if (!serviceId) {
      setDomainError("That domain extension isn't available for purchase yet.");
      return;
    }
    setSelectedDomain(domain);
    setDomainSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serviceId, config: { domain, priceKes }, source: 'cloud-domains-page' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.code === 'CAPACITY') {
        setDomainError("We're at capacity right now. Please try again shortly.");
        return;
      }
      if (!res.ok || !data?.order) {
        setDomainError(toUserMessage(data?.error, 'Failed to start checkout.'));
        return;
      }
      onNavigate(`/checkout/${data.order.id}`);
    } catch {
      setDomainError('Failed to start checkout. Check your connection and try again.');
    } finally {
      setDomainSubmitting(false);
    }
  };

  const guides = [
    {
      step: "01",
      title: "Search & Instant M-Pesa Registration",
      desc: "Check availability for your brand across .co.ke, .com, .ke, or .africa. Pay instantly via Safaricom M-Pesa STK push on your phone with zero credit card requirements.",
      tag: "Registration"
    },
    {
      step: "02",
      title: "1-Click Pointing to Murzak Cloud",
      desc: "If hosting an app or site with us, click 'Attach to Resource'. Our edge routers automatically configure the A and CNAME records and issue Let's Encrypt TLS certificates.",
      tag: "Automated DNS"
    },
    {
      step: "03",
      title: "Connecting External Registrars & Nameservers",
      desc: "Already own a domain at GoDaddy, Namecheap, or Safaricom? Point your nameservers to ns1.murzaktech.com and ns2.murzaktech.com or paste our root A-record in your DNS manager.",
      tag: "External Domains"
    },
    {
      step: "04",
      title: "Setting Up Free Email Routing",
      desc: "Create professional forwarding aliases (e.g. info@yourbrand.co.ke) that route incoming messages directly to your personal Gmail or Outlook inbox at 0 KES.",
      tag: "Email Ingress"
    }
  ];

  const tlds = [
    { tld: ".co.ke", price: "KES 1,200/yr", equiv: "KES 100/mo", target: "Kenyan Businesses", badge: "Most Popular" },
    { tld: ".com", price: "KES 4,200/yr", equiv: "KES 350/mo", target: "Global Commercial", badge: "Automated" },
    { tld: ".ke", price: "KES 1,800/yr", equiv: "KES 150/mo", target: "National Presence", badge: "Direct KeNIC" },
    { tld: ".africa", price: "KES 2,500/yr", equiv: "KES 209/mo", target: "Pan-African Reach", badge: "Continental" },
    { tld: ".io", price: "KES 15,500/yr", equiv: "KES 1,292/mo", target: "Tech Startups & APIs", badge: "Developer" },
  ];

  const faqs: FaqItem[] = [
    { q: "How long does .co.ke domain activation take?", a: "Once payment is confirmed via M-Pesa, the registration request is submitted to the registry. Most domains resolve across global DNS within 5 to 30 minutes." },
    { q: "Is WHOIS privacy included?", a: "Yes. All eligible TLDs include standard WHOIS privacy protection so your personal phone number and home address remain masked from public spam databases." },
    { q: "Can I use my Murzak domain with external hosting (like Vercel or AWS)?", a: "Yes. You have full DNS record management inside the Murzak Client Portal. You can freely edit A, CNAME, MX, TXT, and SRV records." },
    { q: "Will my renewal price spike in year two?", a: "No. Unlike registrars that offer $0.99 introductory gimmicks and then bill $25 on renewal, our prices are flat and transparent year over year." },
    { q: "How does the 'Free Domain with Cloud Hosting' promotion work?", a: "When you purchase an annual Website Hosting or App Hosting plan on Murzak Cloud, your 1st-year .co.ke or .com domain registration fee is 100% waived." }
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <Breadcrumbs
            onNavigate={onNavigate}
            items={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Domains & DNS' }]}
          />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-micro font-black uppercase text-emerald-700 dark:text-emerald-400">
              Cloud Ingress · Instant M-Pesa Activation
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,6vw,4.6rem)] font-[900] tracking-[-0.03em] leading-[1.02] max-w-3xl">
            Claim your address. <span className="text-murzak-gradient">Deploy the cloud in seconds.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-relaxed">
            Register `.co.ke`, `.com`, `.ke`, or `.africa` with instant M-Pesa STK push. Auto-provisioning Let's Encrypt TLS certificates and 1-click cloud container attachment.
          </p>

          {/* Promotional Banner */}
          <div className="mt-8 p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-sky-500/10 border border-sky-500/20 max-w-2xl flex items-center justify-between gap-4">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
              🎁 <strong>Hosting Offer:</strong> Get 1 year <strong className="text-emerald-600">FREE domain registration</strong> on any annual Murzak Cloud plan.
            </div>
            <Button size="sm" onClick={() => onNavigate('/cloud')}>
              View Plans →
            </Button>
          </div>

          {/* Interactive Search Component */}
          <div className="mt-8 max-w-2xl rounded-3xl border border-murzak-border bg-white/70 dark:bg-white/5 backdrop-blur-md p-6 sm:p-8 shadow-xl">
            <h2 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">Check Domain Availability</h2>
            <DomainSearch selectedDomain={selectedDomain} onSelect={handleSelectDomain} />
            {domainSubmitting && (
              <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">Starting checkout…</p>
            )}
            {domainError && (
              <p className="mt-3 text-sm font-bold text-red-500">{domainError}</p>
            )}
          </div>
        </div>
      </section>

      {/* TLD CATALOG TABLE */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-10">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">TLD Extensions</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">Transparent pricing with zero renewal spikes.</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {tlds.map((t) => (
              <div key={t.tld} className="p-6 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-2xl font-[900] text-murzak-ink dark:text-slate-100">{t.tld}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-murzak-accent/10 text-sky-700 dark:text-murzak-accent">
                      {t.badge}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-4">{t.target}</p>
                </div>
                <div className="pt-4 border-t border-murzak-border/50 flex items-center justify-between">
                  <div>
                    <span className="block font-black text-base text-murzak-ink dark:text-slate-100">{t.price}</span>
                    <span className="block font-mono text-[11px] text-slate-500">{t.equiv}</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Live Check ↑</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SETUP GUIDES & STEP-BY-STEP WALKTHROUGH */}
      <Section className="relative z-10 border-t border-murzak-border/50 bg-slate-50/50 dark:bg-black/20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">Setup Guides & Documentation</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">How to configure your domain for production.</h2>
            <p className="mt-3 text-slate-600 dark:text-slate-400 text-sm font-medium">
              Step-by-step guides for instant registration, DNS routing, and attaching external domains.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((g) => (
              <div key={g.step} className="p-8 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-xl font-[900] text-murzak-accent">{g.step}</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                    {g.tag}
                  </span>
                </div>
                <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{g.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{g.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* FAQS */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[900px] mx-auto px-6 sm:px-10">
          <Faq items={faqs} title="Domain & DNS Questions" subtitle="Common answers regarding KeNIC registration, M-Pesa payments, and renewals." />
        </div>
      </Section>

      {/* BOTTOM CTA */}
      <section className="relative py-20 overflow-hidden border-t border-murzak-border/50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Ready to register your domain?</h2>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-8">Search your name above or attach your existing domain to Murzak Cloud.</p>
          <Button variant="primary" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            Search Now <ArrowRight size={17} />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default CloudDomains;
