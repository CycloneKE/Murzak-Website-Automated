import React from 'react';
import IndustryPage from '../../components/IndustryPage';

interface Props {
  onNavigate: (page: string) => void;
}

const ForServices: React.FC<Props> = ({ onNavigate }) => (
  <IndustryPage
    onNavigate={onNavigate}
    theme="services"
    crumb="Professional services"
    title="For service firms: win the work, deliver it, get paid."
    lead="From first enquiry to final invoice, this is what we usually set up for agencies, consultancies and firms."
    sectionTitle="What a service firm usually needs"
    sectionLead="Start with the CRM. Add the ERP when projects and invoicing need more structure."
    items={[
      { kind: 'Ready to buy', title: 'Murzak CRM', desc: 'See your pipeline, track leads and remember to follow up.', path: 'crm', offer: 'crm' },
      { kind: 'Ready to buy', title: 'Murzak ERP', desc: 'Project profitability, timesheets and invoicing.', path: 'erp', offer: 'erp' },
      { kind: 'Built for you', title: 'Client portal', desc: 'A place for clients to approve proposals and see progress.', path: 'custom-software' },
    ]}
    closing={{
      title: 'Ready to get organised?',
      lead: 'See what each product costs, or talk it through with us.',
      cta: 'See products and prices',
      action: 'products',
    }}
  />
);

export default ForServices;
