
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
