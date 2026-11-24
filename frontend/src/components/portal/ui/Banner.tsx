import React from "react";
import { ArrowRight } from "lucide-react";
import PButton from "./PButton";

type Tone = "danger" | "warning" | "info" | "success";

const TONES: Record<Tone, string> = {
  danger: "border-p-danger/40 bg-p-danger-soft",
  warning: "border-p-warning/40 bg-p-warning-soft",
  info: "border-p-accent/30 bg-p-accent-soft",
  success: "border-p-success/40 bg-p-success-soft",
};
const ICON: Record<Tone, string> = {
  danger: "text-p-danger",
  warning: "text-p-warning",
  info: "text-p-accent-text",
  success: "text-p-success",
};

interface BannerProps {
  tone: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** A flat strip for account-level notices (payment due, trial, suspended). */
export default function Banner({ tone, icon, children, action, className = "" }: BannerProps) {
  return (
    <div
      data-p="banner"
      role={tone === "danger" ? "alert" : "status"}
      className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border px-4 py-3 ${TONES[tone]} ${className}`}
    >
      {icon && <span className={`shrink-0 ${ICON[tone]}`}>{icon}</span>}
      <p className="grow text-sm text-p-text">{children}</p>
      {action && (
        <PButton variant="primary" onClick={action.onClick} className="shrink-0 self-start sm:self-auto">
          {action.label} <ArrowRight className="w-4 h-4" />
        </PButton>
      )}
    </div>
  );
}
