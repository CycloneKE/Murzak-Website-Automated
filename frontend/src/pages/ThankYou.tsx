import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ArrowRight, Server } from 'lucide-react';
import { Button } from '../components/ui/Button';

interface Props {
  onNavigate: (page: string) => void;
}

const REDIRECT_DELAY_MS = 2500;

const ThankYou: React.FC<Props> = ({ onNavigate }) => {
  const [searchParams] = useSearchParams();
  const serviceId = searchParams.get('service');
  const dest = serviceId
    ? `/portal/cloud?service=${encodeURIComponent(serviceId)}&justProvisioned=true`
    : '/portal/cloud';

  useEffect(() => {
    const timer = setTimeout(() => onNavigate(dest), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onNavigate, dest]);

  return (
    <div className="animate-fade-in bg-transparent text-murzak-ink dark:text-slate-100 transition-colors duration-300">
      <section className="relative min-h-[70vh] flex items-center justify-center overflow-hidden bg-transparent px-6">
        <img
          src="/images/checkout-flow-bg.webp"
          alt=""
          className="absolute inset-0 z-[-2] w-full h-full object-cover opacity-20 dark:opacity-15 grayscale"
        />
        <div className="absolute inset-0 z-[-1] bg-linear-to-b from-white via-white/95 to-white dark:from-murzak-ink dark:via-murzak-ink/95 dark:to-murzak-ink" />

        <div className="max-w-lg mx-auto text-center relative z-10">
          <CheckCircle2 size={56} className="text-green-500 mx-auto mb-6" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-micro font-bold uppercase mb-4">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Payment Confirmed · Provisioning Container
          </div>
          <h1 className="text-4xl lg:text-5xl font-[900] text-murzak-ink dark:text-slate-100 mb-4 tracking-tighter leading-[0.95]">
            You're all set.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 font-medium mb-8">
            Your container is being initialized on Murzak Cloud. Directing you to your dedicated management console now.
          </p>
          <Button variant="primary" size="lg" onClick={() => onNavigate(dest)}>
            Manage My Container <ArrowRight size={18} />
          </Button>
        </div>
      </section>
    </div>
  );
};

export default ThankYou;
