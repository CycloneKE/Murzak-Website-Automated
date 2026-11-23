import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import {
  compactNumber, fetchTrafficAnalytics, formatBytes, formatLatency, formatPercent,
  type AnalyticsRange, type AnalyticsResult, type AnalyticsUnavailableReason, type BreakdownRow, type PathRow,
  type TrafficAnalytics,
} from "../../../services/analytics";
import { toUserMessage } from "../../../services/errors";
import { Banner, DataTable, Empty, PButton, Panel, type Column } from "../ui";
import { AreaChart, Donut, SERIES, Sparkline } from "./analytics/charts";

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const UNAVAILABLE: Record<AnalyticsUnavailableReason, { title: string; body: string }> = {
  not_configured: {
    title: "Traffic analytics aren't switched on yet",
    body: "Analytics come from the web proxy's access log, which isn't connected for this platform yet. Message support and we'll turn it on; your site isn't affected.",
  },
  no_domains: {
    title: "Add a domain to see traffic",
    body: "Analytics are shown per domain. Once this service has a domain attached, its visits will appear here.",
  },
  source_unavailable: {
    title: "Traffic data is temporarily unavailable",
    body: "We couldn't read the access log just now. Try again in a minute; if it keeps happening, message support.",
  },
};

function bucketLabel(iso: string, range: AnalyticsRange): string {
  const d = new Date(iso);
  if (range === "24h") return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A labelled stat with the trend underneath. */
const Tile: React.FC<{ label: string; value: string; color: string; trend: number[] }> = ({ label, value, color, trend }) => (
  <div className="rounded-md border border-p-border bg-p-panel-2 px-4 py-3 min-w-0">
    <p className="text-[11px] font-medium uppercase tracking-wide text-p-muted">{label}</p>
    <p className="mt-1 text-xl font-semibold text-p-text tabular-nums whitespace-nowrap">{value}</p>
    <div className="mt-2"><Sparkline values={trend} color={color} /></div>
  </div>
);

/** Name / share-bar / requests / bandwidth, the shape every ranked list here shares. */
const Breakdown: React.FC<{ rows: BreakdownRow[]; nameHeader?: string; emptyTitle: string; emptyBody: string; wide?: boolean }> = ({
  rows, nameHeader = "Name", emptyTitle, emptyBody, wide,
}) => {
  if (!rows.length) return <Empty icon={<BarChart3 />} title={emptyTitle} description={emptyBody} />;
  const max = Math.max(...rows.map((r) => r.requests), 1);
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-sm" data-p="table">
      <thead>
        <tr className="text-left text-xs text-p-muted">
          <th scope="col" className="font-medium px-4 sm:px-5 py-2.5 border-b border-p-border">{nameHeader}</th>
          <th scope="col" className="hidden sm:table-cell border-b border-p-border w-1/4"><span className="sr-only">Share</span></th>
          <th scope="col" className="font-medium px-3 py-2.5 border-b border-p-border text-right">Requests</th>
          <th scope="col" className="font-medium px-4 sm:px-5 py-2.5 border-b border-p-border text-right">Bandwidth</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 10).map((r) => (
          <tr key={r.name} className="border-b border-p-border last:border-b-0">
            <td className={wide ? "px-4 sm:px-5 py-2.5 text-p-text break-words min-w-[12rem]" : "px-4 sm:px-5 py-2.5 text-p-text truncate max-w-[14rem]"} title={wide ? undefined : r.name}>{r.name}</td>
            <td className="hidden sm:table-cell pr-2">
              <div className="h-1.5 rounded-full bg-p-panel-2" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.requests / max) * 100)}%`, background: SERIES.blue }} />
              </div>
            </td>
            <td className="px-3 py-2.5 text-right font-medium text-p-text tabular-nums">{compactNumber(r.requests)}</td>
            <td className="px-4 sm:px-5 py-2.5 text-right text-p-muted tabular-nums">{formatBytes(r.bytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
};

const pathColumns: Column<PathRow>[] = [
  {
    key: "path", header: "Path", primary: true, className: "w-[38%]",
    cell: (r) => <span className="font-mono text-[13px]">{r.path}<span className="ml-2 font-sans text-xs text-p-muted">{r.host}</span></span>,
  },
  { key: "requests", header: "Requests", align: "right", cell: (r) => <span className="tabular-nums text-p-text font-medium">{compactNumber(r.requests)}</span> },
  { key: "4xx", header: "4xx", align: "right", cell: (r) => <span className={`tabular-nums ${r.clientErrors ? "text-p-danger" : ""}`}>{r.clientErrors}</span> },
  { key: "5xx", header: "5xx", align: "right", cell: (r) => <span className={`tabular-nums ${r.serverErrors ? "text-p-danger" : ""}`}>{r.serverErrors}</span> },
  { key: "err", header: "Error %", align: "right", cell: (r) => <span className="tabular-nums">{formatPercent(r.errorRate)}</span> },
  { key: "bw", header: "Bandwidth", align: "right", cell: (r) => <span className="tabular-nums">{formatBytes(r.bytes)}</span> },
  { key: "p95", header: "p95", align: "right", cell: (r) => <span className="tabular-nums">{formatLatency(r.p95Ms)}</span> },
];

const DEVICE_COLORS: Record<string, string> = {
  Desktop: SERIES.blue, Mobile: SERIES.amber, Bot: SERIES.red, Misc: SERIES.violet,
};

const Dashboard: React.FC<{ data: TrafficAnalytics }> = ({ data }) => {
  const t = data.totals;
  const tl = data.timeline;
  const labels = useMemo(() => {
    // Label roughly every fourth bucket so the axis stays readable.
    const every = Math.max(1, Math.ceil(tl.length / 7));
    return tl.map((p, i) => (i % every === 0 ? bucketLabel(p.t, data.range) : ""));
  }, [tl, data.range]);
  const sc = data.statusClasses;
  const scTotal = sc["2xx"] + sc["3xx"] + sc["4xx"] + sc["5xx"] + sc.other;
  const seg = (n: number) => (scTotal ? (n / scTotal) * 100 : 0);

  return (
    <div className="space-y-5">
      {data.partial && (
        <Banner tone="info">The access log only goes back part of this range, so the numbers below cover less than the full period.</Banner>
      )}

      <Panel flush>
        <div className="grid gap-3 p-4 sm:p-5 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <Tile label="Requests" value={compactNumber(t.requests)} color={SERIES.blue} trend={tl.map((p) => p.requests)} />
          <Tile label="Unique visitors" value={compactNumber(t.uniqueVisitors)} color={SERIES.green} trend={tl.map((p) => p.visitors)} />
          <Tile label="Bandwidth" value={formatBytes(t.bandwidthBytes)} color={SERIES.violet} trend={tl.map((p) => p.bytes)} />
          <Tile label="Error rate" value={formatPercent(t.errorRate)} color={SERIES.red} trend={tl.map((p) => p.errorRate)} />
          <Tile label="p95 latency" value={formatLatency(t.p95Ms)} color={SERIES.amber} trend={tl.map((p) => p.p95Ms)} />
        </div>
      </Panel>

      <Panel title="Requests">
        <AreaChart
          points={tl.map((p) => ({ label: bucketLabel(p.t, data.range), value: p.requests }))}
          xLabels={labels}
          color={SERIES.blue}
          ariaLabel={`Requests over time. ${compactNumber(t.requests)} in total for the selected period.`}
        />
      </Panel>

      <Panel title="Status codes">
        {scTotal === 0 ? (
          <p className="text-[13px] text-p-muted">No requests in this period.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-p-muted mb-3">
              {([["2xx", SERIES.blue], ["3xx", SERIES.amber], ["4xx", SERIES.red], ["5xx", SERIES.violet]] as const).map(([k, c]) => (
                <li key={k} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} aria-hidden />
                  {k} <span className="font-medium text-p-text tabular-nums">{compactNumber(sc[k])}</span>
                </li>
              ))}
            </ul>
            <div className="flex h-3 rounded-full overflow-hidden bg-p-panel-2" role="img"
              aria-label={`Status classes: ${sc["2xx"]} successful, ${sc["3xx"]} redirects, ${sc["4xx"]} client errors, ${sc["5xx"]} server errors`}>
              <div style={{ width: `${seg(sc["2xx"])}%`, background: SERIES.blue }} />
              <div style={{ width: `${seg(sc["3xx"])}%`, background: SERIES.amber }} />
              <div style={{ width: `${seg(sc["4xx"])}%`, background: SERIES.red }} />
              <div style={{ width: `${seg(sc["5xx"])}%`, background: SERIES.violet }} />
            </div>
          </>
        )}
      </Panel>

      <Panel title="Top paths" flush>
        <DataTable
          columns={pathColumns}
          rows={data.topPaths.slice(0, 10)}
          rowKey={(r) => `${r.host}${r.path}`}
          empty={<Empty icon={<BarChart3 />} title="No requests yet" description="The busiest pages will be listed here." />}
        />
      </Panel>

      <Panel title="Locations" flush>
        <Breakdown
          rows={data.countries}
          nameHeader="Country"
          emptyTitle="Location data isn't enabled"
          emptyBody="Where visitors are from needs a GeoIP database, which isn't connected yet."
        />
        {data.countries.length > 0 && (
          <p className="px-4 sm:px-5 py-2 text-xs text-p-muted border-t border-p-border">
            This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com
          </p>
        )}
      </Panel>

      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-2">
        <Panel title="Requests by device type">
          {data.devices.length ? (
            <Donut
              ariaLabel="Requests by device type"
              slices={data.devices.map((d) => ({ name: d.name, value: d.requests, color: DEVICE_COLORS[d.name] || SERIES.grey }))}
            />
          ) : (
            <Empty icon={<BarChart3 />} title="No data" description="Device types need the proxy to log the visitor's browser, which isn't switched on yet." />
          )}
        </Panel>
        <Panel title="Top HTTP versions" flush>
          <Breakdown rows={data.httpVersions} emptyTitle="No data" emptyBody="No HTTP version data for the selected range." />
        </Panel>
        <Panel title="Top cache statuses" flush>
          <Breakdown rows={data.cacheStatuses} emptyTitle="No data" emptyBody="No cache status data for the selected range." />
        </Panel>
        <Panel title="Top status codes" flush>
          <Breakdown rows={data.statusCodes} emptyTitle="No data" emptyBody="No status codes for the selected range." />
        </Panel>
        <Panel title="Referrers" flush>
          <Breakdown rows={data.referrers} emptyTitle="No data" emptyBody="No referrer data for the selected range." />
        </Panel>
        <Panel title="Browsers" flush>
          <Breakdown rows={data.browsers} emptyTitle="No data" emptyBody="No browser data for the selected range." />
        </Panel>
        <Panel title="Operating systems" flush>
          <Breakdown rows={data.operatingSystems} emptyTitle="No data" emptyBody="No operating system data for the selected range." />
        </Panel>
        <Panel title="AI agents & bots" description="Named AI crawlers and assistants that visited your site." flush>
          <Breakdown rows={data.aiAgents} emptyTitle="No AI agents seen" emptyBody="No known AI crawlers visited in the selected range." />
        </Panel>
      </div>

      <Panel title="Top user agents" flush>
        <Breakdown rows={data.userAgents} wide emptyTitle="No data" emptyBody="No user agent data for the selected range." />
      </Panel>
    </div>
  );
};

/** Traffic for a service's own domains: how many visits, how fast, and what went wrong. */
const AnalyticsPanel: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await fetchTrafficAnalytics(serviceId, range));
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't load analytics."));
    } finally {
      setLoading(false);
    }
  }, [serviceId, range]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <Panel
        title="Analytics"
        description="Visits to your domains, from the web proxy's access log."
        actions={
          <>
            <select
              aria-label="Time range"
              value={range}
              onChange={(e) => setRange(e.target.value as AnalyticsRange)}
              className="p-tap rounded-md border border-p-border bg-p-panel px-2 text-sm text-p-text"
            >
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <PButton size="sm" icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />} onClick={load} disabled={loading}>
              Refresh
            </PButton>
          </>
        }
      />
      {error && <p role="alert" className="text-[13px] text-p-danger">{error}</p>}
      {loading && !result ? (
        <Panel><p className="text-sm text-p-muted">Loading analytics…</p></Panel>
      ) : result && result.available === false ? (
        <Panel><Empty icon={<BarChart3 />} title={UNAVAILABLE[result.reason].title} description={UNAVAILABLE[result.reason].body} /></Panel>
      ) : result && result.available === true ? (
        <Dashboard data={result.data} />
      ) : null}
    </div>
  );
};

export default AnalyticsPanel;
