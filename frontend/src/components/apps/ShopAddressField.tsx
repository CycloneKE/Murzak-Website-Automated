import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { AppId } from "../../config/serviceCatalog";
import { APP_CHECKOUT } from "../../config/appCheckout";
import { AddressCheck, checkShopAddress } from "../../services/appCheckout";
import { toUserMessage } from "../../services/errors";

interface ShopAddressFieldProps {
  app: AppId;
  shopName: string;
  onShopNameChange: (name: string) => void;
  /** The usable slug, or null while empty / checking / not available. */
  onSlugChange: (slug: string | null) => void;
  /** Suggestions returned by a failed order (409 slug_taken) — shown immediately. */
  suggestionsFromServer?: string[];
}

const REASON_COPY: Record<NonNullable<AddressCheck["reason"]>, string> = {
  too_short: "Use at least 3 letters or numbers.",
  too_long: "That's a bit long — 40 characters at most.",
  invalid: "Use letters, numbers and hyphens only.",
  reserved: "That address is reserved. Try another.",
  taken: "That address is taken.",
};

const ShopAddressField: React.FC<ShopAddressFieldProps> = ({
  app, shopName, onShopNameChange, onSlugChange, suggestionsFromServer,
}) => {
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const suffix = APP_CHECKOUT[app].addressSuffix;

  useEffect(() => () => { seq.current++; }, []);

  useEffect(() => {
    onSlugChange(null);
    setError("");
    if (!shopName.trim()) {
      seq.current++; // invalidate any in-flight check
      setCheck(null);
      setChecking(false);
      return;
    }
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await checkShopAddress(app, shopName);
        if (mine !== seq.current) return;
        setCheck(r);
        onSlugChange(r.available ? r.slug : null);
      } catch (e: any) {
        if (mine === seq.current) {
          setCheck(null);
          setError(toUserMessage(e, "Couldn't check that address right now."));
        }
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopName, app]);

  const rejected = !!suggestionsFromServer?.length;
  const suggestions = suggestionsFromServer?.length ? suggestionsFromServer : check?.suggestions || [];

  return (
    <div>
      <label htmlFor="shop-name" className="block text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-2">
        Shop name
      </label>
      <input
        id="shop-name"
        value={shopName}
        onChange={(e) => onShopNameChange(e.target.value)}
        placeholder="e.g. Mama Njeri Stores"
        autoComplete="organization"
        aria-describedby="shop-address-status"
        className="w-full rounded-2xl px-5 py-4 text-lg font-bold bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-murzak-border text-murzak-ink dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-murzak-accent"
      />
      <div id="shop-address-status" className="mt-2 min-h-6 text-sm font-semibold" aria-live="polite">
        {checking && (
          <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" /> Checking address…
          </span>
        )}
        {!checking && rejected && (
          <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle size={14} /> That address was just taken — pick another.
          </span>
        )}
        {!checking && !rejected && check && check.slug && (
          <span
            className={
              check.available
                ? "text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5"
                : "text-red-600 dark:text-red-400 inline-flex items-center gap-1.5"
            }
          >
            {check.available ? <Check size={14} /> : <AlertCircle size={14} />}
            <span className="font-mono">{check.slug}.{suffix}</span>
            {!check.available && check.reason && <span className="font-semibold"> — {REASON_COPY[check.reason]}</span>}
          </span>
        )}
        {!checking && error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
      {!checking && suggestions.length > 0 && (!check?.available || suggestionsFromServer?.length) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Try:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onShopNameChange(s)}
              className="px-3 py-1 rounded-full border border-murzak-accent/40 text-sm font-bold text-murzak-ink dark:text-slate-100 hover:bg-murzak-accent/10"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShopAddressField;
