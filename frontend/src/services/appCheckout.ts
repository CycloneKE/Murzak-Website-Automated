import { AppId, planForService } from "../config/serviceCatalog";
import { toUserMessage } from "./errors";

export interface AddressCheck {
  slug: string;
  available: boolean;
  reason?: "too_short" | "too_long" | "invalid" | "reserved" | "taken";
  suggestions: string[];
}

export class AppOrderError extends Error {
  code: string;
  suggestions: string[];
  constructor(message: string, code: string, suggestions: string[] = []) {
    super(message);
    this.code = code;
    this.suggestions = suggestions;
  }
}

export async function checkShopAddress(app: AppId, name: string): Promise<AddressCheck> {
  const res = await fetch(`/api/apps/${app}/address?name=${encodeURIComponent(name)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage(data?.error, "Couldn't check that address right now."));
  return { slug: data.slug, available: !!data.available, reason: data.reason, suggestions: data.suggestions || [] };
}

export async function createAppOrder(args: {
  serviceId: string;
  term: "monthly" | "annual";
  shopName: string;
  slug: string;
}): Promise<{ orderId: string }> {
  const res = await fetch("/api/orders", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: args.serviceId,
      billingTerm: args.term,
      planKey: planForService(args.serviceId) || "Business",
      source: "app-checkout",
      config: { shopName: args.shopName, slug: args.slug },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppOrderError(
      toUserMessage(data?.error, "We couldn't start your order. Please try again."),
      data?.code || String(res.status),
      data?.suggestions || []
    );
  }
  return { orderId: data.order.id };
}
