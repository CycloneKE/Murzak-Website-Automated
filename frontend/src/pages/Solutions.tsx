
import React from 'react';
import {
  ArrowRight, ArrowUpRight, ServerCrash, Table2, UserX, Coins, Network,
} from 'lucide-react';
import { Page } from '../types';

interface Props {
  onNavigate: (page: Page) => void;
  isLoading?: boolean;
}

const Solutions: React.FC<Props> = ({ onNavigate }) => {
  const symptoms = [
    {
      icon: <ServerCrash size={22} />,
      pain: '"My site keeps going down."',
      fix: 'Managed hosting that stays up — monitored, backed up, and patched for you. If something breaks, we fix it before you notice.',
      to: 'cloud' as Page,
      cta: 'Murzak Cloud',
    },
    {
      icon: <Table2 size={22} />,
      pain: '"I\'m running my whole business on spreadsheets."',
      fix: 'Hosted ERP, POS and inventory that replace the spreadsheet chaos — stock, sales and accounts in one place, configured to fit you.',
      to: 'products' as Page,
      cta: 'See business systems',
    },
    {
      icon: <UserX size={22} />,
      pain: '"My last developer disappeared."',
      fix: 'We build your software and then we run it — no ghosting, no "the guy who knew it left." One team, accountable, reachable in Nairobi.',
      to: 'products' as Page,
      cta: 'Custom software',
    },
    {
      icon: <Coins size={22} />,
      pain: '"Getting paid and reconciling is a nightmare."',
      fix: 'M-Pesa STK push built into your systems, with payments that reconcile against your invoices automatically. Less chasing, fewer errors.',
      to: 'products' as Page,
      cta: 'How it works',
    },
    {
      icon: <Network size={22} />,
      pain: '"We\'re growing and nothing talks to each other."',
      fix: 'We connect your tools — website, POS, accounting, M-Pesa — so data flows instead of being re-typed. Built to scale to dedicated capacity when you need it.',
      to: 'contact' as Page,
      cta: 'Talk to us',
    },
  ];

  return (
    <main className="text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-[-10%] w-[600px] h-[600px] rounded-full blur-[140px] bg-murzak-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-5">Solutions</p>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            Tell us what's <span className="text-murzak-gradient">slowing you down.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-xl leading-relaxed">
            You don't need a lecture about "digital transformation." You need the thing that's costing
            you time and money to just… work. Here's what we hear most — and what we do about it.
          </p>
        </div>
      </section>

      {/* Symptom → fix */}
      <section className="pb-10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 space-y-4">
          {symptoms.map((s) => (
            <div
              key={s.pain}
              className="group grid md:grid-cols-[1fr_1.3fr_auto] items-center gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-7 lg:p-9 transition-all hover:border-murzak-cyan/40 hover:bg-white/[0.05]"
            >
              <div className="flex items-start gap-4">
                <span className="shrink-0 inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan">{s.icon}</span>
                <p className="text-xl font-black text-white leading-snug">{s.pain}</p>
              </div>
              <p className="text-slate-400 font-medium leading-relaxed">{s.fix}</p>
              <button
                onClick={() => onNavigate(s.to)}
                className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-black text-[10px] uppercase tracking-widest text-murzak-cyan hover:bg-murzak-cyan hover:text-murzak-navy transition-all"
              >
                {s.cta} <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden mt-10">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-white/10" />
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-white">Don't see your exact problem?</h2>
          <p className="mt-4 text-lg text-white/85 font-medium">Tell us in plain words. We'll tell you honestly whether we can help — and what it costs.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => onNavigate('contact')} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white text-murzak-navy px-8 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] transition-all shadow-xl">
              Talk to us <ArrowRight size={18} />
            </button>
            <button onClick={() => onNavigate('pricing')} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-white/40 px-8 py-4 font-black text-sm uppercase tracking-widest text-white hover:bg-white/10 transition-all">
              Build a plan
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Solutions;
