import React from "react";

export type PillTone = "ok" | "progress" | "warn" | "bad" | "idle";

const TONES: Record<PillTone, { wrap: string; dot: string }> = {
  ok: { wrap: "bg-p-success-soft text-p-success", dot: "bg-p-success" },
  progress: { wrap: "bg-p-info-soft text-p-info", dot: "bg-p-info animate-pulse" },
  warn: { wrap: "bg-p-warning-soft text-p-warning", dot: "bg-p-warning" },
  bad: { wrap: "bg-p-danger-soft text-p-danger", dot: "bg-p-danger" },
  idle: { wrap: "bg-p-panel-2 text-p-muted", dot: "bg-p-muted" },
};

/** Maps an account/service status string onto a pill tone. */
export function statusTone(status: string | undefined | null): PillTone {
  const s = (status || "").toLowerCase();
  if (s === "active" || s === "paid" || s === "live" || s === "running") return "ok";
  if (s === "setting up" || s === "queued" || s === "deploying" || s === "finishing setup") return "progress";
  if (s === "awaiting payment" || s === "unpaid" || s === "overdue" || s === "url pending" || s === "stopped") return "warn";
  if (s === "failed" || s === "suspended" || s === "needs attention" || s === "not yet provisioned") return "bad";
  return "idle";
}

export default function StatusPill({ tone, children, className = "" }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  const t = TONES[tone];
  return (
    <span
      data-p="pill"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${t.wrap} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden />
      {children}
    </span>
  );
}
