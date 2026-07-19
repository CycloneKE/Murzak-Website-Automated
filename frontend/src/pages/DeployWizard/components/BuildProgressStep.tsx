import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Box, Cpu, Cloud, Shield } from 'lucide-react';

interface Props {
  deploymentUuid?: string;
  onNext: () => void;
}

export const BuildProgressStep: React.FC<Props> = ({ deploymentUuid, onNext }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const steps = [
    { id: 0, title: 'Provisioning Infrastructure', icon: Box },
    { id: 1, title: 'Building Application', icon: Cpu },
    { id: 2, title: 'Deploying to Edge', icon: Cloud },
    { id: 3, title: 'Securing with SSL', icon: Shield },
  ];

  useEffect(() => {
    if (!deploymentUuid) {
      // Fallback/testing if no deploymentUuid
      const interval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= steps.length) {
            clearInterval(interval);
            setTimeout(onNext, 1000);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);
      return () => clearInterval(interval);
    }

    // Connect to SSE
    const sse = new EventSource(`/api/byoa/deploy/${deploymentUuid}/logs`);
    
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'finished') {
          setCurrentStep(steps.length);
          sse.close();
          setTimeout(onNext, 1000);
        } else if (data.error) {
          setError(data.error);
          sse.close();
        } else if (data.log) {
          setLogs(prev => [...prev, data.log]);
          // Heuristic progression based on logs
          if (data.log.toLowerCase().includes('clone')) setCurrentStep(1);
          if (data.log.toLowerCase().includes('build')) setCurrentStep(2);
          if (data.log.toLowerCase().includes('success')) setCurrentStep(3);
        }
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };

    sse.onerror = (err) => {
      console.error('SSE connection error', err);
      setError('Lost connection to deployment logs.');
      sse.close();
    };

    return () => sse.close();
  }, [deploymentUuid, onNext]);

  return (
    <div className="w-full max-w-2xl mx-auto animate-in slide-in-from-bottom-8 fade-in duration-500">
      <div className="bg-[#0A0A0A] border border-white/10 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        
        {/* Animated background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-blue-500/5 animate-pulse" />

        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-center text-white mb-8">Deploying your App</h2>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = currentStep > index;
              const isActive = currentStep === index && !error;
              const isPending = currentStep < index;

              return (
                <div key={step.id} className="flex items-center space-x-4">
                  <div className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors duration-500 ${
                    isCompleted ? 'border-green-500 bg-green-500/10' :
                    isActive ? 'border-purple-500 bg-purple-500/10' :
                    'border-gray-800 bg-transparent'
                  }`}>
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : isActive ? (
                      <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                    ) : (
                      <Icon className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <h3 className={`text-lg font-medium transition-colors duration-500 ${
                      isCompleted ? 'text-gray-300' :
                      isActive ? 'text-white' :
                      'text-gray-600'
                    }`}>
                      {step.title}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fake Progress Bar */}
          <div className="mt-10 h-2 bg-gray-900 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ease-out ${error ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'}`}
              style={{ width: `${Math.min((currentStep / steps.length) * 100, 100)}%` }}
            />
          </div>

          {/* Optional raw logs viewer */}
          {logs.length > 0 && (
             <div className="mt-6 bg-black border border-white/5 rounded-xl p-4 font-mono text-xs h-32 overflow-y-auto custom-scrollbar">
               {logs.map((log, i) => (
                 <div key={i} className="text-gray-400 mb-1">{log}</div>
               ))}
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
