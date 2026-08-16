import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Globe, RefreshCw, Search } from "lucide-react";
import {
  adminListDomains,
  adminSetDomainStatus,
  AdminDomain,
  DomainStatus,
} from "../../services/adminChat";

/**
 * The domain fulfilment queue.
 *
 * Registering a domain is a manual job — the registrar's API terms blocked
 * automating it — so "pending" is real work someone has to do, not a state the
 * system clears itself. Until now that queue only existed as rows in three
 * intake doctypes with no cross-account view, so staff had to already know a
 * request had been made to find it.
 */

/** Mirrors DOMAIN_STATUS_TRANSITIONS in services/customerDomains.js. The
 *  server is the authority and re-checks; this only hides buttons that would
 *  be refused, so staff aren't offered actions that cannot work. */
const TRANSITIONS: Record<DomainStatus, DomainStatus[]> = {
  pending: ["active", "failed", "cancelled"],
  failed: ["pending", "active", "cancelled"],
  active: ["expired", "cancelled"],
  expired: ["active", "cancelled"],
  cancelled: [],
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/20",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  failed: "bg-red-500/15 text-red-400 border-red-500/20",
  expired: "bg-orange-500/15 text-orange-300 border-orange-500/20",
  cancelled: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-murzak-border",
};

const KIND_LABELS: Record<string, string> = {
  registered: "Registered for them",
  external: "They brought it",
  murzak_subdomain: "Murzak subdomain",
};

const ACTION_LABELS: Partial<Record<DomainStatus, string>> = {
  active: "Mark live",
  failed: "Mark failed",
  cancelled: "Cancel",
  expired: "Mark expired",
  pending: "Reopen",
};

function fmtDate(ts?: string | null) {
  if (!ts) return "—";
  const d = new Date(String(ts).includes("T") ? ts : String(ts).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
}

type AdminDomainsProps = {
  /** Bubbles the pending count up so the tab badge matches. */
  onActionableChange?: (count: number) => void;
};

const POLL_MS = 20000;

const AdminDomains: React.FC<AdminDomainsProps> = ({ onActionableChange }) => {
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [actionable, setActionable] = useState(0);
  const [filter, setFilter] = useState<DomainStatus | "all">("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string>("");
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminListDomains();
      setDomains(data.domains);
      setSummary(data.summary);
      setActionable(data.actionableCount);
    } catch (e: any) {
      setError(e?.message || "Failed to load domains.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const h = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onActionableChange?.(actionable);
  }, [actionable, onActionableChange]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return domains
      .filter((d) => (filter === "all" ? true : d.status === filter))
      .filter((d) =>
        !q ? true : `${d.domainName} ${d.webAccount} ${d.registrar} ${d.kind}`.toLowerCase().includes(q)
      );
  }, [domains, filter, query]);

  const act = async (d: AdminDomain, status: DomainStatus) => {
    setBusyId(d.id);
    setError("");
    setNote("");
    try {
      const r = await adminSetDomainStatus(d.id, status);
      setNote(
        `${d.domainName} → ${r.status}.` +
          (r.intakeSynced
            ? " The customer's dashboard now shows this too."
            : " Note: the original request record wasn't updated, so the customer may still see the old status.")
      );
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to update domain.");
    } finally {
      setBusyId("");
    }
  };

  const chip = (key: DomainStatus | "all", label: string, count?: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-micro font-black uppercase border transition ${
        filter === key
          ? "bg-murzak-accent text-murzak-ink border-transparent shadow-md"
          : "bg-white/60 dark:bg-black/5 border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent hover:border-murzak-accent/40"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="opacity-70">{count}</span>
      )}
    </button>
  );

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase">Domain Queue</h2>
        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
          Domains awaiting manual registration, verification or renewal.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {chip("pending", "Pending", summary.pending)}
        {chip("active", "Live", summary.active)}
        {chip("failed", "Failed", summary.failed)}
        {chip("expired", "Expired", summary.expired)}
        {chip("all", "All")}
        <div className="relative ml-auto min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search domain, account..."
            className="w-full bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border rounded-2xl pl-11 pr-4 py-2.5
                       text-sm font-bold text-murzak-ink dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
          />
        </div>
        <button
          onClick={load}
          className="p-3 rounded-2xl hover:bg-murzak-accent/10 text-slate-500 hover:text-murzak-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent"
          title="Refresh"
          aria-label="Refresh domains"
          type="button"
        >
          <RefreshCw className={`w-[18px] h-[18px] ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-micro font-black uppercase text-red-500">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {note && (
        <div className="mb-4 text-micro font-black uppercase text-murzak-accent">{note}</div>
      )}

      <div className="bg-white/80 dark:bg-white/60 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] sm:rounded-[2.5rem] shadow-lg overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-12 text-center">
            <Globe className="w-6 h-6 mx-auto text-slate-400 mb-3" />
            <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
              {loading ? "Loading..." : filter === "pending" ? "Nothing waiting. Queue is clear." : "No domains match."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-murzak-border">
            {visible.map((d) => (
              <div key={d.id} className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="min-w-0 flex-grow">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-sm font-black text-murzak-ink dark:text-slate-100 truncate">
                      {d.domainName}
                    </p>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${STATUS_CLASSES[d.status] || STATUS_CLASSES.cancelled}`}>
                      {d.status}
                    </span>
                  </div>
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1.5 truncate">
                    {d.webAccount} • {KIND_LABELS[d.kind] || d.kind}
                    {d.registrar ? ` • ${d.registrar}` : ""}
                  </p>
                  <p className="text-micro font-bold text-slate-500 dark:text-slate-500 mt-1">
                    Requested {fmtDate(d.createdAt)}
                    {d.expiresOn ? ` • expires ${fmtDate(d.expiresOn)}` : ""}
                    {d.attachedToService
                      ? ` • serving ${d.attachedToService}`
                      : " • not attached to a service"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {TRANSITIONS[d.status].map((next) => (
                    <button
                      key={next}
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => act(d, next)}
                      className={`h-9 px-4 inline-flex items-center rounded-xl text-micro font-black uppercase transition disabled:opacity-50 ${
                        next === "active"
                          ? "bg-murzak-accent text-murzak-ink hover:scale-[1.02]"
                          : "border border-slate-200 dark:border-murzak-border text-slate-600 dark:text-slate-300 hover:border-murzak-accent/40 hover:text-murzak-accent"
                      }`}
                    >
                      {busyId === d.id ? "Working..." : ACTION_LABELS[next] || next}
                    </button>
                  ))}
                  {TRANSITIONS[d.status].length === 0 && (
                    <span className="text-micro font-black uppercase text-slate-500">No actions</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDomains;
