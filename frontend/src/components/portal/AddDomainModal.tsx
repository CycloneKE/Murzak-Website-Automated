import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowLeft, Gift, Globe, Link2, Loader2, ShieldCheck, X } from "lucide-react";
import { toUserMessage } from "../../services/errors";

/**
 * Self-service domain onboarding — three intake endpoints already existed
 * (register / bring-your-own / free subdomain) but the only customer-facing
 * entry point was "open a support chat." This replaces that with a guided
 * screen that calls those endpoints directly.
 *
 * A request submitted here still needs a human to fulfil it — this path
 * creates a Hosting Domain Purchase Request directly, with no invoice behind
 * it, so it never reaches the automated registration in
 * domainPurchaseFulfilment.js (that only fires for a domain-* catalog item
 * bought and paid for at checkout — see backend/services/hostingerDomains.js).
 * A human still has to fulfil a "connect a domain you own" verification too;
 * that path has no registration step at all.
 */

type DomainPath = "register" | "external" | "subdomain";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onRequestNewDomain: (input: { requestedName: string; requestedTld: string; notes?: string }) => Promise<void>;
  onConnectExternalDomain: (input: { domainName: string; registrar?: string; notes?: string }) => Promise<void>;
  onRequestFreeSubdomain: (input: { requestedLabel: string; notes?: string }) => Promise<void>;
};

const TLD_OPTIONS = [".com", ".co.ke", ".net", ".org", ".tech", ".africa"];

const PATHS: Array<{
  id: DomainPath;
  icon: React.ReactNode;
  title: string;
  description: string;
}> = [
  {
    id: "register",
    icon: <Globe className="w-5 h-5" />,
    title: "Register a new domain",
    description: "Pick a name, and we'll handle registration. It appears here once it's live.",
  },
  {
    id: "external",
    icon: <Link2 className="w-5 h-5" />,
    title: "Connect a domain you own",
    description: "Already have one elsewhere? Point it at us and we'll verify it.",
  },
  {
    id: "subdomain",
    icon: <Gift className="w-5 h-5" />,
    title: "Free Murzak subdomain",
    description: "No cost, live almost instantly. Good for testing or a quick launch.",
  },
];

