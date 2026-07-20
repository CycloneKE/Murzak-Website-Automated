
import React from 'react';
import { ArrowRight, MapPin, Heart, Wrench, Phone, Mail, Clock, Server, Boxes, Code2, ArrowUpRight, Users, Truck, ShoppingCart, FileSignature, PackageSearch } from 'lucide-react';
import { NavProps } from '../types';
import { Button } from '../components/ui/Button';

const SUPPORT_EMAIL = 'support@murzaktech.com';

const About: React.FC<NavProps> = ({ onNavigate }) => {
  const values = [
    { icon: <Heart size={20} />, t: 'We speak plainly', s: 'No jargon, no "digital transformation" speeches. We explain things the way we\'d want them explained to us.' },
    { icon: <Wrench size={20} />, t: 'We build and we stay', s: 'We don\'t hand over a system and vanish. We host it, maintain it, and pick up the phone.' },
    { icon: <MapPin size={20} />, t: 'We\'re local on purpose', s: 'Shillings, M-Pesa, your time zone. We built Murzak for how business actually works here.' },
  ];

  const team = [
    {
      name: 'Joe Sylvester',
      role: 'Co-Founder',
      bio: 'Co-founded Murzak in 2023 to build software that fits how African businesses actually work, not the other way around.',
      img: '/images/team/joe-sylvester.jpg',
      initials: 'JS',
    },
    {
      name: 'Kevin Njenga',
      role: 'Co-Founder',
      bio: 'Co-founded Murzak in 2023 to build software that fits how African businesses actually work, not the other way around.',
      img: '/images/team/kevin-njenga.jpg',
      initials: 'KN',
    },
    {
      name: 'Denvine Brian',
      role: 'Project Manager',
      bio: 'Keeps every Murzak build on track — from first kickoff call to the day it ships and beyond.',
      img: '/images/team/denvine-brian.jpg',
      initials: 'DB',
    },
  ];

  const builtProducts = [
    {
      icon: <Truck size={20} />,
      t: 'My Style Movers & Logistics',
      s: 'A logistics management platform built for My Style Movers and Logistics Company to run their moving and freight operations.',
      status: 'Live',
    },
    {
      icon: <ShoppingCart size={20} />,
      t: 'Murzak POS',
      s: 'Point-of-sale and inventory system built for how Kenyan retail actually runs, from tills to stock counts.',
      status: 'Live',
    },
    {
      icon: <FileSignature size={20} />,
      t: 'Murzak DMS & E-Signature',
      s: 'Document management and e-signature system for storing, routing and signing business documents securely.',
      status: 'Live',
    },
    {
      icon: <PackageSearch size={20} />,
      t: 'Shipstack',
      s: 'A logistics and tracking platform digitizing the movement of goods from raw material to end client — built for pharmaceuticals, agriculture, e-commerce and more.',
      status: 'In development',
    },
  ];

  return (
    <main className="text-murzak-ink dark:text-slate-100 overflow-x-hidden">
      {/* Hero — real workspace photo behind the headline */}
      <section className="relative min-h-[60vh] flex items-center pt-32 lg:pt-40 pb-16 overflow-hidden -mt-16 sm:-mt-20 lg:-mt-24">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center" style={{ backgroundImage: "url('/images/about-hero.webp')" }} />
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-murzak-ink/90 via-murzak-ink/70 to-murzak-ink/40" />
        <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16 relative z-10">
          <p className="font-mono text-micro uppercase text-murzak-accent mb-5">About Murzak</p>
          <h1 className="text-[clamp(2.4rem,6vw,5rem)] font-[900] tracking-[-0.03em] leading-[0.98] max-w-3xl text-white">
            We run the tech, so you can <span className="text-murzak-gradient">run your business.</span>
          </h1>
          <p className="mt-7 text-lg sm:text-xl text-slate-300 font-medium max-w-2xl leading-relaxed">
            Murzak Technologies is a Nairobi team that hosts, builds and looks after the software small
            and growing businesses depend on. We started it because too many good businesses were being
            let down by hosting that went dark, vendors who disappeared, and invoices in dollars.
          </p>
        </div>
      </section>

      {/* GLOBAL BACKGROUND WRAPPER — one shared background image behind every
          section below the hero, instead of a different image per section. */}
      <div className="relative">
        <div className="absolute inset-0 z-0 bg-fixed bg-cover bg-center opacity-20" style={{ backgroundImage: "url('/images/about-section-bg.webp')" }} />
        <div className="absolute inset-0 z-0 bg-murzak-base/90 dark:bg-murzak-ink/90" />

        {/* At a glance */}
        <section className="relative z-10 pt-8 pb-8">
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
                  <div className="font-mono text-micro uppercase text-slate-600 dark:text-slate-400 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Story */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Founded 2023</p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight mb-8 max-w-2xl">
              Built for the business owner, not the IT department.
            </h2>
            <div className="space-y-5 text-slate-600 dark:text-slate-300 font-medium leading-relaxed text-[15px] max-w-2xl">
              <p>
                Murzak Technologies was founded in 2023 by Joe Sylvester and Kevin Njenga on a simple idea:
                African businesses deserve software that's built around them, not adapted as an afterthought.
                We set out to build African-market-centric software — tools that either fit the Kenyan market
                from day one, or get shaped until they do.
              </p>
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
              <p className="text-murzak-ink dark:text-white font-bold">
                That's the whole idea — competent, local, and genuinely on your side.
              </p>
            </div>
          </div>
        </section>

        {/* Team */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <div className="max-w-2xl mb-12">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-4 inline-flex items-center gap-2"><Users size={14} /> The team</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">The people behind Murzak.</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {team.map((p) => (
                <div key={p.name} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                  <div className="relative w-16 h-16 rounded-full mb-5 flex items-center justify-center bg-murzak-accent/10 text-murzak-accent font-black text-lg overflow-hidden">
                    <span>{p.initials}</span>
                    <img
                      src={p.img}
                      alt={p.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-1">{p.name}</h3>
                  <p className="text-micro font-black uppercase text-murzak-accent mb-3">{p.role}</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{p.bio}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What we do */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <div className="max-w-2xl mb-12">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-4">What we do</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">Three things, done properly.</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {[
                { icon: <Server size={20} />, t: 'Managed hosting', s: 'Websites, email and databases — provisioned, secured and backed up for you on Murzak Cloud.', page: 'cloud' as const, cta: 'Murzak Cloud' },
                { icon: <Boxes size={20} />, t: 'Business systems', s: 'Murzak ERP, POS, CRM and accounting, configured around how your team actually works.', page: 'products' as const, cta: 'See products' },
                { icon: <Code2 size={20} />, t: 'Custom software', s: 'When off-the-shelf won’t do, we design, build and keep running the exact system you need.', page: 'products' as const, cta: 'Start a build' },
              ].map((c) => (
                <button key={c.t} onClick={() => onNavigate(c.page)} className="group text-left rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7 transition-all hover:border-white/60 dark:hover:border-white/10 hover:bg-white/40 dark:hover:bg-white/[0.08]">
                  <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{c.icon}</div>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{c.t}</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed mb-5">{c.s}</p>
                  <span className="inline-flex items-center gap-2 font-black text-micro uppercase text-murzak-accent group-hover:gap-3 transition-all">{c.cta} <ArrowUpRight size={14} /></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* What we've built */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <div className="max-w-2xl mb-12">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Track record</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">What we've built.</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              {builtProducts.map((p) => (
                <div key={p.t} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent">{p.icon}</div>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${
                      p.status === 'Live'
                        ? 'bg-murzak-success/10 text-murzak-success'
                        : 'bg-murzak-warning/10 text-murzak-warning'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{p.t}</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{p.s}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Values */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <div className="max-w-2xl mb-12">
              <p className="font-mono text-micro uppercase text-murzak-accent mb-4">How we work</p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">What you can expect from us.</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {values.map((v) => (
                <div key={v.t} className="rounded-3xl border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-7">
                  <div className="inline-flex p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent mb-5">{v.icon}</div>
                  <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mb-2">{v.t}</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{v.s}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact us */}
        <section className="relative z-10 py-16 lg:py-24 border-t border-murzak-border/50">
          <div className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <p className="font-mono text-micro uppercase text-murzak-accent mb-4">Contact us</p>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-[900] tracking-tight">
                  Talk to a real person — <span className="text-murzak-gradient">no call centre.</span>
                </h2>
                <p className="mt-5 text-slate-600 dark:text-slate-400 font-medium leading-relaxed max-w-md">
                  Tell us what you’re trying to do in plain words. Our Nairobi team usually replies within one
                  business day — and you’ll be talking to the people who actually run your systems.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-4">
                  <Button onClick={() => onNavigate('contact')}>
                    <Phone size={17} /> Send us a message
                  </Button>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-7 py-4 font-black text-sm uppercase tracking-widest text-murzak-ink dark:text-slate-100 hover:bg-black/5 transition-all">
                    Email us
                  </a>
                </div>
              </div>

              <div className="rounded-[2.5rem] border border-transparent bg-white/60 dark:bg-white/5 backdrop-blur-md p-8 sm:p-10 space-y-7">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><Mail size={18} /></div>
                  <div>
                    <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-1">Email</p>
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm font-black text-murzak-ink dark:text-slate-100 hover:text-murzak-accent transition break-all">{SUPPORT_EMAIL}</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><MapPin size={18} /></div>
                  <div>
                    <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-1">Location</p>
                    <p className="text-sm font-black text-murzak-ink dark:text-slate-100">Nairobi, Kenya</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-murzak-accent/15 text-murzak-accent"><Clock size={18} /></div>
                  <div>
                    <p className="text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-1">Hours</p>
                    <p className="text-sm font-black text-murzak-ink dark:text-slate-100">Mon–Fri · 8:00–18:00 EAT</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* CTA */}
      <section className="relative py-24 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-murzak-surface/50 dark:bg-black/20 border-y border-murzak-border" />
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.16]" />
        <div className="max-w-2xl mx-auto px-6 sm:px-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-[900] tracking-tight text-murzak-ink dark:text-slate-100">Let's talk about your business.</h2>
          <p className="mt-4 text-lg text-murzak-ink/85 dark:text-slate-300 font-medium">No pitch, no pressure — just a straight conversation about what would actually help.</p>
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
