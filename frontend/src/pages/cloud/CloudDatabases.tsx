import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CARD, ClosingCta, FaqBand, MUTED, PageHero, PageSection, Steps } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import CloudLaunchModal from '../../components/CloudLaunchModal';
import { formatKes, serviceMonthlyKes, serviceSetupKes } from '../../config/serviceCatalog';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const ENGINES = [
  { id: 'db-postgres', name: 'PostgreSQL', use: 'The safe default for a new app. Relational, with good JSON support.' },
  { id: 'db-mysql', name: 'MySQL', use: 'What WordPress, most PHP apps and many existing systems expect.' },
  { id: 'db-mongo', name: 'MongoDB', use: 'Stores documents instead of tables, for data whose shape keeps changing.' },
  { id: 'db-redis', name: 'Redis', use: 'Keeps data in memory. Used for caching, queues and sessions next to a main database.' },
];

const CloudDatabases: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const [launchOpen, setLaunchOpen] = useState(false);
  const [selectedDb, setSelectedDb] = useState('db-postgres');

  const launch = (id: string) => {
    setSelectedDb(id);
    setLaunchOpen(true);
  };

  const setup = serviceSetupKes('db-postgres');

  const faqs: FaqItem[] = [
    { q: 'What do I get after paying?', a: 'A running database and its connection details: host, port, database name, username and password. They are shown in your portal.' },
    { q: 'Which engine should I pick?', a: 'If you are starting something new and have no preference, PostgreSQL. If your software asks for a specific one, pick that. They all cost the same.' },
    { q: 'Can I buy it together with app hosting?', a: 'Yes. When you launch app hosting you can add a database in the same step and pay for both on one invoice.' },
    { q: 'Can you move my existing database across?', a: 'Tell us what you are running today and we will tell you how we can help move it.' },
    { q: 'How is it billed?', a: 'Monthly in Kenyan shillings, by M-Pesa or card. You can pay yearly at checkout for a lower price.' },
  ];

  return (
    <main>
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Databases' }]}
        title="A database, set up for you."
        lead="Choose PostgreSQL, MySQL, MongoDB or Redis. We create it and give you the connection details, so you can point your app at it and get on with your work."
        price={
          <>
            {formatKes(serviceMonthlyKes('db-postgres'))}/mo for any engine
            {setup ? ` + ${formatKes(setup)} one-time setup` : ''}
          </>
        }
      >
        <Button onClick={() => launch('db-postgres')}>
          Launch a database <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('/cloud?launch=starter-app-hosting')}>
          Launch with app hosting
        </Button>
      </PageHero>

      <PageSection title="Choose an engine" lead="Same price for each. Pick the one your software expects.">
        <div className="grid sm:grid-cols-2 gap-4">
          {ENGINES.map((db) => (
            <article key={db.id} data-testid={`db-engine-${db.id}`} className={`${CARD} p-6 flex flex-col`}>
              <h3 className="text-lg font-extrabold">{db.name}</h3>
              <p className={`mt-2 text-sm leading-relaxed grow ${MUTED}`}>{db.use}</p>
              <div className="mt-5 flex items-center justify-between gap-4">
                <span className="font-extrabold tabular-nums">{formatKes(serviceMonthlyKes(db.id))}/mo</span>
                <Button size="sm" variant="outline" onClick={() => launch(db.id)}>
                  Launch {db.name} <ArrowRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title="How it works" tinted>
        <Steps
          items={[
            { t: 'Pick an engine', s: 'Choose one above. You do not need to size anything.' },
            { t: 'Pay in shillings', s: 'M-Pesa or card, on the checkout page.' },
            { t: 'We create it', s: 'The database is created automatically after payment.' },
            { t: 'Connect your app', s: 'Copy the connection details from your portal into your app.' },
          ]}
        />
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about databases" />
      </FaqBand>

      <ClosingCta title="Need an app to go with it?" lead="App hosting can include a database in the same order.">
        <Button onClick={() => onNavigate('/cloud?launch=starter-app-hosting')}>
          Launch app + database <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('contact')}>
          Talk to us
        </Button>
      </ClosingCta>

      <CloudLaunchModal
        isOpen={launchOpen}
        onClose={() => setLaunchOpen(false)}
        isLoggedIn={isLoggedIn}
        onNavigate={onNavigate}
        initialServiceId={selectedDb}
      />
    </main>
  );
};

export default CloudDatabases;
