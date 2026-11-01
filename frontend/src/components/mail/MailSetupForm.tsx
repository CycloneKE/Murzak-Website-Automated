import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, Loader2, X } from "lucide-react";
import InlineAccount from "../apps/InlineAccount";
import { checkDomain, TLD_OPTIONS } from "../../services/domains";
import { MailError, mailboxNameProblem, normalizeMpesa } from "../../services/mail";
import { formatKes, getService } from "../../config/serviceCatalog";
import type { MailPlanId, MailSetup } from "../../types";

/**
 * Domain-first order form for business email. It only collects and checks
 * input; the page decides what happens on submit (it creates the order and
 * sends the buyer into the normal /checkout/:orderId flow).
 */

export const MAIL_PLAN_IDS: MailPlanId[] = ["mail-starter", "mail-business", "mail-pro"];
export const MPESA_PREFILL_KEY = "murzak_mpesa_prefill";

const INPUT =
  "w-full rounded-2xl px-5 py-3.5 font-bold bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-murzak-border text-murzak-ink dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-murzak-accent";
const LABEL = "text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400";
const MUTED = "text-slate-600 dark:text-slate-400";
const ERR = "text-sm font-bold text-red-600 dark:text-red-400";

type DomainOutcome =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "invalid"; message: string }
  | { kind: "new"; domain: string; priceKes: number }
  | { kind: "ke"; domain: string; priceKes: number }
  | { kind: "own"; domain: string };

/** Lowercase, strip protocol, "www." and any path; "" when nothing usable is left. */
export function cleanDomainInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.+$/, "");
}

const DOMAIN_SHAPE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z]{2,63})$/;

function perMailbox(planId: MailPlanId): { text: string; approx: boolean } | null {
  const svc = getService(planId);
  const monthly = svc?.pricing.monthlyKes;
  const n = svc?.mailboxes;
  if (!monthly || !n) return null;
  return { text: formatKes(Math.round(monthly / n)), approx: monthly % n !== 0 };
}

interface Props {
  user: { email?: string; name?: string } | null;
  onUserUpdate: (user: any) => void;
  initialPlanId?: MailPlanId;
  /** Throws (ideally a MailError) when the order could not be created. */
  onSubmit: (setup: MailSetup, mpesaNumber: string) => Promise<void>;
}

