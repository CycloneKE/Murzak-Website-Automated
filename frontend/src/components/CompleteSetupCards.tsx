import React, { useEffect, useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { fetchOffers, type Offer } from "../services/bundles";

// "Complete your setup": add-ons the customer can still take at the bundle
// price while their window is open. The server owns the saving and the window
// (backend/services/checkout/bundles.js); this only displays them. Renders
// nothing when the feature is off, there are no offers, the user is signed out
// or the fetch fails: it must never block or clutter the page it sits on.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left (floored); null when the window has already closed. */
function daysLeftLabel(windowEndsAtMs: number, now: number): string | null {
  const remaining = windowEndsAtMs - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const days = Math.floor(remaining / DAY_MS);
  if (days < 1) return "less than a day left";
  return days === 1 ? "1 day left" : `${days} days left`;
}

interface Props {
  onChoose: (serviceId: string) => void;
}

const CompleteSetupCards: React.FC<Props> = ({ onChoose }) => {
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    let cancel = false;
    fetchOffers()
      .then((list) => {
        if (!cancel) setOffers(list);
      })
      .catch(() => {
        /* no error UI: this is an optional extra */
      });
    return () => {
      cancel = true;
    };
  }, []);

  const now = Date.now();
  const live = offers
    .map((o) => ({ offer: o, label: daysLeftLabel(o.windowEndsAtMs, now) }))
    .filter((x): x is { offer: Offer; label: string } => x.label !== null);

  if (live.length === 0) return null;

  return (
    <section data-testid="complete-setup-cards" aria-labelledby="complete-setup-title" className="space-y-4">
      <div>
        <h3 id="complete-setup-title" className="text-[12px] font-black uppercase tracking-widest text-murzak-ink dark:text-slate-100">
          Complete your setup
        </h3>
        <p className="text-micro font-medium text-slate-600 dark:text-slate-400 mt-1">
          Add these now and keep your bundle saving.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {live.map(({ offer, label }) => (
          <button
            key={offer.serviceId}
            type="button"
            data-testid={`complete-setup-card-${offer.serviceId}`}
            onClick={() => onChoose(offer.serviceId)}
            className="glass-card text-left rounded-3xl p-5 border border-murzak-border hover:border-murzak-accent/60 hover:scale-[1.01] transition-all"
          >
            <p className="text-sm font-black text-murzak-ink dark:text-slate-100">{offer.name}</p>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              KES {Number(offer.monthlyKes).toLocaleString()}/mo
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full text-micro font-black uppercase bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25">
                Save KES {Number(offer.savingKes).toLocaleString()}
              </span>
              <span className="inline-flex items-center gap-1 text-micro font-bold text-slate-600 dark:text-slate-400">
                <Clock className="w-3 h-3" aria-hidden="true" /> {label}
              </span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 text-micro font-black uppercase text-sky-700 dark:text-murzak-accent">
              Add it <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default CompleteSetupCards;
