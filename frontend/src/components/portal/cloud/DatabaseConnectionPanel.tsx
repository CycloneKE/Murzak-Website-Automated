import React, { useCallback, useEffect, useState } from "react";
import { Database, Eye, EyeOff, Copy, RefreshCw } from "lucide-react";
import { fetchDatabaseConnection, DatabaseConnection } from "../../../services/databaseConnection";
import { toUserMessage } from "../../../services/errors";

interface DatabaseConnectionPanelProps {
  serviceId: string;
  isActive: boolean;
}

export function CredentialRow({ label, value, secret, revealed, onToggle }: {
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-p-panel border border-p-border px-3 py-2">
      <span className="text-xs font-semibold text-p-muted w-20 shrink-0">{label}</span>
      <code className="text-[13px] font-medium text-p-text truncate flex-1">
        {secret && !revealed ? "•".repeat(Math.min(16, value.length) || 8) : value}
      </code>
      {secret && (
        <button
          type="button"
          onClick={onToggle}
          className="text-p-muted hover:text-p-accent-text transition shrink-0"
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="text-p-muted hover:text-p-accent-text transition shrink-0"
        aria-label={`Copy ${label}`}
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Connection details for a Database Hosting resource. Available to any
 * active purchase regardless of plan — a database's own credentials are the
 * product, not an advanced-controls extra (see ResourceAdminPanel's gating,
 * which this deliberately does NOT reuse).
 */
const DatabaseConnectionPanel: React.FC<DatabaseConnectionPanelProps> = ({ serviceId, isActive }) => {
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<DatabaseConnection | null>(null);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchDatabaseConnection(serviceId)
      .then(setConn)
      .catch((e: any) => setError(toUserMessage(e, "Couldn't load connection details.")))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-lg border border-p-border bg-p-panel-2 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-p-accent-text" />
          <p className="text-xs font-semibold text-p-muted ">Connection Details</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs font-medium text-p-muted hover:text-p-accent-text transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading && <p className="text-[13px] font-medium text-p-muted">Loading…</p>}
      {error && <p className="text-[13px] font-medium text-p-danger">{error}</p>}

      {!loading && !error && conn && !conn.password && (
        <p className="text-[13px] font-medium text-p-muted">
          {conn.note || "Connection details aren't available for this service yet."}
        </p>
      )}

      {!loading && !error && conn?.password && (
        <div className="space-y-1.5">
          <CredentialRow label="Engine" value={conn.engine || ""} />
          <CredentialRow label="Host" value={conn.host || ""} />
          <CredentialRow label="Port" value={String(conn.port ?? "")} />
          {conn.database && <CredentialRow label="Database" value={conn.database} />}
          {conn.username && <CredentialRow label="Username" value={conn.username} />}
          <CredentialRow label="Password" value={conn.password} secret revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
        </div>
      )}
    </div>
  );
};

export default DatabaseConnectionPanel;
