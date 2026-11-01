import React, { useState } from 'react';
import { ArrowRight, Sparkles, Workflow, ShieldCheck, RefreshCw, Server, Zap, Check, Smartphone, Terminal } from 'lucide-react';
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

const CloudN8N: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);

  const guides = [
    {
      step: "01",
      title: "Deploying Your Private n8n Instance",
      desc: "Your n8n container is spun up in an isolated KVM environment with persistent NVMe volume storage, SSL certificates, and zero execution limits.",
      code: "# Your dedicated webhook URL\nhttps://n8n.yourbrand.murzaktech.tech/webhook/mpesa-callback"
    },
    {
      step: "02",
      title: "Receiving M-Pesa Daraja C2B Callbacks",
      desc: "Add a Webhook Node in n8n and paste the listener URL into Safaricom Daraja. Every incoming transaction triggers instant real-time workflows.",
      code: "{\n  \"TransactionType\": \"Pay Bill\",\n  \"TransID\": \"RJK892KL9\",\n  \"TransAmount\": \"4500.00\",\n  \"BillRefNumber\": \"INV-1092\",\n  \"MSISDN\": \"254712345678\"\n}"
    },
    {
      step: "03",
      title: "Automated WhatsApp Receipts & Notifications",
      desc: "Connect the WhatsApp Cloud API or Twilio node to instantly dispatch automated confirmation messages and PDF receipts as soon as M-Pesa confirms payment.",
      code: "// Auto-dispatched WhatsApp message\n\"Jambo! We have received your payment of KES 4,500 for Invoice #1092. Your order is being dispatched!\""
    },
    {
      step: "04",
      title: "Syncing with Murzak ERP / Databases",
      desc: "Use native Postgres, MySQL, or HTTP Request nodes to reconcile bank ledgers, update stock inventory counts in real time, and alert staff on Slack or Telegram.",
      code: "# Database sync action\nUPDATE invoices SET status = 'Paid', transaction_id = $1 WHERE invoice_id = $2;"
    }
  ];

  const faqs: FaqItem[] = [
    { q: "Are there workflow or task execution limits?", a: "No. Unlike cloud-hosted SaaS tools like Zapier or Make that charge for every task run, your n8n on Murzak Cloud is a dedicated self-hosted server with unlimited workflow executions." },
    { q: "Can I use community nodes?", a: "Yes. You have full access to install custom npm community packages and nodes directly from your n8n settings." },
    { q: "Is my customer data kept private?", a: "100%. All customer details, webhook payloads, and M-Pesa records remain on your private Nairobi server without being routed through third-party overseas analytics." },
    { q: "Can I connect my own domain?", a: "Yes. You can attach workflow.yourcompany.co.ke with automated Let's Encrypt SSL in seconds." }
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <Breadcrumbs
            onNavigate={onNavigate}
            items={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'n8n Automation' }]}
          />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
            <span className="font-mono text-micro font-black uppercase text-purple-700 dark:text-purple-400">
              Private Automation Engine · Zero Task Limits · M-Pesa Ready
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,6vw,4.6rem)] font-[900] tracking-[-0.03em] leading-[1.02] max-w-3xl">
            Automate your business. <span className="text-murzak-gradient">Connect M-Pesa, WhatsApp & your apps.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-relaxed">
            Your own private n8n workflow server hosted in Nairobi. Automate payment callbacks, customer messaging, and ERP reconciliation with zero task fees.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => setLaunchOpen(true)}>
              Launch n8n Server <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('contact')}>
              Request Custom Workflow Build
            </Button>
          </div>
          <p className="mt-4 font-mono text-xs text-slate-500">
            From {formatKes(serviceMonthlyKes('starter-n8n'))}/mo · Unlimited workflow runs
          </p>
        </div>
      </section>

      {/* SETUP GUIDES */}
      <Section className="relative z-10 border-t border-murzak-border/50 bg-slate-50/50 dark:bg-black/20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">n8n Automation Walkthrough</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">How to connect local Kenyan business workflows.</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((g) => (
              <div key={g.step} className="p-8 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="font-mono text-xl font-[900] text-murzak-accent block mb-2">{g.step}</span>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{g.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium mb-4">{g.desc}</p>
                </div>
                <div className="rounded-xl bg-slate-900 p-3.5 font-mono text-[11px] text-purple-300 overflow-x-auto">
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
          <Faq items={faqs} title="n8n Automation Questions" subtitle="Details regarding execution limits, privacy, webhooks, and integrations." />
        </div>
      </Section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden border-t border-murzak-border/50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Start automating with n8n today.</h2>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-8">Deploy in minutes with M-Pesa. Dedicated container with unlimited runs.</p>
          <Button variant="primary" onClick={() => setLaunchOpen(true)}>
            Deploy n8n Instance <ArrowRight size={17} />
          </Button>
        </div>
      </section>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId="starter-n8n"
      />
    </main>
  );
};

export default CloudN8N;
