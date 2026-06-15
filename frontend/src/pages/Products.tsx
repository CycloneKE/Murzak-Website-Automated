
import React from 'react';
import {
  ArrowRight, ArrowUpRight, Boxes, ShoppingCart, Database, Mail, Globe, HardDrive,
  Search, PenTool, Rocket, LifeBuoy, ShieldCheck, Lock, Zap, Headphones, Check,
  Code2, Truck, CalendarCheck, LayoutDashboard, Smartphone, PlugZap,
  SlidersHorizontal, FileSignature, CreditCard, Wand2,
  ServerCrash, Table2, UserX, Coins, Network,
} from 'lucide-react';
import { Page } from '../types';
import DomainSearch from '../components/DomainSearch';
import { TLD_OPTIONS } from '../services/domains';
import { formatKes, serviceMonthlyKes, serviceSetupKes } from '../config/serviceCatalog';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import SalesModal from '../components/SalesModal';

interface Props {
  onNavigate: (page: Page) => void;
  isLoading?: boolean;
}

// Straightforward, self-serve-priced extras. Prices are pulled from the catalog
// (single source of truth) by service id so they can never drift from checkout.
// WHOIS privacy has no catalog SKU yet, so its price stays an explicit literal.
const SIMPLE_ADDONS = [
  { icon: <Mail size={16} />, t: 'Business Email', s: 'Branded mailbox on your domain', price: formatKes(serviceMonthlyKes('starter-email')), unit: '/mo · 5 inboxes' },
  { icon: <ShieldCheck size={16} />, t: 'Premium SSL', s: 'Wildcard / EV certificate', price: formatKes(serviceMonthlyKes('addon-ssl-premium')), unit: '/mo' },
  { icon: <Lock size={16} />, t: 'WHOIS Privacy', s: 'Hide your details from spammers', price: 'KES 1,000', unit: '/yr' },
  { icon: <HardDrive size={16} />, t: 'Daily Backups +', s: 'Hourly backups, 30-day history', price: formatKes(serviceMonthlyKes('addon-backup-plus')), unit: '/mo' },
  { icon: <Zap size={16} />, t: 'Global CDN', s: 'Faster loads worldwide', price: formatKes(serviceMonthlyKes('addon-cdn')), unit: '/mo' },
  { icon: <Lock size={16} />, t: 'Web Firewall (WAF)', s: 'Block attacks & bad bots', price: formatKes(serviceMonthlyKes('addon-waf')), unit: '/mo' },
  { icon: <Globe size={16} />, t: 'Website Migration', s: 'We move your site in, zero downtime', price: formatKes(serviceSetupKes('addon-migration')), unit: 'one-off' },
  { icon: <Headphones size={16} />, t: 'Priority Support', s: '4-hour first response', price: formatKes(serviceMonthlyKes('addon-priority-support')), unit: '/mo' },
];

