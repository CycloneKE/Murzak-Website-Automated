import React, { createContext, useContext } from "react";
import { ChevronDown } from "lucide-react";
import Breadcrumbs, { type BreadcrumbItem } from "../Breadcrumbs";
import { PAGE_THEMES, type PageTheme, type PageThemeKey } from "../../config/pageThemes";

// Building blocks for storefront pages. A page wraps itself in <PageMain
// theme="…"> and composes the pieces below; the theme (photo, treatment,
// accent colour) comes from config/pageThemes.ts, so pages hold no styling
// of their own.

/** A flat bordered surface. */
export const CARD = "rounded-2xl border border-murzak-border dark:border-white/10 bg-white dark:bg-white/5";
/** Secondary text. */
export const MUTED = "text-slate-600 dark:text-slate-400";
/** Primary text. */
export const INK = "text-murzak-ink dark:text-slate-100";
/** Horizontal rule between sections. */
export const RULE = "border-t border-murzak-border dark:border-white/10";
/** Text link inside copy. */
export const LINK = `font-bold underline underline-offset-4 ${INK}`;
/** Headline face (Bricolage Grotesque); body copy stays in Manrope. */
export const DISPLAY = "font-display";

const CONTAINER = "max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16";

// Film grain, so a washed photo reads as a surface instead of a flat gradient.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const ThemeContext = createContext<PageTheme | null>(null);
const useTheme = () => useContext(ThemeContext);

/**
 * Page wrapper. Fixes the page's photograph behind everything (so it stays put
 * while the page scrolls over it), gives the hero and closing band the theme,
 * and exposes the accent as --page-accent for everything in between.
 */
export function PageMain({ theme, className = "", children }: { theme?: PageThemeKey; className?: string; children: React.ReactNode }) {
  const t = theme ? PAGE_THEMES[theme] : null;
  return (
    <ThemeContext.Provider value={t}>
      <main data-page-theme={theme} className={className} style={t ? ({ "--page-accent": t.accent } as React.CSSProperties) : undefined}>
        {t && <PageBackdrop theme={t} />}
        {children}
      </main>
    </ThemeContext.Provider>
  );
}

/**
 * The themed photograph, fixed to the viewport behind the whole page. Always
 * dark, whatever the site theme. Content sections after the hero sit on a
 * translucent panel (see "Themed pages" in index.css), so the photo reads
 * faintly through them and strongly in the hero and closing band.
 */
function PageBackdrop({ theme }: { theme: PageTheme }) {
  const duo = theme.tone === "duotone";
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-murzak-ink" aria-hidden="true">
      <img
        src={theme.image}
        alt=""
        // Largest thing above the fold; fetch it first.
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          objectPosition: theme.position || "50% 50%",
          filter: duo ? "grayscale(1) contrast(1.15) brightness(.9)" : "saturate(1.05) contrast(1.05)",
        }}
      />
      {/* Duotone: the accent multiplies into the greys, then lifts the highlights. */}
      {duo && (
        <>
          <div className="absolute inset-0 mix-blend-multiply" style={{ background: theme.accent }} />
          <div className="absolute inset-0 mix-blend-soft-light opacity-60" style={{ background: theme.accent }} />
        </>
      )}
      <div className="absolute inset-0 bg-murzak-ink/30" />
      <div className="absolute inset-0 opacity-[0.14] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}

interface HeroProps {
  onNavigate: (page: string) => void;
  crumbs?: BreadcrumbItem[];
  /** Short label above the headline; defaults to the last breadcrumb. */
  label?: string;
  title: string;
  lead: React.ReactNode;
  /** Shown under the buttons, e.g. "KES 2,000/mo + KES 500 one-time setup". */
  price?: React.ReactNode;
  /** Buttons. */
  children?: React.ReactNode;
  /** Optional right-hand column (a price list, a summary). */
  aside?: React.ReactNode;
}

