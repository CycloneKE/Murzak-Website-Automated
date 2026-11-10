import React from 'react';
import { ArrowRight } from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';
import { CARD, ClosingCta, LINK, MUTED, PageHero, PageSection, Points } from '../components/ui/Page';
import { SUPPORT_EMAIL } from '../config/contact';

const TEAM = [
  {
    name: 'Joe Sylvester',
    role: 'Co-founder',
    bio: 'Co-founded Murzak in 2023 to build software that fits how African businesses actually work, not the other way around.',
    img: '/images/team/joe-sylvester.jpg',
    initials: 'JS',
  },
  {
    name: 'Kevin Njenga',
    role: 'Co-founder',
    bio: 'Co-founded Murzak in 2023 to build software that fits how African businesses actually work, not the other way around.',
    img: '/images/team/kevin-njenga.jpg',
    initials: 'KN',
  },
  {
    name: 'Denvine Brian',
    role: 'Project manager',
    bio: 'Keeps every Murzak build on track, from first kickoff call to the day it ships and beyond.',
    img: '/images/team/denvine-brian.jpg',
    initials: 'DB',
  },
];

const BUILT = [
  { t: 'My Style Movers & Logistics', s: 'A logistics management platform built for My Style Movers and Logistics Company to run their moving and freight operations.', status: 'Live' },
  { t: 'Murzak POS', s: 'Point-of-sale and inventory system built for how Kenyan retail runs, from tills to stock counts.', status: 'Live' },
  { t: 'Murzak DMS & E-Signature', s: 'Document management and e-signature system for storing, routing and signing business documents.', status: 'Live' },
  { t: 'Shipstack', s: 'A logistics and tracking platform following goods from raw material to end client, for pharmaceuticals, agriculture, e-commerce and more.', status: 'In development' },
];

const About: React.FC<NavProps> = ({ onNavigate }) => {
  const go = onNavigate as (pageOrPath: string) => void;

  return (
    <main>
      <PageHero
        onNavigate={go}
        title="We run the tech, so you can run your business."
        lead="Murzak Technologies is a Nairobi team that hosts, builds and looks after the software small and growing businesses depend on."
      >
        <Button onClick={() => go('contact')}>
          Talk to us <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => go('products')}>
          See products and prices
        </Button>
      </PageHero>

      <PageSection title="Why we started">
        <div className={`space-y-4 max-w-2xl leading-relaxed ${MUTED}`}>
          <p>
            Murzak Technologies was founded in 2023 by Joe Sylvester and Kevin Njenga on a simple idea: African
            businesses deserve software that is built around them, not adapted as an afterthought. Too many good
            businesses were being let down by hosting that went dark, vendors who disappeared, and invoices in dollars.
          </p>
          <p>
            Most technology companies talk to engineers. We talk to the person who carries the risk: the owner whose
            shop cannot take payments when the system is down, the manager buried in spreadsheets at month-end.
          </p>
          <p>
            So we keep it simple: prices you can see before you commit, systems set up for you, and one team that stays
            accountable for keeping them running.
          </p>
        </div>
      </PageSection>

      <PageSection title="The people behind Murzak" tinted>
        <div className="grid sm:grid-cols-3 gap-4">
          {TEAM.map((p) => (
            <article key={p.name} className={`${CARD} p-6`}>
              <div className="relative w-14 h-14 rounded-full mb-4 flex items-center justify-center bg-slate-100 dark:bg-white/10 font-extrabold overflow-hidden">
                <span>{p.initials}</span>
                <img
                  src={p.img}
                  alt={p.name}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
              <h3 className="text-lg font-extrabold">{p.name}</h3>
              <p className={`text-sm font-semibold ${MUTED}`}>{p.role}</p>
              <p className={`mt-3 text-sm leading-relaxed ${MUTED}`}>{p.bio}</p>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title="What we have built">
        <div className="grid sm:grid-cols-2 gap-4">
          {BUILT.map((p) => (
            <article key={p.t} className={`${CARD} p-6`}>
              <p className={`text-xs font-bold ${MUTED}`}>{p.status}</p>
              <h3 className="mt-1 text-lg font-extrabold">{p.t}</h3>
              <p className={`mt-2 text-sm leading-relaxed ${MUTED}`}>{p.s}</p>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title="What you can expect from us" tinted>
        <Points
          items={[
            { t: 'We speak plainly', s: 'No jargon and no "digital transformation" speeches. We explain things the way we would want them explained to us.' },
            { t: 'We build and we stay', s: 'We do not hand over a system and vanish. We host it, maintain it, and pick up the phone.' },
            { t: 'We are local on purpose', s: 'Shillings, M-Pesa, your time zone. We built Murzak for how business works here.' },
          ]}
        />
      </PageSection>

      <PageSection title="Contact">
        <div className="grid lg:grid-cols-2 gap-10">
          <p className={`max-w-md leading-relaxed ${MUTED}`}>
            Tell us what you are trying to do in plain words. Our Nairobi team usually replies within one business day,
            and you will be talking to the people who run your systems.
          </p>
          <dl className={`${CARD} divide-y divide-murzak-border dark:divide-white/10 text-sm`}>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className={MUTED}>Email</dt>
              <dd>
                <a href={`mailto:${SUPPORT_EMAIL}`} className={`${LINK} break-all`}>
                  {SUPPORT_EMAIL}
                </a>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className={MUTED}>Location</dt>
              <dd className="font-bold">Nairobi, Kenya</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className={MUTED}>Hours</dt>
              <dd className="font-bold">Mon–Fri, 8:00–18:00 EAT</dd>
            </div>
          </dl>
        </div>
      </PageSection>

      <ClosingCta title="Let's talk about your business." lead="A straight conversation about what would actually help.">
        <Button onClick={() => go('contact')}>
          Talk to us <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => go('products')}>
          See products and prices
        </Button>
      </ClosingCta>
    </main>
  );
};

export default About;
