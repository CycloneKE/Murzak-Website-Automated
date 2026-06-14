const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

export async function deleteInvoice(invoiceId: string) {
  const res = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to delete invoice.");
  return data as { ok: true; deleted: string };
}
