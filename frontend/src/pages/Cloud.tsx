import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, Globe, Mail, Database, HardDrive, ShieldCheck, RefreshCw,
  Activity, Headphones, Smartphone, Github, Sparkles, Layers, Cpu, Server, Check
} from 'lucide-react';
import { NavProps, Page } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';
import MetricBar from '../components/mockups/MetricBar';

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

  const cloudResources = [
    {
      icon: <Globe size={24} />,
      title: "Domains & DNS Ingress",
      desc: "Search and register .co.ke, .com, or .ke with instant M-Pesa STK push. Auto-provisioning Let's Encrypt TLS certificates and 1-click cloud attach.",
      path: "/cloud/domains",
      badge: "Ingress",
      stat: "From KES 100/mo",
    },
    {
      icon: <Layers size={24} />,
      title: "WordPress & Websites",
      desc: "Enterprise LiteSpeed-accelerated WordPress and WooCommerce. Sub-second load times, automated daily backups, and staging environments.",
      path: "/cloud/wordpress",
      badge: "CMS",
      stat: "From KES 1,800/mo",
    },
    {
      icon: <Database size={24} />,
      title: "Managed Databases",
      desc: "MySQL 8, PostgreSQL 16, Redis 7, and MongoDB in Nairobi. Point-in-time recovery, automated daily S3 backups, and zero tuning headache.",
      path: "/cloud/databases",
      badge: "Engines",
      stat: "From KES 1,800/mo",
    },
    {
      icon: <Sparkles size={24} />,
      title: "n8n Automation Engine",
      desc: "Your private, dedicated n8n workflow server. Automate Safaricom M-Pesa Daraja payment callbacks, WhatsApp receipts, and ERP reconciliation.",
      path: "/cloud/n8n",
      badge: "Workflows",
      stat: "From KES 2,500/mo",
    },
    {
      icon: <Mail size={24} />,
      title: "Business Email",
      desc: "Professional inboxes on your custom domain (`you@company.co.ke`). Includes free email forwarding (0 KES) or full 5-mailbox webmail suites.",
      path: "/cloud/email",
      badge: "Communication",
      stat: "Free Forwarding / KES 1,500/mo",
    },
    {
      icon: <Github size={24} />,
      title: "App Hosting (BYOA)",
      desc: "Connect your GitHub repository and we build, containerize, and keep your Node.js, Python, or Go app running on fast NVMe processors.",
      path: "/deploy",
      badge: "Compute",
      stat: "From KES 2,500/mo",
    },
  ];

  const managed = [
    { icon: <ShieldCheck size={22} />, t: 'Secured & patched', s: 'Firewalls and security updates handled for you. Not left for "later".' },
    { icon: <RefreshCw size={22} />, t: 'Backed up daily', s: 'Automatic daily backups, so a bad day never becomes a lost week.' },
    { icon: <Activity size={22} />, t: 'Watched around the clock', s: 'We monitor your systems and step in before small issues become outages.' },
    { icon: <Headphones size={22} />, t: 'Real support', s: 'A Nairobi team that answers the same day, not a ticket queue overseas.' },
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero */}
      <section className="relative min-h-[90vh] lg:min-h-screen flex items-center pt-32 lg:pt-48 pb-16 overflow-hidden -mt-16 sm:-mt-20 lg:-mt-24">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/server-glow.webp')" }} />
        <div className="absolute inset-0 z-0 bg-linear-to-b from-slate-300/70 via-slate-300/55 to-transparent" />
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow z-0" />
        
        <div className="max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-16 w-full grid lg:grid-cols-12 gap-12 items-center relative z-10">
          <div className="lg:col-span-7 rounded-[2.5rem] border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-8 sm:p-10 lg:p-14 shadow-2xl">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-5">Murzak Cloud Infrastructure</p>
            <h1 className="text-[clamp(2.4rem,6vw,4.8rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl text-murzak-ink dark:text-slate-100">
              Hosting that just <span className="text-murzak-gradient">stays up.</span>
            </h1>
            <p className="mt-7 text-lg sm:text-xl sm:leading-(--text-xl--line-height) text-slate-600 dark:text-slate-300 font-medium max-w-xl leading-relaxed">
              Your site, email and apps: set up, secured and backed up by us, on fast infrastructure,
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
            <p className="mt-5 font-mono text-label uppercase tracking-widest text-slate-600 dark:text-slate-400">
              No card required · Live in a day · Billed in shillings
            </p>
          </div>

          <div className="lg:col-span-5 rounded-[2.5rem] border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-8 sm:p-10 shadow-2xl flex flex-col gap-8">
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <Database size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-1.5">Enterprise Infrastructure</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-300 font-medium leading-relaxed">Built on blazing-fast NVMe SSDs and robust processors. Your applications run with zero bottlenecks.</p>
            </div>
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <Globe size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-1.5">Local Datacenter</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-300 font-medium leading-relaxed">Low latency access across East Africa. Keep your data local, fast, and compliant.</p>
            </div>
            <div>
              <div className="inline-flex p-2.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-3">
                <ShieldCheck size={20} />
              </div>
              <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-1.5">Fully Managed Security</h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-300 font-medium leading-relaxed">Active DDoS protection, daily backups, and regular patching handled automatically by our team.</p>
            </div>
          </div>
        </div>
      </section>

      {/* GLOBAL BACKGROUND WRAPPER */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-45" style={{ backgroundImage: "url('/images/cloud-section-bg.webp')", filter: "saturate(.5) contrast(1.05)" }} />
        <div className="absolute inset-0 z-0 section-bg-wash" />
        <div className="absolute inset-0 z-0 section-bg-fade" />

        {/* STREAMLINED CLOUD RESOURCE DIRECTORY (EACH RESOURCE LINKS TO ITS OWN DEDICATED PAGE) */}
        <section className="py-16 lg:py-24 border-t border-murzak-border/50 relative overflow-hidden">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
            <div className="max-w-2xl mb-12">
              <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-3">Cloud Resources</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Dedicated resources with in-depth setup guides.</h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300 font-medium text-sm">
                Each resource runs isolated on fast local infrastructure with automated Let's Encrypt TLS and S3 backups.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {cloudResources.map((res) => (
                <div
                  key={res.title}
                  onClick={() => onNavigate(res.path)}
                  className="cursor-pointer group p-8 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 backdrop-blur-md hover:border-murzak-accent/50 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent">
                        {res.icon}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                        {res.badge}
                      </span>
                    </div>
                    <h3 className="text-xl font-black text-murzak-ink dark:text-slate-100 mb-2 flex items-center justify-between">
                      <span>{res.title}</span>
                      <ArrowUpRight size={16} className="text-murzak-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </h3>
                    <p className="text-[13px] text-slate-500 dark:text-slate-300 font-medium leading-relaxed mb-6">
                      {res.desc}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-murzak-border/50 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-500 font-medium">{res.stat}</span>
                    <span className="font-bold text-murzak-accent flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      Guide & Setup →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Managed for you */}
        <section className="py-16 lg:py-24 relative overflow-hidden">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
            <div className="grid lg:grid-cols-12 gap-10 items-center mb-12">
              <div className="lg:col-span-7">
                <p className="inline-block font-mono text-micro uppercase text-sky-800 dark:text-murzak-accent mb-3 px-2.5 py-1 rounded-full bg-white/70 dark:bg-black/40 backdrop-blur-xs">Fully managed</p>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The parts you'd rather not think about.</h2>
                <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-w-md">
                  Real engineers watching real infrastructure, not a support queue that routes you overseas.
                </p>
              </div>

              {/* Resource monitor mockup */}
              <div className="lg:col-span-5">
                <div className="rounded-4xl bg-slate-900 border border-murzak-border shadow-2xl p-6">
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-micro font-black uppercase tracking-widest text-slate-400">Resource Monitor</span>
                    <span className="rounded-full bg-murzak-success/15 text-murzak-success text-micro font-black uppercase px-2.5 py-1">99.97% uptime</span>
                  </div>
                  <div className="space-y-3.5 mb-5">
                    <MetricBar label="CPU" percent={34} tone="accent" />
                    <MetricBar label="RAM" percent={58} tone="accent" />
                    <MetricBar label="Disk" percent={22} tone="accent" />
                  </div>
                  <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-4 py-3">
                    <span className="h-2 w-2 rounded-full bg-murzak-success animate-pulse shrink-0" />
                    <span className="text-body-sm font-bold text-slate-200">Watched 24/7, last 30 days</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {managed.map((c) => (
                <div key={c.t} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                  <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                  <h3 className="text-base font-black text-murzak-ink dark:text-slate-100 mb-2">{c.t}</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-300 font-medium leading-relaxed">{c.s}</p>
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
              <div key={c.t} className="flex items-center gap-3 text-murzak-ink dark:text-slate-100">
                <span className="text-murzak-accent">{c.icon}</span>
                <span className="font-black text-sm">{c.t}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 lg:py-32 overflow-hidden">
          <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center relative z-10">
            <div className="rounded-[2.5rem] border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-10 sm:p-14 shadow-2xl">
              <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100">Move your hosting somewhere it's handled.</h2>
              <p className="mt-4 text-lg text-slate-600 dark:text-slate-300 font-medium">Build a plan in two minutes, or try it free for 36 hours first.</p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <Button variant="primary" onClick={() => onNavigate('/products')}>
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
