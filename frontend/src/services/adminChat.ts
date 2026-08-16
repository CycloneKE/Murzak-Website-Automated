// src/services/adminChat.ts
export type SenderType = "User" | "Admin";

export type ChatMessage = {
  sender_type: SenderType;
  sender: string;
  message: string;
  sent_at?: string;
  creation?: string;
  attachments?: string;
};

export type ThreadSummary = {
  name: string;
  email?: string;
  full_name?: string;
  company_name?: string;
  status?: string;
  last_message_at?: string;
  last_admin_seen_at?: string;
  modified?: string;
  /** Server-computed: this thread is waiting on staff and has unread messages. */
  unread?: boolean;
  // Present on the single-thread GET (unprojected Frappe doc); absent from
  // the list endpoint's projected fields. Optional here so both call sites
  // type-check.
  subject?: string;
  portal_user?: string;
};

export type ThreadDoc = ThreadSummary & {
  messages?: ChatMessage[];
};

async function safeJson(res: Response) {
  return res.json().catch(() => ({}));
}

export async function adminListThreads(): Promise<ThreadSummary[]> {
  const res = await fetch("/api/admin/threads", { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to load threads.");
  return data?.data || [];
}

/** Count of threads waiting on staff with messages nobody has read yet. */
export async function adminUnreadCount(): Promise<number> {
  const res = await fetch("/api/admin/threads/unread-count", { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch unread count.");
  return Number(data?.count || 0);
}

/** Stamps last_admin_seen_at so this thread stops counting toward the badge. */
export async function adminMarkRead(threadId: string): Promise<void> {
  const res = await fetch(`/api/admin/threads/${encodeURIComponent(threadId)}/mark-read`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await safeJson(res);
    throw new Error(data?.error || "Failed to mark thread read.");
  }
}

export async function adminGetThread(id: string): Promise<ThreadDoc> {
  const res = await fetch(`/api/admin/threads/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to load thread.");
  const doc = data?.data || null;
  if (doc && !Array.isArray(doc.messages)) doc.messages = [];
  return doc;
}

export async function adminReply(threadId: string, message: string, attachments?: string) {
  const res = await fetch(`/api/admin/threads/${encodeURIComponent(threadId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      message,
      attachments: attachments || "",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to reply");
  return data;
}

// --- DOMAIN FULFILMENT QUEUE ---

export type DomainStatus = "pending" | "active" | "failed" | "expired" | "cancelled";

export type AdminDomain = {
  id: string;
  webAccount: string;
  domainName: string;
  kind: "registered" | "external" | "murzak_subdomain";
  status: DomainStatus;
  registrar: string;
  sslStatus: "none" | "pending" | "active";
  expiresOn: string | null;
  attachedToService: string | null;
  sourceDoctype: string;
  sourceName: string;
  notes: string;
  createdAt?: string;
};

export type AdminDomainsResponse = {
  domains: AdminDomain[];
  summary: Record<DomainStatus, number>;
  actionableCount: number;
};

export async function adminListDomains(): Promise<AdminDomainsResponse> {
  const res = await fetch("/api/admin/domains", { credentials: "include" });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to load domains.");
  return {
    domains: data?.domains || [],
    summary: data?.summary || {},
    actionableCount: Number(data?.actionableCount || 0),
  };
}

/** Record the outcome of a manual fulfilment; also syncs the source intake. */
export async function adminSetDomainStatus(
  domainId: string,
  status: DomainStatus,
  extra?: { registrar?: string; expiresOn?: string | null; notes?: string }
): Promise<{ status: DomainStatus; intakeSynced: boolean }> {
  const res = await fetch(`/api/admin/domains/${encodeURIComponent(domainId)}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status, ...(extra || {}) }),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to update domain.");
  return { status: data.status, intakeSynced: !!data.intakeSynced };
}

export async function adminApproveTerminalAccess(webAccount: string): Promise<{ approvedAt: string; approvedBy: string }> {
  const res = await fetch(`/api/admin/web-accounts/${encodeURIComponent(webAccount)}/terminal-access/approve`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to approve developer access.");
  return data;
}
