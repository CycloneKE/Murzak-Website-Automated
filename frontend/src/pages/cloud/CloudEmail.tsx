import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Section } from '../../components/ui/Section';
import Faq, { type FaqItem } from '../../components/Faq';
import Breadcrumbs from '../../components/Breadcrumbs';
import { formatKes, getService, serviceMonthlyKes } from '../../config/serviceCatalog';
import { MAIL_HOSTNAME, SUPPORT_EMAIL } from '../../config/contact';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const TIERS = ['mail-starter', 'mail-business', 'mail-pro'] as const;
const ORDER_PATH = '/email/setup';

function perMailboxKes(id: string): number | undefined {
  const monthly = serviceMonthlyKes(id);
  const boxes = getService(id)?.mailboxes;
  return monthly && boxes ? Math.round(monthly / boxes) : undefined;
}

const CloudEmail: React.FC<Props> = ({ onNavigate }) => {
  const start = (planId?: string) => onNavigate(planId ? `${ORDER_PATH}?plan=${encodeURIComponent(planId)}` : ORDER_PATH);

  const starterMonthly = serviceMonthlyKes('mail-starter');
  const starterBoxes = getService('mail-starter')?.mailboxes;

  const guides = [
    {
      step: '01',
      title: 'Email on your own domain',
      desc: 'Give your team addresses like you@yourbusiness.co.ke. Use a domain you already own, or let us register a new one for you as part of the order.',
      details: 'Domains ending in .co.ke or .ke are registered by our team within one working day.',
    },
    {
      step: '02',
      title: 'Webmail from any browser',
      desc: 'Every mailbox comes with webmail at your own address, with a calendar and address book, so your team can start without installing anything.',
      details: 'Your webmail address is webmail.yourdomain, for example webmail.yourbusiness.co.ke.',
    },
    {
      step: '03',
      title: 'iPhone and Android',
      desc: 'Add your mailbox to Apple Mail, the Gmail app or Outlook with the standard IMAP and SMTP settings below. After you set a password, your setup page shows the steps.',
      details: `Incoming (IMAP): ${MAIL_HOSTNAME}, port 993 SSL | Outgoing (SMTP): ${MAIL_HOSTNAME}, port 465 SSL`,
    },
    {
      step: '04',
      title: 'SPF, DKIM and DMARC',
      desc: 'These records help mail from your domain reach inboxes instead of spam. We generate them for you. If your domain is managed elsewhere, your setup page lists each record with a copy button.',
      details: 'A brand-new domain can take a few days to build a reputation, so its first emails may land in spam.',
    },
  ];

  const faqs: FaqItem[] = [
    {
      q: 'Can I use a domain I already own?',
      a: 'Yes. Enter it when you order. After payment we show the few DNS records to add where you manage the domain, and we switch your email on as soon as we see them.',
    },
    {
      q: 'Can you register a domain for me?',
      a: 'Yes. If the name is available we register it as part of your order. Domains ending in .co.ke or .ke are registered by our team within one working day. Domain registrations are not refundable once made.',
    },
    {
      q: 'Can I use Outlook or Apple Mail?',
      a: 'Yes. Your mailboxes work with Apple Mail, Outlook, Thunderbird and the mail apps on iPhone and Android, using standard IMAP and SMTP.',
    },
    {
      q: 'Is spam filtering included?',
      a: 'Yes. Spam filtering is on by default for every mailbox.',
    },
    {
      q: 'How many mailboxes do I get, and what do they cost?',
      a: TIERS.map((id) => {
        const svc = getService(id);
        return `${svc?.name.replace(/^Business Email \(|\)$/g, '')}: ${svc?.mailboxes} mailboxes with ${svc?.specs.storage.replace(' / mailbox', '')} each for ${formatKes(serviceMonthlyKes(id))} a month`;
      }).join('. ') + '.',
    },
    {
      q: 'How do I pay?',
      a: 'With M-Pesa. You pay once on the checkout page and your setup starts straight away. You can close the page while we work and we email you when it is ready.',
    },
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-28 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 right-[-10%] w-[640px] h-[640px] rounded-full blur-[140px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <Breadcrumbs
            onNavigate={onNavigate}
            items={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Business Email' }]}
          />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
            <span className="font-mono text-micro font-black uppercase text-amber-700 dark:text-amber-400">
              Your domain · Webmail · Paid by M-Pesa
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,6vw,4.6rem)] font-[900] tracking-[-0.03em] leading-[1.02] max-w-3xl">
            Look professional. <span className="text-murzak-gradient">Email on your own domain.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-relaxed">
            Stop using @gmail.com for business. Get addresses like you@yourbusiness.co.ke with spam filtering and webmail,
            set up for you in minutes.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Button onClick={() => start()}>
              Get Business Email <ArrowRight size={18} />
            </Button>
          </div>
          {starterMonthly !== undefined && starterBoxes !== undefined && (
            <p className="mt-4 font-mono text-xs text-slate-500 dark:text-slate-400">
              From {formatKes(starterMonthly)}/mo for {starterBoxes} mailboxes
            </p>
          )}
        </div>
      </section>

      {/* Tiers */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-10">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">Plans</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">Pick the size that fits your team.</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {TIERS.map((id) => {
              const svc = getService(id);
              if (!svc) return null;
              const per = perMailboxKes(id);
              return (
                <div key={id} className="p-7 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs flex flex-col">
                  <h3 className="text-lg font-black">{svc.name.replace(/^Business Email \(|\)$/g, '')}</h3>
                  <p className="mt-2 text-3xl font-[900]">
                    {formatKes(serviceMonthlyKes(id))}
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-400">/mo</span>
                  </p>
                  {per !== undefined && (
                    <p className="mt-1 text-xs font-black text-emerald-700 dark:text-emerald-400">about {formatKes(per)} per mailbox</p>
                  )}
                  <ul className="mt-5 space-y-2 text-sm font-semibold text-slate-600 dark:text-slate-400 grow">
                    <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />{svc.mailboxes} mailboxes</li>
                    <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />{svc.specs.storage.replace(' / mailbox', '')} storage in each mailbox</li>
                    <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />Webmail on your own domain</li>
                    <li className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />Spam filtering</li>
                  </ul>
                  <Button className="mt-6" variant="outline" onClick={() => start(id)}>
                    Choose {svc.name.replace(/^Business Email \(|\)$/g, '')}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Setup guides */}
      <Section className="relative z-10 border-t border-murzak-border/50 bg-slate-50/50 dark:bg-black/20">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-micro uppercase text-sky-700 dark:text-murzak-accent mb-2">How it works</p>
            <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight">From order to inbox, without the technical work.</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {guides.map((g) => (
              <div key={g.step} className="p-8 rounded-3xl border border-murzak-border bg-white dark:bg-white/5 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="font-mono text-xl font-[900] text-sky-700 dark:text-murzak-accent block mb-2">{g.step}</span>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{g.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium mb-4">{g.desc}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs font-mono text-slate-600 dark:text-slate-400 break-words">
                  <span className="text-amber-700 dark:text-amber-400 font-bold">Good to know: </span>{g.details}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* FAQs */}
      <Section className="relative z-10 border-t border-murzak-border/50">
        <div className="max-w-[900px] mx-auto px-6 sm:px-10">
          <Faq items={faqs} title="Business Email Questions" />
        </div>
      </Section>

      {/* CTA */}
      <section className="relative py-20 overflow-hidden border-t border-murzak-border/50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100 mb-4">Set up your business email today.</h2>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-8">
            Pay with M-Pesa and we do the technical setup. Questions? Write to {SUPPORT_EMAIL}.
          </p>
          <Button variant="primary" onClick={() => start()}>
            Get Business Email <ArrowRight size={17} />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default CloudEmail;
