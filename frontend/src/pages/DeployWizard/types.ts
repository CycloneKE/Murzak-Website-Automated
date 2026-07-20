export type WizardStep = 'repo' | 'analysis' | 'config' | 'build' | 'success';

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  updatedAt: string;
}

export interface StackDetails {
  framework: string;
  language: string;
  buildCommand: string;
  installCommand: string;
  outputDirectory: string;
}

export interface DeploymentConfig {
  repository: Repository | null;
  branch: string;
  stackDetails: StackDetails | null;
  environmentVariables: { key: string; value: string }[];
  isDedicatedInstance: boolean;
}
