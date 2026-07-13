import React from 'react';
import { HardDrive, Activity } from 'lucide-react';

interface ResourceUtilizationCardProps {
  // We'll accept mock values for now, defaulting to 0
  diskUsagePercent?: number;
  bandwidthUsagePercent?: number;
}

const ResourceUtilizationCard: React.FC<ResourceUtilizationCardProps> = ({ 
  diskUsagePercent = Math.floor(Math.random() * 40) + 20, // Mock 20-60% if not provided
  bandwidthUsagePercent = Math.floor(Math.random() * 30) + 10 // Mock 10-40% if not provided
}) => {
  const getProgressColor = (percent: number) => {
    if (percent > 90) return 'bg-red-500';
    if (percent > 75) return 'bg-orange-500';
    return 'bg-murzak-cyan';
  };

  const getTextColor = (percent: number) => {
    if (percent > 90) return 'text-red-500';
    if (percent > 75) return 'text-orange-500';
    return 'text-murzak-cyan';
  };

  return (
    <div className="glass-panel p-8 rounded-[3rem] border border-white/10 h-full">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-murzak-cyan/10 rounded-2xl text-murzak-cyan">
          <Activity size={20} />
        </div>
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-widest text-white">Resource Utilization</h3>
          <p className="text-[10px] font-medium text-slate-400 mt-1">Live limits for your infrastructure</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Storage */}
        <div>
          <div className="flex justify-between items-end mb-2">
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-slate-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Storage Limit</span>
            </div>
            <span className={`text-[11px] font-black tracking-widest ${getTextColor(diskUsagePercent)}`}>
              {diskUsagePercent}%
            </span>
          </div>
          <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5">
            <div 
              className={`h-full ${getProgressColor(diskUsagePercent)} transition-all duration-1000`} 
              style={{ width: `${diskUsagePercent}%` }} 
            />
          </div>
          {diskUsagePercent > 80 && (
            <p className="text-[9px] text-orange-400 mt-2 uppercase tracking-widest">
              Approaching capacity. Consider upgrading soon.
            </p>
          )}
        </div>

        {/* Traffic / Bandwidth */}
        <div>
          <div className="flex justify-between items-end mb-2">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-slate-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Monthly Traffic</span>
            </div>
            <span className={`text-[11px] font-black tracking-widest ${getTextColor(bandwidthUsagePercent)}`}>
              {bandwidthUsagePercent}%
            </span>
          </div>
          <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5">
            <div 
              className={`h-full ${getProgressColor(bandwidthUsagePercent)} transition-all duration-1000`} 
              style={{ width: `${bandwidthUsagePercent}%` }} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResourceUtilizationCard;
