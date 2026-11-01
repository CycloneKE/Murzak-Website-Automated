import React, { useState } from 'react';
import { ArrowRight, Database, ShieldCheck, RefreshCw, Server, Terminal, Lock, Check, HardDrive, Cpu } from 'lucide-react';
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

const CloudDatabases: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);
  const [selectedDb, setSelectedDb] = useState('db-mysql');

  const databases = [
    {
      id: 'db-mysql',
      name: 'MySQL 8',
      desc: 'The world\'s most proven open-source relational database. Ideal for WordPress, WooCommerce, Murzak ERP, and PHP applications.',
      port: 3306,
      version: 'v8.0 LTS',
      priceId: 'db-mysql',
      popular: true,
    },
    {
      id: 'db-postgres',
      name: 'PostgreSQL 16',
      desc: 'Advanced object-relational database with native JSONB, PostGIS geospatial support, and high concurrency for modern SaaS apps.',
      port: 5432,
      version: 'v16.2 Stable',
      priceId: 'db-postgres',
      popular: false,
    },
    {
      id: 'db-redis',
      name: 'Redis 7',
      desc: 'Ultra-fast in-memory key-value data store. Perfect for session storage, caching, queue workers, and real-time leaderboards.',
      port: 6379,
      version: 'v7.2 In-Memory',
      priceId: 'db-redis',
      popular: false,
    },
    {
      id: 'db-mongo',
      name: 'MongoDB',
      desc: 'Flexible document database designed for applications that evolve quickly and require dynamic JSON-like document models.',
      port: 27017,
      version: 'v7.0 Community',
      priceId: 'db-mongo',
      popular: false,
    },
  ];

  const guides = [
    {
      step: "01",
      title: "One-Click Provisioning & Credentials",
      desc: "Select your database engine and size. Our automation generates secure root passwords, an isolated network bridge, and dedicated NVMe volume paths.",
      code: "# Generated Database URI\nmysql://db_user:s3cur3p@ss@db.murzaktech.tech:3306/production"
    },
    {
      step: "02",
      title: "Connecting Your Application (SSL / TLS)",
      desc: "Connect your Node.js, Python, or PHP apps using standard URI strings. All incoming external database traffic is encrypted via TLS.",
      code: "const { Pool } = require('pg');\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });"
    },
    {
      step: "03",
      title: "Automated Daily Backups & Point-in-Time Restore",
      desc: "Daily snapshots are automatically compressed and shipped to offsite S3 buckets. Restore to any point in time with a single ticket or dashboard click.",
      code: "# Offsite retention policy\nDaily snapshots: 30 days | Weekly archives: 12 weeks | Offsite replication: AWS S3"
    },
    {
      step: "04",
      title: "Migrating from cPanel or External Cloud",
      desc: "Export your existing SQL dump or let our engineers perform a zero-downtime database migration for you at no additional charge.",
      code: "mysqldump -u local_user -p mydb | mysql -h db.murzaktech.tech -u remote_user -p remotedb"
    }
  ];

  const faqs: FaqItem[] = [
    { q: "Where are the databases hosted?", a: "Databases are hosted in Nairobi datacenters on fast NVMe SSD arrays with direct peering to Safaricom, Airtel, and SEACOM for ultra-low latency across East Africa." },
    { q: "Are backups automated?", a: "Yes. Every database is backed up daily to offsite storage. You do not need to configure cron jobs or pay extra for backup storage." },
    { q: "Can I connect from outside Murzak Cloud?", a: "Yes. External TCP access is enabled with encrypted TLS connections and configurable IP whitelist firewalls." },
    { q: "Can you help migrate my database?", a: "Yes. Our Nairobi engineering team handles database migrations from cPanel, AWS RDS, DigitalOcean, or Hostinger for free." },
    { q: "How are payments billed?", a: "Databases are billed in Kenyan shillings with monthly or annual terms payable via M-Pesa or card." }
  ];

  const handleLaunch = (id: string) => {
    setSelectedDb(id);
    setLaunchOpen(true);
  };

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <Breadcrumbs
            onNavigate={onNavigate}
            items={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Managed Databases' }]}
          />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 mb-6">
            <span className="font-mono text-micro font-black uppercase text-sky-700 dark:text-sky-400">
              Low Latency · NVMe SSDs · Daily S3 Backups
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,6vw,4.6rem)] font-[900] tracking-[-0.03em] leading-[1.02] max-w-3xl">
            Managed databases. <span className="text-murzak-gradient">Tuned, backed up, and kept fast.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-relaxed">
            MySQL, PostgreSQL, Redis, and MongoDB running in isolated containers in Nairobi. Zero database administration headache, billed in Kenyan shillings.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => handleLaunch('db-mysql')}>
              Launch Database <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('contact')}>
              Free Database Migration
            </Button>
          </div>
        </div>
      </section>

      {/* DATABASE ENGINES CATALOG */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">Supported Engines</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">Pick your engine. Ready in minutes.</h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {databases.map((db) => (
              <div key={db.id} className="p-8 rounded-3xl border border-murzak-border bg-white/60 dark:bg-white/5 backdrop-blur-md flex flex-col justify-between hover:border-murzak-accent/50 transition-all">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent">
                        <Database size={22} />
                      </span>
                      <div>
                        <h3 className="text-xl font-black text-murzak-ink dark:text-slate-100">{db.name}</h3>
                        <span className="font-mono text-[11px] text-slate-500">{db.version}</span>
                      </div>
                    </div>
                    {db.popular && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Popular
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 font-medium mb-6 leading-relaxed">{db.desc}</p>
                  
                  <div className="rounded-xl bg-slate-900 p-3 mb-6 font-mono text-xs text-slate-300">
                    <span className="text-slate-500 uppercase text-[10px] block mb-0.5">Default Port</span>
                    <span className="text-murzak-accent font-bold">TCP {db.port}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-murzak-border/50 flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500 font-medium">From {formatKes(serviceMonthlyKes(db.priceId))}/mo</span>
                  <Button size="sm" onClick={() => handleLaunch(db.id)}>
                    Launch {db.name} <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SETUP GUIDES & CODE EXAMPLES */}
      <Section className="relative z-10 border-t border-murzak-border/50 bg-slate-50/50 dark:bg-black/20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">Setup & Connection Guides</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">How to connect, secure, and back up your database.</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((g) => (
              <div key={g.step} className="p-8 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="font-mono text-xl font-[900] text-murzak-accent block mb-2">{g.step}</span>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{g.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium mb-4">{g.desc}</p>
                </div>
                <div className="rounded-xl bg-slate-900 p-3.5 font-mono text-[11px] text-slate-200 overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{g.code}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* FAQS */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[900px] mx-auto px-6 sm:px-10">
          <Faq items={faqs} title="Database Questions" subtitle="Technical information regarding latency, backups, and migration assistance." />
        </div>
      </Section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden border-t border-murzak-border/50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Spin up your database in 2 minutes.</h2>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-8">Billed in Kenyan shillings with M-Pesa. Free migration support included.</p>
          <Button variant="primary" onClick={() => handleLaunch('db-mysql')}>
            Get Started Now <ArrowRight size={17} />
          </Button>
        </div>
      </section>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={selectedDb}
      />
    </main>
  );
};

export default CloudDatabases;
