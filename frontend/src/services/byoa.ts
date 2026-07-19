import { Repository, StackDetails, DeploymentConfig } from '../pages/DeployWizard/types';

async function handleJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}.`);
    }
    throw new Error("Server returned a non-JSON response.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

export async function fetchGithubRepos(): Promise<Repository[]> {
  const res = await fetch('/api/byoa/github/repos', {
    credentials: 'include'
  });
  const data = await handleJson<{ ok: true; repos: Repository[] }>(res);
  return data.repos;
}

export async function analyzeRepository(repoUrl: string): Promise<StackDetails> {
  const res = await fetch('/api/byoa/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ repoUrl })
  });
  const data = await handleJson<{ ok: true; analysis: StackDetails }>(res);
  return data.analysis;
}

export interface DeploymentResult {
  deploymentUuid: string;
  applicationUuid: string;
}

export async function startDeployment(config: DeploymentConfig): Promise<DeploymentResult> {
  const res = await fetch('/api/byoa/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ config })
  });
  const data = await handleJson<{ ok: true; payload: DeploymentResult }>(res);
  return data.payload;
}
