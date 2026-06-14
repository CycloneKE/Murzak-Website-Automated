// src/services/requests.ts
export type RequestType = "Sales Inquiry" | "Demo Request";

export interface CreateRequestPayload {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  message: string;
  requestType: RequestType;
  pageUrl?: string;
}

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || ""; 
// If empty, it will call same-origin (good when frontend+backend are behind same domain/reverse proxy).

export async function createClientRequest(payload: CreateRequestPayload) {
  const res = await fetch(`${API_BASE}/api/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // safe even if you don't use cookies
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || "Failed to submit request.");
  }

  return data as { ok: true; id: string };
}
