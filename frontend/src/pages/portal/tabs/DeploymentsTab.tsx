import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, GitCommit, RefreshCw, Rocket } from "lucide-react";
import EmptyState from "../../../components/portal/EmptyState";
import { usePortal } from "../PortalContext";
import { fetchServiceDeployments, type DeploymentEntry } from "../../../services/serviceActivity";

/**
 * Every deployment across every app, newest first.
 *
 * Build history existed only inside one resource's page, so "did anything I
 * own deploy today, and did it work" meant opening each app in turn. This is
 * the cross-service view.
 *
 * Aggregated client-side from the existing per-service endpoint rather than
 * behind a new one: only git-sourced apps report deployments at all, so this
 * is a handful of parallel calls, and it needs no backend change to be useful.
 * If an account ever holds enough apps for that to hurt, the fix is one
 * /api/portal/deployments endpoint — not caching this.
 */

type Row = DeploymentEntry & { serviceId: string; serviceName: string };

const RESULT_TONE: Record<string, string> = {
  success: "bg-emerald-500",
  failure: "bg-red-500",
};

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(String(ts).includes("T") ? ts : String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

const DeploymentsTab: React.FC = () => {
  const { deployableServices, navigate, openDeployLog, deployLogView, setDeployLogView } = usePortal();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Only apps deployed from a repo can have build history, and only once
  // active. Asking every service — databases, storage, add-ons — was a dozen
  // round trips to learn "not applicable" eleven times, and enough concurrent
  // requests to trip the API rate limiter on a busy account.
  const candidates = useMemo(
    () => deployableServices.filter((s) => s.status === "Active"),
    [deployableServices]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        candidates.map(async (s) => {
          try {
            const d = await fetchServiceDeployments(s.serviceId);
            if (!d.available) return [];
            return (d.deployments || []).map((x) => ({
              ...x,
              serviceId: s.serviceId,
              serviceName: s.name,
            }));
          } catch {
            // One unreachable service must not blank the whole page.
            return [];
          }
        })
      );
      const flat = results.flat();
      flat.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      setRows(flat);
    } catch (e: any) {
      setError(e?.message || "Failed to load deployments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase text-murzak-ink dark:text-slate-100">
            Deployments
          </h2>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
            Every build across your apps, newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="p-3 rounded-2xl hover:bg-murzak-accent/10 text-slate-500 hover:text-murzak-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent self-start"
          title="Refresh"
          aria-label="Refresh deployments"
        >
          <RefreshCw className={`w-[18px] h-[18px] ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-micro font-black uppercase text-red-500">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="py-16 text-center text-micro font-black uppercase text-slate-600 dark:text-slate-400">
          Loading deployments...
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Rocket className="w-6 h-6" />}
          title="No deployments yet"
          description="Apps deployed from a Git repository record every build here: what changed, whether it worked, and the log. Managed systems don't deploy this way, so they won't appear."
          actionLabel="Go to your resources"
          onAction={() => navigate("/portal/cloud")}
        />
      ) : (
        <div className="bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] shadow-lg overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-murzak-border">
            {rows.map((d) => (
              <div key={`${d.serviceId}-${d.uuid}`} className="p-5 flex flex-wrap items-center gap-4">
                <span
                  className={`shrink-0 w-2.5 h-2.5 rounded-full ${
                    RESULT_TONE[String(d.result)] || "bg-amber-400 animate-pulse"
                  }`}
                  aria-label={d.result || "in progress"}
                />
                <div className="min-w-0 flex-grow">
                  <p className="text-sm font-black text-murzak-ink dark:text-slate-100 truncate">
                    {d.serviceName}
                    <span className="ml-2 font-bold text-slate-500 normal-case">{d.status || "unknown"}</span>
                  </p>
                  <p className="text-micro font-medium text-slate-600 dark:text-slate-400 truncate mt-0.5">
                    <GitCommit className="inline w-3 h-3 mr-1 -mt-0.5" />
                    {[d.commit ? d.commit.slice(0, 8) : d.uuid.slice(0, 8), d.commitMessage, fmt(d.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openDeployLog(d.uuid)}
                    className="h-9 px-4 rounded-xl border border-slate-200 dark:border-murzak-border text-micro font-black uppercase text-slate-600 dark:text-slate-300 hover:border-murzak-accent/40 hover:text-murzak-accent transition"
                  >
                    Log
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/portal/cloud?service=${encodeURIComponent(d.serviceId)}`)}
                    className="h-9 px-4 rounded-xl text-micro font-black uppercase text-murzak-accent hover:bg-murzak-accent/10 transition"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deployLogView && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-murzak-ink/50 backdrop-blur-sm"
          onClick={() => setDeployLogView(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] bg-[#0a0a0a] border border-white/20 rounded-2xl shadow-2xl overflow-hidden font-mono flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 bg-[#1a1a1a] border-b border-white/10">
              <span className="text-gray-300 text-xs truncate">
                Deployment {deployLogView.uuid.slice(0, 12)}: build log
              </span>
              <button
                className="text-gray-500 hover:text-white p-1"
                onClick={() => setDeployLogView(null)}
                aria-label="Close log"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {deployLogView.loading ? (
                <p className="text-xs text-gray-500">Loading log…</p>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-label text-gray-300 leading-relaxed">
                  {deployLogView.logs}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeploymentsTab;
