import React from 'react';
import IndustryPage from '../../components/IndustryPage';

interface Props {
  onNavigate: (page: string) => void;
}

const ForRetail: React.FC<Props> = ({ onNavigate }) => (
  <IndustryPage
    onNavigate={onNavigate}
    theme="retail"
    crumb="Retail & shops"
    title="For shops: the till, the stock and the books in one place."
    lead="Stop counting stock by hand and reconciling M-Pesa at midnight. This is what we usually set up for a shop."
    sectionTitle="What a shop usually needs"
    sectionLead="Start with the till. Add the rest when you are ready."
    items={[
      { kind: 'Ready to buy', title: 'Murzak POS', desc: 'Sell on a tablet or laptop, scan barcodes and take M-Pesa at the counter.', path: 'pos', offer: 'pos' },
      { kind: 'Ready to buy', title: 'Murzak ERP', desc: 'Stock across branches, purchase orders and accounts.', path: 'erp', offer: 'erp' },
      { kind: 'Ready to buy', title: 'Business email', desc: 'Mailboxes on your own domain for managers and branches.', path: '/cloud/email', offer: 'email' },
    ]}
    closing={{
      title: 'Ready to set up your till?',
      lead: 'Pick a POS size and it is ready minutes after payment.',
      cta: 'See POS prices',
      action: '/products/pos#plans',
    }}
  />
);

export default ForRetail;
