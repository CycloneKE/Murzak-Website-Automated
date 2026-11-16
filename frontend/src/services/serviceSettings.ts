import { toUserMessage } from "./errors";

/**
 * Per-service settings: domains, healthcheck, bulk environment import, backups.
 * Thin fetch wrappers over /api/portal/services/:id/*; every failure surfaces
 * as an Error whose message is already safe to show (see services/errors.ts).
 */

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

const base = (id: string) => `/api/portal/services/${encodeURIComponent(id)}`;
const JSON_INIT = { headers: { "Content-Type": "application/json" }, credentials: "include" as const };

export interface ServiceDomain {
  host: string;
  scheme: string;
  /** The built-in address. It can't be removed. */
  system: boolean;
}

export async function fetchDomains(id: string) {
  const res = await fetch(`${base(id)}/domains`, { credentials: "include" });
  return handleJson<{ domains: ServiceDomain[]; serverIp: string | null; forceHttps: boolean | null }>(res);
}

export async function removeDomain(id: string, host: string) {
  const res = await fetch(`${base(id)}/domains/${encodeURIComponent(host)}`, { method: "DELETE", credentials: "include" });
  return handleJson<{ message: string }>(res);
}

export async function addDomain(id: string, domain: string) {
  const res = await fetch(`${base(id)}/domain`, { method: "POST", ...JSON_INIT, body: JSON.stringify({ domain }) });
  return handleJson<{ message: string }>(res);
}

export interface Healthcheck {
  enabled: boolean;
  path: string;
  method: string;
  scheme: string;
  port: number | null;
  returnCode: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds: number;
}

export async function fetchHealthcheck(id: string) {
  const res = await fetch(`${base(id)}/healthcheck`, { credentials: "include" });
  return (await handleJson<{ healthcheck: Healthcheck }>(res)).healthcheck;
}

export async function saveHealthcheck(id: string, hc: Partial<Healthcheck>) {
  const res = await fetch(`${base(id)}/healthcheck`, { method: "PUT", ...JSON_INIT, body: JSON.stringify(hc) });
  return handleJson<{ message: string }>(res);
}

export async function saveEnvText(id: string, text: string) {
  const res = await fetch(`${base(id)}/envs/bulk`, { method: "POST", ...JSON_INIT, body: JSON.stringify({ text }) });
  return handleJson<{ message: string; count: number }>(res);
}

export interface BackupSchedule {
  uuid: string;
  enabled: boolean;
  frequency: string | null;
  retentionCount: number | null;
  lastStatus: string | null;
  lastRunAt: string | null;
}

export async function fetchBackups(id: string) {
  const res = await fetch(`${base(id)}/backups`, { credentials: "include" });
  return handleJson<{ supported: boolean; schedules: BackupSchedule[] }>(res);
}

/** `.env`-style text for the Developer view. Values that need it are quoted. */
export function envsToText(envs: { key: string; value: string | null; redacted?: boolean }[]): string {
  return envs
    .filter((e) => !e.redacted && e.value !== null)
    .map((e) => {
      const v = e.value as string;
      return /[\s#"'=]/.test(v) ? `${e.key}="${v.replace(/"/g, '\\"')}"` : `${e.key}=${v}`;
    })
    .join("\n");
}
