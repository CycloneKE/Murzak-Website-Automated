import React, { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { fetchShopProgress, ShopProgress } from "../../services/shopSetup";

const REFRESH_MS = 60000;

interface Props {
  serviceId: string;
}

/**
 * "Getting your shop going": ticks come from what actually happened inside the
 * shop (the host reads it every few minutes), so a step is never ticked on
 * trust. Renders nothing for a service that is not an app shop, or when the
 * request fails: the checklist is an extra, never a reason for a page to break.
 */
const ShopChecklist: React.FC<Props> = ({ serviceId }) => {
  const [p, setP] = useState<ShopProgress | null>(null);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next: ShopProgress | null = null;
      try {
        next = await fetchShopProgress(serviceId);
        if (!cancel) setP(next);
      } catch {
        /* try again next time */
      }
      if (!cancel && !next?.complete) timer = setTimeout(tick, REFRESH_MS);
    };
    tick();
    return () => { cancel = true; if (timer) clearTimeout(timer); };
  }, [serviceId]);

  if (!p) return null;

  if (p.complete) {
    return (
      <section className="mt-4 rounded-2xl border border-emerald-600/25 bg-emerald-600/5 p-5" aria-labelledby="shop-checklist">
        <h3 id="shop-checklist" className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Getting your shop going</h3>
        <p className="mt-2 text-[13px] font-black text-murzak-ink dark:text-slate-100">All set. Your shop is up and selling.</p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 dark:border-white/10 p-5" aria-labelledby="shop-checklist">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="shop-checklist" className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Getting your shop going</h3>
        {p.checked && <span className="text-[12px] font-bold text-slate-500">{p.doneCount} of {p.total} done</span>}
      </div>
      {!p.checked && (
        <p className="mt-2 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
          We update this every few minutes once your shop is ready.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {p.steps.map((s) => {
          const next = p.nextStepId === s.id;
          return (
            <li key={s.id} className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${
                  s.done ? "bg-emerald-600 text-white" : next ? "bg-murzak-accent text-murzak-ink" : "bg-slate-200 dark:bg-white/10 text-slate-500"
                }`}
              >
                {s.done ? <Check size={12} aria-hidden="true" /> : <Circle size={8} aria-hidden="true" />}
              </span>
              <span className="text-[13px]">
                <span className={`font-black ${s.done ? "text-slate-500 line-through" : "text-murzak-ink dark:text-slate-100"}`}>
                  {s.label}{s.optional ? " (optional)" : ""}
                </span>
                <span className="sr-only">{s.done ? " (done)" : next ? " (next)" : " (to do)"}</span>
                {next && <span className="block text-[12px] font-medium text-slate-600 dark:text-slate-400">{s.help}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ShopChecklist;
