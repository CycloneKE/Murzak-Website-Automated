import React from "react";
import { Headphones, MessageSquare, Clock, ShieldCheck } from "lucide-react";
import { usePortal } from "../PortalContext";
import { PLAN_SLA } from "../../../config/serviceCatalog";
import { normalizePlanToCode } from "../helpers";

/**
 * Support as a place, not a floating modal.
 *
 * The conversation itself still lives in the Contact modal — it is the same
 * thread the admin inbox answers — but a customer looking for "where do I get
 * help, and how fast will you answer" had nowhere to land. This is also the
 * one screen where a plan means something now that plans no longer gate the
 * catalogue: it IS the SLA.
 */
const SupportTab: React.FC = () => {
  const { setIsContactOpen, user } = usePortal();
  const sla = PLAN_SLA[normalizePlanToCode(user.plan)];

  const Row: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-slate-100 dark:border-murzak-border last:border-0">
      <span className="inline-flex items-center gap-3 text-micro font-black uppercase text-slate-600 dark:text-slate-400">
        {icon} {label}
      </span>
      <span className="text-sm font-black text-murzak-ink dark:text-slate-100 text-right">{value}</span>
    </div>
  );

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase text-murzak-ink dark:text-slate-100">
          Support
        </h2>
        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
          Talk to the team in Nairobi. One thread, always the same people.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-7 shadow-lg">
          <div className="p-3 w-fit rounded-2xl bg-murzak-accent/10 text-murzak-accent">
            <MessageSquare className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100 mt-4">Message us</h3>
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-500 mt-2 leading-relaxed">
            Anything at all — a change, a report, something broken. You'll get a reply in
            this same thread and by email, so nothing gets lost.
          </p>
          <button
            type="button"
            onClick={() => setIsContactOpen(true)}
            className="mt-6 inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
          >
            <Headphones className="w-4 h-4" /> Open the conversation
          </button>
        </div>

        <div className="bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-7 shadow-lg">
          <h3 className="text-lg font-black text-murzak-ink dark:text-slate-100">
            What your {user.plan || "current"} plan promises
          </h3>
          <div className="mt-4">
            <Row icon={<Clock className="w-4 h-4" />} label="First response" value={sla.firstResponse} />
            <Row icon={<ShieldCheck className="w-4 h-4" />} label="Backups kept" value={sla.backupRetention} />
            <Row
              icon={<Headphones className="w-4 h-4" />}
              label="Named contact"
              value={sla.namedContact ? "Yes" : "Shared team"}
            />
            <Row icon={<MessageSquare className="w-4 h-4" />} label="Channels" value={sla.channels.join(", ")} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportTab;
