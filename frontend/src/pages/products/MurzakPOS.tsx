import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, ShoppingCart, Smartphone, Database, RefreshCw, Check, Banknote, SignalHigh, MonitorSmartphone } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
}

const MurzakPOS: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const features = [
    { icon: <MonitorSmartphone size={20} />, title: "Touch POS on any device", desc: "Works on tablets, laptops, and dedicated POS hardware. Fast and intuitive." },
    { icon: <Database size={20} />, title: "Real-time stock across branches", desc: "Never guess what's in stock. See inventory instantly across all your locations." },
    { icon: <Banknote size={20} />, title: "M-Pesa Native Integration", desc: "Accept payments directly via M-Pesa. Automatic reconciliation." },
    { icon: <SignalHigh size={20} />, title: "Offline Mode", desc: "Keep selling even when the internet drops. Syncs automatically when reconnected." },
  ];

  const faqs: FaqItem[] = [
    { q: "What hardware do I need?", a: "Murzak POS runs on any modern browser. You can use your existing PC, tablet, or smartphone. We also support standard receipt printers and barcode scanners." },
    { q: "Does it work if my internet goes down?", a: "Yes. Our POS has an offline mode that allows you to continue ringing up sales. Once the connection is restored, everything syncs automatically to the cloud." },
    { q: "How are M-Pesa payments settled?", a: "Payments flow directly into your own M-Pesa Till or Paybill. We simply integrate the API so the till prompts the customer and the POS receives automatic confirmation." },
    { q: "Can I manage multiple branches?", a: "Absolutely. You can add as many branches or terminals as you need, and track stock transfers and sales across all of them in real-time." },
    { q: "Is training included?", a: "Yes, we provide onboarding and training for your staff to ensure a smooth transition." }
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">Murzak POS & Inventory</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            Sell fast. Know your stock. <span className="text-murzak-gradient">Every branch, one system.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl leading-relaxed">
            Built from scratch for Kenyan retail — not a foreign POS with a Swahili label. Manage your sales, inventory, and M-Pesa payments in one place.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => onNavigate('/pricing?configure=biz-pos-inventory')}>
              Start from {formatKes(serviceMonthlyKes('biz-pos-inventory'))}/mo <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => setSalesOpen(true)}>
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mb-12">
          <p className="font-mono text-micro uppercase text-murzak-accent mb-3">Core Features</p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Everything you need to run your shop.</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <div key={i} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">
                {f.icon}
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{f.title}</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Deep Dive: POS Mockup */}
      <Section className="border-t border-murzak-border/50 bg-white/[0.02]">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-[900] tracking-tight mb-5">Checkout made effortless.</h2>
            <p className="text-slate-500 font-medium leading-relaxed mb-6">
              Ring up items with a barcode scanner or tap the screen. Apply discounts, process M-Pesa payments instantly, and print receipts without touching a mouse. 
              Your cashiers will love how fast it is.
            </p>
            <ul className="space-y-3">
              {['Barcode scanning support', 'Quick-add categories', 'Instant M-Pesa STK push', 'Custom receipt printing'].map(item => (
                <li key={item} className="flex items-center gap-3 text-sm font-bold text-murzak-ink dark:text-slate-100">
                  <Check size={16} className="text-murzak-accent" /> {item}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-murzak-border group">
            <img 
              src="/images/pos-dashboard.png" 
              alt="Murzak POS Dashboard showing checkout interface with M-Pesa payment" 
              className="w-full rounded-[2rem] transition-transform duration-700 group-hover:scale-[1.02]" 
              loading="lazy"
            />
            <div className="absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
          </div>
        </div>
      </Section>

      {/* Who it's for */}
      <Section className="border-t border-murzak-border/50">
         <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Built for Kenyan Retail</h2>
            <p className="text-slate-500 font-medium">Whether you have one shop or fifty branches, Murzak POS scales with you.</p>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['Supermarkets', 'Pharmacies', 'Hardware Stores', 'Boutiques & Apparel'].map(item => (
              <div key={item} className="p-6 rounded-2xl bg-black/5 border border-murzak-border text-center font-bold text-sm text-murzak-ink dark:text-slate-100">
                {item}
              </div>
            ))}
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
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-6">Stop guessing your stock.</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" onClick={() => onNavigate('/pricing?configure=biz-pos-inventory')}>
              Configure POS <ArrowRight size={17} />
            </Button>
            <Button variant="outline" onClick={() => setSalesOpen(true)}>
              Talk to Sales
            </Button>
          </div>
        </div>
      </section>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="demo" />
    </main>
  );
};

export default MurzakPOS;
