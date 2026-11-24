import React from 'react';
import { HardDrive, Activity, Cpu } from 'lucide-react';
import { Panel } from './ui';

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
  const level = !hasData ? 'none' : percent > 90 ? 'high' : percent > 75 ? 'warn' : 'ok';
  const bar = { none: 'bg-p-border-strong', high: 'bg-p-danger', warn: 'bg-p-warning', ok: 'bg-p-accent' }[level];
  const text = { none: 'text-p-muted', high: 'text-p-danger', warn: 'text-p-warning', ok: 'text-p-text' }[level];

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2 text-p-muted">
          {icon}
          <span className="text-sm font-medium text-p-text">{label}</span>
        </div>
        <span className={`text-[13px] font-medium tabular-nums ${text}`}>
          {hasData ? `${percent}%` : unsupported ? 'Coming soon' : 'No data yet'}
        </span>
      </div>
      <div
        className="h-1.5 w-full bg-p-panel-2 rounded-full overflow-hidden"
        role={hasData ? 'progressbar' : undefined}
        aria-label={hasData ? label : undefined}
        aria-valuenow={hasData ? percent : undefined}
        aria-valuemin={hasData ? 0 : undefined}
        aria-valuemax={hasData ? 100 : undefined}
      >
        {hasData && <div className={`h-full ${bar} transition-all duration-700`} style={{ width: `${percent}%` }} />}
      </div>
      {hasData && percent > 80 && (
        <p className="text-[13px] text-p-warning mt-1.5">Approaching capacity. Consider upgrading soon.</p>
      )}
      {!hasData && (
        <p className="text-[13px] text-p-muted mt-1.5">
          {unsupported
            ? "We're wiring this up to our hosting layer. No action needed."
            : "Appears automatically once your service reports usage."}
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
    <Panel title="Usage" description="How much of your allowance is in use." className="h-full">
      <div className="space-y-5">
        <Metric icon={<HardDrive size={14} />} label="Storage" percent={diskUsagePercent} />
        <Metric icon={<Cpu size={14} />} label="Memory" percent={ramUsagePercent} />
        <Metric icon={<Activity size={14} />} label="Monthly traffic" percent={bandwidthUsagePercent} unsupported />
      </div>
    </Panel>
  );
};

export default ResourceUtilizationCard;
