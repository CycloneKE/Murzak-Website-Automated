import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, Code, Terminal, Layers, Truck, CalendarDays, Smartphone, LayoutDashboard, Globe } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';

interface Props {
  onNavigate: (page: string) => void;
}

const CustomSoftware: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const whatWeBuild = [
    { icon: <Truck size={20} />, title: "Dispatch & Logistics", desc: "Driver tracking, route planning, and automated customer updates via SMS/WhatsApp." },
    { icon: <Globe size={20} />, title: "Customer Portals", desc: "Secure web portals for your clients to view their accounts, statements, or project status." },
    { icon: <Smartphone size={20} />, title: "M-Pesa Integrations", desc: "B2B, B2C, and C2B API integrations to automate your payment reconciliation." },
    { icon: <CalendarDays size={20} />, title: "Booking & Scheduling", desc: "Custom reservation systems for clinics, fleets, or specialized services." },
    { icon: <LayoutDashboard size={20} />, title: "Internal Dashboards", desc: "Pull data from multiple spreadsheets and legacy systems into one clean, live view." },
    { icon: <Layers size={20} />, title: "Platform Modernization", desc: "Taking your 10-year-old Access database and turning it into a secure web application." },
  ];

  const faqs: FaqItem[] = [
    { q: "How much does a custom build cost?", a: "Projects typically start from KES 150,000 depending on complexity. We scope the work entirely upfront so there are no surprise bills later." },
    { q: "Who owns the code?", a: "You do. Upon project completion and final payment, the intellectual property and source code belong entirely to your company." },
    { q: "Do you maintain it after it's built?", a: "Yes. In fact, that's our whole model. We build it, host it on Murzak Cloud, and provide ongoing maintenance and support for a predictable monthly fee." },
    { q: "How long does a build take?", a: "Simple integrations or portals can take 3-4 weeks. Larger operational systems generally take 2-4 months." },
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero Section — real code-on-screen photo behind the headline */}
      <section className="relative min-h-[65vh] flex items-center pt-32 lg:pt-40 pb-16 overflow-hidden -mt-16 sm:-mt-20 lg:-mt-24">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/custom-software-hero.webp')" }} />
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-murzak-ink/92 via-murzak-ink/75 to-murzak-ink/40" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 mb-6">
            <span className="text-micro font-black uppercase text-murzak-accent">Custom Software Development</span>
          </div>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl text-white">
            When off-the-shelf <span className="text-murzak-gradient">won't cut it.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl leading-relaxed">
            We design and build the exact system your business needs. And unlike typical agencies, we don't just hand over the code and disappear — we host it and keep it running.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => setSalesOpen(true)}>
              Start a Build — Get a Quote <ArrowRight size={18} />
            </Button>
            <Button variant="outlineOnDark" onClick={() => onNavigate('products')}>
              View Ready-Made Products
            </Button>
          </div>
        </div>
      </section>

      {/* GLOBAL BACKGROUND WRAPPER — one shared background image behind every
          section below the hero, instead of a different image per section. */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-20" style={{ backgroundImage: "url('/images/customsoftware-section-bg.webp')" }} />
        <div className="absolute inset-0 z-0 bg-murzak-base/90 dark:bg-murzak-ink/90" />

        {/* The Process */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-3">How we work</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">One team. No ghosting.</h2>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
             <div className="p-6 rounded-2xl bg-black/5 border border-murzak-border relative">
                <div className="absolute top-4 right-4 text-slate-600 font-black text-4xl opacity-30">1</div>
                <h3 className="font-bold text-murzak-ink dark:text-slate-100 mb-2 text-lg">We Listen</h3>
                <p className="text-sm text-slate-500">We map out your current bottlenecks, spreadsheets, and manual processes.</p>
             </div>
             <div className="p-6 rounded-2xl bg-black/5 border border-murzak-border relative">
                <div className="absolute top-4 right-4 text-slate-600 font-black text-4xl opacity-30">2</div>
                <h3 className="font-bold text-murzak-ink dark:text-slate-100 mb-2 text-lg">Design & Quote</h3>
                <p className="text-sm text-slate-500">You get a clickable wireframe and a fixed-price quote before writing any code.</p>
             </div>
             <div className="p-6 rounded-2xl bg-murzak-accent/10 border border-murzak-accent/30 relative">
                <div className="absolute top-4 right-4 text-murzak-accent/20 font-black text-4xl">3</div>
                <h3 className="font-bold text-murzak-ink dark:text-slate-100 mb-2 text-lg">We Build</h3>
                <p className="text-sm text-slate-500">Our Nairobi-based engineers build your system with weekly demo updates.</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/60 dark:bg-white/5 border border-murzak-border relative">
                <div className="absolute top-4 right-4 text-slate-600 dark:text-slate-400 font-black text-4xl opacity-30">4</div>
                <h3 className="font-bold text-murzak-ink dark:text-slate-100 mb-2 text-lg">We Run It</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">We deploy it to Murzak Cloud, handle the backups, and provide ongoing support.</p>
             </div>
          </div>
        </Section>

        {/* Quality before it ships */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="max-w-2xl">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-3">Before it ships</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight mb-5">We test it like it's our own business on the line.</h2>
            <p className="text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
              Every build goes through a real review pass — payment flows, edge cases, and the things that only break in production — before we hand you the keys. If it's not something we'd trust with our own operations, it doesn't ship.
            </p>
          </div>
        </Section>

        {/* What we build */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="text-center max-w-2xl mx-auto mb-12">
             <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Examples of what we build</h2>
             <p className="text-slate-500 font-medium">If your team is doing it manually on WhatsApp or Excel, we can automate it.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {whatWeBuild.map((w, i) => (
              <div key={i} className="rounded-3xl border border-murzak-border bg-slate-900/50 p-7">
                <div className="text-murzak-accent mb-4">
                  {w.icon}
                </div>
                <h3 className="text-md font-black text-white mb-2">{w.title}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Deep Dive: Code viz */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
             <div>
                <h2 className="text-3xl font-[900] tracking-tight mb-5">Built on modern, robust technology.</h2>
                <p className="text-slate-500 font-medium leading-relaxed mb-6">
                   We don't use fragile drag-and-drop builders. We write clean, scalable code using industry-standard frameworks ensuring your application is fast, secure, and maintainable for years to come.
                </p>
                <div className="flex flex-wrap gap-2">
                   {['React', 'Node.js', 'Python', 'PostgreSQL', 'Flutter', 'Tailwind'].map(tech => (
                     <span key={tech} className="px-3 py-1 rounded-full bg-black/5 text-xs font-mono text-slate-600">
                       {tech}
                     </span>
                   ))}
                </div>
             </div>
             <div className="rounded-[2rem] bg-[#0d1117] border border-murzak-border shadow-2xl p-6 font-mono text-label sm:text-xs overflow-hidden">
                <div className="flex gap-2 mb-4">
                   <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                   <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                   <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                </div>
                <div className="text-slate-500">
                  <span className="text-purple-400">export</span> <span className="text-purple-400">const</span> <span className="text-blue-400">processMpesaPayment</span> = <span className="text-purple-400">async</span> (req: Request) =&gt; {'{'}
                  <br />
                  &nbsp;&nbsp;<span className="text-purple-400">const</span> {'{'} phoneNumber, amount, reference {'}'} = req.body;
                  <br />
                  <br />
                  &nbsp;&nbsp;<span className="text-slate-500">// 1. Initiate STK Push via Daraja API</span>
                  <br />
                  &nbsp;&nbsp;<span className="text-purple-400">const</span> response = <span className="text-purple-400">await</span> mpesaClient.stkPush({'{'}
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;phoneNumber,
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;amount,
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;accountReference: reference
                  <br />
                  &nbsp;&nbsp;{'}'});
                  <br />
                  <br />
                  &nbsp;&nbsp;<span className="text-slate-500">// 2. Create pending record in database</span>
                  <br />
                  &nbsp;&nbsp;<span className="text-purple-400">await</span> db.transactions.insert({'{'}
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;checkoutRequestId: response.CheckoutRequestID,
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;status: <span className="text-green-300">'PENDING'</span>,
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;timestamp: <span className="text-purple-400">new</span> Date()
                  <br />
                  &nbsp;&nbsp;{'}'});
                  <br />
                  <br />
                  &nbsp;&nbsp;<span className="text-purple-400">return</span> response;
                  <br />
                  {'}'};
                </div>
             </div>
          </div>
        </Section>

        {/* FAQ */}
        <Section className="relative z-10 border-t border-murzak-border/50">
          <Faq items={faqs} />
        </Section>
      </div>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </main>
  );
};

export default CustomSoftware;
