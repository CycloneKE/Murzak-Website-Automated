import React from 'react';
import { Activity, Zap, Clock, ShieldCheck, HeartPulse } from 'lucide-react';

const SLA: React.FC = () => {
  return (
    <div className="animate-fade-in bg-transparent text-murzak-navy dark:text-white transition-colors duration-300">
      <section className="relative min-h-[60vh] flex items-start pt-12 lg:pt-24 pb-20 overflow-hidden bg-transparent">
        <div className="absolute inset-0 z-[-1] bg-murzak-navy">
          <img 
            src="https://images.unsplash.com/photo-1551288049-bbbda5366392?auto=format&w=1600&q=65" 
            alt="Murzak Reliability" 
            className="w-full h-full object-cover opacity-20 dark:opacity-40 transition-opacity duration-700"
            style={{ fetchPriority: 'high' } as any}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent dark:from-murzak-deep dark:via-murzak-deep/95"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-murzak-deep via-transparent to-transparent"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 lg:px-12 relative z-10 w-full text-center lg:text-left">
          <div className="inline-flex items-center rounded-full bg-murzak-cyan/10 px-4 py-2 text-[10px] font-black text-murzak-cyan mb-8 uppercase tracking-widest border border-murzak-cyan/20 backdrop-blur-md">
            Performance guarantee
          </div>
          <h1 className="text-5xl lg:text-9xl font-[900] text-murzak-navy dark:text-white mb-10 tracking-tighter leading-[0.85] drop-shadow-2xl">
            Reliability <br /><span className="text-murzak-cyan">assurance.</span>
          </h1>
          <p className="text-xl lg:text-3xl text-slate-700 dark:text-slate-300 font-bold max-w-2xl opacity-90 mx-auto lg:mx-0">
            Our unyielding commitment to system uptime and technical integrity.
          </p>
        </div>
      </section>

      <section className="relative py-20 lg:py-32 bg-white/80 dark:bg-murzak-deep/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 lg:px-12">
          <div className="space-y-24">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="bg-murzak-navy p-12 rounded-[3.5rem] text-white shadow-3xl relative overflow-hidden group">
                <Zap size={40} className="text-murzak-cyan mb-8" />
                <h2 className="text-6xl font-[900] mb-4 tracking-tighter">99.9%</h2>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-10">Uptime guarantee</h3>
                <p className="text-base font-bold text-slate-300 leading-relaxed">We guarantee monthly network availability. If we fall below this threshold, Business clients are eligible for service credits.</p>
              </div>
              <div className="bg-white/50 dark:bg-white/5 p-12 rounded-[3.5rem] border border-slate-200 dark:border-white/10 shadow-xl backdrop-blur-sm">
                <Clock size={40} className="text-murzak-cyan mb-8" />
                <h2 className="text-6xl font-[900] mb-4 tracking-tighter text-murzak-navy dark:text-white">2-hour</h2>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-10">Critical response</h3>
                <p className="text-base font-bold text-slate-600 dark:text-slate-400 leading-relaxed">Our Nairobi engineering team reacts to P1 critical infrastructure events within 120 minutes during standard operating hours.</p>
              </div>
            </div>

            <div className="space-y-10">
              <h2 className="text-3xl font-black flex items-center gap-4 text-murzak-navy dark:text-white tracking-tighter leading-none">
                <Activity size={28} className="text-murzak-cyan" /> Support matrix
              </h2>
              <div className="overflow-x-auto rounded-[2rem] border border-slate-100 dark:border-white/5 shadow-lg bg-white/40 dark:bg-black/20">
                <table className="w-full text-left text-sm font-bold">
                  <thead className="border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5">
                    <tr className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
                      <th className="py-6 px-8">Priority level</th>
                      <th className="py-6 px-8">Business plan</th>
                      <th className="py-6 px-8">Enterprise plan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/10 text-slate-600 dark:text-slate-300">
                    <tr className="hover:bg-murzak-cyan/5 transition-colors">
                      <td className="py-6 px-8 font-black text-murzak-navy dark:text-white">P1: Critical outage</td>
                      <td className="py-6 px-8">2 Hours</td>
                      <td className="py-6 px-8 text-murzak-cyan">1 Hour</td>
                    </tr>
                    <tr className="hover:bg-murzak-cyan/5 transition-colors">
                      <td className="py-6 px-8 font-black text-murzak-navy dark:text-white">P2: Major slowdown</td>
                      <td className="py-6 px-8">4 Hours</td>
                      <td className="py-6 px-8">2 Hours</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SLA;
