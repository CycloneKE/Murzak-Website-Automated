import React from "react";
import { MoreHorizontal, Play, Square, RotateCw } from "lucide-react";

export interface ServiceHealth {
  id: string;
  name: string;
  type: string;
  status: "online" | "warning" | "offline" | "provisioning";
}

interface ServiceHealthCardProps {
  service: ServiceHealth;
  onAction?: (action: string, id: string) => void;
  key?: React.Key;
}

const STATUS_COLORS = {
  online: "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-glow-pulse",
  warning: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-glow-pulse",
  offline: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]",
  provisioning: "bg-murzak-cyan shadow-[0_0_10px_rgba(46,166,255,0.5)] animate-pulse"
};

const STATUS_LABELS = {
  online: "Online",
  warning: "Degraded",
  offline: "Offline",
  provisioning: "Provisioning"
};

export default function ServiceHealthCard({ service, onAction }: ServiceHealthCardProps) {
  return (
    <div className="glass-card rounded-[2rem] p-5 relative group overflow-hidden border border-white/10 hover:-translate-y-1 transition-all">
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div>
          <h4 className="text-[13px] font-black text-white">{service.name}</h4>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">{service.type}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{STATUS_LABELS[service.status]}</span>
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[service.status]}`} />
        </div>
      </div>
      
      <div className="mt-1 pt-4 border-t border-white/10 flex items-center justify-between relative z-10">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Resource monitoring not yet available
        </div>
        <div className="flex gap-2">
          <button onClick={() => onAction?.("restart", service.id)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Restart">
            <RotateCw size={14} />
          </button>
          <button onClick={() => onAction?.("stop", service.id)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Stop">
            <Square size={14} />
          </button>
          <button onClick={() => onAction?.("manage", service.id)} className="p-1.5 rounded-lg bg-murzak-cyan/10 hover:bg-murzak-cyan/20 text-murzak-cyan transition-colors" title="Manage">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
