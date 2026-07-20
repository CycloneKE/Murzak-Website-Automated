import React from "react";
import { MoreHorizontal, Play, Square, RotateCw, Loader2, Maximize2 } from "lucide-react";

export interface ServiceHealth {
  id: string;
  name: string;
  type: string;
  status: "online" | "warning" | "offline" | "provisioning";
  capacityClass?: string;
}

interface ServiceHealthCardProps {
  service: ServiceHealth;
  onAction?: (action: string, id: string) => void;
  // Which action is currently in flight for THIS service, if any — disables
  // the other buttons and shows a spinner on the active one. Real state, not
  // a fabricated "online/offline" indicator (see restart/stop plan doc: the
  // status dot above is provisioning-lifecycle, not live container health,
  // and actions deliberately don't claim to flip it).
  pendingAction?: string | null;
  key?: React.Key;
}

const STATUS_COLORS = {
  online: "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-glow-pulse",
  warning: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-glow-pulse",
  offline: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]",
  provisioning: "bg-murzak-accent shadow-[0_0_10px_rgba(0,189,252,0.5)] animate-pulse"
};

const STATUS_LABELS = {
  online: "Online",
  warning: "Degraded",
  offline: "Offline",
  provisioning: "Provisioning"
};

export default function ServiceHealthCard({ service, onAction, pendingAction }: ServiceHealthCardProps) {
  const busy = !!pendingAction;

  const ActionButton: React.FC<{
    action: string;
    title: string;
    icon: React.ReactNode;
    className?: string;
  }> = ({ action, title, icon, className }) => (
    <button
      onClick={() => onAction?.(action, service.id)}
      disabled={busy}
      className={`min-w-[2.5rem] min-h-[2.5rem] flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent ${className || "bg-black/5 hover:bg-black/5 text-slate-500 hover:text-murzak-ink"}`}
      title={title}
      aria-label={title}
    >
      {pendingAction === action ? <Loader2 size={14} className="animate-spin" /> : icon}
    </button>
  );

  return (
    <div className="glass-card rounded-[2rem] p-5 relative group overflow-hidden border border-murzak-border hover:-translate-y-1 transition-all">
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div>
          <h4 className="text-[13px] font-black text-murzak-ink">{service.name}</h4>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1">{service.type}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">{STATUS_LABELS[service.status]}</span>
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[service.status]}`} />
        </div>
      </div>

      <div className="mt-1 pt-4 border-t border-murzak-border flex items-center justify-between relative z-10">
        <div className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
          Resource monitoring not yet available
        </div>
        <div className="flex gap-2">
          {service.capacityClass === "scalable" && (
            <ActionButton action="scale" title="Scale Settings" icon={<Maximize2 size={14} />} />
          )}
          <ActionButton action="start" title="Start" icon={<Play size={14} />} />
          <ActionButton action="restart" title="Restart" icon={<RotateCw size={14} />} />
          <ActionButton action="stop" title="Stop" icon={<Square size={14} />} />
          <ActionButton
            action="manage"
            title="Manage"
            icon={<MoreHorizontal size={14} />}
            className="bg-murzak-accent/10 hover:bg-murzak-accent/20 text-murzak-accent"
          />
        </div>
      </div>
    </div>
  );
}
