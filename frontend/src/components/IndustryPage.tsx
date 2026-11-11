import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from './ui/Button';
import { CARD, ClosingCta, MUTED, PageHero, PageMain, PageSection } from './ui/Page';
import type { PageThemeKey } from '../config/pageThemes';
import SalesModal from './SalesModal';
import { BUSINESS_OFFERS, CLOUD_OFFERS, offerPriceLabel } from '../config/storefront';

// One layout for every "for <industry>" page: what we would set up for a
// business like yours, and whether each piece is ready to buy or built to order.

export interface IndustryItem {
  title: string;
  desc: string;
  /** Page key or path the card opens. */
  path: string;
  /** Ready-made products have a price; custom work is quoted. */
  kind: 'Ready to buy' | 'Built for you';
  /** Storefront offer key ("pos", "erp", "crm", "email") whose price to show. */
  offer?: string;
}

interface Props {
  onNavigate: (page: string) => void;
  /** Photo and accent for this industry (config/pageThemes.ts). */
  theme: PageThemeKey;
  crumb: string;
  title: string;
  lead: string;
  sectionTitle: string;
  sectionLead: string;
  items: IndustryItem[];
  closing: {
    title: string;
    lead?: string;
    cta: string;
    /** A page key or path, or "quote" to open the quote form. */
    action: string;
  };
  /** Optional extra paragraph between the hero and the list. */
  note?: { title: string; body: string };
}

// Prices come from the storefront list, so they match the product pages.
function priceOf(key?: string): string {
  const offer = key ? [...BUSINESS_OFFERS, ...CLOUD_OFFERS].find((o) => o.key === key) : undefined;
  return offer ? offerPriceLabel(offer) : '';
}

const IndustryPage: React.FC<Props> = ({ onNavigate, theme, crumb, title, lead, sectionTitle, sectionLead, items, closing, note }) => {
  const [salesOpen, setSalesOpen] = useState(false);
  const act = () => (closing.action === 'quote' ? setSalesOpen(true) : onNavigate(closing.action));

  return (
    <PageMain theme={theme}>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Products', page: 'products' }, { label: crumb }]}
        title={title}
        lead={lead}
      >
        <Button onClick={act}>
          {closing.cta} <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </PageHero>

      {note && (
        <PageSection title={note.title}>
          <p className={`max-w-2xl leading-relaxed ${MUTED}`}>{note.body}</p>
        </PageSection>
      )}

      <PageSection title={sectionTitle} lead={sectionLead} tinted={!!note}>
        <div className="grid sm:grid-cols-3 gap-4">
          {items.map((item) => (
            <article key={item.title} className={`${CARD} p-6 flex flex-col`}>
              <p className={`text-xs font-bold ${MUTED}`}>{item.kind}</p>
              <h3 className="mt-1 text-lg font-extrabold">{item.title}</h3>
              <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{item.desc}</p>
              <p className="mt-4 font-extrabold tabular-nums min-h-6">
                {item.kind === 'Built for you' ? 'Quoted per project' : priceOf(item.offer)}
              </p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => onNavigate(item.path)}>
                  {item.kind === 'Built for you' ? 'How a build works' : 'See details'} <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </PageSection>

      <ClosingCta title={closing.title} lead={closing.lead}>
        <Button onClick={act}>
          {closing.cta} <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </ClosingCta>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </PageMain>
  );
};

export default IndustryPage;
