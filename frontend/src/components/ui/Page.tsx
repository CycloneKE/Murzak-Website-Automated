import React from "react";
import Breadcrumbs, { type BreadcrumbItem } from "../Breadcrumbs";

// Building blocks for storefront pages: flat surfaces, one container width,
// plain headings. Pages compose these instead of each inventing its own hero,
// card and section markup.

/** A flat bordered surface. No blur, no glow. */
export const CARD = "rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5";
/** Secondary text. */
export const MUTED = "text-slate-600 dark:text-slate-400";
/** Primary text. */
export const INK = "text-murzak-ink dark:text-slate-100";
/** Horizontal rule between sections. */
export const RULE = "border-t border-murzak-border dark:border-white/10";
/** Text link inside copy. */
export const LINK = `font-bold underline underline-offset-4 ${INK}`;

const CONTAINER = "max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16";

interface HeroProps {
  onNavigate: (page: string) => void;
  crumbs?: BreadcrumbItem[];
  title: string;
  lead: React.ReactNode;
  /** Shown under the buttons, e.g. "KES 2,000/mo + KES 500 one-time setup". */
  price?: React.ReactNode;
  /** Buttons. */
  children?: React.ReactNode;
  /** Optional right-hand column (a price list, a summary). */
  aside?: React.ReactNode;
}

export function PageHero({ onNavigate, crumbs, title, lead, price, children, aside }: HeroProps) {
  return (
    <section className={`${CONTAINER} pt-10 sm:pt-14 pb-12 sm:pb-16 ${INK}`}>
      {crumbs && <Breadcrumbs onNavigate={onNavigate} items={crumbs} />}
      <div className={aside ? "grid lg:grid-cols-12 gap-10 items-start mt-2" : "mt-2"}>
        <div className={aside ? "lg:col-span-7" : ""}>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] max-w-3xl">{title}</h1>
          <p className={`mt-4 text-lg leading-relaxed max-w-2xl ${MUTED}`}>{lead}</p>
          {children && <div className="mt-8 flex flex-col sm:flex-row gap-3">{children}</div>}
          {price && <p className={`mt-4 text-sm font-semibold ${MUTED}`}>{price}</p>}
        </div>
        {aside && <div className="lg:col-span-5">{aside}</div>}
      </div>
    </section>
  );
}

interface SectionProps {
  id?: string;
  title?: string;
  lead?: React.ReactNode;
  /** Faint background band, to separate two adjacent card grids. */
  tinted?: boolean;
  children: React.ReactNode;
}

export function PageSection({ id, title, lead, tinted, children }: SectionProps) {
  return (
    <section id={id} className={`${RULE} ${INK} ${id ? "scroll-mt-28" : ""} ${tinted ? "bg-slate-50/70 dark:bg-white/[0.02]" : ""}`}>
      <div className={`${CONTAINER} py-14 sm:py-20`}>
        {title && <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{title}</h2>}
        {lead && <p className={`mt-2 max-w-2xl ${MUTED}`}>{lead}</p>}
        <div className={title || lead ? "mt-8" : ""}>{children}</div>
      </div>
    </section>
  );
}

/** Numbered steps laid out in columns; no cards, no icons. */
export function Steps({ items }: { items: { t: string; s: React.ReactNode }[] }) {
  const cols = items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <ol className={`grid sm:grid-cols-2 ${cols} gap-x-8 gap-y-8`}>
      {items.map((st, i) => (
        <li key={st.t}>
          <span className={`text-sm font-bold tabular-nums ${MUTED}`}>Step {i + 1}</span>
          <h3 className="mt-1 font-extrabold">{st.t}</h3>
          <p className={`mt-1.5 text-sm leading-relaxed ${MUTED}`}>{st.s}</p>
        </li>
      ))}
    </ol>
  );
}

/** Unnumbered points in columns: a short heading and a sentence or two each. */
export function Points({ items, cols = 3 }: { items: { t: string; s: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  const lg = cols === 4 ? "lg:grid-cols-4" : cols === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3";
  return (
    <div className={`grid sm:grid-cols-2 ${lg} gap-x-8 gap-y-8`}>
      {items.map((p) => (
        <div key={p.t}>
          <h3 className="font-extrabold">{p.t}</h3>
          <p className={`mt-1.5 text-sm leading-relaxed ${MUTED}`}>{p.s}</p>
        </div>
      ))}
    </div>
  );
}

/** Closing band: a question on the left, one or two buttons on the right. */
export function ClosingCta({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${RULE} ${INK}`}>
      <div className={`${CONTAINER} py-14 sm:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6`}>
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{title}</h2>
          {lead && <p className={`mt-2 max-w-xl ${MUTED}`}>{lead}</p>}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 shrink-0">{children}</div>
      </div>
    </section>
  );
}

/** FAQ band wrapper so every page spaces its FAQ the same way. */
export function FaqBand({ children }: { children: React.ReactNode }) {
  return <section className={`${RULE} py-14 sm:py-20`}>{children}</section>;
}
