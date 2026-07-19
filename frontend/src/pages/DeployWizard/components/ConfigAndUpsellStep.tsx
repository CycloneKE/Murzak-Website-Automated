import React, { useState } from 'react';
import { Settings, Server, Globe, Zap, Check, Database } from 'lucide-react';
import { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
  onNext: (updates: Partial<DeploymentConfig>) => void;
}

export const ConfigAndUpsellStep: React.FC<Props> = ({ config, onNext }) => {
  const [subdomain, setSubdomain] = useState(config.subdomain);
  const [buildCommand, setBuildCommand] = useState(config.stackDetails?.buildCommand || '');
  const [installCommand, setInstallCommand] = useState(config.stackDetails?.installCommand || '');
  
  // Track selected upsells
  const [selectedUpsells, setSelectedUpsells] = useState<string[]>([]);

  const toggleUpsell = (id: string) => {
    setSelectedUpsells(prev => 
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      subdomain,
      isDedicatedInstance: selectedUpsells.includes('dedicated-instance') || selectedUpsells.includes('ssr-instance'),
      // Here we could store other selected upsells if we expanded DeploymentConfig
    });
  };

  // Dynamic Upsell Logic
  const getDynamicUpsells = () => {
    const fw = config.stackDetails?.framework?.toLowerCase() || '';
    
    if (fw.includes('next.js') || fw.includes('nuxt') || fw.includes('sveltekit')) {
      return [
        {
          id: 'ssr-instance',
          title: 'SSR Performance Instance',
          description: 'Dedicated compute for fast server rendering and API routes. Zero noisy neighbors.',
          icon: Server,
          isRecommended: true
        },
        {
          id: 'redis-cache',
          title: 'Managed Redis Cache',
          description: 'Supercharge your SSR app with ultra-fast session state and API caching.',
          icon: Zap,
          isRecommended: false
        }
      ];
    } else if (fw.includes('node') || fw.includes('express') || fw.includes('laravel') || fw.includes('django')) {
      return [
        {
          id: 'managed-db',
          title: 'Managed Database',
          description: 'High-availability PostgreSQL or MySQL. Automated backups and scaling.',
          icon: Database,
          isRecommended: true
        },
        {
          id: 'dedicated-instance',
          title: 'Dedicated Compute Instance',
          description: 'Maximum performance for intensive backend workloads.',
          icon: Server,
          isRecommended: false
        }
      ];
    } else {
      // Default / Static (React, Vue, Vite)
      return [
        {
          id: 'edge-cdn',
          title: 'Edge CDN Acceleration',
          description: 'Cache your static assets globally for sub-50ms load times anywhere.',
          icon: Zap,
          isRecommended: true
        },
        {
          id: 'custom-domain',
          title: 'Premium Custom Domain',
          description: 'Connect a professional, memorable domain to your project.',
          icon: Globe,
          isRecommended: false
        }
      ];
    }
  };

  const upsells = getDynamicUpsells();

  return (
    <div className="w-full max-w-5xl mx-auto animate-in slide-in-from-bottom-8 fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Column: Configuration */}
        <div className="lg:col-span-3 bg-[#0A0A0A] border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div className="flex items-center space-x-3 mb-8">
            <Settings className="w-5 h-5 text-gray-400" />
            <h2 className="text-xl font-semibold text-white">Project Configuration</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Project Subdomain</label>
              <div className="flex bg-black border border-white/10 rounded-xl overflow-hidden focus-within:border-purple-500/50 transition-colors">
                <input 
                  type="text" 
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  className="bg-transparent text-white px-4 py-3 outline-none w-full font-mono text-sm"
                />
                <div className="px-4 py-3 bg-white/5 text-gray-500 font-mono text-sm border-l border-white/10">
                  .murzak.app
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Build Command</label>
                <input 
                  type="text" 
                  value={buildCommand}
                  onChange={(e) => setBuildCommand(e.target.value)}
                  className="bg-black border border-white/10 rounded-xl px-4 py-3 text-white outline-none w-full font-mono text-sm focus:border-purple-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Install Command</label>
                <input 
                  type="text" 
                  value={installCommand}
                  onChange={(e) => setInstallCommand(e.target.value)}
                  className="bg-black border border-white/10 rounded-xl px-4 py-3 text-white outline-none w-full font-mono text-sm focus:border-purple-500/50 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Environment Variables</label>
              <div className="bg-black border border-white/10 border-dashed rounded-xl p-4 text-center">
                <p className="text-sm text-gray-500 mb-2">No environment variables added</p>
                <button type="button" className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors">
                  + Add Variable
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 mt-8">
              <button 
                type="submit"
                className="w-full py-4 bg-white text-black rounded-xl font-semibold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              >
                Deploy Now
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Upsells */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wider">Recommended Add-ons</h3>
          
          {upsells.map((upsell) => {
            const isSelected = selectedUpsells.includes(upsell.id);
            const Icon = upsell.icon;

            return (
              <div 
                key={upsell.id}
                onClick={() => toggleUpsell(upsell.id)}
                className={`cursor-pointer border rounded-2xl p-5 relative overflow-hidden transition-all duration-300 ${
                  isSelected 
                    ? 'bg-purple-900/20 border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.15)]' 
                    : 'bg-[#0A0A0A] border-white/10 hover:border-white/20'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center animate-in zoom-in">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`p-2 rounded-lg ${isSelected ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-gray-400'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{upsell.title}</h3>
                </div>
                
                <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                  {upsell.description}
                </p>
                
                {upsell.isRecommended && (
                  <div className="flex items-center text-sm font-medium text-purple-400">
                    <Zap className="w-4 h-4 mr-1" />
                    Recommended for your stack
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
};
