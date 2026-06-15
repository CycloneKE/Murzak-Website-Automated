
import React from 'react';
import { Linkedin, Twitter, Instagram, Activity, Mail, MapPin, Clock, ArrowUpRight } from 'lucide-react';
import { Page } from '../types';
import Logo from './Logo';

interface FooterProps {
  onNavigate: (page: Page) => void;
}

const SUPPORT_EMAIL = 'support@murzaktech.com';

const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const linkCls = 'hover:text-white transition-colors text-left';

  const exploreLinks: { label: string; page: Page }[] = [
    { label: 'Home', page: 'home' },
    { label: 'Murzak Cloud', page: 'cloud' },
    { label: 'Products', page: 'products' },
    { label: 'Pricing', page: 'pricing' },
  ];

  const companyLinks: { label: string; page: Page }[] = [
    { label: 'About Us', page: 'about' },
    { label: 'Contact', page: 'contact' },
    { label: 'Free 36-Hour Trial', page: 'test-request' },
    { label: 'Build a Plan', page: 'pricing' },
  ];

  return (
    <footer className="relative z-10 w-full flex-shrink-0 bg-murzak-navy dark:bg-murzak-deep text-white pt-20 pb-12 border-t border-white/5 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        {/* Top CTA band */}
        <div className="mb-16 lg:mb-20 rounded-[2.5rem] border border-white/10 bg-white/[0.03] p-8 sm:p-10 lg:p-12 flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="text-center lg:text-left">
            <h3 className="text-2xl sm:text-3xl font-[900] tracking-tight">Ready when you are.</h3>
            <p className="mt-2 text-slate-400 font-medium text-sm sm:text-base max-w-xl">
              Build a plan in two minutes, or talk to a real person in Nairobi who'll actually pick up.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <button
              onClick={() => onNavigate('pricing')}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-cyan text-murzak-navy px-7 py-3.5 font-black text-[10px] uppercase tracking-widest hover:scale-[1.03] transition-all shadow-lg shadow-murzak-cyan/20"
            >
              Build my plan <ArrowUpRight size={15} />
            </button>
            <button
              onClick={() => onNavigate('contact')}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-7 py-3.5 font-black text-[10px] uppercase tracking-widest text-white hover:bg-white/10 transition-all"
            >
              Talk to us
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-12 gap-12 lg:gap-10">
          {/* Brand + contact */}
          <div className="col-span-2 md:col-span-4">
            <Logo theme="dark" className="h-11 mb-6" />
            <p className="text-slate-400 text-sm leading-relaxed mb-7 font-medium max-w-xs">
              Nairobi's managed-technology partner. We host, build and look after the software small and
              growing businesses depend on — set up for you, billed in shillings, supported by real people.
            </p>

            <ul className="space-y-3 mb-7">
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 text-slate-300 hover:text-murzak-cyan transition-colors text-sm font-bold">
                  <span className="p-2 rounded-xl bg-white/5 text-murzak-cyan"><Mail size={15} /></span>
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li className="flex items-center gap-3 text-slate-300 text-sm font-bold">
                <span className="p-2 rounded-xl bg-white/5 text-murzak-cyan"><MapPin size={15} /></span>
                Nairobi, Kenya
              </li>
              <li className="flex items-center gap-3 text-slate-300 text-sm font-bold">
                <span className="p-2 rounded-xl bg-white/5 text-murzak-cyan"><Clock size={15} /></span>
                Mon–Fri · 8:00–18:00 EAT
              </li>
            </ul>

            <div className="flex space-x-3">
              <a
                href="https://www.linkedin.com/in/murzak-technologies-1774b63a9"
                target="_blank" rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-murzak-cyan hover:bg-white/10 transition-all focus:outline-none focus:ring-2 focus:ring-murzak-cyan"
                aria-label="LinkedIn"
              >
                <Linkedin size={18} />
              </a>
              <a
                href="https://twitter.com/MurzakTech"
                target="_blank" rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-murzak-cyan hover:bg-white/10 transition-all focus:outline-none focus:ring-2 focus:ring-murzak-cyan"
                aria-label="Twitter / X"
              >
                <Twitter size={18} />
              </a>
              <a
                href="https://instagram.com/Murzaktechnologies"
                target="_blank" rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-slate-400 hover:text-murzak-cyan hover:bg-white/10 transition-all focus:outline-none focus:ring-2 focus:ring-murzak-cyan"
                aria-label="Instagram"
              >
                <Instagram size={18} />
              </a>
            </div>
          </div>

          {/* Explore */}
          <div className="md:col-span-2">
            <h4 className="font-black text-[10px] uppercase tracking-[0.3em] mb-7 text-murzak-cyan">Explore</h4>
            <ul className="space-y-4 text-slate-400 text-sm font-bold">
              {exploreLinks.map((l) => (
                <li key={l.label}><button onClick={() => onNavigate(l.page)} className={linkCls}>{l.label}</button></li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div className="md:col-span-2">
            <h4 className="font-black text-[10px] uppercase tracking-[0.3em] mb-7 text-murzak-cyan">Company</h4>
            <ul className="space-y-4 text-slate-400 text-sm font-bold">
              {companyLinks.map((l) => (
                <li key={l.label}><button onClick={() => onNavigate(l.page)} className={linkCls}>{l.label}</button></li>
              ))}
            </ul>
          </div>

          {/* Infrastructure */}
          <div className="col-span-2 md:col-span-4">
            <h4 className="font-black text-[10px] uppercase tracking-[0.3em] mb-7 text-murzak-cyan">Infrastructure</h4>
            <div className="bg-white/5 rounded-3xl p-7 border border-white/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2.5 h-2.5 bg-murzak-cyan rounded-full" />
                <span className="text-[11px] font-black uppercase tracking-widest text-white">Nairobi-managed cloud</span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                Daily backups · Enabled<br />
                SSL &amp; security · Enforced<br />
                M-Pesa &amp; KES billing
              </p>
              <button
                onClick={() => onNavigate('sla')}
                className="mt-5 pt-5 border-t border-white/10 w-full flex items-center gap-2 text-murzak-cyan text-[10px] font-black uppercase tracking-widest hover:text-white transition-colors"
              >
                <Activity size={14} /> 99.9% uptime SLA →
              </button>
            </div>
          </div>
        </div>

        <div className="mt-16 pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-slate-500 text-[9px] font-black uppercase tracking-[0.2em] text-center md:text-left gap-6">
          <p>© {new Date().getFullYear()} Murzak Technologies Limited · Registered in Kenya</p>
          <div className="flex flex-wrap justify-center gap-6 sm:gap-8">
            <button onClick={() => onNavigate('about')} className="hover:text-white transition-colors">About</button>
            <button onClick={() => onNavigate('contact')} className="hover:text-white transition-colors">Contact</button>
            <button onClick={() => onNavigate('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
            <button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors">Terms of Service</button>
            <button onClick={() => onNavigate('sla')} className="hover:text-white transition-colors">SLA</button>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
