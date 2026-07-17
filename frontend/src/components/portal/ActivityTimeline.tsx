import React, { useEffect, useRef, useState } from "react";
import { CreditCard, Server, Headphones, Activity, Sparkles } from "lucide-react";

export interface TimelineEvent {
  id: string;
  type: "payment" | "system" | "support" | "account";
  title: string;
  description: string;
  timestamp: string; // e.g., "2 hours ago" or "Jun 24"
  status?: "success" | "pending" | "error";
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
}

const TYPE_ICONS = {
  payment: <CreditCard size={14} />,
  system: <Server size={14} />,
  support: <Headphones size={14} />,
  account: <Sparkles size={14} />
};

const TYPE_COLORS = {
  payment: "bg-green-500/10 text-green-400 border-green-500/20",
  system: "bg-murzak-accent/10 text-murzak-accent border-murzak-accent/20",
  support: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  account: "bg-blue-500/10 text-blue-400 border-blue-500/20"
};

export default function ActivityTimeline({ events }: ActivityTimelineProps) {
  return (
    <div className="relative pl-6 space-y-8 before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-gradient-to-b before:from-murzak-accent/50 before:to-transparent">
      {events.map((event, index) => (
        <div key={event.id} className="relative group animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
          <div className={`absolute -left-6 top-1 w-6 h-6 rounded-full border flex items-center justify-center bg-murzak-ink ${TYPE_COLORS[event.type]} shadow-[0_0_10px_currentColor] transition-transform group-hover:scale-110`}>
            {TYPE_ICONS[event.type]}
          </div>
          
          <div className="glass-panel p-4 rounded-2xl hover:border-white/20 transition-all cursor-default">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-[12px] font-black text-murzak-ink">{event.title}</h4>
                <p className="text-[11px] font-medium text-slate-500 mt-1 leading-relaxed">{event.description}</p>
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 shrink-0">
                {event.timestamp}
              </span>
            </div>
          </div>
        </div>
      ))}
      
      {events.length === 0 && (
        <div className="text-center py-8">
          <Activity className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">No recent activity</p>
        </div>
      )}
    </div>
  );
}
