import { toUserMessage } from "./errors";
/**
 * Resource-admin API client — environment variables and runtime logs for a
 * service the customer has been granted advanced control over.
 *
 * Values returned by listEnvs may be null when the server redacted a
 * write-only secret (`redacted: true`). Treat null as "we can't show you
 * this", never as an empty string — writing it back would blank the secret.
 */

export interface ResourceAdminEligibility {
  /** Server-side kill switch. When false, nothing here is available at all. */
  enabled: boolean;
  planAllowed: boolean;
  approved: boolean;
  disclosureAccepted: boolean;
}

export interface EnvVar {
  uuid: string;
  key: string;
  value: string | null;
  isBuildTime: boolean;
  isLiteral: boolean;
  isMultiline: boolean;
  isShownOnce: boolean;
  redacted: boolean;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

const JSON_POST = {
  headers: { "Content-Type": "application/json" },
  credentials: "include" as const,
};

export async function fetchResourceAdminEligibility(): Promise<ResourceAdminEligibility> {
  const res = await fetch("/api/portal/resource-admin/eligibility", { credentials: "include" });
  const data = await handleJson<{ ok: true } & ResourceAdminEligibility>(res);
  return {
    enabled: !!data.enabled,
    planAllowed: !!data.planAllowed,
    approved: !!data.approved,
    disclosureAccepted: !!data.disclosureAccepted,
  };
}

export async function acceptResourceAdminDisclosure(): Promise<void> {
  const res = await fetch("/api/portal/resource-admin/accept-disclosure", {
    method: "POST",
    ...JSON_POST,
  });
  await handleJson(res);
}

export async function fetchEnvVars(serviceId: string): Promise<EnvVar[]> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/envs`, {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true; envs: EnvVar[] }>(res);
  return data.envs || [];
}

export async function createEnvVar(
  serviceId: string,
  input: { key: string; value: string; isBuildTime?: boolean }
): Promise<{ message: string }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/envs`, {
    method: "POST",
    ...JSON_POST,
    body: JSON.stringify(input),
  });
  return handleJson<{ message: string }>(res);
}

export async function updateEnvVar(
  serviceId: string,
  key: string,
  input: { value: string; isBuildTime?: boolean }
): Promise<{ message: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/envs/${encodeURIComponent(key)}`,
    { method: "PATCH", ...JSON_POST, body: JSON.stringify(input) }
  );
  return handleJson<{ message: string }>(res);
}

export async function deleteEnvVar(serviceId: string, envUuid: string): Promise<{ message: string }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/envs/${encodeURIComponent(envUuid)}`,
    { method: "DELETE", credentials: "include" }
  );
  return handleJson<{ message: string }>(res);
}

export async function fetchRuntimeLogs(
  serviceId: string,
  lines = 200
): Promise<{ logs: string; lines: number }> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/logs?lines=${encodeURIComponent(String(lines))}`,
    { credentials: "include" }
  );
  return handleJson<{ logs: string; lines: number }>(res);
}

export async function restartService(serviceId: string): Promise<{ message: string }> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/restart`, {
    method: "POST",
    ...JSON_POST,
    body: JSON.stringify({}),
  });
  return handleJson<{ message: string }>(res);
}
