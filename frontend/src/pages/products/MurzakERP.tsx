import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CARD, ClosingCta, FaqBand, MUTED, PageHero, PageMain, PageSection } from '../../components/ui/Page';
import Faq, { type FaqItem } from '../../components/Faq';
import SalesModal from '../../components/SalesModal';
import { formatKes, serviceMonthlyKes, serviceSetupKes } from '../../config/serviceCatalog';
import { ProductCompanions } from '../../components/CompanionPicker';

interface Props {
  onNavigate: (page: string) => void;
}

const MurzakERP: React.FC<Props> = ({ onNavigate }) => {
  const [salesOpen, setSalesOpen] = useState(false);

  const modules = [
    {
      title: "Accounting",
      bullets: [
        "Auto-generated general ledger from every sale, purchase, and journal entry, so you can drill down to trace any transaction",
        "Multi-currency, multi-branch chart of accounts with consolidated reporting",
        "VAT-ready tax ledgers, with KRA eTIMS available once your business is registered with KRA",
        "Real-time Balance Sheet, P&L, Trial Balance, and Cash Flow reports",
      ],
    },
    {
      title: "Inventory",
      bullets: [
        "Live stock levels across every warehouse, updated the moment a sale or delivery happens",
        "Item variants, batch/serial tracking, and automatic valuation",
        "Scheduled stock audits that flag discrepancies before they become losses",
        "Reports on stock value, movement trends, and slow-moving inventory",
      ],
    },
    {
      title: "HR & Payroll (optional module)",
      bullets: [
        "Full employee lifecycle: onboarding, transfers, promotions, exit interviews",
        "Geolocation-enabled attendance, configurable leave policies and KE public holidays",
        "Custom salary structures with payroll runs and payslips, configured to current KE statutory deductions (PAYE, SHIF, NSSF) during setup",
        "Expense claims and advances with multi-level approval, synced straight to accounting",
      ],
    },
    {
      title: "Manufacturing",
      bullets: [
        "Bills of materials define exactly what a finished product needs",
        "Work orders and job cards track every production step in real time",
        "Production planning that schedules runs against real demand and resource availability",
        "Quality checks built into the process, not bolted on after",
      ],
    },
    {
      title: "CRM",
      bullets: [
        "Capture and nurture leads through a visible pipeline, stage by stage",
        "Opportunity tracking with revenue forecasting",
        "Full customer history: every call, meeting, and quote in one record",
        "Sales performance reports your team can actually act on",
      ],
    },
    {
      title: "Projects",
      bullets: [
        "Task boards, milestones, and deadlines your team can see at a glance",
        "Time tracking that rolls straight into project cost and profitability",
        "Client-ready progress reporting without a separate spreadsheet",
      ],
    },
  ];

  const faqs: FaqItem[] = [
    { q: "Is it compliant with Kenyan tax laws?", a: "Murzak ERP is configured for Kenyan VAT. KRA eTIMS is supported through the Navari eTIMS integration, which we set up for you — KRA issues the branch ID and device credentials to your business directly, so eTIMS goes live once that registration completes, and we'll guide you through it. Payroll with PAYE, SHIF and NSSF deductions is an optional module we configure on request rather than something enabled by default." },
    { q: "How long does implementation take?", a: "A basic setup takes a few days. Full implementation with data migration and training typically takes 2-4 weeks depending on complexity." },
    { q: "Can we migrate our data from spreadsheets?", a: "Yes. Our implementation team handles data migration from Excel, CSV, or legacy systems like QuickBooks and Sage." },
    { q: "Who owns our data?", a: "You do. You can export your data at any time, and we never lock you in." },
  ];

  const tiers = [
    { id: 'biz-erp-light', name: 'Light', who: '1 to 3 users', blurb: 'For a small business moving off spreadsheets.' },
    { id: 'biz-erp-configured', name: 'Configured', who: '5 to 20 users', blurb: 'Data migration, training and workflows tailored to you are included.' },
  ];

  return (
    <PageMain theme="erp">
      <PageHero
        onNavigate={onNavigate}
        crumbs={[{ label: 'Home', page: 'home' }, { label: 'Products', page: 'products' }, { label: 'Murzak ERP' }]}
        title="One system for accounts, stock, people and sales."
        lead="Murzak ERP replaces the spreadsheets and separate tools a growing Kenyan business ends up juggling. Everything is recorded once and shows up everywhere it is needed."
        price={<>from {formatKes(serviceMonthlyKes('biz-erp-light'))}/mo</>}
      >
        <Button onClick={() => document.getElementById('erp-prices')?.scrollIntoView({ behavior: 'smooth' })}>
          See prices <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => setSalesOpen(true)}>
          Book a demo
        </Button>
      </PageHero>

      <PageSection title="What is in it" lead="The modules share one set of data, so a sale updates stock and the accounts without anyone retyping it.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m) => (
            <article key={m.title} className={`${CARD} p-6`}>
              <h3 className="text-lg font-extrabold">{m.title}</h3>
              <ul className={`mt-3 space-y-2 text-sm leading-relaxed ${MUTED}`}>
                {m.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span className="mt-2 h-1 w-1 rounded-full bg-current shrink-0" aria-hidden="true" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection title="Set up for Kenyan tax" tinted>
        <div className="grid lg:grid-cols-2 gap-10">
          <p className={`leading-relaxed ${MUTED}`}>
            Murzak ERP comes configured with Kenyan VAT rules. We set up the KRA eTIMS integration with you: KRA issues
            your branch and device credentials, and we take it from there. Payroll with PAYE, SHIF and NSSF is an
            optional module we configure during onboarding.
          </p>
          <dl className={`${CARD} divide-y divide-murzak-border dark:divide-white/10 text-sm`}>
            {[
              ['VAT (16%)', 'Included'],
              ['KRA eTIMS integration', 'Set up on request'],
              ['PAYE, SHIF & NSSF payroll', 'Optional module'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <dt className="font-bold">{k}</dt>
                <dd className={MUTED}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PageSection>

      <PageSection id="erp-prices" title="Prices" lead="Two sizes. Hosting is included in both.">
        <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
          {tiers.map((t) => {
            const setup = serviceSetupKes(t.id);
            return (
              <article key={t.id} className={`${CARD} p-6 flex flex-col`}>
                <h3 className="text-lg font-extrabold">{t.name}</h3>
                <p className={`text-sm font-semibold ${MUTED}`}>{t.who}</p>
                <p className="mt-4 text-2xl font-extrabold tabular-nums">
                  {formatKes(serviceMonthlyKes(t.id))}
                  <span className={`text-sm font-bold ${MUTED}`}>/mo</span>
                </p>
                <p className={`text-xs font-semibold min-h-4 ${MUTED}`}>{setup ? `+ ${formatKes(setup)} one-time setup` : ''}</p>
                <p className={`mt-3 text-sm leading-relaxed grow ${MUTED}`}>{t.blurb}</p>
                <Button className="mt-5 w-full" variant={t.id === 'biz-erp-light' ? 'outline' : 'primary'} onClick={() => onNavigate(`/checkout/new?serviceId=${t.id}`)}>
                  Select {t.name}
                </Button>
              </article>
            );
          })}
        </div>
        <ProductCompanions primaryId="biz-erp-light" className="mt-10 !mx-0" />
      </PageSection>

      <FaqBand>
        <Faq items={faqs} title="Questions about Murzak ERP" />
      </FaqBand>

      <ClosingCta title="Not sure which size fits?" lead="Tell us how your business runs and we will scope it with you.">
        <Button onClick={() => setSalesOpen(true)}>
          Get a quote <ArrowRight size={18} />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('pricing')}>
          All prices
        </Button>
      </ClosingCta>

      <SalesModal isOpen={salesOpen} onClose={() => setSalesOpen(false)} initialMode="quote" />
    </PageMain>
  );
};

export default MurzakERP;
