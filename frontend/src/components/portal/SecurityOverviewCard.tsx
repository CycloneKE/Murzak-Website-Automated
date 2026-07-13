import React from 'react';
import { ShieldCheck, Server, Lock } from 'lucide-react';

const SecurityOverviewCard: React.FC = () => {
  // Mocking realistic timestamps and counts for demonstration
  const today = new Date();
  today.setHours(2, 0, 0, 0); // Mock back up at 2 AM today
  
  const blockedThreats = Math.floor(Math.random() * 50) + 12; // 12-62 threats blocked

  return (
    <div className="glass-panel p-8 rounded-[3rem] border border-white/10 h-full relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-murzak-cyan/5 rounded-bl-full blur-3xl transition-all duration-1000 group-hover:bg-murzak-cyan/10"></div>
      
      <div className="flex items-center justify-between mb-8 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-2xl text-green-400">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="text-[12px] font-black uppercase tracking-widest text-white">Security & Integrity</h3>
            <p className="text-[10px] font-medium text-slate-400 mt-1">Automated protection active</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl">
          <div className="flex items-center gap-3">
            <Server size={16} className="text-murzak-cyan" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Uptime SLA</p>
              <p className="text-xs text-slate-400">Monthly Average</p>
            </div>
          </div>
          <span className="text-lg font-black text-white">99.99%</span>
        </div>

        <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl">
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-green-400" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Last Backup</p>
              <p className="text-xs text-slate-400">Verified & Encrypted</p>
            </div>
          </div>
          <span className="text-sm font-bold text-white tracking-wider">Today, 02:00</span>
        </div>

        <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl">
          <div className="flex items-center gap-3">
            <Lock size={16} className="text-orange-400" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Firewall Blocks</p>
              <p className="text-xs text-slate-400">Past 7 Days</p>
            </div>
          </div>
          <span className="text-lg font-black text-white">{blockedThreats}</span>
        </div>
      </div>
    </div>
  );
};

export default SecurityOverviewCard;
