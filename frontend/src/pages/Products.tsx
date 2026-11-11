import React from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { CARD, ClosingCta, LINK, MUTED, PageHero, PageMain, PageSection } from '../components/ui/Page';
import { Page } from '../types';
import { formatKes, serviceMonthlyKes } from '../config/serviceCatalog';
import { BUSINESS_OFFERS, CLOUD_OFFERS, offerPriceLabel, offerSetupLabel, type StoreOffer } from '../config/storefront';
import DomainOrder from '../components/DomainOrder';

interface Props {
  onNavigate: (page: Page | string) => void;
  isLoading?: boolean;
  isLoggedIn?: boolean;
}

const DATABASES = [
  { id: 'db-mysql', name: 'MySQL', desc: 'What WordPress and most PHP apps expect.' },
  { id: 'db-postgres', name: 'PostgreSQL', desc: 'The safe default for a new app.' },
  { id: 'db-mongo', name: 'MongoDB', desc: 'Documents instead of tables.' },
  { id: 'db-redis', name: 'Redis', desc: 'Caching, queues and sessions.' },
];

const INDUSTRIES = [
  { title: 'Retail & shops', path: 'for-retail' },
  { title: 'Clinics & healthcare', path: 'for-clinics' },
  { title: 'Logistics & delivery', path: 'for-logistics' },
  { title: 'Professional services', path: 'for-services' },
];

const Products: React.FC<Props> = ({ onNavigate, isLoggedIn }) => {
  const location = useLocation();

  // Deep-link: /products#domains
  React.useEffect(() => {
    if (location.hash === '#domains') {
      requestAnimationFrame(() => {
        document.getElementById('domains')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [location.hash]);

  const offerCard = (o: StoreOffer) => (
    <article key={o.key} data-testid={`product-${o.key}`} className={`${CARD} p-6 flex flex-col`}>
      <h3 className="text-lg font-extrabold">{o.name}</h3>
      <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{o.what}</p>
      <p className="mt-5 font-extrabold tabular-nums">{offerPriceLabel(o)}</p>
      <p className={`text-xs font-semibold min-h-4 ${MUTED}`}>{offerSetupLabel(o)}</p>
      <div className="mt-4">
        <Button size="sm" variant="outline" onClick={() => onNavigate(o.path)}>
          See {o.name} <ArrowRight size={14} />
        </Button>
      </div>
    </article>
  );

  return (
    <PageMain theme="products">
      <PageHero
        onNavigate={onNavigate}
        title="Products"
        lead="Software to run a business, and somewhere to host what you build. Every product has its own price and can be bought on its own."
      >
        <Button onClick={() => onNavigate('pricing')}>
          See all prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </PageHero>

      <PageSection title="Business systems" lead="Ready-made software, hosted and looked after for you.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{BUSINESS_OFFERS.map(offerCard)}</div>
      </PageSection>

      <PageSection title="Hosting & cloud" lead="Somewhere to put a website, an app or your data." tinted>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CLOUD_OFFERS.filter((o) => !['email', 'database', 'domain'].includes(o.key)).map(offerCard)}
        </div>
        <p className={`mt-6 text-sm ${MUTED}`}>
          Databases and domain names are just below.{' '}
          <button type="button" onClick={() => onNavigate('cloud')} className={LINK}>
            See everything in Murzak Cloud
          </button>
        </p>
      </PageSection>

      <PageSection title="Managed databases" lead="Pick an engine and go straight to checkout. We create it and give you the connection details.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {DATABASES.map((db) => (
            <button
              key={db.id}
              type="button"
              onClick={() => onNavigate(`/checkout/new?serviceId=${db.id}`)}
              className={`${CARD} p-6 text-left flex flex-col hover:border-slate-400 dark:hover:border-white/30 transition-colors`}
            >
              <span className="text-lg font-extrabold">{db.name}</span>
              <span className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{db.desc}</span>
              <span className="mt-5 flex items-center justify-between gap-3">
                <span className="font-extrabold tabular-nums">{formatKes(serviceMonthlyKes(db.id))}/mo</span>
                <span className="inline-flex items-center gap-1 text-sm font-bold">
                  Buy <ArrowRight size={14} />
                </span>
              </span>
            </button>
          ))}
        </div>
      </PageSection>

      <PageSection id="domains" title="Register a domain" lead="Search for a name, review the price, then pay. Billed once a year." tinted>
        <div className="max-w-xl">
          <DomainOrder isLoggedIn={!!isLoggedIn} onNavigate={onNavigate} returnTo="/products#domains" />
        </div>
      </PageSection>

      <PageSection title="Built for you">
        <div className="grid md:grid-cols-2 gap-4">
          <article className={`${CARD} p-6 flex flex-col`}>
            <h3 className="text-lg font-extrabold">Custom software</h3>
            <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>
              When nothing ready-made fits, we design, build and run a system around how you work.
            </p>
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={() => onNavigate('custom-software')}>
                How a build works <ArrowRight size={14} />
              </Button>
            </div>
          </article>
          <article className={`${CARD} p-6`}>
            <h3 className="text-lg font-extrabold">By industry</h3>
            <p className={`mt-2 text-sm leading-relaxed ${MUTED}`}>What we usually set up for businesses like yours.</p>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {INDUSTRIES.map((i) => (
                <li key={i.path}>
                  <button type="button" onClick={() => onNavigate(i.path)} className={LINK}>
                    {i.title}
                  </button>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </PageSection>

      <ClosingCta title="Not sure where to start?" lead="Tell us what you are trying to do and we will suggest what to buy.">
        <Button onClick={() => onNavigate('pricing')}>
          See all prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </ClosingCta>
    </PageMain>
  );
};

export default Products;
