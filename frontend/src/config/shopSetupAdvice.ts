import { getService, servicesForApp } from "./serviceCatalog";

// Plan limits are soft in v1 (see appLimits in serviceCatalog.ts), so this only
// informs: it never blocks the owner and never changes their plan.

export interface PlanAdvice {
  /** Plain sentence for the owner, or "" when their plan covers the answers. */
  message: string;
  /** The smallest tier that covers the answers, when the current one does not. */
  suggestedPlan: string | null;
}

const NONE: PlanAdvice = { message: "", suggestedPlan: null };

const fits = (limit: number | null | undefined, wanted: number | undefined) =>
  limit == null || wanted == null || wanted <= limit;

export function adviseOnPlan(serviceId: string, branches?: number, staff?: number): PlanAdvice {
  const current = getService(serviceId)?.appLimits;
  if (!current) return NONE;
  if (fits(current.branches, branches) && fits(current.users, staff)) return NONE;

  const tiers = servicesForApp("pos")
    .filter((t) => t.appLimits)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const better = tiers.find((t) => fits(t.appLimits!.branches, branches) && fits(t.appLimits!.users, staff));
  const name = getService(serviceId)?.appPlan || "Your plan";
  const allowed = [
    current.branches != null ? `${current.branches} ${current.branches === 1 ? "branch" : "branches"}` : "",
    current.users != null ? `${current.users} staff logins` : "",
  ].filter(Boolean).join(" and ");

  return {
    message:
      `${name} includes ${allowed}. You can still carry on today; when you are ready, ` +
      (better ? `${better.appPlan} fits what you described.` : "contact us and we will find the right plan."),
    suggestedPlan: better?.appPlan || null,
  };
}
