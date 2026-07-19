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

      if (typeof document !== "undefined" && document.hidden) {
        setDisplayValue(end);
        return;
      }

      let totalDuration = 1000;
      let startTime: number | null = null;

      const animate = (currentTime: number) => {
        if (!startTime) startTime = currentTime;
        const progress = Math.min((currentTime - startTime) / totalDuration, 1);
        
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
    <div className="glass-panel glass-interactive rounded-2xl p-6 relative overflow-hidden group">
      <div className="absolute -inset-1 bg-gradient-to-r from-murzak-accent/0 via-murzak-accent/5 to-murzak-brand1/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-xl"></div>
      <div className="relative z-10 flex items-start justify-between mb-4">
        <div className="p-3 bg-murzak-brand2/10 text-murzak-accent rounded-xl">
          {icon}
        </div>
        {trend && (
          <div className={`px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${trendUp ? 'bg-murzak-success/15 text-murzak-success' : 'bg-murzak-danger/10 text-murzak-danger'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </div>
        )}
      </div>
      <div className="relative z-10 flex flex-col">
        <h3 className="text-body-sm font-semibold text-murzak-muted mb-1">{title}</h3>
        <div className="text-display-sm font-mono font-bold text-murzak-ink">
          {typeof value === 'number' ? displayValue : value}
        </div>
        {actionLabel && onAction && (
          <div className="mt-4">
            <button 
              onClick={onAction}
              className="px-4 py-2 bg-murzak-accent/10 text-murzak-accent font-semibold text-sm rounded-lg hover:bg-murzak-accent/20 transition-colors"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
