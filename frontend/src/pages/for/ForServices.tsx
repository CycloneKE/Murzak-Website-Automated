import React from 'react';
import { ArrowRight, Briefcase, FileSignature, CheckSquare, MessageSquare } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';

interface Props {
  onNavigate: (page: string) => void;
}

const ForServices: React.FC<Props> = ({ onNavigate }) => {

  const stack = [
    { title: "Murzak CRM", desc: "Pipeline visibility, lead tracking, and automated follow-ups.", path: "crm", icon: <MessageSquare size={24} /> },
    { title: "Murzak ERP", desc: "Project profitability, timesheets, and professional invoicing.", path: "erp", icon: <Briefcase size={24} /> },
    { title: "Client Portal", desc: "Secure portal for clients to approve proposals and view progress.", path: "custom-software", icon: <FileSignature size={24} /> }
  ];

  return (
    <main className="text-white overflow-x-hidden">
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-cyan/10 border border-murzak-cyan/20 mb-6">
            <span className="text-[10px] font-black uppercase tracking-widest text-murzak-cyan">For Professional Services</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] mx-auto max-w-4xl">
            Win more clients. Deliver on time. <span className="text-murzak-gradient">Get paid faster.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl mx-auto leading-relaxed">
            We're building the technology layer Kenya's service businesses have been waiting for. Stop chasing invoices and sending proposals in Word docs.
          </p>
        </div>
      </section>


      <Section className="border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center mb-12">
           <h2 className="text-3xl font-[900] tracking-tight mb-4">The Murzak Services Stack</h2>
           <p className="text-slate-400 font-medium mb-8">Integrated tools from first pitch to final invoice.</p>
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
          <h2 className="text-3xl font-[900] tracking-tight text-white mb-6">Ready to professionalize your workflow?</h2>
          <Button variant="onDark" onClick={() => onNavigate('pricing')}>
            Configure your service stack <ArrowRight size={17} />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default ForServices;
