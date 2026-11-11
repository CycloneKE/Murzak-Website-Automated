import React from 'react';
import Faq, { type FaqItem } from '../../components/Faq';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PageHero, PageMain, PageSection } from '../../components/ui/Page';
import DomainOrder from '../../components/DomainOrder';
import { formatKes } from '../../config/serviceCatalog';
import { TLD_OPTIONS } from '../../services/domains';

interface Props {
  onNavigate: (page: string) => void;
  isLoggedIn?: boolean;
}

const MUTED = 'text-slate-600 dark:text-slate-400';

// Who each ending suits. Prices come from TLD_OPTIONS, never from here.
const TLD_NOTES: Record<string, string> = {
  '.co.ke': 'The usual choice for a Kenyan business',
  '.com': 'Recognised everywhere',
  '.ke': 'Short and Kenyan',
  '.org': 'Organisations and non-profits',
  '.net': 'A common alternative to .com',
  '.africa': 'For a continent-wide audience',
  '.io': 'Popular with tech products',
};

const CloudDomains: React.FC<Props> = ({ onNavigate, isLoggedIn = false }) => {
  const afterPayment = [
    { t: 'It is registered in your name', s: 'You own the domain. We handle the registration and keep it renewed each year while you keep paying for it.' },
    { t: 'It shows up in your portal', s: 'See the renewal date and connect the domain to a website, app or mailboxes you run with us.' },
    { t: 'Use it wherever you like', s: 'Hosting with us is optional. You can point the domain at any other provider.' },
  ];

  const faqs: FaqItem[] = [
    { q: 'What exactly am I paying for?', a: 'One year of registration for the name you picked. The price in the search results is the full amount due today; there is no setup fee.' },
    { q: 'How do I pay?', a: 'In Kenyan shillings, by M-Pesa or card, on the checkout page after you review your order.' },
    { q: 'How long until the domain is mine?', a: '.com, .org, .net and .io are registered as soon as your payment goes through. .co.ke, .ke and .africa are registered by our team after payment, and we email you when it is done.' },
    { q: 'What happens after the first year?', a: 'The domain renews once a year at the price listed on this page. You will see the renewal date in your portal.' },
    { q: 'I already own a domain. Can I use it with Murzak?', a: 'Yes. You do not need to buy one here. When you set up a website, app or email with us you can choose to use a domain you already own.' },
  ];

  return (
    <PageMain theme="domains" className="text-murzak-ink dark:text-slate-100">
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Murzak Cloud', page: 'cloud' }, { label: 'Domains' }]}
        title="Register a domain name."
        lead="Search for the name you want, check the yearly price, and pay in shillings. Nothing is charged until you review your order."
        price={<>from {formatKes(Math.min(...TLD_OPTIONS.map((t) => t.priceKes)))} a year</>}
      >
        <Button onClick={() => document.getElementById('domain-search-input')?.focus()}>
          Search for a name <ArrowRight size={18} />
        </Button>
      </PageHero>

      <PageSection id="find" title="Find your name">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-7">
            <DomainOrder isLoggedIn={isLoggedIn} onNavigate={onNavigate} returnTo="/cloud/domains" />
          </div>
          <aside className="lg:col-span-5" aria-labelledby="domain-prices-title">
            <div className="rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5 p-5 sm:p-6">
              <h3 id="domain-prices-title" className="font-extrabold">Yearly prices</h3>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-murzak-border dark:divide-white/10">
                  {TLD_OPTIONS.map((t) => (
                    <tr key={t.tld}>
                      <th scope="row" className="py-2.5 pr-3 text-left font-extrabold whitespace-nowrap align-top">{t.tld}</th>
                      <td className={`py-2.5 pr-3 align-top ${MUTED}`}>{TLD_NOTES[t.tld] || ''}</td>
                      <td className="py-2.5 text-right font-bold tabular-nums whitespace-nowrap align-top">{formatKes(t.priceKes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`mt-3 text-xs ${MUTED}`}>Per year. The same price applies when the domain renews.</p>
            </div>
          </aside>
        </div>
      </PageSection>

      <section className="border-t border-murzak-border dark:border-white/10">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">After you pay</h2>
          <div className="mt-8 grid sm:grid-cols-3 gap-x-8 gap-y-8">
            {afterPayment.map((a) => (
              <div key={a.t}>
                <h3 className="font-extrabold">{a.t}</h3>
                <p className={`mt-1.5 text-sm leading-relaxed ${MUTED}`}>{a.s}</p>
              </div>
            ))}
          </div>
          <p className={`mt-10 text-sm ${MUTED}`}>
            Need something to put on the domain?{' '}
            <button type="button" onClick={() => onNavigate('/cloud/wordpress')} className="font-bold underline underline-offset-4 text-murzak-ink dark:text-slate-100">
              A website
            </button>
            {' '}or{' '}
            <button type="button" onClick={() => onNavigate('/cloud/email')} className="font-bold underline underline-offset-4 text-murzak-ink dark:text-slate-100">
              business email
            </button>
            {' '}are the usual next steps.
          </p>
        </div>
      </section>

      <section className="border-t border-murzak-border dark:border-white/10 py-14 sm:py-20">
        <Faq items={faqs} title="Questions about domains" eyebrow="Before you buy" />
      </section>
    </PageMain>
  );
};

export default CloudDomains;
