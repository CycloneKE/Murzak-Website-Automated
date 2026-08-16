import React, { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, ShieldCheck, Clock, Plus, Trash2, RefreshCw, Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  fetchResourceAdminEligibility,
  acceptResourceAdminDisclosure,
  fetchEnvVars,
  createEnvVar,
  updateEnvVar,
  deleteEnvVar,
  fetchRuntimeLogs,
  restartService,
  ResourceAdminEligibility,
  EnvVar,
} from "../../../services/resourceAdmin";
import { createPortalThread } from "../../../services/portalChat";

interface ResourceAdminPanelProps {
  serviceId: string;
  serviceName: string;
  /** Adjusts copy only ("Connection details" vs "Environment Variables") — the underlying data is the same env-var store either way. */
  serviceCategory?: string;
  isActive: boolean;
  /** Opens Portal.tsx's existing upgrade-request flow. */
  onRequestUpgrade: () => void;
  /**
   * Fires when all gates pass. Portal.tsx uses this to swap the "fully managed
   * — no console to babysit" copy, which flatly contradicts this panel once a
   * customer is actually driving. Lifted rather than re-fetched so both places
   * can never disagree about the gate state.
   */
  onAdminActiveChange?: (active: boolean) => void;
}

/** Topics Coolify exposes in its own UI but not over its API — these are fulfilled by a person. */
const REQUEST_TOPICS = [
  { id: "storage", label: "Persistent storage", hint: "A volume that survives restarts and redeploys." },
  { id: "schedule", label: "Scheduled task", hint: "A command to run on a cron schedule." },
  { id: "webhook", label: "Webhook", hint: "Notify an external URL when this service deploys." },
];

/**
 * Advanced controls for a service the customer has been granted admin rights
 * over. Four states, mirroring DeveloperTerminalPanel: plan → approval →
 * disclosure → active.
 *
 * Deliberately Murzak-native: the underlying orchestrator is never named, and
 * only capabilities that are genuinely automated appear as controls. The three
 * request topics are labelled as human-fulfilled so the UI never implies
 * automation that doesn't exist.
 */
