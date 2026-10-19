import { toUserMessage } from "./errors";

// Shapes mirror backend/services/apps/shopSetup.js, which owns the catalogue
// of business types and what each one switches on.

export interface SetupOption {
  id: string;
  label: string;
  help: string;
  default?: boolean;
  needsStation?: boolean;
}
export interface SetupStyle {
  id: string;
  label: string;
  blurb: string;
  defaults: Record<string, boolean>;
}
export interface SetupPack {
  id: string;
  label: string;
  blurb: string;
  kind: string;
  styles: SetupStyle[];
  defaultStyle?: string;
  options: SetupOption[];
  includes: string[];
}
export interface SetupAnswers {
  pack: string;
  style?: string;
  options: Record<string, boolean>;
  branches?: number;
  staff?: number;
}
export interface SetupState {
  state: "saved" | "skipped" | "applying" | "applied" | "failed";
  skipped: boolean;
  answers: SetupAnswers | null;
  summary: string[];
  /** Things the shop already had and we left alone. */
  notes: string[];
  savedAt: string | null;
  appliedAt: string | null;
}
export interface SetupCatalogue {
  packs: SetupPack[];
  maxBranches: number;
  maxStaff: number;
  setup: SetupState | null;
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((data as any)?.error, "Request failed."));
  return data as T;
}

export async function fetchShopSetup(orderId: string): Promise<SetupCatalogue> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/shop-setup`, { credentials: "include" });
  return json<SetupCatalogue>(res);
}

export async function saveShopSetup(orderId: string, body: { answers: SetupAnswers } | { skip: true }): Promise<SetupState> {
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/shop-setup`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await json<{ setup: SetupState }>(res)).setup;
}

export interface ProgressStep {
  id: string;
  label: string;
  help: string;
  optional: boolean;
  done: boolean;
}
export interface ShopProgress {
  checked: boolean;
  checkedAt: string | null;
  steps: ProgressStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  nextStepId: string | null;
}

/** null when the service is not an app shop or has no paid order yet. */
export async function fetchShopProgress(serviceId: string): Promise<ShopProgress | null> {
  const res = await fetch(`/api/portal/services/${encodeURIComponent(serviceId)}/shop-progress`, { credentials: "include" });
  return (await json<{ progress: ShopProgress | null }>(res)).progress;
}
