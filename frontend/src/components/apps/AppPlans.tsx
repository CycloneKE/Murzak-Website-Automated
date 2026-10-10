import React, { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { AppId, formatKes, servicesForApp, ServiceItem } from "../../config/serviceCatalog";
import { ANNUAL_DISCOUNT_PCT, annualKes } from "../../config/appCheckout";

export type BillingTerm = "monthly" | "annual";

interface AppPlansProps {
  app: AppId;
  onChoose: (serviceId: string, term: BillingTerm) => void;
}

function limitLine(n: number | null | undefined, one: string, many: string) {
  if (n == null) return `Unlimited ${many}`;
  return n === 1 ? `1 ${one}` : `Up to ${n.toLocaleString()} ${many}`;
}

/**
 * The app's tiers as cards, with a monthly/annual toggle. Data comes straight
 * from the catalog (one item per tier), so prices here are the prices billed.
 */
const AppPlans: React.FC<AppPlansProps> = ({ app, onChoose }) => {
  const [term, setTerm] = useState<BillingTerm>("monthly");
  const tiers = servicesForApp(app);

  const price = (s: ServiceItem) => {
    const monthly = s.pricing.monthlyKes ?? 0;
    return term === "annual"
      ? { amount: formatKes(annualKes(monthly)), per: "/year" }
      : { amount: formatKes(monthly), per: "/month" };
  };

  return (
    <section id="plans" className="py-20 scroll-mt-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex justify-center mb-10">
          <div role="radiogroup" aria-label="Billing" className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-murzak-border">
            {(["monthly", "annual"] as BillingTerm[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={term === t}
                onClick={() => setTerm(t)}
                className={`px-5 py-2.5 rounded-xl text-sm font-black transition ${
                  term === t ? "bg-white dark:bg-murzak-surface text-murzak-ink dark:text-slate-100 shadow" : "text-slate-500"
                }`}
              >
                {t === "monthly" ? "Monthly" : (
                  <>Annual <span className="ml-1 text-emerald-600 dark:text-emerald-400">Save {ANNUAL_DISCOUNT_PCT}%</span></>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {tiers.map((s) => {
            const p = price(s);
            return (
              <article
                key={s.id}
                className={`relative flex flex-col rounded-3xl border p-7 bg-white/80 dark:bg-white/5 ${
                  s.appPopular ? "border-murzak-accent shadow-xl md:-translate-y-2" : "border-slate-200 dark:border-murzak-border"
                }`}
              >
                {s.appPopular && (
                  <span className="absolute -top-3 left-7 px-3 py-1 rounded-full bg-murzak-accent text-murzak-ink text-micro font-black uppercase">
                    Most popular
                  </span>
                )}
                <h3 className="text-2xl font-black text-murzak-ink dark:text-slate-100">{s.appPlan}</h3>
                <p className="text-slate-500 font-semibold">{s.appTagline}</p>
                <p className="mt-6">
                  <span className="text-4xl font-black text-murzak-ink dark:text-slate-100">{p.amount}</span>
                  <span className="text-slate-500 font-bold">{p.per}</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm font-semibold text-slate-600 dark:text-slate-300 flex-1">
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.branches, "branch", "branches")}</li>
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.users, "staff login", "staff logins")}</li>
                  <li className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{limitLine(s.appLimits?.products, "product", "products")}</li>
                  {(s.highlights || []).map((h) => (
                    <li key={h} className="flex gap-2"><Check size={16} className="text-murzak-accent shrink-0 mt-0.5" />{h}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onChoose(s.id, term)}
                  className={`mt-8 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm ${
                    s.appPopular ? "bg-murzak-accent text-murzak-ink" : "border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100"
                  }`}
                >
                  Start with {s.appPlan} <ArrowRight size={16} />
                </button>
              </article>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm font-semibold text-slate-500">
          Your own private POS · 14-day money-back · Pay with M-Pesa · No setup fee
        </p>
      </div>
    </section>
  );
};

export default AppPlans;
