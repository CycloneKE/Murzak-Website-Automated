import React, { useState } from 'react';
import { ArrowRight, Boxes, Users, Briefcase, Calculator, ShieldCheck, Factory, BookOpen, Check } from 'lucide-react';
import MetricBar from '../../components/mockups/MetricBar';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
}

const MurzakERP: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const modules = [
    {
      icon: <Calculator size={20} />,
      title: "Accounting",
      bullets: [
        "Auto-generated general ledger from every sale, purchase, and journal entry — drill down to trace any transaction",
        "Multi-currency, multi-branch chart of accounts with consolidated reporting",
        "VAT/PAYE-ready tax ledgers, plus KRA eTIMS integration",
        "Real-time Balance Sheet, P&L, Trial Balance, and Cash Flow reports",
      ],
    },
    {
      icon: <Boxes size={20} />,
      title: "Inventory",
      bullets: [
        "Live stock levels across every warehouse, updated the moment a sale or delivery happens",
        "Item variants, batch/serial tracking, and automatic valuation",
        "Scheduled stock audits that flag discrepancies before they become losses",
        "Reports on stock value, movement trends, and slow-moving inventory",
      ],
    },
    {
      icon: <Users size={20} />,
      title: "HR & Payroll",
      bullets: [
        "Full employee lifecycle — onboarding, transfers, promotions, exit interviews",
        "Geolocation-enabled attendance, configurable leave policies and KE public holidays",
        "Custom salary structures with PAYE/NHIF/NSSF-ready payroll runs and payslips",
        "Expense claims and advances with multi-level approval, synced straight to accounting",
      ],
    },
    {
      icon: <Factory size={20} />,
      title: "Manufacturing",
      bullets: [
        "Bills of materials define exactly what a finished product needs",
        "Work orders and job cards track every production step in real time",
        "Production planning that schedules runs against real demand and resource availability",
        "Quality checks built into the process, not bolted on after",
      ],
    },
    {
      icon: <Briefcase size={20} />,
      title: "CRM",
      bullets: [
        "Capture and nurture leads through a visible pipeline, stage by stage",
        "Opportunity tracking with revenue forecasting",
        "Full customer history — every call, meeting, and quote in one record",
        "Sales performance reports your team can actually act on",
      ],
    },
    {
      icon: <BookOpen size={20} />,
      title: "Projects",
      bullets: [
        "Task boards, milestones, and deadlines your team can see at a glance",
        "Time tracking that rolls straight into project cost and profitability",
        "Client-ready progress reporting without a separate spreadsheet",
      ],
    },
  ];

  const faqs: FaqItem[] = [
    { q: "Is it compliant with Kenyan tax laws?", a: "Yes. Murzak ERP is configured for Kenyan VAT, PAYE, NSSF, NHIF, and can be integrated with KRA eTIMS." },
    { q: "How long does implementation take?", a: "A basic setup takes a few days. Full implementation with data migration and training typically takes 2-4 weeks depending on complexity." },
    { q: "Can we migrate our data from spreadsheets?", a: "Yes. Our implementation team handles data migration from Excel, CSV, or legacy systems like QuickBooks and Sage." },
    { q: "Who owns our data?", a: "You do. You can export your data at any time, and we never lock you in." },
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
              <span className="text-micro font-black uppercase text-murzak-accent">Murzak ERP</span>
            </div>
            <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
              One system for your whole business. <span className="text-murzak-gradient">Made for Kenya.</span>
            </h1>
            <p className="mt-7 text-lg sm:text-xl text-slate-600 dark:text-slate-400 font-medium max-w-2xl leading-relaxed">
              The first ERP purpose-built for how Kenyan companies actually do business. Stop bridging gaps between spreadsheets and legacy accounting software.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-4">
              <Button onClick={() => onNavigate('/pricing?configure=biz-erp-light')}>
                Start from {formatKes(serviceMonthlyKes('biz-erp-light'))}/mo <ArrowRight size={18} />
              </Button>
              <Button variant="outline" onClick={() => setSalesOpen(true)}>
                Book a Demo
              </Button>
            </div>
          </div>

          {/* Business snapshot mockup — hand-coded JSX, not a screenshot */}
          <div className="lg:col-span-5">
            <div className="rounded-[2rem] bg-slate-900 border border-murzak-border shadow-2xl p-6 sm:p-7">
              <div className="flex items-center justify-between mb-5">
                <span className="text-micro font-black uppercase tracking-widest text-slate-400">Business Snapshot</span>
                <span className="flex items-center gap-1.5 text-micro font-black uppercase text-murzak-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-murzak-accent animate-pulse" /> Live
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-400 mb-1">Revenue</div>
                  <div className="text-sm font-black text-white">KES 4.2M</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-400 mb-1">Expenses</div>
                  <div className="text-sm font-black text-white">KES 2.8M</div>
                </div>
                <div className="rounded-xl bg-black/20 p-3">
                  <div className="text-micro font-bold uppercase text-slate-400 mb-1">Net</div>
                  <div className="text-sm font-black text-murzak-accent">KES 1.4M</div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <MetricBar label="Warehouse — Nairobi" percent={72} tone="accent" />
                <MetricBar label="Warehouse — Mombasa" percent={38} tone="warning" />
              </div>

              <div className="flex items-center gap-2.5 rounded-xl bg-murzak-accent/10 border border-murzak-accent/20 px-4 py-3">
                <Check size={16} className="text-murzak-accent shrink-0" />
                <span className="text-body-sm font-bold text-slate-200">3 payroll runs processed this quarter</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modules Grid */}
      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mb-12">
          <p className="font-mono text-micro uppercase text-murzak-accent mb-3">Core Modules</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Everything connects automatically.</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {modules.map((m, i) => (
            <div key={i} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7 hover:border-murzak-accent/40 transition-colors h-full flex flex-col">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5 w-fit">
                {m.icon}
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-3">{m.title}</h3>
              <ul className="space-y-2">
                {m.bullets.map((b, bi) => (
                  <li key={bi} className="flex items-start gap-2 text-body-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                    <span className="text-murzak-accent mt-1.5 shrink-0">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Deep Dive */}
      <Section className="border-t border-murzak-border/50 bg-white/[0.02]">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1 relative p-8 rounded-[2rem] bg-slate-900 border border-murzak-border shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 p-4">
              <ShieldCheck className="text-murzak-success" size={24} />
            </div>
            <div className="space-y-4">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2">Tax Settings</div>
              <div className="flex justify-between items-center bg-black/5 p-4 rounded-xl">
                <span className="font-bold">VAT (16%)</span>
                <span className="text-murzak-accent text-sm">Active</span>
              </div>
              <div className="flex justify-between items-center bg-black/5 p-4 rounded-xl">
                <span className="font-bold">KRA eTIMS Integration</span>
                <span className="text-murzak-accent text-sm">Configured</span>
              </div>
              <div className="flex justify-between items-center bg-black/5 p-4 rounded-xl">
                <span className="font-bold">PAYE & NHIF Rates</span>
                <span className="text-murzak-accent text-sm">Updated 2024</span>
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <h2 className="text-3xl font-[900] tracking-tight mb-5">Built for Kenyan compliance.</h2>
            <p className="text-slate-500 font-medium leading-relaxed mb-6">
              Forget clunky workarounds. Murzak ERP comes pre-configured with Kenyan tax laws, statutory deductions for payroll, and supports eTIMS API integrations out of the box.
            </p>
          </div>
        </div>
      </Section>

      {/* Pricing Tiers */}
      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mx-auto text-center mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">Transparent Pricing</h2>
           <p className="text-slate-500 font-medium">Choose the tier that fits your team size. We handle the hosting, backups, and security.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
           <div className="p-8 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5">
              <h3 className="text-xl font-black mb-2 text-murzak-ink dark:text-slate-100">Light (1-3 Users)</h3>
              <div className="text-3xl font-black text-murzak-gradient mb-6">{formatKes(serviceMonthlyKes('biz-erp-light'))}<span className="text-sm text-slate-500 dark:text-slate-400">/mo</span></div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Perfect for small businesses graduating from spreadsheets.</p>
              <Button className="w-full" variant="ghost" onClick={() => onNavigate('/pricing?configure=biz-erp-light')}>Select Light</Button>
           </div>
           <div className="p-8 rounded-3xl border border-murzak-accent/40 bg-murzak-accent/[0.05]">
              <h3 className="text-xl font-black mb-2">Configured (5-20 Users)</h3>
              <div className="text-3xl font-black text-murzak-ink dark:text-slate-100 mb-6">{formatKes(serviceMonthlyKes('biz-erp-configured'))}<span className="text-sm text-slate-500 dark:text-slate-400">/mo</span></div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Data migration, training, and tailored workflows included.</p>
              <Button className="w-full" onClick={() => onNavigate('/pricing?configure=biz-erp-configured')}>Select Configured</Button>
           </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="bg-murzak-surface/30 border-t border-murzak-border/50">
        <Faq items={faqs} />
      </Section>

      {/* Final CTA */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-6">Upgrade your operations today.</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" onClick={() => setSalesOpen(true)}>
              Get a Quote <ArrowRight size={17} />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('pricing')}>
              View Plans
            </Button>
          </div>
        </div>
      </section>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </main>
  );
};

export default MurzakERP;
