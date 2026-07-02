
export interface ProvisioningActivityEntry {
  id: string;
  status: string;
  log: string;
  backupStatus: string;
  edgeStatus: string;
  error: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
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
