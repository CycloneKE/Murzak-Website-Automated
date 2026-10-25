import React, { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { formatKes, getService } from "../config/serviceCatalog";
import { MAX_COMPANIONS, businessAppBlockedReason, domainServiceIdFor, isBusinessApp, isDomainCompanionId, isPickableCompanion, saveHandoff, type Pairing } from "../services/bundles";
import AvailabilityNotice, { useAvailability } from "./AvailabilityNotice";
import DomainSearch from "./DomainSearch";

interface Props {
  /** The item being bought; pairings are looked up against it. */
  primaryId: string;
  /** Selected companion service ids (a chosen domain appears as its domain-* id). */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Chosen full domain name (e.g. "acme.com"). Controlled by the parent so it can be sent as config.domain. */
  domain: string;
  onDomainChange: (domain: string) => void;
}

function savingText(p: Pairing | undefined): string {
  if (!p) return "";
  if (p.savingKes != null && p.savingKes > 0) return `saves ${formatKes(p.savingKes)}`;
  return p.label;
}

/**
 * Optional add-ons offered next to a main purchase. Everything shown (allowed
 * ids, savings, headroom) comes from GET /api/bundles/availability and the
 * server re-validates on order creation, so this only displays and collects.
 * Renders nothing when bundles are off or the fetch fails.
 */
const CompanionPicker: React.FC<Props> = ({ primaryId, value, onChange, domain, onDomainChange }) => {
  const availability = useAvailability();
  const [domainMsg, setDomainMsg] = useState("");

  const model = useMemo(() => {
    if (!availability) return null;
    const pairingFor = (id: string) => availability.pairings.find((p) => p.companionId === id && p.primaryIds.includes(primaryId));
    const allowed = availability.allowedCompanionIds.filter((id) => isPickableCompanion(id, primaryId, availability.allowedCompanionIds));
    const domainIds = allowed.filter(isDomainCompanionId);
    const rows = allowed
      .filter((id) => !isDomainCompanionId(id))
      .sort((a, b) => Number(!!pairingFor(b)) - Number(!!pairingFor(a)));
    return { pairingFor, domainIds, rows };
  }, [availability, primaryId]);

  if (!availability || !model) return null;
  if (!model.rows.length && !model.domainIds.length) return null;

  // A bench-lane primary plus a business app needs two free bench slots.
  const appBlockedReason = businessAppBlockedReason(primaryId, availability.headroom);
  const atMax = value.length >= MAX_COMPANIONS;
  const chosenDomainId = value.find(isDomainCompanionId);

  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));

  const selectDomain = (full_domain: string) => {
    const id = domainServiceIdFor(full_domain);
    if (!id || !model.domainIds.includes(id)) {
      setDomainMsg("That ending can't be added to a bundle. Pick another one.");
      return;
    }
    setDomainMsg("");
    onDomainChange(full_domain);
    onChange([...value.filter((v) => !isDomainCompanionId(v)), id]);
  };

  const clearDomain = () => {
    onDomainChange("");
    onChange(value.filter((v) => !isDomainCompanionId(v)));
  };

  const domainPairing = chosenDomainId ? model.pairingFor(chosenDomainId) : undefined;
  const anyDomainSaving = model.domainIds.map(model.pairingFor).find((p) => p && p.savingKes);

  return (
    <section data-testid="companion-picker" aria-labelledby="companion-picker-title" className="glass-card rounded-3xl p-6 sm:p-8">
      <h2 id="companion-picker-title" className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400">
        Add to your order
      </h2>
      <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
        Optional. Add up to {MAX_COMPANIONS}; they are billed together with your order.
      </p>

      <ul className="mt-4 space-y-3">
        {model.rows.map((id) => {
          const svc = getService(id)!;
          const checked = value.includes(id);
          const pairing = model.pairingFor(id);
          let reason = "";
          if (!checked && isBusinessApp(id) && appBlockedReason) reason = appBlockedReason;
          else if (!checked && atMax) reason = `You can add up to ${MAX_COMPANIONS}.`;
          const disabled = !!reason;
          const inputId = `companion-${id}`;
          return (
            <li key={id}>
              <label
                htmlFor={inputId}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition ${
                  checked
                    ? "border-murzak-accent bg-murzak-accent/10"
                    : "border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-white/5"
                } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(id, e.target.checked)}
                  className="mt-1 h-4 w-4 accent-murzak-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-black text-murzak-ink dark:text-slate-100">{svc.name}</span>
                    <span className="text-sm font-black text-murzak-ink dark:text-slate-100">
                      {formatKes(svc.pricing.monthlyKes)}/mo
                    </span>
                  </span>
                  {pairing && (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-black text-emerald-700 dark:text-emerald-400">
                      <Check size={12} /> {savingText(pairing)}
                      {pairing.savingKes ? ` · ${pairing.label}` : ""}
                    </span>
                  )}
                  {reason && <span className="mt-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">{reason}</span>}
                </span>
              </label>
            </li>
          );
        })}

        {model.domainIds.length > 0 && (
          <li className="rounded-2xl border border-slate-200 dark:border-murzak-border bg-white/70 dark:bg-white/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-black text-murzak-ink dark:text-slate-100">A domain name</span>
              {!chosenDomainId && anyDomainSaving && (
                <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">{savingText(anyDomainSaving)}</span>
              )}
            </div>
            {chosenDomainId && domain ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 break-all">
                  <span className="font-black text-murzak-ink dark:text-slate-100">{domain}</span>
                  {domainPairing && <span className="ml-2 text-xs font-black text-emerald-700 dark:text-emerald-400">{savingText(domainPairing)} · {domainPairing.label}</span>}
                </p>
                <button
                  type="button"
                  onClick={clearDomain}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-black text-slate-600 dark:text-slate-400 underline underline-offset-2"
                >
                  <X size={12} /> Remove
                </button>
              </div>
            ) : !atMax ? (
              <>
                <DomainSearch selectedDomain={domain} onSelect={(d) => selectDomain(d)} />
                {domainMsg && <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-400" role="alert">{domainMsg}</p>}
              </>
            ) : (
              <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-400">You can add up to {MAX_COMPANIONS}.</p>
            )}
          </li>
        )}
      </ul>
    </section>
  );
};

export default CompanionPicker;

/**
 * Picker for product pages whose buy buttons navigate away (POS, ERP, CRM):
 * keeps its own selection and hands it to the next page through sessionStorage
 * (see saveHandoff in services/bundles.ts). Renders nothing when bundles are off.
 */
export const ProductCompanions: React.FC<{ primaryId: string; className?: string }> = ({ primaryId, className = "" }) => {
  const [ids, setIds] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  React.useEffect(() => {
    saveHandoff(primaryId, ids, domain);
  }, [primaryId, ids, domain]);
  return (
    <div className={`max-w-2xl mx-auto space-y-4 ${className}`}>
      <AvailabilityNotice />
      <CompanionPicker primaryId={primaryId} value={ids} onChange={setIds} domain={domain} onDomainChange={setDomain} />
    </div>
  );
};
