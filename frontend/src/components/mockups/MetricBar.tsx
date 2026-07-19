import React from "react";

interface MetricBarProps {
  label: string;
  percent: number; // 0-100
  valueLabel?: string; // overrides the auto `${percent}%` text
  tone?: "accent" | "warning" | "success";
}

const TONE_CLASSES: Record<NonNullable<MetricBarProps["tone"]>, string> = {
  accent: "bg-murzak-accent",
  warning: "bg-orange-500",
  success: "bg-murzak-success",
};

// Bar-meter used inside dark hand-coded "screenshot" mockup panels (ERP
// hero, Cloud resource monitor). Always renders on a dark track — these
// mockups are fixed-dark regardless of page theme, matching the existing
// CRM/POS mockups and the ERP Tax Settings panel.
export default function MetricBar({ label, percent, valueLabel, tone = "accent" }: MetricBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-micro font-bold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="text-micro font-black text-white">{valueLabel ?? `${clamped}%`}</span>
      </div>
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${TONE_CLASSES[tone]}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
