import React, { useState } from 'react';
import { ArrowRight, Layers, ShieldCheck, RefreshCw, Server, Zap, Lock, Check, Globe } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import Breadcrumbs from '../../components/Breadcrumbs';
import CloudLaunchModal from '../../components/CloudLaunchModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const CloudWordPress: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);

  const guides = [
    {
      step: "01",
      title: "One-Click WordPress Installation",
      desc: "Your WordPress instance is deployed automatically with the latest secure WordPress core, PHP 8.3, and pre-configured database connections.",
      tip: "Admin login details delivered instantly to your portal dashboard."
    },
    {
      step: "02",
      title: "Attaching Your Domain (.co.ke or .com)",
      desc: "Point your registered domain directly from the Murzak portal. Let's Encrypt TLS/SSL certificates are automatically generated and renewed.",
      tip: "Zero manual nameserver or DNS file configuration required."
    },
    {
      step: "03",
      title: "LiteSpeed Caching & Sub-Second Speeds",
      desc: "Our servers run LiteSpeed Enterprise with server-level page caching and CSS/JS minification for blazing fast load times on Safaricom 4G and fiber.",
      tip: "Scored 98+ on Google PageSpeed Insights out of the box."
    },
    {
      step: "04",
      title: "Free Migration from cPanel / Hostinger",
      desc: "Moving an existing WordPress site? Send us your cPanel or All-in-One WP Migration backup, and our Nairobi engineers will move it for free with zero downtime.",
      tip: "We handle database transfers, SSL re-issuance, and link testing."
    }
  ];

  const faqs: FaqItem[] = [
    { q: "Can I run WooCommerce on this plan?", a: "Yes. Our WordPress instances run on dedicated NVMe SSDs with generous PHP memory limits (512MB+) specifically tuned to handle high-traffic WooCommerce product catalogs and checkout queues." },
    { q: "Are plugins and themes supported?", a: "Yes. You have full administrator access to install any standard WordPress plugin (Elementor, Yoast, Contact Form 7, etc.) or custom themes." },
    { q: "Do I get a free domain?", a: "Yes. Annual WordPress hosting plans include a free 1st-year .co.ke or .com domain registration." },
    { q: "How often are backups taken?", a: "Backups are captured automatically every night and kept for 30 days offsite." }
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <Breadcrumbs
            onNavigate={onNavigate}
            items={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'WordPress Hosting' }]}
          />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 mb-6">
            <span className="font-mono text-micro font-black uppercase text-sky-700 dark:text-sky-400">
              LiteSpeed Accelerated · Auto-SSL · PHP 8.3
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,6vw,4.6rem)] font-[900] tracking-[-0.03em] leading-[1.02] max-w-3xl">
            WordPress hosting that <span className="text-murzak-gradient">loads in under a second.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-relaxed">
            Enterprise WordPress and WooCommerce on NVMe storage in Nairobi. Fully managed security, automated daily backups, and free site migration.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => setLaunchOpen(true)}>
              Launch WordPress <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('contact')}>
              Request Free Site Migration
            </Button>
          </div>
          <p className="mt-4 font-mono text-xs text-slate-500">
            From {formatKes(serviceMonthlyKes('starter-standard-site'))}/mo · Includes free SSL & staging
          </p>
        </div>
      </section>

      {/* SETUP GUIDES */}
      <Section className="relative z-10 border-t border-murzak-border/50 bg-slate-50/50 dark:bg-black/20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">WordPress Setup Guide</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">How your site gets live in 4 simple steps.</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((g) => (
              <div key={g.step} className="p-8 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="font-mono text-xl font-[900] text-murzak-accent block mb-2">{g.step}</span>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{g.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium mb-4">{g.desc}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs font-mono text-slate-600 dark:text-slate-400">
                  <span className="text-sky-600 dark:text-murzak-accent font-bold">ProTip: </span>{g.tip}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* FAQS */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[900px] mx-auto px-6 sm:px-10">
          <Faq items={faqs} title="WordPress Hosting Questions" subtitle="Details on performance, plugins, staging, and free migration assistance." />
        </div>
      </Section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden border-t border-murzak-border/50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Start your WordPress site today.</h2>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-8">Deploy in minutes with M-Pesa. Free migration support included.</p>
          <Button variant="primary" onClick={() => setLaunchOpen(true)}>
            Deploy Now <ArrowRight size={17} />
          </Button>
        </div>
      </section>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId="starter-standard-site"
      />
    </main>
  );
};

export default CloudWordPress;
