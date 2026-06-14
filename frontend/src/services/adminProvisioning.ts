// Admin provisioning API — typed wrappers around the /api/admin/provisioning/* endpoints.

export type ReadinessLevel = "required" | "conditional" | "optional";
export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  level: ReadinessLevel;
  detail?: string;
}
export interface Readiness {
  ready: boolean;
  mode: string;
  runnerEnabled: boolean;
  checks: ReadinessCheck[];
}

export interface QueueHealth {
  mode: string;
  counts?: Record<string, number>;
  countsError?: string;
}

export interface CapacityTarget {
  id: string;
  status: string;
  sellableRamMb: number;
  reservedRamMb: number;
  limitRamMb: number;
}
export interface CapacityRequest {
  name: string;
  status: string;
  requested_ram_mb?: number;
  reason?: string;
  autoscale?: number;
  modified?: string;
}
export interface Capacity {
  targets: CapacityTarget[];
  requests: CapacityRequest[];
}

export interface ProvisioningJob {
  name: string;
  web_account?: string;
  invoice?: string;
  service_id?: string;
  service_name?: string;
  category?: string;
  lane?: string;
  target?: string;
  status?: string;
  attempts?: number;
  ram_mb?: number;
  gated?: number;
  backup_status?: string;
  edge_status?: string;
  external_ref?: string;
  error?: string;
  next_run_at?: string;
  modified?: string;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

async function post<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

export const getReadiness = () => get<Readiness & { ok: boolean }>("/api/admin/provisioning/readiness");
export const getQueueHealth = () => get<QueueHealth & { ok: boolean }>("/api/admin/provisioning/queue");
export const getCapacity = () => get<Capacity & { ok: boolean }>("/api/admin/provisioning/capacity");
export const listJobs = (status?: string) =>
  get<{ ok: boolean; data: ProvisioningJob[] }>(
    `/api/admin/provisioning/jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`
  );
export const runQueue = () => post<{ ok: boolean; processed: number; results: any[] }>("/api/admin/provisioning/run");
export const retryJob = (name: string) =>
  post<{ ok: boolean; name: string }>(`/api/admin/provisioning/jobs/${encodeURIComponent(name)}/retry`);
