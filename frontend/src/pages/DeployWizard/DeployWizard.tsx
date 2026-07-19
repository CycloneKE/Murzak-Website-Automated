import React, { useState } from 'react';
import { RepoSelectionStep } from './components/RepoSelectionStep';
import { StackAnalyzerStep } from './components/StackAnalyzerStep';
import { ConfigAndUpsellStep } from './components/ConfigAndUpsellStep';
import { BuildProgressStep } from './components/BuildProgressStep';
import { LiveLinkStep } from './components/LiveLinkStep';
import { WizardStep, DeploymentConfig, Repository, StackDetails } from './types';
import { Rocket } from 'lucide-react';
import { startDeployment } from '../../services/byoa';

export const DeployWizard: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('repo');
  const [deploymentUuid, setDeploymentUuid] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [config, setConfig] = useState<DeploymentConfig>({
    repository: null,
    branch: 'main',
    stackDetails: null,
    subdomain: '',
    environmentVariables: [],
    isDedicatedInstance: false,
  });

  const handleRepoSelected = (repository: Repository) => {
    setConfig((prev) => ({ ...prev, repository, subdomain: repository.name.toLowerCase() }));
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
    try {
      const result = await startDeployment(finalConfig);
      setDeploymentUuid(result.deploymentUuid);
      setCurrentStep('build');
    } catch (error) {
      console.error('Failed to start deployment:', error);
      alert('Failed to start deployment: ' + (error as Error).message);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleBuildComplete = () => {
    setCurrentStep('success');
  };

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
            <ConfigAndUpsellStep 
              config={config} 
              onNext={handleConfigSubmitted} 
            />
          </div>
        );
      case 'build':
        return <BuildProgressStep deploymentUuid={deploymentUuid} onNext={handleBuildComplete} />;
      case 'success':
        return <LiveLinkStep config={config} />;
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
