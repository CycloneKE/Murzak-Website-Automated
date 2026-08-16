import React, { useCallback, useEffect, useState } from "react";
import { Database, Eye, EyeOff, Copy, RefreshCw } from "lucide-react";
import { fetchDatabaseConnection, DatabaseConnection } from "../../../services/databaseConnection";

interface DatabaseConnectionPanelProps {
  serviceId: string;
  isActive: boolean;
}

function Row({ label, value, secret, revealed, onToggle }: {
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-murzak-border px-3 py-2">
      <span className="text-micro font-black uppercase text-slate-400 w-20 shrink-0">{label}</span>
      <code className="text-label font-bold text-slate-700 dark:text-slate-300 truncate flex-1">
        {secret && !revealed ? "•".repeat(Math.min(16, value.length) || 8) : value}
      </code>
      {secret && (
        <button
          type="button"
          onClick={onToggle}
          className="text-slate-400 hover:text-murzak-accent transition shrink-0"
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        >
          {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="text-slate-400 hover:text-murzak-accent transition shrink-0"
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
      .catch((e: any) => setError(e?.message || "Couldn't load connection details."))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-murzak-accent" />
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Connection Details</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading && <p className="text-label font-medium text-slate-500">Loading…</p>}
      {error && <p className="text-label font-bold text-red-500">{error}</p>}

      {!loading && !error && conn && !conn.password && (
        <p className="text-label font-medium text-slate-500">
          {conn.note || "Connection details aren't available for this service yet."}
        </p>
      )}

      {!loading && !error && conn?.password && (
        <div className="space-y-1.5">
          <Row label="Engine" value={conn.engine || ""} />
          <Row label="Host" value={conn.host || ""} />
          <Row label="Port" value={String(conn.port ?? "")} />
          {conn.database && <Row label="Database" value={conn.database} />}
          {conn.username && <Row label="Username" value={conn.username} />}
          <Row label="Password" value={conn.password} secret revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
        </div>
      )}
    </div>
  );
};

export default DatabaseConnectionPanel;
