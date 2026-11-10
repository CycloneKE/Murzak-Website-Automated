import React, { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ClosingCta, FaqBand, MUTED, PageHero, PageSection, Points } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import { formatKes, serviceMonthlyKes, serviceSetupKes } from '../../config/serviceCatalog';
import { ProductCompanions } from '../../components/CompanionPicker';
import { useAvailability } from '../../components/AvailabilityNotice';

interface Props {
  onNavigate: (page: string) => void;
}

const SERVICE_ID = 'biz-crm-helpdesk';

const MurzakCRM: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);
  const availability = useAvailability();
  const buy = () => onNavigate(`/checkout/new?serviceId=${SERVICE_ID}`);
  const setup = serviceSetupKes(SERVICE_ID);

  const features = [
    { t: 'Sales pipeline', s: 'A board of your deals, from first contact to closed. Drag a deal along as it moves.' },
    { t: 'Support tickets', s: 'Customer emails become tickets you can assign, tag and close.' },
    { t: 'Email in one place', s: 'Connect your business email and reply to customers without leaving the CRM.' },
    { t: 'Shared WhatsApp inbox', s: 'Bring WhatsApp conversations into one inbox the whole team can see.' },
  ];

  const faqs: FaqItem[] = [
    { q: 'Does it integrate with my website?', a: 'Yes, you can embed contact forms on your website that automatically create leads or tickets in Murzak CRM.' },
    { q: 'Can I connect it to Murzak ERP?', a: 'Yes. They are built on the same framework, so a lead won in the CRM becomes a customer in the ERP, ready for invoicing.' },
    { q: 'How many users can I have?', a: 'The base subscription covers your whole core team, and we scale resources as your data and user base grow.' },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Products', page: 'products' }, { label: 'CRM & Helpdesk' }]}
        title="Every lead and every support request in one place."
        lead="Murzak CRM & Helpdesk keeps sales and customer support out of personal WhatsApp threads and inboxes, so nothing depends on one person's phone."
        price={
          <>
            {formatKes(serviceMonthlyKes(SERVICE_ID))}/mo
            {setup ? ` + ${formatKes(setup)} one-time setup` : ''}
          </>
        }
      >
        <Button onClick={buy}>
          Get Murzak CRM <ArrowRight size={18} />
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
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">See where every deal stands</h2>
            <p className={`mt-3 leading-relaxed ${MUTED}`}>
              Set the pipeline stages to match how you actually sell, then move deals across the board as they progress.
            </p>
            <ul className="mt-5 space-y-2.5">
              {['Follow-up reminders', 'Revenue forecasting', 'Won and lost deal reports'].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm font-semibold">
                  <Check size={16} className="text-murzak-success shrink-0" /> {item}
                </li>
              ))}
            </ul>
          </div>
          <img
            src="/images/crm-kanban.png"
            alt="Murzak CRM board showing sales pipeline stages"
            className="w-full rounded-2xl border border-murzak-border dark:border-white/10"
            loading="lazy"
          />
        </div>
      </PageSection>

      {/* Only when add-ons can actually be ordered; the picker draws nothing otherwise. */}
      {availability && (
      <PageSection title="Add to your order" lead="Optional extras you can buy with the CRM.">
        <ProductCompanions primaryId={SERVICE_ID} className="!mx-0" />
        <div className="mt-8">
          <Button onClick={buy}>
            Continue with Murzak CRM <ArrowRight size={18} />
          </Button>
        </div>
      </PageSection>
      )}

      <FaqBand>
        <Faq items={faqs} title="Questions about Murzak CRM" />
      </FaqBand>

      <ClosingCta title="Want to see it first?" lead="We can show you the CRM with a pipeline like yours.">
        <Button onClick={buy}>
          Get Murzak CRM <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => setSalesOpen(true)}>
          Book a demo
        </Button>
      </ClosingCta>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="demo" />
    </main>
  );
};

export default MurzakCRM;
