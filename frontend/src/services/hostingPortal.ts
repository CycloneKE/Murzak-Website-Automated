
import type { HostingDashboardPayload } from "../types/hosting";

async function handleJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 413) {
        throw new Error("Upload too large. Please use a smaller file or increase the upload limit.");
      }
      throw new Error(`Request failed with status ${res.status}.`);
    }
    throw new Error("Server returned a non-JSON response.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

export async function fetchHostingDashboard(): Promise<HostingDashboardPayload> {
  const res = await fetch("/api/hosting/dashboard", {
    credentials: "include",
  });
  const data = await handleJson<{ ok: true; payload: HostingDashboardPayload }>(res);
  return data.payload;
}

export async function createDomainPurchaseRequest(input: {
  requestedName: string;
  requestedTld: string;
  notes?: string;
}) {
  const res = await fetch("/api/hosting/domain-purchase-requests", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function createMurzakSubdomain(input: {
  requestedLabel: string;
  targetType: string;
  targetValue: string;
  notes?: string;
}) {
  const res = await fetch("/api/hosting/murzak-subdomains", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function createExternalDomainConnection(input: {
  domainName: string;
  registrar?: string;
  notes?: string;
}) {
  const res = await fetch("/api/hosting/external-domains", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function createHostingSupportRequest(input: {
  category: string;
  title: string;
  description: string;
}) {
  const res = await fetch("/api/hosting/requests", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function createHostingSubdomain(input: {
  subdomainLabel: string;
  parentHost: string;
  targetType: string;
  targetValue: string;
  notes?: string;
}) {
  const res = await fetch("/api/hosting/subdomains", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function requestDeployment(input: {
  sourceFile?: string;
  deploymentType?: string;
  notes?: string;
}) {
  const res = await fetch("/api/hosting/deployments/request", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function uploadHostingFile(formData: FormData) {
  const res = await fetch("/api/hosting/files/upload", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return handleJson(res);
}
