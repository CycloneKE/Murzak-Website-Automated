import React from "react";
import { CreditCard, Server, Headphones, Activity, Sparkles } from "lucide-react";
import { Empty } from "./ui";

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
  account: <Sparkles size={14} />,
};

export default function ActivityTimeline({ events }: ActivityTimelineProps) {
  if (events.length === 0) {
    return (
      <Empty
        icon={<Activity />}
        title="No recent activity"
        description="Updates from your engineers and account changes will show up here."
      />
    );
  }

  return (
    <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-p-border">
      {events.map((event) => (
        <li key={event.id} className="relative flex gap-3">
          <span className="relative z-10 shrink-0 w-7 h-7 rounded-full border border-p-border bg-p-panel text-p-muted flex items-center justify-center">
            {TYPE_ICONS[event.type]}
          </span>
          <div className="min-w-0 grow">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-p-text truncate">{event.title}</p>
              <span className="text-xs text-p-muted shrink-0">{event.timestamp}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-p-muted wrap-break-word">{event.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
