import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchRuntimeLogs } from "../../../services/resourceAdmin";
import { toUserMessage } from "../../../services/errors";
import { PButton, Panel } from "../ui";
import LogViewer from "../LogViewer";

/** What the running service is logging right now, with find, copy and download. */
const RuntimeLogsPanel: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const [logs, setLogs] = useState("");
  const [lines, setLines] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLogs((await fetchRuntimeLogs(serviceId, lines)).logs || "");
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't fetch logs."));
    } finally {
      setLoading(false);
    }
  }, [serviceId, lines]);

  useEffect(() => { load(); }, [load]);

  return (
    <Panel
      title="Runtime logs"
      description="The most recent output from your running service."
      actions={
        <PButton size="sm" icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />} onClick={load} disabled={loading}>
          Refresh
        </PButton>
      }
    >
      {error && <p role="alert" className="mb-3 text-[13px] text-p-danger">{error}</p>}
      <LogViewer
        logs={logs}
        loading={loading && !logs}
        empty="Your service hasn't logged anything recently."
        filename={`runtime-${serviceId}`}
        toolbar={
          <select
            aria-label="Number of lines"
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="p-tap rounded-md border border-p-border bg-p-panel px-2 text-sm text-p-text"
          >
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} lines</option>)}
          </select>
        }
      />
    </Panel>
  );
};

export default RuntimeLogsPanel;
