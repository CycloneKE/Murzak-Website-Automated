
import React, { useState } from "react";
import { Plus } from "lucide-react";
import { toSafeJsonLdString } from "../utils/jsonLd";

export type FaqItem = { q: string; a: string };

interface Props {
  items: FaqItem[];
  title?: string;
  subtitle?: string;
  eyebrow?: string;
}

export default function Faq({ items, title = "Frequently asked questions", subtitle, eyebrow = "Need to know" }: Props) {
  const [open, setOpen] = useState<number | null>(0);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
  const faqJsonLdString = toSafeJsonLdString(faqJsonLd);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLdString }} />
      <section className="max-w-[1100px] mx-auto px-6 sm:px-10 lg:px-16">
      <div className="max-w-3xl">
      {/* `eyebrow` is kept in the props for callers but no longer drawn. */}
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-murzak-ink dark:text-slate-100">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400 leading-relaxed">{subtitle}</p>
        ) : null}
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={i}
              className={`rounded-2xl border transition-all ${
                isOpen
                  ? "border-slate-400 dark:border-white/30 bg-white dark:bg-white/5"
                  : "border-murzak-border dark:border-white/10 bg-white dark:bg-white/5"
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-sm sm:text-base font-bold text-murzak-ink dark:text-slate-100">{item.q}</span>
                <Plus
                  size={18}
                  className={`shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                />
              </button>
              {isOpen && (
                <p className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400 animate-fade-in">
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </section>
    </>
  );
}
