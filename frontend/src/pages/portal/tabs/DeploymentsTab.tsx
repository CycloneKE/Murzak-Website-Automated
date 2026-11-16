import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, GitCommit, RefreshCw, Rocket } from "lucide-react";
import { Empty, Modal, PageHeader, Panel, PButton, StatusPill } from "../../../components/portal/ui";
import { servicePath } from "../helpers";
import { usePortal } from "../PortalContext";
import { fetchServiceDeployments, type DeploymentEntry } from "../../../services/serviceActivity";
import { toUserMessage } from "../../../services/errors";

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
      setError(toUserMessage(e, "Failed to load deployments."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  return (
    <div>
      <PageHeader
        title="Updates"
        description="Every build across your apps, newest first."
        actions={
          <PButton
            icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />}
            onClick={load}
            aria-label="Refresh updates"
          >
            Refresh
          </PButton>
        }
      />

      {error && (
        <p role="alert" className="mb-4 flex items-center gap-2 text-[13px] text-p-danger">
          <AlertCircle className="w-4 h-4" /> {error}
        </p>
      )}

      <Panel flush>
        {loading && rows.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-p-muted">Loading updates...</p>
        ) : rows.length === 0 ? (
          <Empty
            icon={<Rocket />}
            title="No updates yet"
            description="Apps deployed from a Git repository record every build here: what changed, whether it worked, and the log. Managed systems don't update this way, so they won't appear."
            actionLabel="Go to your services"
            onAction={() => navigate("/portal/cloud")}
          />
        ) : (
          <ul className="divide-y divide-p-border">
            {rows.map((d) => (
              <li key={`${d.serviceId}-${d.uuid}`} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3">
                <StatusPill tone={d.result === "success" ? "ok" : d.result === "failure" ? "bad" : "progress"}>
                  {d.status || "unknown"}
                </StatusPill>
                <div className="min-w-0 grow">
                  <p className="text-sm font-medium text-p-text truncate">{d.serviceName}</p>
                  <p className="text-[13px] text-p-muted truncate">
                    <GitCommit className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
                    {[d.commit ? d.commit.slice(0, 8) : d.uuid.slice(0, 8), d.commitMessage, fmt(d.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PButton size="sm" onClick={() => openDeployLog(d.uuid)}>Log</PButton>
                  <PButton size="sm" variant="ghost" onClick={() => navigate(servicePath(d.serviceId))}>Open</PButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal
        open={!!deployLogView}
        onClose={() => setDeployLogView(null)}
        title={`Update ${deployLogView?.uuid.slice(0, 12) || ""}: build log`}
        size="lg"
      >
        {deployLogView?.loading ? (
          <p className="text-[13px] text-p-muted">Loading log…</p>
        ) : (
          <pre className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-p-text bg-p-panel-2 border border-p-border rounded-md p-3">
            {deployLogView?.logs}
          </pre>
        )}
      </Modal>
    </div>
  );
};

export default DeploymentsTab;
