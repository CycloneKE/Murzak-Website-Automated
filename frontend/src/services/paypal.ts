
export async function getPayPalConfig() {
  const res = await fetch("/api/paypal/config", {
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load PayPal config.");
  return data;
}

export async function createPayPalOrder(invoiceDocName: string) {
  const res = await fetch("/api/paypal/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ invoiceDocName }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to create PayPal order.");
  return data.orderID;
}

export async function capturePayPalOrder(invoiceDocName: string, orderID: string) {
  const res = await fetch("/api/paypal/capture-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ invoiceDocName, orderID }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to capture PayPal order.");
  return data;
}
