import React from 'react';
import IndustryPage from '../../components/IndustryPage';

interface Props {
  onNavigate: (page: string) => void;
}

const ForHealthcare: React.FC<Props> = ({ onNavigate }) => (
  <IndustryPage
    onNavigate={onNavigate}
    crumb="Clinics & healthcare"
    title="For clinics: less paperwork, more time with patients."
    lead="Billing, stock and bookings are where a clinic loses hours. This is what we usually set up, and which parts are built to order."
    sectionTitle="What a clinic usually needs"
    sectionLead="One ready-made system for the business side, plus custom work where your clinic is different."
    items={[
      { kind: 'Ready to buy', title: 'Murzak ERP', desc: 'Billing, pharmacy and lab stock, and accounts.', path: 'erp', offer: 'erp' },
      { kind: 'Built for you', title: 'Booking system', desc: 'Online appointment booking that fits how your doctors schedule.', path: 'custom-software' },
      { kind: 'Built for you', title: 'Patient records', desc: 'A records system designed around your clinic, with access limited to the right staff.', path: 'custom-software' },
    ]}
    closing={{
      title: 'Want to talk through your clinic?',
      lead: 'Tell us how you work today and we will scope it with you.',
      cta: 'Get a quote',
      action: 'quote',
    }}
  />
);

export default ForHealthcare;
