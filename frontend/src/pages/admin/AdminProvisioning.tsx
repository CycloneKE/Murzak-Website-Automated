import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshCw, Play, RotateCcw, CheckCircle2, XCircle, AlertCircle,
  Server, Database, Activity, ShieldCheck, Terminal, X,
} from "lucide-react";
import {
  getReadiness, getQueueHealth, getCapacity, listJobs, runQueue, retryJob, resolveJob,
  Readiness, QueueHealth, Capacity, ProvisioningJob,
} from "../../services/adminProvisioning";
import { toUserMessage } from "../../services/errors";

const JOB_STATUSES = ["all", "queued", "running", "active", "needs_human", "failed"] as const;

function jobStatusClasses(s?: string) {
  switch ((s || "").toLowerCase()) {
    case "active": return "bg-p-success-soft text-p-success border-p-success/40";
    case "running": return "bg-p-warning-soft text-p-warning border-p-warning/40";
    case "queued": return "bg-p-info-soft text-p-info border-p-info/40";
    case "failed": return "bg-p-danger-soft text-p-danger border-p-danger/40";
    case "needs_human": return "bg-p-warning-soft text-p-warning border-p-warning/40";
    default: return "bg-slate-500/10 text-p-muted border-p-border";
  }
}

function Dot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-4 h-4 text-p-success shrink-0" />
    : <XCircle className="w-4 h-4 text-p-danger shrink-0" />;
}

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-p-panel border border-p-border rounded-lg sm:rounded-lg overflow-hidden ${className}`}>
    {children}
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-semibold text-p-muted ">{children}</p>
);

const AdminProvisioning: React.FC = () => {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [queue, setQueue] = useState<QueueHealth | null>(null);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [jobs, setJobs] = useState<ProvisioningJob[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [retryingId, setRetryingId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  const [resolveModalJob, setResolveModalJob] = useState<string>("");
  const [resolveRef, setResolveRef] = useState<string>("");
  const [resolveAccess, setResolveAccess] = useState<string>("");
  const [resolving, setResolving] = useState<boolean>(false);

  const [consoleJob, setConsoleJob] = useState<ProvisioningJob | null>(null);

  const refresh = useCallback(async (status = statusFilter) => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      getReadiness(),
      getQueueHealth(),
      getCapacity(),
      listJobs(status === "all" ? undefined : status),
    ]);
    const [r, q, c, j] = results;
    if (r.status === "fulfilled") setReadiness(r.value);
    if (q.status === "fulfilled") setQueue(q.value);
    if (c.status === "fulfilled") setCapacity(c.value);
    if (j.status === "fulfilled") setJobs(j.value.data || []);
    const firstErr = results.find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstErr) setError(firstErr.reason?.message || "Failed to load some data.");
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { void refresh(statusFilter); /* eslint-disable-next-line */ }, [statusFilter]);

  const onRun = async () => {
    setRunning(true); setError(""); setNotice("");
    try {
      const r = await runQueue();
      setNotice(`Runner pass complete — processed ${r.processed} job(s).`);
      await refresh();
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to run queue."));
    } finally { setRunning(false); }
  };

  const onRetry = async (name: string) => {
    setRetryingId(name); setError(""); setNotice("");
    try {
      await retryJob(name);
      setNotice(`Re-queued ${name}.`);
      await refresh();
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to re-queue job."));
    } finally { setRetryingId(""); }
  };

  const onResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResolving(true); setError(""); setNotice("");
    try {
      let accessObj = {};
      if (resolveAccess.trim()) {
        try { accessObj = JSON.parse(resolveAccess); }
        catch { throw new Error("Access JSON is invalid."); }
      }
      await resolveJob(resolveModalJob, { external_ref: resolveRef, access: accessObj });
      setNotice(`Resolved ${resolveModalJob} manually.`);
      setResolveModalJob("");
      await refresh();
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to resolve job."));
    } finally { setResolving(false); }
  };

  const required = readiness?.checks.filter((c) => c.level === "required") || [];
  const conditional = readiness?.checks.filter((c) => c.level === "conditional") || [];
  const optional = readiness?.checks.filter((c) => c.level === "optional") || [];

  return (
    <div className="w-full">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-semibold ">Provisioning</h2>
          <p className="text-xs font-semibold text-p-muted mt-2">
            Go-live readiness, capacity, and the job queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} type="button"
            className="h-10 px-4 inline-flex items-center gap-2 rounded-md border border-p-border bg-p-panel-2 text-xs font-semibold hover:border-p-accent hover:bg-p-accent-soft transition">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={onRun} disabled={running} type="button"
            className="h-10 px-4 inline-flex items-center gap-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60">
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run queue now
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-p-danger">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-p-success">
          <CheckCircle2 className="w-4 h-4" /> {notice}
        </div>
      )}

      {/* Readiness */}
      <Card className="mb-6">
        <div className="p-6 border-b border-p-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-p-accent-soft text-p-accent-text"><ShieldCheck className="w-[18px] h-[18px]" /></div>
            <div>
              <Label>Go-live readiness</Label>
              <p className="text-sm font-semibold text-p-text ">
                {readiness ? (readiness.ready ? "Ready to go live" : "Not ready — see below") : "—"}
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center px-3 py-1.5 rounded-full border text-xs font-semibold ${
            readiness?.ready ? "bg-p-success-soft text-p-success border-p-success/40" : "bg-p-warning-soft text-p-warning border-p-warning/40"
          }`}>
            {readiness ? (readiness.ready ? "Ready" : "Action needed") : "…"}
          </span>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: "Required", items: required },
            { title: "Conditional", items: conditional },
            { title: "Optional", items: optional },
          ].map((grp) => (
            <div key={grp.title}>
              <Label>{grp.title}</Label>
              <ul className="mt-3 space-y-2.5">
                {grp.items.length === 0 && <li className="text-[13px] font-medium text-p-muted ">—</li>}
                {grp.items.map((c) => (
                  <li key={c.key} className="flex items-start gap-2.5">
                    <Dot ok={c.ok} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-p-text leading-tight">{c.label}</p>
                      {c.detail && <p className="text-xs font-semibold text-p-muted leading-tight mt-0.5">{c.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* Queue + Capacity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <div className="p-6 border-b border-p-border flex items-center gap-3">
            <div className="p-3 rounded-lg bg-p-accent-soft text-p-accent-text"><Activity className="w-[18px] h-[18px]" /></div>
            <div>
              <Label>Dispatcher</Label>
              <p className="text-sm font-semibold text-p-text ">mode: {queue?.mode || "—"}</p>
            </div>
          </div>
          <div className="p-6">
            {queue?.counts ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {Object.entries(queue.counts).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-p-panel-2 border border-p-border p-3 text-center">
                    <p className="text-lg font-semibold text-p-text ">{v}</p>
                    <p className="text-xs font-semibold text-p-muted mt-0.5">{k}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] font-medium text-p-muted ">
                {queue?.mode === "poll" ? "Poll mode — no queue counters (jobs are read from the doctype each pass)." : "No queue metrics."}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-6 border-b border-p-border flex items-center gap-3">
            <div className="p-3 rounded-lg bg-p-accent-soft text-p-accent-text"><Server className="w-[18px] h-[18px]" /></div>
            <div>
              <Label>Capacity (RAM per box)</Label>
              <p className="text-sm font-semibold text-p-text ">{capacity?.targets.length || 0} box(es)</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {(capacity?.targets || []).map((t) => {
              const pct = t.limitRamMb ? Math.min(100, Math.round((t.reservedRamMb / t.limitRamMb) * 100)) : 0;
              const hot = pct >= 85;
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between text-[13px] font-semibold mb-1.5">
                    <span className="text-p-text ">{t.id}{t.status !== "active" ? ` · ${t.status}` : ""}</span>
                    <span className="text-p-muted">{t.reservedRamMb} / {t.limitRamMb} MB</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-p-panel-2 overflow-hidden">
                    <div className={`h-full rounded-full ${hot ? "bg-p-warning" : "bg-p-accent"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {capacity?.requests && capacity.requests.length > 0 && (
              <div className="pt-2">
                <Label>Open scale-out requests</Label>
                <ul className="mt-2 space-y-1.5">
                  {capacity.requests.filter((r) => r.status === "pending" || r.status === "provisioning").map((r) => (
                    <li key={r.name} className="flex items-center gap-2 text-[13px] font-medium text-p-warning">
                      <Database className="w-3.5 h-3.5" /> {r.name} · {r.status} · ~{r.requested_ram_mb}MB
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Jobs */}
      <Card>
        <div className="p-6 border-b border-p-border ">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Label>Provisioning jobs</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {JOB_STATUSES.map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    statusFilter === s ? "bg-p-accent text-p-accent-fg border-p-accent/40" : "bg-p-panel-2 border-p-border text-p-muted hover:text-p-accent-text"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {jobs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-xs font-semibold text-p-muted ">No jobs for this filter.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-semibold text-p-muted border-b border-p-border ">
                  <th className="p-4">Service</th>
                  <th className="p-4">Lane / Box</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Backup / Edge</th>
                  <th className="p-4">Notes</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const canRetry = j.status === "failed" || j.status === "needs_human";
                  return (
                    <tr key={j.name} className="border-b border-slate-50 align-top">
                      <td className="p-4">
                        <p className="text-[13px] font-semibold text-p-text ">{j.service_name || j.service_id}</p>
                        <p className="text-xs font-medium text-p-muted mt-0.5">{j.web_account || "—"} · {j.ram_mb || 0}MB</p>
                      </td>
                      <td className="p-4">
                        <p className="text-[13px] font-semibold text-p-text ">{j.lane || "—"}</p>
                        <p className="text-xs font-medium text-p-muted mt-0.5">{j.target || "box-1"}</p>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold ${jobStatusClasses(j.status)}`}>
                          {j.status || "—"}{j.attempts ? ` · ${j.attempts}x` : ""}{j.gated ? " · gated" : ""}
                        </span>
                      </td>
                      <td className="p-4">
                        <p className="text-xs font-medium text-p-muted ">bk: {j.backup_status || "—"}</p>
                        <p className="text-xs font-medium text-p-muted ">edge: {j.edge_status || "—"}</p>
                      </td>
                      <td className="p-4 max-w-[260px]">
                        {j.error
                          ? <p className="text-xs font-semibold text-p-danger wrap-break-word">{j.error}</p>
                          : j.external_ref
                          ? <p className="text-xs font-semibold text-p-success wrap-break-word">{j.external_ref}</p>
                          : <span className="text-xs text-p-muted ">—</span>}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setConsoleJob(j)} type="button"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-p-border text-xs font-semibold hover:border-p-accent hover:bg-p-accent-soft transition">
                            <Terminal className="w-3.5 h-3.5" /> Console
                          </button>
                          {canRetry && (
                            <>
                              <button onClick={() => {
                                setResolveModalJob(j.name);
                                setResolveRef("");
                                setResolveAccess("");
                              }} type="button"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-p-border text-xs font-semibold hover:border-p-accent hover:bg-p-accent-soft transition">
                                Resolve Manually
                              </button>
                              <button onClick={() => onRetry(j.name)} disabled={retryingId === j.name} type="button"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-p-border text-xs font-semibold hover:border-p-accent hover:bg-p-accent-soft transition disabled:opacity-60">
                                {retryingId === j.name ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Retry
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {resolveModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-p-panel w-full max-w-lg rounded-lg p-8 shadow-2xl border border-p-border relative">
            <h3 className="text-xl font-semibold mb-1">Resolve Job Manually</h3>
            <p className="text-xs font-medium text-p-muted mb-6">Job: {resolveModalJob}</p>
            
            <form onSubmit={onResolveSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-p-muted mb-1">External Ref (e.g. UUID, IP)</label>
                <input required value={resolveRef} onChange={e => setResolveRef(e.target.value)} type="text"
                  className="w-full bg-p-panel-2 border border-p-border rounded-md px-4 py-2.5 text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-p-muted mb-1">Access Credentials (JSON)</label>
                <textarea rows={4} value={resolveAccess} onChange={e => setResolveAccess(e.target.value)} placeholder='{"manageUrl": "...", "password": "..."}'
                  className="w-full bg-p-panel-2 border border-p-border rounded-md px-4 py-2.5 text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40 font-mono text-[13px]" />
              </div>
              
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setResolveModalJob("")} className="flex-1 px-4 py-3 rounded-md border border-p-border text-xs font-semibold hover:bg-p-panel-2 transition">Cancel</button>
                <button type="submit" disabled={resolving} className="flex-1 px-4 py-3 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold hover:opacity-90 transition disabled:opacity-50">
                  {resolving ? "Resolving..." : "Mark Active"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {consoleJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-3xl max-h-[85vh] bg-[#0a0a0a] border border-p-border rounded-lg shadow-2xl overflow-hidden font-mono flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 bg-[#1a1a1a] border-b border-p-border">
              <div className="flex items-center text-gray-300 text-sm min-w-0">
                <Terminal className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">
                  {consoleJob.service_name || consoleJob.service_id} — {consoleJob.name}
                </span>
                <span className={`ml-3 shrink-0 px-2 py-0.5 rounded-sm text-xs ${jobStatusClasses(consoleJob.status)}`}>
                  {consoleJob.status || "unknown"}
                </span>
              </div>
              <button className="text-gray-500 hover:text-white transition-colors p-1 shrink-0" onClick={() => setConsoleJob(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 text-xs text-gray-300 leading-relaxed space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-gray-400">
                <span>account: <span className="text-gray-200">{consoleJob.web_account || "—"}</span></span>
                <span>lane/target: <span className="text-gray-200">{consoleJob.lane || "—"} · {consoleJob.target || "box-1"}</span></span>
                <span>attempts: <span className="text-gray-200">{consoleJob.attempts ?? 0}</span></span>
                <span>runner: <span className="text-gray-200">{consoleJob.runner_id || "—"}</span></span>
                <span>started: <span className="text-gray-200">{consoleJob.started_at || "—"}</span></span>
                <span>next run: <span className="text-gray-200">{consoleJob.next_run_at || "—"}</span></span>
              </div>

              <div>
                <p className="text-gray-500 text-xs mb-1">Runner log</p>
                {consoleJob.log ? (
                  <pre className="whitespace-pre-wrap wrap-break-word text-gray-300">{consoleJob.log}</pre>
                ) : (
                  <p className="text-gray-600">No log recorded yet — {consoleJob.status === "queued" ? "still queued." : "nothing written by the runner."}</p>
                )}
              </div>

              {consoleJob.error && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Error</p>
                  <pre className="whitespace-pre-wrap wrap-break-word text-p-warning">{consoleJob.error}</pre>
                </div>
              )}

              {consoleJob.access && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Access (shown to customer)</p>
                  {(() => {
                    // Quick links: customer URL + Coolify admin panel, parsed
                    // out of the access JSON so staff don't copy from raw text.
                    try {
                      const parsed = JSON.parse(consoleJob.access);
                      return (
                        <div className="mb-2 flex flex-wrap gap-3">
                          {parsed?.url && (
                            <a href={parsed.url} target="_blank" rel="noopener noreferrer" className="text-p-success underline underline-offset-2">
                              customer url ↗
                            </a>
                          )}
                          {parsed?.manageUrl && (
                            <a href={parsed.manageUrl} target="_blank" rel="noopener noreferrer" className="text-p-info underline underline-offset-2">
                              coolify panel ↗ (staff only)
                            </a>
                          )}
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                  <pre className="whitespace-pre-wrap wrap-break-word text-p-success">{consoleJob.access}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProvisioning;
