
export async function deleteService(serviceId: string, confirmText?: string) {
  const res = await fetch(`/api/account/services/${encodeURIComponent(serviceId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ confirmText: confirmText || "" }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err: any = new Error(data?.error || "Failed to delete service.");
    err.status = res.status;
    err.requiresConfirm = !!data?.requiresConfirm;
    throw err;
  }

  return data;
}
