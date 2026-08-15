import { type PlanCode } from "../../config/serviceCatalog";

export function normalizePlanToCode(plan: string | undefined | null): PlanCode {
  const p = (plan || "None").toLowerCase();
  if (p.includes("test")) return "Test";
  if (p.includes("starter")) return "Starter";
  if (p.includes("business")) return "Business";
  if (p.includes("enterprise")) return "Enterprise";
  // fall back
  return "Starter";
}

// allowedAddonTiers lived here: it restricted which service tiers a plan could
// add on ("Starter may only add Light"). Plans are support tiers now, not
// catalogues, so nothing gates the catalogue by plan — see PLAN_SLA in
// config/serviceCatalog.ts.

// Maps a backend ProjectUpdate onto the Activity Hub's icon/color category.
// The backend's own classification (milestone/technical/alert) is the base
// signal — content keywords only refine it for the payment/support cases the
// backend vocabulary doesn't distinguish.
export function classifyActivity(u: { content: string; type?: string }): "payment" | "system" | "support" | "account" {
  const content = u.content.toLowerCase();
  if (content.includes("payment") || content.includes("invoice") || content.includes("paid")) return "payment";
  if (content.includes("support") || content.includes("ticket")) return "support";
  if (u.type === "milestone") return "account";
  return "system"; // technical, alert, and anything unrecognized reads as infra activity
}
