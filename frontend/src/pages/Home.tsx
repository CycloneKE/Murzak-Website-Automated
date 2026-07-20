
import React, { useEffect, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Server, Boxes, Code2, Check, ShieldCheck,
  Smartphone, Headphones, Clock, Database, Mail, ShoppingCart, Wand2,
  Rocket, MessageSquare, Settings, LifeBuoy, X, Star,
} from 'lucide-react';
import { Page } from '../types';
import Faq, { type FaqItem } from '../components/Faq';
import { PLAN_META, formatKes, serviceMonthlyKes } from '../config/serviceCatalog';
import { Button } from '../components/ui/Button';

interface HomeProps {
  onNavigate: (page: Page) => void;
  isLoading?: boolean;
}

type Testimonial = { quote: string; name: string; org: string };
// Real, attributable client quotes only — section auto-hides while empty.
const TESTIMONIALS: Testimonial[] = [];

/* ---------- Hero product peek: the live configurator, ticking ----------
   Prices are pulled from the catalog (single source of truth) so this hero
   can never contradict the real configurator/pricing. */
const PEEK_ITEMS = [
  { name: 'Website Hosting', kes: serviceMonthlyKes('starter-web-hosting') ?? 0 },
  { name: 'Business Email', kes: serviceMonthlyKes('starter-email') ?? 0 },
  { name: 'Murzak ERP', kes: serviceMonthlyKes('biz-erp-light') ?? 0 },
];

