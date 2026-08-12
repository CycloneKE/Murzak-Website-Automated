import React from 'react';
import { ChevronRight } from 'lucide-react';
import { pageToPath, type Page } from '../types';

export interface BreadcrumbItem {
  label: string;
  /** Page key or path passed to onNavigate. Omit on the last (current) item. */
  page?: string;
}

interface Props {
  items: BreadcrumbItem[];
  onNavigate: (page: string) => void;
  /** Extra classes on the <ol> — e.g. "justify-center" on a centered hero. */
  className?: string;
  /** "onDark" for a hero sitting on a fixed dark image/gradient regardless
   * of site theme (e.g. CustomSoftware's photo hero) — the default relies
   * on dark: variants, which don't apply when the surface is always dark. */
  variant?: 'default' | 'onDark';
}

const SITE_ORIGIN = 'https://murzaktech.com';

// `item.page` is usually a Page *key* ("home", "custom-software"), not a URL
// path — naively prefixing it with "/" would turn "home" into "/home" (the
// real URL is "/") and "custom-software" into "/custom-software" (the real
// URL is "/products/custom"). Resolve through the same map App.tsx's router
// uses so the structured data always points at a real, resolvable URL.
function resolvePath(page: string): string {
  if (page.startsWith('/')) return page;
  return pageToPath[page as Page] || `/${page}`;
}

const Breadcrumbs: React.FC<Props> = ({ items, onNavigate, className = '', variant = 'default' }) => {
  const isOnDark = variant === 'onDark';
  // BreadcrumbList structured data — the actual SEO payoff, since it's what
  // lets Google render the trail in search results, not just on the page.
  // Escaping `<` guards against the JSON ever containing a literal
  // `</script>` sequence that would break out of the tag early.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      ...(item.page ? { item: `${SITE_ORIGIN}${resolvePath(item.page)}` } : {}),
    })),
  };
  const jsonLdString = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString }} />
      <ol
        className={`flex flex-wrap items-center gap-1.5 text-micro font-bold uppercase tracking-wide ${
          isOnDark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-500'
        } ${className}`}
      >
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight size={12} className={isOnDark ? 'text-slate-600 shrink-0' : 'text-slate-400 dark:text-slate-600 shrink-0'} />
              )}
              {isLast || !item.page ? (
                <span className={isOnDark ? 'text-white' : 'text-murzak-ink dark:text-slate-300'} aria-current="page">
                  {item.label}
                </span>
              ) : (
                <button type="button" onClick={() => onNavigate(item.page!)} className="hover:text-murzak-accent transition-colors">
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
