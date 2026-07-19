import React, { useEffect } from 'react';
import { ExternalLink, CheckCircle, LayoutDashboard, Settings } from 'lucide-react';
import { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
}

export const LiveLinkStep: React.FC<Props> = ({ config }) => {
  const liveUrl = `https://${config.subdomain}.murzak.app`;

  // Trigger some confetti or celebration effect here in a real app
  useEffect(() => {
    console.log('App deployed successfully!');
  }, []);

  return (
    <div className="w-full max-w-3xl mx-auto animate-in zoom-in-95 fade-in duration-500">
      <div className="bg-[#0A0A0A] border border-green-500/30 rounded-2xl p-10 shadow-[0_0_50px_rgba(34,197,94,0.1)] text-center relative overflow-hidden">
        
        {/* Success Glow */}
        <div className="absolute top-[-50%] left-[50%] translate-x-[-50%] w-96 h-96 bg-green-500/20 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10">
          <div className="w-20 h-20 mx-auto bg-green-500/10 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-green-400" />
          </div>
          
          <h2 className="text-3xl font-bold text-white mb-4">Your app is live!</h2>
          <p className="text-gray-400 mb-10 max-w-md mx-auto">
            We've successfully built and deployed your application to our global edge network. It's now available to the world.
          </p>

          {/* Prominent Live Link Slot */}
          <div className="bg-black border border-white/10 rounded-2xl p-6 mb-10 hover:border-purple-500/50 transition-colors group">
            <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold mb-3">Live URL</p>
            <a 
              href={liveUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-center space-x-3 text-2xl font-bold text-purple-400 hover:text-purple-300 transition-colors"
            >
              <span>{liveUrl}</span>
              <ExternalLink className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
            </a>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button className="w-full sm:w-auto px-8 py-4 bg-white text-black rounded-xl font-semibold text-lg flex items-center justify-center space-x-2 hover:bg-gray-200 transition-colors">
              <LayoutDashboard className="w-5 h-5" />
              <span>Go to Dashboard</span>
            </button>
            <button className="w-full sm:w-auto px-8 py-4 bg-white/10 text-white rounded-xl font-semibold text-lg flex items-center justify-center space-x-2 hover:bg-white/20 transition-colors border border-white/10">
              <Settings className="w-5 h-5" />
              <span>Configure CI/CD</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
