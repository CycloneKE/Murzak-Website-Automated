import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { fetchMailStatus, fetchMyMailLink, MailError } from "../../services/mail";
import MailboxAccess from "./MailboxAccess";
import type { MailDnsRecord, MailStage, MailStatus } from "../../types";

/**
 * The customer's setup progress: four plain stages, polled every 10 seconds.
 * Pass `token` (the emailed link) or `orderId` (signed in: the token is
 * fetched from the owner-only link route). A needs_attention state shows only
 * the fixed sentence the API supplies, never a technical reason.
 */

const POLL_MS = 10_000;
const MUTED = "text-slate-600 dark:text-slate-400";

interface Props {
  token?: string;
  orderId?: string;
}

function StageIcon({ state }: { state: MailStage["state"] }) {
  if (state === "done") {
    return (
      <span className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
        <Check size={16} />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="w-8 h-8 rounded-full bg-murzak-accent/15 text-sky-700 dark:text-murzak-accent flex items-center justify-center shrink-0">
        <Loader2 size={16} className="animate-spin" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="w-8 h-8 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
        <AlertCircle size={16} />
      </span>
    );
  }
  return <span className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-slate-600 shrink-0" aria-hidden="true" />;
}

const STATE_WORDS: Record<MailStage["state"], string> = {
  done: "Done",
  running: "In progress",
  failed: "Being checked",
  pending: "Waiting",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value is selectable on screen */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

function DnsRecords({ records }: { records: MailDnsRecord[] }) {
  return (
    <section className="mt-8 rounded-3xl border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6" aria-labelledby="dns-heading">
      <h3 id="dns-heading" className="font-black text-murzak-ink dark:text-slate-100">Add these records to your domain</h3>
      <p className={`mt-1 text-sm font-semibold ${MUTED}`}>
        Open the place where you manage your domain (your registrar) and add each record below. We check again automatically every
        few minutes and switch your email on as soon as they are found. This page updates by itself.
      </p>
      <ul className="mt-4 space-y-3">
        {records.map((r, i) => (
          <li key={`${r.type}-${r.name}-${i}`} className="rounded-2xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-murzak-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase text-sky-700 dark:text-murzak-accent">
                {r.type}{r.priority != null ? ` · priority ${r.priority}` : ""}
              </p>
            </div>
            <div className="mt-2 grid gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-mono text-murzak-ink dark:text-slate-100 break-all"><span className={`font-sans font-bold ${MUTED}`}>Name </span>{r.name}</p>
                <CopyButton text={r.name} label={`${r.type} record name`} />
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-mono text-murzak-ink dark:text-slate-100 break-all"><span className={`font-sans font-bold ${MUTED}`}>Value </span>{r.value}</p>
                <CopyButton text={r.value} label={`${r.type} record value`} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className={`mt-4 text-sm font-semibold flex items-center gap-2 ${MUTED}`} role="status">
        <Loader2 size={14} className="animate-spin shrink-0" /> Waiting for your records to appear online…
      </p>
    </section>
  );
}

const MailProgress: React.FC<Props> = ({ token: tokenProp, orderId }) => {
  const [token, setToken] = useState(tokenProp || "");
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dead, setDead] = useState(false);
  const alive = useRef(true);
  const statusLoaded = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Signed-in view: trade the order id for the status token once.
  useEffect(() => {
    if (tokenProp) { setToken(tokenProp); return; }
    if (!orderId) return;
    let cancelled = false;
    fetchMyMailLink(orderId)
      .then((r) => { if (!cancelled) setToken(r.token); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof MailError ? e.message : "We couldn't open your email setup. Please try again.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tokenProp, orderId]);

  // A new token starts fresh: forget any earlier dead/loaded state.
  useEffect(() => { setDead(false); statusLoaded.current = false; }, [token]);

  const load = useCallback(async (t: string) => {
    try {
      const s = await fetchMailStatus(t);
      if (!alive.current) return;
      statusLoaded.current = true;
      setStatus(s);
      setError("");
    } catch (e) {
      if (!alive.current) return;
      // Keep showing the last good status; only surface an error if there is none.
      setError(e instanceof MailError ? e.message : "We couldn't load your email setup. Please try again.");
      // A bad link or signed-out session will not fix itself: stop polling.
      if (e instanceof MailError && (e.status === 404 || e.status === 401) && !statusLoaded.current) setDead(true);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  const finished = status?.state === "live";
  useEffect(() => {
    if (!token || dead) return;
    load(token);
    if (finished) return;
    const id = window.setInterval(() => load(token), POLL_MS);
    return () => window.clearInterval(id);
  }, [token, load, finished, dead]);

  if (loading && !status) {
    return (
      <p className={`flex items-center gap-2 font-semibold ${MUTED}`} role="status">
        <Loader2 size={16} className="animate-spin" /> Loading your email setup…
      </p>
    );
  }
  if (!status) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm font-bold text-red-600 dark:text-red-400">
        <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error || "We couldn't load your email setup."}
      </p>
    );
  }

  const needsAttention = status.state === "needs_attention";
  const waitingOnDns = Array.isArray(status.dnsRecords) && status.dnsRecords.length > 0;

  return (
    <div>
      <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-murzak-ink dark:text-slate-100">
        {finished ? "Your business email is ready" : "Setting up your business email"}
      </h2>
      <p className={`mt-2 font-medium ${MUTED}`}>
        {finished
          ? "Open your webmail below. We also emailed you these details."
          : "It is safe to close this tab. We will email you as soon as everything is ready."}
      </p>

      <ol className="mt-8 space-y-4" aria-label="Setup progress">
        {status.stages.map((s) => (
          <li key={s.id} className="flex items-center gap-4">
            <StageIcon state={s.state} />
            <div className="min-w-0">
              <p className="font-black text-murzak-ink dark:text-slate-100">{s.label}</p>
              <p className={`text-sm font-semibold ${s.state === "failed" ? "text-amber-700 dark:text-amber-400" : MUTED}`}>
                {STATE_WORDS[s.state]}
                {s.id === "domain" && s.state === "running" ? ". Waiting for your domain's records to be found." : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {needsAttention && (
        <p role="status" className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-800 dark:text-amber-300">
          {status.message || "Your setup needs a quick check by our team. We will email you within one working day."}
        </p>
      )}

      {!needsAttention && waitingOnDns && <DnsRecords records={status.dnsRecords!} />}

      {finished && token && <MailboxAccess token={token} status={status} onChanged={() => load(token)} />}

      {error && <p className="sr-only" role="alert">{error}</p>}
    </div>
  );
};

export default MailProgress;
