import React, { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Clock, Loader2 } from "lucide-react";
import { domainServiceIdFor, fetchOffers, isDomainCompanionId, type Offer } from "../services/bundles";
import { TLD_OPTIONS } from "../services/domains";
import { domainCatalogIdForTld } from "../config/serviceCatalog";
import { toUserMessage } from "../services/errors";
import DomainSearch from "./DomainSearch";

// "Complete your setup": add-ons the customer can still take at the bundle
// price while their window is open. The server owns the saving and the window
// (backend/services/checkout/bundles.js); this only displays them. Renders
// nothing when the feature is off, there are no offers, the user is signed out
// or the fetch fails: it must never block or clutter the page it sits on.
//
// A domain is a name, so a domain offer never goes through the Add-ons modal
// (which has no name field): its card opens a search limited to the offered
// ending and buys the chosen name through onChooseDomain. Without that prop,
// domain offers are not shown.

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
  /** Buys `domain` (a full name) as the offered domain add-on. */
  onChooseDomain?: (serviceId: string, domain: string) => Promise<void>;
}

const cardClass = "glass-card text-left rounded-3xl p-5 border border-murzak-border";

const OfferBody: React.FC<{ offer: Offer; label: string }> = ({ offer, label }) => (
  <>
    <p className="text-sm font-black text-murzak-ink dark:text-slate-100">{offer.name}</p>
    <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
      {isDomainCompanionId(offer.serviceId)
        ? `KES ${Number(offer.monthlyKes).toLocaleString()}/yr`
        : `KES ${Number(offer.monthlyKes).toLocaleString()}/mo`}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="px-3 py-1 rounded-full text-micro font-black uppercase bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25">
        Save KES {Number(offer.savingKes).toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-1 text-micro font-bold text-slate-600 dark:text-slate-400">
        <Clock className="w-3 h-3" aria-hidden="true" /> {label}
      </span>
    </div>
  </>
);

const DomainOfferCard: React.FC<{
  offer: Offer;
  label: string;
  onChooseDomain: (serviceId: string, domain: string) => Promise<void>;
}> = ({ offer, label, onChooseDomain }) => {
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tlds = TLD_OPTIONS.filter((t) => domainCatalogIdForTld(t.tld) === offer.serviceId);

  const select = (d: string) => {
    if (domainServiceIdFor(d) !== offer.serviceId) {
      setError("Pick a name with the ending this offer is for.");
      return;
    }
    setError("");
    setDomain(d);
  };

  const buy = async () => {
    if (!domain || busy) return;
    setBusy(true);
    setError("");
    try {
      await onChooseDomain(offer.serviceId, domain);
    } catch (e) {
      setError(toUserMessage(e, "We couldn't add that domain. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid={`complete-setup-card-${offer.serviceId}`} className={cardClass}>
      <OfferBody offer={offer} label={label} />
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center gap-1.5 text-micro font-black uppercase text-sky-700 dark:text-murzak-accent"
        >
          Choose your name <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ) : (
        <>
          <DomainSearch selectedDomain={domain} onSelect={(d) => select(d)} tlds={tlds} />
          {error && (
            <p role="alert" className="mt-2 text-xs font-bold text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" /> {error}
            </p>
          )}
          <button
            type="button"
            onClick={buy}
            disabled={!domain || busy}
            className="mt-3 w-full px-4 py-3 rounded-2xl font-black text-micro uppercase tracking-widest bg-murzak-accent text-murzak-ink inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {domain ? `Add ${domain}` : "Pick a name first"}
          </button>
        </>
      )}
    </div>
  );
};

const CompleteSetupCards: React.FC<Props> = ({ onChoose, onChooseDomain }) => {
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
    .filter((o) => !isDomainCompanionId(o.serviceId) || !!onChooseDomain)
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
        {live.map(({ offer, label }) =>
          isDomainCompanionId(offer.serviceId) && onChooseDomain ? (
            <DomainOfferCard key={offer.serviceId} offer={offer} label={label} onChooseDomain={onChooseDomain} />
          ) : (
            <button
              key={offer.serviceId}
              type="button"
              data-testid={`complete-setup-card-${offer.serviceId}`}
              onClick={() => onChoose(offer.serviceId)}
              className={`${cardClass} hover:border-murzak-accent/60 hover:scale-[1.01] transition-all`}
            >
              <OfferBody offer={offer} label={label} />
              <span className="mt-4 inline-flex items-center gap-1.5 text-micro font-black uppercase text-sky-700 dark:text-murzak-accent">
                Add it <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </button>
          )
        )}
      </div>
    </section>
  );
};

export default CompleteSetupCards;
