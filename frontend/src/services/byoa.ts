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
  if (!res.ok) {
    const err = new Error(data?.error || "Request failed.") as Error & {
      requiresPurchase?: boolean;
      serviceId?: string;
      status?: number;
    };
    err.requiresPurchase = !!data?.requiresPurchase;
    err.serviceId = data?.serviceId;
    err.status = res.status;
    throw err;
  }
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
  // Provisioning Job name — the SAME job the portal dashboard tracks for this
  // service (see fetchServiceActivity below). This wizard no longer talks to
  // Coolify directly; it feeds the existing repo-URL provisioning pipeline.
  jobId: string;
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

export interface ServiceActivityJob {
  id: string;
  status: string;
  statusDetail: string;
  log: string;
  error: string;
  attempts: number;
  accessUrl: string;
  target: string;
  createdAt: string;
  updatedAt: string;
}

// Same endpoint the portal dashboard polls for deployment status/history —
// reused here instead of a byoa-specific status route.
export async function fetchServiceActivity(serviceId: string): Promise<ServiceActivityJob[]> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/activity`, {
    credentials: 'include'
  });
  const data = await handleJson<{ ok: true; jobs: ServiceActivityJob[] }>(res);
  return data.jobs;
}
