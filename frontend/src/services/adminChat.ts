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
  modified?: string;
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

export async function adminApproveTerminalAccess(webAccount: string): Promise<{ approvedAt: string; approvedBy: string }> {
  const res = await fetch(`/api/admin/web-accounts/${encodeURIComponent(webAccount)}/terminal-access/approve`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to approve developer access.");
  return data;
}
