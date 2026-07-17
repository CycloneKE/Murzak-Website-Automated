
import React from 'react';
import { ArrowRight, MapPin, Heart, Wrench, Phone, Mail, Clock, Server, Boxes, Code2, ArrowUpRight } from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';

const SUPPORT_EMAIL = 'support@murzaktech.com';

const About: React.FC<NavProps> = ({ onNavigate }) => {
  const values = [
    { icon: <Heart size={20} />, t: 'We speak plainly', s: 'No jargon, no "digital transformation" speeches. We explain things the way we\'d want them explained to us.' },
    { icon: <Wrench size={20} />, t: 'We build and we stay', s: 'We don\'t hand over a system and vanish. We host it, maintain it, and pick up the phone.' },
    { icon: <MapPin size={20} />, t: 'We\'re local on purpose', s: 'Shillings, M-Pesa, your time zone. We built Murzak for how business actually works here.' },
  ];

  return (
    <main className="text-murzak-ink overflow-x-hidden">
      {/* Hero */}
      <section className="relative pt-20 lg:pt-32 pb-16 overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-[-10%] w-[620px] h-[620px] rounded-full blur-[150px] bg-brand-gradient opacity-20 animate-drift-slow -z-10" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-5">About Murzak</p>
          <h1 className="text-[clamp(2.4rem,6vw,5rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl">
            We run the tech, so you can <span className="text-murzak-gradient">run your business.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-600 font-medium max-w-2xl leading-relaxed">
            Murzak Technologies is a Nairobi team that hosts, builds and looks after the software small
            and growing businesses depend on. We started it because too many good businesses were being
            let down by hosting that went dark, vendors who disappeared, and invoices in dollars.
          </p>
        </div>
      </section>

      {/* At a glance */}
      <section className="pb-8">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-3xl overflow-hidden border border-murzak-border bg-black/5">
            {[
              { big: 'Nairobi', label: 'Based & operated' },
              { big: 'KES', label: 'Billed in shillings' },
              { big: '99.9%', label: 'Uptime target' },
              { big: 'Same-day', label: 'Setup & support' },
            ].map((s) => (
              <div key={s.label} className="bg-black/5 p-6 lg:p-8">
                <div className="text-2xl lg:text-3xl font-[900] text-murzak-gradient tracking-tight">{s.big}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 lg:py-24 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 grid lg:grid-cols-[1fr_1.2fr] gap-12 items-start">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">
            Built for the business owner, not the IT department.
          </h2>
          <div className="space-y-5 text-slate-600 font-medium leading-relaxed text-[15px]">
            <p>
              Most technology companies talk to engineers. We talk to the person who actually carries the
              risk — the owner whose shop can't take payments when the system is down, the manager drowning
              in spreadsheets at month-end.
            </p>
            <p>
              So we keep it simple: clear prices you can see before you commit, systems set up and migrated
              for you, and one team that stays accountable for keeping it all running. When you grow, we
              grow the infrastructure with you.
            </p>
            <p className="text-murzak-ink font-bold">
              That's the whole idea — competent, local, and genuinely on your side.
            </p>
          </div>
        </div>
      </section>

      {/* What we do */}
      <section className="py-16 lg:py-24 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-4">What we do</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Three things, done properly.</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: <Server size={20} />, t: 'Managed hosting', s: 'Websites, email and databases — provisioned, secured and backed up for you on Murzak Cloud.', page: 'cloud' as const, cta: 'Murzak Cloud' },
              { icon: <Boxes size={20} />, t: 'Business systems', s: 'Murzak ERP, POS, CRM and accounting, configured around how your team actually works.', page: 'products' as const, cta: 'See products' },
              { icon: <Code2 size={20} />, t: 'Custom software', s: 'When off-the-shelf won’t do, we design, build and keep running the exact system you need.', page: 'products' as const, cta: 'Start a build' },
            ].map((c) => (
              <button key={c.t} onClick={() => onNavigate(c.page)} className="group text-left rounded-3xl border border-transparent bg-white/60 backdrop-blur-md p-7 transition-all hover:border-white/60 hover:bg-white/40">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                <h3 className="text-lg font-black text-murzak-ink mb-2">{c.t}</h3>
                <p className="text-[13px] text-slate-500 font-medium leading-relaxed mb-5">{c.s}</p>
                <span className="inline-flex items-center gap-2 font-black text-[10px] uppercase tracking-widest text-murzak-accent group-hover:gap-3 transition-all">{c.cta} <ArrowUpRight size={14} /></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 lg:py-24 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="max-w-2xl mb-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-4">How we work</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">What you can expect from us.</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {values.map((v) => (
              <div key={v.t} className="rounded-3xl border border-transparent bg-white/60 backdrop-blur-md p-7">
                <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{v.icon}</div>
                <h3 className="text-lg font-black text-murzak-ink mb-2">{v.t}</h3>
                <p className="text-[13px] text-slate-500 font-medium leading-relaxed">{v.s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact us */}
      <section className="py-16 lg:py-24 border-t border-murzak-border/50">
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-murzak-accent mb-4">Contact us</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">
                Talk to a real person — <span className="text-murzak-gradient">no call centre.</span>
              </h2>
              <p className="mt-5 text-slate-600 font-medium leading-relaxed max-w-md">
                Tell us what you’re trying to do in plain words. Our Nairobi team usually replies within one
                business day — and you’ll be talking to the people who actually run your systems.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Button onClick={() => onNavigate('contact')}>
                  <Phone size={17} /> Send us a message
                </Button>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-7 py-4 font-black text-sm uppercase tracking-widest text-murzak-ink hover:bg-black/5 transition-all">
                  Email us
                </a>
              </div>
            </div>

            <div className="rounded-[2.5rem] border border-transparent bg-white/60 backdrop-blur-md p-8 sm:p-10 space-y-7">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><Mail size={18} /></div>
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Email</p>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm font-black text-murzak-ink hover:text-murzak-accent transition break-all">{SUPPORT_EMAIL}</a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><MapPin size={18} /></div>
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Location</p>
                  <p className="text-sm font-black text-murzak-ink">Nairobi, Kenya</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><Clock size={18} /></div>
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Hours</p>
                  <p className="text-sm font-black text-murzak-ink">Mon–Fri · 8:00–18:00 EAT</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 border-y border-murzak-border" />
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink">Let's talk about your business.</h2>
          <p className="mt-4 text-lg text-murzak-ink/85 font-medium">No pitch, no pressure — just a straight conversation about what would actually help.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="primary" onClick={() => onNavigate('contact')}>
              <Phone size={17} /> Talk to us
            </Button>
            <Button variant="outline" onClick={() => onNavigate('pricing')}>
              Build a plan <ArrowRight size={17} />
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default About;