export default function AddDomainModal({
  isOpen,
  onClose,
  onRequestNewDomain,
  onConnectExternalDomain,
  onRequestFreeSubdomain,
}: Props) {
  const [path, setPath] = useState<DomainPath | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollYRef = useRef(0);

  // Register-a-domain fields
  const [name, setName] = useState("");
  const [tld, setTld] = useState(TLD_OPTIONS[0]);
  // Bring-your-own fields
  const [domainName, setDomainName] = useState("");
  const [registrar, setRegistrar] = useState("");
  // Free subdomain fields
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setPath(null);
      setErr("");
      setSubmitting(false);
      setName("");
      setTld(TLD_OPTIONS[0]);
      setDomainName("");
      setRegistrar("");
      setLabel("");
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const y = window.scrollY || 0;
    scrollYRef.current = y;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollYRef.current || 0);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (fn: () => Promise<void>) => {
    setErr("");
    setSubmitting(true);
    try {
      await fn();
      onClose();
    } catch (e: any) {
      setErr(toUserMessage(e, "That didn't go through. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const registerLabelValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name.trim());
  const subdomainLabelValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label.trim());
  const domainNameValid = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    domainName.trim()
  );

  return createPortal(
    <div className="fixed inset-0 z-140">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-xl max-h-[92vh] bg-p-panel rounded-lg sm:rounded-lg overflow-hidden border border-p-border flex flex-col min-h-0 shadow-2xl">
          <div className="px-5 sm:px-8 py-4 sm:py-5 border-b border-p-accent/40 bg-p-panel text-p-text flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              {path && (
                <button
                  type="button"
                  onClick={() => { setErr(""); setPath(null); }}
                  className="shrink-0 rounded-md p-2 border border-p-border text-p-muted hover:text-p-accent-text hover:border-p-accent transition-all"
                  aria-label="Back"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-p-accent-text">Domains</p>
                <h3 className="text-lg sm:text-2xl sm:leading-(--text-2xl--line-height) font-semibold text-p-text mt-0.5 leading-tight">
                  {path ? PATHS.find((p) => p.id === path)?.title : "Add a domain"}
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-2 sm:p-3 border border-p-border text-p-muted hover:text-p-accent-text hover:border-p-accent transition-all bg-p-panel-2"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div ref={bodyRef} className="p-5 sm:p-6 flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {!path && (
              <div className="grid grid-cols-1 gap-3">
                {PATHS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPath(p.id)}
                    className="text-left rounded-lg p-5 border border-p-accent/40 bg-p-panel hover:border-p-accent transition-all flex items-start gap-4"
                  >
                    <div className="shrink-0 w-10 h-10 rounded-lg bg-p-accent-soft text-p-accent-text flex items-center justify-center">
                      {p.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-p-text ">{p.title}</p>
                      <p className="text-xs font-medium text-p-muted mt-1 leading-relaxed">
                        {p.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {path === "register" && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-p-muted ">
                    Domain name
                  </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="yourbrand"
                      className="flex-1 h-12 px-4 rounded-md bg-p-panel-2 border border-p-border text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"
                    />
                    <select
                      value={tld}
                      onChange={(e) => setTld(e.target.value)}
                      className="h-12 px-3 rounded-md bg-p-panel-2 border border-p-border text-sm font-semibold text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"
                    >
                      {TLD_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  {name && !registerLabelValid && (
                    <p className="mt-2 text-xs font-medium text-p-danger">That doesn't look like a valid domain label.</p>
                  )}
                </div>
                <p className="text-xs font-medium text-p-muted leading-relaxed">
                  This creates a registration request against your active hosting plan. We'll email you once {name || "yourbrand"}{tld} is live.
                </p>
                {/* Required by Hostinger's Domain Name Registration Agreement
                    §7: resellers must inform the customer they are "in fact
                    registering their domain name through Hostinger." */}
                <p className="text-xs font-medium text-p-muted leading-relaxed">
                  Domains are registered through our infrastructure partner, Hostinger.
                </p>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!registerLabelValid}
                  label="Request this domain"
                  onClick={() =>
                    submit(() => onRequestNewDomain({ requestedName: name.trim(), requestedTld: tld }))
                  }
                />
              </div>
            )}

            {path === "external" && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-p-muted ">
                    Domain name
                  </label>
                  <input
                    autoFocus
                    value={domainName}
                    onChange={(e) => setDomainName(e.target.value)}
                    placeholder="yourbrand.com"
                    className="mt-2 w-full h-12 px-4 rounded-md bg-p-panel-2 border border-p-border text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"
                  />
                  {domainName && !domainNameValid && (
                    <p className="mt-2 text-xs font-medium text-p-danger">That doesn't look like a valid domain.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-p-muted ">
                    Where it's registered (optional)
                  </label>
                  <input
                    value={registrar}
                    onChange={(e) => setRegistrar(e.target.value)}
                    placeholder="e.g. GoDaddy, Namecheap"
                    className="mt-2 w-full h-12 px-4 rounded-md bg-p-panel-2 border border-p-border text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"
                  />
                </div>
                <p className="text-xs font-medium text-p-muted leading-relaxed">
                  We'll send you the nameservers or DNS records to add at your registrar, then verify it once they propagate.
                </p>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!domainNameValid}
                  label="Connect this domain"
                  onClick={() =>
                    submit(() =>
                      onConnectExternalDomain({ domainName: domainName.trim(), registrar: registrar.trim() || undefined })
                    )
                  }
                />
              </div>
            )}

            {path === "subdomain" && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-p-muted ">
                    Subdomain label
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="yourbrand"
                      className="flex-1 h-12 px-4 rounded-md bg-p-panel-2 border border-p-border text-sm font-medium text-p-text focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"
                    />
                    {/* Preview only — the request is fulfilled server-side against
                        whatever FREE_SUBDOMAIN_ROOT_DOMAIN is actually configured
                        to (see resolveFreeSubdomainRoot in customerDomains.js).
                        This used to say ".murzaktech.com", which has no DNS at all. */}
                    <span className="text-sm font-semibold text-p-muted shrink-0">.murzaktech.tech</span>
                  </div>
                  {label && !subdomainLabelValid && (
                    <p className="mt-2 text-xs font-medium text-p-danger">Letters, numbers and hyphens only.</p>
                  )}
                </div>
                <div className="flex items-start gap-2 p-3 rounded-md bg-p-accent-soft border border-p-accent/40">
                  <ShieldCheck className="w-4 h-4 text-p-accent-text shrink-0 mt-0.5" />
                  <p className="text-xs font-medium text-p-muted leading-relaxed">
                    Free, no registration needed. This is usually ready the fastest.
                  </p>
                </div>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!subdomainLabelValid}
                  label="Get this subdomain"
                  onClick={() => submit(() => onRequestFreeSubdomain({ requestedLabel: label.trim() }))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="p-4 rounded-lg border border-p-danger/40 bg-p-danger-soft text-p-danger flex items-start gap-3">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-xs font-medium leading-relaxed">{text}</p>
    </div>
  );
}

function SubmitButton({
  submitting,
  disabled,
  label,
  onClick,
}: {
  submitting: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={submitting || disabled}
      onClick={onClick}
      className={`w-full px-5 py-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
        submitting || disabled
          ? "bg-p-panel-2 text-p-muted cursor-not-allowed"
          : "bg-p-accent text-p-accent-fg "
      }`}
    >
      {submitting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" /> Sending…
        </>
      ) : (
        label
      )}
    </button>
  );
}
