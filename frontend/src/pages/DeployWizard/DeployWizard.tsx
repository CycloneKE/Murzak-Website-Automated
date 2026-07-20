import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RepoSelectionStep } from './components/RepoSelectionStep';
import { StackAnalyzerStep } from './components/StackAnalyzerStep';
import { ConfigAndUpsellStep } from './components/ConfigAndUpsellStep';
import { BuildProgressStep } from './components/BuildProgressStep';
import { LiveLinkStep } from './components/LiveLinkStep';
import { WizardStep, DeploymentConfig, Repository, StackDetails } from './types';
import { Rocket, Lock } from 'lucide-react';
import { startDeployment } from '../../services/byoa';

// Same catalog SKU the backend gates /api/byoa/deploy on — see byoaRoutes.js.
const APP_HOSTING_SERVICE_ID = 'starter-app-hosting';

export const DeployWizard: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('repo');
  const [jobId, setJobId] = useState<string>('');
  const [liveUrl, setLiveUrl] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [purchaseRequired, setPurchaseRequired] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [config, setConfig] = useState<DeploymentConfig>({
    repository: null,
    branch: 'main',
    stackDetails: null,
    environmentVariables: [],
    isDedicatedInstance: false,
  });

  const handleRepoSelected = (repository: Repository) => {
    setConfig((prev) => ({ ...prev, repository }));
    setCurrentStep('analysis');
  };

  const handleStackConfirmed = (stackDetails: StackDetails) => {
    setConfig((prev) => ({ ...prev, stackDetails }));
    setCurrentStep('config');
  };

  const handleConfigSubmitted = async (updates: Partial<DeploymentConfig>) => {
    const finalConfig = { ...config, ...updates };
    setConfig(finalConfig);
    
    setIsDeploying(true);
    setDeployError(null);
    try {
      const result = await startDeployment(finalConfig);
      setJobId(result.jobId);
      setCurrentStep('build');
    } catch (error) {
      const err = error as Error & { requiresPurchase?: boolean };
      console.error('Failed to start deployment:', error);
      if (err.requiresPurchase) {
        setPurchaseRequired(true);
      } else {
        setDeployError(err.message);
      }
    } finally {
      setIsDeploying(false);
    }
  };

  const handleBuildComplete = (url: string) => {
    setLiveUrl(url);
    setCurrentStep('success');
  };

  if (purchaseRequired) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center pt-20 px-6 text-center relative overflow-hidden font-sans">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/20 blur-[120px] pointer-events-none" />
        <div className="w-16 h-16 mb-6 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
          <Lock className="w-7 h-7 text-purple-400" />
        </div>
        <h1 className="text-3xl font-bold mb-3">App Hosting is a paid plan</h1>
        <p className="text-gray-400 max-w-md mb-8">
          Deploying a repo runs it on real, managed infrastructure — add App Hosting to your
          plan (billed in KES) and come back to finish deploying.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/cloud?launch=${APP_HOSTING_SERVICE_ID}`)}
            className="px-8 py-4 bg-white text-black rounded-full font-semibold hover:bg-gray-200 transition-colors"
          >
            Get App Hosting
          </button>
          <button
            onClick={() => setPurchaseRequired(false)}
            className="px-6 py-4 text-gray-400 hover:text-white transition-colors font-medium"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'repo':
        return <RepoSelectionStep onNext={handleRepoSelected} />;
      case 'analysis':
        return (
          <StackAnalyzerStep
            repository={config.repository!}
            onNext={handleStackConfirmed}
          />
        );
      case 'config':
        return (
          <div className="relative">
            {isDeploying && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-2xl">
                <div className="flex flex-col items-center text-white">
                  <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="font-medium">Triggering Deployment...</p>
                </div>
              </div>
            )}
            {deployError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-sm">
                {deployError}
              </div>
            )}
            <ConfigAndUpsellStep
              config={config}
              onNext={handleConfigSubmitted}
            />
          </div>
        );
      case 'build':
        return <BuildProgressStep jobId={jobId} onNext={handleBuildComplete} />;
      case 'success':
        return <LiveLinkStep liveUrl={liveUrl} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center pt-20 relative overflow-hidden font-sans selection:bg-purple-500/30">
      {/* Background glow effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/20 blur-[120px] pointer-events-none" />
      
      <div className="z-10 w-full max-w-5xl px-6 pb-20">
        <header className="mb-12 flex items-center justify-center space-x-3">
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <Rocket className="w-6 h-6 text-purple-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Deploy your App
          </h1>
        </header>

        <main className="w-full transition-all duration-500 ease-out">
          {renderStep()}
        </main>
      </div>
    </div>
  );
};
