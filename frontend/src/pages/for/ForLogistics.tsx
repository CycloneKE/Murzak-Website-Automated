import React from 'react';
import IndustryPage from '../../components/IndustryPage';

interface Props {
  onNavigate: (page: string) => void;
}

const ForLogistics: React.FC<Props> = ({ onNavigate }) => (
  <IndustryPage
    onNavigate={onNavigate}
    crumb="Logistics & delivery"
    title="For logistics: stop running dispatch on WhatsApp."
    lead="Track every delivery and give drivers, dispatch and customers the same status. Most of this is built to order, because no two fleets work the same way."
    note={{
      title: 'Sea, road or air, one status everyone sees',
      body: 'Whatever moves your freight, dispatch, drivers and customers look at the same record. No more chasing updates across several apps and a WhatsApp group.',
    }}
    sectionTitle="What a logistics business usually needs"
    sectionLead="A ready-made system for fleet and accounts, with dispatch and a customer portal built around you."
    items={[
      { kind: 'Built for you', title: 'Dispatch system', desc: 'Driver tracking, route planning and delivery statuses.', path: 'custom-software' },
      { kind: 'Ready to buy', title: 'Murzak ERP', desc: 'Fleet and asset records with full accounting.', path: 'erp', offer: 'erp' },
      { kind: 'Built for you', title: 'Customer portal', desc: 'A place for your clients to track their own shipments.', path: 'custom-software' },
    ]}
    closing={{
      title: 'Want to talk through your fleet?',
      lead: 'Describe how dispatch works today and we will tell you what it would take.',
      cta: 'Start a custom build',
      action: 'quote',
    }}
  />
);

export default ForLogistics;
