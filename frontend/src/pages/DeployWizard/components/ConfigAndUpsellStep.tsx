import React, { useState } from 'react';
import { Settings, Server, Globe, Zap, Check, Database, Plus, X as XIcon, Info } from 'lucide-react';
import { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
  onNext: (updates: Partial<DeploymentConfig>) => void;
}

export const ConfigAndUpsellStep: React.FC<Props> = ({ config, onNext }) => {
  const [buildCommand, setBuildCommand] = useState(config.stackDetails?.buildCommand || '');
  const [installCommand, setInstallCommand] = useState(config.stackDetails?.installCommand || '');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>(config.environmentVariables || []);

  // Track selected upsells
  const [selectedUpsells, setSelectedUpsells] = useState<string[]>([]);

  const toggleUpsell = (id: string) => {
    setSelectedUpsells(prev =>
      prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]
    );
  };

  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }]);
  const removeEnvVar = (index: number) => setEnvVars(prev => prev.filter((_, i) => i !== index));
  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({
      environmentVariables: envVars.filter((row) => row.key.trim()),
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
            <div className="flex items-start gap-2.5 text-xs text-gray-500 bg-white/[0.03] border border-white/10 rounded-xl p-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-gray-500" />
              <span>Your live URL is assigned automatically once the build finishes — you'll see it on the next screen.</span>
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
              {envVars.length === 0 ? (
                <div className="bg-black border border-white/10 border-dashed rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-500 mb-2">No environment variables added</p>
                  <button
                    type="button"
                    onClick={addEnvVar}
                    className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
                  >
                    + Add Variable
                  </button>
                </div>
              ) : (
                <div className="bg-black border border-white/10 rounded-xl p-3 space-y-2">
                  {envVars.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="KEY"
                        value={row.key}
                        onChange={(e) => updateEnvVar(i, 'key', e.target.value.toUpperCase())}
                        className="w-2/5 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white outline-none font-mono text-xs focus:border-purple-500/50 transition-colors"
                      />
                      <input
                        type="text"
                        placeholder="value"
                        value={row.value}
                        onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white outline-none font-mono text-xs focus:border-purple-500/50 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvVar(i)}
                        className="p-2 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                        aria-label="Remove variable"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEnvVar}
                    className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors pt-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Variable
                  </button>
                </div>
              )}
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
