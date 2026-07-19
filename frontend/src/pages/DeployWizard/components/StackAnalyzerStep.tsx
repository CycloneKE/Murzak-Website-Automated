import React, { useEffect, useState } from 'react';
import { Terminal, CheckCircle2, Loader2, Blocks } from 'lucide-react';
import { Repository, StackDetails } from '../types';
import { analyzeRepository } from '../../../services/byoa';

interface Props {
  repository: Repository;
  onNext: (stackDetails: StackDetails) => void;
}

export const StackAnalyzerStep: React.FC<Props> = ({ repository, onNext }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [stackDetails, setStackDetails] = useState<StackDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const runAnalysis = async () => {
      setLogs([`Connecting to ${repository.fullName}...`, 'Fetching repository metadata...']);
      
      try {
        const details = await analyzeRepository(repository.url);
        
        if (!isMounted) return;
        
        setLogs(prev => [...prev, 'Scanning for package.json...', 'Detecting framework...', 'Analysis complete. Stack detected.']);
        setStackDetails(details);
        setIsAnalyzed(true);
      } catch (err) {
        if (!isMounted) return;
        setLogs(prev => [...prev, 'Error analyzing repository.']);
        setError((err as Error).message);
      }
    };

    runAnalysis();

    return () => { isMounted = false; };
  }, [repository]);

  return (
    <div className="w-full max-w-2xl mx-auto animate-in slide-in-from-bottom-8 fade-in duration-500">
      <div className="bg-[#0A0A0A] border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl" />
        
        <div className="flex items-center space-x-3 mb-6 relative z-10">
          <Terminal className="w-5 h-5 text-gray-400" />
          <h2 className="text-xl font-semibold text-white">Analyzing Repository</h2>
        </div>

        {/* Terminal Window */}
        <div className="bg-black border border-white/5 rounded-xl p-4 font-mono text-sm mb-8 h-48 overflow-y-auto relative z-10">
          {logs.map((log, i) => (
            <div key={i} className="flex items-start mb-2 animate-in fade-in slide-in-from-bottom-2">
              <span className="text-gray-600 mr-4 select-none">~</span>
              <span className={i === logs.length - 1 && isAnalyzed ? "text-green-400" : (error && i === logs.length - 1 ? "text-red-400" : "text-gray-300")}>
                {log}
              </span>
            </div>
          ))}
          {!isAnalyzed && !error && (
            <div className="flex items-start">
              <span className="text-gray-600 mr-4 select-none">~</span>
              <span className="w-2 h-4 bg-white animate-pulse" />
            </div>
          )}
        </div>

        {/* Results Card */}
        {isAnalyzed && stackDetails && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10">
            <h3 className="text-lg font-medium text-white mb-4 flex items-center">
              <CheckCircle2 className="w-5 h-5 text-green-400 mr-2" />
              Stack Detected
            </h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-start space-x-3">
                <div className="mt-1">
                  <Blocks className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Framework</p>
                  <p className="font-medium text-white">{stackDetails.framework}</p>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-start space-x-3">
                <div className="mt-1">
                  <Terminal className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Language</p>
                  <p className="font-medium text-white">{stackDetails.language || 'N/A'}</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onNext(stackDetails)}
              className="w-full py-4 bg-white text-black rounded-xl font-semibold text-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              Confirm Configuration
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
