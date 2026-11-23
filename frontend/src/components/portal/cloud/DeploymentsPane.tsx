import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { fetchDeploymentLog, type DeploymentEntry } from "../../../services/serviceActivity";
import { toUserMessage } from "../../../services/errors";
import { Empty, PButton, Panel, StatusPill, inputClass } from "../ui";
import LogViewer from "../LogViewer";

interface Props {
  serviceId: string;
  deployments: DeploymentEntry[];
  isActive: boolean;
  redeploying: boolean;
  redeployNote: string;
  onRedeploy: () => void;
}

/** How often the open log refreshes while its build is still running. */
const POLL_MS = 4000;

export function timeAgo(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w}w ago`;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "1m 09s" style duration between two timestamps, or "" when either is missing. */
export function durationLabel(start: string | undefined | null, end: string | undefined | null): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const total = Math.round((b - a) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

const tone = (d: DeploymentEntry) => (d.result === "success" ? "ok" : d.result === "failure" ? "bad" : "progress");
const stateLabel = (d: DeploymentEntry) =>
  d.result === "success" ? "Finished" : d.result === "failure" ? "Failed" : "In progress";

/**
 * Update history on the left, the selected build's log on the right. Picking a
 * build never leaves the page; a build that is still running refreshes itself.
 */
const DeploymentsPane: React.FC<Props> = ({ serviceId, deployments, isActive, redeploying, redeployNote, onRedeploy }) => {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Default to the newest build; fall back if the picked one drops off the list.
  const base = useMemo(
    () => deployments.find((d) => d.uuid === picked) || deployments[0] || null,
    [deployments, picked],
  );
  const selectedUuid = base?.uuid || "";
  // The polled response is fresher than the list: it is what flips a running
  // build to Finished or Failed without a page reload.
  const [live, setLive] = useState<DeploymentEntry | null>(null);
  const selected = base && live && live.uuid === base.uuid ? { ...base, ...live } : base;
  const selectedPending = selected?.result === "pending";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deployments;
    return deployments.filter((d) =>
      [d.commit, d.commitMessage, d.status, d.uuid].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [deployments, query]);

  useEffect(() => {
    if (!selectedUuid) {
      setLogs("");
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async (first: boolean) => {
      if (first) {
        setLoading(true);
        setError("");
        setLogs("");
      }
      try {
        const r = await fetchDeploymentLog(serviceId, selectedUuid);
        if (cancelled) return;
        setLogs(r.logs || "");
        setError("");
        if (r.deployment) setLive(r.deployment);
        if (r.deployment?.result === "pending") timer = window.setTimeout(() => load(false), POLL_MS);
      } catch (e: any) {
        if (cancelled) return;
        setError(toUserMessage(e, "Couldn't load this log."));
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    };
    load(true);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [serviceId, selectedUuid]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      <Panel
        title="Deployment history"
        flush
        actions={
          <PButton variant="primary" size="sm" loading={redeploying} disabled={!isActive} onClick={onRedeploy}>
            {redeploying ? "Starting…" : "Update now"}
          </PButton>
        }
      >
        <div className="px-4 py-3 border-b border-p-border">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-p-muted pointer-events-none" />
            <input
              type="search"
              aria-label="Search deployments"
              placeholder="Search deployments"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        {redeployNote && <p role="status" className="px-4 pt-3 text-[13px] text-p-accent-text">{redeployNote}</p>}
        {deployments.length === 0 ? (
          <Empty title="No updates recorded yet" description="The first build will appear here." />
        ) : filtered.length === 0 ? (
          <Empty title="No matches" description="No deployment matches that search." />
        ) : (
          <ul className="divide-y divide-p-border max-h-[32rem] overflow-y-auto" aria-label="Deployments">
            {filtered.map((row) => {
              const d = live && live.uuid === row.uuid ? { ...row, ...live } : row;
              const active = d.uuid === selectedUuid;
              const took = durationLabel(d.createdAt, d.finishedAt);
              return (
                <li key={d.uuid}>
                  <button
                    type="button"
                    onClick={() => setPicked(d.uuid)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Open log for ${d.commit || d.uuid.slice(0, 8)}`}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                      active ? "bg-p-accent-soft" : "hover:bg-p-panel-2"
                    }`}
                  >
                    <div className="min-w-0 grow">
                      <p className="text-sm font-mono font-medium text-p-text truncate">
                        {d.commit || d.uuid.slice(0, 8)}
                        {d.commitMessage && <span className="font-sans font-normal text-p-muted"> {d.commitMessage}</span>}
                      </p>
                      <p className="mt-0.5 text-[13px] text-p-muted truncate">
                        {[took, d.createdAt ? timeAgo(d.createdAt) : ""].filter(Boolean).join(" · ") || d.status}
                      </p>
                    </div>
                    <StatusPill tone={tone(d)} className="shrink-0">{stateLabel(d)}</StatusPill>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title={selected ? `Build log: ${selected.commit || selected.uuid.slice(0, 12)}` : "Build log"}
        description={selected ? [selected.status, selected.createdAt ? timeAgo(selected.createdAt) : ""].filter(Boolean).join(" · ") : undefined}
        actions={selected ? <StatusPill tone={tone(selected)}>{stateLabel(selected)}</StatusPill> : undefined}
      >
        {!selected ? (
          <Empty title="Nothing to show yet" description="Start an update and its build log will stream in here." />
        ) : (
          <>
            {error && <p role="alert" className="mb-3 text-[13px] text-p-danger">{error}</p>}
            <LogViewer
              logs={logs}
              loading={loading && !logs}
              empty="No log was recorded for this deployment."
              filename={`deployment-${selected.uuid.slice(0, 12)}`}
              follow={selectedPending}
              heightClass="max-h-[28rem]"
            />
          </>
        )}
      </Panel>
    </div>
  );
};

export default DeploymentsPane;