function ConfigPeek() {
  const [count, setCount] = useState(1);
  const [total, setTotal] = useState(PEEK_ITEMS[0].kes);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => (c >= PEEK_ITEMS.length ? 1 : c + 1));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const target = PEEK_ITEMS.slice(0, count).reduce((s, i) => s + i.kes, 0);
    let raf = 0;
    const start = performance.now();
    const from = total;
    const step = (t: number) => {
      const p = Math.min((t - start) / 400, 1);
      setTotal(Math.round(from + (target - from) * p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <div className="relative rounded-3xl glass-dark p-5 sm:p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-micro uppercase text-slate-400">your plan</span>
        <span className="flex items-center gap-1.5 font-mono text-micro uppercase text-murzak-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-murzak-accent animate-pulse" /> live
        </span>
      </div>
      <ul className="space-y-2.5">
        {PEEK_ITEMS.map((item, i) => {
          const on = i < count;
          return (
            <li
              key={item.name}
              className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all duration-500 ${
                on ? 'border-murzak-accent/30 bg-murzak-accent/10 opacity-100' : 'glass-dark opacity-40'
              }`}
            >
              <span className="flex items-center gap-2 text-[13px] font-bold text-white">
                <Check size={14} className={on ? 'text-murzak-accent' : 'text-slate-600'} /> {item.name}
              </span>
              <span className="font-mono text-[12px] text-slate-300">KES {item.kes.toLocaleString()}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 pt-4 border-t border-white/10 flex items-end justify-between">
        <span className="text-label font-bold text-slate-400">Monthly</span>
        <span className="text-2xl font-black text-murzak-gradient tabular-nums">KES {total.toLocaleString()}</span>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */
const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const faqItems: FaqItem[] = [
    { q: "How do I pay — and in what currency?", a: "Everything is billed in Kenyan Shillings. Pay by M-Pesa STK push or card from your dashboard. No converting from dollars." },
    { q: "How fast can I start?", a: "Most websites and standard apps go live the same day. Configured ERP with data migration is scoped during onboarding and usually takes a few days." },
    { q: "What does 'managed' actually mean?", a: "We set up the server, install and tune your apps, handle SSL, run daily backups, patch security, and pick up the phone when you need us. You just use it." },
    { q: "Can I start small and grow?", a: "Yes. Add services anytime — you only pay for what you use. When you outgrow shared hosting, we move you to dedicated capacity with no downtime." },
    { q: "Is my data backed up and safe?", a: "Daily backups, SSL and security hardening are standard on paid plans. Disaster-recovery options are available when you need them." },
  ];

  const pillars = [
    {
      icon: <Server size={22} />,
      title: 'Murzak Cloud',
      tag: 'Hosting that just stays up',
      desc: 'Websites, email and databases — set up, secured and backed up for you.',
      page: 'cloud' as Page,
      cta: 'Explore Cloud',
      span: 'lg:col-span-2',
    },
    {
      icon: <Boxes size={22} />,
      title: 'Business systems',
      tag: 'The tools to run things',
      desc: 'ERP, POS, CRM and accounting, configured to fit how you actually work.',
      page: 'products' as Page,
      cta: 'See Products',
      span: '',
    },
    {
      icon: <Code2 size={22} />,
      title: 'Custom software',
      tag: "When off-the-shelf won't cut it",
      desc: 'We design and build the exact system your business needs — and keep it running.',
      page: 'products' as Page,
      cta: 'Start a build',
      span: '',
    },
  ];

  return (
    <main className="text-white overflow-x-hidden">
      {/* 01 · HERO */}
      <section className="relative min-h-[90vh] flex items-center pt-24 lg:pt-36 pb-20 overflow-hidden -mt-16 sm:-mt-20 lg:-mt-24">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/server-man.webp')" }} />
        {/* Dark overlay to ensure white text is perfectly legible against the background image */}
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-murzak-ink/95 via-murzak-ink/60 to-transparent sm:via-murzak-ink/75" />
        {/* ambient */}
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '32px 32px' }} />
          <div className="absolute -top-40 right-[-10%] w-[680px] h-[680px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow" />
        </div>

        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 w-full grid lg:grid-cols-12 gap-12 items-center relative z-10">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 mb-7">
              <span className="h-1.5 w-1.5 rounded-full bg-murzak-accent animate-pulse" />
              <span className="font-mono text-micro uppercase text-slate-300">Nairobi · systems operational</span>
            </div>

            <h1 className="text-[clamp(2.6rem,7vw,5.5rem)] font-[900] tracking-[-0.03em] leading-[0.95]">
              Run your business.<br />
              <span className="text-murzak-gradient">We'll run the tech.</span>
            </h1>

            <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-xl leading-relaxed">
              Managed hosting, ready-to-use business systems and custom software — set up for you,
              billed in shillings, and supported by real people in Nairobi.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-4">
              <Button onClick={() => onNavigate('pricing')}>
                Build my plan <ArrowRight size={18} />
              </Button>
              <Button variant="outlineOnDark" onClick={() => scrollTo('what-we-do')}>
                See what we do
              </Button>
            </div>

            <p className="mt-5 font-mono text-label uppercase tracking-widest text-slate-400">
              No card required to start · Live in a day
            </p>
          </div>

          <div className="lg:col-span-5">
            <ConfigPeek />
          </div>
        </div>
      </section>

      {/* GLOBAL BACKGROUND WRAPPER — one shared background image behind every
          section below the hero, instead of a different image per section. */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-30" style={{ backgroundImage: "url('/images/home-section-bg.webp')" }} />
        <div className="absolute inset-0 z-0 bg-murzak-ink/80" />
        <div className="absolute inset-0 z-0 bg-murzak-accent/5 mix-blend-color" />


      {/* 02 · TRUST STRIP + STATS (merged — one compact band instead of two) */}
      <section className="glass-dark">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 py-8 flex flex-col lg:flex-row items-center justify-between gap-8">
          <p className="font-mono text-micro uppercase text-slate-400 max-w-xs text-center lg:text-left">
            Trusted by teams who'd rather be doing their actual job
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {['Retail & POS', 'Logistics', 'Clinics', 'Manufacturing', 'Professional services'].map((t) => (
              <span key={t} className="font-black uppercase tracking-tight text-white/50 text-sm">{t}</span>
            ))}
          </div>
          <div className="flex gap-5 sm:gap-8">
            {[
              { big: '99.9%', label: 'Uptime' },
              { big: '< 1 day', label: 'Go-live' },
              { big: '24/7', label: 'Monitoring' },
              { big: 'KES', label: 'Billing' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-lg font-black text-murzak-accent">{s.big}</div>
                <div className="font-mono text-micro uppercase text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 03 · EMPATHY */}
      <section className="py-24 lg:py-36">
        <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-6xl font-[900] tracking-tight leading-[1.05]">
            You didn't start your business<br className="hidden sm:block" /> to babysit servers.
          </h2>
          <p className="mt-8 text-lg sm:text-xl text-slate-400 font-medium leading-relaxed">
            Sites that go down on a Friday night. An ERP demo from a vendor who then vanished.
            Invoices in dollars you have to convert. Support answered three time zones away, next week.
          </p>
          <p className="mt-6 text-lg sm:text-xl font-black text-white">
            That's the part we take off your plate — <span className="text-murzak-gradient">and keep off it.</span>
          </p>
          <p className="mt-6 font-mono text-label uppercase tracking-widest text-slate-600 dark:text-slate-400">
            A day of downtime during month-end can cost more than a year of hosting.
          </p>
        </div>
      </section>

      {/* 04 · WHAT WE DO (bento) */}
      <section id="what-we-do" className="py-20 lg:py-28 border-t border-white/5">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">What we do</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">
              Three ways we keep your business running.
            </h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {pillars.map((p) => (
              <button
                key={p.title}
                onClick={() => onNavigate(p.page)}
                className={`group text-left rounded-3xl glass-dark p-8 lg:p-10 transition-all hover:border-murzak-accent/40 hover:bg-white/[0.05] ${p.span}`}
              >
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-6">{p.icon}</div>
                <p className="font-mono text-micro uppercase text-slate-400 mb-2">{p.tag}</p>
                <h3 className="text-2xl font-black text-white mb-3">{p.title}</h3>
                <p className="text-slate-400 font-medium leading-relaxed mb-6 max-w-md">{p.desc}</p>
                <span className="inline-flex items-center gap-2 font-black text-label uppercase tracking-widest text-murzak-accent group-hover:gap-3 transition-all">
                  {p.cta} <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 05 · CONFIGURATOR TEASER */}
      <section className="py-20 lg:py-28">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">No hidden pricing</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight leading-tight">
              See the price before<br /> you talk to anyone.
            </h2>
            <p className="mt-6 text-lg text-slate-400 font-medium leading-relaxed max-w-md">
              Pick what you need, watch the cost add up in shillings, and start. No "contact us for pricing," no surprises on the invoice.
            </p>
            <Button className="mt-8" onClick={() => onNavigate('pricing')}>
              Build my plan <ArrowRight size={18} />
            </Button>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-brand-gradient opacity-10 blur-2xl" />
            <div className="relative"><ConfigPeek /></div>
          </div>
        </div>
      </section>

      {/* 05b · HOW IT WORKS */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">How it works</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">From "we need this" to live — in four steps.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { n: '01', icon: <MessageSquare size={20} />, t: 'Tell us what you need', s: 'Build a plan in the configurator, or just describe the problem. No jargon required.' },
              { n: '02', icon: <Settings size={20} />, t: 'We set it up & migrate', s: 'We provision the server, install and tune your apps, move your data and lock down security.' },
              { n: '03', icon: <Rocket size={20} />, t: 'Go live', s: 'Most websites and standard apps are live the same day. ERP with migration takes a few days.' },
              { n: '04', icon: <LifeBuoy size={20} />, t: 'We keep it running', s: 'Daily backups, security patching, monitoring and same-day support — for as long as you’re with us.' },
            ].map((step) => (
              <div key={step.n} className="relative rounded-3xl glass-dark p-7 lg:p-8">
                <span className="absolute top-6 right-6 font-mono text-label font-black text-white/15">{step.n}</span>
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{step.icon}</div>
                <h3 className="text-lg font-black text-white mb-2">{step.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{step.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 06 · PRODUCTS */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Products</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">Buy what's ready. Build what isn't.</h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* ready-made */}
            <div className="rounded-3xl glass-dark p-8 lg:p-10">
              <p className="font-mono text-micro uppercase text-slate-400 mb-5">Ready in days</p>
              <div className="space-y-3">
                {[
                  { icon: <Boxes size={16} />, t: 'Murzak ERP', s: 'Inventory, accounting, HR — configured for KE' },
                  { icon: <ShoppingCart size={16} />, t: 'POS & Inventory', s: 'Sell, track stock, see reports' },
                  { icon: <Database size={16} />, t: 'CRM & Helpdesk', s: 'Pipeline, tickets, follow-ups' },
                  { icon: <Mail size={16} />, t: 'Business Email', s: 'Your-name@your-domain, managed' },
                ].map((r) => (
                  <div key={r.t} className="flex items-center gap-4 rounded-2xl glass-dark px-4 py-3.5">
                    <span className="text-murzak-accent">{r.icon}</span>
                    <div>
                      <div className="text-sm font-black text-white">{r.t}</div>
                      <div className="text-[12px] font-medium text-slate-400">{r.s}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => onNavigate('products')} className="mt-6 inline-flex items-center gap-2 font-black text-label uppercase tracking-widest text-murzak-accent hover:gap-3 transition-all">
                Browse products <ArrowUpRight size={15} />
              </button>
            </div>

            {/* bespoke — spec-editor styling */}
            <div className="rounded-3xl border border-white/10 bg-[#0a0f24] p-8 lg:p-10 font-mono">
              <p className="text-micro uppercase text-slate-600 dark:text-slate-400 mb-5">// bespoke build</p>
              <div className="space-y-2 text-[13px] leading-relaxed">
                <p className="text-slate-500">01 <span className="text-slate-300">problem</span> <span className="text-murzak-accent">"dispatch is run on WhatsApp"</span></p>
                <p className="text-slate-500">02 <span className="text-slate-300">we_build</span> <span className="text-white">delivery + tracking system</span></p>
                <p className="text-slate-500">03 <span className="text-slate-300">integrate</span> <span className="text-white">M-Pesa, your stock, your team</span></p>
                <p className="text-slate-500">04 <span className="text-slate-300">we_run_it</span> <span className="text-murzak-accent">forever()</span></p>
              </div>
              <p className="mt-6 font-sans text-slate-400 text-sm font-medium leading-relaxed">
                A customer portal, an M-Pesa integration, a system no one else sells — designed and built around your workflow.
              </p>
              <button onClick={() => onNavigate('products')} className="mt-6 inline-flex items-center gap-2 font-sans font-black text-label uppercase tracking-widest text-murzak-accent hover:gap-3 transition-all">
                Start a build <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 07 · LOCAL EDGE */}
      <section className="py-20 lg:py-28">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Why Murzak</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">Built for how Kenya actually does business.</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: <Smartphone size={22} />, t: 'Pay by M-Pesa', s: 'STK push straight to your phone. No card needed.' },
              { icon: <ShieldCheck size={22} />, t: 'Billed in shillings', s: 'What you see is what you pay. No forex games.' },
              { icon: <Headphones size={22} />, t: 'Support in your time zone', s: 'Real people in Nairobi, answering the same day.' },
            ].map((c) => (
              <div key={c.t} className="rounded-3xl glass-dark p-8">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                <h3 className="text-xl font-black text-white mb-2">{c.t}</h3>
                <p className="text-slate-400 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 07b · WHY SWITCH (comparison) */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-14">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Why businesses switch</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">The usual way vs. the Murzak way.</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            {/* the usual way */}
            <div className="rounded-3xl glass-dark p-8 lg:p-10">
              <p className="font-mono text-micro uppercase text-slate-600 dark:text-slate-400 mb-6">The usual way</p>
              <ul className="space-y-4">
                {[
                  'Invoiced in dollars — you do the forex math',
                  'Support three time zones away, answered next week',
                  'You patch it, back it up, and hope',
                  '“Contact us for pricing,” then a slow quote',
                  'A vendor sets it up, then disappears',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-slate-400 font-medium text-[15px] leading-snug">
                    <span className="mt-0.5 text-slate-600 dark:text-slate-400"><X size={17} /></span> {t}
                  </li>
                ))}
              </ul>
            </div>
            {/* the murzak way */}
            <div className="relative rounded-3xl border border-murzak-accent/30 bg-murzak-accent/[0.06] p-8 lg:p-10 overflow-hidden">
              <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full blur-[100px] bg-brand-gradient opacity-20" />
              <p className="font-mono text-micro uppercase text-murzak-accent mb-6 relative">The Murzak way</p>
              <ul className="space-y-4 relative">
                {[
                  'Billed in shillings — pay by M-Pesa or card',
                  'Real people in Nairobi, replying the same day',
                  'Daily backups & security hardening, handled for you',
                  'See the price before you talk to anyone',
                  'We set it up and stay accountable for keeping it up',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-white font-bold text-[15px] leading-snug">
                    <span className="mt-0.5 text-murzak-accent"><Check size={17} /></span> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 07c · PRICING PREVIEW */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-14">
            <div className="max-w-2xl">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Plans at a glance</p>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] tracking-tight">Start free. Scale when you’re ready.</h2>
            </div>
            <button
              onClick={() => onNavigate('pricing')}
              className="shrink-0 inline-flex items-center gap-2 font-black text-label uppercase tracking-widest text-murzak-accent hover:gap-3 transition-all"
            >
              See full pricing <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {Object.values(PLAN_META).map((m) => (
              <button
                key={m.code}
                onClick={() => onNavigate('pricing')}
                className={`text-left rounded-3xl border p-7 transition-all hover:-translate-y-1 ${
                  m.featured
                    ? 'border-murzak-accent/40 bg-murzak-accent/[0.06]'
                    : 'glass-dark hover:border-white/20'
                }`}
              >
                {m.featured && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-murzak-accent/15 text-murzak-accent px-2.5 py-1 font-mono text-micro uppercase mb-4">
                    <Star size={10} /> Most popular
                  </span>
                )}
                <h3 className="text-lg font-black text-white">{m.label}</h3>
                <p className="font-mono text-micro uppercase text-murzak-accent mb-4">{m.bestFor}</p>
                <div className="flex items-baseline gap-1.5 mb-4">
                  {m.startingKes != null && m.startingKes > 0 && (
                    <span className="font-mono text-micro uppercase text-slate-600 dark:text-slate-400">from</span>
                  )}
                  <span className="text-2xl font-[900] text-white tracking-tight">
                    {m.startingKes == null ? 'Custom' : m.startingKes === 0 ? 'Free' : formatKes(m.startingKes)}
                  </span>
                  <span className="font-mono text-micro uppercase text-slate-600 dark:text-slate-400">{m.period}</span>
                </div>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{m.blurb}</p>
                <span className="mt-5 inline-flex items-center gap-2 font-black text-micro uppercase text-murzak-accent">
                  {m.cta} <ArrowRight size={13} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 08 · PROOF (gated) */}
      {TESTIMONIALS.length > 0 && (
        <section className="py-20 lg:py-28 border-t border-white/5">
          <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center">
            <div className="text-5xl text-murzak-gradient font-black mb-6">"</div>
            <blockquote className="text-2xl sm:text-3xl font-black text-white leading-snug">{TESTIMONIALS[0].quote}</blockquote>
            <p className="mt-6 text-sm font-bold text-slate-300">{TESTIMONIALS[0].name}</p>
            <p className="font-mono text-micro uppercase text-slate-600 dark:text-slate-400">{TESTIMONIALS[0].org}</p>
          </div>
        </section>
      )}

      {/* 09 · FAQ */}
      <section className="py-20 lg:py-28 border-t border-white/5">
        <Faq items={faqItems} />
      </section>

      {/* 10 · FINAL CTA */}
      <section className="relative py-24 lg:py-36 overflow-hidden">
        <div className="absolute inset-0 -z-10 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-5xl font-[900] tracking-tight text-white">Let's get your business set up properly.</h2>
          <p className="mt-5 text-lg text-white/85 font-medium">
            Build a plan in two minutes, or talk to someone who'll actually pick up.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="onDark" onClick={() => onNavigate('pricing')}>
              Build my plan <ArrowRight size={18} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => onNavigate('contact')}>
              Talk to us
            </Button>
          </div>
          <p className="mt-6 font-mono text-label uppercase tracking-widest text-white/70">
            Start in a day · No card · Pay by M-Pesa
          </p>
        </div>
      </section>
      </div>
    </main>
  );
};

export default Home;