const MailSetupForm: React.FC<Props> = ({ user, onUserUpdate, initialPlanId = "mail-starter", onSubmit }) => {
  const [domainInput, setDomainInput] = useState("");
  const [outcome, setOutcome] = useState<DomainOutcome>({ kind: "idle" });
  const [planId, setPlanId] = useState<MailPlanId>(initialPlanId);
  const [names, setNames] = useState<string[]>(["info"]);
  const [draft, setDraft] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactEdited, setContactEdited] = useState(false);
  const [mpesa, setMpesa] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const lookupSeq = useRef(0);

  const plan = getService(planId);
  const mailboxLimit = plan?.mailboxes ?? 0;
  const planMonthly = plan?.pricing.monthlyKes ?? 0;

  // Prefill the contact address from the account (until the buyer edits it).
  useEffect(() => {
    if (user?.email && !contactEdited) setContactEmail(user.email);
  }, [user?.email, contactEdited]);

  // Debounced domain check. A sequence number drops answers to stale input.
  useEffect(() => {
    const cleaned = cleanDomainInput(domainInput);
    if (!cleaned) { lookupSeq.current++; setOutcome({ kind: "idle" }); return; }
    const m = DOMAIN_SHAPE.exec(cleaned);
    if (!m) {
      lookupSeq.current++;
      setOutcome({ kind: "invalid", message: "Type the full domain, for example acme.com or acme.co.ke." });
      return;
    }
    const label = m[1];
    const tld = `.${m[2]}`;
    const option = TLD_OPTIONS.find((t) => t.tld === tld);
    const seq = ++lookupSeq.current;
    setOutcome({ kind: "checking" });
    const timer = window.setTimeout(async () => {
      let next: DomainOutcome;
      if (tld === ".ke" || tld === ".co.ke") {
        // Registered by our team, not instantly: no live lookup.
        next = { kind: "ke", domain: cleaned, priceKes: option?.priceKes ?? 0 };
      } else if (!option) {
        // A TLD we cannot register (or a subdomain): treat it as the customer's own.
        next = { kind: "own", domain: cleaned };
      } else {
        try {
          const rows = await checkDomain(label, [option]);
          const row = rows.find((r) => r.domain === cleaned);
          next = row && row.available ? { kind: "new", domain: cleaned, priceKes: row.priceKes } : { kind: "own", domain: cleaned };
        } catch {
          next = { kind: "invalid", message: "We couldn't check that name just now. Please try again in a moment." };
        }
      }
      if (seq === lookupSeq.current) setOutcome(next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [domainInput]);

  const domain = outcome.kind === "new" || outcome.kind === "ke" || outcome.kind === "own" ? outcome.domain : "";
  const domainMode: "new" | "own" = outcome.kind === "own" ? "own" : "new";
  const domainPriceKes = outcome.kind === "new" || outcome.kind === "ke" ? outcome.priceKes : 0;
  const totalKes = planMonthly + domainPriceKes;

  const draftProblem = draft ? mailboxNameProblem(draft) || (names.includes(draft) ? "You already added that name." : "") : "";

  const addDraft = () => {
    const name = draft.trim();
    if (!name || mailboxNameProblem(name) || names.includes(name)) return;
    if (names.length >= mailboxLimit) return;
    setNames([...names, name]);
    setDraft("");
  };

  const mpesaNormalized = normalizeMpesa(mpesa);
  const contactProblem = (() => {
    const e = contactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Enter a valid contact email address.";
    if (domain && e.toLowerCase().endsWith(`@${domain}`)) return "Use an email address outside the domain you are setting up.";
    return "";
  })();
  const mailboxProblem = names.length === 0
    ? "Add at least one mailbox."
    : names.length > mailboxLimit
      ? `This plan includes ${mailboxLimit} mailboxes. Remove ${names.length - mailboxLimit} or choose a bigger plan.`
      : "";
  const problems: Record<string, string> = {};
  if (!domain) problems.domain = outcome.kind === "invalid" ? outcome.message : "Enter the domain you want email on.";
  if (mailboxProblem) problems.mailboxes = mailboxProblem;
  if (businessName.trim().length < 2) problems.businessName = "Enter your business name.";
  if (contactProblem) problems.contactEmail = contactProblem;
  if (!mpesaNormalized) problems.mpesa = "Enter your M-Pesa number as 2547XXXXXXXX.";
  const shown = (k: string) => fieldErrors[k] || (showErrors ? problems[k] : "") || "";

  const submit = async () => {
    setError("");
    setFieldErrors({});
    if (!user) { setError("Create your account or sign in to continue."); return; }
    if (outcome.kind === "checking") { setError("Hold on, we are still checking your domain."); return; }
    if (Object.keys(problems).length) { setShowErrors(true); return; }
    setSubmitting(true);
    try {
      try { sessionStorage.setItem(MPESA_PREFILL_KEY, mpesaNormalized as string); } catch { /* optional */ }
      await onSubmit(
        {
          planId,
          businessName: businessName.trim(),
          domain,
          domainMode,
          contactEmail: contactEmail.trim(),
          mailboxes: names,
        },
        mpesaNormalized as string,
      );
    } catch (e) {
      if (e instanceof MailError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors);
      } else {
        setError("We couldn't start your order. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const planCards = useMemo(() => MAIL_PLAN_IDS.map((id) => ({ id, svc: getService(id) })).filter((p) => p.svc), []);

  return (
    <div className="space-y-8">
      {/* 1. Domain */}
      <section className="glass-card rounded-3xl p-5 sm:p-8">
        <label htmlFor="mail-domain" className={LABEL}>1. Your domain</label>
        <input
          id="mail-domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={domainInput}
          onChange={(e) => { setDomainInput(e.target.value); setFieldErrors((f) => ({ ...f, domain: "" })); }}
          placeholder="yourbusiness.com"
          className={`${INPUT} mt-3`}
          aria-describedby="mail-domain-result"
        />
        <div id="mail-domain-result" className="mt-3 min-h-6" aria-live="polite">
          {outcome.kind === "checking" && (
            <p className={`text-sm font-semibold flex items-center gap-2 ${MUTED}`}><Loader2 size={14} className="animate-spin" /> Checking…</p>
          )}
          {outcome.kind === "invalid" && <p className={ERR}>{outcome.message}</p>}
          {outcome.kind === "new" && (
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
              <Check size={16} className="shrink-0 mt-0.5" />
              <span><span className="break-all">{outcome.domain}</span> is available. We register it for you at {formatKes(outcome.priceKes)}/yr and set up your email on it.</span>
            </p>
          )}
          {outcome.kind === "ke" && (
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
              <Check size={16} className="shrink-0 mt-0.5" />
              <span>We register <span className="break-all">{outcome.domain}</span> for you within one working day, then finish your email setup. {formatKes(outcome.priceKes)}/yr.</span>
            </p>
          )}
          {outcome.kind === "own" && (
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
              <Check size={16} className="shrink-0 mt-0.5" />
              <span><span className="break-all">{outcome.domain}</span> is not available to register here, so we will set your email up on it as a domain you already own. After payment we show you the few records to add where you manage it.</span>
            </p>
          )}
          {shown("domain") && (outcome.kind === "idle" || fieldErrors.domain) && <p className={ERR}>{shown("domain")}</p>}
        </div>
      </section>

      {/* 2. Plan */}
      <section className="glass-card rounded-3xl p-5 sm:p-8">
        <p className={LABEL}>2. Choose a plan</p>
        <div role="radiogroup" aria-label="Email plan" className="mt-4 grid gap-3 sm:grid-cols-3">
          {planCards.map(({ id, svc }) => {
            const per = perMailbox(id);
            const active = id === planId;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPlanId(id)}
                className={`text-left rounded-2xl p-4 border-2 transition-colors ${
                  active
                    ? "border-murzak-accent bg-murzak-accent/10"
                    : "border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-white/5 hover:border-murzak-accent/50"
                }`}
              >
                <p className="font-black text-murzak-ink dark:text-slate-100">{svc!.name.replace(/^Business Email \(|\)$/g, "")}</p>
                <p className="mt-1 text-2xl font-black text-murzak-ink dark:text-slate-100">{formatKes(svc!.pricing.monthlyKes)}<span className={`text-sm font-bold ${MUTED}`}>/mo</span></p>
                <p className={`mt-1 text-sm font-semibold ${MUTED}`}>{svc!.mailboxes} mailboxes · {svc!.specs.storage.replace(" / mailbox", "")} each</p>
                {per && <p className="mt-2 text-xs font-black text-emerald-700 dark:text-emerald-400">{per.approx ? "about " : ""}{per.text} per mailbox</p>}
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Mailboxes */}
      <section className="glass-card rounded-3xl p-5 sm:p-8">
        <label htmlFor="mail-box-name" className={LABEL}>3. Your mailboxes</label>
        <p className={`mt-2 text-sm font-semibold ${MUTED}`}>
          Up to {mailboxLimit} on this plan. The first one is your main address. You can add more later.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Mailboxes to create">
          {names.map((n, i) => (
            <li key={n} className="inline-flex items-center gap-1 max-w-full rounded-full pl-4 pr-1.5 py-1.5 bg-murzak-accent/10 border border-murzak-accent/30 text-sm font-bold text-murzak-ink dark:text-slate-100">
              <span className="break-all">{n}@{domain || "yourdomain"}</span>
              {i === 0 && <span className="text-micro font-black uppercase text-sky-700 dark:text-murzak-accent ml-1">main</span>}
              <button
                type="button"
                onClick={() => setNames(names.filter((x) => x !== n))}
                className="ml-1 rounded-full p-1 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                aria-label={`Remove ${n}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        {names.length < mailboxLimit && (
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <input
              id="mail-box-name"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addDraft(); } }}
              placeholder="sales"
              className={INPUT}
              aria-invalid={!!draftProblem}
            />
            <button
              type="button"
              onClick={addDraft}
              disabled={!draft || !!draftProblem}
              className="shrink-0 px-6 py-3.5 rounded-2xl font-black text-sm border border-murzak-accent text-murzak-ink dark:text-slate-100 hover:bg-murzak-accent/10 disabled:opacity-40"
            >
              Add mailbox
            </button>
          </div>
        )}
        {draftProblem && <p className={`mt-2 ${ERR}`}>{draftProblem}</p>}
        {shown("mailboxes") && <p className={`mt-2 ${ERR}`}>{shown("mailboxes")}</p>}
      </section>

      {/* 4. Details */}
      <section className="glass-card rounded-3xl p-5 sm:p-8 space-y-5">
        <p className={LABEL}>4. Your details</p>
        <InlineAccount user={user} companyHint={businessName} onSignedIn={onUserUpdate} />
        <div>
          <label htmlFor="mail-biz" className={`${LABEL} block mb-2`}>Business name</label>
          <input id="mail-biz" type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Ltd" maxLength={80} className={INPUT} />
          {shown("businessName") && <p className={`mt-2 ${ERR}`}>{shown("businessName")}</p>}
        </div>
        <div>
          <label htmlFor="mail-contact" className={`${LABEL} block mb-2`}>Contact email</label>
          <input
            id="mail-contact"
            type="email"
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => { setContactEmail(e.target.value); setContactEdited(true); }}
            placeholder="you@gmail.com"
            className={INPUT}
          />
          <p className={`mt-1 text-xs font-semibold ${MUTED}`}>Where we send your setup updates and password codes. Use an address outside your new domain.</p>
          {shown("contactEmail") && <p className={`mt-1 ${ERR}`}>{shown("contactEmail")}</p>}
        </div>
        <div>
          <label htmlFor="mail-mpesa" className={`${LABEL} block mb-2`}>M-Pesa number</label>
          <input id="mail-mpesa" type="tel" inputMode="numeric" autoComplete="tel" value={mpesa} onChange={(e) => setMpesa(e.target.value)} placeholder="2547XXXXXXXX" className={INPUT} />
          {shown("mpesa") && <p className={`mt-2 ${ERR}`}>{shown("mpesa")}</p>}
        </div>
      </section>

      {/* Total + submit */}
      <section className="glass-card rounded-3xl p-5 sm:p-8">
        <dl className="space-y-2 text-sm font-semibold">
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>Email plan (per month)</dt>
            <dd className="font-black text-murzak-ink dark:text-slate-100">{formatKes(planMonthly)}</dd>
          </div>
          {domainPriceKes > 0 && (
            <div className="flex justify-between gap-4">
              <dt className={MUTED}>Domain registration (per year)</dt>
              <dd className="font-black text-murzak-ink dark:text-slate-100">{formatKes(domainPriceKes)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 pt-3 border-t border-slate-200 dark:border-murzak-border">
            <dt className="font-black text-murzak-ink dark:text-slate-100">Total</dt>
            <dd className="text-2xl font-black text-murzak-ink dark:text-slate-100">{formatKes(totalKes)}</dd>
          </div>
        </dl>
        {domainPriceKes > 0 && <p className={`mt-3 text-xs font-semibold ${MUTED}`}>Domain names cannot be refunded once registered.</p>}
        {error && (
          <p role="alert" className={`mt-4 flex items-start gap-2 ${ERR}`}>
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-5 w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-40"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          Continue to payment · {formatKes(totalKes)} <ArrowRight size={16} />
        </button>
        <p className={`mt-3 text-xs font-semibold text-center ${MUTED}`}>Pay with M-Pesa on the next screen.</p>
      </section>
    </div>
  );
};

export default MailSetupForm;
