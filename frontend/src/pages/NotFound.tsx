import React from 'react';
import { Compass, LifeBuoy } from 'lucide-react';
import { Button } from '../components/ui/Button';

interface Props {
  onNavigate: (page: string) => void;
}

const NotFound: React.FC<Props> = ({ onNavigate }) => {
  return (
    <div className="animate-fade-in bg-transparent text-murzak-ink dark:text-slate-100 transition-colors duration-300">
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden bg-transparent px-6">
        <div className="absolute inset-0 z-[-1] bg-gradient-to-b from-white via-white/95 to-white dark:from-murzak-ink dark:via-murzak-ink/95 dark:to-murzak-ink" />

        <div className="max-w-2xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center rounded-full bg-murzak-accent/10 px-4 py-2 text-micro font-black text-murzak-accent mb-8 uppercase border border-murzak-accent/20 backdrop-blur-md">
            Page not found
          </div>
          <h1 className="text-7xl lg:text-[10rem] font-[900] text-murzak-ink dark:text-slate-100 mb-6 tracking-tighter leading-[0.85]">
            4<span className="text-murzak-accent">0</span>4
          </h1>
          <p className="text-xl lg:text-2xl text-slate-700 dark:text-slate-400 font-bold mb-4">
            This page doesn't exist — or it moved.
          </p>
          <p className="text-base text-slate-600 dark:text-slate-500 font-medium mb-12 max-w-md mx-auto">
            Double-check the link, or use one of the shortcuts below. Everything
            else on Murzak is right where you left it.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="primary" size="lg" onClick={() => onNavigate('home')}>
              <Compass size={18} /> Back to home
            </Button>
            <Button variant="outline" size="lg" onClick={() => onNavigate('contact')}>
              <LifeBuoy size={18} /> Contact support
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default NotFound;
