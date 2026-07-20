import React from 'react';
import { HardDrive, Activity, Cpu } from 'lucide-react';

// Real usage, when available, comes from the Coolify lane's getUsage() (Phase
// 3) — unconfirmed whether Coolify's API actually exposes these numbers (see
// lanes/coolify.js). Any prop left undefined renders an honest "not
// available" state rather than a fabricated number a customer could
// reasonably act on (e.g. panic-upgrade off a random 85%). Bandwidth/traffic
// has no known Coolify data source at all — expect it to stay unavailable.
interface ResourceUtilizationCardProps {
  diskUsagePercent?: number;
  ramUsagePercent?: number;
  bandwidthUsagePercent?: number;
}

function Metric({
  icon,
  label,
  percent,
  unsupported,
}: {
  icon: React.ReactNode;
  label: string;
  percent?: number;
  // True for metrics with no data source yet (e.g. bandwidth) — distinct from
  // "not populated yet" so the empty state doesn't imply it'll fix itself.
  unsupported?: boolean;
}) {
  const hasData = typeof percent === 'number';
  const color = !hasData
    ? 'bg-slate-600'
    : percent > 90
    ? 'bg-red-500'
    : percent > 75
    ? 'bg-orange-500'
    : 'bg-murzak-accent';
  const textColor = !hasData
    ? 'text-slate-500'
    : percent > 90
    ? 'text-red-500'
    : percent > 75
    ? 'text-orange-500'
    : 'text-murzak-accent';

  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-label font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">{label}</span>
        </div>
        <span className={`text-micro font-black ${textColor}`}>
          {hasData ? `${percent}%` : unsupported ? 'Coming soon' : 'No data yet'}
        </span>
      </div>
      <div className="h-2 w-full bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden border border-murzak-border/50">
        <div
          className={`h-full ${color} transition-all duration-1000`}
          style={{ width: hasData ? `${percent}%` : '100%', opacity: hasData ? 1 : 0.15 }}
        />
      </div>
      {hasData && percent > 80 && (
        <p className="text-micro text-orange-400 mt-2 uppercase">
          Approaching capacity. Consider upgrading soon.
        </p>
      )}
      {!hasData && (
        <p className="text-micro text-slate-500 mt-2">
          {unsupported
            ? "We're wiring this up to our hosting layer — no action needed."
            : "Metrics appear automatically once your service reports usage."}
        </p>
      )}
    </div>
  );
}

const ResourceUtilizationCard: React.FC<ResourceUtilizationCardProps> = ({
  diskUsagePercent,
  ramUsagePercent,
  bandwidthUsagePercent,
}) => {
  return (
    <div className="glass-panel p-8 rounded-[3rem] border border-murzak-border h-full">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-murzak-accent/10 rounded-2xl text-murzak-accent">
          <Activity size={20} />
        </div>
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-widest text-murzak-ink">Resource Utilization</h3>
          <p className="text-micro font-medium text-slate-600 dark:text-slate-400 mt-1">Limits for your infrastructure</p>
        </div>
      </div>

      <div className="space-y-8">
        <Metric icon={<HardDrive size={14} className="text-slate-500" />} label="Storage Limit" percent={diskUsagePercent} />
        <Metric icon={<Cpu size={14} className="text-slate-500" />} label="Memory (RAM)" percent={ramUsagePercent} />
        <Metric icon={<Activity size={14} className="text-slate-500" />} label="Monthly Traffic" percent={bandwidthUsagePercent} unsupported />
      </div>
    </div>
  );
};

export default ResourceUtilizationCard;
