
import React from 'react';
import {
  ArrowRight, Globe, Mail, Database, HardDrive, ShieldCheck, RefreshCw,
  Activity, Headphones, Smartphone,
} from 'lucide-react';
import { NavProps } from '../types';

const Cloud: React.FC<NavProps> = ({ onNavigate }) => {
  const whatYouCanHost = [
    { icon: <Globe size={20} />, t: 'Websites & online stores', s: 'WordPress, custom sites, light e-commerce — fast and SSL-secured.' },
    { icon: <Mail size={20} />, t: 'Business email', s: 'Professional mail on your domain, with spam filtering and admin controls.' },
    { icon: <Database size={20} />, t: 'Databases', s: 'Managed MySQL/Postgres for your apps, tuned and backed up.' },
    { icon: <HardDrive size={20} />, t: 'File storage', s: 'A private cloud drive for your team — share without the chaos.' },
  ];

  const managed = [
    { icon: <ShieldCheck size={22} />, t: 'Secured & patched', s: 'Firewalls and security updates handled for you — not left for "later".' },
    { icon: <RefreshCw size={22} />, t: 'Backed up daily', s: 'Automatic daily backups, so a bad day never becomes a lost week.' },
    { icon: <Activity size={22} />, t: 'Watched around the clock', s: 'We monitor your systems and step in before small issues become outages.' },
    { icon: <Headphones size={22} />, t: 'Real support', s: 'A Nairobi team that answers the same day — not a ticket queue overseas.' },
  ];

  return (
    <main className="text-white overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-murzak-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-5">Murzak Cloud</p>
          <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            Hosting that just <span className="text-murzak-gradient">stays up.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-xl leading-relaxed">
            Your site, email and apps — set up, secured and backed up by us, on fast infrastructure,
            billed in shillings. You get the result; we handle the servers.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <button onClick={() => onNavigate('pricing')} className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-cyan text-murzak-navy px-7 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] transition-all shadow-lg shadow-murzak-cyan/20">
              Build my plan <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button onClick={() => onNavigate('test-request')} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-7 py-4 font-black text-sm uppercase tracking-widest text-white hover:bg-white/10 transition-all">
              Try it free for 36h
            </button>
          </div>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-widest text-slate-400">No card required · Live in a day</p>
        </div>
      </section>

      {/* What you can host */}
      <section className="py-16 lg:py-24 border-t border-white/5">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">What you can host</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Everything your business runs online.</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {whatYouCanHost.map((c) => (
              <div key={c.t} className="flex items-start gap-5 rounded-3xl border border-white/10 bg-white/[0.03] p-7 transition-all hover:border-murzak-cyan/40 hover:bg-white/[0.05]">
                <span className="shrink-0 inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan">{c.icon}</span>
                <div>
                  <h3 className="text-lg font-black text-white mb-1.5">{c.t}</h3>
                  <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{c.s}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Managed for you */}
      <section className="py-16 lg:py-24">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-cyan mb-3">Fully managed</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The parts you'd rather not think about.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {managed.map((c) => (
              <div key={c.t} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-cyan/10 text-murzak-cyan mb-5">{c.icon}</div>
                <h3 className="text-base font-black text-white mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-400 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Local edge strip */}
      <section className="py-12 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-14 text-center">
          {[
            { icon: <Smartphone size={18} />, t: 'Pay by M-Pesa' },
            { icon: <ShieldCheck size={18} />, t: 'Billed in shillings' },
            { icon: <Headphones size={18} />, t: 'Nairobi support' },
          ].map((c) => (
            <div key={c.t} className="flex items-center gap-3 text-white">
              <span className="text-murzak-cyan">{c.icon}</span>
              <span className="font-black text-sm">{c.t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-white/10" />
        <div className="absolute inset-0 -z-10 bg-murzak-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-white">Move your hosting somewhere it's handled.</h2>
          <p className="mt-4 text-lg text-white/85 font-medium">Build a plan in two minutes, or try it free for 36 hours first.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => onNavigate('pricing')} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white text-murzak-navy px-8 py-4 font-black text-sm uppercase tracking-widest hover:scale-[1.03] transition-all shadow-xl">
              Build my plan <ArrowRight size={18} />
            </button>
            <button onClick={() => onNavigate('test-request')} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-white/40 px-8 py-4 font-black text-sm uppercase tracking-widest text-white hover:bg-white/10 transition-all">
              Start free trial
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Cloud;
