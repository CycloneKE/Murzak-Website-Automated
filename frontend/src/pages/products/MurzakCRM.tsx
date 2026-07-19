import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, MessageSquare, Mail, Phone, Users, CheckCircle, BarChart3 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
}

const MurzakCRM: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const features = [
    { icon: <BarChart3 size={20} />, title: "Sales Pipeline", desc: "Drag-and-drop kanban boards to track leads from first contact to closed deal." },
    { icon: <MessageSquare size={20} />, title: "Support Ticketing", desc: "Convert customer emails into trackable tickets. Assign, tag, and resolve." },
    { icon: <Mail size={20} />, title: "Email Integration", desc: "Sync your business email. Read and reply to clients without leaving the CRM." },
    { icon: <Phone size={20} />, title: "WhatsApp Integration", desc: "Centralize WhatsApp communications so your team shares one inbox." },
  ];

  const faqs: FaqItem[] = [
    { q: "Does it integrate with my website?", a: "Yes, you can embed contact forms on your website that automatically create leads or tickets in Murzak CRM." },
    { q: "Can I connect it to Murzak ERP?", a: "Absolutely. They share the same underlying framework, meaning a lead won in the CRM seamlessly becomes a customer in the ERP for invoicing." },
    { q: "How many users can I have?", a: "The base subscription covers your whole core team, and we scale resources seamlessly as your data and user base grow." },
  ];

  return (
    <main className="text-murzak-ink overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-murzak-accent/10 border border-murzak-accent/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">Murzak CRM & Helpdesk</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            Every lead tracked. <span className="text-murzak-gradient">Every ticket answered.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl leading-relaxed">
            Stop losing leads in personal WhatsApp threads. Centralize your sales and customer support in one place.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => onNavigate('/pricing?configure=biz-crm-helpdesk')}>
              Start from {formatKes(serviceMonthlyKes('biz-crm-helpdesk'))}/mo <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => setSalesOpen(true)}>
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <Section className="border-t border-murzak-border/50">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f, i) => (
            <div key={i} className="rounded-3xl border border-transparent bg-white/60 backdrop-blur-md p-7 hover:border-murzak-accent/40 transition-colors">
              <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">
                {f.icon}
              </div>
              <h3 className="text-lg font-black text-murzak-ink mb-2">{f.title}</h3>
              <p className="text-[13px] text-slate-500 font-medium leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Deep Dive */}
      <Section className="border-t border-murzak-border/50 bg-white/[0.02]">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-[900] tracking-tight mb-5">Visual sales pipelines.</h2>
            <p className="text-slate-500 font-medium leading-relaxed mb-6">
              Know exactly where every deal stands. Customize your pipeline stages to match your actual sales process, and drag deals across the board as they progress.
            </p>
            <ul className="space-y-3">
               {['Automated follow-up reminders', 'Revenue forecasting', 'Deal win/loss analysis'].map((item, idx) => (
                 <li key={idx} className="flex items-center gap-3 text-sm font-bold text-murzak-ink">
                   <CheckCircle size={16} className="text-murzak-accent" /> {item}
                 </li>
               ))}
            </ul>
          </div>
          
          <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-murzak-border group">
            <img 
              src="/images/crm-kanban.png" 
              alt="Murzak CRM Kanban board showing sales pipeline stages" 
              className="w-full rounded-[2rem] transition-transform duration-700 group-hover:scale-[1.02]" 
              loading="lazy"
            />
            <div className="absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-white/10" />
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
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink mb-6">Never miss a follow-up.</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" onClick={() => onNavigate('/pricing?configure=biz-crm-helpdesk')}>
              Configure CRM <ArrowRight size={17} />
            </Button>
          </div>
        </div>
      </section>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="demo" />
    </main>
  );
};

export default MurzakCRM;
