
import React from 'react';
import { Gavel, Scale, FileCheck, Briefcase, CreditCard } from 'lucide-react';

const TermsOfService: React.FC = () => {
  return (
    <div className="animate-fade-in bg-transparent text-murzak-ink transition-colors duration-300">
      <section className="relative min-h-[60vh] flex items-start pt-12 lg:pt-24 pb-20 overflow-hidden bg-transparent">
        <div className="absolute inset-0 z-[-1] bg-murzak-ink">
          <img 
            src="https://images.unsplash.com/photo-1589254065878-42c9da997008?auto=format&w=1600&q=65" 
            alt="Murzak Legal Framework" 
            className="w-full h-full object-cover opacity-20 dark:opacity-40 transition-opacity duration-700"
            style={{ fetchPriority: 'high' } as any}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10 w-full">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full bg-murzak-accent/10 px-4 py-2 text-[10px] font-black text-murzak-accent mb-8 uppercase tracking-widest border border-murzak-accent/20 backdrop-blur-md">
              Legal framework
            </div>
            <h1 className="text-5xl lg:text-9xl font-[900] text-murzak-ink mb-10 tracking-tighter leading-[0.85] drop-shadow-2xl">
              Service <br /><span className="text-murzak-accent">terms.</span>
            </h1>
            <p className="text-xl lg:text-3xl text-slate-700 dark:text-slate-600 font-bold max-w-2xl opacity-90">
              The foundational logic governing our custom engineering and cloud partnerships.
            </p>
          </div>
        </div>
      </section>

      <section className="relative py-20 lg:py-32 bg-white/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 lg:px-12">
          <div className="prose dark:prose-invert prose-slate max-w-none space-y-20">
            <div className="bg-slate-50 dark:bg-black/5 p-10 lg:p-14 rounded-[3rem] border border-slate-100 dark:border-murzak-border/50 flex flex-col md:flex-row gap-10 shadow-xl">
              <Scale size={48} className="text-murzak-accent flex-shrink-0" />
              <div>
                <h3 className="text-2xl font-black mb-4 tracking-tight text-murzak-ink">Operating principles</h3>
                <p className="text-base text-slate-600 dark:text-slate-500 font-medium leading-relaxed">By engaging with Murzak Technologies Limited, you agree to the following terms governing custom software engineering and managed cloud infrastructure services.</p>
              </div>
            </div>

            <div className="space-y-8">
              <h2 className="text-3xl font-black flex items-center gap-4 text-murzak-ink tracking-tighter">
                <Briefcase size={28} className="text-murzak-accent" /> 1. Custom software ownership
              </h2>
              <p className="text-slate-600 dark:text-slate-500 font-bold leading-relaxed">
                Upon final payment for a custom software project, full intellectual property (IP) rights for the application code are transferred to the client. Murzak Technologies retains ownership of any pre-existing proprietary libraries or modules used to facilitate development.
              </p>
            </div>

            <div className="space-y-8">
              <h2 className="text-3xl font-black flex items-center gap-4 text-murzak-ink tracking-tighter">
                <CreditCard size={28} className="text-murzak-accent" /> 2. Payment & currency
              </h2>
              <p className="text-slate-600 dark:text-slate-500 font-bold leading-relaxed">
                All services are invoiced in <strong className="text-murzak-ink">Kenya Shillings (KES)</strong> unless otherwise agreed. Monthly subscriptions for Murzak Cloud are billed in advance. Late payments exceeding 15 days may result in temporary service suspension.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default TermsOfService;
