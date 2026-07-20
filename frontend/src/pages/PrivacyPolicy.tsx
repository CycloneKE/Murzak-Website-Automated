import React from 'react';
import { ShieldCheck, Lock, Eye, Database, FileText } from 'lucide-react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="animate-fade-in bg-transparent text-murzak-ink dark:text-slate-100 transition-colors duration-300">
      <section className="relative min-h-[60vh] flex items-start pt-12 lg:pt-24 pb-20 overflow-hidden bg-transparent">
        <div className="absolute inset-0 z-[-1] bg-murzak-ink">
          <img
            src="https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&w=1600&q=65"
            alt="Secure Data Sovereignty"
            className="w-full h-full object-cover opacity-20 dark:opacity-40 transition-opacity duration-700"
            style={{ fetchPriority: 'high' } as any}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10 w-full">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full bg-murzak-accent/10 px-4 py-2 text-micro font-black text-murzak-accent mb-8 uppercase border border-murzak-accent/20 backdrop-blur-md">
              Compliance & data safety
            </div>
            <h1 className="text-5xl lg:text-9xl font-[900] text-murzak-ink dark:text-slate-100 mb-10 tracking-tighter leading-[0.85] drop-shadow-2xl">
              Privacy <br /><span className="text-murzak-accent">protocol.</span>
            </h1>
            <p className="text-xl lg:text-3xl text-slate-700 dark:text-slate-400 font-bold max-w-2xl opacity-90">
              Regional data integrity aligned with the Kenya Data Protection Act 2019.
            </p>
          </div>
        </div>
      </section>

      <section className="relative py-20 lg:py-32 bg-white/80 dark:bg-white/5 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 lg:px-12">
          <div className="prose dark:prose-invert prose-slate max-w-none space-y-20">
            <div className="bg-slate-50 dark:bg-black/5 p-10 lg:p-14 rounded-[3rem] border border-slate-100 dark:border-murzak-border/50 flex flex-col md:flex-row gap-10 shadow-xl">
              <ShieldCheck size={48} className="text-murzak-accent flex-shrink-0" />
              <div>
                <h3 className="text-2xl font-black mb-4 tracking-tight text-murzak-ink dark:text-slate-100">Data sovereignty commitment</h3>
                <p className="text-base text-slate-600 dark:text-slate-400 font-medium leading-relaxed">Murzak Technologies Limited is committed to the protection of business and personal data as per the <span className="text-murzak-ink dark:text-slate-100 font-bold">Kenya Data Protection Act 2019</span>. We ensure all regional client data hosted on Murzak Cloud remains within secure architectural bounds.</p>
              </div>
            </div>

            <div className="space-y-8">
              <h2 className="text-3xl font-black flex items-center gap-4 text-murzak-ink dark:text-slate-100 tracking-tighter">
                <Database size={28} className="text-murzak-accent" /> 1. Information we collect
              </h2>
              <p className="text-slate-600 dark:text-slate-400 font-medium leading-relaxed">To provide enterprise-grade services, we collect:</p>
              <ul className="list-disc pl-8 space-y-4 text-slate-500 dark:text-slate-400 font-bold">
                <li><strong className="text-murzak-ink dark:text-slate-100">Contact information:</strong> Name, work email, phone number, and company details via our contact and CRM sync forms.</li>
                <li><strong className="text-murzak-ink dark:text-slate-100">Project data:</strong> Technical requirements, business workflows, and infrastructure preferences shared during consultations.</li>
                <li><strong className="text-murzak-ink dark:text-slate-100">Usage metrics:</strong> Anonymous data on how you interact with our website to improve user experience.</li>
              </ul>
            </div>

            <div className="bg-murzak-ink text-white p-12 lg:p-20 rounded-[4rem] mt-24 shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-6 mb-10">
                <FileText size={32} className="text-murzak-accent" />
                <h3 className="text-2xl font-black tracking-tighter">Compliance inquiries</h3>
              </div>
              <p className="text-base text-slate-500 font-bold mb-10 leading-relaxed">
                If you have concerns about your data, or wish to request a data audit as per DPA guidelines, please contact our Compliance Officer:
              </p>
              <p className="text-2xl font-black text-murzak-accent tracking-tight">murzaktechnologies@gmail.com</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PrivacyPolicy;
