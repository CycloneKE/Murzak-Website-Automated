import React from 'react';
import { ArrowRight, ShoppingCart, Barcode, Database, Store } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
}

const ForRetail: React.FC<Props> = ({ onNavigate }) => {
  const stack = [
    { title: "Murzak POS", desc: "Touch POS on any device, M-Pesa integration, barcode scanning.", path: "pos", icon: <Barcode size={24} /> },
    { title: "Murzak ERP", desc: "Multi-branch inventory, purchase orders, and retail accounting.", path: "erp", icon: <Database size={24} /> },
    { title: "Business Email", desc: "Professional emails for your management and branches.", path: "cloud", icon: <Store size={24} /> }
  ];

  return (
    <main className="text-murzak-ink overflow-x-hidden">
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">For Retail & Shops</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] mx-auto max-w-4xl">
            Run your shop, not your systems. <span className="text-murzak-gradient">POS, stock and accounting — handled.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl mx-auto leading-relaxed">
            We're building the technology layer Kenya's retail sector has been waiting for. Stop doing manual stock counts and reconciling M-Pesa at midnight.
          </p>
        </div>
      </section>


      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mx-auto text-center mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">The Murzak Retail Stack</h2>
           <p className="text-slate-500 font-medium mb-8">Integrated tools designed for Kenyan retail workflows.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
           {stack.map((item, idx) => (
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-8 rounded-3xl border border-murzak-border bg-white/60 hover:border-murzak-accent/40 transition-all">
                <div className="text-murzak-accent mb-5 opacity-80 group-hover:opacity-100 transition-opacity">{item.icon}</div>
                <h3 className="text-xl font-black mb-3">{item.title}</h3>
                <p className="text-sm text-slate-500 mb-6">{item.desc}</p>
                <div className="text-murzak-accent text-sm font-bold flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                  View {item.title} <ArrowRight size={14} />
                </div>
             </div>
           ))}
        </div>
      </Section>

      <section className="relative py-24 overflow-hidden border-t border-murzak-border/50">
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink mb-6">Ready to upgrade your counters?</h2>
          <p className="text-slate-600 font-medium mb-8">POS starting from {formatKes(serviceMonthlyKes('biz-pos-inventory'))}/mo with full inventory features.</p>
          <Button variant="primary" onClick={() => onNavigate('/pricing?configure=biz-pos-inventory')}>
            Configure your retail stack <ArrowRight size={17} />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default ForRetail;
