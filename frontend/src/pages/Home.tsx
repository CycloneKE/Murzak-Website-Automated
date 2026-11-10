import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Page } from '../types';
import Faq, { type FaqItem } from '../components/Faq';
import { BUSINESS_OFFERS, CLOUD_OFFERS, offerPriceLabel, type StoreOffer } from '../config/storefront';
import { Button } from '../components/ui/Button';
import { CARD, ClosingCta, FaqBand, MUTED, PageHero, PageMain, PageSection, Points, Steps } from '../components/ui/Page';

interface HomeProps {
  onNavigate: (page: Page) => void;
  isLoading?: boolean;
}

type Testimonial = { quote: string; name: string; org: string };
// Real, attributable client quotes only — section auto-hides while empty.
const TESTIMONIALS: Testimonial[] = [];

const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  // The router accepts page keys and paths; offers carry paths.
  const go = onNavigate as (pageOrPath: string) => void;

  // The two things people come for, each with its products and prices.
  const lanes: { key: string; title: string; who: string; offers: StoreOffer[]; cta: string; page: string }[] = [
    {
      key: 'business',
      title: 'Run my business',
      who: 'Ready-made software for selling, stock, accounts and customers. We host it and look after it.',
      offers: BUSINESS_OFFERS,
      cta: 'See business systems',
      page: 'products',
    },
    {
      key: 'cloud',
      title: 'Host something',
      who: 'A website, an app, a database or a domain name. Pick it, pay, and it is set up for you.',
      offers: CLOUD_OFFERS.filter((o) => o.key !== 'email'),
      cta: 'See Murzak Cloud',
      page: 'cloud',
    },
  ];

  const faqItems: FaqItem[] = [
    { q: 'How do I pay, and in what currency?', a: 'Everything is billed in Kenyan shillings. Pay by M-Pesa or card. There is nothing to convert from dollars.' },
    { q: 'How fast can I start?', a: 'Websites, apps and databases are set up automatically after payment, usually within minutes. A configured ERP with data migration is scoped with you and usually takes a few days.' },
    { q: 'What does "managed" mean?', a: 'We set up the server, install your software and keep it running. You use the product; you do not look after a server.' },
    { q: 'Can I start small and grow?', a: 'Yes. Each product is bought on its own, so start with one and add more when you need them.' },
    { q: 'What if none of this fits?', a: 'We also build custom software. Tell us the problem and we will tell you what it would take.' },
  ];

  return (
    <PageMain theme="home">
      <PageHero
        onNavigate={go}
        title="Run your business. We'll run the tech."
        lead="Business software and hosting, set up for you, priced in shillings and supported by people in Nairobi."
        price="Every product shows its price. No quote needed to get started."
      >
        <Button onClick={() => go('products')}>
          See products and prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => go('contact')}>
          Talk to us
        </Button>
      </PageHero>

      {/* What do you need? Two lanes, each with its products and prices. */}
      <PageSection id="what-we-do" title="What do you need?">
        <div data-testid="home-prices" className="grid md:grid-cols-2 gap-4">
          {lanes.map((lane) => (
            <article key={lane.key} className={`${CARD} p-6 flex flex-col`}>
              <h3 className="text-xl font-extrabold">{lane.title}</h3>
              <p className={`mt-2 text-sm leading-relaxed ${MUTED}`}>{lane.who}</p>
              <ul className="mt-5 divide-y divide-murzak-border dark:divide-white/10 border-y border-murzak-border dark:border-white/10 grow">
                {lane.offers.map((o) => (
                  <li key={o.key}>
                    <button
                      type="button"
                      onClick={() => go(o.path)}
                      className="w-full flex items-center justify-between gap-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <span className="font-bold">{o.name}</span>
                      <span className={`text-sm font-semibold tabular-nums ${MUTED}`}>{offerPriceLabel(o)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <Button size="sm" variant="outline" onClick={() => go(lane.page)}>
                  {lane.cta} <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className={`${CARD} mt-4 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4`}>
          <div>
            <h3 className="text-lg font-extrabold">Need something that does not exist yet?</h3>
            <p className={`mt-1 text-sm leading-relaxed ${MUTED}`}>
              We design and build custom software, then host it and keep it running.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => go('custom-software')}>
            Custom software <ArrowRight size={14} />
          </Button>
        </div>
      </PageSection>

      <PageSection title="How it works" tinted>
        <Steps
          items={[
            { t: 'Pick a product', s: 'Each one shows what it does and what it costs per month.' },
            { t: 'Pay in shillings', s: 'M-Pesa or card. No dollar invoices.' },
            { t: 'We set it up', s: 'Hosting products are set up automatically. Business systems are configured with you.' },
            { t: 'We keep it running', s: 'You use it. When something needs attention, you talk to us.' },
          ]}
        />
      </PageSection>

      <PageSection title="Why businesses choose Murzak">
        <Points
          cols={4}
          items={[
            { t: 'Pay by M-Pesa', s: 'A payment prompt on your phone. No card needed.' },
            { t: 'Billed in shillings', s: 'The price you see is the price on the invoice.' },
            { t: 'Support in Nairobi', s: 'People in your time zone who know the product.' },
            { t: 'Prices in the open', s: 'See what it costs before you talk to anyone.' },
          ]}
        />
      </PageSection>

      {/* Shown only when there are real client quotes. */}
      {TESTIMONIALS.length > 0 && (
        <PageSection tinted>
          <figure className="max-w-3xl">
            <blockquote className="text-2xl font-extrabold leading-snug">{TESTIMONIALS[0].quote}</blockquote>
            <figcaption className={`mt-4 text-sm font-semibold ${MUTED}`}>
              {TESTIMONIALS[0].name}, {TESTIMONIALS[0].org}
            </figcaption>
          </figure>
        </PageSection>
      )}

      <FaqBand>
        <Faq items={faqItems} title="Common questions" />
      </FaqBand>

      <ClosingCta title="Ready to get set up?" lead="Start with one product, or tell us what you need and we will point you to it.">
        <Button onClick={() => go('products')}>
          See products and prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => go('contact')}>
          Talk to us
        </Button>
      </ClosingCta>
    </PageMain>
  );
};

export default Home;
