import React from "react";
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2 } from "lucide-react";
import { SelectedServiceView } from "../../types";
import { ProvisioningActivityEntry } from "../../services/serviceActivity";

export type RealState = {
  label: string;
  tone: "green" | "orange" | "red" | "blue" | "slate";
  detail?: string;
};

/**
 * What "provisioned" actually means for a service — cross-referenced against
 * its real Provisioning Job, never the Web Account's own `status` field.
 *
 * That field is set to "Active" the instant an invoice is paid for any
 * non-premium service (see billingActivationService.activatedStatusFor) —
 * before any provisioning has even been attempted, let alone succeeded. Any
 * resource list that only ever shows `status` (the old topology map, and
 * ResourceListTab before this) renders an indistinguishable "Active" badge
 * for a service that's genuinely running and one whose provisioning
 * silently failed, or — like a Select field missing a value the catalog
 * actually used — never even got a job created at all.
 */
export function realStateFor(svc: SelectedServiceView, job: ProvisioningActivityEntry | undefined): RealState {
  if (svc.status === "Awaiting Payment") {
    return { label: "Awaiting payment", tone: "slate" };
  }
  if (!job) {
    return { label: "Not yet provisioned", tone: "red", detail: "No provisioning record found — message support." };
  }
  if (job.status === "needs_human") {
    return {
      label: "Needs attention",
      tone: "red",
      detail: job.statusDetail === "waiting_on_repo" ? "Waiting on your repository" : "Our team has been notified",
    };
  }
  if (job.status === "queued" || job.status === "running") {
    return { label: job.status === "running" ? "Deploying" : "Queued", tone: "blue" };
  }
  if (job.status === "active") {
    if (job.accessUrl) return { label: "Live", tone: "green", detail: job.accessUrl };
    return { label: "URL pending", tone: "orange" };
  }
  return { label: "Unknown", tone: "slate" };
}

export const REAL_STATE_TONE_CLASSES: Record<RealState["tone"], string> = {
  green: "bg-murzak-success/10 text-murzak-success border-murzak-success/20",
  orange: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  red: "bg-red-500/10 text-red-500 border-red-500/20",
  blue: "bg-murzak-accent/10 text-murzak-accent border-murzak-accent/20",
  slate: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

export function RealStateIcon({ tone, className = "w-3.5 h-3.5" }: { tone: RealState["tone"]; className?: string }) {
  if (tone === "green") return <CheckCircle2 className={className} />;
  if (tone === "red") return <AlertTriangle className={className} />;
  if (tone === "blue") return <Loader2 className={`${className} animate-spin`} />;
  if (tone === "orange") return <Clock className={className} />;
  return <HelpCircle className={className} />;
}

export function RealStateBadge({ svc, job, loading }: { svc: SelectedServiceView; job: ProvisioningActivityEntry | undefined; loading: boolean }) {
  const state = realStateFor(svc, job);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${REAL_STATE_TONE_CLASSES[state.tone]}`}
    >
      <RealStateIcon tone={state.tone} />
      {loading ? "Checking…" : state.label}
    </span>
  );
}
