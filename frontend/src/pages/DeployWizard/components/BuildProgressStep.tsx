import React, { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, Box, Cpu, Cloud, Shield } from 'lucide-react';
import { fetchServiceActivity } from '../../../services/byoa';

const APP_HOSTING_SERVICE_ID = 'starter-app-hosting';
const POLL_MS = 4000;

interface Props {
  jobId: string;
  onNext: (accessUrl: string) => void;
}

// Maps the Provisioning Job's real status onto the wizard's 4 display steps.
// The job is the SAME one the portal dashboard reads — see
// GET /api/portal/services/:serviceId/activity in portalRoutes.js.
function stepForStatus(status: string, statusDetail: string, hasUrl: boolean) {
  if (status === 'active' && hasUrl) return 4; // done
  if (status === 'active') return 3; // built, domain/SSL still finishing
  if (status === 'queued' || status === 'running') return statusDetail ? 1 : 0;
  return 0;
}

export const BuildProgressStep: React.FC<Props> = ({ jobId, onNext }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  const steps = [
    { id: 0, title: 'Provisioning Infrastructure', icon: Box },
    { id: 1, title: 'Building Application', icon: Cpu },
    { id: 2, title: 'Deploying to Edge', icon: Cloud },
    { id: 3, title: 'Securing with SSL', icon: Shield },
  ];

  useEffect(() => {
    stopped.current = false;

    const poll = async () => {
      if (stopped.current) return;
      try {
        const jobs = await fetchServiceActivity(APP_HOSTING_SERVICE_ID);
        const job = jobs.find((j) => j.id === jobId) || jobs[0];
        if (!job) {
          setTimeout(poll, POLL_MS);
          return;
        }

        if (job.status === 'needs_human' || job.status === 'failed') {
          setError(job.error || 'The build needs attention — check your dashboard for details.');
          return;
        }

        const hasUrl = !!job.accessUrl;
        setCurrentStep(stepForStatus(job.status, job.statusDetail, hasUrl));

        if (job.status === 'active') {
          setCurrentStep(steps.length);
          setTimeout(() => onNext(job.accessUrl), 800);
          return;
        }

        setTimeout(poll, POLL_MS);
      } catch (err) {
        setError((err as Error).message || 'Lost connection while checking build status.');
      }
    };

    poll();
    return () => { stopped.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

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

          <div className="mt-10 h-2 bg-gray-900 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ease-out ${error ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'}`}
              style={{ width: `${Math.min((currentStep / steps.length) * 100, 100)}%` }}
            />
          </div>

          <p className="mt-6 text-center text-xs text-gray-600">
            Real builds can take a few minutes — this checks in every {Math.round(POLL_MS / 1000)}s.
          </p>
        </div>
      </div>
    </div>
  );
};
