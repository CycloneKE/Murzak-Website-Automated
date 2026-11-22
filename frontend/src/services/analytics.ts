import { toUserMessage } from "./errors";

export type AnalyticsRange = "24h" | "7d" | "30d";

export interface BreakdownRow {
  name: string;
  requests: number;
  bytes: number;
}

export interface PathRow {
  path: string;
  host: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  errorRate: number;
  bytes: number;
  p95Ms: number;
}

export interface TimelinePoint {
  t: string;
  requests: number;
  visitors: number;
  bytes: number;
  errorRate: number;
  p95Ms: number;
}

export interface TrafficAnalytics {
  range: AnalyticsRange;
  from: string;
  to: string;
  /** The access log doesn't reach back to the start of the range. */
  partial: boolean;
  totals: { requests: number; uniqueVisitors: number; bandwidthBytes: number; errorRate: number; p95Ms: number };
  timeline: TimelinePoint[];
  statusClasses: { "2xx": number; "3xx": number; "4xx": number; "5xx": number; other: number };
  statusCodes: BreakdownRow[];
  topPaths: PathRow[];
  devices: BreakdownRow[];
  browsers: BreakdownRow[];
  operatingSystems: BreakdownRow[];
  /** Named AI crawlers and assistants (GPTBot, ClaudeBot, ...). */
  aiAgents: BreakdownRow[];
  /** Full user-agent strings, most common first. Visitor-supplied: show as plain text only. */
  userAgents: BreakdownRow[];
  referrers: BreakdownRow[];
  httpVersions: BreakdownRow[];
  cacheStatuses: BreakdownRow[];
  countries: BreakdownRow[];
}

/** Why there is nothing to show: set-up is missing, not "zero traffic". */
export type AnalyticsUnavailableReason = "not_configured" | "no_domains" | "source_unavailable";

export type AnalyticsResult =
  | { available: true; data: TrafficAnalytics }
  | { available: false; reason: AnalyticsUnavailableReason };

export async function fetchTrafficAnalytics(serviceId: string, range: AnalyticsRange): Promise<AnalyticsResult> {
  const res = await fetch(
    `/api/portal/services/${encodeURIComponent(serviceId)}/analytics?range=${encodeURIComponent(range)}`,
    { credentials: "include" },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(toUserMessage((body as any)?.error, "Couldn't load analytics."));
  if (!(body as any).available) {
    return { available: false, reason: ((body as any).reason as AnalyticsUnavailableReason) || "not_configured" };
  }
  // Newer panels default to empty so an older backend still renders.
  const data = body as TrafficAnalytics;
  return {
    available: true,
    data: {
      ...data,
      operatingSystems: data.operatingSystems ?? [],
      aiAgents: data.aiAgents ?? [],
      userAgents: data.userAgents ?? [],
    },
  };
}

/* ---------- display formatting (pure) ---------- */

/** 1460 -> "1.46K", 2300000 -> "2.3M". Small numbers stay exact. */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const [size, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const v = n / size;
  // Three significant digits, trailing zeros dropped.
  return `${Number((v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)))}${suffix}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`;
}

/** 0.0581 -> "5.81%"; whole numbers lose the decimals ("0%"). */
export function formatPercent(fraction: number): string {
  const p = (fraction || 0) * 100;
  return `${Number.isInteger(p) ? p : p.toFixed(p >= 10 ? 1 : 2)}%`;
}

/** 69.3 -> "69.3 ms"; 2300 -> "2.3 s". */
export function formatLatency(ms: number): string {
  if (!ms) return "0 ms";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}
