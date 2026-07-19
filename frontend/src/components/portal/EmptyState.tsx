import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "accent";
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = "neutral",
  className = "",
}: EmptyStateProps) {
  const toneClasses =
    tone === "accent"
      ? "bg-murzak-accent/10 text-murzak-accent"
      : "bg-black/5 dark:bg-white/5 text-slate-500";

  return (
    <div
      className={`text-center py-10 px-6 rounded-[2rem] border border-dashed border-murzak-border bg-black/5 dark:bg-white/5 ${className}`}
    >
      <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center ${toneClasses}`}>
        {icon}
      </div>
      <p className="text-label font-black uppercase tracking-widest text-murzak-ink mb-1.5">{title}</p>
      {description && (
        <p className="text-micro text-slate-600 max-w-xs mx-auto leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 px-5 py-2.5 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-105 transition-all inline-flex items-center gap-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
