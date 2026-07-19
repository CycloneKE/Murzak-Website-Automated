
import React from "react";
import { Check, X, Sparkles } from "lucide-react";

const rows: { feature: string; diy: string | false; murzak: string | true }[] = [
  { feature: "Server setup & configuration", diy: "You do it (hours of work)", murzak: "Done for you" },
  { feature: "Billing currency", diy: "USD, card only", murzak: "KES — local invoices" },
  { feature: "M-Pesa payments", diy: false, murzak: "STK push built in" },
  { feature: "Murzak ERP / POS / CRM setup", diy: "Self-install & maintain", murzak: "Pre-configured & migrated" },
  { feature: "Backups, SSL & security patching", diy: "Your responsibility", murzak: "Managed daily" },
  { feature: "Support", diy: "Tickets, overseas hours", murzak: "Nairobi team, local hours" },
  { feature: "Domain handling", diy: "Separate registrar", murzak: "Searched & registered for you" },
];

export default function ManagedComparison() {
  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10">
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 text-micro font-black text-murzak-accent uppercase mb-4">
          <Sparkles size={14} /> Managed, not DIY
        </div>
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-[900] text-murzak-ink tracking-tighter">
          Why teams pick <span className="text-murzak-gradient">managed Murzak</span>
        </h2>
        <p className="mt-4 text-sm sm:text-base font-bold text-slate-500 dark:text-slate-500 max-w-2xl mx-auto">
          A raw server is cheap until you count the setup, the maintenance, and the 2am outage. We handle all of it — billed in KES.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-murzak-surface/60 shadow-xl">
        {/* header */}
        <div className="grid grid-cols-[1.4fr_1fr_1fr]">
          <div className="p-4 sm:p-5" />
          <div className="p-4 sm:p-5 text-center border-l border-slate-200 dark:border-murzak-border">
            <span className="text-micro sm:text-xs font-black uppercase text-slate-600">Raw VPS / DIY</span>
          </div>
          <div className="p-4 sm:p-5 text-center border-l border-slate-200 dark:border-murzak-border bg-brand-gradient">
            <span className="text-micro sm:text-xs font-black uppercase text-murzak-ink">Murzak Managed</span>
          </div>
        </div>

        {rows.map((r, i) => (
          <div
            key={r.feature}
            className={`grid grid-cols-[1.4fr_1fr_1fr] border-t border-slate-200 dark:border-murzak-border ${
              i % 2 ? "bg-slate-50/60 dark:bg-white/[0.02]" : ""
            }`}
          >
            <div className="p-4 sm:p-5 text-label sm:text-[13px] font-black text-murzak-ink">
              {r.feature}
            </div>
            <div className="p-4 sm:p-5 border-l border-slate-200 dark:border-murzak-border flex items-center justify-center text-center">
              {r.diy === false ? (
                <X className="w-4 h-4 text-slate-600 dark:text-slate-600" />
              ) : (
                <span className="text-micro sm:text-[12px] font-bold text-slate-600 dark:text-slate-600">{r.diy}</span>
              )}
            </div>
            <div className="p-4 sm:p-5 border-l border-slate-200 dark:border-murzak-border flex items-center justify-center gap-2 text-center">
              <Check className="w-4 h-4 text-murzak-accent shrink-0" />
              {typeof r.murzak === "string" && (
                <span className="text-micro sm:text-[12px] font-black text-murzak-ink">{r.murzak}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