const ResourceAdminPanel: React.FC<ResourceAdminPanelProps> = ({
  serviceId,
  serviceName,
  serviceCategory,
  isActive,
  onRequestUpgrade,
  onAdminActiveChange,
}) => {
  const isDatabase = serviceCategory === "Database Hosting";
  const [eligibility, setEligibility] = useState<ResourceAdminEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Env vars
  const [envs, setEnvs] = useState<EnvVar[] | null>(null);
  const [envsError, setEnvsError] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [savingEnv, setSavingEnv] = useState(false);
  const [deletingEnvUuid, setDeletingEnvUuid] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Logs
  const [logs, setLogs] = useState("");
  const [logLines, setLogLines] = useState(200);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  // Requests
  const [requestTopic, setRequestTopic] = useState("");
  const [requestDetail, setRequestDetail] = useState("");
  const [requestSending, setRequestSending] = useState(false);

  // Access request — kicks off staff approval the same way Developer Access
  // does (a support thread AdminInbox recognises by subject prefix and can
  // approve in place). There's no separate "requested" flag on Web Account;
  // the thread itself is the request.
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [accessRequestSent, setAccessRequestSent] = useState(false);
  const [accessRequestError, setAccessRequestError] = useState("");

  const active = !!eligibility?.enabled && !!eligibility?.planAllowed && !!eligibility?.approved && !!eligibility?.disclosureAccepted;

  const loadEligibility = useCallback(() => {
    setLoading(true);
    return fetchResourceAdminEligibility()
      .then(setEligibility)
      .catch(() => setEligibility({ enabled: false, planAllowed: false, approved: false, disclosureAccepted: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchResourceAdminEligibility()
      .then((r) => { if (!cancelled) setEligibility(r); })
      .catch(() => { if (!cancelled) setEligibility({ enabled: false, planAllowed: false, approved: false, disclosureAccepted: false }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serviceId]);

  const loadEnvs = useCallback(() => {
    setEnvsError("");
    fetchEnvVars(serviceId)
      .then(setEnvs)
      .catch((e: any) => { setEnvs([]); setEnvsError(e?.message || "Couldn't load variables."); });
  }, [serviceId]);

  useEffect(() => {
    if (active) loadEnvs();
  }, [active, loadEnvs]);

  useEffect(() => {
    onAdminActiveChange?.(active && isActive);
  }, [active, isActive, onAdminActiveChange]);

  const handleRequestAccess = async () => {
    setRequestingAccess(true);
    setAccessRequestError("");
    try {
      await createPortalThread({
        subject: `Resource Admin Access Request: ${serviceName}`,
        message: `I'd like advanced controls (environment variables, live logs) for ${serviceName} (${serviceId}).`,
      });
      setAccessRequestSent(true);
    } catch (e: any) {
      setAccessRequestError(e?.message || "Couldn't send that request.");
    } finally {
      setRequestingAccess(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    setError("");
    try {
      await acceptResourceAdminDisclosure();
      await loadEligibility();
    } catch (e: any) {
      setError(e?.message || "Failed to record acceptance.");
    } finally {
      setAccepting(false);
    }
  };

  const handleAddEnv = async () => {
    const key = draftKey.trim();
    if (!key) return;
    setSavingEnv(true);
    setEnvsError("");
    try {
      const existing = envs?.find((e) => e.key === key);
      const res = existing
        ? await updateEnvVar(serviceId, key, { value: draftValue })
        : await createEnvVar(serviceId, { key, value: draftValue });
      setNotice(res.message);
      setRestartNeeded(true);
      setDraftKey("");
      setDraftValue("");
      loadEnvs();
    } catch (e: any) {
      setEnvsError(e?.message || "Couldn't save that variable.");
    } finally {
      setSavingEnv(false);
    }
  };

  const handleDeleteEnv = async (env: EnvVar) => {
    if (deletingEnvUuid) return;
    setEnvsError("");
    setDeletingEnvUuid(env.uuid);
    try {
      const res = await deleteEnvVar(serviceId, env.uuid);
      setNotice(res.message);
      setRestartNeeded(true);
      loadEnvs();
    } catch (e: any) {
      setEnvsError(e?.message || "Couldn't remove that variable.");
    } finally {
      setDeletingEnvUuid(null);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      const res = await restartService(serviceId);
      setNotice(res.message);
      setRestartNeeded(false);
    } catch (e: any) {
      setEnvsError(e?.message || "Couldn't restart the service.");
    } finally {
      setRestarting(false);
    }
  };

  const handleLoadLogs = async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const res = await fetchRuntimeLogs(serviceId, logLines);
      setLogs(res.logs || "");
    } catch (e: any) {
      setLogsError(e?.message || "Couldn't fetch logs.");
    } finally {
      setLogsLoading(false);
    }
  };

  const handleSendRequest = async () => {
    if (!requestTopic || !requestDetail.trim()) return;
    setRequestSending(true);
    try {
      const topic = REQUEST_TOPICS.find((t) => t.id === requestTopic);
      await createPortalThread({
        subject: `${topic?.label} request — ${serviceName}`,
        message: `Service: ${serviceName} (${serviceId})\nRequest type: ${topic?.label}\n\n${requestDetail.trim()}`,
      });
      setNotice("Request sent — our team will follow up in your messages.");
      setRequestTopic("");
      setRequestDetail("");
    } catch (e: any) {
      setError(e?.message || "Couldn't send that request.");
    } finally {
      setRequestSending(false);
    }
  };

  if (!isActive) return null;
  if (!loading && !eligibility?.enabled) return null;

  const shell = (children: React.ReactNode) => (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
      <div className="flex items-center gap-3 mb-3">
        <SlidersHorizontal className="w-5 h-5 text-murzak-accent" />
        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Advanced Controls</p>
      </div>
      {children}
    </div>
  );

  if (loading) return shell(<p className="text-label font-medium text-slate-500">Checking access…</p>);

  if (!eligibility?.planAllowed) {
    return shell(
      <div>
        <p className="text-label font-medium text-slate-600 dark:text-slate-400 mb-3">
          Managing your own environment variables and reading live logs is available on the Business plan and above.
        </p>
        <button
          type="button"
          onClick={onRequestUpgrade}
          className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition"
        >
          Request Upgrade
        </button>
      </div>
    );
  }

  if (!eligibility.approved) {
    return shell(
      <div>
        <div className="flex items-start gap-3 mb-3">
          <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-label font-medium text-slate-600 dark:text-slate-400">
            {accessRequestSent
              ? "Request sent — our team will follow up in your Support tab, usually the same day."
              : "Managing your own environment variables and reading live logs needs a quick approval from our team first."}
          </p>
        </div>
        {accessRequestError && <p className="text-label font-bold text-red-500 mb-3">{accessRequestError}</p>}
        {!accessRequestSent && (
          <button
            type="button"
            onClick={handleRequestAccess}
            disabled={requestingAccess}
            className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
          >
            {requestingAccess ? "Sending…" : "Request advanced access"}
          </button>
        )}
      </div>
    );
  }

  if (!eligibility.disclosureAccepted) {
    return shell(
      <div>
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="w-4 h-4 text-murzak-accent shrink-0 mt-0.5" />
          <div className="text-label font-medium text-slate-600 dark:text-slate-400 space-y-2">
            <p>
              Before you take the wheel: these controls change your live service directly. A bad
              environment variable can stop it from starting, and removing one your app depends on will
              break it until you put it back. Changes apply only after a restart, which briefly
              interrupts the service.
            </p>
            <p>
              We'll still keep the platform running underneath you, but configuration you change here
              becomes yours to maintain — our team can no longer guarantee a service we didn't configure.
            </p>
          </div>
        </div>
        {error && <p className="text-label font-bold text-red-500 mb-3">{error}</p>}
        <button
          type="button"
          onClick={handleAccept}
          disabled={accepting}
          className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
        >
          {accepting ? "Saving…" : "I understand and agree"}
        </button>
      </div>
    );
  }

  return shell(
    <div className="space-y-6">
      {notice && <p className="text-label font-bold text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {/* --- Environment variables --- */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-label font-black text-slate-700 dark:text-slate-300">
            {isDatabase ? "Connection Details" : "Environment Variables"}
          </p>
          <button
            type="button"
            onClick={loadEnvs}
            className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {isDatabase && (
          <p className="text-micro font-medium text-slate-400 mb-3">
            Host, credentials and connection URL for this database are stored here as variables — reveal one to copy it.
          </p>
        )}

        {restartNeeded && (
          <div className="mb-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-label font-medium text-amber-800 dark:text-amber-300">
                Saved, but not live yet — your service keeps its current environment until it restarts.
              </p>
              <button
                type="button"
                onClick={handleRestart}
                disabled={restarting}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
              >
                {restarting ? "Restarting…" : "Restart now"}
              </button>
            </div>
          </div>
        )}

        {envsError && <p className="text-label font-bold text-red-500 mb-2">{envsError}</p>}

        {envs === null ? (
          <p className="text-label font-medium text-slate-500">Loading…</p>
        ) : envs.length === 0 ? (
          <p className="text-label font-medium text-slate-500">No variables set yet.</p>
        ) : (
          <div className="space-y-1.5">
            {envs.map((env) => (
              <div
                key={env.uuid || env.key}
                className="flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-murzak-border px-3 py-2"
              >
                <code className="text-label font-bold text-slate-700 dark:text-slate-300 shrink-0">{env.key}</code>
                <code className="text-label font-medium text-slate-500 truncate flex-1">
                  {env.redacted
                    ? "•••••••• (write-only)"
                    : revealed[env.key]
                      ? env.value ?? ""
                      : "•".repeat(Math.min(12, (env.value || "").length) || 4)}
                </code>
                {!env.redacted && (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [env.key]: !r[env.key] }))}
                    className="text-slate-400 hover:text-murzak-accent transition shrink-0"
                    aria-label={revealed[env.key] ? `Hide ${env.key}` : `Reveal ${env.key}`}
                  >
                    {revealed[env.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteEnv(env)}
                  disabled={!!deletingEnvUuid}
                  className="text-slate-400 hover:text-red-500 transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Remove ${env.key}`}
                >
                  <Trash2 className={`w-4 h-4 ${deletingEnvUuid === env.uuid ? "animate-pulse" : ""}`} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="VARIABLE_NAME"
            className="flex-1 rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-white/[0.04] px-3 py-2 text-label font-medium text-slate-700 dark:text-slate-200"
          />
          <input
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            placeholder="value"
            className="flex-1 rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-white/[0.04] px-3 py-2 text-label font-medium text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={handleAddEnv}
            disabled={savingEnv || !draftKey.trim()}
            className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60 inline-flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> {savingEnv ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="mt-1.5 text-micro font-medium text-slate-400">
          Letters, numbers and underscores only. Saving an existing name replaces its value.
        </p>
      </section>

      {/* --- Runtime logs --- */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-label font-black text-slate-700 dark:text-slate-300">Live Logs</p>
          <div className="flex items-center gap-2">
            <select
              value={logLines}
              onChange={(e) => setLogLines(Number(e.target.value))}
              className="rounded-lg border border-slate-200 dark:border-murzak-border bg-white dark:bg-white/[0.04] px-2 py-1 text-micro font-bold text-slate-600 dark:text-slate-300"
            >
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>
            <button
              type="button"
              onClick={handleLoadLogs}
              disabled={logsLoading}
              className="text-micro font-bold uppercase text-slate-500 hover:text-murzak-accent transition inline-flex items-center gap-1 disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${logsLoading ? "animate-spin" : ""}`} /> Fetch
            </button>
          </div>
        </div>
        {logsError && <p className="text-label font-bold text-red-500 mb-2">{logsError}</p>}
        <pre className="rounded-xl bg-slate-900 text-slate-200 p-3 text-micro font-mono overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap">
          {logs || "Press Fetch to load what your service is logging right now."}
        </pre>
      </section>

      {/* --- Human-fulfilled requests --- */}
      <section>
        <p className="text-label font-black text-slate-700 dark:text-slate-300 mb-1">Ask for more</p>
        <p className="text-micro font-medium text-slate-400 mb-2">
          These aren't self-service yet — a Murzak engineer sets them up for you.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {REQUEST_TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setRequestTopic(requestTopic === t.id ? "" : t.id)}
              title={t.hint}
              className={`px-3 py-1.5 rounded-lg text-micro font-bold uppercase transition border ${
                requestTopic === t.id
                  ? "bg-murzak-accent text-murzak-ink dark:text-white border-transparent"
                  : "border-slate-200 dark:border-murzak-border text-slate-600 dark:text-slate-300 hover:border-murzak-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {requestTopic && (
          <div>
            <textarea
              value={requestDetail}
              onChange={(e) => setRequestDetail(e.target.value)}
              rows={3}
              placeholder={REQUEST_TOPICS.find((t) => t.id === requestTopic)?.hint}
              className="w-full rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-white/[0.04] px-3 py-2 text-label font-medium text-slate-700 dark:text-slate-200"
            />
            <button
              type="button"
              onClick={handleSendRequest}
              disabled={requestSending || !requestDetail.trim()}
              className="mt-2 px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink dark:text-white text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
            >
              {requestSending ? "Sending…" : "Send request"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default ResourceAdminPanel;
