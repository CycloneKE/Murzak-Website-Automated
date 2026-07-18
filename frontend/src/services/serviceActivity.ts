
export interface ProvisioningActivityEntry {
  id: string;
  status: string;
  // Server-derived honest state:
  //   "waiting_on_repo" — BYOA job parked because no repository URL is on file
  //   "needs_attention" — build/provisioning failed; staff have been notified
  //   "url_pending"     — active, but no customer URL assigned yet
  //   ""                — nothing special
  statusDetail: "" | "waiting_on_repo" | "needs_attention" | "url_pending";
  log: string;
  backupStatus: string;
  edgeStatus: string;
  error: string;
  attempts: number;
  // The CUSTOMER's live URL from the Provisioning Job's `access` field — only
  // populated once status is "active", and never an internal/admin URL.
  accessUrl: string;
  // Which Murzak box hosts this tenant (box-1, box-2, …).
  target: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentEntry {
  uuid: string;
  status: string;
  result: "success" | "failure" | "pending";
  commit: string;
  commitMessage: string;
  createdAt: string;
  finishedAt: string;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "Request failed.");
  return data as T;
}

export async function fetchServiceActivity(serviceId: string): Promise<ProvisioningActivityEntry[]> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/activity`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true; jobs: ProvisioningActivityEntry[] }>(res);
  return data.jobs;
}

// Deployment history for a git-sourced app. available:false => the section
// simply isn't applicable (not an app, or history unavailable) — hide it.
export async function fetchServiceDeployments(
  serviceId: string
): Promise<{ available: boolean; deployments: DeploymentEntry[] }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/deployments`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true; available: boolean; deployments: DeploymentEntry[] }>(res);
  return { available: !!data.available, deployments: data.deployments || [] };
}

export async function fetchDeploymentLog(
  serviceId: string,
  deploymentUuid: string
): Promise<{ deployment: DeploymentEntry; logs: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/deployments/${encodeURIComponent(deploymentUuid)}`,
    { credentials: "include" }
  );
  return handleJson<{ deployment: DeploymentEntry; logs: string }>(res);
}

export async function requestRedeploy(
  serviceId: string
): Promise<{ deploymentUuid: string; message: string }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/redeploy`, {
    method: "POST",
    credentials: "include",
  });
  return handleJson<{ deploymentUuid: string; message: string }>(res);
}
