import React, { useEffect, useState } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import DomainSearch from "./DomainSearch";
import { Button } from "./ui/Button";
import { domainCatalogIdForTld, formatKes } from "../config/serviceCatalog";
import { tldOfDomain } from "../services/bundles";
import { checkDomain, TLD_OPTIONS } from "../services/domains";
import { toUserMessage } from "../services/errors";

// The one way a domain is bought on the storefront:
//   search -> pick a name -> review the order -> sign in if needed -> pay.
// Nothing is created until "Continue to payment", so picking a name is free
// to undo, and a signed-out buyer's pick survives the trip through /login.

const PENDING_KEY = "murzak.domain.pending";
const PENDING_TTL_MS = 30 * 60 * 1000;

// Endings Hostinger registers for us the moment payment clears; the rest are
// registered by the team.
const INSTANT_TLDS = [".com", ".org", ".net", ".io"];

type Pick = { domain: string; priceKes: number };

function readPending(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { domain?: string; at?: number };
    sessionStorage.removeItem(PENDING_KEY);
    if (!p?.domain || typeof p.at !== "number" || Date.now() - p.at > PENDING_TTL_MS) return null;
    return p.domain;
  } catch {
    return null;
  }
}

interface Props {
  isLoggedIn: boolean;
  onNavigate: (path: string) => void;
  /** Where /login sends the buyer back to (the page hosting this component). */
  returnTo: string;
}

const STEPS = ["Search", "Review", "Pay", "Registered"];

export default function DomainOrder({ isLoggedIn, onNavigate, returnTo }: Props) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Coming back from /login: restore the name the buyer picked, but re-check
  // it so the price and availability shown are current, never remembered.
  useEffect(() => {
    const domain = readPending();
    if (!domain) return;
    const tld = tldOfDomain(domain);
    const option = TLD_OPTIONS.find((t) => t.tld === tld);
    if (!tld || !option) return;
    let live = true;
    checkDomain(domain.slice(0, -tld.length), [option]).then((results) => {
      const hit = results.find((r) => r.domain === domain);
      if (!live) return;
      if (hit?.available) setPick({ domain: hit.domain, priceKes: hit.priceKes });
      else setError(`${domain} is no longer available. Search for another name.`);
    });
    return () => {
      live = false;
    };
  }, []);

  const tld = pick ? tldOfDomain(pick.domain) : null;
  const instant = !!tld && INSTANT_TLDS.includes(tld);
  const step = pick ? 1 : 0;

  const continueToPayment = async () => {
    if (!pick || submitting) return;
    setError("");
    const serviceId = tld ? domainCatalogIdForTld(tld) : null;
    if (!serviceId) {
      setError("That ending isn't available to buy yet. Pick another one.");
      return;
    }
    if (!isLoggedIn) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ domain: pick.domain, at: Date.now() }));
      } catch {
        /* storage blocked: the buyer searches again after signing in */
      }
      onNavigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serviceId, config: { domain: pick.domain, priceKes: pick.priceKes }, source: "cloud-domains-page" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.order) {
        setError(toUserMessage(data?.error, "We couldn't start checkout. Please try again."));
        return;
      }
      onNavigate(`/checkout/${data.order.id}`);
    } catch {
      setError("We couldn't start checkout. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="domain-order">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold" aria-label="Steps to register a domain">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums ${
                i <= step
                  ? "bg-murzak-ink text-white dark:bg-slate-100 dark:text-murzak-ink"
                  : "border border-murzak-border dark:border-white/15 text-slate-500 dark:text-slate-400"
              }`}
            >
              {i + 1}
            </span>
            <span className={i <= step ? "text-murzak-ink dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-murzak-border dark:bg-white/15" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <DomainSearch
        selectedDomain={pick?.domain}
        onSelect={(domain, priceKes) => {
          setError("");
          setPick({ domain, priceKes });
        }}
        hideSelectionNote
        label="Type the name you want"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm font-bold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {pick && (
        <section
          data-testid="domain-order-review"
          aria-labelledby="domain-order-review-title"
          className="mt-4 rounded-2xl border border-murzak-ink/15 dark:border-white/15 bg-white dark:bg-white/5 p-5 sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 id="domain-order-review-title" className="text-sm font-bold text-slate-600 dark:text-slate-400">
                Your order
              </h3>
              <p className="mt-1 text-xl font-extrabold break-all text-murzak-ink dark:text-slate-100">{pick.domain}</p>
            </div>
            <button
              type="button"
              onClick={() => setPick(null)}
              className="shrink-0 inline-flex items-center gap-1 text-sm font-bold text-slate-600 dark:text-slate-400 underline underline-offset-4"
            >
              <X size={14} /> Remove
            </button>
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600 dark:text-slate-400">Registration, 1 year</dt>
              <dd className="font-bold tabular-nums text-murzak-ink dark:text-slate-100">{formatKes(pick.priceKes)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-murzak-border dark:border-white/10 pt-2">
              <dt className="font-bold text-murzak-ink dark:text-slate-100">Due today</dt>
              <dd className="font-extrabold tabular-nums text-murzak-ink dark:text-slate-100">{formatKes(pick.priceKes)}</dd>
            </div>
          </dl>

          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {instant
              ? "The name is registered to you as soon as your payment goes through."
              : "After payment our team registers the name for you and emails you when it is done."}{" "}
            It renews once a year at the price shown, and you manage it from your portal.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button onClick={continueToPayment} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              {isLoggedIn ? "Continue to payment" : "Sign in to continue"} <ArrowRight size={16} />
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {isLoggedIn ? "Pay by M-Pesa or card on the next page." : "We keep this name selected while you sign in or create an account."}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
