import React from 'react';
import { ArrowRight, ShoppingCart, Briefcase, Truck, Stethoscope, Terminal, Cloud } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Section } from '../components/ui/Section';
import { Page } from '../types';
import { formatKes, serviceMonthlyKes } from '../config/serviceCatalog';

interface Props {
  onNavigate: (page: Page | string) => void;
  isLoading?: boolean;
}

const Products: React.FC<Props> = ({ onNavigate }) => {

  const businessSystems = [
    { title: "Murzak POS", desc: "Multi-branch point of sale, inventory tracking, and M-Pesa integration.", path: "pos", priceId: "biz-pos-inventory" },
    { title: "Murzak ERP", desc: "Accounting, HR, and inventory tailored for Kenyan compliance.", path: "erp", priceId: "biz-erp-light" },
    { title: "Murzak CRM & Helpdesk", desc: "Track leads, manage support tickets, and integrate WhatsApp.", path: "crm", priceId: "biz-crm-helpdesk" }
  ];

  const industries = [
    { title: "Retail & Shops", path: "for-retail", icon: <ShoppingCart size={24} /> },
    { title: "Clinics & Healthcare", path: "for-clinics", icon: <Stethoscope size={24} /> },
    { title: "Logistics & Delivery", path: "for-logistics", icon: <Truck size={24} /> },
    { title: "Professional Services", path: "for-services", icon: <Briefcase size={24} /> }
  ];

  return (
    <main className="text-murzak-ink overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-murzak-accent/20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">All Products</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] mx-auto max-w-4xl">
            Software built for <span className="text-murzak-gradient">how Kenya works.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl mx-auto leading-relaxed">
            From ready-made business systems to custom operational tools, we build and run the technology that powers growing companies.
          </p>
        </div>
      </section>

      {/* Hero image */}
      <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 -mt-4 mb-12">
        <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-murzak-border">
          <img
            src="/images/virtual-reality.webp"
            alt="A team reviewing an interactive product build using a VR headset and laptop"
            className="w-full h-64 sm:h-80 object-cover"
            loading="lazy"
            width={1920}
            height={1080}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-murzak-ink/70 via-murzak-ink/10 to-transparent" />
        </div>
      </div>

      {/* Ready-Made Business Systems */}
      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">Ready-Made Systems</h2>
           <p className="text-slate-500 font-medium">Enterprise-grade tools, managed and hosted for you. Deployed in 24 hours.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
           {businessSystems.map((item, idx) => (
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-8 rounded-3xl border border-murzak-border bg-white/60 hover:border-murzak-accent/40 transition-all flex flex-col h-full">
                <h3 className="text-xl font-black mb-3 text-murzak-ink">{item.title}</h3>
                <p className="text-sm text-slate-500 mb-6 flex-grow">{item.desc}</p>
                <div className="text-murzak-accent text-sm font-bold flex items-center justify-between">
                  <span className="text-slate-500 text-xs font-mono uppercase">From {formatKes(serviceMonthlyKes(item.priceId))}/mo</span>
                  <span className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">View <ArrowRight size={14} /></span>
                </div>
             </div>
           ))}
        </div>
      </Section>

      {/* Cloud & Custom */}
      <Section className="border-t border-murzak-border/50 bg-white/[0.02]">
        <div className="grid md:grid-cols-2 gap-6">
           <div className="p-10 rounded-[2rem] border border-murzak-border bg-slate-900 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-8 opacity-20 text-murzak-accent group-hover:scale-110 transition-transform duration-700">
                <Terminal size={120} strokeWidth={1} />
              </div>
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 text-murzak-ink text-micro font-black uppercase mb-6">Custom Build</div>
                <h3 className="text-3xl font-black mb-4">Custom Software Development</h3>
                <p className="text-slate-500 mb-8 max-w-sm">When off-the-shelf won't cut it. We design, build, and run bespoke systems tailored to your unique workflows.</p>
                <Button variant="ghost" onClick={() => onNavigate('custom-software')}>Learn more</Button>
              </div>
           </div>
           
           <div className="p-10 rounded-[2rem] border border-murzak-accent/30 bg-murzak-accent/5 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-8 opacity-20 text-murzak-accent group-hover:scale-110 transition-transform duration-700">
                <Cloud size={120} strokeWidth={1} />
              </div>
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/20 text-murzak-accent text-micro font-black uppercase mb-6">Infrastructure</div>
                <h3 className="text-3xl font-black mb-4">Murzak Cloud</h3>
                <p className="text-slate-500 mb-8 max-w-sm">Nairobi-managed website hosting, business email, and secure file storage for your team.</p>
                <Button variant="primary" onClick={() => onNavigate('cloud')}>Explore Cloud</Button>
              </div>
           </div>
        </div>
      </Section>

      {/* Industries */}
      <Section className="border-t border-murzak-border/50">
        <div className="max-w-2xl mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">Built for your industry</h2>
           <p className="text-slate-500 font-medium">See how our stack solves specific problems for your sector.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
           {industries.map((item, idx) => (
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-6 rounded-2xl border border-murzak-border bg-black/5 hover:bg-black/5 transition-all text-center">
                <div className="text-slate-500 group-hover:text-murzak-accent transition-colors mb-4 flex justify-center">{item.icon}</div>
                <h4 className="font-bold text-sm">{item.title}</h4>
             </div>
           ))}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="relative py-24 overflow-hidden border-t border-murzak-border/50">
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink mb-6">Ready to see prices?</h2>
          <Button variant="primary" onClick={() => onNavigate('pricing')}>
            Build your plan <ArrowRight size={17} />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default Products;
