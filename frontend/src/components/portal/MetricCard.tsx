import React, { useEffect, useState } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  key?: React.Key;
}

export default function MetricCard({ title, value, icon, trend, trendUp, actionLabel, onAction }: MetricCardProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (typeof value === "number") {
      let start = 0;
      const end = value;
      if (start === end) {
        setDisplayValue(end);
        return;
      }

      // rAF never fires in a hidden/background tab, which would freeze the
      // counter at 0 until the tab is foregrounded — show the real value.
      if (typeof document !== "undefined" && document.hidden) {
        setDisplayValue(end);
        return;
      }

      let totalDuration = 1000;
      let startTime: number | null = null;

      const animate = (currentTime: number) => {
        if (!startTime) startTime = currentTime;
        const progress = Math.min((currentTime - startTime) / totalDuration, 1);
        
        // ease out quad
        const easeProgress = progress * (2 - progress);
        
        setDisplayValue(Math.floor(easeProgress * (end - start) + start));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setDisplayValue(end);
        }
      };
      
      requestAnimationFrame(animate);
    }
  }, [value]);

  return (
    <div className="glass-card rounded-[2rem] p-6 hover:-translate-y-1 transition-transform border border-white/10 relative overflow-hidden group">
      <div className="absolute -inset-1 bg-gradient-to-r from-murzak-cyan/0 via-murzak-cyan/10 to-murzak-violet/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-xl"></div>
      <div className="relative z-10 flex items-start justify-between mb-4">
        <div className="p-3 bg-murzak-cyan/10 text-murzak-cyan rounded-2xl shadow-[0_0_15px_rgba(46,166,255,0.15)]">
          {icon}
        </div>
        {trend && (
          <div className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${trendUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </div>
        )}
      </div>
      <div className="relative z-10">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{title}</h3>
        <div className="text-3xl font-black text-white">
          {typeof value === 'number' ? displayValue : value}
        </div>
        {actionLabel && onAction && (
          <div className="mt-4">
            <button 
              onClick={onAction}
              className="px-4 py-2 bg-murzak-cyan text-murzak-navy font-bold text-[10px] uppercase tracking-widest rounded-xl hover:scale-105 transition-transform"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