const Products: React.FC<Props> = ({ onNavigate }) => {
  const [pickedDomain, setPickedDomain] = React.useState<{ domain: string; price: number } | null>(null);
  const [salesOpen, setSalesOpen] = React.useState(false);
  const [salesMode, setSalesMode] = React.useState<'select' | 'demo' | 'quote'>('quote');

  const openSales = (mode: 'select' | 'demo' | 'quote') => {
    setSalesMode(mode);
    setSalesOpen(true);
  };

  // "from" prices derived from the catalog by service id (single source of truth).
  const fromMonthly = (id: string) => `from ${formatKes(serviceMonthlyKes(id))}/mo`;

  // Ready-made hosted systems — each speaks to who it's for and the outcomes,
  // then routes into the same configurator → KES checkout the hosting line uses.
  const ready = [
    {
      icon: <Boxes size={20} />, t: 'Hosted ERPNext', id: 'biz-erp-light',
      best: 'Businesses outgrowing spreadsheets',
      s: 'One system for inventory, accounting, HR and manufacturing — set up for how you actually work.',
      points: ['Configured for Kenyan tax (VAT / eTIMS-ready)', 'We migrate your data & train your team', 'Daily backups, SSL & Nairobi support'],
    },
    {
      icon: <ShoppingCart size={20} />, t: 'POS & Inventory', id: 'biz-pos-inventory',
      best: 'Shops, branches & counters',
      s: 'Ring up sales fast and always know what stock you have, across every location.',
      points: ['Touch POS on any device', 'Live stock across all branches', 'M-Pesa-ready, daily sales reports'],
    },
    {
      icon: <Database size={20} />, t: 'CRM & Helpdesk', id: 'biz-crm-helpdesk',
      best: 'Sales & support teams',
      s: 'A clear pipeline from first lead to closed deal, and a real inbox so nothing slips.',
      points: ['One pipeline, no lost leads', 'Shared support ticketing', 'Email & WhatsApp integration'],
    },
    {
      icon: <Mail size={20} />, t: 'Business Email', id: 'starter-email',
      best: 'Anyone wanting a professional address',
      s: 'Email on your own domain that looks the part and stays out of spam.',
      points: ['you@yourcompany.co.ke', 'Spam filtering & webmail', 'Works on Outlook, Gmail & phones'],
    },
    {
      icon: <Globe size={20} />, t: 'Website Hosting', id: 'starter-web-hosting',
      best: 'Sites, portfolios & light stores',
      s: 'Fast, managed hosting that just works — we handle the server so you don’t.',
      points: ['Free SSL & daily backups', '1-click WordPress', 'Same-day setup'],
    },
    {
      icon: <HardDrive size={20} />, t: 'File Storage', id: 'starter-storage',
      best: 'Teams sharing files',
      s: 'A private cloud drive for your team — share files without the email chaos.',
      points: ['Drive-style sharing', 'Access controls per person', 'Weekly backups'],
    },
  ];

  // Example custom builds — concrete things we’re asked to build, so the
  // bespoke line feels tangible rather than abstract "software development".
  const customExamples = [
    { icon: <Truck size={18} />, t: 'Dispatch & logistics', s: 'Routing, deliveries and driver tracking built around your operation.' },
    { icon: <LayoutDashboard size={18} />, t: 'Customer portals', s: 'Self-service portals where your clients log in, pay and track work.' },
    { icon: <PlugZap size={18} />, t: 'M-Pesa & API integrations', s: 'Wire M-Pesa, Daraja or any API into the systems you already use.' },
    { icon: <CalendarCheck size={18} />, t: 'Booking & scheduling', s: 'Appointments, resources and reminders for service businesses.' },
    { icon: <Smartphone size={18} />, t: 'Field & mobile tools', s: 'Apps for teams on the move — works offline, syncs when back online.' },
    { icon: <Database size={18} />, t: 'Internal dashboards', s: 'Pull your data into one place and actually see what’s happening.' },
  ];

  const steps = [
    { icon: <Search size={18} />, t: 'We listen', s: 'You describe the problem in plain words. We map where the friction really is.' },
    { icon: <PenTool size={18} />, t: 'We design & quote', s: 'A system shaped around how you work — with a fixed scope, timeline and price.' },
    { icon: <Rocket size={18} />, t: 'We build & launch', s: 'Built in the open, deployed on Murzak Cloud, your team trained.' },
    { icon: <LifeBuoy size={18} />, t: 'We run it', s: 'We host, maintain and support it. No ghosting, no orphaned code.' },
  ];

  // Problem-first entry (folded in from the old Solutions page): each pain points
  // straight at the product/flow that fixes it.
  const symptoms = [
    { icon: <ServerCrash size={20} />, pain: '"My site keeps going down."', fix: 'Managed hosting that stays up — monitored, backed up and patched for you.', cta: 'Murzak Cloud', action: () => onNavigate('cloud') },
    { icon: <Table2 size={20} />, pain: '"I\'m running everything on spreadsheets."', fix: 'Hosted ERP, POS and inventory replace the chaos — stock, sales and accounts in one place.', cta: 'Configure ERPNext', action: () => onNavigate('/pricing?configure=biz-erp-light') },
    { icon: <Coins size={20} />, pain: '"Getting paid and reconciling is a nightmare."', fix: 'POS with M-Pesa built in, reconciling against your invoices automatically.', cta: 'Configure POS', action: () => onNavigate('/pricing?configure=biz-pos-inventory') },
    { icon: <UserX size={20} />, pain: '"My last developer disappeared."', fix: 'We build your software and then we run it — one accountable team in Nairobi.', cta: 'Start a build', action: () => openSales('quote') },
    { icon: <Network size={20} />, pain: '"Nothing talks to each other."', fix: 'We connect your tools — website, POS, accounting, M-Pesa — so data flows instead of being re-typed.', cta: 'Talk to us', action: () => openSales('quote') },
  ];

  return (
    <main className="text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-10 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[620px] h-[620px] rounded-full blur-[140px] bg-murzak-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-5">Products & software</p>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98]">
            Buy what's ready.<br /><span className="text-murzak-gradient">Build what isn't.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl leading-relaxed">
            Two ways to get the system your business needs: start today on a ready-made one we host and
            support, or have us build the exact tool no vendor sells. Either way it runs on Murzak Cloud,
            billed in shillings, looked after by people in Nairobi.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => onNavigate('pricing')}>
              Browse ready-made systems <ArrowRight size={16} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => openSales('quote')}>
              <Code2 size={16} className="text-murzak-cyan" /> Start a custom build
            </Button>
          </div>
        </div>
      </section>

      {/* Two business lines, at a glance */}
      <Section spacing="tight">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-7">
            <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5"><Boxes size={20} /></div>
            <h2 className="text-xl font-black text-white mb-2">Ready-made systems</h2>
            <p className="text-[13px] text-slate-400 font-medium leading-relaxed mb-4">
              Proven ERP, POS, CRM, email and hosting — configured, migrated and live in days. Self-serve:
              pick it in the configurator and pay in KES.
            </p>
            <span className="font-mono text-[11px] uppercase tracking-widest text-murzak-cyan">Live in days · from KES 1,200/mo</span>
          </div>
          <div className="rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-7">
            <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5"><Code2 size={20} /></div>
            <h2 className="text-xl font-black text-white mb-2">Custom software</h2>
            <p className="text-[13px] text-slate-400 font-medium leading-relaxed mb-4">
              The tool no vendor sells — designed around your workflow, with a fixed scope and price.
              Quoted, then built and run by the people who made it.
            </p>
            <span className="font-mono text-[11px] uppercase tracking-widest text-murzak-cyan">Scoped &amp; quoted · milestone billing</span>
          </div>
        </div>
      </Section>

      {/* Problems we hear most (merged from Solutions) */}
      <Section spacing="tight" className="border-t border-white/5">
        <div className="max-w-2xl mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">What's slowing you down?</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">You don't need a lecture. You need it to just work.</h2>
          <p className="mt-4 text-base text-slate-400 font-medium leading-relaxed">
            Here's what we hear most — and exactly what we point you to.
          </p>
        </div>
        <div className="space-y-4">
          {symptoms.map((s) => (
            <div
              key={s.pain}
              className="group grid md:grid-cols-[1fr_1.3fr_auto] items-center gap-6 rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-6 lg:p-7 transition-all hover:border-murzak-cyan/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-start gap-4">
                <span className="shrink-0 inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan">{s.icon}</span>
                <p className="text-lg font-black text-white leading-snug">{s.pain}</p>
              </div>
              <p className="text-slate-400 font-medium leading-relaxed text-[14px]">{s.fix}</p>
              <button
                onClick={s.action}
                className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-black text-[10px] uppercase tracking-widest text-murzak-cyan hover:bg-murzak-cyan hover:text-murzak-navy transition-all"
              >
                {s.cta} <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Ready-made */}
      <Section spacing="tight">
        <div className="flex items-end justify-between mb-10 gap-6 flex-wrap">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Ready in days</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">Systems you can use this week.</h2>
          </div>
          <button onClick={() => openSales('demo')} className="inline-flex items-center gap-2 font-black text-[11px] uppercase tracking-widest text-murzak-cyan hover:gap-3 transition-all">
            See one in a live demo <ArrowUpRight size={15} />
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {ready.map((r) => (
            <div key={r.t} className="flex flex-col rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-7 transition-all hover:border-murzak-cyan/40 hover:bg-white/[0.05]">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5 w-fit">{r.icon}</div>
              <h3 className="text-lg font-black text-white mb-1">{r.t}</h3>
              <p className="text-[9px] font-black uppercase tracking-widest text-murzak-cyan mb-3">Best for: {r.best}</p>
              <p className="text-[13px] text-slate-400 font-medium leading-relaxed mb-4">{r.s}</p>
              <ul className="space-y-2 mb-6 flex-grow">
                {r.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[12px] font-medium text-slate-300 leading-snug">
                    <Check size={14} className="text-murzak-cyan flex-shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-white/10">
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-300">{fromMonthly(r.id)}</span>
                <button onClick={() => onNavigate(`/pricing?configure=${r.id}`)} className="inline-flex items-center gap-1.5 font-black text-[10px] uppercase tracking-widest text-murzak-cyan hover:gap-2.5 transition-all">
                  Configure &amp; start <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Custom software */}
      <Section className="border-t border-white/5">
        <div className="max-w-2xl mb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Custom software</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">When off-the-shelf won't cut it, we build it.</h2>
          <p className="mt-5 text-lg text-slate-400 font-medium leading-relaxed">
            A dispatch system, a customer portal, an M-Pesa integration, a tool no vendor sells —
            designed around your workflow and run by the people who built it. Here's the kind of thing
            businesses ask us to build:
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {customExamples.map((c) => (
            <div key={c.t} className="rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-7 transition-all hover:border-murzak-cyan/40">
              <div className="inline-flex p-2.5 rounded-xl bg-murzak-cyan/10 text-murzak-cyan mb-4">{c.icon}</div>
              <h3 className="text-base font-black text-white mb-2">{c.t}</h3>
              <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{c.s}</p>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <div key={s.t} className="relative rounded-3xl border border-white/10 bg-murzak-navy/80 backdrop-blur-md p-7">
              <span className="font-mono text-[11px] text-slate-600">0{i + 1}</span>
              <div className="inline-flex p-2.5 rounded-xl bg-murzak-cyan/10 text-murzak-cyan my-4">{s.icon}</div>
              <h3 className="text-base font-black text-white mb-2">{s.t}</h3>
              <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{s.s}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Button onClick={() => openSales('quote')}>
            <FileSignature size={16} /> Start a build — get a quote
          </Button>
          <Button variant="outlineOnDark" onClick={() => openSales('demo')}>
            See our work in a demo
          </Button>
        </div>
      </Section>

      {/* How buying works — the two checkout paths */}
      <Section className="border-t border-white/5">
        <div className="max-w-2xl mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">How buying works</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Two products, two ways to buy.</h2>
          <p className="mt-4 text-base text-slate-400 font-medium leading-relaxed">
            Ready-made systems are self-serve — no quotes to chase. Custom builds are scoped and quoted
            first, so you always approve the price before anything starts.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Self-serve */}
          <div className="rounded-3xl border border-murzak-cyan/30 bg-murzak-cyan/[0.06] p-8">
            <div className="flex items-center gap-2 mb-5">
              <SlidersHorizontal size={18} className="text-murzak-cyan" />
              <h3 className="text-lg font-black text-white">Ready-made → self-serve checkout</h3>
            </div>
            <ol className="space-y-4">
              {[
                { t: 'Configure it', s: 'Pick the system and any extras in the configurator. The total adds up in shillings as you go.' },
                { t: 'Pay in KES', s: 'Check out with M-Pesa STK push or card. Free trials verify with a small refundable charge.' },
                { t: 'Live in days', s: 'We provision, configure and migrate your data — then hand you the keys.' },
              ].map((x, i) => (
                <li key={x.t} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-murzak-cyan text-murzak-navy font-black text-[11px] flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="text-sm font-black text-white">{x.t}</p>
                    <p className="text-[12px] text-slate-300 font-medium leading-relaxed mt-0.5">{x.s}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-7">
              <Button onClick={() => onNavigate('pricing')}>Configure a system <ArrowRight size={16} /></Button>
            </div>
          </div>

          {/* Scoped quote */}
          <div className="rounded-3xl border border-white/15 bg-murzak-navy/80 backdrop-blur-md p-8">
            <div className="flex items-center gap-2 mb-5">
              <FileSignature size={18} className="text-murzak-cyan" />
              <h3 className="text-lg font-black text-white">Custom → scoped quote &amp; milestones</h3>
            </div>
            <ol className="space-y-4">
              {[
                { t: 'Tell us the problem', s: 'Share what you need in plain words. We ask the right questions and map the work.' },
                { t: 'Approve a fixed quote', s: 'You get a clear scope, timeline and price up front — broken into milestones. No surprises.' },
                { t: 'Pay as we ship', s: 'A deposit to start, then milestone payments in KES (M-Pesa or card) as each piece is delivered.' },
              ].map((x, i) => (
                <li key={x.t} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-white/10 text-white font-black text-[11px] flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="text-sm font-black text-white">{x.t}</p>
                    <p className="text-[12px] text-slate-300 font-medium leading-relaxed mt-0.5">{x.s}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-7 flex items-center gap-3 flex-wrap">
              <Button onClick={() => openSales('quote')}>Get a quote <ArrowRight size={16} /></Button>
              <span className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-400">
                <CreditCard size={14} className="text-murzak-cyan" /> Milestones billed in KES
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Domains & simple add-ons — browseable + priced without login */}
      <Section className="border-t border-white/5">
        <div className="max-w-2xl mb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Domains &amp; add-ons</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Grab a domain. Pick your extras. No login needed.</h2>
          <p className="mt-4 text-base text-slate-400 font-medium leading-relaxed">
            Search a name, see the price in shillings, and add it to any plan at checkout. Everything here is
            priced up-front — no quotes to chase.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Domain search */}
          <div className="rounded-3xl border border-white/15 bg-murzak-navy/80 backdrop-blur-md p-6 sm:p-8">
            <div className="flex items-center gap-2 mb-4">
              <Globe size={18} className="text-murzak-cyan" />
              <h3 className="text-base font-black text-white">Find your domain</h3>
            </div>
            <DomainSearch
              selectedDomain={pickedDomain?.domain}
              onSelect={(domain, priceKes) => setPickedDomain({ domain, price: priceKes })}
            />
            {pickedDomain && (
              <div className="mt-5 rounded-2xl border border-murzak-cyan/30 bg-murzak-cyan/[0.08] p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">Nice pick</p>
                  <p className="text-sm font-black text-white truncate">{pickedDomain.domain}</p>
                  <p className="text-[11px] font-bold text-slate-300">KES {pickedDomain.price.toLocaleString()}/yr · added at checkout</p>
                </div>
                <button onClick={() => onNavigate('pricing')} className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-murzak-cyan text-murzak-navy px-4 py-3 font-black text-[10px] uppercase tracking-widest hover:scale-[1.03] transition-all">
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>

          {/* TLD price list */}
          <div className="rounded-3xl border border-white/15 bg-murzak-navy/80 backdrop-blur-md p-6 sm:p-8">
            <h3 className="text-base font-black text-white mb-4">Domain prices</h3>
            <div className="space-y-1.5">
              {TLD_OPTIONS.map((t) => (
                <div key={t.tld} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-black text-white">
                    <span className="font-mono text-murzak-cyan">{t.tld}</span>
                    {t.popular && <span className="rounded-full bg-murzak-cyan/15 text-murzak-cyan px-2 py-0.5 text-[8px] font-black uppercase tracking-widest">Popular</span>}
                  </span>
                  <span className="text-[13px] font-black text-slate-300">KES {t.priceKes.toLocaleString()}<span className="text-slate-500 text-[10px] font-bold">/yr</span></span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] font-medium text-slate-500 leading-relaxed">
              Renewals at the same rate. Transfers in are free — we handle the move.
            </p>
          </div>
        </div>

        {/* Simple add-ons */}
        <div className="mt-12">
          <h3 className="text-base font-black text-white mb-5">Simple add-ons, clear prices</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SIMPLE_ADDONS.map((a) => (
              <div key={a.t} className="rounded-3xl border border-white/15 bg-murzak-navy/80 backdrop-blur-md p-6 flex flex-col">
                <span className="inline-flex p-2.5 rounded-xl bg-murzak-cyan/10 text-murzak-cyan w-fit mb-4">{a.icon}</span>
                <h4 className="text-sm font-black text-white">{a.t}</h4>
                <p className="text-[12px] text-slate-400 font-medium leading-relaxed mt-1 mb-4 flex-grow">{a.s}</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-black text-murzak-gradient">{a.price}</span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{a.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <Button onClick={() => onNavigate('pricing')}>
              Configure a plan with these <ArrowRight size={16} />
            </Button>
            <span className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-400">
              <Check size={14} className="text-murzak-cyan" /> Add any of these to any plan — pay in KES by M-Pesa or card
            </span>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <section className="relative py-20 sm:py-28 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-white/10" />
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-white">Ready to put one to work?</h2>
          <p className="mt-4 text-lg text-white/85 font-medium">Start on a ready-made system today, or tell us about the custom one you have in mind.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="onDark" onClick={() => onNavigate('pricing')}>
              Browse ready-made <ArrowRight size={18} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => openSales('quote')}>
              <Wand2 size={16} /> Start a custom build
            </Button>
          </div>
        </div>
      </section>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode={salesMode} />
    </main>
  );
};

export default Products;
