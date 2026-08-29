import { toUserMessage } from "./errors";
export interface TerminalEligibility {
  enterprisePlan: boolean;
  approved: boolean;
  disclosureAccepted: boolean;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

export async function fetchTerminalEligibility(): Promise<TerminalEligibility> {
  const res = await fetch("/api/portal/terminal/eligibility", { credentials: "include" });
  const data = await handleJson<{ ok: true } & TerminalEligibility>(res);
  return { enterprisePlan: !!data.enterprisePlan, approved: !!data.approved, disclosureAccepted: !!data.disclosureAccepted };
}

export async function acceptTerminalDisclosure(): Promise<{ disclosureAcceptedAt: string }> {
  const res = await fetch("/api/portal/terminal/accept-disclosure", {
    method: "POST",
    credentials: "include",
  });
  return handleJson<{ disclosureAcceptedAt: string }>(res);
}

export interface TerminalSession {
  wsTicket: string;
  wsPath: string;
}

// Single-use, ~45s-lived ticket for the WS upgrade — mint immediately before
// connecting, never cached or reused across sessions.
export async function mintTerminalSession(serviceId: string): Promise<TerminalSession> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/terminal/session`, {
    method: "POST",
    credentials: "include",
  });
  const data = await handleJson<{ ok: true } & TerminalSession>(res);
  return { wsTicket: data.wsTicket, wsPath: data.wsPath };
}
