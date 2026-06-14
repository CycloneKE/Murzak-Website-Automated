
import React from 'react';
import {
  ArrowRight, ArrowUpRight, Boxes, ShoppingCart, Database, Mail, Globe, HardDrive,
  Search, PenTool, Rocket, LifeBuoy, ShieldCheck, Lock, Zap, Headphones, Check,
} from 'lucide-react';
import { Page } from '../types';
import DomainSearch from '../components/DomainSearch';
import { TLD_OPTIONS } from '../services/domains';

interface Props {
  onNavigate: (page: Page) => void;
  isLoading?: boolean;
}

// Straightforward, self-serve-priced extras (retail KES, marked up over wholesale).
const SIMPLE_ADDONS = [
  { icon: <Mail size={16} />, t: 'Business Email', s: 'Branded mailbox on your domain', price: 'KES 1,500', unit: '/mo · 5 inboxes' },
  { icon: <ShieldCheck size={16} />, t: 'Premium SSL', s: 'Wildcard / EV certificate', price: 'KES 700', unit: '/mo' },
  { icon: <Lock size={16} />, t: 'WHOIS Privacy', s: 'Hide your details from spammers', price: 'KES 1,000', unit: '/yr' },
  { icon: <HardDrive size={16} />, t: 'Daily Backups +', s: 'Hourly backups, 30-day history', price: 'KES 1,200', unit: '/mo' },
  { icon: <Zap size={16} />, t: 'Global CDN', s: 'Faster loads worldwide', price: 'KES 900', unit: '/mo' },
  { icon: <Lock size={16} />, t: 'Web Firewall (WAF)', s: 'Block attacks & bad bots', price: 'KES 1,200', unit: '/mo' },
  { icon: <Globe size={16} />, t: 'Website Migration', s: 'We move your site in, zero downtime', price: 'KES 3,000', unit: 'one-off' },
  { icon: <Headphones size={16} />, t: 'Priority Support', s: '4-hour first response', price: 'KES 2,500', unit: '/mo' },
];

const Products: React.FC<Props> = ({ onNavigate }) => {
  const [pickedDomain, setPickedDomain] = React.useState<{ domain: string; price: number } | null>(null);

  const ready = [
    { icon: <Boxes size={20} />, t: 'Hosted ERPNext', s: 'Inventory, accounting, HR and manufacturing — configured for Kenyan tax and your departments.', from: 'from KES 6,000/mo' },
    { icon: <ShoppingCart size={20} />, t: 'POS & Inventory', s: "Ring up sales, track stock across the counter, and see what's selling — M-Pesa ready.", from: 'from KES 4,500/mo' },
    { icon: <Database size={20} />, t: 'CRM & Helpdesk', s: 'A clear sales pipeline and a real support inbox so nothing slips through.', from: 'from KES 4,000/mo' },
    { icon: <Mail size={20} />, t: 'Business Email', s: 'Professional email on your own domain, with spam filtering and admin controls.', from: 'from KES 1,500/mo' },
    { icon: <Globe size={20} />, t: 'Website Hosting', s: 'Fast, managed hosting for your site or store, with SSL and daily backups.', from: 'from KES 1,200/mo' },
    { icon: <HardDrive size={20} />, t: 'File Storage', s: 'A private cloud drive for your team — share files without the chaos.', from: 'from KES 1,200/mo' },
  ];

  const steps = [
    { icon: <Search size={18} />, t: 'We listen', s: 'You describe the problem in plain words. We map where the friction really is.' },
    { icon: <PenTool size={18} />, t: 'We design', s: 'A system shaped around how you actually work — not a generic template.' },
    { icon: <Rocket size={18} />, t: 'We build & launch', s: 'Built in the open, deployed on Murzak Cloud, your team trained.' },
    { icon: <LifeBuoy size={18} />, t: 'We run it', s: 'We host, maintain and support it. No ghosting, no orphaned code.' },
  ];

  return (
    <main className="text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-14 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[620px] h-[620px] rounded-full blur-[140px] bg-murzak-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-5">Products</p>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98]">
            Buy what's ready.<br /><span className="text-murzak-gradient">Build what isn't.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-xl leading-relaxed">
            Start today with a system that already works — or commission the exact one your business needs.
            Either way, we set it up, host it, and stand behind it.
          </p>
        </div>
      </section>

      {/* Ready-made */}
      <section className="py-12">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="flex items-end justify-between mb-10 gap-6 flex-wrap">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Ready in days</p>
              <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">Systems you can use this week.</h2>
            </div>
            <button onClick={() => onNavigate('pricing')} className="inline-flex items-center gap-2 font-black text-[11px] uppercase tracking-widest text-murzak-cyan hover:gap-3 transition-all">
              See pricing <ArrowUpRight size={15} />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {ready.map((r) => (
              <div key={r.t} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7 transition-all hover:border-murzak-cyan/40 hover:bg-white/[0.05]">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5">{r.icon}</div>
                <h3 className="text-lg font-black text-white mb-2">{r.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed mb-5">{r.s}</p>
                <span className="font-mono text-[11px] uppercase tracking-widest text-slate-300">{r.from}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Domains & simple add-ons — browseable + priced without login */}
      <section className="py-16 lg:py-24 border-t border-white/5 mt-6">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
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
            <div className="rounded-3xl border border-white/15 bg-white/[0.08] backdrop-blur-md p-6 sm:p-8">
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
            <div className="rounded-3xl border border-white/15 bg-white/[0.08] backdrop-blur-md p-6 sm:p-8">
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
                <div key={a.t} className="rounded-3xl border border-white/15 bg-white/[0.08] backdrop-blur-md p-6 flex flex-col">
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
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <button onClick={() => onNavigate('pricing')} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-cyan text-murzak-navy px-7 py-4 font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-all shadow-lg shadow-murzak-cyan/20">
                Configure a plan with these <ArrowRight size={16} />
              </button>
              <span className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-400">
                <Check size={14} className="text-murzak-cyan" /> Add any of these to any plan — pay in KES by M-Pesa or card
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Bespoke */}
      <section className="py-16 lg:py-24 border-t border-white/5 mt-6">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Bespoke</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">When off-the-shelf won't cut it, we build it.</h2>
            <p className="mt-5 text-lg text-slate-400 font-medium leading-relaxed">
              A dispatch system, a customer portal, an M-Pesa integration, a tool no vendor sells —
              designed around your workflow and run by the people who built it.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {steps.map((s, i) => (
              <div key={s.t} className="relative rounded-3xl border border-white/10 bg-white/[0.03] p-7">
                <span className="font-mono text-[11px] text-slate-600">0{i + 1}</span>
                <div className="inline-flex p-2.5 rounded-xl bg-murzak-cyan/10 text-murzak-cyan my-4">{s.icon}</div>
                <h3 className="text-base font-black text-white mb-2">{s.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{s.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-white/10" />
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-white">Ready to put one to work?</h2>
          <p className="mt-4 text-lg text-white/85 font-medium">Build a plan around a ready-made product, or tell us about the custom system you have in mind.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => onNavigate('pricing')} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white text-murzak-navy px-8 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] transition-all shadow-xl">
              Build my plan <ArrowRight size={18} />
            </button>
            <button onClick={() => onNavigate('contact')} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-white/40 px-8 py-4 font-black text-sm uppercase tracking-widest text-white hover:bg-white/10 transition-all">
              Discuss a build
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Products;
