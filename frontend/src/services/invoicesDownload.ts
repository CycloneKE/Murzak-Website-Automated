const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || "";

async function downloadBlob(url: string, filename: string) {
  const res = await fetch(`${API_BASE}${url}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Download failed.");
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(objectUrl);
}

export function downloadInvoicePdf(invoiceNo: string) {
  return downloadBlob(`/api/invoices/${encodeURIComponent(invoiceNo)}/download`, `${invoiceNo}.pdf`);
}

export function downloadAllInvoicesZip() {
  // filename will come from Content-Disposition; browser typically uses it.
  // We can still provide a fallback:
  return downloadBlob(`/api/invoices/download-all`, `invoices.zip`);
}
