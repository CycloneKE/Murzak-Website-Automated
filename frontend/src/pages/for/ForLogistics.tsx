import React, { useState } from 'react';
import { ArrowRight, Truck, MapPin, Package, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import SalesModal from '../../components/SalesModal';

interface Props {
  onNavigate: (page: string) => void;
}

const ForLogistics: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const stack = [
    { title: "Custom Dispatch System", desc: "Driver tracking, route planning, and real-time statuses.", path: "custom-software", icon: <MapPin size={24} /> },
    { title: "Murzak ERP", desc: "Fleet management, asset tracking, and comprehensive accounting.", path: "erp", icon: <Truck size={24} /> },
    { title: "Customer Portal", desc: "Self-serve portal for your clients to track shipments.", path: "custom-software", icon: <Users size={24} /> }
  ];

  return (
    <main className="text-white overflow-x-hidden">
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-cyan/10 border border-murzak-cyan/20 mb-6">
            <span className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">For Logistics & Distribution</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] mx-auto max-w-4xl">
            Track every delivery. Route every driver. <span className="text-murzak-gradient">Stop running dispatch on WhatsApp.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl mx-auto leading-relaxed">
            We're building the technology layer Kenya's logistics sector has been waiting for. Eliminate delivery disputes and manual tracking.
          </p>
        </div>
      </section>

      {/* Hero Image */}
      <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 -mt-4 mb-12">
        <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-white/10 group">
          <img 
            src="/images/for-logistics.png" 
            alt="Futuristic logistics tracking visualization with delivery routes and fleet management" 
            className="w-full rounded-[2rem] transition-transform duration-700 group-hover:scale-[1.02]" 
            loading="lazy"
          />
          <div className="absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-murzak-deep/80 via-murzak-deep/20 to-murzak-deep/30 rounded-[2rem]" />
        </div>
      </div>

      <Section className="border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">The Murzak Logistics Stack</h2>
           <p className="text-slate-400 font-medium mb-8">Integrated tracking, fleet management, and M-Pesa COD collections.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
           {stack.map((item, idx) => (
             <div key={idx} onClick={() => onNavigate(item.path)} className="cursor-pointer group p-8 rounded-3xl border border-white/10 bg-murzak-navy/80 hover:border-murzak-cyan/40 transition-all">
                <div className="text-murzak-cyan mb-5 opacity-80 group-hover:opacity-100 transition-opacity">{item.icon}</div>
                <h3 className="text-xl font-black mb-3">{item.title}</h3>
                <p className="text-sm text-slate-400 mb-6">{item.desc}</p>
                <div className="text-murzak-cyan text-sm font-bold flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                  View {item.title} <ArrowRight size={14} />
                </div>
             </div>
           ))}
        </div>
      </Section>

      <section className="relative py-24 overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-white mb-6">Ready to streamline your fleet?</h2>
          <Button variant="onDark" onClick={() => setSalesOpen(true)}>
            Start a custom build <ArrowRight size={17} />
          </Button>
        </div>
      </section>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </main>
  );
};

export default ForLogistics;
