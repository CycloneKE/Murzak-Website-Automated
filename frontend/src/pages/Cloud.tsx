import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import CloudLaunchModal from '../components/CloudLaunchModal';
import Faq, { type FaqItem } from '../components/Faq';
import { PageHero, PageMain } from '../components/ui/Page';
import { useAvailability } from '../components/AvailabilityNotice';
import { isDatabaseCompanionId } from '../services/bundles';
import { formatKes, GENERIC_POST_PURCHASE_COPY } from '../config/serviceCatalog';
import { CLOUD_OFFERS, monthlyOf, offerPriceLabel, offerSetupLabel, type StoreOffer } from '../config/storefront';

type CloudProps = NavProps & { isLoggedIn?: boolean };

const CARD = 'rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5';
const MUTED = 'text-slate-600 dark:text-slate-400';

const Cloud: React.FC<CloudProps> = ({ onNavigate, isLoggedIn = false }) => {
  const [searchParams] = useSearchParams();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchServiceId, setLaunchServiceId] = useState<string | undefined>(undefined);
  const availability = useAvailability();
  // True when checkout can take an app and a database as one order.
  const canPairDatabase = !!availability?.allowedCompanionIds.some(isDatabaseCompanionId);

  useEffect(() => {
    const launch = searchParams.get('launch');
    if (launch) {
      setLaunchServiceId(launch);
      setLaunchOpen(true);
    }
  }, [searchParams]);

  const launch = (serviceId?: string) => {
    setLaunchServiceId(serviceId);
    setLaunchOpen(true);
  };

  // Offers with their own order page go there; the rest open the launch flow.
  const start = (offer: StoreOffer) => (offer.launchId ? launch(offer.launchId) : onNavigate(offer.path));

  const setups = [
    {
      title: 'Web app with a database',
      parts: ['App hosting', 'PostgreSQL database'],
      monthly: monthlyOf('starter-app-hosting') + monthlyOf('db-postgres'),
      note: canPairDatabase
        ? 'Pick the database in the same step as the app. One order, one invoice.'
        : 'Launch the app first, then add the database from your portal.',
      cta: 'Launch app + database',
      go: () => launch('starter-app-hosting'),
    },
    {
      title: 'Company website with email',
      parts: ['WordPress website', 'Business email', 'Your domain name'],
      monthly: monthlyOf('starter-wordpress') + monthlyOf('mail-starter'),
      note: 'Start with the website. The domain is billed per year on top of the monthly price.',
      cta: 'Start with the website',
      go: () => launch('starter-wordpress'),
    },
    {
      title: 'Online shop',
      parts: ['WooCommerce store', 'Your domain name'],
      monthly: monthlyOf('starter-woocommerce'),
      note: 'A store you can add products to straight away. The domain is billed per year.',
      cta: 'Launch a shop',
      go: () => launch('starter-woocommerce'),
    },
  ];

  const steps = [
    { t: 'Pick what you need', s: 'Choose one thing or a setup. The price you see is the price you pay.' },
    { t: 'Pay in shillings', s: 'M-Pesa or card. No dollar invoices and nothing to convert.' },
    { t: 'It gets set up for you', s: GENERIC_POST_PURCHASE_COPY },
    { t: 'Run it from your portal', s: 'Logins, connection details, domains and invoices are all in one place.' },
  ];

  const faqs: FaqItem[] = [
    { q: 'Do I need to know how to run a server?', a: 'No. You choose what you want, we create it and hand you the login or connection details. There is no server for you to manage.' },
    { q: 'Can I buy more than one thing?', a: 'Yes. Each item is priced on its own, so you only add what you use. App hosting can include a database in the same order; anything else can be added from your portal afterwards.' },
    { q: 'Can I use a domain I already own?', a: 'Yes. What you launch starts on a free Murzak address so it works straight away, and you can connect a domain you own from your portal.' },
    { q: 'How do I pay?', a: 'In Kenyan shillings, by M-Pesa or card. Monthly items renew monthly; domains are billed per year.' },
    { q: 'What if I need something bigger?', a: 'Tell us what you are running and we will size and quote dedicated capacity for it.' },
  ];

  return (
    <PageMain theme="cloud" className="text-murzak-ink dark:text-slate-100">
      <PageHero
        onNavigate={onNavigate}
        label="Murzak Cloud"
        title="Hosting without the server work."
        lead="Websites, apps, databases, domains and email. Pick what you need, pay in shillings, and we set it up."
        price="Pay by M-Pesa or card. Priced per item, per month. Support from Nairobi."
        aside={
          // The price list itself, so nobody has to scroll to learn what it costs.
          <ul className="p-2 divide-y divide-white/10">
            {CLOUD_OFFERS.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  onClick={() => start(o)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left rounded-xl hover:bg-white/5 transition-colors"
                >
                  <span className="font-bold">{o.name}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-300">{offerPriceLabel(o)}</span>
                </button>
              </li>
            ))}
          </ul>
        }
      >
        <Button onClick={() => launch(undefined)}>
          Launch something <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => document.getElementById('cloud-offers')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          See what's available
        </Button>
      </PageHero>

      {/* What you can launch */}
      <section id="cloud-offers" className="scroll-mt-28 border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">What you can launch</h2>
          <p className={`mt-2 max-w-xl ${MUTED}`}>Each one is sold on its own. Start with one and add the rest when you need it.</p>

          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CLOUD_OFFERS.map((o) => {
              const setup = offerSetupLabel(o);
              return (
                <article key={o.key} data-testid={`cloud-offer-${o.key}`} className={`${CARD} p-6 flex flex-col`}>
                  <h3 className="text-lg font-extrabold">{o.name}</h3>
                  <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{o.what}</p>
                  <p className="mt-5 font-extrabold tabular-nums">{offerPriceLabel(o)}</p>
                  <p className={`text-xs font-semibold min-h-4 ${MUTED}`}>{setup}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <Button size="sm" onClick={() => start(o)}>
                      {o.key === 'domain' ? 'Search a name' : o.key === 'email' ? 'Choose mailboxes' : 'Launch'}
                    </Button>
                    {o.launchId && !o.path.startsWith('/cloud?') && (
                      <button
                        type="button"
                        onClick={() => onNavigate(o.path)}
                        className="text-sm font-bold underline underline-offset-4 decoration-murzak-border hover:decoration-current"
                      >
                        Details
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Common setups */}
      <section className="border-t border-murzak-border dark:border-white/10 bg-slate-100/90 dark:bg-black/80">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Things people buy together</h2>
          <p className={`mt-2 max-w-xl ${MUTED}`}>Most projects need more than one piece. These are the usual ones, with the total worked out.</p>

          <div className="mt-8 grid lg:grid-cols-3 gap-4">
            {setups.map((s) => (
              <article key={s.title} className={`${CARD} p-6 flex flex-col`}>
                <h3 className="text-lg font-extrabold">{s.title}</h3>
                <ul className="mt-4 space-y-2">
                  {s.parts.map((p, i) => (
                    <li key={p} className="flex items-center gap-2 text-sm font-semibold">
                      {i === 0 ? <Check size={15} className="text-murzak-success shrink-0" /> : <Plus size={15} className={`shrink-0 ${MUTED}`} />}
                      {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 font-extrabold tabular-nums">{formatKes(s.monthly)}/mo</p>
                <p className={`mt-1 text-sm leading-relaxed grow ${MUTED}`}>{s.note}</p>
                <div className="mt-5">
                  <Button size="sm" variant="outline" onClick={s.go}>
                    {s.cta} <ArrowRight size={15} />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">How it works</h2>
          <ol className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
            {steps.map((st, i) => (
              <li key={st.t}>
                <span className={`text-sm font-bold tabular-nums ${MUTED}`}>Step {i + 1}</span>
                <h3 className="mt-1 font-extrabold">{st.t}</h3>
                <p className={`mt-1.5 text-sm leading-relaxed ${MUTED}`}>{st.s}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-murzak-border dark:border-white/10 py-14 sm:py-20">
        <Faq items={faqs} title="Questions about Murzak Cloud" eyebrow="Before you buy" />
      </section>

      {/* Closing */}
      <section className="border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Not sure which one you need?</h2>
            <p className={`mt-2 max-w-xl ${MUTED}`}>Tell us what you are trying to run and we will point you at the right one.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button onClick={() => launch(undefined)}>
              Launch something <ArrowRight size={18} />
            </Button>
            <Button variant="outline" onClick={() => onNavigate('contact')}>
              Talk to us
            </Button>
          </div>
        </div>
      </section>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={launchServiceId}
      />
    </PageMain>
  );
};

export default Cloud;
