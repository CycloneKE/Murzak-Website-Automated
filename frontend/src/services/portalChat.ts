export async function createPortalThread(payload: any) {
  const res = await fetch("/api/portal/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to create thread");
  return data as { ok: true; id: string };
}

export async function getPortalThread(id: string) {
  const res = await fetch(`/api/portal/requests/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to load thread");
  return data as { ok: true; data: any };
}

export async function sendPortalMessage(id: string, payload: any) {
  const res = await fetch(`/api/portal/requests/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to send message");
  return data as { ok: true; id: string };
}
