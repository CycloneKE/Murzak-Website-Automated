import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CARD, ClosingCta, FaqBand, MUTED, PageHero, PageSection } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
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
      desc: 'Give your team addresses like you@yourbusiness.co.ke. Use a domain you already own. Need one? Register it first in your portal, then add email to it.',
      details: 'After payment we show the few DNS records to add where you manage the domain, and we switch your email on once we see them.',
    },
    {
      step: '02',
      title: 'Webmail from any browser',
      desc: 'Every mailbox comes with webmail at your own address, so your team can start without installing anything.',
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
      a: 'Yes, that is how it works. Enter your domain when you order. After payment we show the few DNS records to add where you manage the domain, and we switch your email on as soon as we see them.',
    },
    {
      q: "I don't have a domain yet. What do I do?",
      a: 'Register the domain first in your Murzak portal under Domains, then come back and add email to it.',
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

  const name = (id: string) => getService(id)?.name.replace(/^Business Email \(|\)$/g, '') || '';

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Business email' }]}
        title="Email on your own domain."
        lead="Addresses like you@yourbusiness.co.ke instead of @gmail.com, with webmail and spam filtering. We handle the technical setup."
        price={
          starterMonthly !== undefined && starterBoxes !== undefined ? (
            <>from {formatKes(starterMonthly)}/mo for {starterBoxes} mailboxes</>
          ) : undefined
        }
      >
        <Button onClick={() => start()}>
          Get business email <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('/cloud/domains')}>
          I need a domain first
        </Button>
      </PageHero>

      <PageSection title="Choose a size" lead="The difference is how many mailboxes you get and how much each one holds.">
        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((id) => {
            const svc = getService(id);
            if (!svc) return null;
            const per = perMailboxKes(id);
            return (
              <article key={id} className={`${CARD} p-6 flex flex-col`}>
                <h3 className="text-lg font-extrabold">{name(id)}</h3>
                <p className="mt-2 text-2xl font-extrabold tabular-nums">
                  {formatKes(serviceMonthlyKes(id))}
                  <span className={`text-sm font-bold ${MUTED}`}>/mo</span>
                </p>
                {per !== undefined && <p className={`mt-1 text-xs font-semibold ${MUTED}`}>about {formatKes(per)} per mailbox</p>}
                <ul className={`mt-5 space-y-2 text-sm grow ${MUTED}`}>
                  {[
                    `${svc.mailboxes} mailboxes`,
                    `${svc.specs.storage.replace(' / mailbox', '')} storage in each mailbox`,
                    'Webmail on your own domain',
                    'Spam filtering',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-murzak-success" />
                      {line}
                    </li>
                  ))}
                </ul>
                <Button className="mt-6" variant="outline" onClick={() => start(id)}>
                  Choose {name(id)}
                </Button>
              </article>
            );
          })}
        </div>
      </PageSection>

      <PageSection title="What you get, and what to expect" tinted>
        <div className="grid md:grid-cols-2 gap-x-10 gap-y-8">
          {guides.map((g) => (
            <div key={g.step}>
              <h3 className="font-extrabold">{g.title}</h3>
              <p className={`mt-1.5 text-sm leading-relaxed ${MUTED}`}>{g.desc}</p>
              <p className={`mt-2 text-sm leading-relaxed break-words ${MUTED}`}>{g.details}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about business email" />
      </FaqBand>

      <ClosingCta title="Ready to set up your mailboxes?" lead={<>Pay with M-Pesa and we handle the technical setup. Questions? Write to {SUPPORT_EMAIL}.</>}>
        <Button onClick={() => start()}>
          Get business email <ArrowRight size={18} />
        </Button>
      </ClosingCta>
    </main>
  );
};

export default CloudEmail;
