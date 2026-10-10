import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Loader2, ExternalLink, LifeBuoy } from "lucide-react";
import PosLoginPanel from "../../components/portal/cloud/PosLoginPanel";
import { fetchServiceActivity, ProvisioningActivityEntry } from "../../services/serviceActivity";
import { APP_CHECKOUT } from "../../config/appCheckout";
import { AppId } from "../../config/serviceCatalog";
import { toUserMessage } from "../../services/errors";

const POLL_MS = 5000;
// Typical POS setup is ~2 minutes; after this, say so honestly.
const SLOW_AFTER_MS = 6 * 60 * 1000;
// Mirrors the server's PROVISIONING_MAX_ATTEMPTS default.
const MAX_SETUP_ATTEMPTS = 3;

type Stage = 0 | 1 | 2 | 3; // paid, creating, owner account, ready

function safeUrlOf(job: ProvisioningActivityEntry | null): string {
  return job?.accessUrl && /^https?:\/\//i.test(job.accessUrl) ? job.accessUrl : "";
}

// The order is Paid by the time this renders, so "paid" is always done and the
// first thing in progress is creating the shop. A job that hasn't appeared yet
// (or is queued / handed to the automated bench runner) is still stage 1.
function stageOf(job: ProvisioningActivityEntry | null): Stage {
  if (!job) return 1;
  if (job.status === "active" && safeUrlOf(job)) return 3;
  if (job.status === "running") return 2;
  return 1;
}

const linkClass = "text-sm font-black text-sky-700 dark:text-murzak-accent underline underline-offset-2";

const AppWelcome: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<AppId | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [job, setJob] = useState<ProvisioningActivityEntry | null>(null);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId || "")}`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Order not found");
        if (cancel) return;
        const order = data.order;
        if (order?.status !== "Paid") {
          if (order?.status === "Draft") navigate(`/checkout/${encodeURIComponent(orderId || "")}`, { replace: true });
          else setCancelled(true);
          return;
        }
        if (!order?.config?.app) { navigate("/thank-you", { replace: true }); return; }
        setApp(order.config.app);
        setServiceId(order.serviceId || "");
      } catch (e: any) {
        if (!cancel) setError(toUserMessage(e, "We couldn't load your order."));
      }
    })();
    return () => { cancel = true; };
  }, [orderId, navigate]);

  // Self-scheduling poll: each tick decides from its OWN fresh result whether
  // to schedule the next one, so it stops the moment the shop is ready (a
  // setInterval would read a stale `job` from its first render).
  useEffect(() => {
    if (!serviceId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let latest: ProvisioningActivityEntry | null = null;
      try {
        const jobs = await fetchServiceActivity(serviceId);
        latest = jobs[0] || null;
        if (!stop) setJob(latest);
      } catch {
        /* transient — try again next tick */
      }
      if (stop) return;
      setNow(Date.now());
      const terminal = latest?.status === "failed" || latest?.status === "deleted";
      if (stageOf(latest) < 3 && !terminal) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [serviceId]);

  if (error) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 pt-32 pb-16">
        <div className="glass-card rounded-3xl p-6">
          <p className="font-black text-murzak-ink dark:text-slate-100">{error}</p>
          <Link to="/portal/overview" className={`mt-4 inline-block ${linkClass}`}>Back to my portal</Link>
        </div>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 pt-32 pb-16">
        <div className="glass-card rounded-3xl p-6">
          <p className="font-black text-murzak-ink dark:text-slate-100">This order was cancelled.</p>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">No payment was taken. You can start again whenever you're ready.</p>
          <Link to="/products/pos" className={`mt-4 inline-block ${linkClass}`}>Choose a POS tier</Link>
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="max-w-xl mx-auto px-4 pt-32 flex items-center gap-3 font-bold text-slate-500 dark:text-slate-400" role="status">
        <Loader2 size={18} className="animate-spin" /> Loading your order…
      </div>
    );
  }

  const stage = stageOf(job);
  const slow = stage < 3 && now - startedAt > SLOW_AFTER_MS;
  const safeUrl = safeUrlOf(job);
  const stuck =
    job?.statusDetail === "needs_attention" ||
    job?.status === "failed" ||
    (job?.status === "needs_human" && (job.attempts ?? 0) >= MAX_SETUP_ATTEMPTS && !!job.error) ||
    !serviceId;
  const info = APP_CHECKOUT[app];
  const steps = ["Payment received", `Creating your private ${info?.productName || "app"}`, "Setting up your owner account", "Ready"];

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 pt-28 pb-16">
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-murzak-ink dark:text-slate-100">
        {stage === 3 ? "Your shop is ready" : "Your shop is getting ready"}
      </h1>
      {stage < 3 && !stuck && (
        <p className="mt-2 font-medium text-slate-600 dark:text-slate-400">This usually takes about two minutes. You can stay here.</p>
      )}

      <ol className="mt-8 space-y-3" aria-live="polite">
        {steps.map((label, i) => {
          const done = stage > i || stage === 3;
          const current = stage === i && stage < 3;
          return (
            <li key={label} className="flex items-center gap-3 font-bold">
              <span
                className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm ${
                  done
                    ? "bg-emerald-600 text-white"
                    : current
                      ? "bg-murzak-accent text-murzak-ink"
                      : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300"
                }`}
              >
                {done ? <Check size={16} aria-hidden="true" /> : current ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : i + 1}
              </span>
              <span className={done || current ? "text-murzak-ink dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}>
                {label}
                <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : " (waiting)"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {(slow || stuck) && (
        <div role="status" className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
          <p className="font-black text-murzak-ink dark:text-slate-100">Your payment is safe.</p>
          <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
            Setup is taking longer than usual. Message us and we'll check it right away — your POS will also appear in your portal as soon as it's ready.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" onClick={() => navigate("/portal/support")} className={`inline-flex items-center gap-1.5 ${linkClass.replace(" underline underline-offset-2", "")}`}>
              <LifeBuoy size={14} /> Message support
            </button>
            <button type="button" onClick={() => navigate("/portal/overview")} className={linkClass}>
              Go to my portal
            </button>
          </div>
        </div>
      )}

      {stage === 3 && safeUrl && (
        <>
          {job.posLogin ? (
            <PosLoginPanel posUrl={safeUrl} login={job.posLogin} />
          ) : (
            <div className="mt-6 glass-card rounded-2xl p-5">
              <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Your POS address</p>
              <p className="mt-1 font-bold break-all text-murzak-ink dark:text-slate-100">{safeUrl}</p>
            </div>
          )}
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black bg-murzak-accent text-murzak-ink"
          >
            Open your POS <ExternalLink size={16} aria-hidden="true" />
          </a>
          {info && <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">{info.afterPayment}</p>}
          <button type="button" onClick={() => navigate("/portal/overview")} className={`mt-6 ${linkClass}`}>
            Go to my portal
          </button>
        </>
      )}
    </div>
  );
};

export default AppWelcome;
