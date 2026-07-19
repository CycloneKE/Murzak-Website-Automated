
import React, { useState } from "react";
import { Search, Loader2, Check, CircleSlash } from "lucide-react";
import { checkDomain, normalizeLabel, type DomainResult } from "../services/domains";
import { formatKes } from "../config/serviceCatalog";

interface Props {
  /** Currently chosen domain (full, e.g. "acme.co.ke"), if any. */
  selectedDomain?: string;
  onSelect: (domain: string, priceKes: number) => void;
}

export default function DomainSearch({ selectedDomain, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DomainResult[] | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const label = normalizeLabel(query);
    if (!label || loading) return;
    setLoading(true);
    try {
      const r = await checkDomain(query);
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 dark:border-murzak-border bg-slate-50 dark:bg-black/20 p-4">
      <div className="text-micro font-black uppercase text-slate-600 mb-2.5">
        Find your domain
      </div>

      <form onSubmit={run} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="yourbusiness"
            className="w-full rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5 pl-9 pr-3 py-2.5 text-sm font-bold text-murzak-ink focus:outline-none focus:ring-2 focus:ring-murzak-accent"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !normalizeLabel(query)}
          className={`shrink-0 rounded-xl px-4 py-2.5 font-black text-micro uppercase transition-all flex items-center gap-2 ${
            loading || !normalizeLabel(query)
              ? "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
              : "bg-murzak-accent text-murzak-ink hover:scale-[1.02]"
          }`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {results && (
        <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
          {results.map((r) => {
            const isChosen = selectedDomain === r.domain;
            return (
              <li
                key={r.domain}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                  isChosen
                    ? "border-murzak-accent bg-murzak-accent/10"
                    : "border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5"
                }`}
              >
                <div className="min-w-0 flex items-center gap-2">
                  {r.available ? (
                    <Check className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <CircleSlash className="w-4 h-4 text-slate-600 dark:text-slate-600 shrink-0" />
                  )}
                  <span className={`text-sm font-black truncate ${r.available ? "text-murzak-ink" : "text-slate-500 line-through"}`}>
                    {r.domain}
                  </span>
                </div>

                <div className="shrink-0 flex items-center gap-3">
                  {r.available ? (
                    <>
                      <span className="text-label font-black text-slate-600 dark:text-slate-600">
                        {formatKes(r.priceKes)}/yr
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelect(r.domain, r.priceKes)}
                        className={`rounded-lg px-3 py-1.5 font-black text-micro uppercase transition-all ${
                          isChosen
                            ? "bg-murzak-accent text-murzak-ink"
                            : "border border-murzak-accent text-murzak-accent hover:bg-murzak-accent hover:text-murzak-ink"
                        }`}
                      >
                        {isChosen ? "Selected" : "Select"}
                      </button>
                    </>
                  ) : (
                    <span className="text-micro font-black uppercase text-slate-600">Taken</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selectedDomain && (
        <p className="mt-3 text-micro font-bold text-murzak-accent">
          Registering <span className="font-black">{selectedDomain}</span> — billed yearly, added to your first invoice.
        </p>
      )}
    </div>
  );
}
