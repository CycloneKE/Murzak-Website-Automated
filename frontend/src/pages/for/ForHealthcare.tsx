import React, { useState } from 'react';
import { ArrowRight, Stethoscope, FileText, CalendarCheck, ShieldAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import SalesModal from '../../components/SalesModal';

interface Props {
  onNavigate: (page: string) => void;
}

const ForHealthcare: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const stack = [
    { title: "Murzak ERP (Healthcare)", desc: "Patient records, billing, inventory for pharmacy and lab.", path: "erp", icon: <FileText size={24} /> },
    { title: "Custom Booking System", desc: "Online scheduling for patients, integrated with doctors' calendars.", path: "custom-software", icon: <CalendarCheck size={24} /> },
    { title: "Secure Cloud Storage", desc: "Private, managed cloud storage for medical records and imaging.", path: "cloud", icon: <ShieldAlert size={24} /> }
  ];

  return (
    <main className="text-white overflow-x-hidden">
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-cyan/10 border border-murzak-cyan/20 mb-6">
            <span className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">For Clinics & Healthcare</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] mx-auto max-w-4xl">
            Focus on patients, not paperwork. <span className="text-murzak-gradient">Records, billing and scheduling — sorted.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl mx-auto leading-relaxed">
            We're building the technology layer Kenya's healthcare providers have been waiting for. Ditch the paper records and disjointed billing systems.
          </p>
        </div>
      </section>


      <Section className="border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">The Murzak Healthcare Stack</h2>
           <p className="text-slate-400 font-medium mb-8">Integrated, secure, and compliant with the Kenya Data Protection Act.</p>
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
          <h2 className="text-3xl font-[900] tracking-tight text-white mb-6">Ready to digitize your clinic?</h2>
          <Button variant="onDark" onClick={() => setSalesOpen(true)}>
            Talk to us about your clinic <ArrowRight size={17} />
          </Button>
        </div>
      </section>
      
      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </main>
  );
};

export default ForHealthcare;
