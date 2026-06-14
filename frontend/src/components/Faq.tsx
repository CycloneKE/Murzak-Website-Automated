
import React, { useState } from "react";
import { Plus, HelpCircle } from "lucide-react";

export type FaqItem = { q: string; a: string };

interface Props {
  items: FaqItem[];
  title?: string;
  eyebrow?: string;
}

export default function Faq({ items, title = "Frequently asked questions", eyebrow = "Need to know" }: Props) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="max-w-4xl mx-auto px-6 sm:px-10">
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 text-[10px] font-black tracking-[0.3em] text-murzak-cyan uppercase mb-4">
          <HelpCircle size={14} /> {eyebrow}
        </div>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] text-murzak-navy dark:text-white tracking-tighter">
          {title}
        </h2>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={i}
              className={`rounded-2xl border transition-all ${
                isOpen
                  ? "border-murzak-cyan bg-murzak-cyan/5 dark:bg-murzak-cyan/10"
                  : "border-slate-200 dark:border-white/10 bg-white dark:bg-murzak-surface/60"
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-sm sm:text-base font-black text-murzak-navy dark:text-white">{item.q}</span>
                <Plus
                  size={18}
                  className={`shrink-0 text-murzak-cyan transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                />
              </button>
              {isOpen && (
                <p className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1 text-[13px] font-bold leading-relaxed text-slate-600 dark:text-slate-300 animate-fade-in">
                  {item.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
