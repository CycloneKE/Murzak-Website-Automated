
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Globe, Mail, Database, HardDrive, ShieldCheck, RefreshCw,
  Activity, Headphones, Smartphone,
} from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';

type CloudProps = NavProps & { isLoggedIn?: boolean };

const Cloud: React.FC<CloudProps> = ({ onNavigate, isLoggedIn = false }) => {
  const [searchParams] = useSearchParams();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchServiceId, setLaunchServiceId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const launch = searchParams.get('launch');
    if (launch) {
      setLaunchServiceId(launch);
      setLaunchOpen(true);
    }
  }, [searchParams]);
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
    <main className="text-murzak-ink overflow-x-hidden">
      {/* Hero */}
      <section className="relative min-h-[90vh] lg:min-h-screen flex items-center pt-32 lg:pt-48 pb-16 overflow-hidden -mt-16 sm:-mt-20 lg:-mt-24">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/server-glow.jpg')" }} />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-300/70 via-slate-300/55 to-transparent" />
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow z-0" />
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 w-full grid lg:grid-cols-12 gap-12 items-center relative z-10">
          <div className="lg:col-span-7 rounded-[2.5rem] border border-transparent bg-white/60 backdrop-blur-md p-8 sm:p-10 lg:p-14 shadow-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-5">Murzak Cloud</p>
            <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
              Hosting that just <span className="text-murzak-gradient">stays up.</span>
            </h1>
            <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-xl leading-relaxed">
              Your site, email and apps — set up, secured and backed up by us, on fast infrastructure,
              billed in shillings. You get the result; we handle the servers.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-4">
              <Button onClick={() => { setLaunchServiceId(undefined); setLaunchOpen(true); }}>
                Launch a resource <ArrowRight size={18} />
              </Button>
              <Button variant="outline" onClick={() => onNavigate('test-request')}>
                Try it free for 36h
              </Button>
            </div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-widest text-slate-500">No card required · Live in a day</p>
          </div>

          <div className="lg:col-span-5 rounded-[2.5rem] border border-transparent bg-white/60 backdrop-blur-md p-8 sm:p-10 shadow-2xl flex flex-col gap-8">
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <Database size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink mb-1.5">Enterprise Infrastructure</h3>
              <p className="text-[13px] text-slate-500 font-medium leading-relaxed">Built on blazing-fast NVMe SSDs and robust processors. Your applications run with zero bottlenecks.</p>
            </div>
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <Globe size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink mb-1.5">Local Datacenter</h3>
              <p className="text-[13px] text-slate-500 font-medium leading-relaxed">Low latency access across East Africa. Keep your data local, fast, and compliant.</p>
            </div>
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <ShieldCheck size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink mb-1.5">Fully Managed Security</h3>
              <p className="text-[13px] text-slate-500 font-medium leading-relaxed">Active DDoS protection, daily backups, and regular patching handled automatically by our team.</p>
            </div>
          </div>
        </div>
      </section>

      {/* GLOBAL BACKGROUND WRAPPER */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/Data center.jpg')" }} />
        <div className="absolute inset-0 z-0 bg-murzak-accent/5 mix-blend-color" />
        

      {/* What you can host */}
      <section className="py-16 lg:py-24 border-t border-murzak-border/50 relative overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-3">What you can host</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Everything your business runs online.</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {whatYouCanHost.map((c) => (
              <div key={c.t} className="flex items-start gap-5 rounded-3xl border border-transparent bg-white/60 backdrop-blur-md p-7 transition-all hover:border-white/60 hover:bg-white/40">
                <span className="shrink-0 inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent">{c.icon}</span>
                <div>
                  <h3 className="text-lg font-black text-murzak-ink mb-1.5">{c.t}</h3>
                  <p className="text-[13px] text-slate-500 font-medium leading-relaxed">{c.s}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Managed for you */}
      <section className="py-16 lg:py-24 relative overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-3">Fully managed</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The parts you'd rather not think about.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {managed.map((c) => (
              <div key={c.t} className="rounded-3xl border border-transparent bg-white/60 backdrop-blur-md p-7">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                <h3 className="text-base font-black text-murzak-ink mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-500 font-medium leading-relaxed">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Local edge strip */}
      <section className="py-12 border-y border-murzak-border/50 relative overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-14 text-center relative z-10">
          {[
            { icon: <Smartphone size={18} />, t: 'Pay by M-Pesa' },
            { icon: <ShieldCheck size={18} />, t: 'Billed in shillings' },
            { icon: <Headphones size={18} />, t: 'Nairobi support' },
          ].map((c) => (
            <div key={c.t} className="flex items-center gap-3 text-murzak-ink">
              <span className="text-murzak-accent">{c.icon}</span>
              <span className="font-black text-sm">{c.t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center relative z-10">
          <div className="rounded-[2.5rem] border border-transparent bg-white/60 backdrop-blur-md p-10 sm:p-14 shadow-2xl">
            <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink">Move your hosting somewhere it's handled.</h2>
            <p className="mt-4 text-lg text-slate-600 font-medium">Build a plan in two minutes, or try it free for 36 hours first.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="primary" onClick={() => onNavigate('pricing')}>
                Build my plan <ArrowRight size={18} />
              </Button>
              <Button variant="outline" onClick={() => onNavigate('test-request')}>
                Start free trial
              </Button>
            </div>
          </div>
        </div>
      </section>
      </div>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={launchServiceId}
      />
    </main>
  );
};

export default Cloud;
