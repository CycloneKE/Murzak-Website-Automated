import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ClosingCta, FaqBand, PageHero, PageSection, Points, Steps } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import CloudLaunchModal from '../../components/CloudLaunchModal';
import { formatKes, serviceMonthlyKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const SERVICE_ID = 'starter-n8n';

const CloudN8N: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);

  // Things n8n itself can do once it is running. You build these; we host n8n.
  const examples = [
    { t: 'React to a payment', s: 'Receive an M-Pesa payment notification on a webhook and mark the matching invoice as paid.' },
    { t: 'Send a message', s: 'When an order comes in, send the customer a confirmation by WhatsApp, SMS or email.' },
    { t: 'Keep two systems in step', s: 'Copy new records from one tool into another, such as sales into your accounts or a spreadsheet.' },
  ];

  const faqs: FaqItem[] = [
    { q: 'What is n8n?', a: 'A tool for automating work between apps. You connect steps on a canvas ("when this happens, do that") without writing a full program.' },
    { q: 'What do I get after paying?', a: 'Your own n8n, installed and running at its own web address, with the login in your portal. It is yours alone, not shared with other customers.' },
    { q: 'Do you build the workflows for me?', a: 'This product is the hosted n8n. You build the workflows yourself. If you would like us to build them, talk to us about custom work.' },
    { q: 'Is there a limit on how many times a workflow can run?', a: 'We do not charge per run. It is one monthly price for the server n8n runs on.' },
    { q: 'How is it billed?', a: 'Monthly in Kenyan shillings, by M-Pesa or card. You can pay yearly at checkout for a lower price.' },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Automation' }]}
        title="Your own n8n, installed and running."
        lead="n8n connects your apps so routine work happens by itself. We host it for one monthly price; you build the workflows."
        price={<>{formatKes(serviceMonthlyKes(SERVICE_ID))}/mo, with no charge per workflow run</>}
      >
        <Button onClick={() => setLaunchOpen(true)}>
          Launch n8n <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Ask us to build a workflow
        </Button>
      </PageHero>

      <PageSection title="What people use it for" lead="Examples of workflows you can build once it is running.">
        <Points items={examples} />
      </PageSection>

      <PageSection title="How it works" tinted>
        <Steps
          items={[
            { t: 'Launch it', s: 'Start the order from this page. There is nothing to configure.' },
            { t: 'Pay in shillings', s: 'M-Pesa or card, on the checkout page.' },
            { t: 'We install it', s: 'n8n is installed automatically after payment.' },
            { t: 'Build your workflows', s: 'Log in from your portal and start connecting your apps.' },
          ]}
        />
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about automation" />
      </FaqBand>

      <ClosingCta title="Would you like us to build it for you?" lead="We also design and build automations and custom software.">
        <Button onClick={() => setLaunchOpen(true)}>
          Launch n8n <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('custom-software')}>
          Custom software
        </Button>
      </ClosingCta>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={SERVICE_ID}
      />
    </main>
  );
};

export default CloudN8N;
