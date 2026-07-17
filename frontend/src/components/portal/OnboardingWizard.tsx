import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles, ArrowRight, Check, X, Server, Globe, Boxes, Code2, Mail,
  CreditCard, Headphones, PartyPopper, Rocket, ChevronLeft,
} from "lucide-react";
import type { User } from "../../types";

type Goal = { id: string; icon: React.ReactNode; label: string; sub: string };

const GOALS: Goal[] = [
  { id: "website", icon: <Globe size={20} />, label: "Launch a website", sub: "Site, email & SSL" },
  { id: "systems", icon: <Boxes size={20} />, label: "Run my business", sub: "ERP, POS or CRM" },
  { id: "email", icon: <Mail size={20} />, label: "Get business email", sub: "name@my-domain" },
  { id: "custom", icon: <Code2 size={20} />, label: "Something custom", sub: "Built around me" },
];

interface Props {
  isOpen: boolean;
  user: User;
  onClose: () => void;
  onChooseServices: () => void;
  onOpenSupport: () => void;
  onGoTab: (tab: "overview" | "cloud" | "billing" | "profile") => void;
}

/** A cosy, celebratory first-run onboarding for the client portal. Frontend-only. */
export default function OnboardingWizard({ isOpen, user, onClose, onChooseServices, onOpenSupport, onGoTab }: Props) {
  const [step, setStep] = useState(0); // 0 welcome · 1 goal · 2 checklist · 3 celebrate
  const [goal, setGoal] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      let saved: string | null = null;
      try { saved = localStorage.getItem("murzak_onboarding_goal"); } catch { /* ignore */ }
      setGoal(saved);
    }
  }, [isOpen]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [isOpen]);

  const services = (user.selectedServices || []) as any[];
  const hasServices = services.length > 0;
  const hasPaid = (user.invoices || []).some((inv: any) => String(inv?.status).toLowerCase() === "paid");
  // "Say hi" completes once the user has opened the support chat (tracked locally
  // when they act on it), so the item is actually completable.
  const saidHi = typeof localStorage !== "undefined" && localStorage.getItem("murzak_said_hi") === "1";

  const chooseGoal = (id: string) => {
    setGoal(id);
    try { localStorage.setItem("murzak_onboarding_goal", id); } catch { /* ignore */ }
  };

  const checklist = useMemo(() => {
    // The "services" step adapts to the stated goal: a custom build is a
    // conversation, not a self-serve configurator selection.
    const custom = goal === "custom";
    return [
      { id: "account", icon: <Check size={16} />, title: "Account created", done: true, action: null as null | (() => void), cta: "" },
      custom
        ? { id: "services", icon: <Code2 size={16} />, title: "Tell us about your custom build", done: false, action: onOpenSupport, cta: "Message us" }
        : { id: "services", icon: <Server size={16} />, title: "Choose your services", done: hasServices, action: onChooseServices, cta: "Configure" },
      { id: "pay", icon: <CreditCard size={16} />, title: "Make your first payment", done: hasPaid, action: () => onGoTab("billing"), cta: "Go to billing" },
      {
        id: "support",
        icon: <Headphones size={16} />,
        title: "Say hi to your support team",
        done: saidHi,
        action: () => { try { localStorage.setItem("murzak_said_hi", "1"); } catch { /* ignore */ } onOpenSupport(); },
        cta: "Message us",
      },
    ];
  }, [goal, hasServices, hasPaid, saidHi, onChooseServices, onGoTab]);

  const doneCount = checklist.filter((c) => c.done).length;

  if (!isOpen) return null;

  const first = (user.name || "there").split(" ")[0];
  const next = () => setStep((s) => Math.min(s + 1, 3));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-murzak-ink/70 backdrop-blur-xl" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-white rounded-[2.5rem] border border-slate-100 dark:border-murzak-border shadow-2xl overflow-hidden animate-fade-in">
        {/* Cosy gradient header with floating sparkles */}
        <div className="relative px-7 sm:px-10 pt-8 pb-7 overflow-hidden bg-murzak-base text-murzak-ink">
          <div className="absolute inset-0 -z-0 bg-brand-gradient opacity-25" />
          <div className="pointer-events-none absolute inset-0 -z-0 opacity-30">
            {[
              "top-4 left-8", "top-10 right-12", "top-16 left-1/3",
              "bottom-6 right-8", "bottom-10 left-12",
            ].map((pos, i) => (
              <Sparkles key={i} size={i % 2 ? 14 : 18} className={`absolute ${pos} text-murzak-accent animate-pulse`} style={{ animationDelay: `${i * 0.4}s` }} />
            ))}
          </div>

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-murzak-accent">
              <Rocket size={14} /> Getting started
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-murzak-ink/70 hover:text-murzak-ink hover:bg-black/5 transition" aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {/* Progress dots */}
          <div className="relative mt-5 flex items-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= step ? "bg-murzak-accent w-8" : "bg-white/20 w-4"}`} />
            ))}
          </div>
        </div>

        <div className="px-7 sm:px-10 py-8">
          {/* STEP 0 — Welcome */}
          {step === 0 && (
            <div className="animate-fade-in text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-murzak-accent/10 text-murzak-accent flex items-center justify-center mb-6">
                <PartyPopper size={30} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight text-murzak-ink">
                Welcome to Murzak, {first} 👋
              </h2>
              <p className="mt-4 text-[15px] font-medium text-slate-500 dark:text-slate-600 leading-relaxed max-w-md mx-auto">
                This is your home base. From here you’ll set up your services, pay in shillings, and reach
                a real person in Nairobi whenever you need one. Let’s get you sorted — it takes about two minutes.
              </p>
              <button
                onClick={next}
                className="mt-8 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-accent text-murzak-ink px-8 py-4 font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-all shadow-lg shadow-murzak-accent/20"
              >
                Let’s go <ArrowRight size={16} />
              </button>
              <button onClick={onClose} className="mt-4 block mx-auto text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-murzak-accent transition">
                Skip for now
              </button>
            </div>
          )}

          {/* STEP 1 — Goal */}
          {step === 1 && (
            <div className="animate-fade-in">
              <h2 className="text-xl sm:text-2xl font-[900] tracking-tight text-murzak-ink text-center">
                What brings you here?
              </h2>
              <p className="mt-2 text-[13px] font-medium text-slate-500 dark:text-slate-500 text-center">
                So we can point you to the right place. (You can change your mind anytime.)
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {GOALS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => chooseGoal(g.id)}
                    className={`text-left rounded-2xl border p-4 transition-all ${
                      goal === g.id
                        ? "border-murzak-accent bg-murzak-accent/10 shadow-md"
                        : "border-slate-200 dark:border-murzak-border hover:border-murzak-accent/50"
                    }`}
                  >
                    <span className={`inline-flex p-2.5 rounded-xl mb-3 ${goal === g.id ? "bg-murzak-accent text-murzak-ink" : "bg-murzak-accent/10 text-murzak-accent"}`}>{g.icon}</span>
                    <div className="text-sm font-black text-murzak-ink">{g.label}</div>
                    <div className="text-[11px] font-bold text-slate-500">{g.sub}</div>
                  </button>
                ))}
              </div>
              <div className="mt-7 flex items-center gap-3">
                <button onClick={back} className="p-3.5 rounded-2xl border border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent transition" aria-label="Back">
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={next}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-accent text-murzak-ink px-6 py-4 font-black text-[11px] uppercase tracking-widest hover:scale-[1.01] transition-all shadow-lg shadow-murzak-accent/20"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — Checklist */}
          {step === 2 && (
            <div className="animate-fade-in">
              <h2 className="text-xl sm:text-2xl font-[900] tracking-tight text-murzak-ink text-center">
                Your setup checklist
              </h2>
              <p className="mt-2 text-[13px] font-medium text-slate-500 dark:text-slate-500 text-center">
                {doneCount} of {checklist.length} done — knock these out whenever you like.
              </p>
              <div className="mt-6 space-y-2.5">
                {checklist.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
                      c.done ? "border-murzak-accent/30 bg-murzak-accent/[0.06]" : "border-slate-200 dark:border-murzak-border"
                    }`}
                  >
                    <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
                      c.done ? "bg-murzak-accent text-murzak-ink" : "bg-slate-100 dark:bg-black/5 text-slate-500"
                    }`}>
                      {c.done ? <Check size={16} /> : c.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-black ${c.done ? "text-slate-500 line-through" : "text-murzak-ink"}`}>{c.title}</div>
                    </div>
                    {!c.done && c.action && (
                      <button
                        onClick={() => { c.action!(); onClose(); }}
                        className="shrink-0 px-3.5 py-2 rounded-xl bg-black/5 text-murzak-ink font-black text-[9px] uppercase tracking-widest hover:bg-murzak-accent hover:text-murzak-ink transition-all"
                      >
                        {c.cta}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-7 flex items-center gap-3">
                <button onClick={back} className="p-3.5 rounded-2xl border border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent transition" aria-label="Back">
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={next}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-accent text-murzak-ink px-6 py-4 font-black text-[11px] uppercase tracking-widest hover:scale-[1.01] transition-all shadow-lg shadow-murzak-accent/20"
                >
                  Looks good <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Celebrate */}
          {step === 3 && (
            <div className="animate-fade-in text-center relative">
              {/* simple CSS confetti */}
              <div className="pointer-events-none absolute inset-x-0 -top-4 h-24 overflow-hidden">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute top-0 w-1.5 h-3 rounded-sm animate-fall"
                    style={{
                      left: `${(i * 7 + 4) % 100}%`,
                      background: i % 3 === 0 ? "#00BDFC" : i % 3 === 1 ? "#882FFD" : "#3388F2",
                      animationDelay: `${(i % 5) * 0.15}s`,
                    }}
                  />
                ))}
              </div>
              <div className="mx-auto w-16 h-16 rounded-2xl bg-murzak-accent/10 text-murzak-accent flex items-center justify-center mb-6 relative">
                <PartyPopper size={30} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-[900] tracking-tight text-murzak-ink">You’re all set! 🎉</h2>
              <p className="mt-4 text-[15px] font-medium text-slate-500 dark:text-slate-600 leading-relaxed max-w-md mx-auto">
                That’s the tour. Everything you need is in the menu on the left — and our Nairobi team is one
                message away. Welcome aboard, {first}.
              </p>
              <button
                onClick={onClose}
                className="mt-8 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-murzak-accent text-murzak-ink px-8 py-4 font-black text-[11px] uppercase tracking-widest hover:scale-[1.02] transition-all shadow-lg shadow-murzak-accent/20"
              >
                Explore my portal <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
