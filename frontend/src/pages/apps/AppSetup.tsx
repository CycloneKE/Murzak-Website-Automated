import React, { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toUserMessage } from "../../services/errors";
import ShopAddressField from "../../components/apps/ShopAddressField";
import InlineAccount from "../../components/apps/InlineAccount";
import { formatKes, getService, servicesForApp } from "../../config/serviceCatalog";
import { APP_CHECKOUT, appIdFromRoute, annualKes } from "../../config/appCheckout";
import { AppOrderError, createAppOrder } from "../../services/appCheckout";

interface AppSetupProps {
  user: any | null;
  onUserUpdate: (user: any) => void;
}

type Term = "monthly" | "annual";

const MUTED = "text-slate-500 dark:text-slate-400";

const AppSetup: React.FC<AppSetupProps> = ({ user, onUserUpdate }) => {
  const navigate = useNavigate();
  const app = appIdFromRoute(useParams<{ app: string }>().app);
  const [params] = useSearchParams();
  const tiers = useMemo(() => (app ? servicesForApp(app) : []), [app]);

  const requested = getService(params.get("service") || "");
  const [serviceId, setServiceId] = useState<string>(
    requested && requested.app === app ? requested.id : (tiers.find((t) => t.appPopular) || tiers[0])?.id || ""
  );
  const [term, setTerm] = useState<Term>(params.get("term") === "annual" ? "annual" : "monthly");
  const [shopName, setShopName] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([]);
  const [waitlisted, setWaitlisted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState("");

  // All hooks above run on every render; this early return must stay below them.
  if (!app) return <Navigate to="/products" replace />;
  const info = APP_CHECKOUT[app];
  const tier = getService(serviceId);
  const monthly = tier?.pricing.monthlyKes ?? 0;
  const total = term === "annual" ? annualKes(monthly) : monthly;

  const canContinue = !!user && !!slug && !!shopName.trim() && !!tier && !submitting;

  const submit = async () => {
    if (!canContinue || !slug || !tier) return;
    setSubmitting(true);
    setError("");
    setErrorCode("");
    setServerSuggestions([]);
    try {
      const { orderId } = await createAppOrder({ serviceId: tier.id, term, shopName: shopName.trim(), slug });
      navigate(`/checkout/${encodeURIComponent(orderId)}`);
    } catch (e: any) {
      if (e instanceof AppOrderError) {
        setError(e.message);
        setErrorCode(e.code || "");
        if (e.code === "slug_taken") {
          // The address is no longer usable: block the CTA until a new one checks out.
          setSlug(null);
          setServerSuggestions(e.suggestions || []);
        } else if (e.code === "slug_invalid") {
          setSlug(null);
        }
      } else {
        setError(toUserMessage(e, "We couldn't start your order. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // CAPACITY only happens at order creation, which requires a signed-in
  // account — so the existing account-scoped waitlist route always applies.
  const joinWaitlist = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const res = await fetch("/api/orders/waitlist", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setWaitlisted(true);
      setError("");
      setNotice("We're full right now — you're on the list and we'll message you as soon as a shop slot opens.");
    } catch (e: any) {
      setError(toUserMessage(e, "We couldn't add you to the waitlist. Please try again."));
    } finally {
      setJoining(false);
    }
  };

  const onTierChange = (id: string) => {
    setServiceId(id);
    // APP_EXISTS is account-level, so changing the tier must not clear it.
    setErrorCode((c) => (c === "APP_EXISTS" ? c : ""));
    setWaitlisted(false);
    setError("");
    setNotice("");
    // serverSuggestions are about the shop ADDRESS, not the tier: keep them so a
    // rejected address stays marked as taken until the shop name changes.
  };

  const onCta = errorCode === "CAPACITY" ? joinWaitlist : submit;
  const appExists = errorCode === "APP_EXISTS";
  // APP_EXISTS is account-level: keep the CTA disabled until a reload or re-sign-in.
  const ctaDisabled = waitlisted || joining || appExists || (errorCode !== "CAPACITY" && !canContinue);
  const ctaLabel = waitlisted
    ? "You're on the list"
    : errorCode === "CAPACITY"
      ? "Join the waitlist"
      : `Continue to payment · ${formatKes(total)}`;
  const busy = submitting || joining;

  // First unmet requirement, shown beside a disabled CTA.
  const hint = !ctaDisabled || waitlisted || joining || appExists
    ? ""
    : !user
      ? "Create your account or sign in to continue."
      : !shopName.trim()
        ? "Enter your shop's name."
        : !slug
          ? "Choose an available shop address."
          : "";

  const showError = !!error && !appExists;
  const messages = (extra: string) => (
    <>
      {appExists && (
        <p className={`${extra} text-sm font-bold text-red-600 dark:text-red-400`} role="alert">
          You already have a shop on this account.{" "}
          <Link to="/portal/overview" className="underline underline-offset-2 text-murzak-accent">Go to my portal</Link>
        </p>
      )}
      {showError && <p className={`${extra} text-sm font-bold text-red-600 dark:text-red-400`} role="alert">{error}</p>}
      {notice && <p className={`${extra} text-sm font-bold text-emerald-700 dark:text-emerald-400`} role="status">{notice}</p>}
    </>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-56 lg:pb-16">
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-murzak-ink dark:text-slate-100">Set up your shop</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400 font-medium">{info.productName}, ready about two minutes after payment.</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8 order-2 lg:order-1">
          <section className="glass-card rounded-3xl p-6 sm:p-8">
            <ShopAddressField
              app={app}
              shopName={shopName}
              onShopNameChange={(n) => { setShopName(n); setServerSuggestions([]); setError(""); setErrorCode((c) => (c === "APP_EXISTS" ? c : "")); }}
              onSlugChange={setSlug}
              suggestionsFromServer={serverSuggestions}
            />
          </section>

          <section className="glass-card rounded-3xl p-6 sm:p-8">
            <h2 className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-4">Your details</h2>
            <InlineAccount user={user} companyHint={shopName} onSignedIn={onUserUpdate} />
          </section>

          {errorCode === "APP_EXISTS" && (
            <section className="rounded-3xl border border-murzak-accent/30 bg-murzak-accent/5 p-6">
              <p className="font-black text-murzak-ink dark:text-slate-100">You already have a shop on this account.</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-400">
                Open it from your portal. Want a second, separate shop? Message support and we'll set it up.
              </p>
              <button type="button" onClick={() => navigate("/portal/overview")} className="mt-4 text-sm font-black text-murzak-accent underline underline-offset-2">
                Go to my portal →
              </button>
            </section>
          )}
        </div>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-28 self-start glass-card rounded-3xl p-6">
          <p className="text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400">Your order</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <label htmlFor="tier" className="sr-only">Tier</label>
            <select
              id="tier"
              value={serviceId}
              onChange={(e) => onTierChange(e.target.value)}
              className="w-full rounded-xl px-3 py-2 font-black bg-white/70 dark:bg-slate-800 border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-murzak-accent"
            >
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>{info.productName} · {t.appPlan}</option>
              ))}
            </select>
          </div>
          <div role="radiogroup" aria-label="Billing" className="mt-4 grid grid-cols-2 gap-2">
            {(["monthly", "annual"] as Term[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={term === t}
                onClick={() => setTerm(t)}
                className={`px-3 py-2 rounded-xl text-sm font-black border ${
                  term === t
                    ? "border-murzak-accent bg-murzak-accent/10 text-murzak-ink dark:text-slate-100"
                    : `border-slate-200 dark:border-murzak-border ${MUTED}`
                }`}
              >
                {t === "monthly" ? "Monthly" : "Annual · save 20%"}
              </button>
            ))}
          </div>
          {term === "annual" && (
            <p className={`mt-2 text-xs font-semibold ${MUTED}`}>Annual prepay is for first-time customers. The final amount is confirmed on the next screen.</p>
          )}
          {slug && (
            <p className="mt-4 text-sm font-semibold text-slate-600 dark:text-slate-400 break-all">
              <span className="font-mono">{slug}.{info.addressSuffix}</span>
            </p>
          )}
          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-murzak-border flex items-baseline justify-between">
            <span className="font-black text-murzak-ink dark:text-slate-100">{term === "annual" ? "Due today (estimate)" : "Due today"}</span>
            <span className="text-2xl font-black text-murzak-ink dark:text-slate-100">{formatKes(total)}</span>
          </div>
          <p className={`mt-3 text-xs font-semibold flex items-center gap-1.5 ${MUTED}`}>
            <ShieldCheck size={14} className="text-murzak-accent shrink-0" /> 14-day money-back · Cancel anytime · Pay with M-Pesa
          </p>

          {messages("mt-4 hidden lg:block")}

          <button
            type="button"
            onClick={onCta}
            disabled={ctaDisabled}
            className="hidden lg:flex mt-5 w-full items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-40"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {ctaLabel} <ArrowRight size={16} />
          </button>
          {hint && <p className={`hidden lg:block mt-2 text-xs font-semibold ${MUTED}`}>{hint}</p>}
        </aside>
      </div>

      {/* Phone: sticky action bar */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 p-4 bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-murzak-border backdrop-blur"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {messages("mb-2 text-center")}
        {hint && <p className={`mb-2 text-center text-xs font-semibold ${MUTED}`}>{hint}</p>}
        <button
          type="button"
          onClick={onCta}
          disabled={ctaDisabled}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-40"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {ctaLabel}
        </button>
      </div>
    </div>
  );
};

export default AppSetup;
