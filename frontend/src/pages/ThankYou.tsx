import React, { useEffect } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';

interface Props {
  onNavigate: (page: string) => void;
}

// A real, stable URL for the moment right after a successful payment — the
// inline "Payment received" step inside PaymentMethods shows the specific
// per-flow message, but it auto-advances within ~1.2s and was never a
// distinct page, so there was nowhere for a conversion-tracking pixel (GA4
// Ads goal, etc.) to fire against. This page exists for exactly that; it
// still auto-continues to the portal so the flow feels the same as before.
const REDIRECT_DELAY_MS = 2500;

const ThankYou: React.FC<Props> = ({ onNavigate }) => {
  useEffect(() => {
    const timer = setTimeout(() => onNavigate('portal'), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onNavigate]);

  return (
    <div className="animate-fade-in bg-transparent text-murzak-ink dark:text-slate-100 transition-colors duration-300">
      <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden bg-transparent px-6">
        <img
          src="/images/checkout-flow-bg.webp"
          alt=""
          className="absolute inset-0 z-[-2] w-full h-full object-cover opacity-20 dark:opacity-15 grayscale"
        />
        <div className="absolute inset-0 z-[-1] bg-gradient-to-b from-white via-white/95 to-white dark:from-murzak-ink dark:via-murzak-ink/95 dark:to-murzak-ink" />

        <div className="max-w-lg mx-auto text-center relative z-10">
          <CheckCircle2 size={56} className="text-green-500 mx-auto mb-8" />
          <h1 className="text-4xl lg:text-5xl font-[900] text-murzak-ink dark:text-slate-100 mb-4 tracking-tighter leading-[0.95]">
            You're all set.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-500 font-medium mb-10">
            Thanks for your payment. Taking you to your portal now.
          </p>
          <Button variant="primary" size="lg" onClick={() => onNavigate('portal')}>
            Go to your portal <ArrowRight size={18} />
          </Button>
        </div>
      </section>
    </div>
  );
};

export default ThankYou;
