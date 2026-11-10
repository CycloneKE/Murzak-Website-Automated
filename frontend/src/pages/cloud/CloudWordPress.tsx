import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CARD, ClosingCta, FaqBand, MUTED, PageHero, PageSection, Steps } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import CloudLaunchModal from '../../components/CloudLaunchModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

// The two things sold on this page. Ids must exist in the service catalog:
// the launch dialog opens on them and the price is read from them.
const SITES = [
  {
    id: 'starter-wordpress',
    name: 'WordPress website',
    use: 'A company site, blog or landing pages. WordPress is installed and you log in to start editing.',
    cta: 'Launch a website',
  },
  {
    id: 'starter-woocommerce',
    name: 'Online shop',
    use: 'WordPress with WooCommerce installed and prices set to Kenyan shillings, ready for your products.',
    cta: 'Launch a shop',
  },
];

const CloudWordPress: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);
  const [selected, setSelected] = useState(SITES[0].id);

  const launch = (id: string) => {
    setSelected(id);
    setLaunchOpen(true);
  };

  const faqs: FaqItem[] = [
    { q: 'What do I get after paying?', a: 'A working WordPress site at its own web address, served over HTTPS, and the admin login in your portal.' },
    { q: 'Can I use my own domain?', a: 'Yes. Your site starts on a free Murzak address so it works straight away. You can then connect a domain you own from your portal.' },
    { q: 'Can I install my own themes and plugins?', a: 'Yes. You are the administrator of the site, so you can install themes and plugins as usual.' },
    { q: 'I already have a WordPress site elsewhere. Can you move it?', a: 'Tell us where it is hosted today and we will tell you how we can help move it.' },
    { q: 'How is it billed?', a: 'Monthly in Kenyan shillings, by M-Pesa or card. You can pay yearly at checkout for a lower price.' },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Websites' }]}
        title="A website you can start editing today."
        lead="We install WordPress, put it on a web address with HTTPS, and send the admin login to your portal. You write the pages."
        price={<>from {formatKes(serviceMonthlyKes('starter-wordpress'))}/mo</>}
      >
        <Button onClick={() => launch('starter-wordpress')}>
          Launch a website <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('/cloud/domains')}>
          Find a domain name first
        </Button>
      </PageHero>

      <PageSection title="Choose what to build">
        <div className="grid sm:grid-cols-2 gap-4">
          {SITES.map((s) => (
            <article key={s.id} data-testid={`site-${s.id}`} className={`${CARD} p-6 flex flex-col`}>
              <h3 className="text-lg font-extrabold">{s.name}</h3>
              <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{s.use}</p>
              <div className="mt-5 flex items-center justify-between gap-4">
                <span className="font-extrabold tabular-nums">{formatKes(serviceMonthlyKes(s.id))}/mo</span>
                <Button size="sm" variant="outline" onClick={() => launch(s.id)}>
                  {s.cta} <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title="How it works" tinted>
        <Steps
          items={[
            { t: 'Choose website or shop', s: 'Pick one above. It starts on a free Murzak web address.' },
            { t: 'Pay in shillings', s: 'M-Pesa or card, on the checkout page.' },
            { t: 'We install it', s: 'WordPress is installed automatically after payment.' },
            { t: 'Log in and edit', s: 'Your admin login is in your portal. Pick a theme and add your pages.' },
          ]}
        />
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about websites" />
      </FaqBand>

      <ClosingCta title="Want email on the same domain?" lead="Mailboxes like you@yourcompany.com are sold separately and work alongside your site.">
        <Button onClick={() => launch('starter-wordpress')}>
          Launch a website <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('/cloud/email')}>
          See business email
        </Button>
      </ClosingCta>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={selected}
      />
    </main>
  );
};

export default CloudWordPress;