export function PageHero({ onNavigate, crumbs, label, title, lead, price, children, aside }: HeroProps) {
  const theme = useTheme();
  const tag = label ?? crumbs?.[crumbs.length - 1]?.label;

  // No theme: the plain hero, in the site's own light/dark colours.
  if (!theme) {
    return (
      <section className={`${CONTAINER} pt-10 sm:pt-14 pb-12 sm:pb-16 ${INK}`}>
        {crumbs && <Breadcrumbs onNavigate={onNavigate} items={crumbs} />}
        <div className={aside ? "grid lg:grid-cols-12 gap-10 items-start mt-2" : "mt-2"}>
          <div className={aside ? "lg:col-span-7" : ""}>
            <h1 className={`${DISPLAY} text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] max-w-3xl`}>{title}</h1>
            <p className={`mt-4 text-lg leading-relaxed max-w-2xl ${MUTED}`}>{lead}</p>
            {children && <div className="mt-8 flex flex-col sm:flex-row gap-3">{children}</div>}
            {price && <p className={`mt-4 text-sm font-semibold ${MUTED}`}>{price}</p>}
          </div>
          {aside && <div className="lg:col-span-5">{aside}</div>}
        </div>
      </section>
    );
  }

  return (
    // data-bg-surface="dark": this band is dark in both site themes, so its
    // text colours are fixed rather than paired with dark: variants.
    // Fills the screen below the fixed header (4rem / 5rem / 7rem, matching
    // the padding App.tsx gives <main>); the photo is the page backdrop.
    <section
      data-bg-surface="dark"
      className="relative flex items-center overflow-hidden text-white min-h-[calc(100svh-4rem)] sm:min-h-[calc(100svh-5rem)] lg:min-h-[calc(100svh-7rem)]"
    >
      {/* Ink from the left, where the words sit; the photo stays open on the right. */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(100deg, rgba(9,12,16,.92) 0%, rgba(9,12,16,.74) 38%, rgba(9,12,16,.28) 70%, rgba(9,12,16,.06) 100%)" }}
        aria-hidden="true"
      />
      <div className={`${CONTAINER} relative w-full pt-8 pb-20 sm:pb-24`}>
        {crumbs && <Breadcrumbs onNavigate={onNavigate} items={crumbs} variant="onDark" />}
        <div className={`mt-4 sm:mt-8 ${aside ? "grid lg:grid-cols-12 gap-10 items-end" : ""}`}>
          <div className={`hero-rise ${aside ? "lg:col-span-7" : ""}`}>
            {tag && (
              <p className="flex items-center gap-3 text-sm font-bold tracking-wide" style={{ color: theme.accent }}>
                <span className="h-px w-10" style={{ background: theme.accent }} aria-hidden="true" />
                {tag}
              </p>
            )}
            <h1
              className={`${DISPLAY} mt-5 text-[clamp(2.5rem,6.2vw,4.75rem)] font-extrabold leading-[0.98] tracking-[-0.025em] max-w-3xl text-balance`}
            >
              {title}
            </h1>
            <p className="mt-6 text-lg sm:text-xl leading-relaxed max-w-xl text-slate-200">{lead}</p>
            {children && <div className="mt-9 flex flex-col sm:flex-row gap-3">{children}</div>}
            {price && <p className="mt-5 text-sm font-semibold text-slate-300">{price}</p>}
          </div>
          {aside && (
            // .dark forces the dark colour pairs inside, since the panel sits on the photo.
            <div className="hero-rise hero-rise-late lg:col-span-5">
              <div className="dark rounded-2xl bg-[#0b0f16]/80 text-slate-100 ring-1 ring-white/10">{aside}</div>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Scroll to the page content"
        onClick={(e) => e.currentTarget.closest("section")?.nextElementSibling?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full p-2 text-white/70 hover:text-white motion-safe:animate-bounce"
      >
        <ChevronDown size={26} />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${theme.accent}, transparent 70%)` }} aria-hidden="true" />
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
    <section id={id} className={`${RULE} ${INK} ${id ? "scroll-mt-28" : ""} ${tinted ? "bg-slate-100/90 dark:bg-black/80" : ""}`}>
      <div className={`${CONTAINER} py-14 sm:py-20`}>
        {title && (
          <>
            {/* The page's accent, as a short marker over each section heading. */}
            <span className="block h-[3px] w-9 rounded-full mb-4" style={{ background: "var(--page-accent, #3388f2)" }} aria-hidden="true" />
            <h2 className={`${DISPLAY} text-2xl sm:text-[2rem] font-extrabold tracking-tight leading-tight`}>{title}</h2>
          </>
        )}
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
        <li key={st.t} className="border-t-2 pt-4" style={{ borderColor: "color-mix(in srgb, var(--page-accent, #3388f2) 55%, transparent)" }}>
          <span className={`${DISPLAY} text-3xl font-extrabold tabular-nums leading-none ${MUTED}`}>{String(i + 1).padStart(2, "0")}</span>
          <h3 className="mt-3 font-extrabold">{st.t}</h3>
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

/** Closing band: a question on the left, one or two buttons on the right. On a themed page it returns to the photo. */
export function ClosingCta({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  const theme = useTheme();
  const inner = (
    <div className={`${CONTAINER} relative py-14 sm:py-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6`}>
      <div>
        <h2 className={`${DISPLAY} text-2xl sm:text-[2rem] font-extrabold tracking-tight leading-tight`}>{title}</h2>
        {lead && <p className={`mt-2 max-w-xl ${theme ? "text-slate-300" : MUTED}`}>{lead}</p>}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">{children}</div>
    </div>
  );
  if (!theme) return <section className={`${RULE} ${INK}`}>{inner}</section>;
  // The photo is the fixed page backdrop, so this is just a lighter scrim over it.
  return (
    <section data-bg-surface="dark" className="relative overflow-hidden text-white bg-murzak-ink/70">
      {inner}
    </section>
  );
}

/** FAQ band wrapper so every page spaces its FAQ the same way. */
export function FaqBand({ children }: { children: React.ReactNode }) {
  return <section className={`${RULE} py-14 sm:py-20`}>{children}</section>;
}
