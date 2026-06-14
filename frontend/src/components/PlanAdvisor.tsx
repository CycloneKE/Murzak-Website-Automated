
import React, { useState } from "react";
import { X, Wand2, ArrowRight, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { PLAN_META, formatKes, type PlanCode } from "../config/serviceCatalog";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Open the configurator for the recommended plan, with services pre-selected. */
  onChoosePlan: (planCode: PlanCode, serviceIds: string[]) => void;
  /** Enterprise / dedicated recommendations route to a sales conversation. */
  onTalkToSales: () => void;
}

type NeedKey = "website" | "apps" | "email" | "unsure";
type SizeKey = "solo" | "small" | "mid" | "large";

const NEEDS: { key: NeedKey; label: string; sub: string }[] = [
  { key: "website", label: "A website or online store", sub: "Company site, portfolio, e-commerce" },
  { key: "apps", label: "Business apps", sub: "ERP, POS, CRM, accounting" },
  { key: "email", label: "Email & file storage", sub: "Professional email, shared drive" },
  { key: "unsure", label: "Not sure yet", sub: "Help me figure it out" },
];

const SIZES: { key: SizeKey; label: string }[] = [
  { key: "solo", label: "Just me" },
  { key: "small", label: "2–10 people" },
  { key: "mid", label: "10–50 people" },
  { key: "large", label: "50+ people" },
];

type Recommendation = {
  plan: PlanCode;
  serviceIds: string[];
  reason: string;
};

function recommend(need: NeedKey, size: SizeKey): Recommendation {
  const big = size === "mid" || size === "large";

  if (need === "website") {
    return big
      ? { plan: "Business", serviceIds: ["biz-web-hosting", "biz-email"], reason: "A higher-performance website with team email suits a growing team." }
      : { plan: "Starter", serviceIds: ["starter-web-hosting", "starter-email"], reason: "Managed website hosting plus professional email is the fast, affordable start." };
  }

  if (need === "apps") {
    if (size === "large") {
      return { plan: "Enterprise", serviceIds: ["ent-erp-large"], reason: "At 50+ people you'll want dedicated capacity we size and manage for you." };
    }
    return size === "mid"
      ? { plan: "Business", serviceIds: ["biz-erp-configured", "biz-email"], reason: "A configured ERPNext, migrated for you, with team email fits a 10–50 person operation." }
      : { plan: "Business", serviceIds: ["biz-erp-light", "biz-pos-inventory"], reason: "Managed ERPNext and POS get a small team running quickly." };
  }

  if (need === "email") {
    return { plan: "Starter", serviceIds: ["starter-email", "starter-storage"], reason: "Business email and a private file drive — light, managed, and cheap." };
  }

  // unsure
  return big
    ? { plan: "Business", serviceIds: ["biz-erp-light"], reason: "For a team your size, a managed business-apps plan is the safest starting point — easy to add to later." }
    : { plan: "Starter", serviceIds: ["starter-web-hosting", "starter-email"], reason: "Start lean with a managed website and email — you can add services anytime." };
}

export default function PlanAdvisor({ isOpen, onClose, onChoosePlan, onTalkToSales }: Props) {
  const [step, setStep] = useState(0);
  const [need, setNeed] = useState<NeedKey | null>(null);
  const [size, setSize] = useState<SizeKey | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setStep(0);
    setNeed(null);
    setSize(null);
  };

  const close = () => {
    onClose();
    // reset after the close animation
    setTimeout(reset, 200);
  };

  const rec = need && size ? recommend(need, size) : null;
  const recMeta = rec ? PLAN_META[rec.plan] : null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-murzak-deep/50 backdrop-blur-xl" onClick={close} />

      <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-murzak-surface/90 backdrop-blur-xl overflow-hidden shadow-2xl border border-white/10">
        {/* header */}
        <div className="bg-murzak-gradient px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wand2 className="w-5 h-5 text-white" />
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-white/80">Plan advisor</div>
              <h3 className="text-lg font-black text-white tracking-tight">Find your perfect fit</h3>
            </div>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-xl p-2 text-white/80 hover:text-white hover:bg-white/10 transition">
            <X size={20} />
          </button>
        </div>

        {/* progress */}
        <div className="h-1 w-full bg-slate-100 dark:bg-white/10">
          <div className="h-full bg-murzak-cyan transition-all duration-300" style={{ width: `${((step + 1) / 3) * 100}%` }} />
        </div>

        <div className="p-6 sm:p-8">
          {/* Step 0 — need */}
          {step === 0 && (
            <div className="animate-fade-in">
              <p className="text-base font-black text-murzak-navy dark:text-white mb-1">What do you want to host?</p>
              <p className="text-[11px] font-bold text-slate-400 mb-5">Pick the closest match.</p>
              <div className="space-y-2.5">
                {NEEDS.map((n) => (
                  <button
                    key={n.key}
                    onClick={() => { setNeed(n.key); setStep(1); }}
                    className={`w-full text-left rounded-2xl border p-4 transition-all flex items-center justify-between gap-3 ${
                      need === n.key ? "border-murzak-cyan bg-murzak-cyan/10" : "border-slate-200 dark:border-white/10 hover:border-murzak-cyan/50"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-black text-murzak-navy dark:text-white">{n.label}</span>
                      <span className="block text-[11px] font-bold text-slate-400">{n.sub}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-murzak-cyan shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — size */}
          {step === 1 && (
            <div className="animate-fade-in">
              <p className="text-base font-black text-murzak-navy dark:text-white mb-1">How big is your team?</p>
              <p className="text-[11px] font-bold text-slate-400 mb-5">This helps us size the right capacity.</p>
              <div className="grid grid-cols-2 gap-2.5">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => { setSize(s.key); setStep(2); }}
                    className={`rounded-2xl border p-4 text-sm font-black transition-all ${
                      size === s.key ? "border-murzak-cyan bg-murzak-cyan/10 text-murzak-navy dark:text-white" : "border-slate-200 dark:border-white/10 text-murzak-navy dark:text-white hover:border-murzak-cyan/50"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(0)} className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-murzak-cyan">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            </div>
          )}

          {/* Step 2 — recommendation */}
          {step === 2 && rec && recMeta && (
            <div className="animate-fade-in text-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-murzak-cyan/10 text-murzak-cyan px-3 py-1 text-[9px] font-black uppercase tracking-widest mb-4">
                <CheckCircle2 size={12} /> Our recommendation
              </div>
              <h4 className="text-2xl font-black text-murzak-navy dark:text-white tracking-tight">
                {recMeta.label}
                {recMeta.startingKes != null && recMeta.startingKes > 0 && (
                  <span className="text-murzak-gradient"> · from {formatKes(recMeta.startingKes)}/mo</span>
                )}
              </h4>
              <p className="mt-3 text-[13px] font-bold text-slate-500 dark:text-slate-300 leading-relaxed">{rec.reason}</p>

              <div className="mt-6 space-y-3">
                {rec.plan === "Enterprise" ? (
                  <button
                    onClick={() => { onTalkToSales(); close(); }}
                    className="w-full py-4 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                  >
                    Talk to sales <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={() => { onChoosePlan(rec.plan, rec.serviceIds); close(); }}
                    className="w-full py-4 rounded-2xl bg-murzak-cyan text-murzak-navy font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                  >
                    Configure this plan <ArrowRight size={16} />
                  </button>
                )}
                <button onClick={reset} className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-murzak-cyan">
                  <RefreshCw className="w-3.5 h-3.5" /> Start over
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
