import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ClosingCta, FaqBand, MUTED, PageHero, PageSection, Points, Steps } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';

interface Props {
  onNavigate: (page: string) => void;
}

const CustomSoftware: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const whatWeBuild = [
    { title: "Dispatch & Logistics", desc: "Driver tracking, route planning, and automated customer updates via SMS/WhatsApp." },
    { title: "Customer Portals", desc: "Secure web portals for your clients to view their accounts, statements, or project status." },
    { title: "M-Pesa Integrations", desc: "B2B, B2C, and C2B API integrations to automate your payment reconciliation." },
    { title: "Booking & Scheduling", desc: "Custom reservation systems for clinics, fleets, or specialized services." },
    { title: "Internal Dashboards", desc: "Pull data from multiple spreadsheets and legacy systems into one clean, live view." },
    { title: "Platform Modernization", desc: "Taking your 10-year-old Access database and turning it into a secure web application." },
  ];

  const faqs: FaqItem[] = [
    { q: "How much does a custom build cost?", a: "Projects typically start from KES 150,000 depending on complexity. We scope the work entirely upfront so there are no surprise bills later." },
    { q: "Who owns the code?", a: "You do. Upon project completion and final payment, the intellectual property and source code belong entirely to your company." },
    { q: "Do you maintain it after it's built?", a: "Yes. In fact, that's our whole model. We build it, host it on Murzak Cloud, and provide ongoing maintenance and support for a predictable monthly fee." },
    { q: "How long does a build take?", a: "Simple integrations or portals can take 3-4 weeks. Larger operational systems generally take 2-4 months." },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Products', page: 'products' }, { label: 'Custom software' }]}
        title="Software built around how you work."
        lead="When nothing ready-made fits, we design and build the system you need. We also host it and keep it running afterwards, so you are not left with code and no one to call."
        price={<>Projects typically start from KES 150,000, quoted at a fixed price before any code is written.</>}
      >
        <Button onClick={() => setSalesOpen(true)}>
          Start a build <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('products')}>
          See ready-made products
        </Button>
      </PageHero>

      <PageSection title="How a build works">
        <Steps
          items={[
            { t: 'We listen', s: 'We map out your current bottlenecks, spreadsheets and manual processes.' },
            { t: 'Design and quote', s: 'You get a clickable wireframe and a fixed-price quote before we write any code.' },
            { t: 'We build', s: 'Our Nairobi-based engineers build your system and show you progress every week.' },
            { t: 'We run it', s: 'We deploy it to Murzak Cloud and provide ongoing support.' },
          ]}
        />
      </PageSection>

      <PageSection
        title="Examples of what we build"
        lead="If your team is doing it by hand on WhatsApp or Excel, it can probably be a system."
        tinted
      >
        <Points items={whatWeBuild.map((w) => ({ t: w.title, s: w.desc }))} />
      </PageSection>

      <PageSection title="Tested before you get it">
        <p className={`max-w-2xl leading-relaxed ${MUTED}`}>
          Every build goes through a review pass covering payment flows, edge cases and the things that only break in
          real use, before we hand it over. We write it in widely used, well-supported technology (React, Node.js,
          Python, PostgreSQL, Flutter) so it stays maintainable for years.
        </p>
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about custom software" />
      </FaqBand>

      <ClosingCta title="Have something in mind?" lead="Describe the problem and we will tell you what it would take.">
        <Button onClick={() => setSalesOpen(true)}>
          Start a build <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </ClosingCta>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </main>
  );
};

export default CustomSoftware;
