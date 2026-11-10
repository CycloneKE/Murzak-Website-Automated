import React, { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ClosingCta, FaqBand, MUTED, PageHero, PageSection, Points, RULE } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import AppPlans from '../../components/apps/AppPlans';
import { ProductCompanions } from '../../components/CompanionPicker';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
}

const MurzakPOS: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const toPrices = () => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' });

  // Deep links (/products/pos#plans, from the storefront and the advisor) land on the tiers.
  React.useEffect(() => {
    if (window.location.hash === '#plans') {
      requestAnimationFrame(toPrices);
    }
  }, []);

  const features = [
    { t: 'Sell on any device', s: 'Runs in a browser on a tablet, laptop or a dedicated till. Works with standard receipt printers and barcode scanners.' },
    { t: 'Stock you can trust', s: 'Every sale updates stock straight away, across all your branches.' },
    { t: 'M-Pesa at the till', s: 'The customer gets a payment prompt on their phone and the sale is confirmed automatically. Money goes to your own Till or Paybill.' },
    { t: 'Keeps selling offline', s: 'If the internet drops you can carry on ringing up sales. They sync when the connection is back.' },
  ];

  const faqs: FaqItem[] = [
    { q: 'What hardware do I need?', a: 'Murzak POS runs on any modern browser. You can use your existing PC, tablet, or smartphone. We also support standard receipt printers and barcode scanners.' },
    { q: 'Does it work if my internet goes down?', a: 'Yes. Our POS has an offline mode that allows you to continue ringing up sales. Once the connection is restored, everything syncs automatically to the cloud.' },
    { q: 'How are M-Pesa payments settled?', a: 'Payments flow directly into your own M-Pesa Till or Paybill. We simply integrate the API so the till prompts the customer and the POS receives automatic confirmation.' },
    { q: 'Can I manage multiple branches?', a: 'Yes. The larger sizes cover several branches, with stock transfers and sales tracked across all of them.' },
    { q: 'Is training included?', a: 'Yes, we provide onboarding and training for your staff to ensure a smooth transition.' },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Products', page: 'products' }, { label: 'Murzak POS' }]}
        title="A till, stock control and M-Pesa in one system."
        lead="Murzak POS is built for Kenyan shops. Ring up sales, know what is on the shelf, and take M-Pesa at the counter, from one shop to many branches."
        price={<>from {formatKes(serviceMonthlyKes('biz-pos-duka'))}/mo. Your own POS at yourshop.pos.murzaktech.tech, ready minutes after payment.</>}
      >
        <Button onClick={toPrices}>
          See prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => setSalesOpen(true)}>
          Book a demo
        </Button>
      </PageHero>

      <PageSection title="What it does">
        <Points items={features} cols={4} />
      </PageSection>

      <PageSection tinted>
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Quick at the counter</h2>
            <p className={`mt-3 leading-relaxed ${MUTED}`}>
              Scan a barcode or tap the item, apply a discount, take payment and print the receipt. Cashiers can serve a
              queue without reaching for a mouse.
            </p>
            <ul className="mt-5 space-y-2.5">
              {['Barcode scanning', 'Quick-add categories', 'M-Pesa payment prompt', 'Your own receipt layout'].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm font-semibold">
                  <Check size={16} className="text-murzak-success shrink-0" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <img
            src="/images/pos-dashboard.png"
            alt="Murzak POS checkout screen with an M-Pesa payment"
            className="w-full rounded-2xl border border-murzak-border dark:border-white/10"
            loading="lazy"
          />
        </div>
      </PageSection>

      {/* Prices. AppPlans renders its own <section id="plans">. */}
      <div className={RULE}>
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 pt-14 sm:pt-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-murzak-ink dark:text-slate-100">Prices</h2>
          <p className={`mt-2 max-w-2xl ${MUTED}`}>Three sizes. Pick by how many shops you run; you can move up later.</p>
        </div>
        <AppPlans
          app="pos"
          onChoose={(serviceId, term) => onNavigate(`/get/pos?service=${encodeURIComponent(serviceId)}&term=${term}`)}
        />
        <div className="px-4 sm:px-6 -mt-8 mb-16">
          <ProductCompanions primaryId="biz-pos-duka" />
        </div>
      </div>

      <FaqBand>
        <Faq items={faqs} title="Questions about Murzak POS" />
      </FaqBand>

      <ClosingCta title="Want to see it before you buy?" lead="We can walk you through it with your own products.">
        <Button onClick={toPrices}>
          See prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => setSalesOpen(true)}>
          Book a demo
        </Button>
      </ClosingCta>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="demo" />
    </main>
  );
};

export default MurzakPOS;
